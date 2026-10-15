"""Contract tests for arm.sh, run hermetically: state lives under a temp TMPDIR, the clock is AFK_NOW."""
import json
import os
import subprocess
from pathlib import Path

ARM = Path(__file__).parent / "arm.sh"


def arm(tmp_path, *args, now="14:00", strict=False, sid_env=None):
    env = {**os.environ, "TMPDIR": str(tmp_path), "HOME": str(tmp_path / "home"), "AFK_NOW": now}
    env.pop("CLAUDE_CODE_SESSION_ID", None)
    env.pop("AFK_STRICT", None)
    if strict:
        env["AFK_STRICT"] = "1"
    return subprocess.run(["bash", str(ARM), *args], capture_output=True, text=True, env=env)


def state(tmp_path, sid):
    return json.loads((tmp_path / f"work-hold-{sid}.json").read_text())


def test_daytime_arm_runs_until_1800(tmp_path):
    p = arm(tmp_path, "s1", "write", "the", "report", now="14:00")
    assert p.returncode == 0
    assert p.stdout == "afk hold armed until 18:00 (1500 rounds); release: work-hold.sh --disarm\n"
    s = state(tmp_path, "s1")
    assert s["origin"] == "afk" and s["maxRounds"] == 1500 and s["ceilingMinutes"] == 240
    assert s["goal"].startswith("Afk mandate: write the report. Met only when")
    assert s["check"] == ""


def test_no_objective_uses_default_text(tmp_path):
    arm(tmp_path, "s1")
    assert state(tmp_path, "s1")["goal"].startswith("Afk mandate: everything queued before sign-off.")


def test_night_arm_runs_until_next_0900(tmp_path):
    p = arm(tmp_path, "s1", now="23:00")
    assert "afk hold armed until 09:00 (1500 rounds)" in p.stdout
    assert state(tmp_path, "s1")["ceilingMinutes"] == 600


def test_early_morning_has_no_floor(tmp_path):
    arm(tmp_path, "s1", now="02:00")
    assert state(tmp_path, "s1")["ceilingMinutes"] == 420


def test_exactly_0900_arms_the_day_ceiling(tmp_path):
    p = arm(tmp_path, "s1", now="09:00")
    assert "armed until 18:00" in p.stdout
    assert state(tmp_path, "s1")["ceilingMinutes"] == 540


def test_sixty_minute_floor_near_a_ceiling(tmp_path):
    p = arm(tmp_path, "s1", now="17:50")
    assert "armed until 18:50" in p.stdout
    assert state(tmp_path, "s1")["ceilingMinutes"] == 60
    p = arm(tmp_path, "s2", now="08:30")
    assert "armed until 09:30" in p.stdout


def test_missing_session_id_refuses_with_exit_0_by_default(tmp_path):
    p = arm(tmp_path, "")
    assert p.returncode == 0
    assert "afk: no usable session id (empty) — cannot arm a session-scoped hold. Not armed." in p.stdout
    assert not list(tmp_path.glob("work-hold-*"))


def test_strict_mode_gives_exit_2_for_bad_session_id(tmp_path):
    assert arm(tmp_path, "", strict=True).returncode == 2
    p = arm(tmp_path, "-x", strict=True)
    assert p.returncode == 2
    assert "no usable session id (-x)" in p.stdout


def test_second_arm_arms_nothing_and_shows_status(tmp_path):
    arm(tmp_path, "s1", "first")
    before = state(tmp_path, "s1")
    p = arm(tmp_path, "s1", "second")
    assert p.returncode == 0
    assert p.stdout.startswith("afk: an afk hold is already armed for this session; arming nothing.\n")
    assert "hold: ARMED" in p.stdout
    assert state(tmp_path, "s1") == before


def test_foreign_hold_gets_afk_queued_behind(tmp_path):
    foreign = {"check": "", "goal": "other goal", "startedAt": 4_000_000_000, "ceilingMinutes": 120,
               "maxRounds": 4, "rounds": 0}
    (tmp_path / "work-hold-s1.json").write_text(json.dumps(foreign))
    p = arm(tmp_path, "s1", "night work", now="23:00")
    assert p.returncode == 0
    assert p.stdout.startswith("afk hold queued behind the armed other goal; it takes over when "
                               "that one releases (ceiling 09:00, 1500 rounds)")
    s = state(tmp_path, "s1")
    assert s["goal"] == "other goal"
    assert [q["origin"] for q in s["queued"]] == ["afk"]


def live_grind(tmp_path, sid, started=True, done=False):
    d = tmp_path / "farm-events" / sid
    d.mkdir(parents=True)
    lines = ["grind: START"] if started else []
    if done:
        lines.append("grind: DONE")
    (d / f"{os.getpid()}.ndjson").write_text("\n".join(lines) + "\n")


def test_live_grind_refuses(tmp_path):
    live_grind(tmp_path, "s1")
    p = arm(tmp_path, "s1", strict=True)
    assert p.returncode == 3
    assert f"afk: a grind loop this session launched is live (pid {os.getpid()})." in p.stdout
    assert p.stdout.rstrip().endswith("Not armed.")
    assert not (tmp_path / "work-hold-s1.json").exists()


def test_live_grind_refusal_exits_0_without_strict(tmp_path):
    live_grind(tmp_path, "s1")
    assert arm(tmp_path, "s1").returncode == 0


def test_finished_grind_does_not_block(tmp_path):
    live_grind(tmp_path, "s1", done=True)
    p = arm(tmp_path, "s1")
    assert "afk hold armed until 18:00" in p.stdout
