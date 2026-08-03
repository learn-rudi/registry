#!/usr/bin/env python3
"""Deterministic offline verification entrypoint for the Speech Generator stack."""

from __future__ import annotations

import subprocess
import sys


def main() -> int:
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests",
            "-p",
            "test_*.py",
        ],
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
