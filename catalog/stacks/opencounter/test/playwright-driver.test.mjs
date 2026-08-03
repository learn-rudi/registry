import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import {
  assertGuidanceReadyToAdvance,
  createPlaywrightOpenCounterDriver,
  readPageState,
  runResumableReconciliation,
  runResumableStart,
  waitForAddressOptions
} from "../src/playwright-driver.mjs";

test("recognizes provider address suggestions without waiting for radio controls", async () => {
  let waits = 0;
  const page = {
    async waitForFunction(predicate, street, options) {
      waits += 1;
      assert.equal(street, "880 Ridgeway Avenue");
      assert.deepEqual(options, { timeout: 15_000 });
      const priorDocument = globalThis.document;
      globalThis.document = {
        querySelectorAll(selector) {
          assert.equal(selector, "main *");
          return [{
            children: { length: 0 },
            textContent: "880 Ridgeway Avenue, Cincinnati, Ohio 45229"
          }];
        }
      };
      try {
        assert.equal(predicate(street), true);
      } finally {
        if (priorDocument === undefined) delete globalThis.document;
        else globalThis.document = priorDocument;
      }
    }
  };

  await waitForAddressOptions(
    page,
    "880 Ridgeway Avenue, Cincinnati, OH 45229"
  );

  assert.equal(waits, 1);
});

test("restores the exact address checkpoint when the resumed address box is blank", async () => {
  const providerReference = "opencounter:project:2819848";
  const addressQuestion = {
    id: "opencounter-address",
    options: [{
      label: "4818 Stewart Avenue, Cincinnati, Ohio 45227",
      value: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  };
  const page = {
    async evaluate(callback, checkpointFallback) {
      const priorDocument = globalThis.document;
      globalThis.document = {
        querySelector(selector) {
          if (selector === 'input[role="combobox"][aria-label="Address"]') {
            return { value: "" };
          }
          return null;
        },
        querySelectorAll(selector) {
          if (selector === "input[type=radio], input[type=text], textarea, select") {
            return [];
          }
          if (selector === "button") {
            return [{ textContent: "Select this address" }];
          }
          if (selector === "main *") return [];
          return [];
        }
      };
      try {
        return callback(checkpointFallback);
      } finally {
        if (priorDocument === undefined) delete globalThis.document;
        else globalThis.document = priorDocument;
      }
    },
    async waitForTimeout() {},
    url() {
      return "https://opencounter.cincinnati-oh.gov/projects/2819848/guide/location";
    }
  };

  assert.deepEqual(await readPageState(page, providerReference, {
    activeCheckpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(
        providerReference,
        [addressQuestion]
      ),
      questions: [addressQuestion]
    },
    requestedAddress: "4818 stewart avenue cincinnati oh 45227"
  }), {
    providerReference,
    questions: [addressQuestion],
    status: "needs_requester_input"
  });
});

test("reports a pending exact-address confirmation before waiting on disabled Next", async () => {
  let nextInspections = 0;
  const page = {
    getByRole(role, options) {
      assert.equal(role, "button");
      assert.deepEqual(options, {
        exact: true,
        name: "Select this address"
      });
      return {
        async count() { return 1; },
        async isVisible() { return true; }
      };
    },
    locator() {
      nextInspections += 1;
      throw new Error("Next must not be inspected while address confirmation is pending");
    }
  };

  await assert.rejects(
    assertGuidanceReadyToAdvance(page),
    /opencounter_address_confirmation_pending/
  );
  assert.equal(nextInspections, 0);
});

test("waits for asynchronous provider saves before declaring Next blocked", async () => {
  let providerSaveSettled = false;
  const page = {
    getByRole() {
      return {
        async count() { return 0; },
        async isVisible() { return false; }
      };
    },
    locator(selector) {
      if (selector === "button[data-save-button=true]") {
        return {
          async count() { return 1; },
          async isEnabled() { return providerSaveSettled; },
          async isVisible() { return true; }
        };
      }
      if (selector === "button[data-save-button=true]:not([disabled])") {
        return {
          async waitFor(options) {
            assert.deepEqual(options, { state: "visible", timeout: 15_000 });
            providerSaveSettled = true;
          }
        };
      }
      throw new Error(`unexpected locator: ${selector}`);
    }
  };

  await assertGuidanceReadyToAdvance(page);
  assert.equal(providerSaveSettled, true);
});

test("returns bounded indeterminate evidence when anonymous resume state is missing", async () => {
  let pageRuns = 0;
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {},
    pageRunner: async () => {
      pageRuns += 1;
      throw new Error("page runner must not start without resumable state");
    },
    stateStore: {
      async load() {
        throw new Error("opencounter_resume_state_missing");
      }
    }
  });

  assert.deepEqual(await driver.getGuidanceResult({
    providerReference: "opencounter:project:2818724"
  }), {
    providerReference: "opencounter:project:2818724",
    status: "indeterminate"
  });
  assert.equal(pageRuns, 0);
});

