export interface StatisticalEvidenceResult {
  reported: boolean;
  evidenceQuote: string;
  evidenceLocation: string;
  comment: string;
  detectedMethods: string[];
  detectedSoftware: string[];
  detectedBy: Array<'ai' | 'software' | 'method' | 'descriptive-methodology'>;
}

type AiStatisticalEvidence = {
  hasStatisticalMethodsReported?: unknown;
  acceptableReportQuote?: unknown;
  acceptableReportLocation?: unknown;
  acceptableReportComment?: unknown;
};

const SOFTWARE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'SPSS', regex: /\b(?:Statistical\s+Package\s+for\s+the?\s*Social\s+Sciences\s*\()?SPSS(?:[-\s]?\d+(?:\.\d+)*)?\b|\bSPSS(?:[-\s]?\d+(?:\.\d+)*)?\b/i },
  { label: 'SAS', regex: /\bSAS(?:\s+(?:software|version|v\.?\s*\d+)|\s*\d+(?:\.\d+)*)?\b/i },
  { label: 'Stata', regex: /\bStata(?:\s+(?:software|version|v\.?\s*\d+)|\s*\d+(?:\.\d+)*)?\b/i },
  { label: 'StatView', regex: /\bStatView\b/i },
  { label: 'GraphPad Prism', regex: /\bGraphPad\s+Prism\b/i },
  { label: 'MedCalc', regex: /\bMedCalc\b/i },
  { label: 'JMP', regex: /\bJMP\b/i },
  { label: 'R', regex: /\bR\s+(?:software|version|v\.?\s*\d+|package|environment)\b/i },
];

