#!/usr/bin/env python3
"""Tests for the prose-lint writing hook + Typst (.typ) prose extraction.

Covers (per the v5.42.0 design):
  - .typ markup stripping (prose_extract._iter_typ_lines)
  - deck-skip logic (hook._is_typ_deck)
  - hook routes .typ letters + .md drafts to prose-lint.py
  - domain `style:` -> prose-lint `--only` mapping
  - edited-line scoping (only violations on touched lines are reported)
  - no double-reporting (granular ai-smell constraints superseded by prose-lint)

Run with:  python3 -m pytest tests/test_prose_lint_hook.py
       or:  python3 tests/test_prose_lint_hook.py
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import prose_extract  # noqa: E402


# THE HOOK IS TYPESCRIPT. It used to be imported here as a Python module; its helper-level tests
# (deck detection, domain→category mapping, edited-line scoping) now live in
# tests/writing-prose-check.test.mjs, and `_detect_style` was dropped rather than ported because it
# read the retired `.planning/ACTIVE_WORKFLOW.md` ledger. What remains in THIS file is what is still
# genuinely Python: `.typ` prose extraction (scripts/prose_extract.py), the scored AI-tic table
# (skills/ai-anti-patterns/scripts/screen.py), and the hook's end-to-end behaviour, which is driven
# as a subprocess and does not care what language the hook is written in.
HOOK_PATH = REPO_ROOT / "hooks" / "writing-prose-check.ts"


# --------------------------------------------------------------------------
# .typ markup stripping
# --------------------------------------------------------------------------

def test_typ_skips_code_lines(tmp_path):
    f = tmp_path / "letter.typ"
    f.write_text(
        '#import "@preview/letter:0.1.0": letter\n'
        '#set page(margin: 1in)\n'
        '#show heading: it => it\n'
        "Dear Professor,\n"
        "Thank you for your time.\n"
    )
    lines = prose_extract.read_lines(f)
    texts = [t for _, t in lines]
    assert texts == ["Dear Professor,", "Thank you for your time."], texts
    # Line numbers are the original 1-based file positions.
    assert lines == [(4, "Dear Professor,"), (5, "Thank you for your time.")]


def test_typ_skips_multiline_code_block(tmp_path):
    f = tmp_path / "letter.typ"
    f.write_text(
        "#let recipient = (\n"
        '  name: "John Doe",\n'
        '  address: "123 Main St",\n'
        ")\n"
        "This is the actual prose body.\n"
    )
    texts = [t for _, t in prose_extract.read_lines(f)]
    # The dict interior must NOT leak in as prose.
    assert texts == ["This is the actual prose body."], texts


def test_typ_skips_comments(tmp_path):
    f = tmp_path / "letter.typ"
    f.write_text(
        "// a line comment\n"
        "/* a block\n"
        "   comment */\n"
        "Real prose here.\n"
    )
    texts = [t for _, t in prose_extract.read_lines(f)]
    assert texts == ["Real prose here."], texts


def test_typ_strips_heading_and_list_markers(tmp_path):
    f = tmp_path / "doc.typ"
    f.write_text(
        "= Top Heading\n"
        "== Sub Heading\n"
        "- a bullet item\n"
        "+ a numbered item\n"
        "Plain paragraph.\n"
    )
    texts = [t for _, t in prose_extract.read_lines(f)]
    assert texts == [
        "Top Heading", "Sub Heading",
        "a bullet item", "a numbered item", "Plain paragraph.",
    ], texts


def test_typ_prose_rule_fires_on_body_not_code(tmp_path):
    """An AI tell in the prose body is linted; an identical token inside a
    #let value is not (because the code line is skipped)."""
    f = tmp_path / "letter.typ"
    f.write_text(
        '#let tag = "delves"\n'
        "This article delves into the topic.\n"
    )
    matched = [
        (ln, txt) for ln, txt in prose_extract.read_lines(f)
        if "delves" in txt
    ]
    assert matched == [(2, "This article delves into the topic.")], matched


# --------------------------------------------------------------------------
# deck-skip logic
# --------------------------------------------------------------------------






