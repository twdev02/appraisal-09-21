/** Device counts and inventory size do not establish product-specific outcomes. */
export function isDeviceOutcomeExtractable(device: any): boolean {
  const evidence = device?.outcomeAttribution;
  const meaningful = (value: unknown) => Boolean(String(value || '').trim()) &&
    !/^(?:not reported|not separately reported|not assessable|unknown|n\/?a)$/i.test(String(value).trim());
  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[™®]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const names = [device?.deviceProductName, device?.matchedDueName].map(normalize).filter(Boolean);
  const mentionsProduct = (quote: unknown) => names.some(name => (` ${normalize(quote)} `).includes(` ${name} `));
  const outcomeQuote = String(evidence?.outcomeQuote || '');
  // A year, delivery-system size or usage count is not a clinical outcome.
  const quantitativeOutcome = /\d/.test(outcomeQuote) && /\b(?:success|complications?|adverse|mortality|deaths?|survival|patency|reintervention|occlusion|migration|obstruction|bilirubin|trbo|rbo)\b/i.test(outcomeQuote);
  const attributionSupported = evidence?.basis === 'device_specific'
    ? mentionsProduct(outcomeQuote)
    : evidence?.basis === 'exclusive_device_cohort' &&
      device?.__groupDeviceCount === 1 && mentionsProduct(evidence?.attributionQuote) &&
      /\b(?:only|exclusively|all patients|every patient)\b/i.test(String(evidence?.attributionQuote || ''));
  return evidence?.extractable === true && attributionSupported &&
    ['device_specific', 'exclusive_device_cohort'].includes(evidence?.basis) &&
    [evidence?.outcome, evidence?.outcomeQuote, evidence?.outcomeLocation,
      evidence?.attributionQuote, evidence?.attributionLocation].every(meaningful) &&
    quantitativeOutcome;
}
