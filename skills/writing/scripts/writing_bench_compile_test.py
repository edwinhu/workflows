from __future__ import annotations

import copy
import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

wbc = importlib.import_module("writing_bench_compile")
wsi = importlib.import_module("writing_section_index")


BENCH: dict = {
    "intent": {
        "thesis": "The rule should change.",
        "audience": "Legal academics.",
        "purpose": "Establish the case for reform.",
        "hook": "The existing rule fails in a recurring case.",
        "scope": "Federal doctrine; state law is excluded.",
        "domain": "legal",
        "genre": "lawrev-doctrinal",
    },
    "srcmeta": {
        "bibliography": "references/sources.bib",
        "notebook": "none",
        "notebookUrl": "none",
    },
    "sources": [
        {"id": "s1", "key": "smith2019", "cite": "Smith (2019).", "artifact": "references/smith2019.pdf"},
        {"id": "s2", "key": "jones2020", "cite": "Jones (2020).", "artifact": "references/jones2020.pdf"},
    ],
    "outline": [
        {
            "id": "n1",
            "text": "Introduction",
            "status": "agreed",
            "source": "",
            "kind": "",
            "collapsed": False,
            "children": [
                {"id": "n2", "text": "Frames the problem", "status": "you", "source": "smith2019", "kind": "", "children": []},
                {"id": "n3", "text": "Previews both claims", "status": "agreed", "source": "", "kind": "", "children": []},
            ],
        },
        {
            "id": "n4",
            "text": "Part I. The Gap",
            "status": "agreed",
            "source": "",
            "kind": "",
            "children": [
                {
                    "id": "n5",
                    "text": "The current rule creates a predictable gap.",
                    "status": "agreed",
                    "source": "smith2019",
                    "kind": "claim",
                    "cid": "CLAIM-01",
                    "children": [
                        {"id": "n6", "text": "The recurring fact pattern", "status": "agreed", "source": "jones2020", "kind": "", "children": []},
                    ],
                },
                {"id": "n7", "text": "Why courts do not notice", "status": "agreed", "source": "", "kind": "", "children": []},
            ],
        },
        {
            "id": "n8",
            "text": "Part II. The Repair",
            "status": "agreed",
            "source": "",
            "kind": "",
            "children": [
                {
                    "id": "n9",
                    "text": "A narrower replacement closes that gap.",
                    "status": "agreed",
                    "source": "jones2020",
                    "kind": "claim",
                    "cid": "CLAIM-02",
                    "children": [],
                },
                {"id": "n10", "text": "Administrability favors the status quo, and a bounded test answers it.", "status": "agreed", "source": "", "kind": "counter", "children": []},
                {"id": "n11", "text": "The payoff", "status": "agreed", "source": "", "kind": "", "children": []},
            ],
        },
    ],
    "rev": 1,
}


def write_bench(tmp_path: Path, mutate=None) -> Path:
    bench = copy.deepcopy(BENCH)
    if mutate is not None:
        mutate(bench)
    path = tmp_path / "bench.json"
    path.write_text(json.dumps(bench), encoding="utf-8")
    return path


def project(tmp_path: Path) -> Path:
    proj = tmp_path / "proj"
    (proj / "references").mkdir(parents=True)
    (proj / "references" / "sources.bib").write_text("@article{smith2019, title={Smith}}\n")
    return proj


def run(tmp_path: Path, *extra: str, mutate=None, slug: str = "bench-article") -> tuple[int, Path]:
    bench = write_bench(tmp_path, mutate)
    proj = tmp_path / "proj"
    if not proj.is_dir():
        project(tmp_path)
    code = wbc.main(["--bench", str(bench), "--project", str(proj), "--slug", slug, *extra])
    return code, proj


def refusal(capsys, tmp_path: Path, mutate=None, **kwargs) -> str:
    code, _ = run(tmp_path, mutate=mutate, **kwargs)
    assert code == 1
    return capsys.readouterr().err


# ── Happy path ───────────────────────────────────────────────────────────────


