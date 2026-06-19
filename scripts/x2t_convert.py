#!/usr/bin/env python3
"""Deprecated shim — renamed to ``doc_render`` (now multi-backend: Word /
LibreOffice / x2t). Import from ``doc_render`` instead. Kept so existing
``from x2t_convert import convert`` callers and CLI paths keep working.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doc_render import *  # noqa: F401,F403,E402
from doc_render import convert, recalc_xlsx, main  # noqa: F401,E402

if __name__ == "__main__":
    main()