# --------------------------------------------------------------------------
# domain --only mapping
# --------------------------------------------------------------------------





# --------------------------------------------------------------------------
# edited-line scoping
# --------------------------------------------------------------------------



# --------------------------------------------------------------------------
# Integration: hook end-to-end
# --------------------------------------------------------------------------

def _authenticate(project_root: Path, domain: str | None = None) -> None:
    """Give the project an APPROVED receipt-selected generated plan.

    The canonical writing hooks refuse to lint a project that has none — see the
    `authenticatedWritingPlan` guard in hooks/writing-prose-check.ts. That guard postdates this
    suite, which built bare tmp directories; without a receipt the hook exits 0 with no output, so
    every integration assertion below was reading `None` and failing for a reason that had nothing to
    do with the prose rule under test. Omitting Domain leaves style unset, which is the general
    category set the original tests assumed.
    """
    state = project_root / ".planning" / ".state"
    state.mkdir(parents=True, exist_ok=True)
    body = "## Writing Intent\n\n"
    if domain:
        body += f"- Domain: {domain}\n\n"
    body += "## Source Plan\n\n- Bibliography: references/sources.bib\n- Notebook: none\n"
    plan_file = "writing-native.md"
    (project_root / ".planning" / plan_file).write_text(body)
    (state / "review.json").write_text(json.dumps({
        "workflow": "writing", "plan_file": plan_file,
        "plan_hash": hashlib.sha256(body.encode()).hexdigest(),
        "approved_session_id": "approval", "approved_at": "2026-01-01T00:00:00.000Z",
        "status": "APPROVED", "reviewer_session_id": "review",
        "reviewed_at": "2026-01-01T00:00:01.000Z",
    }))


def _run_hook(file_path: Path, tool_name="Write", new_string=None, domain=None):
    # Mirror the hook's own project-root derivation: drafts/*.md sits one level deeper than a .typ.
    root = file_path.parent.parent if file_path.suffix == ".md" else file_path.parent
    _authenticate(root, domain)
    payload = {"tool_name": tool_name,
               "tool_input": {"file_path": str(file_path)}}
    if new_string is not None:
        payload["tool_input"]["new_string"] = new_string
    proc = subprocess.run(
        ["bun", str(HOOK_PATH)],
        input=json.dumps(payload), capture_output=True, text=True, timeout=60,
    )
    out = proc.stdout.strip()
    if not out:
        return None
    return json.loads(out)["hookSpecificOutput"]["additionalContext"]


def test_hook_lints_typ_letter(tmp_path):
    f = tmp_path / "letter.typ"
    f.write_text('#set page(margin: 1in)\n'
                 "This article delves into the rich tapestry of the law.\n")
    ctx = _run_hook(f)
    assert ctx is not None and "letter.typ:2" in ctx and "ai-anti-patterns" in ctx, ctx


def test_hook_skips_typ_deck(tmp_path):
    f = tmp_path / "talk.typ"
    f.write_text('#import "@preview/touying:0.5.0": *\n'
                 "This delves into the rich tapestry of slides.\n")
    assert _run_hook(f) is None


def test_hook_skips_md_outside_drafts(tmp_path):
    f = tmp_path / "notes.md"
    f.write_text("It is important to note the rich tapestry here.\n")
    assert _run_hook(f) is None


def test_hook_scopes_to_edited_lines(tmp_path):
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    # AI tell on line 1 (untouched) and line 4 (edited) — both phrases that
    # prose-lint's ai-anti-patterns table actually catches.
    f.write_text(
        "This is the rich tapestry of antitrust law.\n"
        "\n"
        "Neutral sentence.\n"
        "It is important to note the edited claim here.\n"
    )
    ctx = _run_hook(f, tool_name="Edit",
                    new_string="It is important to note the edited claim here.")
    assert ctx is not None
    assert "d.md:4" in ctx, ctx
    assert "d.md:1" not in ctx, ctx


