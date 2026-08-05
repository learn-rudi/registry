import { validateProviderReference } from "./core.mjs";

const ORIGIN = "https://opencounter.cincinnati-oh.gov";

export async function exportGuidancePdfFromSummary(page, artifactStore, input) {
  const providerReference = validateProviderReference(input?.providerReference);
  if (!artifactStore || typeof artifactStore.persistPdf !== "function") {
    throw new Error("OpenCounter artifact store is invalid.");
  }
  const projectId = providerReference.split(":").pop();
  const sourceUrl = `${ORIGIN}/projects/${projectId}/apply/summary`;
  if (typeof page.url !== "function" || page.url() !== sourceUrl) {
    const response = await page.goto(sourceUrl, {
      waitUntil: "networkidle",
      timeout: 30_000
    });
    if (response?.status() === 404) return { status: "not_found" };
    if (response && response.status() >= 400) {
      throw new Error(`opencounter_dependency_failure:${response.status()}`);
    }
  }

  await dismissSkipSaveModal(page);

  const downloadButton = page.getByRole("button", { name: "Download PDF", exact: true });
  if (await downloadButton.count() !== 1
    || !(await downloadButton.isVisible())
    || !(await downloadButton.isEnabled())
    || await downloadButton.getAttribute("data-download-pdf-button") !== "true") {
    throw new Error("opencounter_ui_drift:download_pdf");
  }
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35_000 }),
    downloadButton.click()
  ]);
  const downloadFailure = await download.failure();
  if (downloadFailure) throw new Error("opencounter_download_failed");
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("opencounter_download_path_missing");
  const artifact = await artifactStore.persistPdf({ downloadPath, providerReference });
  return { artifact, providerReference, sourceUrl, status: "exported" };
}

export async function parseSummary(page, providerReference) {
  await dismissSkipSaveModal(page);
  const summaryHeadings = page.locator("main h1, main h2, main h3, main h4");
  await summaryHeadings.first()
    .waitFor({ state: "attached", timeout: 15_000 });
  if (!hasZoningSummaryHeadings(await summaryHeadings.allTextContents())) {
    throw new Error("opencounter_ui_drift:summary_headings");
  }
  const sourceUrl = page.url();
  const observed = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("main h1, main h2, main h3, main h4"))
      .map((element) => element.textContent?.trim()).filter(Boolean).slice(0, 100);
    const locationHeading = Array.from(document.querySelectorAll("main *"))
      .map((element) => element.textContent?.trim())
      .find((text) => /^\d+.+Cincinnati, Ohio \d{5}$/.test(text || "")) || null;
    return { headings, locationHeading };
  });
  const result = parseSummaryHeadings(observed.headings, observed.locationHeading);
  return { providerReference, result: { ...result, sourceUrl }, status: "completed" };
}

export async function dismissSkipSaveModal(page) {
  const skipSaveModal = page.getByRole("button", {
    name: "Skip for now",
    exact: true
  });
  const skipCount = await skipSaveModal.count();
  if (skipCount > 1) throw new Error("opencounter_ui_drift:skip_save_modal");
  if (skipCount === 1 && await skipSaveModal.isVisible()) {
    await skipSaveModal.click();
    await skipSaveModal.waitFor({ state: "hidden", timeout: 15_000 });
  }
}

export function hasZoningSummaryHeadings(headings) {
  if (!Array.isArray(headings)) return false;
  const normalized = new Set(headings
    .filter((heading) => typeof heading === "string")
    .map((heading) => heading.trim().toLowerCase()));
  return ["location", "zoning district", "land use code"]
    .every((heading) => normalized.has(heading));
}

export function parseSummaryHeadings(headings, locationHeading) {
  const resultHeading = headings.find((text) => /Your project is /i.test(text)) || null;
  const parcelHeading = headings.find((text) => /^Parcel ID:/i.test(text)) || null;
  const zoningHeadingIndex = headings.findIndex((text) => /^Zoning District$/i.test(text));
  const zoningDistrict = zoningHeadingIndex >= 0
    ? headings[zoningHeadingIndex + 1] ?? null
    : null;
  const landUseHeadingIndex = headings.findIndex((text) => /^Land Use Code$/i.test(text));
  const landUseCode = landUseHeadingIndex >= 0
    ? headings[landUseHeadingIndex + 1] ?? null
    : null;
  return {
    address: locationHeading,
    classification: resultHeading
      ?.replace(/^Unfortunately,\s*/i, "")
      .replace(/^Your project is\s+/i, "")
      .replace(/\s+at this location\.$/i, "") || null,
    disclaimer: "Information is subject to final approval by City staff.",
    evaluationScope: "selected_opencounter_land_use",
    landUseCode,
    parcelId: parcelHeading?.replace(/^Parcel ID:\s*/i, "") || null,
    summaryHeadings: headings,
    zoningDistrict
  };
}
