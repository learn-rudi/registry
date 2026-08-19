export function isRuntimeVersionInRange(
  runtimeRef,
  pattern,
  minimumVersion,
  maximumVersionExclusive
) {
  if (
    typeof runtimeRef !== "string"
    || !(pattern instanceof RegExp)
    || !isVersionTuple(minimumVersion)
    || !isVersionTuple(maximumVersionExclusive)
  ) {
    return false;
  }
  const match = runtimeRef.match(pattern);
  if (!match || match.length !== 4) return false;
  const observed = match.slice(1).map(Number);
  if (!isVersionTuple(observed)) return false;
  return compareVersions(observed, minimumVersion) >= 0
    && compareVersions(observed, maximumVersionExclusive) < 0;
}

export function executionExposesRequiredOptions(execution, requiredOptions) {
  if (
    !execution
    || execution.startError
    || execution.cancelled
    || execution.timedOut
    || execution.terminationConfirmed === false
    || execution.exitCode !== 0
    || execution.stdoutOverflow
    || typeof execution.stdout !== "string"
    || !Array.isArray(requiredOptions)
  ) {
    return false;
  }
  return helpTextExposesRequiredOptions(execution.stdout, requiredOptions);
}

export function helpTextExposesRequiredOptions(helpText, requiredOptions) {
  return typeof helpText === "string"
    && Array.isArray(requiredOptions)
    && requiredOptions.every((option) => hasExactOption(helpText, option));
}

function isVersionTuple(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((part) => Number.isSafeInteger(part) && part >= 0);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function hasExactOption(helpText, option) {
  if (typeof option !== "string" || !/^--[a-z0-9-]+$/u.test(option)) return false;
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|\\s|,)${escaped}(?=$|[\\s,=<])`, "mu").test(helpText);
}
