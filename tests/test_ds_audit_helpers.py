"""A project's declared audit/log/schema helpers satisfy the rule; an undeclared one does not.

`dsAuditHelpers` in .claude-workflows.json (or DS_AUDIT_HELPERS, which the domain gate sets for its flat copy)
names the helpers. A call to one in the window counts when its code links to the operation, as an inline log does.
"""
import importlib.util
import json
from pathlib import Path

_C = Path(__file__).resolve().parents[1] / "constraints"


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, _C / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.check


join_check = _load("ds_join_audits", "ds-join-audits.py")
err_check = _load("ds_error_handling", "ds-error-handling.py")
schema_check = _load("ds_schema_contracts", "ds-schema-contracts.py")

# fixture text for the rules under test, not operations this file performs
MERGE = 'out = a.merge(b, on="k")\n{call}\n'
DROP = 'clean = raw.dropna(subset=["x"])\n{call}\n'
LOAD = 'df = pd.read_parquet(p)\n{call}\n'


def run(check, tmp_path, source, helpers=None):
    (tmp_path / "s.py").write_text(source)
    cfg = tmp_path / ".claude-workflows.json"
    cfg.unlink(missing_ok=True)
    if helpers is not None:
        cfg.write_text(json.dumps({"dsAuditHelpers": helpers}))
    return check({"cwd": str(tmp_path)})


def test_declared_helper_closes_a_merge(tmp_path):
    assert run(join_check, tmp_path, MERGE.format(call="F.audit_join(a, b, out)"), ["audit_join"]) == []


def test_undeclared_helper_is_still_flagged(tmp_path):
    assert len(run(join_check, tmp_path, MERGE.format(call="F.audit_join(a, b, out)"), ["something_else"])) == 1
    assert len(run(join_check, tmp_path, MERGE.format(call="F.audit_join(a, b, out)"))) == 1


def test_declared_helper_must_link_to_the_operation(tmp_path):
    assert len(run(join_check, tmp_path, MERGE.format(call="audit_join(x, y, z)"), ["audit_join"])) == 1


def test_declared_helper_closes_a_dropna(tmp_path):
    assert run(err_check, tmp_path, DROP.format(call="log_rows(clean, 'dropped nulls')"), ["log_rows"]) == []
    assert len(run(err_check, tmp_path, DROP.format(call="log_rows(clean, 'dropped nulls')"))) == 1


def test_declared_helper_closes_a_data_load(tmp_path):
    assert run(schema_check, tmp_path, LOAD.format(call="ensure_cols(df, 'x')"), ["ensure_cols"]) == []
    assert len(run(schema_check, tmp_path, LOAD.format(call="ensure_cols(df, 'x')"), ["other"])) == 1


def test_a_helper_name_is_not_a_prefix_match(tmp_path):
    assert len(run(join_check, tmp_path, MERGE.format(call="my_audit_join_x(a, b, out)"), ["audit_join"])) == 1


def test_env_var_overrides_the_config(tmp_path, monkeypatch):
    monkeypatch.setenv("DS_AUDIT_HELPERS", "audit_join")
    assert run(join_check, tmp_path, MERGE.format(call="audit_join(a, b, out)")) == []
    monkeypatch.setenv("DS_AUDIT_HELPERS", "")
    assert len(run(join_check, tmp_path, MERGE.format(call="audit_join(a, b, out)"), ["audit_join"])) == 1