const METHOD_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Student's t-test", regex: /\b(?:Student'?s?\s+)?t[-\s]?test\b/i },
  { label: 'Chi-square test', regex: /\b(?:chi[-\s]?square|χ\s*2|χ²)\s*(?:test)?\b/i },
  { label: "Fisher's exact test", regex: /\bFisher'?s?\s+exact\s+test\b/i },
  { label: 'Mann-Whitney U test', regex: /\bMann[-\s]?Whitney(?:\s+U)?\s+test\b/i },
  { label: 'Wilcoxon test', regex: /\bWilcoxon(?:\s+(?:signed[-\s]?rank|rank[-\s]?sum))?\s+test\b/i },
  { label: 'ANOVA', regex: /\bANOVA\b|\banalysis\s+of\s+variance\b/i },
  { label: 'Kruskal-Wallis test', regex: /\bKruskal[-\s]?Wallis\s+test\b/i },
  { label: 'Kaplan-Meier method', regex: /\bKaplan[-\s]?Meier(?:\s+(?:method|analysis|curve|estimate))?\b/i },
  { label: 'Log-rank test', regex: /\blog[-\s]?rank\s+test\b/i },
  { label: 'Cox proportional hazards regression', regex: /\bCox(?:\s+proportional\s+hazards?)?(?:\s+regression|\s+model)?\b/i },
  { label: 'Logistic regression', regex: /\blogistic\s+regression\b/i },
  { label: 'Linear regression', regex: /\blinear\s+regression\b/i },
  { label: 'Multivariable regression', regex: /\bmultivaria(?:ble|te)\s+(?:analysis|regression)\b/i },
  { label: 'Pearson correlation', regex: /\bPearson(?:'?s)?(?:\s+(?:rank\s+)?)?correlation\b/i },
  { label: 'Spearman correlation', regex: /\bSpearman(?:'?s)?(?:\s+(?:rank\s+)?)?correlation\b/i },
];

const DESCRIPTIVE_METHOD_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'Descriptive statistical methodology',
    regex: /\bcontinuous\s+variables?\b[^.\n]{0,220}\b(?:mean|median)\b[^.\n]{0,220}\b(?:standard\s+deviation|SD|interquartile\s+range|IQR|range)\b/i,
  },
  {
    label: 'Categorical statistical methodology',
    regex: /\bcategorical\s+variables?\b[^.\n]{0,220}\b(?:numbers?|frequenc(?:y|ies)|percent(?:age)?s?|%)\b/i,
  },
];

function isMeaningful(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return Boolean(text) && !/^(not reported|not assessable|unknown|n\/?a)$/i.test(text);
}

/**
 * Limit deterministic statistical-method detection to the current study.
 * Discussion and References are intentionally excluded because they often contain
 * statistical methods belonging to historical/comparator studies.
 */
export function currentStudyTextOnly(text: string): string {
  const source = String(text || '');
  return source.split(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
}

function collectMatches(
  text: string,
  patterns: Array<{ label: string; regex: RegExp }>
): Array<{ label: string; index: number; matchedText: string }> {
  const matches: Array<{ label: string; index: number; matchedText: string }> = [];
  for (const { label, regex } of patterns) {
    const match = regex.exec(text);
    if (match && match.index != null) {
      matches.push({ label, index: match.index, matchedText: match[0] });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function isDecimalPoint(text: string, index: number): boolean {
  return index > 0 && index + 1 < text.length && /\d/.test(text[index - 1]) && /\d/.test(text[index + 1]);
}

function previousSentenceDot(text: string, beforeIndex: number): number {
  let cursor = Math.min(beforeIndex, text.length - 1);
  while (cursor >= 0) {
    const dot = text.lastIndexOf('.', cursor);
    if (dot < 0) return -1;
    if (!isDecimalPoint(text, dot)) return dot;
    cursor = dot - 1;
  }
  return -1;
}

function nextSentenceDot(text: string, fromIndex: number): number {
  let cursor = Math.max(0, fromIndex);
  while (cursor < text.length) {
    const dot = text.indexOf('.', cursor);
    if (dot < 0) return -1;
    if (!isDecimalPoint(text, dot)) return dot;
    cursor = dot + 1;
  }
  return -1;
}

function sentenceAroundIndex(text: string, index: number, matchedLength = 1): string {
  if (!text || index < 0) return 'Not reported';

  // PDF text commonly inserts a newline at every visual line wrap, so a single
  // newline is NOT treated as a sentence boundary here. Decimal points inside
  // software versions or statistics (e.g. SPSS 29.0) are not sentence breaks.
  const previousDot = previousSentenceDot(text, index - 1);
  const start = previousDot >= 0 ? previousDot + 1 : 0;

  const afterMatch = index + Math.max(1, matchedLength);
  const nextDot = nextSentenceDot(text, afterMatch);
  const end = nextDot >= 0 ? nextDot + 1 : Math.min(text.length, afterMatch + 500);

  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 700) || 'Not reported';
}

function evidenceLocation(text: string, matchIndex: number): string {
  const before = text.slice(Math.max(0, matchIndex - 1200), matchIndex);
  if (/statistical\s+analysis/i.test(before) || /statistics?\b/i.test(before)) {
    return 'Methods / Statistical analysis';
  }
  return 'Methods';
}

/**
 * Single source of truth for statistical-method presence across Suitability,
 * Methodological Appraisal, and Contribution.
 *
 * User rule: statistical software alone is sufficient to count as statistical
 * methods reported. The deterministic detector is OR-ed with the AI result so a
 * clearly stated method/software cannot be lost because the model returned false.
 */
export function detectStatisticalEvidence(
  paperText: string,
  aiEvidence: AiStatisticalEvidence = {}
): StatisticalEvidenceResult {
  const currentStudyText = currentStudyTextOnly(paperText);
  const softwareMatches = collectMatches(currentStudyText, SOFTWARE_PATTERNS);
  const methodMatches = collectMatches(currentStudyText, METHOD_PATTERNS);
  const descriptiveMatches = collectMatches(currentStudyText, DESCRIPTIVE_METHOD_PATTERNS);

  const aiReported = Boolean(aiEvidence.hasStatisticalMethodsReported);
  const reported = aiReported || softwareMatches.length > 0 || methodMatches.length > 0 || descriptiveMatches.length > 0;

  const detectedSoftware = Array.from(new Set(softwareMatches.map((match) => match.label)));
  const detectedMethods = Array.from(new Set([
    ...methodMatches.map((match) => match.label),
    ...descriptiveMatches.map((match) => match.label),
  ]));

  const detectedBy: StatisticalEvidenceResult['detectedBy'] = [];
  if (aiReported) detectedBy.push('ai');
  if (softwareMatches.length > 0) detectedBy.push('software');
  if (methodMatches.length > 0) detectedBy.push('method');
  if (descriptiveMatches.length > 0) detectedBy.push('descriptive-methodology');

  if (!reported) {
    return {
      reported: false,
      evidenceQuote: 'Not reported',
      evidenceLocation: 'Not reported',
      comment: 'No specific statistical methods, statistical software, or comparative statistical analysis techniques were reported in the current-study text.',
      detectedMethods: [],
      detectedSoftware: [],
      detectedBy: [],
    };
  }

  const deterministicMatches = [...softwareMatches, ...methodMatches, ...descriptiveMatches].sort((a, b) => a.index - b.index);
  const firstDeterministic = deterministicMatches[0];

  const quote = firstDeterministic
    ? sentenceAroundIndex(currentStudyText, firstDeterministic.index, firstDeterministic.matchedText.length)
    : isMeaningful(aiEvidence.acceptableReportQuote)
      ? String(aiEvidence.acceptableReportQuote).trim()
      : 'Statistical methods reported';

  const location = firstDeterministic
    ? evidenceLocation(currentStudyText, firstDeterministic.index)
    : isMeaningful(aiEvidence.acceptableReportLocation)
      ? String(aiEvidence.acceptableReportLocation).trim()
      : 'Methods';

  const detectedParts = [
    detectedSoftware.length > 0 ? `software: ${detectedSoftware.join(', ')}` : '',
    detectedMethods.length > 0 ? `methods: ${detectedMethods.join(', ')}` : '',
  ].filter(Boolean);

  const comment = detectedParts.length > 0
    ? `Statistical evidence explicitly documented (${detectedParts.join('; ')}).`
    : isMeaningful(aiEvidence.acceptableReportComment)
      ? String(aiEvidence.acceptableReportComment).trim()
      : 'Statistical methods explicitly documented.';

  return {
    reported: true,
    evidenceQuote: quote,
    evidenceLocation: location,
    comment,
    detectedMethods,
    detectedSoftware,
    detectedBy,
  };
}
