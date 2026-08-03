import { chromium } from "playwright";
import {
  createGuidanceCheckpointSha256,
  createZoningProviderInputSha256,
  validateProviderReference
} from "./core.mjs";
import {
  assertGuidanceReadyToAdvance,
  waitForProviderRouteToSettle
} from "./guidance-navigation.mjs";
import {
  exportGuidancePdfFromSummary,
  parseSummary,
  parseSummaryHeadings
} from "./summary-export.mjs";
import {
  providerUseLabelMatches,
  providerUseRadioSelector,
  verifyZoningUseBeforeProjectMutation,
  waitForAddressOptions
} from "./zoning-provider-contract.mjs";

export {
  assertGuidanceReadyToAdvance,
  exportGuidancePdfFromSummary,
  parseSummaryHeadings,
  providerUseLabelMatches,
  providerUseRadioSelector,
  verifyZoningUseBeforeProjectMutation,
  waitForAddressOptions,
  waitForProviderRouteToSettle
};

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

export function createPlaywrightOpenCounterDriver({
  artifactStore,
  pageRunner = withPage,
  reconcileZoningStartAction = reconcileExistingZoningStart,
  stateStore
}) {
  if (!stateStore) throw new Error("OpenCounter encrypted state store is required.");
  if (!artifactStore) throw new Error("OpenCounter artifact store is required.");
  return {
    startZoningGuidance: (input) => pageRunner(null, (page, context) =>
      runResumableStart({ context, input, page, stateStore })),
    startGuidance: (input) => pageRunner(null, (page, context) =>
      runResumableStart({ context, input, page, stateStore })),
    reconcileZoningStart: async (input) => {
      const providerReference = validateProviderReference(input.providerReference);
      let resumeState;
      try {
        resumeState = await stateStore.loadForReconciliation(
          providerReference,
          input.providerInputSha256
        );
      } catch (error) {
        if (!isResumeStateFailure(error)) throw error;
        return { providerReference, status: "indeterminate" };
      }
      return pageRunner(
        Promise.resolve(resumeState.storageState),
        (page, context) => runResumableReconciliation({
          action: reconcileZoningStartAction,
          bindingSha256: input.providerInputSha256,
          context,
          input,
          needsBindingMigration: resumeState.needsBindingMigration,
          page,
          stateStore
        })
      );
    },
    continueGuidance: async (input) => {
      const providerReference = validateProviderReference(input.providerReference);
      let session;
      try {
        session = await stateStore.loadSession(providerReference);
      } catch (error) {
        if (!isResumeStateFailure(error)) throw error;
        return { providerReference, status: "indeterminate" };
      }
      const activeCheckpoint = validateContinuationCheckpoint(
        { ...input, providerReference },
        session.guidanceState
      );
      return pageRunner(Promise.resolve(session.storageState), async (page, context) => {
        const result = await continueRun(page, { ...input, activeCheckpoint });
        const completed = result.status === "completed"
          ? {
            ...result,
            providerPdf: await exportGuidancePdfFromSummary(
              page,
              artifactStore,
              { providerReference }
            )
          }
          : result;
        await saveState(
          stateStore,
          context,
          providerReference,
          guidanceStateAfterResult(
            providerReference,
            session.guidanceState,
            completed
          )
        );
        return completed;
      });
    },
    getGuidanceResult: (input) => runWithResumeState({
      action: (page, _context, guidanceState) => readExisting(
        page,
        input.providerReference,
        guidanceState
      ),
      pageRunner,
      providerReference: input.providerReference,
      stateStore
    }),
    reconcileGuidance: (input) => runWithResumeState({
      action: (page, _context, guidanceState) => readExisting(
        page,
        input.providerReference,
        guidanceState
      ),
      pageRunner,
      providerReference: input.providerReference,
      stateStore
    }),
    exportGuidance: (input) => pageRunner(
      stateStore.load(input.providerReference),
      (page) => exportGuidancePdfFromSummary(page, artifactStore, input)
    )
  };
}

