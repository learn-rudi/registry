

export const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const MAXIMUM_PROVIDER_PROJECTS = 48;

export const MAXIMUM_ZONES_PER_USE = 2;

const MINIMUM_PRIORITY_SCORE = 30;

export const REQUIRED_SAMPLING_STRATA = [
  ["single_family", ["SF-20", "SF-10", "SF-6", "SF-4", "SF-2"]],
  ["residential_multi", ["RMX", "RM-2.0", "RM-1.2", "RM-0.7"]],
  ["office", ["OL", "OG"]],
  ["neighborhood_commercial", ["CN-P", "CN-M"]],
  ["commercial", ["CC-P", "CC-M", "CC-A", "CG-A"]],
  ["urban_mixed", ["UM", "DD"]],
  ["manufacturing", ["MA", "ML", "MG", "ME"]],
  ["riverfront", ["RF-R", "RF-C", "RF-M"]],
  ["special_purpose", ["PR", "IR", "PD"]],
  ["form_based", [
    "T3E", "T3N", "T4N.MF", "T4N.SF", "T5F", "T5MS", "T5N.LS",
    "T5N.SS"
  ]]
];

const REQUIRED_BASE_ZONING_CODES = REQUIRED_SAMPLING_STRATA.flatMap(
  ([, zones]) => zones
);

export const SIGNAL_WEIGHT_KEYS = [
  "firstPassProhibited",
  "questionPatternDivergence",
  "terminalOutcomeDivergence",
  "uniqueQuestionSignature"
];

export const REQUIRED_SIGNAL_WEIGHTS = {
  firstPassProhibited: 60,
  questionPatternDivergence: 30,
  terminalOutcomeDivergence: 25,
  uniqueQuestionSignature: 15
};

export function validateAdaptivePolicy(value, catalog) {
  exactRecord(value, [
    "authorizationRequired", "catalogId", "catalogSha256",
    "maximumProviderConcurrency", "maximumProviderProjects",
    "maximumZonesPerUse", "minimumPriorityScore", "policyId",
    "policyVersion", "requiredPrecursorStatus", "samplingStrata", "tenantId",
    "schemaVersion", "signalWeights", "tenantVersion"
  ], "policy");
  if (value.authorizationRequired !== true
    || value.schemaVersion !== 1
    || value.policyId !== "cincinnati-adaptive-zoning-question-discovery-v1"
    || value.policyVersion !== 1
    || value.catalogId !== catalog.catalogId
    || value.catalogSha256 !== catalog.catalogSha256
    || value.tenantId !== catalog.provider.tenantId
    || value.tenantVersion !== catalog.provider.tenantVersion
    || value.requiredPrecursorStatus !== "scenario_wave_1_complete"
    || value.maximumProviderConcurrency !== 2
    || !Number.isSafeInteger(value.maximumProviderProjects)
    || value.maximumProviderProjects < 1
    || value.maximumProviderProjects > MAXIMUM_PROVIDER_PROJECTS
    || !Number.isSafeInteger(value.maximumZonesPerUse)
    || value.maximumZonesPerUse < 1
    || value.maximumZonesPerUse > MAXIMUM_ZONES_PER_USE
    || !Number.isSafeInteger(value.minimumPriorityScore)
    || value.minimumPriorityScore < MINIMUM_PRIORITY_SCORE
    || value.minimumPriorityScore > 400
    || !Array.isArray(value.samplingStrata)
    || value.samplingStrata.length < 2
    || value.samplingStrata.length > 37) {
    throw new Error("opencounter_adaptive_zoning_policy_invalid");
  }
  exactRecord(value.signalWeights, SIGNAL_WEIGHT_KEYS, "policy_signal_weights");
  if (JSON.stringify(value.signalWeights)
    !== JSON.stringify(REQUIRED_SIGNAL_WEIGHTS)) {
    throw new Error("opencounter_adaptive_zoning_policy_invalid");
  }
  const stratumIds = new Set();
  const zones = new Set();
  const samplingStrata = value.samplingStrata.map((stratum) => {
    exactRecord(stratum, ["baseZoningCodes", "stratumId"], "policy_stratum");
    if (!ID_PATTERN.test(stratum.stratumId)
      || stratumIds.has(stratum.stratumId)
      || !Array.isArray(stratum.baseZoningCodes)
      || stratum.baseZoningCodes.length < 1
      || stratum.baseZoningCodes.length > 37) {
      throw new Error("opencounter_adaptive_zoning_policy_invalid");
    }
    stratumIds.add(stratum.stratumId);
    for (const zone of stratum.baseZoningCodes) {
      if (!ZONING_CODE_PATTERN.test(zone) || zones.has(zone)) {
        throw new Error("opencounter_adaptive_zoning_policy_invalid");
      }
      zones.add(zone);
    }
    return {
      baseZoningCodes: [...stratum.baseZoningCodes],
      stratumId: stratum.stratumId
    };
  });
  if (JSON.stringify([...zones]) !== JSON.stringify(REQUIRED_BASE_ZONING_CODES)) {
    throw new Error("opencounter_adaptive_zoning_policy_zoning_invalid");
  }
  const expectedSamplingStrata = REQUIRED_SAMPLING_STRATA.map(
    ([stratumId, baseZoningCodes]) => ({ baseZoningCodes, stratumId })
  );
  if (JSON.stringify(samplingStrata) !== JSON.stringify(expectedSamplingStrata)) {
    throw new Error("opencounter_adaptive_zoning_policy_zoning_invalid");
  }
  return {
    authorizationRequired: value.authorizationRequired,
    catalogId: value.catalogId,
    catalogSha256: value.catalogSha256,
    maximumProviderConcurrency: value.maximumProviderConcurrency,
    maximumProviderProjects: value.maximumProviderProjects,
    maximumZonesPerUse: value.maximumZonesPerUse,
    minimumPriorityScore: value.minimumPriorityScore,
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    requiredPrecursorStatus: value.requiredPrecursorStatus,
    samplingStrata,
    schemaVersion: value.schemaVersion,
    signalWeights: structuredClone(value.signalWeights),
    tenantId: value.tenantId,
    tenantVersion: value.tenantVersion
  };
}

export function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_adaptive_zoning_${label}_invalid`);
  }
}
