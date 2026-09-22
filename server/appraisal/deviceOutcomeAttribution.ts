const meaningful = (value: unknown) => Boolean(String(value ?? '').trim()) &&
  !/^(?:not reported|not separately reported|not assessable|unknown|unclear|n\/?a)$/i.test(String(value).trim());
const positiveNumber = (value: unknown) => meaningful(value) && Number.isFinite(Number(value)) && Number(value) > 0;

/** Require coverage of the paper's independently enumerated clinical endpoints. */
export function isDeviceOutcomeExtractable(device: any): boolean {
  // A group that used only this one device has no other device to pool/confuse
  // its results with: every endpoint the group reports IS this device's result
  // by definition. Do not make this fall through the strict per-endpoint
  // inventory check below, which depends on the AI perfectly filling in a
  // structured attribution row for every single endpoint (technical success,
  // clinical success, pain score, patency, follow-up, each AE, etc.) — a single
  // missed/malformed field anywhere would otherwise wrongly zero out an
  // unambiguous single-arm study.
  if ((device?.__groupDeviceCount || 1) <= 1) return true;

  const evidence = device?.outcomeAttribution;
  const inventory = device?.__clinicalEndpointInventory;
  if (!Array.isArray(inventory) || inventory.length === 0 ||
      !inventory.every((entry: any) => [entry.id, entry.name, entry.quote, entry.location].every(meaningful))) return false;
  if (new Set(inventory.map((entry: any) => entry.id)).size !== inventory.length) return false;
  if (evidence?.extractable !== true || !['device_specific', 'exclusive_device_cohort'].includes(evidence?.basis)) return false;
  if (![evidence.attributionQuote, evidence.attributionLocation].every(meaningful)) return false;
  if (evidence.basis === 'exclusive_device_cohort' && evidence.exclusiveCohortConfirmed !== true) return false;
  const rows = evidence.endpoints;
  if (!Array.isArray(rows)) return false;
  return inventory.every((expected: any) => {
    const matches = rows.filter((row: any) => row.endpointId === expected.id);
    if (matches.length !== 1) return false;
    const row = matches[0];
    if (row.attributable !== true || row.pooledAcrossProducts !== false) return false;
    if (![row.value, row.quote, row.location, row.cohort, row.timepoint,
      row.attributionQuote, row.attributionLocation].every(meaningful)) return false;
    if (row.resultType === 'proportion') {
      return positiveNumber(row.denominator) && Number.isInteger(Number(row.denominator)) &&
        meaningful(row.numerator) && Number.isInteger(Number(row.numerator)) &&
        Number(row.numerator) >= 0 && Number(row.numerator) <= Number(row.denominator);
    }
    if (row.resultType === 'continuous' || row.resultType === 'time_to_event') {
      return positiveNumber(row.analysisN) && meaningful(row.unit) && /\d/.test(String(row.value));
    }
    return false;
  });
}
