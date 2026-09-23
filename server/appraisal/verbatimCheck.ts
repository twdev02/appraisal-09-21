// The AI is instructed to copy evidence quotes verbatim from the source, but it
// sometimes paraphrases or misremembers a number while doing so (e.g. quoting
// "90%" when the paper actually says "100%"). This checks that a quote the AI
// returned is genuinely present in the source text, tolerating only the kind of
// whitespace/typographic differences a PDF extraction step can introduce.
const normalizeForVerbatimCheck = (value: unknown): string => String(value ?? '')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

export function isVerbatimQuote(quote: unknown, sourceText: unknown): boolean {
  const q = normalizeForVerbatimCheck(quote);
  if (!q) return false;
  const s = normalizeForVerbatimCheck(sourceText);
  return s.includes(q);
}