async function runWithResumeState({
  action,
  pageRunner,
  providerReference,
  stateStore
}) {
  const validatedReference = validateProviderReference(providerReference);
  let session;
  try {
    session = typeof stateStore.loadSession === "function"
      ? await stateStore.loadSession(validatedReference)
      : {
        guidanceState: null,
        storageState: await stateStore.load(validatedReference)
      };
  } catch (error) {
    if (!isResumeStateFailure(error)) throw error;
    return { providerReference: validatedReference, status: "indeterminate" };
  }
  return pageRunner(
    Promise.resolve(session.storageState),
    (page, context) => action(page, context, session.guidanceState)
  );
}

function isResumeStateFailure(error) {
  return error instanceof Error && new Set([
    "opencounter_resume_state_expired",
    "opencounter_resume_state_invalid",
    "opencounter_resume_state_missing"
  ]).has(error.message);
}

function validateContinuationCheckpoint(input, guidanceState) {
  const activeCheckpoint = guidanceState?.activeCheckpoint;
  if (!activeCheckpoint) throw new Error("opencounter_checkpoint_state_missing");
  const expectedSha256 = createGuidanceCheckpointSha256(
    input.providerReference,
    activeCheckpoint.questions
  );
  if (activeCheckpoint.checkpointSha256 !== expectedSha256) {
    throw new Error("opencounter_checkpoint_state_invalid");
  }
  if (input.checkpointSha256 !== expectedSha256) {
    throw new Error("opencounter_checkpoint_mismatch");
  }
  if (!Array.isArray(input.answers)) {
    throw new Error("opencounter_checkpoint_answers_invalid");
  }
  const questions = new Map(activeCheckpoint.questions.map((question) => [
    question.id,
    question
  ]));
  const answers = new Map();
  for (const answer of input.answers) {
    const question = questions.get(answer.questionId);
    if (!question || answers.has(answer.questionId)) {
      throw new Error("opencounter_checkpoint_answer_unknown");
    }
    if (question.type === "single_select"
      && !question.options.some((option) => option.value === answer.value)) {
      throw new Error("opencounter_checkpoint_answer_invalid");
    }
    answers.set(answer.questionId, answer.value);
  }
  if (activeCheckpoint.questions.some(
    (question) => question.required && !answers.has(question.id)
  )) {
    throw new Error("opencounter_checkpoint_answers_incomplete");
  }
  return activeCheckpoint;
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

async function saveState(
  stateStore,
  context,
  providerReference,
  guidanceState
) {
  const storageState = await context.storageState();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  if (typeof stateStore.rewrite === "function") {
    await stateStore.rewrite(
      providerReference,
      storageState,
      expiresAt,
      guidanceState
    );
    return;
  }
  await stateStore.save(
    providerReference,
    storageState,
    expiresAt,
    null,
    guidanceState
  );
}

function guidanceStateAfterResult(providerReference, current, result) {
  if (!current) throw new Error("opencounter_checkpoint_state_missing");
  if (result.status === "completed") {
    return { ...current, activeCheckpoint: null };
  }
  if (result.status === "needs_requester_input") {
    return {
      ...current,
      activeCheckpoint: {
        checkpointSha256: createGuidanceCheckpointSha256(
          providerReference,
          result.questions
        ),
        questions: structuredClone(result.questions)
      }
    };
  }
  return current;
}

export async function runResumableStart({
  context,
  input,
  now = () => new Date(),
  page,
  startAction = start,
  stateStore
}) {
  let providerReference;
  let guidanceState = {
    activeCheckpoint: null,
    requestedAddress: normalizeAddress(input.address)
  };
  const bindingSha256 = input.catalogEntryId === undefined
    ? null
    : createZoningProviderInputSha256(input);
  const persistCreatedProject = async (value, result = null) => {
    const validated = validateProviderReference(value);
    if (providerReference !== undefined && providerReference !== validated) {
      throw new Error("opencounter_project_reference_changed");
    }
    providerReference = validated;
    if (result?.status === "needs_requester_input") {
      guidanceState = {
        ...guidanceState,
        activeCheckpoint: {
          checkpointSha256: createGuidanceCheckpointSha256(
            validated,
            result.questions
          ),
          questions: structuredClone(result.questions)
        }
      };
    } else if (result?.status === "completed") {
      guidanceState = { ...guidanceState, activeCheckpoint: null };
    }
    await saveStateAt(
      stateStore,
      context,
      validated,
      now,
      bindingSha256,
      guidanceState
    );
  };

  try {
    const result = await startAction(page, input, persistCreatedProject);
    await persistCreatedProject(result.providerReference, result);
    return result;
  } catch (error) {
    if (providerReference === undefined) throw error;
    try {
      await saveStateAt(
        stateStore,
        context,
        providerReference,
        now,
        bindingSha256,
        guidanceState
      );
    } catch {
      // The project reference remains the only safe reconciliation identity.
    }
    const route = providerRouteForReference(page?.url?.(), providerReference);
    return {
      providerReference,
      ...(route === null ? {} : { route }),
      status: "indeterminate"
    };
  }
}

export async function runResumableReconciliation({
  action,
  bindingSha256,
  context,
  input,
  needsBindingMigration,
  now = () => new Date(),
  page,
  stateStore
}) {
  const providerReference = validateProviderReference(input.providerReference);
  let guidanceState = {
    activeCheckpoint: null,
    requestedAddress: normalizeAddress(input.address)
  };
  let projectVerified = false;
  let mutationStarted = false;
  const controls = {
    async onMutationStarted() {
      if (!projectVerified) throw new Error("opencounter_reconciliation_project_unverified");
      mutationStarted = true;
    },
    async onProjectVerified() {
      if (projectVerified) return;
      if (providerRouteForReference(page.url(), providerReference) === null) {
        throw new Error("opencounter_reconciliation_project_mismatch");
      }
      if (needsBindingMigration) {
        await saveStateAt(
          stateStore,
          context,
          providerReference,
          now,
          bindingSha256,
          guidanceState
        );
      }
      projectVerified = true;
    }
  };
  try {
    const result = await action(page, input, controls);
    if (!projectVerified) {
      throw new Error("opencounter_reconciliation_project_unverified");
    }
    guidanceState = guidanceStateAfterResult(
      providerReference,
      guidanceState,
      result
    );
    await saveStateAt(
      stateStore,
      context,
      providerReference,
      now,
      bindingSha256,
      guidanceState
    );
    return result;
  } catch (error) {
    if (!mutationStarted) throw error;
    try {
      await saveStateAt(
        stateStore,
        context,
        providerReference,
        now,
        bindingSha256,
        guidanceState
      );
    } catch {
      // The command owner must treat this one-shot mutation as indeterminate.
    }
    const route = providerRouteForReference(page?.url?.(), providerReference);
    return {
      providerReference,
      ...(route === null ? {} : { route }),
      status: "indeterminate"
    };
  }
}

async function saveStateAt(
  stateStore,
  context,
  providerReference,
  now,
  bindingSha256 = null,
  guidanceState = null
) {
  const instant = now();
  const timestamp = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(timestamp)) throw new Error("opencounter_clock_invalid");
  await stateStore.save(
    providerReference,
    await context.storageState(),
    new Date(timestamp + 24 * 60 * 60 * 1_000).toISOString(),
    bindingSha256,
    guidanceState
  );
}

