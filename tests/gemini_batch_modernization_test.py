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
SKILL = ROOT / "skills/gemini-batch"


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

    def test_tier_routing_and_partial_pilot(self):
        text = (SKILL / "SKILL.md").read_text()
        self.assertIn("## Choose the tier", text)
        for tier in ("Batch", "Flex", "Standard", "Priority"):
            self.assertIn(f"| {tier}", text)
        for measurement in ("0/138", "2/10", "92/138", "8/8"):
            self.assertIn(measurement, text)
        self.assertNotIn("JSON-only format blocks", text)
        self.assertIn("not yet", text)

    def test_retained_measurements_and_guards(self):
        skill = (SKILL / "SKILL.md").read_text()
        self.assertIn("READ EXAMPLES BEFORE WRITING ANY CODE. NO EXCEPTIONS.", skill)
        pdf = (SKILL / "references/files-api.md").read_text()
        for fact in ("send the PDF", "5,519,394", "7,050,563", "21,393", "1,313", "22%"):
            self.assertIn(fact, pdf)
        models = (SKILL / "references/models-and-pricing.md").read_text()
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

    def test_flex_retry_and_grounding_snippets_offline(self):
        import re

        class APIError(Exception):
            def __init__(self, code):
                self.code = code

        genai = types.ModuleType("google.genai")
        fake_client = MagicMock()
        genai.__dict__.update(
            Client=MagicMock(return_value=fake_client),
            errors=types.SimpleNamespace(APIError=APIError),
        )
        blocks = re.findall(
            r"```python\n(.*?)```",
            (SKILL / "references/flex-inference.md").read_text(),
            re.DOTALL,
        )
        env = {}
        with patch.dict(
            sys.modules, {"google": types.ModuleType("google"), "google.genai": genai}
        ):
            exec(blocks[0], env)  # noqa: S102 -- bundled snippet, fake SDK only
            genai.__dict__["Client"].assert_called_once_with(
                http_options={"timeout": 900000}
            )
            fake_client.interactions.create.assert_called_once_with(
                model="gemini-3.8-flash",
                input="Who founded Airbnb? Cite reliable sources.",
                tools=[{"type": "google_search"}],
                service_tier="flex",
            )
            exec(blocks[1], env)  # noqa: S102 -- bundled snippet, fake SDK only
            fake_client.interactions.create.reset_mock()
            fake_client.interactions.create.side_effect = [
                APIError(429),
                APIError(503),
                "ok",
            ]
            with patch("time.sleep"):
                self.assertEqual(env["flex_lookup"]("prompt"), "ok")
            self.assertEqual(fake_client.interactions.create.call_count, 3)
            fake_client.interactions.create.side_effect = APIError(400)
            with self.assertRaises(APIError):
                env["flex_lookup"]("prompt")
            fake_client.interactions.create.side_effect = APIError(503)
            with patch("time.sleep"), self.assertRaises(APIError):
                env["flex_lookup"]("prompt", max_attempts=2)
            citation = types.SimpleNamespace(
                type="url_citation",
                url="https://example.org",
                title="source",
                start_index=0,
                end_index=6,
            )
            text = types.SimpleNamespace(
                type="text", text="answer", annotations=[citation]
            )
            env["interaction"] = types.SimpleNamespace(
                steps=[
                    types.SimpleNamespace(
                        type="google_search_call",
                        arguments=types.SimpleNamespace(queries=["query"]),
                    ),
                    types.SimpleNamespace(type="model_output", content=[text]),
                ]
            )
            exec(blocks[2], env)  # noqa: S102 -- bundled snippet, fake response only
            self.assertTrue(env["grounded_with_citations"])
            self.assertEqual(env["citations"][0]["text"], "answer")

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
