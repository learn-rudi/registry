import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { buildObservedQuestionGraph } from "./discovery-question-graph.mjs";
import {
  beginDiscoveryDispatch,
  leaseDiscoveryJob,
  leaseNextDiscoveryJob,
  queueDiscoveryAnswers,
  queueDiscoveryLocationAnswer,
  queueDiscoveryPreEffectRetry,
  queueDiscoveryReconciliation,
  queueDiscoveryReconciliationRetry,
  recordDiscoveryFailure,
  recordLateDiscoveryResult,
  recordDiscoveryResult,
  recordDiscoveryVerification,
  summarizeDiscoveryLedger,
  validateDiscoveryLedger
} from "./discovery-ledger.mjs";

const LEDGER_ID_PATTERN = /^ocdl_[0-9a-f]{64}$/;
const MAXIMUM_LEDGER_BYTES = 10 * 1024 * 1024;

export function createDiscoveryLedgerStore({ stateDirectory }) {
  const directory = validateStateDirectory(stateDirectory);
  return {
    async beginDispatch(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        beginDiscoveryDispatch(ledger, input));
    },
    async initialize(ledgerValue) {
      const ledger = prepareLedger(ledgerValue);
      return withLedgerLock(directory, ledger.ledgerId, () => {
        const ledgerPath = resolveLedgerPath(directory, ledger.ledgerId);
        if (existsSync(ledgerPath)) {
          const existing = readLedgerFile(ledgerPath, ledger.ledgerId);
          if (existing.ledgerSha256 !== ledger.ledgerSha256) {
            throw new Error("opencounter_discovery_ledger_identity_conflict");
          }
          return existing;
        }
        writeLedgerFile(directory, ledger);
        return structuredClone(ledger);
      });
    },
    async leaseNext(input) {
      return withLedgerLock(directory, input.ledgerId, () => {
        const ledger = readLedgerFile(
          resolveLedgerPath(directory, input.ledgerId),
          input.ledgerId
        );
        const result = leaseNextDiscoveryJob(ledger, input);
        writeLedgerFile(directory, prepareLedger(result.ledger));
        return {
          job: result.job,
          ledger: prepareLedger(result.ledger)
        };
      });
    },
    async leaseJob(input) {
      return withLedgerLock(directory, input.ledgerId, () => {
        const ledger = readLedgerFile(
          resolveLedgerPath(directory, input.ledgerId),
          input.ledgerId
        );
        const result = leaseDiscoveryJob(ledger, input);
        writeLedgerFile(directory, prepareLedger(result.ledger));
        return {
          job: result.job,
          ledger: prepareLedger(result.ledger)
        };
      });
    },
    async queueAnswers(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        queueDiscoveryAnswers(ledger, input));
    },
    async queueLocationAnswer(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        queueDiscoveryLocationAnswer(ledger, input));
    },
    async queuePreEffectRetry(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        queueDiscoveryPreEffectRetry(ledger, input));
    },
    async queueReconciliation(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        queueDiscoveryReconciliation(ledger, input));
    },
    async queueReconciliationRetry(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        queueDiscoveryReconciliationRetry(ledger, input));
    },
    async read(ledgerId) {
      return readLedgerFile(resolveLedgerPath(directory, ledgerId), ledgerId);
    },
    async refreshQuestionGraph({ ledgerId }) {
      return withLedgerLock(directory, ledgerId, () => {
        const ledgerPath = resolveLedgerPath(directory, ledgerId);
        const ledger = readLedgerFile(ledgerPath, ledgerId, {
          requireFreshQuestionGraph: false
        });
        const refreshed = prepareLedger(ledger);
        writeLedgerFile(directory, refreshed);
        return structuredClone(refreshed);
      });
    },
    async recordFailure(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        recordDiscoveryFailure(ledger, input));
    },
    async recordLateResult(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        recordLateDiscoveryResult(ledger, input));
    },
    async recordResult(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        recordDiscoveryResult(ledger, input));
    },
    async recordVerification(input) {
      return updateLedger(directory, input.ledgerId, (ledger) =>
        recordDiscoveryVerification(ledger, input));
    },
    async summarize({ ledgerId, observedAt }) {
      const ledger = readLedgerFile(resolveLedgerPath(directory, ledgerId), ledgerId);
      return summarizeDiscoveryLedger(ledger, { observedAt });
    }
  };
}

