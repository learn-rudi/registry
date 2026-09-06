from pathlib import Path
import runpy


runpy.run_path(
    str(Path(__file__).resolve().parents[3] / "scripts" / "verify-python-stack.py"),
    run_name="__main__",
)
