import { isVerbatimQuote } from './verbatimCheck';

// The AI must identify an actual product/model, with its name present in the quote.
// Generic device descriptions, manufacturer names and dimensions are insufficient.
const normalize = (value: string) => value.toLowerCase().replace(/[™®]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// A bare 1-3 digit number is almost always a size (mm/cm/French, e.g. the "8"
// left over from "8.5F"); a longer run of digits is far more likely to be an
// actual model/catalogue/registration number, which DOES identify the device.
const stripGenericTerms = (value: string) => value
  .replace(/\b(?:not reported|unknown|self expandable|self expanding|non covered|uncovered|covered|partially|fully|metallic|metal|plastic|biliary|drainage|pigtail|stents?|catheters?|sems|pcsems|fcsems|french|fr|mm|cm|\d+f|\d{1,3})\b/g, '')
  .trim();

function isExplicitProductNameQuote(name: string, quote: string): boolean {
  const normalizedName = normalize(name);
  const generic = stripGenericTerms(normalizedName);
  if (!generic || !normalizedName) return false;
  const normalizedQuote = normalize(quote);
  if ((` ${normalizedQuote} `).includes(` ${normalizedName} `)) return true;
  // Fall back to a bag-of-words check: require every word of the name to still
  // appear somewhere in the quote, even if a line-wrap artifact, an inserted
  // connector word, or minor reordering broke the exact contiguous phrase above.
  const nameWords = normalizedName.split(' ').filter(Boolean);
  const quoteWords = new Set(normalizedQuote.split(' ').filter(Boolean));
  return nameWords.length > 0 && nameWords.every((w) => quoteWords.has(w));
}

export function hasExplicitProductName(extract: any, paperText?: string): boolean {
  const name = String(extract?.deviceIdentificationProductName || '').trim();
  const quote = String(extract?.deviceIdentificationQuote || '').trim();
  return extract?.deviceIdentificationReported === true &&
    isExplicitProductNameQuote(name, quote) &&
    (!paperText || isVerbatimQuote(quote, paperText));
}

// Fallback source of truth: the per-device extraction already shown to the user
// (researchGroups[].devices[]) independently proves a device identification was
// reported, even when the separate methodologicalExtracts.deviceIdentification*
// fields were left incomplete or inconsistent by the model. When `paperText` is
// supplied, the quote must also be verifiably present in the source — a quote
// that merely contains the product name but was paraphrased/fabricated does
// not count.
export function hasExplicitProductNameInDevices(devices: Array<{ name: string; quote: string }>, paperText?: string): boolean {
  return devices.some(d => {
    const name = String(d.name || '').trim();
    const quote = String(d.quote || '').trim();
    return isExplicitProductNameQuote(name, quote) && (!paperText || isVerbatimQuote(quote, paperText));
  });
}

export function elementaryAspectsAdequate(method: boolean, device: boolean, outcome: boolean): boolean {
  return method && device && outcome;
}
