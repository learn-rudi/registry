import { chromium } from "playwright";
import { validateProviderReference } from "./core.mjs";

const ORIGIN = "https://opencounter.cincinnati-oh.gov";
const CHROMIUM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/151.0.0.0 Safari/537.36";
const ROOT_BUTTONS = {
  business: { heading: "Business Portal", button: "Calculate my permits" },
  residential: { heading: "Residential Portal", button: "Calculate my permits" },
  special_events: { heading: "Special Events Portal", button: "Plan my event" },
  zoning: { heading: "Zoning Portal", button: "Check my zoning" }
};

export function createPlaywrightOpenCounterDriver({ stateStore }) {
  if (!stateStore) throw new Error("OpenCounter encrypted state store is required.");
  return {
    startGuidance: (input) => withPage(null, async (page, context) => {
      const result = await start(page, input);
      await saveState(stateStore, context, result.providerReference);
      return result;
    }),
    continueGuidance: (input) => withPage(
      stateStore.load(input.providerReference),
      async (page, context) => {
        const result = await continueRun(page, input);
        await saveState(stateStore, context, input.providerReference);
        return result;
      }
    ),
    getGuidanceResult: (input) => withPage(
      stateStore.load(input.providerReference),
      (page) => readExisting(page, input.providerReference)
    ),
    reconcileGuidance: (input) => withPage(
      stateStore.load(input.providerReference),
      (page) => readExisting(page, input.providerReference)
    )
  };
}