function providerRouteForReference(value, providerReference) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const projectId = providerReference.split(":").pop();
    if (
      parsed.origin !== ORIGIN
      || !parsed.pathname.startsWith(`/projects/${projectId}/`)
      || parsed.pathname.length > 2_000
    ) {
      return null;
    }
    return parsed.pathname;
  } catch {
    return null;
  }
}

async function start(page, input, onProjectCreated) {
  if (input.catalogEntryId !== undefined) {
    await verifyZoningUseBeforeProjectMutation(page, input);
  }
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle", timeout: 30_000 });
  const profile = ROOT_BUTTONS[input.workflow];
  const portal = page.getByRole("heading", { name: profile.heading, exact: true }).locator("..");
  const startButton = portal.getByRole("button", { name: profile.button, exact: true });
  if (await startButton.count() !== 1) throw new Error("opencounter_ui_drift:start_control");
  await startButton.click();
  await page.waitForURL(/\/projects\/[0-9]+\//, { timeout: 30_000 });
  const providerReference = referenceFromUrl(page.url());
  await onProjectCreated(providerReference);

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
  const useRadio = input.providerUseSlug === undefined
    ? page.locator("label", { hasText: input.proposedUse }).locator("input[type=radio]")
    : page.locator(providerUseRadioSelector(input.providerUseSlug));
  await useRadio.waitFor({ state: "visible", timeout: 15_000 });
  const radioCount = await useRadio.count();
  if (radioCount === 0) throw new Error("provider_ui_changed:use_radio");
  if (radioCount > 1) throw new Error("opencounter_use_ambiguous");
  const useLabel = useRadio.locator("xpath=ancestor::label");
  if (await useLabel.count() !== 1) throw new Error("provider_ui_changed:use_label");
  if (!providerUseLabelMatches(await useLabel.textContent(), input.proposedUse)) {
    throw new Error("provider_ui_changed:use_label");
  }
  await useLabel.click({ force: true });
  if (!(await useRadio.isChecked())) throw new Error("opencounter_ui_drift:use_not_selected");
  await clickUnique(page, "Next");
  await page.waitForURL(/\/guide\/location/, { timeout: 30_000 });

  const addressBox = page.getByRole("combobox");
  await addressBox.waitFor({ state: "visible", timeout: 15_000 });
  if (await addressBox.count() !== 1) throw new Error("opencounter_ui_drift:address");
  await addressBox.fill(input.address);
  await waitForAddressOptions(page, input.address);
  return await readPageState(page, providerReference);
}

async function reconcileExistingZoningStart(page, input, controls) {
  await verifyZoningUseBeforeProjectMutation(page, input);
  const providerReference = validateProviderReference(input.providerReference);
  const projectId = providerReference.split(":").pop();
  const response = await page.goto(
    `${ORIGIN}/projects/${projectId}/guide/business_type`,
    { waitUntil: "networkidle", timeout: 30_000 }
  );
  if (response?.status() === 404) return { status: "not_found" };
  if (response && response.status() >= 400) {
    throw new Error(`opencounter_dependency_failure:${response.status()}`);
  }
  if (page.url().includes("/apply/summary")) {
    await controls.onProjectVerified();
    return parseSummary(page, providerReference);
  }
  if (providerRouteForReference(page.url(), providerReference) === null) {
    throw new Error("opencounter_reconciliation_project_mismatch");
  }
  await controls.onProjectVerified();

  const useBox = page.getByRole("textbox");
  await useBox.waitFor({ state: "visible", timeout: 15_000 });
  if (await useBox.count() !== 1) throw new Error("opencounter_ui_drift:use_textbox");
  await useBox.fill(input.proposedUse);
  const search = page.getByRole("button", { name: "Search", exact: true });
  if (await search.count() !== 1) throw new Error("opencounter_ui_drift:search");
  await search.click();
  const useRadio = page.locator(providerUseRadioSelector(input.providerUseSlug));
  await useRadio.waitFor({ state: "visible", timeout: 15_000 });
  if (await useRadio.count() !== 1) throw new Error("opencounter_use_ambiguous");
  const checkedUse = page.locator("input[type=radio]:checked");
  if (await checkedUse.count() > 0 && !(await useRadio.isChecked())) {
    throw new Error("opencounter_reconciliation_use_conflict");
  }
  const useLabel = useRadio.locator("xpath=ancestor::label");
  if (
    await useLabel.count() !== 1
    || !providerUseLabelMatches(await useLabel.textContent(), input.proposedUse)
  ) {
    throw new Error("provider_ui_changed:use_label");
  }
  if (!(await useRadio.isChecked())) {
    await controls.onMutationStarted();
    await useLabel.click({ force: true });
    if (!(await useRadio.isChecked())) throw new Error("opencounter_ui_drift:use_not_selected");
  }
  await controls.onMutationStarted();
  await clickUnique(page, "Next");
  await page.waitForURL(/\/guide\/location/, { timeout: 30_000 });

  const addressBox = page.getByRole("combobox", { name: "Address", exact: true });
  await addressBox.waitFor({ state: "visible", timeout: 15_000 });
  if (await addressBox.count() !== 1) throw new Error("opencounter_ui_drift:address");
  const existingAddress = (await addressBox.inputValue()).trim();
  if (
    existingAddress !== ""
    && normalizeAddress(existingAddress) !== normalizeAddress(input.address)
  ) {
    throw new Error("opencounter_reconciliation_address_conflict");
  }
  if (existingAddress === "") {
    await controls.onMutationStarted();
    await addressBox.fill(input.address);
  }
  await waitForAddressOptions(page, input.address);
  return readPageState(page, providerReference);
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
      const currentAddress = (await addressBox.inputValue()).trim();
      if (currentAddress !== ""
        && normalizeAddress(currentAddress) !== normalizeAddress(answer.value)) {
        throw new Error("opencounter_address_conflict");
      }
      if (currentAddress === "") {
        await addressBox.fill(answer.value);
        const addressChoice = page.getByText(answer.value, { exact: true });
        await addressChoice.waitFor({ state: "visible", timeout: 15_000 });
        if (await addressChoice.count() !== 1) throw new Error("opencounter_address_not_found");
        await addressChoice.click();
      }
      const confirmAddress = page.getByRole("button", {
        name: "Select this address",
        exact: true
      });
      await page.waitForTimeout(500);
      const confirmCount = await confirmAddress.count();
      if (confirmCount === 1 && await confirmAddress.isVisible()) {
        await confirmAddress.click();
        await confirmAddress.waitFor({ state: "hidden", timeout: 15_000 });
      }
      else if (confirmCount > 1) throw new Error("opencounter_ui_drift:confirm_address");
      continue;
    }
    const radio = page.locator(`input[type="radio"][name="${cssEscape(answer.questionId)}"][value="${cssEscape(answer.value)}"]`);
    const text = page.locator(`input[type="text"][name="${cssEscape(answer.questionId)}"]`);
    if (await radio.count() === 1) {
      if (await radio.isChecked()) continue;
      const conflictingRadio = page.locator(
        `input[type="radio"][name="${cssEscape(answer.questionId)}"]:checked`
      );
      if (await conflictingRadio.count() > 0) {
        throw new Error(`opencounter_answer_conflict:${answer.questionId}`);
      }
      await radio.locator("xpath=ancestor::label").click({ force: true });
      if (!(await radio.isChecked())) {
        throw new Error(`opencounter_answer_not_committed:${answer.questionId}`);
      }
    } else if (await text.count() === 1) {
      const currentValue = (await text.inputValue()).trim();
      if (currentValue === answer.value) continue;
      if (currentValue !== "") {
        throw new Error(`opencounter_answer_conflict:${answer.questionId}`);
      }
      await text.fill(answer.value);
    } else {
      throw new Error(`opencounter_ui_drift:answer:${answer.questionId}`);
    }
  }
  await page.waitForTimeout(250);
  await assertGuidanceReadyToAdvance(page);
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