def test_compiles_a_plan_the_real_parser_accepts(tmp_path: Path) -> None:
    code, proj = run(tmp_path, "--title", "Bench Article")
    assert code == 0

    plan_path = proj / ".planning" / "bench-article.md"
    plan_text = plan_path.read_text(encoding="utf-8")
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    assert plan_text.startswith("# Bench Article\n")
    assert "- **Domain**: legal" in plan_text
    assert "- **CLAIM-01**: The current rule creates a predictable gap." in plan_text
    assert "| CLAIM-02 | Part II. The Repair |" in plan_text
    assert "- **Key Sources**: smith2019; jones2020" in plan_text
    assert "| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |" in plan_text
    assert "Administrability favors the status quo" in plan_text

    outline = (proj / "outlines" / "Part I. The Gap.md").read_text(encoding="utf-8")
    assert outline.startswith(f"---\nimplements: [CLAIM-01]\nplan_hash: {plan_hash}\n---\n")
    assert "- The current rule creates a predictable gap. [@smith2019]" in outline
    assert "  - The recurring fact pattern [@jones2020]" in outline
    assert (proj / "outlines" / "Introduction.md").read_text().startswith("---\nimplements: []\n")

    # The parser is the acceptance test, not our own reading of the grammar.
    state = proj / ".planning" / ".state"
    state.mkdir()
    (state / "review.json").write_text(
        json.dumps(
            {
                "workflow": "writing",
                "plan_file": "bench-article.md",
                "plan_hash": plan_hash,
                "approved_session_id": "approval-session",
                "approved_at": "2026-09-09T10:00:00.000Z",
                "status": "APPROVED",
                "reviewer_session_id": "review-session",
                "reviewed_at": "2026-09-09T10:01:00.000Z",
            }
        )
    )
    result = wsi.build_index(proj)
    assert result.ok, result.violations
    assert [section.name for section in result.sections] == [
        "Introduction",
        "Part I. The Gap",
        "Part II. The Repair",
    ]
    assert result.sections[1].primary_claims == ["CLAIM-01"]
    assert result.sections[1].dependencies == ["Introduction"]
    assert result.sections[0].dependencies == []
    assert result.sections[1].sources_pinned is True


