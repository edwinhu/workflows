"""Offline contracts for Gemini tier guidance and example request builders."""

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/gemini-vertex"


def load_example(name):
    # Never import a real SDK: any unexpected client access fails locally.
    google = types.ModuleType("google")
    genai = types.ModuleType("google.genai")
    genai.__dict__["Client"] = MagicMock(
        side_effect=AssertionError("model APIs forbidden in tests")
    )
    sdk_types = types.ModuleType("google.genai.types")
    sdk_types.__dict__.update(
        EmbeddingsBatchJobSource=lambda **kw: kw,
        EmbedContentConfig=lambda **kw: kw,
    )
    genai.__dict__["types"] = sdk_types
    cloud = types.ModuleType("google.cloud")
    cloud.__dict__["storage"] = types.SimpleNamespace(Client=MagicMock())
    numpy = types.ModuleType("numpy")
    modules = {
        "google": google,
        "google.genai": genai,
        "google.genai.types": sdk_types,
        "google.cloud": cloud,
        "numpy": numpy,
    }
    spec = importlib.util.spec_from_file_location(name, SKILL / f"examples/{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class ModernizationTests(unittest.TestCase):
    def test_current_sdk_only(self):
        for path in [*SKILL.glob("examples/*.py"), *SKILL.glob("scripts/*.py")]:
            self.assertNotIn("google.generativeai", path.read_text(), str(path))

    def test_no_sampling_constants_in_examples(self):
        for path in SKILL.glob("examples/*.py"):
            for parameter in ("temperature", "top_p", "top_k"):
                self.assertNotIn(f'"{parameter}"', path.read_text(), str(path))

    def test_vertex_production_routing(self):
        text = (SKILL / "SKILL.md").read_text()
        self.assertIn("NEVER USE AI STUDIO / THE GEMINI DEVELOPER API FOR PRODUCTION RUNS", text)
        for fact in ("ADC", "GCS", "vertexai=True", "1,307", "2,111", "200,000", "1 GB"):
            self.assertIn(fact, text)
        self.assertIn("Cloud Flex PayGo (Preview)", text)
        self.assertIn("Cloud Priority PayGo", text)
        self.assertIn("X-Vertex-AI-LLM-Shared-Request-Type", text)
        self.assertIn("one synchronous Cloud request", text)
        self.assertIn("not a promise that every batch+search+schema combination works", text)
        self.assertNotIn("ai.google.dev", text)
        gotchas = (SKILL / "references/gotchas.md").read_text()
        for fact in ("0/138", "10/10", "over 40 minutes", "9 rows/hour", "No predefined quota limits"):
            self.assertIn(fact, gotchas)

    def test_retained_measurements_and_guards(self):
        skill = (SKILL / "SKILL.md").read_text()
        self.assertIn("READ EXAMPLES BEFORE WRITING ANY CODE. NO EXCEPTIONS.", skill)
        pdf = (SKILL / "references/files-api.md").read_text()
        for fact in ("send the PDF", "5,519,394", "7,050,563", "21,393", "1,313", "22%"):
            self.assertIn(fact, pdf)
        models = (SKILL / "references/model-selection.md").read_text()
        self.assertIn("Gemini Developer API (not Cloud)", models)
        for fact in ("47%", "62%", "70%", "97.9%", "95.2%", "94.3%", "85.0%", "unresolved"):
            self.assertIn(fact, models)
        flex = (SKILL / "references/flex-inference.md").read_text()
        for fact in ("5–377", "17 searches", "$14/1,000", "5,000", "Cap search effort", "138-row pilot did not finish"):
            self.assertIn(fact, flex)

    def test_reference_python_snippets_compile(self):
        import re

        for path in (SKILL / "references").glob("*.md"):
            blocks = re.findall(r"^```python\n(.*?)^```$", path.read_text(), re.MULTILINE | re.DOTALL)
            for number, block in enumerate(blocks):
                compile(block, f"{path}:block-{number}", "exec")

    def test_cloud_request_has_no_sampling_override(self):
        module = load_example("batch_processor")
        processor = module.GeminiBatchProcessor.__new__(module.GeminiBatchProcessor)
        processor.model = "gemini-3.8-flash"
        request = processor.create_request("gs://bucket/a.pdf", "Extract", "row-1")
        self.assertEqual(request["metadata"]["request_id"], "row-1")
        self.assertEqual(
            request["request"]["generationConfig"],
            {"responseMimeType": "application/json"},
        )
        processor.model = "gemini-3.5-flash-lite"
        self.assertEqual(
            processor.create_request("gs://bucket/a.pdf", "Extract", "r")["request"][
                "generationConfig"
            ],
            {"responseMimeType": "application/json"},
        )

    def test_cloud_submission_uses_instance_client_and_publisher_path(self):
        module = load_example("batch_processor")
        processor = module.GeminiBatchProcessor.__new__(module.GeminiBatchProcessor)
        processor.model = "gemini-3.8-flash"
        processor.bucket_name = "bucket"
        processor.bucket = MagicMock()
        processor.client = MagicMock()
        processor.submit_job("requests.jsonl", "test-job")
        processor.client.batches.create.assert_called_once_with(
            model="publishers/google/models/gemini-3.8-flash",
            src="gs://bucket/batch_requests/test-job.jsonl",
            config={
                "display_name": "test-job",
                "dest": "gs://bucket/batch_outputs/test-job/",
            },
        )

    def test_icon_client_is_reused(self):
        module = load_example("icon_batch_vision")
        fake = MagicMock()
        with patch.object(module.genai, "Client", return_value=fake) as constructor:
            self.assertIs(module.cloud_client("project"), fake)
            self.assertIs(module.cloud_client("project"), fake)
            constructor.assert_called_once_with(
                vertexai=True, project="project", location="global"
            )

    def test_all_runnable_clients_are_vertex(self):
        import ast
        import re

        sources = [(str(p), p.read_text()) for p in SKILL.rglob("*.py")]
        for path in (SKILL / "references").glob("*.md"):
            sources.extend((f"{path}:block-{i}", block) for i, block in enumerate(
                re.findall(r"^```python\n(.*?)^```$", path.read_text(), re.MULTILINE | re.DOTALL)
            ))
        clients = 0
        for name, source in sources:
            for node in ast.walk(ast.parse(source)):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                if (node.func.attr == "Client" and isinstance(node.func.value, ast.Name)
                        and node.func.value.id == "genai"):
                    clients += 1
                    flags = {kw.arg: kw.value for kw in node.keywords}
                    self.assertIn("vertexai", flags, name)
                    self.assertIsInstance(flags["vertexai"], ast.Constant, name)
                    assert isinstance(flags["vertexai"], ast.Constant)
                    self.assertIs(flags["vertexai"].value, True, name)
        self.assertGreater(clients, 0)

    def test_retired_embedding_cli_stops_before_artifacts_or_api(self):
        module = load_example("embeddings_batch")
        with tempfile.TemporaryDirectory() as directory:
            args = types.SimpleNamespace(input="missing.json", out=str(Path(directory) / "job.json"))
            with self.assertRaisesRegex(SystemExit, "Developer embedding batch is disabled"):
                module.submit(args)
            self.assertEqual(list(Path(directory).iterdir()), [])
            with self.assertRaisesRegex(SystemExit, "Developer embedding batch is disabled"):
                module._production_client()

    def test_cloud_parsers_ignore_thoughts_and_reject_truncation(self):
        processor_module = load_example("batch_processor")
        icon_module = load_example("icon_batch_vision")
        processor = processor_module.GeminiBatchProcessor.__new__(processor_module.GeminiBatchProcessor)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            row = {
                "metadata": {"request_id": "row-1"},
                "response": {"candidates": [{
                    "finishReason": "STOP",
                    "content": {"parts": [
                        {"text": "private thought", "thought": True},
                        {"text": '{"value":'}, {"text": "1}"},
                    ]},
                }]},
            }
            path.write_text(json.dumps(row) + "\n")
            result = next(processor.parse_results(str(path)))
            self.assertEqual(result["parsed_data"], {"value": 1})
            self.assertTrue(result["success"])
            self.assertEqual(icon_module.parse_vision_results(str(path))["row-1"]["data"], {"value": 1})
            row["response"]["candidates"][0]["finishReason"] = "MAX_TOKENS"
            path.write_text(json.dumps(row) + "\n")
            self.assertFalse(next(processor.parse_results(str(path)))["success"])
            self.assertFalse(icon_module.parse_vision_results(str(path))["row-1"]["success"])

    def test_cloud_status_errors_and_missing_identity(self):
        processor_module = load_example("batch_processor")
        icon_module = load_example("icon_batch_vision")
        processor = processor_module.GeminiBatchProcessor.__new__(processor_module.GeminiBatchProcessor)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            row = {"metadata": {"request_id": "row-1"}, "status": "Bad Request: INVALID_ARGUMENT", "response": {}}
            path.write_text(json.dumps(row) + "\n")
            result = next(processor.parse_results(str(path)))
            self.assertFalse(result["success"])
            self.assertEqual(result["error"], row["status"])
            self.assertEqual(icon_module.parse_vision_results(str(path))["row-1"]["error"], row["status"])
            row["response"] = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"value":1}'}]}}]}
            path.write_text(json.dumps(row) + "\n")
            self.assertFalse(next(processor.parse_results(str(path)))["success"])
            self.assertFalse(icon_module.parse_vision_results(str(path))["row-1"]["success"])
            del row["metadata"]
            path.write_text(json.dumps(row) + "\n")
            with self.assertRaisesRegex(ValueError, "Missing output request_id"):
                next(processor.parse_results(str(path)))
            with self.assertRaisesRegex(ValueError, "Missing output request_id"):
                icon_module.parse_vision_results(str(path))

    def test_developer_links_are_explicitly_nonproduction(self):
        for path in SKILL.rglob("*.md"):
            for line in path.read_text().splitlines():
                if "ai.google.dev" in line:
                    self.assertIn("Developer API, not for production", line, str(path))

    def test_reference_clients_are_vertex(self):
        import ast
        import re

        for path in [SKILL / "SKILL.md", *(SKILL / "references").glob("*.md")]:
            blocks = re.findall(r"^```python\n(.*?)^```$", path.read_text(), re.MULTILINE | re.DOTALL)
            for block in blocks:
                for call in ast.walk(ast.parse(block)):
                    if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                            and call.func.attr == "Client" and isinstance(call.func.value, ast.Name)
                            and call.func.value.id == "genai"):
                        flags = {keyword.arg: keyword.value for keyword in call.keywords}
                        self.assertIn("vertexai", flags, str(path))
                        self.assertIsInstance(flags["vertexai"], ast.Constant, str(path))
                        assert isinstance(flags["vertexai"], ast.Constant)
                        self.assertIs(flags["vertexai"].value, True, str(path))

    def test_embedding2_omits_task_type(self):
        module = load_example("embeddings_batch")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.jsonl"
            rows = [{"id": "row-1", "text": "Risk Factors"}]
            module._build_jsonl(rows, path, "gemini-embedding-2")
            request = json.loads(path.read_text())["request"]
            self.assertNotIn("task_type", request)
            self.assertEqual(request["content"]["parts"][0]["text"], "Risk Factors")
            module._build_jsonl(rows, path, "gemini-embedding-001")
            self.assertEqual(
                json.loads(path.read_text())["request"]["task_type"],
                "SEMANTIC_SIMILARITY",
            )

    def test_cloud_validator_documented_envelope(self):
        spec = importlib.util.spec_from_file_location("validator", SKILL / "scripts/validate_jsonl.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.jsonl"
            row = {"request": {"contents": [{"parts": [{"fileData": {
                "fileUri": "gs://bucket/a.pdf", "mimeType": "application/pdf",
            }}]}]}}
            path.write_text(json.dumps(row) + "\n")
            self.assertEqual(module.validate_jsonl(str(path)), (True, []))
            path.write_text((json.dumps(row) + "\n") * 2)
            valid, errors = module.validate_jsonl(str(path))
            self.assertFalse(valid)
            self.assertTrue(any("Duplicate" in e for e in errors))
            row["request"]["contents"][0]["parts"][0]["fileData"]["fileUri"] = "files/developer"
            path.write_text(json.dumps(row) + "\n")
            valid, errors = module.validate_jsonl(str(path))
            self.assertFalse(valid)
            self.assertTrue(any("Invalid cloud file URI" in e for e in errors))

    def test_developer_validator_keys_and_files(self):
        spec = importlib.util.spec_from_file_location(
            "validator", SKILL / "scripts/validate_jsonl.py"
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "requests.jsonl"
            row = {
                "key": "r1",
                "request": {
                    "contents": [
                        {
                            "parts": [
                                {
                                    "fileData": {
                                        "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/a",
                                        "mimeType": "application/pdf",
                                    }
                                }
                            ]
                        }
                    ]
                },
            }
            path.write_text(json.dumps(row) + "\n")
            self.assertEqual(
                module.validate_jsonl(str(path), backend="developer"), (True, [])
            )
            path.write_text((json.dumps(row) + "\n") * 2)
            valid, errors = module.validate_jsonl(str(path), backend="developer")
            self.assertFalse(valid)
            self.assertTrue(any("Duplicate" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