async function readExisting(page, providerReference, guidanceState = null) {
  const reference = validateProviderReference(providerReference);
  const id = reference.split(":").pop();
  const response = await page.goto(`${ORIGIN}/projects/${id}/apply/summary`, { waitUntil: "networkidle", timeout: 30_000 });
  if (response?.status() === 404) return { status: "not_found" };
  return await readPageState(page, reference, guidanceState);
}

export async function readPageState(
  page,
  providerReference,
  guidanceState = null
) {
  await waitForProviderRouteToSettle(page);
  if (page.url().includes("/apply/summary")) return parseSummary(page, providerReference);
  const fallbackAddressQuestion = guidanceState?.activeCheckpoint?.questions
    ?.find((question) => question.id === "opencounter-address") ?? null;
  const observed = await page.evaluate((checkpointFallback) => {
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
    const addressConfirmationPending = Array.from(document.querySelectorAll("button"))
      .some((button) => button.textContent?.trim() === "Select this address");
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
    } else if (addressConfirmationPending && checkpointFallback !== null) {
      result.unshift(checkpointFallback);
    }
    return {
      addressConfirmationPending,
      questions: result.slice(0, 50)
    };
  }, fallbackAddressQuestion);
  const { addressConfirmationPending, questions } = observed;
  if (addressConfirmationPending
    && !questions.some((question) => question.id === "opencounter-address")) {
    throw new Error("opencounter_address_checkpoint_missing");
  }
  if (questions.length > 0) {
    return { providerReference, questions, status: "needs_requester_input" };
  }
  return {
    providerReference,
    route: new URL(page.url()).pathname,
    status: "indeterminate"
  };
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
function normalizeAddress(value) {
  return value
    .toLowerCase()
    .replace(/\bohio\b/g, "oh")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