def test_usage_error_exits_two(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exit_info:
        wbc.main(["--bench", str(tmp_path / "bench.json")])
    assert exit_info.value.code == 2


# ── Refusals ─────────────────────────────────────────────────────────────────


def test_refuses_empty_intent_field(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["intent"].update({"hook": "  "}))
    assert "intent.hook is empty" in err
    assert not (tmp_path / "proj" / ".planning").exists()


def test_refuses_when_there_are_no_sections(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench.update({"outline": []}))
    assert "the bench has no sections" in err


def test_refuses_a_section_with_empty_text(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["outline"][1].update({"text": "   "}))
    assert "section at outline position 2 has empty text" in err


def test_refuses_duplicate_section_names(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["outline"][2].update({"text": "Part I. The Gap"}))
    assert "two sections share the name 'Part I. The Gap'" in err
    assert "outline positions 2 and 3" in err


def test_refuses_a_claim_with_no_level_one_ancestor(capsys, tmp_path: Path) -> None:
    def mutate(bench: dict) -> None:
        bench["outline"].append(
            {"id": "nX", "text": "A loose claim.", "status": "agreed", "source": "", "kind": "claim", "cid": "CLAIM-09", "children": []}
        )

    err = refusal(capsys, tmp_path, mutate)
    assert "claim CLAIM-09 at outline position 4 is a level-1 node" in err


def test_refuses_duplicate_claim_ids(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["outline"][2]["children"][0].update({"cid": "CLAIM-01"}))
    assert "duplicate claim id CLAIM-01" in err
    assert "2.1, 3.1" in err


def test_refuses_empty_bibliography(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["srcmeta"].update({"bibliography": ""}))
    assert "srcmeta.bibliography is empty" in err


def test_refuses_a_source_key_absent_from_sources(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["outline"][0]["children"][0].update({"source": "ghost2021"}))
    assert "pins source key 'ghost2021', which is not in sources[]" in err
    assert "outline position 1.1" in err


def test_refuses_a_pinned_source_with_no_artifact(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["sources"][0].update({"artifact": ""}))
    assert "source key 'smith2019'" in err
    assert "recall is not a source" in err


@pytest.mark.parametrize(("status", "phrase"), [("scaffold", "still scaffold text"), ("claude", "still an unaccepted Claude suggestion")])
def test_refuses_unaccepted_nodes_and_names_their_position(capsys, tmp_path: Path, status: str, phrase: str) -> None:
    err = refusal(capsys, tmp_path, lambda bench: bench["outline"][1]["children"][0]["children"][0].update({"status": status}))
    assert phrase in err
    assert "outline position 2.1.1" in err
    assert "The recurring fact pattern" in err


def test_refusal_lists_every_reason_at_once(capsys, tmp_path: Path) -> None:
    def mutate(bench: dict) -> None:
        bench["intent"]["thesis"] = ""
        bench["srcmeta"]["bibliography"] = ""
        bench["outline"][0]["status"] = "scaffold"

    err = refusal(capsys, tmp_path, mutate)
    assert "intent.thesis is empty" in err
    assert "srcmeta.bibliography is empty" in err
    assert "still scaffold text" in err


def test_refuses_when_the_bench_defines_no_claims(capsys, tmp_path: Path) -> None:
    def mutate(bench: dict) -> None:
        for section in bench["outline"]:
            for child in section["children"]:
                if child.get("kind") == "claim":
                    child["kind"] = ""
                    child.pop("cid", None)

    err = refusal(capsys, tmp_path, mutate)
    assert "the bench defines no claims" in err


def test_refuses_unsafe_slug(capsys, tmp_path: Path) -> None:
    err = refusal(capsys, tmp_path, slug="../escape")
    assert "--slug '../escape' is not a safe plan basename" in err


def test_refuses_unreadable_bench(capsys, tmp_path: Path) -> None:
    bench = tmp_path / "bench.json"
    bench.write_text("{not json", encoding="utf-8")
    project(tmp_path)
    code = wbc.main(["--bench", str(bench), "--project", str(tmp_path / "proj"), "--slug", "x"])
    assert code == 1
    assert "is not valid JSON" in capsys.readouterr().err


# ── Legacy migration ─────────────────────────────────────────────────────────


def test_migrates_the_legacy_sections_and_claims_shape(tmp_path: Path) -> None:
    def mutate(bench: dict) -> None:
        del bench["outline"]
        bench["sections"] = [
            {"title": "Introduction", "beats": ["Frames the problem", {"text": "Previews both claims", "source": "smith2019"}]},
            {"title": "Part I. The Gap", "beats": [{"text": "Why courts do not notice"}]},
        ]
        bench["claims"] = [
            {"id": "CLAIM-01", "text": "The current rule creates a predictable gap.", "section": "Part I. The Gap", "source": "smith2019"}
        ]
        bench["counters"] = [{"text": "Administrability favors the status quo.", "section": "Part I. The Gap"}]

    code, proj = run(tmp_path, mutate=mutate)
    assert code == 0
    plan_text = (proj / ".planning" / "bench-article.md").read_text(encoding="utf-8")
    assert "### Introduction" in plan_text
    assert "- **CLAIM-01**: The current rule creates a predictable gap." in plan_text
    assert "| CLAIM-01 | Part I. The Gap |" in plan_text
    assert "- Administrability favors the status quo." in plan_text
    gap = (proj / "outlines" / "Part I. The Gap.md").read_text(encoding="utf-8")
    assert "implements: [CLAIM-01]" in gap
    assert "- The current rule creates a predictable gap. [@smith2019]" in gap


def test_legacy_claim_without_a_named_section_lands_in_the_first(tmp_path: Path) -> None:
    def mutate(bench: dict) -> None:
        del bench["outline"]
        bench["sections"] = [{"title": "Introduction", "beats": ["A beat"]}, {"title": "Part I", "beats": ["Another beat"]}]
        bench["claims"] = [{"id": "CLAIM-01", "text": "A claim."}]

    code, proj = run(tmp_path, mutate=mutate)
    assert code == 0
    assert "| CLAIM-01 | Introduction |" in (proj / ".planning" / "bench-article.md").read_text()


# ── --force ──────────────────────────────────────────────────────────────────


def test_refuses_to_overwrite_an_existing_plan(capsys, tmp_path: Path) -> None:
    code, proj = run(tmp_path)
    assert code == 0
    capsys.readouterr()
    plan_path = proj / ".planning" / "bench-article.md"
    plan_path.write_text("approved and hashed\n", encoding="utf-8")

    code, _ = run(tmp_path)
    assert code == 1
    err = capsys.readouterr().err
    assert "bench-article.md already exists" in err
    assert "--force" in err
    assert plan_path.read_text() == "approved and hashed\n"


def test_force_overwrites(tmp_path: Path) -> None:
    code, proj = run(tmp_path)
    assert code == 0
    plan_path = proj / ".planning" / "bench-article.md"
    plan_path.write_text("stale\n", encoding="utf-8")

    code, _ = run(tmp_path, "--force")
    assert code == 0
    assert plan_path.read_text().startswith("# bench-article\n")