async function updateLedger(directory, ledgerId, transition) {
  return withLedgerLock(directory, ledgerId, () => {
    const ledger = readLedgerFile(resolveLedgerPath(directory, ledgerId), ledgerId);
    const updated = prepareLedger(transition(ledger));
    writeLedgerFile(directory, updated);
    return structuredClone(updated);
  });
}

function prepareLedger(value) {
  const ledger = validateDiscoveryLedger(value);
  ledger.questionGraph = buildObservedQuestionGraph(ledger);
  return ledger;
}

function validateStateDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("opencounter_discovery_state_directory_invalid");
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const metadata = lstatSync(value);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("opencounter_discovery_state_directory_invalid");
  }
  chmodSync(value, 0o700);
  return path.resolve(value);
}

function resolveLedgerPath(directory, ledgerId) {
  if (typeof ledgerId !== "string" || !LEDGER_ID_PATTERN.test(ledgerId)) {
    throw new Error("opencounter_discovery_ledger_id_invalid");
  }
  return path.join(directory, `${ledgerId}.json`);
}

function readLedgerFile(
  ledgerPath,
  expectedLedgerId,
  { requireFreshQuestionGraph = true } = {}
) {
  const metadata = lstatSync(ledgerPath);
  if (
    metadata.isSymbolicLink()
    || !metadata.isFile()
    || metadata.size < 1
    || metadata.size > MAXIMUM_LEDGER_BYTES
  ) {
    throw new Error("opencounter_discovery_ledger_file_invalid");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch {
    throw new Error("opencounter_discovery_ledger_json_invalid");
  }
  const ledger = validateDiscoveryLedger(value);
  if (ledger.ledgerId !== expectedLedgerId) {
    throw new Error("opencounter_discovery_ledger_identity_conflict");
  }
  const expectedQuestionGraph = buildObservedQuestionGraph(ledger);
  if (requireFreshQuestionGraph
    && JSON.stringify(ledger.questionGraph) !== JSON.stringify(expectedQuestionGraph)) {
    throw new Error("opencounter_discovery_question_graph_stale");
  }
  return ledger;
}

function writeLedgerFile(directory, ledgerValue) {
  const ledger = prepareLedger(ledgerValue);
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_LEDGER_BYTES) {
    throw new Error("opencounter_discovery_ledger_too_large");
  }
  const ledgerPath = resolveLedgerPath(directory, ledger.ledgerId);
  if (existsSync(ledgerPath)) {
    const metadata = lstatSync(ledgerPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("opencounter_discovery_ledger_file_invalid");
    }
  }
  const temporaryPath = path.join(
    directory,
    `${ledger.ledgerId}.${randomUUID()}.tmp`
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, ledgerPath);
    chmodSync(ledgerPath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

async function withLedgerLock(directory, ledgerId, operation) {
  const ledgerPath = resolveLedgerPath(directory, ledgerId);
  const lockPath = `${ledgerPath}.lock`;
  const token = randomUUID();
  await acquireLock(lockPath, token);
  try {
    return await operation();
  } finally {
    releaseLock(lockPath, token);
  }
}

async function acquireLock(lockPath, token) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }), "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      return;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== "EEXIST") throw error;
      if (recoverAbandonedLock(lockPath)) continue;
      await delay(10);
    }
  }
  throw new Error("opencounter_discovery_ledger_busy");
}

function recoverAbandonedLock(lockPath) {
  let metadata;
  try {
    metadata = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1_000) {
    throw new Error("opencounter_discovery_ledger_lock_invalid");
  }
  if (metadata.size === 0) return false;
  let owner;
  try {
    owner = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== "string") {
    throw new Error("opencounter_discovery_ledger_lock_invalid");
  }
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
    unlinkSync(lockPath);
    return true;
  }
}

function releaseLock(lockPath, token) {
  let owner;
  try {
    owner = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    throw new Error("opencounter_discovery_ledger_lock_lost");
  }
  if (owner?.pid !== process.pid || owner?.token !== token) {
    throw new Error("opencounter_discovery_ledger_lock_lost");
  }
  unlinkSync(lockPath);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
