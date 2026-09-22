// The AI must identify an actual product/model, with its name present in the quote.
// Generic device descriptions, manufacturer names and dimensions are insufficient.
const normalize = (value: string) => value.toLowerCase().replace(/[™®]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stripGenericTerms = (value: string) => value
  .replace(/\b(?:not reported|unknown|self expandable|self expanding|non covered|uncovered|covered|partially|fully|metallic|metal|plastic|biliary|drainage|pigtail|stents?|catheters?|sems|pcsems|fcsems|french|fr|mm|cm|\d+f|\d+)\b/g, '')
  .trim();

function isExplicitProductNameQuote(name: string, quote: string): boolean {
  const normalizedName = normalize(name);
  const generic = stripGenericTerms(normalizedName);
  return Boolean(generic) && Boolean(normalizedName) &&
    (` ${normalize(quote)} `).includes(` ${normalizedName} `);
}

export function hasExplicitProductName(extract: any): boolean {
  const name = String(extract?.deviceIdentificationProductName || '').trim();
  const quote = String(extract?.deviceIdentificationQuote || '').trim();
  return extract?.deviceIdentificationReported === true && isExplicitProductNameQuote(name, quote);
}

// Fallback source of truth: the per-device extraction already shown to the user
// (researchGroups[].devices[]) independently proves a device identification was
// reported, even when the separate methodologicalExtracts.deviceIdentification*
// fields were left incomplete or inconsistent by the model.
export function hasExplicitProductNameInDevices(devices: Array<{ name: string; quote: string }>): boolean {
  return devices.some(d => isExplicitProductNameQuote(String(d.name || '').trim(), String(d.quote || '').trim()));
}

export function elementaryAspectsAdequate(method: boolean, device: boolean, outcome: boolean): boolean {
  return method && device && outcome;
}