def test_hook_no_double_report_puffery(tmp_path):
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text("It is important to note this point.\n")
    ctx = _run_hook(f)
    assert ctx is not None
    # prose-lint reports it under ai-anti-patterns ...
    assert "ai-anti-patterns" in ctx, ctx
    # ... and the superseded granular constraint label must NOT appear.
    assert "puffery:important-to-note" not in ctx, ctx
    assert "writing-ai-smell-puffery" not in ctx, ctx


def test_hook_flags_imperative_scene_setting_opener(tmp_path):
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "Consider the staggered board, a setup that split directors into classes.\n"
        "\n"
        "For decades, big companies split their boards into classes.\n"
    )
    ctx = _run_hook(f)
    assert ctx is not None
    # the "Consider the X" opener on line 1 is flagged ...
    assert "imperative scene-setting opener" in ctx, ctx
    assert "d.md:1" in ctx, ctx
    # ... and the concrete rewrite on line 3 is not flagged for it.
    assert "d.md:3" not in ctx, ctx


def test_hook_flags_epigrammatic_antithesis(tmp_path):
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "Different rules, one direction: each strips away a protection.\n"
        "\n"
        "Each of these strips away a protection investors rely on.\n"
    )
    ctx = _run_hook(f)
    assert ctx is not None
    assert "epigrammatic antithesis" in ctx, ctx
    assert "d.md:1" in ctx, ctx
    assert "d.md:3" not in ctx, ctx


def test_hook_epigrammatic_antithesis_variants(tmp_path):
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    # tricolon, reverse "Same X, different Y", and two legit non-antithesis lines
    f.write_text(
        "Scattered rules, singular purpose.\n"
        "\n"
        "Same playbook, different target.\n"
        "\n"
        "Same store, same staff, same hours.\n"   # anaphora, not antithesis
        "\n"
        "Different rules apply, one for each state.\n"  # legit usage
    )
    ctx = _run_hook(f)
    assert ctx is not None
    assert "d.md:1" in ctx and "d.md:3" in ctx, ctx       # both flagged
    assert "d.md:5" not in ctx and "d.md:7" not in ctx, ctx  # neither false-positive


def test_hook_flags_false_unity_closer(tmp_path):
    """The 'Whether X, Y, or Z, the lesson is the same' / 'all point to one
    truth' closer (a cross-model AI default, discovered via the ai-tic-discovery
    harness) is flagged; genuine human enumerations are not."""
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "Whether it's the Fed's rate hold, the WHO's treaty, or Boeing's scandal, "
        "the lesson is the same: institutions built for a slower world are failing.\n"
        "\n"
        "The wildfires, the bank collapse, and the AI ruling all point to one "
        "uncomfortable truth: we write rules only after the fire has burned.\n"
        "\n"
        "These three cases are not separate crises but a single failure of will.\n"
        "\n"
        "The committee reviewed the merger, the spinoff, and the buyback in turn.\n"
    )
    ctx = _run_hook(f)
    assert ctx is not None
    assert "false-unity" in ctx, ctx
    assert "d.md:1" in ctx, ctx   # "Whether… or…, the lesson is the same"
    assert "d.md:3" in ctx, ctx   # "all point to one uncomfortable truth"
    assert "d.md:5" in ctx, ctx   # "not separate crises but a single…"
    assert "d.md:7" not in ctx, ctx  # plain enumeration — not flagged


def test_false_unity_no_false_positive_on_legal_prose(tmp_path):
    """The false-unity rule must NOT fire on ordinary academic / legal prose —
    the corpus-validated discipline (0 FP on 15k pre-2017 journal sentences)."""
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "Whether the merger was fair is the question we now answer.\n"
        "\n"
        "These results point to a single conclusion about investor behavior.\n"
        "\n"
        "From a negotiating perspective, that signaled a strong response.\n"
    )
    ctx = _run_hook(f)
    # "a single conclusion" is NOT in the payload vocabulary (truth/thread/axiom);
    # "Whether X is the question" lacks the ", or …," enumeration. None flagged.
    assert ctx is None or "false-unity" not in ctx, ctx