test("result reads use encrypted guidance state to preserve a pending address", async () => {
  const providerReference = "opencounter:project:2819848";
  const addressQuestion = {
    id: "opencounter-address",
    options: [{
      label: "4818 Stewart Avenue, Cincinnati, Ohio 45227",
      value: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  };
  const page = {
    async evaluate(callback, checkpointFallback) {
      const priorDocument = globalThis.document;
      globalThis.document = {
        querySelector(selector) {
          return selector === 'input[role="combobox"][aria-label="Address"]'
            ? { value: "" }
            : null;
        },
        querySelectorAll(selector) {
          if (selector === "button") {
            return [{ textContent: "Select this address" }];
          }
          return [];
        }
      };
      try {
        return callback(checkpointFallback);
      } finally {
        if (priorDocument === undefined) delete globalThis.document;
        else globalThis.document = priorDocument;
      }
    },
    async goto() { return { status: () => 200 }; },
    async waitForTimeout() {},
    url() {
      return "https://opencounter.cincinnati-oh.gov/projects/2819848/guide/location";
    }
  };
  const guidanceState = {
    activeCheckpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(
        providerReference,
        [addressQuestion]
      ),
      questions: [addressQuestion]
    },
    requestedAddress: "4818 stewart avenue cincinnati oh 45227"
  };
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {},
    pageRunner: async (storageStatePromise, action) => {
      assert.deepEqual(await storageStatePromise, { cookies: [] });
      return action(page, {});
    },
    stateStore: {
      async load() {
        throw new Error("storage-only load must not discard guidance state");
      },
      async loadSession() {
        return { guidanceState, storageState: { cookies: [] } };
      }
    }
  });

  assert.deepEqual(await driver.getGuidanceResult({ providerReference }), {
    providerReference,
    questions: [addressQuestion],
    status: "needs_requester_input"
  });
});

test("result reads check the authoritative summary route before location state", async () => {
  const providerReference = "opencounter:project:2819953";
  let currentUrl = "about:blank";
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {},
    pageRunner: async (storageStatePromise, action) => {
      await storageStatePromise;
      return action({
        async evaluate() {
          return {
            headings: [
              "Unfortunately, your project is Prohibited at this location.",
              "Zoning District",
              "T3 Neighborhood (T3N)",
              "Land Use Code",
              "Multi-family dwelling"
            ],
            locationHeading: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
          };
        },
        async goto(url) {
          assert.equal(
            url,
            "https://opencounter.cincinnati-oh.gov/projects/2819953/apply/summary"
          );
          currentUrl = url;
          return { status: () => 200 };
        },
        locator(selector) {
          assert.equal(selector, "main h1");
          return { async waitFor() {} };
        },
        async waitForTimeout() {},
        url() { return currentUrl; }
      }, {});
    },
    stateStore: {
      async loadSession() {
        return {
          guidanceState: {
            activeCheckpoint: null,
            requestedAddress: "4818 stewart avenue cincinnati oh 45227"
          },
          storageState: { cookies: [] }
        };
      }
    }
  });

  const result = await driver.getGuidanceResult({ providerReference });
  assert.equal(result.status, "completed");
  assert.equal(result.result.landUseCode, "Multi-family dwelling");
});

