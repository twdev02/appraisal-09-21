const meaningful = (value: unknown): boolean => {
  const text = String(value ?? '').trim();
  return Boolean(text) && !/^(?:not reported|not assessable|unknown|n\/?a)$/i.test(text);
};

/** Positive evidence is required; missing AI fields must never award credit. */
export function evaluateAdequateControls(extract: any) {
  const comparison = extract?.adequateControlsComparisonType;
  const supportedComparison = ['concurrent', 'external', 'performance_criterion'].includes(comparison);
  const evidenceComplete = [
    extract?.adequateControlsQuote,
    extract?.adequateControlsLocation,
    extract?.adequateControlsConfoundingQuote,
    extract?.adequateControlsConfoundingLocation,
    extract?.adequateControlsComment,
  ].every(meaningful);
  const adequate = extract?.adequateControlsSelection === 'Adequate (2)' &&
    supportedComparison && extract?.adequateControlsComparatorAppropriate === true &&
    extract?.adequateControlsConfoundingControlled === true && evidenceComplete;
  const reason = adequate
    ? String(extract.adequateControlsComment)
    : !supportedComparison
      ? 'Non adequate: no eligible control/comparison established. Uncontrolled single-arm and before/after-only studies do not qualify.'
      : !evidenceComplete
        ? 'Non adequate: insufficient reported evidence of an appropriate comparison and control of material confounding.'
        : 'Non adequate: appropriate comparison and control of material confounding were not both established.';
  return { selection: adequate ? 'Adequate (2)' : 'Non adequate (1)', score: adequate ? 2 : 1, adequate, reason };
}