def test_hook_flags_findings_carry_implications(tmp_path):
    """The 'these findings carry significant implications' AI academic closer
    (discovered by the n-gram diff, FP-gated on 8.7M human sentences) is flagged;
    the sibling phrasings the full corpus proved are HUMAN ('contributes to the
    growing literature', 'implications for both theory and practice') are NOT."""
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "These findings carry significant implications for both theoretical and "
        "practical audiences in the disclosure literature.\n"
        "\n"
        "This study contributes to the growing literature on auditor expertise.\n"
        "\n"
        "Our results have implications for both theory and practice.\n"
    )
    ctx = _run_hook(f)
    assert ctx is not None
    assert "findings carry significant implications" in ctx, ctx
    assert "d.md:1" in ctx, ctx
    # the full-corpus-cleared (i.e. genuinely human) siblings must NOT be flagged
    assert "d.md:3" not in ctx, ctx
    assert "d.md:5" not in ctx, ctx


def test_hook_flags_gap_statement_cliche(tmp_path):
    """The AI gap-statement / results-framing cliché ('a critical gap in the
    literature', 'Practically, these findings…') is flagged; a plain statement
    of a research question is not. FP-gated to 1/8.7M on the full corpus."""
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    f = drafts / "d.md"
    f.write_text(
        "This study addresses a critical gap in the corporate governance literature.\n"
        "\n"
        "Practically, these findings suggest managers should disclose earlier.\n"
        "\n"
        "We examine whether staggered boards affect takeover premiums.\n"
    )
    ctx = _run_hook(f)
    assert ctx is not None
    assert "gap-statement" in ctx, ctx
    assert "d.md:1" in ctx, ctx   # "a critical gap in the … literature"
    assert "d.md:3" in ctx, ctx   # "Practically, these findings…"
    assert "d.md:5" not in ctx, ctx  # plain research-question statement — not flagged


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))


# --------------------------------------------------------------------------
# scored AI-tic table (gate-then-grade): positive fires, human near-miss doesn't
# --------------------------------------------------------------------------
def _scored_tic_patterns():
    import importlib.util
    p = REPO_ROOT / "skills" / "ai-anti-patterns" / "scripts" / "screen.py"
    spec = importlib.util.spec_from_file_location("aap_screen", p)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return [(lab, rx) for cat, lab, rx in mod.load_patterns(only={"scored-tic"})]


def test_scored_tic_fires_on_ai_phrase():
    pats = _scored_tic_patterns()
    assert pats, "scored-tic table did not load"
    text = "This weaves a rich tapestry of doctrine."
    assert any(rx.search(text) for _, rx in pats)
    # severity rides in the label
    assert all(lab.startswith("ai-tic·sev") for lab, _ in pats)


def test_scored_tic_skips_human_near_miss():
    pats = _scored_tic_patterns()
    # bare "delve into" is REJECTED (real authors write it); only the narrowed
    # "delve into the intricacies of" is a rule. The bare form must NOT fire.
    assert not any(rx.search("We delve into the statute's text.") for _, rx in pats)
    # "plays a crucial role" (bare) is rejected; only "...pivotal role in shaping"
    assert not any(rx.search("Disclosure plays a crucial role here.") for _, rx in pats)


def test_scored_tic_repo_survivors_fire():
    pats = _scored_tic_patterns()
    fire = lambda t: any(rx.search(t) for _, rx in pats)
    assert fire("Let's think step by step about the statute.")          # reasoning-chain
    assert fire("This represents a broader shift in doctrine.")          # superficial-meaning
    assert fire("It covers everything from contracts to torts, and everything in between.")  # false-range


def test_scored_tic_repo_rejects_do_not_fire():
    pats = _scored_tic_patterns()
    fire = lambda t: any(rx.search(t) for _, rx in pats)
    # these FAILED the corpus gate — real legal scholars write them; must NOT fire
    assert not fire("The statute serves as a deterrent to coercive tender offers.")
    assert not fire("The rule could potentially affect minority shareholders.")
    assert not fire("Studies show that staggered boards reduce firm value.")
