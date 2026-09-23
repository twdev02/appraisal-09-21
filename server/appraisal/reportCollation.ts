/** Require a numeric duration tied to follow-up/observation, not an endpoint timepoint. */
export function hasReportedObservationDuration(value: unknown): boolean {
  const text = String(value ?? '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  if (/\b(?:not reported|not available|not specified|unknown|proxy)\b/i.test(text)) return false;
  const number = String.raw`\d+(?:\.\d+)?`;
  const duration = String.raw`${number}(?:\s*(?:[-–]|±|\+/-|\+-)\s*${number})?\s*[- ]?\s*(?:hours?|days?|weeks?|months?|years?|hrs?|d|wk|mo|yr)\b`;
  const subject = String.raw`(?:follow[- ]?up|followed(?:[- ]up)?|observation(?:al)?\s+(?:period|duration)|observed)`;
  const linking = String.raw`(?:\s|[:=,()]|\b(?:period|duration|time|was|were|is|of|for|a|an|the|median|mean|average|approximately|about|up|to|at|least|ranged|from)\b)*`;
  const table = String.raw`${subject}${linking}\(?(?:hours?|days?|weeks?|months?|years?|d|wk|mo|yr)\)?\s*[:|,]?\s*${number}`;
  return new RegExp(`${subject}${linking}${duration}|${duration}${linking}${subject}|${table}`, 'i').test(text);
}

export function scoreReportCollation(missing: number) {
  return missing === 0
    ? { selection: 'High quality', score: 3 }
    : missing <= 2
      ? { selection: 'Minor deficiencies', score: 2 }
      : { selection: 'Insufficient information', score: 1 };
}
