import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
FIX = Path(__file__).resolve().parent / 'fixtures'


import pytest


@pytest.fixture(autouse=True)
def _genai_present(monkeypatch):
    """Tests mock the Gemini client, so the google-genai preflight passes by default; tests of the preflight override it."""
    import classify
    monkeypatch.setattr(classify, 'genai_available', lambda: True)