async function withPage(storageStatePromise, action) {
  const browser = await chromium.launch({ headless: true });
  try {
    const storageState = storageStatePromise
      ? await storageStatePromise
      : undefined;
    const context = await browser.newContext({
      locale: "en-US",
      userAgent: CHROMIUM_USER_AGENT,
      ...(storageState ? { storageState } : {})
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    return await action(page, context);
  } finally {
    await browser.close();
  }
}

async function saveState(stateStore, context, providerReference) {
  await stateStore.save(
    providerReference,
    await context.storageState(),
    new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
  );
}

async function start(page, input) {
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle", timeout: 30_000 });
  const profile = ROOT_BUTTONS[input.workflow];
  const portal = page.getByRole("heading", { name: profile.heading, exact: true }).locator("..");
  const startButton = portal.getByRole("button", { name: profile.button, exact: true });
  if (await startButton.count() !== 1) throw new Error("opencounter_ui_drift:start_control");
  await startButton.click();
  await page.waitForURL(/\/projects\/[0-9]+\//, { timeout: 30_000 });
  const providerReference = referenceFromUrl(page.url());

  if (input.workflow !== "zoning") {
    return await readPageState(page, providerReference);
  }

  const useBox = page.getByRole("textbox");
  await useBox.waitFor({ state: "visible", timeout: 15_000 });
  if (await useBox.count() !== 1) throw new Error("opencounter_ui_drift:use_textbox");
  await useBox.fill(input.proposedUse);
  const search = page.getByRole("button", { name: "Search", exact: true });
  if (await search.count() !== 1) throw new Error("opencounter_ui_drift:search");
  await search.click();
  const useChoice = page.getByText(input.proposedUse, { exact: true });
  await useChoice.waitFor({ state: "visible", timeout: 15_000 });
  if (await useChoice.count() !== 1) throw new Error("opencounter_use_not_found");
  const useLabel = page.locator("label", { hasText: input.proposedUse });
  const useRadio = useLabel.locator("input[type=radio]");
  if (await useRadio.count() !== 1) throw new Error("opencounter_ui_drift:use_radio");
  await useLabel.click({ force: true });
  if (!(await useRadio.isChecked())) throw new Error("opencounter_ui_drift:use_not_selected");
  await clickUnique(page, "Next");
  await page.waitForURL(/\/guide\/location/, { timeout: 30_000 });

  const addressBox = page.getByRole("combobox");
  await addressBox.waitFor({ state: "visible", timeout: 15_000 });
  if (await addressBox.count() !== 1) throw new Error("opencounter_ui_drift:address");
  await addressBox.fill(input.address);
  await page.waitForFunction(() => (
    new Set(Array.from(document.querySelectorAll("input[type=radio]"))
      .map((input) => input.getAttribute("name"))).size >= 8
  ), undefined, { timeout: 15_000 });
  await page.waitForFunction((street) => (
    Array.from(document.querySelectorAll("main *"))
      .some((element) => element.children.length === 0
        && element.textContent?.trim().startsWith(`${street},`)
        && element.textContent.includes("Cincinnati, Ohio"))
  ), input.address.split(",")[0].trim(), { timeout: 15_000 });
  return await readPageState(page, providerReference);
}

async function continueRun(page, input) {
  const providerReference = validateProviderReference(input.providerReference);
  const id = providerReference.split(":").pop();
  await page.goto(`${ORIGIN}/projects/${id}/guide/location`, { waitUntil: "networkidle", timeout: 30_000 });
  if (page.url().includes("/apply/summary")) return parseSummary(page, providerReference);
  for (const answer of input.answers) {
    if (answer.questionId === "opencounter-address") {
      const addressBox = page.getByRole("combobox", { name: "Address", exact: true });
      if (await addressBox.count() !== 1) throw new Error("opencounter_ui_drift:address");
      await addressBox.fill(answer.value);
      const addressChoice = page.getByText(answer.value, { exact: true });
      await addressChoice.waitFor({ state: "visible", timeout: 15_000 });
      if (await addressChoice.count() !== 1) throw new Error("opencounter_address_not_found");
      await addressChoice.click();
      const confirmAddress = page.getByRole("button", {
        name: "Select this address",
        exact: true
      });
      await page.waitForTimeout(500);
      const confirmCount = await confirmAddress.count();
      if (confirmCount === 1) await confirmAddress.click();
      else if (confirmCount > 1) throw new Error("opencounter_ui_drift:confirm_address");
      continue;
    }
    const radio = page.locator(`input[type="radio"][name="${cssEscape(answer.questionId)}"][value="${cssEscape(answer.value)}"]`);
    const text = page.locator(`input[type="text"][name="${cssEscape(answer.questionId)}"]`);
    if (await radio.count() === 1) await radio.locator("xpath=ancestor::label").click({ force: true });
    else if (await text.count() === 1) await text.fill(answer.value);
    else throw new Error(`opencounter_ui_drift:answer:${answer.questionId}`);
  }
  const pendingAddressConfirmation = page.getByRole("button", {
    name: "Select this address",
    exact: true
  });
  if (await pendingAddressConfirmation.count() === 1) {
    await pendingAddressConfirmation.click();
  }
  await page.waitForTimeout(250);
  await clickUnique(page, "Next");
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/apply/summary")) {
    return parseSummary(page, providerReference);
  }
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (await skip.count() === 1) {
    const priorUrl = page.url();
    await skip.click({ noWaitAfter: true });
    await page.waitForURL(
      (url) => url.toString() !== priorUrl,
      { timeout: 30_000 }
    );
  }
  await page.waitForLoadState("networkidle");
  return await readPageState(page, providerReference);
}

async function readExisting(page, providerReference) {
  const reference = validateProviderReference(providerReference);
  const id = reference.split(":").pop();
  const response = await page.goto(`${ORIGIN}/projects/${id}/guide/location`, { waitUntil: "networkidle", timeout: 30_000 });
  if (response?.status() === 404) return { status: "not_found" };
  return await readPageState(page, reference);
}

async function readPageState(page, providerReference) {
  await waitForProviderRouteToSettle(page);
  if (page.url().includes("/apply/summary")) return parseSummary(page, providerReference);
  const questions = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("input[type=radio], input[type=text], textarea, select"));
    const groups = new Map();
    for (const control of controls) {
      const name = control.getAttribute("name") || control.getAttribute("id");
      if (!name || /address|search/i.test(name)) continue;
      const fieldset = control.closest("[data-field-name]") || control.closest("fieldset") || control.parentElement?.parentElement;
      const prompt = fieldset?.getAttribute?.("data-field-name")
        || fieldset?.querySelector("legend")?.textContent?.trim()
        || fieldset?.querySelector("label")?.textContent?.trim()
        || control.getAttribute("aria-label") || name;
      const current = groups.get(name) || { id: name, prompt, required: control.type === "radio" || control.required, type: control.type === "radio" ? "single_select" : "text", options: [] };
      current.required = current.required || control.type === "radio" || control.required;
      if (control.type === "radio") {
        const label = document.querySelector(`label[for="${control.id}"]`)?.textContent?.trim() || control.value;
        current.options.push({ label, value: control.value });
      }
      groups.set(name, current);
    }
    const address = document.querySelector('input[role="combobox"][aria-label="Address"]');
    const street = address?.value?.split(",")[0]?.trim();
    const addressOptions = street
      ? Array.from(document.querySelectorAll("main *"))
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim())
        .filter((text) => text && text.startsWith(`${street},`) && text.includes("Cincinnati, Ohio"))
        .filter((text, index, values) => values.indexOf(text) === index)
        .slice(0, 20)
      : [];
    const result = Array.from(groups.values())
      .filter((question) => question.type === "text" || question.options.length >= 2);
    if (addressOptions.length > 0) {
      result.unshift({
        id: "opencounter-address",
        options: addressOptions.map((value) => ({ label: value, value })),
        prompt: "Which OpenCounter address match is the intended location?",
        required: true,
        type: "single_select"
      });
    }
    return result.slice(0, 50);
  });
  if (questions.length > 0) {
    return { providerReference, questions, status: "needs_requester_input" };
  }
  return {
    providerReference,
    route: new URL(page.url()).pathname,
    status: "indeterminate"
  };
}

