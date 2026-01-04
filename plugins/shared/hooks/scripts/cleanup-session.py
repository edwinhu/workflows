#!/usr/bin/env python3
"""Stop hook: Clean up session-specific files when Claude session ends."""
import sys
import os

# Add scripts dir to path for session module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import cleanup_session

cleanup_session()