test("rejects a stale continuation checkpoint before launching a browser", async () => {
  let pageRuns = 0;
  const providerReference = "opencounter:project:2819848";
  const questions = [{
    id: "residential-question",
    options: [
      { label: "Yes", value: "true" },
      { label: "No", value: "false" }
    ],
    prompt: "Is this an existing residential unit?",
    required: true,
    type: "single_select"
  }];
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {},
    pageRunner: async () => {
      pageRuns += 1;
      throw new Error("page runner must not start for a stale checkpoint");
    },
    stateStore: {
      async load() {
        throw new Error("legacy storage-only load must not authorize continuation");
      },
      async loadSession() {
        return {
          guidanceState: {
            activeCheckpoint: {
              checkpointSha256: createGuidanceCheckpointSha256(
                providerReference,
                questions
              ),
              questions
            },
            requestedAddress: "4818 stewart avenue cincinnati oh"
          },
          storageState: { cookies: [] }
        };
      }
    }
  });

  await assert.rejects(
    driver.continueGuidance({
      answers: [{ questionId: "residential-question", value: "false" }],
      checkpointSha256: "b".repeat(64),
      providerReference
    }),
    /opencounter_checkpoint_mismatch/
  );
  assert.equal(pageRuns, 0);
});

test("does not replay an already-checked provider answer during continuation", async () => {
  const providerReference = "opencounter:project:2819848";
  const selectedAddress = "4818 Stewart Avenue, Cincinnati, Ohio 45227";
  const sha256 = "e".repeat(64);
  const artifact = {
    artifactRef: `rudi-artifact:opencounter:${sha256}`,
    fileName: `opencounter-project-2819848-${sha256}.pdf`,
    localPath: `/tmp/opencounter-project-2819848-${sha256}.pdf`,
    mediaType: "application/pdf",
    sha256,
    sizeBytes: 384_297
  };
  const questions = [
    {
      id: "opencounter-address",
      options: [{ label: selectedAddress, value: selectedAddress }],
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    },
    {
      id: "residential-question",
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" }
      ],
      prompt: "Is this an existing residential unit?",
      required: true,
      type: "single_select"
    }
  ];
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  let labelClicks = 0;
  let nextClicks = 0;
  let summaryReloads = 0;
  let addressFills = 0;
  let addressConfirmationClicks = 0;
  let currentUrl = "https://opencounter.cincinnati-oh.gov/projects/2819848/guide/location";
  const zeroCount = { async count() { return 0; } };
  const addressBox = {
    async count() { return 1; },
    async fill() { addressFills += 1; },
    async inputValue() { return selectedAddress; }
  };
  const confirmAddress = {
    async click() { addressConfirmationClicks += 1; },
    async count() { return 1; },
    async isVisible() { return false; }
  };
  const downloadButton = {
    async click() {},
    async count() { return 1; },
    async getAttribute(name) {
      assert.equal(name, "data-download-pdf-button");
      return "true";
    },
    async isEnabled() { return true; },
    async isVisible() { return true; }
  };
  const nextButton = {
    async click() {
      nextClicks += 1;
      currentUrl = "https://opencounter.cincinnati-oh.gov/projects/2819848/apply/summary";
    },
    async count() { return 1; },
    async isEnabled() { return true; },
    async isVisible() { return true; },
    async waitFor() {}
  };
  const radio = {
    async count() { return 1; },
    async isChecked() { return true; },
    locator(selector) {
      assert.equal(selector, "xpath=ancestor::label");
      return {
        async click() { labelClicks += 1; }
      };
    }
  };
  const page = {
    async evaluate() {
      return {
        headings: [
          "Your project is Prohibited at this location.",
          "Zoning District",
          "T3 Neighborhood (T3N)"
        ],
        locationHeading: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
      };
    },
    getByRole(role, options) {
      if (role === "combobox") {
        assert.deepEqual(options, { exact: true, name: "Address" });
        return addressBox;
      }
      assert.equal(role, "button");
      if (options.name === "Select this address") return confirmAddress;
      if (options.name === "Skip for now") return zeroCount;
      if (options.name === "Download PDF") return downloadButton;
      throw new Error(`unexpected role query: ${options.name}`);
    },
    getByText(value, options) {
      throw new Error(`address suggestion must not be replayed: ${value} ${options.exact}`);
    },
    async goto(url) {
      assert.equal(new Set([
        "https://opencounter.cincinnati-oh.gov/projects/2819848/guide/location",
        "https://opencounter.cincinnati-oh.gov/projects/2819848/apply/summary"
      ]).has(url), true);
      if (url.endsWith("/apply/summary")) summaryReloads += 1;
      return { status: () => 200 };
    },
    locator(selector) {
      if (selector === 'input[type="radio"][name="residential-question"][value="false"]') {
        return radio;
      }
      if (selector === 'input[type="text"][name="residential-question"]') {
        return zeroCount;
      }
      if (selector === "button[data-save-button=true]"
        || selector === "button[data-save-button=true]:not([disabled])") {
        return nextButton;
      }
      if (selector === "main h1") return { async waitFor() {} };
      throw new Error(`unexpected locator: ${selector}`);
    },
    async waitForLoadState() {},
    async waitForEvent(name, options) {
      assert.equal(name, "download");
      assert.deepEqual(options, { timeout: 35_000 });
      return {
        async failure() { return null; },
        async path() { return "/tmp/provider-download.pdf"; }
      };
    },
    async waitForTimeout() {},
    async waitForURL(predicate) {
      assert.equal(predicate(new URL(currentUrl)), true);
    },
    url() { return currentUrl; }
  };
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {
      async persistPdf(input) {
        assert.deepEqual(input, {
          downloadPath: "/tmp/provider-download.pdf",
          providerReference
        });
        return artifact;
      }
    },
    pageRunner: async (storageStatePromise, action) => {
      assert.deepEqual(await storageStatePromise, { cookies: [] });
      return action(page, {
        async storageState() { return { cookies: [] }; }
      });
    },
    stateStore: {
      async loadSession() {
        return {
          guidanceState: {
            activeCheckpoint: { checkpointSha256, questions },
            requestedAddress: "4818 stewart avenue cincinnati oh 45227"
          },
          storageState: { cookies: [] }
        };
      },
      async rewrite() {}
    }
  });

  const result = await driver.continueGuidance({
    answers: [
      { questionId: "opencounter-address", value: selectedAddress },
      { questionId: "residential-question", value: "false" }
    ],
    checkpointSha256,
    providerReference
  });

  assert.equal(result.status, "completed");
  assert.equal(addressFills, 0);
  assert.equal(addressConfirmationClicks, 0);
  assert.deepEqual(result.providerPdf, {
    artifact,
    providerReference,
    sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2819848/apply/summary",
    status: "exported"
  });
  assert.equal(labelClicks, 0);
  assert.equal(nextClicks, 1);
  assert.equal(summaryReloads, 0);
});

