import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from src.core import (
    BrandAssetError,
    build_trace_commands,
    compose_brand_variant,
    inspect_source,
)
from src.validation import validate_brand_asset


ONE_BY_ONE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


class SourceInspectionTest(unittest.TestCase):
    def test_valid_png_reports_dimensions_bytes_and_sha256(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "logo-candidate.png"
            source.write_bytes(ONE_BY_ONE_PNG)

            report = inspect_source(source)

            self.assertEqual(report["format"], "png")
            self.assertEqual(report["width"], 1)
            self.assertEqual(report["height"], 1)
            self.assertEqual(report["bytes"], len(ONE_BY_ONE_PNG))
            self.assertEqual(
                report["sha256"], hashlib.sha256(ONE_BY_ONE_PNG).hexdigest()
            )
            self.assertEqual(source.read_bytes(), ONE_BY_ONE_PNG)


class CompositionTest(unittest.TestCase):
    def test_stacked_variant_keeps_descriptor_live_and_writes_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mark = root / "mark.svg"
            output = root / "stacked.svg"
            mark.write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                '<path d="M0 0h100v100H0z" fill="#000000"/></svg>',
                encoding="utf-8",
            )

            result = compose_brand_variant(
                mark,
                output,
                canonical_label="compact-monogram-b",
                layout="stacked",
                descriptor="Responsible Use of Digital Intelligence",
            )

            svg = output.read_text(encoding="utf-8")
            sidecar = json.loads(Path(result["sidecar_path"]).read_text(encoding="utf-8"))
            self.assertIn("<text", svg)
            self.assertIn("Responsible Use of Digital Intelligence", svg)
            self.assertIn("IBM Plex Mono", svg)
            self.assertEqual(sidecar["canonical_label"], "compact-monogram-b")
            self.assertEqual(validate_brand_asset(output, expected_font_family="IBM Plex Mono")["text_count"], 1)

            with self.assertRaises(BrandAssetError) as context:
                compose_brand_variant(
                    mark,
                    output,
                    canonical_label="compact-monogram-b",
                )
            self.assertEqual(context.exception.error_kind, "write_failed")

    def test_unsafe_svg_is_rejected_before_composition(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mark = root / "unsafe.svg"
            mark.write_text(
                '<svg viewBox="0 0 10 10"><script>alert(1)</script>'
                '<path d="M0 0h1v1z"/></svg>',
                encoding="utf-8",
            )
            with self.assertRaises(BrandAssetError) as context:
                validate_brand_asset(mark)
            self.assertEqual(context.exception.error_kind, "validation")


class TraceContractTest(unittest.TestCase):
    def test_trace_command_uses_argument_arrays_and_explicit_parameters(self) -> None:
        commands = build_trace_commands(
            "/tmp/source.png",
            "/tmp/mask.pbm",
            "/tmp/trace.svg",
            parameters={
                "threshold_percent": 35,
                "turdsize": 3,
                "alphamax": 1.2,
                "opttolerance": 0.1,
            },
        )
        self.assertEqual(commands[0][0], "magick")
        self.assertEqual(commands[1][0], "potrace")
        self.assertIn("35%", commands[0])
        self.assertIn("--output", commands[1])
        self.assertTrue(all(" " not in argument for argument in commands[0][:2]))


if __name__ == "__main__":
    unittest.main()
