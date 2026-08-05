const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export function extractProviderTerminalZoningCode(terminalResult) {
  if (!terminalResult || typeof terminalResult !== "object"
    || Array.isArray(terminalResult)
    || typeof terminalResult.zoningDistrict !== "string") {
    return null;
  }
  const match = terminalResult.zoningDistrict.trim().match(/\(([^()]*)\)\s*$/);
  if (match === null) return null;
  const candidate = match[1].split(/\s+-\s+/, 1)[0];
  if (!ZONING_CODE_PATTERN.test(candidate)) return null;
  return candidate;
}

export function findZoningContextDrifts(ledger) {
  if (!ledger || typeof ledger !== "object" || ledger.schemaVersion < 3
    || !Array.isArray(ledger.jobs)) {
    return [];
  }
  const drifts = [];
  for (const job of ledger.jobs) {
    if (job.status !== "completed") continue;
    const expectedBaseZoningCode = job.locationFixture?.expectedBaseZoningCode;
    const providerZoningCode = extractProviderTerminalZoningCode(job.terminalResult);
    let reason = null;
    if (job.verification?.status !== "completed") {
      reason = "provider_read_back_missing";
    } else if (providerZoningCode === null) {
      reason = "provider_terminal_zoning_unparseable";
    } else if (!zoningCodeMatchesBase(providerZoningCode, expectedBaseZoningCode)) {
      reason = "provider_terminal_zoning_mismatch";
    }
    if (reason !== null) {
      drifts.push({
        expectedBaseZoningCode,
        jobId: job.jobId,
        providerZoningCode,
        reason
      });
    }
  }
  return drifts;
}

export function observedZoningCodeForGraph(job) {
  const providerZoningCode = job?.status === "completed"
    ? extractProviderTerminalZoningCode(job.terminalResult)
    : null;
  return providerZoningCode ?? (job?.status === "completed"
    ? null
    : job?.locationFixture?.observedZoningCode ?? null);
}

export function zoningCodeMatchesBase(value, expectedBaseZoningCode) {
  return typeof value === "string"
    && typeof expectedBaseZoningCode === "string"
    && (value === expectedBaseZoningCode
      || value.startsWith(`${expectedBaseZoningCode}-`));
}
