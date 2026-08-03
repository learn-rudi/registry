from __future__ import annotations

import asyncio
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from errors import ToolError  # noqa: E402
from midjourney import JsonRequestStore, MidjourneyService  # noqa: E402
from midjourney_references import compose_reference_prompt  # noqa: E402


JOB_ID = "7f86d4ed-d706-448a-9dfa-56be726abad4"
PNG_BYTES = b"\x89PNG\r\n\x1a\nmidjourney-test-image"


class FakeMidjourneyDriver:
    def __init__(self, output_root: Path) -> None:
        self.output_root = output_root
        self.generate_calls: list[dict] = []
        self.export_calls: list[dict] = []
        self.session_calls = 0
        self.login_calls: list[int] = []
        self.generate_error: Exception | None = None
        self.export_error: Exception | None = None

    async def session_status(self) -> dict:
        self.session_calls += 1
        return {"authenticated": True}

    async def login(self, *, timeout_seconds: int) -> dict:
        self.login_calls.append(timeout_seconds)
        return {"authenticated": True}

    async def generate(
        self,
        *,
        prompt: str,
        references: dict,
        timeout_seconds: int,
        show_browser: bool,
    ) -> dict:
        self.generate_calls.append(
            {
                "prompt": prompt,
                "references": references,
                "timeout_seconds": timeout_seconds,
                "show_browser": show_browser,
            }
        )
        if self.generate_error:
            raise self.generate_error
        return {"job_id": JOB_ID}

    async def export_job(
        self,
        *,
        job_id: str,
        indexes: tuple[int, ...],
        timeout_seconds: int,
        show_browser: bool,
    ) -> list[dict]:
        self.export_calls.append(
            {
                "job_id": job_id,
                "indexes": indexes,
                "timeout_seconds": timeout_seconds,
                "show_browser": show_browser,
            }
        )
        if self.export_error:
            raise self.export_error

        export_dir = self.output_root / f"{job_id}-{len(self.export_calls)}"
        export_dir.mkdir(parents=True, exist_ok=False)
        artifacts: list[dict] = []
        for index in indexes:
            path = export_dir / f"variation-{index + 1}.png"
            path.write_bytes(PNG_BYTES)
            artifacts.append(
                {
                    "index": index,
                    "file_name": path.name,
                    "local_path": str(path.resolve()),
                    "media_type": "image/png",
                    "sha256": hashlib.sha256(PNG_BYTES).hexdigest(),
                    "size_bytes": len(PNG_BYTES),
                    "source_url": (
                        f"https://www.midjourney.com/jobs/{job_id}?index={index}"
                    ),
                }
            )
        return artifacts


class MidjourneyServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="midjourney-test-")
        self.root = Path(self.temporary.name).resolve()
        self.output_root = self.root / "outputs"
        self.output_root.mkdir()
        self.store = JsonRequestStore(self.root / "state")
        self.driver = FakeMidjourneyDriver(self.output_root)
        self.service = MidjourneyService(
            driver=self.driver,
            request_store=self.store,
            output_root=self.output_root,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_session_status_and_login_use_exact_input_contracts(self) -> None:
        status = asyncio.run(self.service.session_status({}))
        login = asyncio.run(self.service.login({"timeout_seconds": 90}))

        self.assertTrue(status["ok"])
        self.assertTrue(status["authenticated"])
        self.assertEqual(status["profile_mode"], "dedicated")
        self.assertEqual(login["provider"], "midjourney")
        self.assertEqual(self.driver.login_calls, [90])

        with self.assertRaises(ToolError) as raised:
            asyncio.run(self.service.session_status({"unexpected": True}))
        self.assertEqual(raised.exception.error_kind, "validation")

    def test_generate_exports_four_variations_and_replays_without_resubmission(self) -> None:
        request = {
            "request_id": "test-request-0001",
            "prompt": "A glowing greenhouse in a misty forest.",
            "aspect_ratio": "16:9",
            "timeout_seconds": 75,
        }

        first = asyncio.run(self.service.generate(request))
        replay = asyncio.run(self.service.generate(request))

        self.assertTrue(first["ok"])
        self.assertFalse(first["replayed"])
        self.assertEqual(first["status"], "complete")
        self.assertEqual(first["job_id"], JOB_ID)
        self.assertEqual(len(first["artifacts"]), 4)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["artifacts"], first["artifacts"])
        self.assertEqual(len(self.driver.generate_calls), 1)
        self.assertEqual(len(self.driver.export_calls), 1)
        self.assertEqual(
            self.driver.generate_calls[0]["prompt"],
            "A glowing greenhouse in a misty forest. --ar 16:9",
        )
        self.assertTrue(self.driver.generate_calls[0]["show_browser"])

    def test_generate_appends_validated_image_settings_in_stable_order(self) -> None:
        request = {
            "request_id": "test-request-settings-0001",
            "prompt": "A lunar greenhouse.",
            "aspect_ratio": "3:2",
            "stylization": 250,
            "weirdness": 750,
            "variety": 40,
            "model_version": "8.2",
            "resolution": "hd",
            "raw": True,
            "speed": "relax",
        }

        result = asyncio.run(self.service.generate(request))
        replay = asyncio.run(self.service.generate(request))

        submitted_prompt = (
            "A lunar greenhouse. --ar 3:2 --stylize 250 --weird 750 "
            "--chaos 40 --v 8.2 --hd --raw --relax"
        )
        self.assertEqual(self.driver.generate_calls[0]["prompt"], submitted_prompt)
        self.assertEqual(
            result["prompt_sha256"],
            hashlib.sha256(submitted_prompt.encode("utf-8")).hexdigest(),
        )
        self.assertTrue(replay["replayed"])
        self.assertEqual(len(self.driver.generate_calls), 1)

    def test_generate_validates_and_passes_typed_local_references(self) -> None:
        image_prompt = self.service.reference_input_root / "image-prompt.png"
        style_reference = self.output_root / "style-reference.png"
        omni_reference = self.output_root / "omni-reference.png"
        image_prompt.write_bytes(PNG_BYTES + b"-image")
        style_reference.write_bytes(PNG_BYTES + b"-style")
        omni_reference.write_bytes(PNG_BYTES + b"-omni")

        result = asyncio.run(
            self.service.generate(
                {
                    "request_id": "test-request-references-0001",
                    "prompt": "A fox astronaut in a geometric garden.",
                    "image_prompts": [image_prompt.name],
                    "style_references": [str(style_reference)],
                    "omni_reference": str(omni_reference),
                    "image_weight": 1.5,
                    "style_weight": 300,
                    "omni_weight": 125,
                    "model_version": "7",
                    "speed": "relax",
                }
            )
        )

        references = self.driver.generate_calls[0]["references"]
        self.assertTrue(result["ok"])
        self.assertEqual(len(references["image_prompts"]), 1)
        self.assertEqual(len(references["style_references"]), 1)
        self.assertEqual(references["omni_reference"]["size_bytes"], len(PNG_BYTES + b"-omni"))
        self.assertEqual(references["image_weight"], 1.5)
        self.assertEqual(references["style_weight"], 300)
        self.assertEqual(references["omni_weight"], 125)
        self.assertEqual(
            self.driver.generate_calls[0]["prompt"],
            "A fox astronaut in a geometric garden. --v 7 --relax",
        )
        uploaded_urls = {
            references["image_prompts"][0]["sha256"]: (
                "https://cdn.midjourney.com/11111111-1111-4111-8111-111111111111/image.png?x=1"
            ),
            references["style_references"][0]["sha256"]: (
                "https://cdn.midjourney.com/22222222-2222-4222-8222-222222222222/style.png"
            ),
            references["omni_reference"]["sha256"]: (
                "https://cdn.midjourney.com/33333333-3333-4333-8333-333333333333/omni.png"
            ),
        }
        self.assertEqual(
            compose_reference_prompt(
                self.driver.generate_calls[0]["prompt"],
                references,
                uploaded_urls,
            ),
            "https://cdn.midjourney.com/11111111-1111-4111-8111-111111111111/image.png "
            "A fox astronaut in a geometric garden. --v 7 --relax --iw 1.5 "
            "--sref https://cdn.midjourney.com/22222222-2222-4222-8222-222222222222/style.png "
            "--sw 300 --oref "
            "https://cdn.midjourney.com/33333333-3333-4333-8333-333333333333/omni.png "
            "--ow 125",
        )

    def test_reference_content_change_conflicts_before_replay(self) -> None:
        reference = self.output_root / "changing-reference.png"
        reference.write_bytes(PNG_BYTES + b"-before")
        request = {
            "request_id": "test-reference-change-0001",
            "prompt": "A stable prompt.",
            "image_prompts": [str(reference)],
        }

        asyncio.run(self.service.generate(request))
        reference.write_bytes(PNG_BYTES + b"-after")

        with self.assertRaises(ToolError) as raised:
            asyncio.run(self.service.generate(request))
        self.assertEqual(raised.exception.error_kind, "idempotency_conflict")
        self.assertEqual(len(self.driver.generate_calls), 1)

    def test_generate_rejects_symlink_and_non_image_references(self) -> None:
        valid = self.output_root / "valid-reference.png"
        valid.write_bytes(PNG_BYTES)
        symlink = self.output_root / "linked-reference.png"
        symlink.symlink_to(valid)
        invalid = self.output_root / "not-an-image.png"
        invalid.write_text("not an image", encoding="utf-8")
        oversized = self.output_root / "oversized-reference.png"
        with oversized.open("wb") as file:
            file.write(PNG_BYTES)
            file.truncate(10 * 1024 * 1024 + 1)

        for counter, path in enumerate((symlink, invalid, oversized), start=1):
            with self.subTest(path=path):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(
                        self.service.generate(
                            {
                                "request_id": f"test-reference-file-{counter:04d}",
                                "prompt": "Valid prompt.",
                                "image_prompts": [str(path)],
                            }
                        )
                    )
                self.assertEqual(raised.exception.error_kind, "validation")

    def test_generate_rejects_reference_exfiltration_and_invalid_weights(self) -> None:
        outside = self.root / "outside-reference.png"
        outside.write_bytes(PNG_BYTES)
        inside = self.output_root / "inside-reference.png"
        inside.write_bytes(PNG_BYTES)

        invalid_requests = (
            {
                "request_id": "test-reference-invalid-0001",
                "prompt": "Valid prompt.",
                "image_prompts": [str(outside)],
            },
            {
                "request_id": "test-reference-invalid-0002",
                "prompt": "Valid prompt.",
                "image_prompts": [str(inside)] * 5,
            },
            {
                "request_id": "test-reference-invalid-0003",
                "prompt": "Valid prompt.",
                "image_weight": 1.5,
            },
            {
                "request_id": "test-reference-invalid-0004",
                "prompt": "Valid prompt.",
                "style_references": [str(inside)],
                "style_weight": 1001,
            },
            {
                "request_id": "test-reference-invalid-0005",
                "prompt": "Valid prompt.",
                "omni_reference": str(inside),
                "omni_weight": 0,
            },
        )

        for request in invalid_requests:
            with self.subTest(request=request):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(self.service.generate(request))
                self.assertEqual(raised.exception.error_kind, "validation")

    def test_request_id_conflicts_when_prompt_or_parameters_change(self) -> None:
        request = {
            "request_id": "test-request-0002",
            "prompt": "First prompt.",
        }
        asyncio.run(self.service.generate(request))

        with self.assertRaises(ToolError) as raised:
            asyncio.run(
                self.service.generate(
                    {
                        "request_id": "test-request-0002",
                        "prompt": "Different prompt.",
                    }
                )
            )

        self.assertEqual(raised.exception.error_kind, "idempotency_conflict")
        self.assertEqual(len(self.driver.generate_calls), 1)

        with self.assertRaises(ToolError) as parameter_raised:
            asyncio.run(
                self.service.generate(
                    {
                        "request_id": "test-request-0002",
                        "prompt": "First prompt.",
                        "stylization": 250,
                    }
                )
            )

        self.assertEqual(parameter_raised.exception.error_kind, "idempotency_conflict")
        self.assertEqual(len(self.driver.generate_calls), 1)

    def test_retry_after_unknown_submission_fails_closed(self) -> None:
        request = {
            "request_id": "test-request-0003",
            "prompt": "A prompt whose submission outcome is unknown.",
        }
        self.driver.generate_error = ToolError(
            "timeout",
            "Midjourney did not expose a job id before the timeout.",
        )

        with self.assertRaises(ToolError):
            asyncio.run(self.service.generate(request))

        self.driver.generate_error = None
        with self.assertRaises(ToolError) as raised:
            asyncio.run(self.service.generate(request))

        self.assertEqual(raised.exception.error_kind, "idempotency_in_doubt")
        self.assertEqual(len(self.driver.generate_calls), 1)

    def test_retry_after_export_failure_resumes_from_recorded_job(self) -> None:
        request = {
            "request_id": "test-request-0004",
            "prompt": "A prompt that submits before export fails.",
        }
        self.driver.export_error = ToolError("download_failed", "Download failed.")

        with self.assertRaises(ToolError):
            asyncio.run(self.service.generate(request))

        self.driver.export_error = None
        result = asyncio.run(self.service.generate(request))

        self.assertTrue(result["ok"])
        self.assertTrue(result["replayed"])
        self.assertEqual(result["job_id"], JOB_ID)
        self.assertEqual(len(self.driver.generate_calls), 1)
        self.assertEqual(len(self.driver.export_calls), 2)

    def test_export_job_validates_job_id_indexes_and_artifact_boundary(self) -> None:
        result = asyncio.run(
            self.service.export_job(
                {
                    "job_id": JOB_ID,
                    "indexes": [0, 2],
                    "timeout_seconds": 60,
                    "show_browser": True,
                }
            )
        )

        self.assertTrue(result["ok"])
        self.assertEqual([item["index"] for item in result["artifacts"]], [0, 2])
        self.assertEqual(self.driver.export_calls[0]["indexes"], (0, 2))

        for invalid in (
            {"job_id": "not-a-job"},
            {"job_id": JOB_ID, "indexes": []},
            {"job_id": JOB_ID, "indexes": [4]},
            {"job_id": JOB_ID, "indexes": [0, 0]},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(self.service.export_job(invalid))
                self.assertEqual(raised.exception.error_kind, "validation")

    def test_generate_rejects_invalid_request_id_settings_and_extra_fields(self) -> None:
        invalid_requests = (
            {"request_id": "short", "prompt": "Valid prompt."},
            {
                "request_id": "test-request-0005",
                "prompt": "Valid prompt.",
                "aspect_ratio": "wide",
            },
            {
                "request_id": "test-request-0006",
                "prompt": "Valid prompt.",
                "stylization": 1001,
            },
            {
                "request_id": "test-request-0007",
                "prompt": "Valid prompt.",
                "weirdness": -1,
            },
            {
                "request_id": "test-request-0008",
                "prompt": "Valid prompt.",
                "variety": True,
            },
            {
                "request_id": "test-request-0009",
                "prompt": "Valid prompt.",
                "model_version": "8.2 --raw",
            },
            {
                "request_id": "test-request-0010",
                "prompt": "Valid prompt.",
                "resolution": "4k",
            },
            {
                "request_id": "test-request-0011",
                "prompt": "Valid prompt.",
                "raw": "yes",
            },
            {
                "request_id": "test-request-0012",
                "prompt": "Valid prompt.",
                "speed": "instant",
            },
            {
                "request_id": "test-request-0013",
                "prompt": "Valid prompt. --stylize 100",
                "stylization": 250,
            },
            {
                "request_id": "test-request-0014",
                "prompt": "Valid prompt.",
                "extra": True,
            },
        )

        for request in invalid_requests:
            with self.subTest(request=request):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(self.service.generate(request))
                self.assertEqual(raised.exception.error_kind, "validation")

    def test_artifacts_outside_output_root_fail_closed(self) -> None:
        outside = self.root / "outside.png"
        outside.write_bytes(PNG_BYTES)

        async def outside_export(**_kwargs) -> list[dict]:
            return [
                {
                    "index": 0,
                    "file_name": outside.name,
                    "local_path": str(outside),
                    "media_type": "image/png",
                    "sha256": hashlib.sha256(PNG_BYTES).hexdigest(),
                    "size_bytes": len(PNG_BYTES),
                    "source_url": (
                        f"https://www.midjourney.com/jobs/{JOB_ID}?index=0"
                    ),
                }
            ]

        self.driver.export_job = outside_export  # type: ignore[method-assign]

        with self.assertRaises(ToolError) as raised:
            asyncio.run(self.service.export_job({"job_id": JOB_ID, "indexes": [0]}))

        self.assertEqual(raised.exception.error_kind, "download_failed")


if __name__ == "__main__":
    unittest.main()