export async function waitForProviderRouteToSettle(page) {
  let latestUrl = page.url();
  let stableSamples = 0;
  for (let sample = 0; sample < 20; sample += 1) {
    await page.waitForTimeout(100);
    const currentUrl = page.url();
    if (currentUrl.includes("/apply/summary")) return currentUrl;
    if (currentUrl === latestUrl) stableSamples += 1;
    else stableSamples = 0;
    latestUrl = currentUrl;
    if (sample >= 9 && stableSamples >= 3) return latestUrl;
  }
  return latestUrl;
}

async function parseSummary(page, providerReference) {
  await page.locator("main h1").waitFor({ state: "visible", timeout: 15_000 });
  const sourceUrl = page.url();
  const result = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("main h1, main h2, main h3, main h4"))
      .map((element) => element.textContent?.trim()).filter(Boolean).slice(0, 100);
    const resultHeading = headings.find((text) => /Your project is /i.test(text)) || null;
    const parcelHeading = headings.find((text) => /^Parcel ID:/i.test(text)) || null;
    const districtHeading = headings.find((text) => /District/i.test(text) && !/^Zoning District$/i.test(text)) || null;
    const locationHeading = Array.from(document.querySelectorAll("main *"))
      .map((element) => element.textContent?.trim())
      .find((text) => /^\d+.+Cincinnati, Ohio \d{5}$/.test(text || "")) || null;
    return {
      address: locationHeading,
      classification: resultHeading?.replace(/^Your project is\s+/i, "").replace(/\s+at this location\.$/i, "") || null,
      disclaimer: "Information is subject to final approval by City staff.",
      parcelId: parcelHeading?.replace(/^Parcel ID:\s*/i, "") || null,
      summaryHeadings: headings,
      zoningDistrict: districtHeading
    };
  });
  return { providerReference, result: { ...result, sourceUrl }, status: "completed" };
}

async function clickUnique(page, name) {
  const button = name === "Next"
    ? page.locator("button[data-save-button=true]")
    : page.getByRole("button", { name, exact: true });
  await button.waitFor({ state: "visible", timeout: 15_000 });
  if (name === "Next") {
    await page.locator("button[data-save-button=true]:not([disabled])")
      .waitFor({ state: "visible", timeout: 15_000 });
  }
  if (await button.count() !== 1) throw new Error(`opencounter_ui_drift:${name}`);
  if (name === "Next") {
    const priorUrl = page.url();
    await button.click({ noWaitAfter: true });
    await page.waitForURL(
      (url) => url.toString() !== priorUrl,
      { timeout: 30_000 }
    );
    return;
  }
  await button.click();
}

function referenceFromUrl(url) {
  const match = /\/projects\/([0-9]+)/.exec(url);
  if (!match) throw new Error("opencounter_project_reference_missing");
  return `opencounter:project:${match[1]}`;
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}
