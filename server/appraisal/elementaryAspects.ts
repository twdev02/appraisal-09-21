// The AI must identify an actual product/model, with its name present in the quote.
// Generic device descriptions, manufacturer names and dimensions are insufficient.
export function hasExplicitProductName(extract: any): boolean {
  const name = String(extract?.deviceIdentificationProductName || '').trim();
  const quote = String(extract?.deviceIdentificationQuote || '').trim();
  const normalize = (value: string) => value.toLowerCase().replace(/[™®]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedName = normalize(name);
  const generic = normalizedName
    .replace(/\b(?:not reported|unknown|self expandable|self expanding|non covered|uncovered|covered|partially|fully|metallic|metal|plastic|biliary|drainage|pigtail|stents?|catheters?|sems|pcsems|fcsems|french|fr|mm|cm|\d+f|\d+)\b/g, '')
    .trim();
  return extract?.deviceIdentificationReported === true && Boolean(generic) &&
    Boolean(normalizedName) && (` ${normalize(quote)} `).includes(` ${normalizedName} `);
}

export function elementaryAspectsAdequate(method: boolean, device: boolean, outcome: boolean): boolean {
  return method && device && outcome;
}
