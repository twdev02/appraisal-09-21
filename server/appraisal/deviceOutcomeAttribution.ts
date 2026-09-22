/** Device counts and inventory size do not establish product-specific outcomes. */
export function isDeviceOutcomeExtractable(device: any): boolean {
  const evidence = device?.outcomeAttribution;
  const meaningful = (value: unknown) => Boolean(String(value || '').trim()) &&
    !/^(?:not reported|not separately reported|not assessable|unknown|n\/?a)$/i.test(String(value).trim());
  return evidence?.extractable === true &&
    ['device_specific', 'exclusive_device_cohort'].includes(evidence?.basis) &&
    [evidence?.outcome, evidence?.outcomeQuote, evidence?.outcomeLocation,
      evidence?.attributionQuote, evidence?.attributionLocation].every(meaningful) &&
    /\d/.test(String(evidence.outcomeQuote));
}