test("preserves encrypted state and the provider reference when start fails after project creation", async () => {
  const saves = [];
  const stateStore = {
    async save(providerReference, storageState, expiresAt) {
      saves.push({ expiresAt, providerReference, storageState });
    }
  };
  const context = {
    async storageState() {
      return { cookies: [{ name: "anonymous-project", value: "bounded" }] };
    }
  };
  const page = {
    url() {
      return "https://opencounter.cincinnati-oh.gov/projects/2819999/guide/location";
    }
  };

  const result = await runResumableStart({
    context,
    input: {
      address: "4818 Stewart Avenue, Cincinnati, OH 45227",
      workflow: "zoning"
    },
    now: () => new Date("2026-08-03T18:00:00.000Z"),
    page,
    startAction: async (_page, _input, onProjectCreated) => {
      await onProjectCreated("opencounter:project:2819999");
      throw new Error("opencounter_dependency_timeout:address_choices");
    },
    stateStore
  });

  assert.deepEqual(result, {
    providerReference: "opencounter:project:2819999",
    route: "/projects/2819999/guide/location",
    status: "indeterminate"
  });
  assert.equal(saves.length >= 1, true);
  assert.equal(saves[0].providerReference, "opencounter:project:2819999");
  assert.deepEqual(saves[0].storageState, {
    cookies: [{ name: "anonymous-project", value: "bounded" }]
  });
  assert.equal(saves[0].expiresAt, "2026-08-04T18:00:00.000Z");
});

test("persists the requested address and exact active checkpoint after start", async () => {
  const saves = [];
  const providerReference = "opencounter:project:2819999";
  const questions = [{
    id: "opencounter-address",
    options: [{
      label: "4818 Stewart Avenue, Cincinnati, Ohio 45227",
      value: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const result = await runResumableStart({
    context: {
      async storageState() { return { cookies: [] }; }
    },
    input: {
      address: "4818 Stewart Avenue, Cincinnati, OH 45227",
      jurisdiction: "cincinnati-oh",
      proposedUse: "Multi-family dwelling",
      workflow: "zoning"
    },
    now: () => new Date("2026-08-03T15:00:00.000Z"),
    page: {
      url: () => "https://opencounter.cincinnati-oh.gov/projects/2819999/guide/location"
    },
    startAction: async (_page, _input, onProjectCreated) => {
      await onProjectCreated(providerReference);
      return { providerReference, questions, status: "needs_requester_input" };
    },
    stateStore: {
      async save(reference, storageState, expiresAt, bindingSha256, guidanceState) {
        saves.push({
          bindingSha256,
          expiresAt,
          guidanceState,
          reference,
          storageState
        });
      }
    }
  });

  assert.equal(result.status, "needs_requester_input");
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[0].guidanceState, {
    activeCheckpoint: null,
    requestedAddress: "4818 stewart avenue cincinnati oh 45227"
  });
  assert.deepEqual(saves[1].guidanceState, {
    activeCheckpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(
        providerReference,
        questions
      ),
      questions
    },
    requestedAddress: "4818 stewart avenue cincinnati oh 45227"
  });
});

test("binds a legacy session before one same-project reconciliation mutation", async () => {
  const saves = [];
  let mutations = 0;
  const providerInputSha256 = "d".repeat(64);
  const input = {
    address: "880 Ridgeway Avenue, Cincinnati, OH 45229",
    providerInputSha256,
    providerReference: "opencounter:project:2819756"
  };
  const stateStore = {
    async loadForReconciliation(providerReference, bindingSha256) {
      assert.equal(providerReference, input.providerReference);
      assert.equal(bindingSha256, providerInputSha256);
      return {
        needsBindingMigration: true,
        storageState: { cookies: [{ name: "anonymous-project", value: "legacy" }] }
      };
    },
    async save(providerReference, storageState, expiresAt, bindingSha256) {
      saves.push({ bindingSha256, expiresAt, providerReference, storageState });
    }
  };
  const driver = createPlaywrightOpenCounterDriver({
    artifactStore: {},
    pageRunner: async (storageStatePromise, action) => {
      assert.deepEqual(await storageStatePromise, {
        cookies: [{ name: "anonymous-project", value: "legacy" }]
      });
      return action({
        url() {
          return "https://opencounter.cincinnati-oh.gov/projects/2819756/guide/location";
        }
      }, {
        async storageState() {
          return { cookies: [{ name: "anonymous-project", value: "bound" }] };
        }
      });
    },
    reconcileZoningStartAction: async (_page, received, controls) => {
      assert.equal(received, input);
      await controls.onProjectVerified();
      assert.equal(saves.length, 1);
      await controls.onMutationStarted();
      mutations += 1;
      throw new Error("opencounter_dependency_timeout:provider_save");
    },
    stateStore
  });

  assert.deepEqual(await driver.reconcileZoningStart(input), {
    providerReference: input.providerReference,
    route: "/projects/2819756/guide/location",
    status: "indeterminate"
  });
  assert.equal(mutations, 1);
  assert.equal(saves.length, 2);
  for (const save of saves) {
    assert.deepEqual(save, {
      bindingSha256: providerInputSha256,
      expiresAt: save.expiresAt,
      providerReference: input.providerReference,
      storageState: { cookies: [{ name: "anonymous-project", value: "bound" }] }
    });
  }
  assert.equal(Number.isFinite(Date.parse(saves[0].expiresAt)), true);
});
