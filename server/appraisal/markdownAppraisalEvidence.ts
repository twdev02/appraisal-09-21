import {
  detectStatisticalEvidence,
  type StatisticalEvidenceResult,
} from './statisticalEvidence';

export type AppraisalEvidenceValidationStatus =
  | 'validated'
  | 'supplemented'
  | 'md_only'
  | 'pdf_only'
  | 'not_available';

export interface AppraisalEvidenceValidationItem {
  status: AppraisalEvidenceValidationStatus;
  pdfValue: string;
  markdownValue: string;
  selectedValue: string;
  evidenceQuote: string;
  evidenceLocation: string;
  note: string;
}

export interface MarkdownClinicalOutcomeEntry {
  key: string;
  label: string;
  group: string;
  value: string;
  quote: string;
  location: string;
  source: 'confident_current_study_table' | 'current_study_results_narrative';
}

export interface MarkdownClinicalOutcomeEvidence {
  entries: MarkdownClinicalOutcomeEntry[];
  formattedSummary: string;
  quote: string;
  location: string;
  confidence: 'High' | 'Medium';
}

export interface MarkdownAppraisalEvidence {
  statistical: StatisticalEvidenceResult;
  clinicalOutcomes?: MarkdownClinicalOutcomeEvidence;
}

interface MarkdownTableBlock {
  caption: string;
  reconstruction: 'confident' | 'uncertain';
  rows: string[][];
  startIndex: number;
  pageNumber?: number;
}

const OUTCOME_PATTERNS: Array<{ key: string; label: string; regex: RegExp }> = [
  { key: 'technical_success', label: 'Technical success', regex: /\btechnical\s+success\b/i },
  { key: 'clinical_success', label: 'Clinical success', regex: /\bclinical\s+success\b/i },
  { key: 'procedural_success', label: 'Procedural success', regex: /\bprocedur(?:al|e)\s+success\b/i },
  { key: 'treatment_success', label: 'Treatment success', regex: /\btreatment\s+success\b/i },
  { key: 'clinical_response', label: 'Clinical response', regex: /\bclinical\s+(?:response|improvement)\b/i },
  { key: 'stricture_resolution', label: 'Stricture resolution', regex: /\bstricture\s+resolution\b/i },
  { key: 'symptom_resolution', label: 'Symptom resolution', regex: /\b(?:symptom(?:atic)?\s+(?:improvement|resolution)|symptom\s+relief)\b/i },
  { key: 'drainage_success', label: 'Drainage success', regex: /\b(?:biliary\s+)?drainage\s+success\b/i },
  { key: 'stent_patency', label: 'Stent patency', regex: /\b(?:stent\s+patency|patency\s+duration|functional\s+patency|dysfunction[- ]free\s+patency)\b/i },
  { key: 'survival', label: 'Survival', regex: /\b(?:overall\s+survival|patient\s+survival|survival\s+(?:time|duration|rate))\b/i },
  { key: 'recurrent_obstruction', label: 'Recurrent obstruction', regex: /\b(?:recurrent\s+(?:biliary\s+)?obstruction|RBO|TRBO|time\s+to\s+recurrent\s+obstruction)\b/i },
  { key: 'reintervention', label: 'Reintervention', regex: /\b(?:re[- ]?intervention|repeat\s+(?:intervention|procedure|ERCP|endoscopy|stent(?:ing)?))\b/i },
  { key: 'complication', label: 'Complications', regex: /\b(?:overall\s+)?complications?\b/i },
  { key: 'adverse_event', label: 'Adverse events', regex: /\b(?:serious\s+)?adverse\s+events?\b/i },
  { key: 'migration', label: 'Migration', regex: /\b(?:stent\s+)?migration\b/i },
  { key: 'occlusion', label: 'Occlusion', regex: /\b(?:stent\s+)?occlusion\b/i },
  { key: 'obstruction', label: 'Obstruction', regex: /(?:\bstent\s+obstruction\b|^obstruction(?:\b|,))/i },
  { key: 'bleeding', label: 'Bleeding', regex: /\b(?:bleeding|hemorrhage|haemorrhage)\b/i },
  { key: 'perforation', label: 'Perforation', regex: /\bperforation\b/i },
  { key: 'cholangitis', label: 'Cholangitis', regex: /\bcholangitis\b/i },
  { key: 'pancreatitis', label: 'Pancreatitis', regex: /\bpancreatitis\b/i },
  { key: 'mortality', label: 'Mortality', regex: /\b(?:mortality|death(?:s)?|30[- ]day\s+mortality)\b/i },
  { key: 'dysphagia', label: 'Dysphagia outcome', regex: /\b(?:dysphagia|gooss|gastrointestinal\s+obstruction\s+scoring\s+system)\b/i },
  { key: 'oral_intake', label: 'Oral intake', regex: /\boral\s+intake\b/i },
  { key: 'quality_of_life', label: 'Quality of life', regex: /\b(?:quality\s+of\s+life|QoL)\b/i },
];

function normalizeMarkdownForParsing(value: string): string {
  return String(value || '')
    .replace(/\\%/g, '%')
    .replace(/\\geq?|\$\\geq?\$|\\ge/g, '≥')
    .replace(/\\leq?|\$\\leq?\$|\\le/g, '≤')
    .replace(/\\pm|\$\\pm\$/g, '±')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/[–—−]/g, '-');
}

function stripMarkdown(value: string): string {
  return normalizeMarkdownForParsing(value)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function currentStudyBoundaryIndex(markdown: string): number {
  const discussion = markdown.search(/^#{1,6}\s+Discussion\b/im);
  const references = markdown.search(/^#{1,6}\s+References\b/im);
  const cuts = [discussion, references].filter((n) => n >= 0);
  return cuts.length ? Math.min(...cuts) : markdown.length;
}

function currentStudyMarkdown(markdown: string): string {
  const source = normalizeMarkdownForParsing(markdown);
  return source.slice(0, currentStudyBoundaryIndex(source));
}

function currentStudyResultsMarkdown(markdown: string): string {
  const source = currentStudyMarkdown(markdown);
  // Prefer the article-level Results heading (## Results). Abstract subsections are
  // commonly ### Results and must not open the extraction window, otherwise
  // intervening Methods definitions can be mistaken for outcomes.
  const articleResults = /^##\s+Results\b/im.exec(source);
  if (articleResults?.index != null) return source.slice(articleResults.index);

  const methodsMatches = [...source.matchAll(/^#{1,6}\s+Methods?\b/gim)];
  const methodsIndex = methodsMatches.length ? (methodsMatches[methodsMatches.length - 1].index ?? -1) : -1;
  const allResults = [...source.matchAll(/^#{1,6}\s+Results\b/gim)];
  const afterMethods = allResults.find((match) => (match.index ?? -1) > methodsIndex && methodsIndex >= 0);
  if (afterMethods?.index != null) return source.slice(afterMethods.index);

  // Without a distinguishable article-level Results section, do not scan the whole
  // document as Results. Confident current-study tables remain available instead.
  return '';
}

function pageAt(markdown: string, index: number): number | undefined {
  const prefix = markdown.slice(0, Math.max(0, index));
  const matches = [...prefix.matchAll(/<!--\s*PAGE:\s*(\d+)\s*-->/gi)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : undefined;
}

function splitMarkdownRow(line: string): string[] {
  const clean = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of clean) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableRows(block: string): string[][] {
  return block
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map(splitMarkdownRow)
    .filter((cells) => !isSeparatorRow(cells));
}

function parseTables(markdown: string): MarkdownTableBlock[] {
  const marker = /<!--\s*TABLE:\s*(.*?)\s*\|\s*reconstruction=(confident|uncertain)\s*-->/gi;
  const matches = [...markdown.matchAll(marker)];

  return matches.map((match, index) => {
    const startIndex = match.index ?? 0;
    const bodyStart = startIndex + match[0].length;
    const nextMarker = index + 1 < matches.length ? (matches[index + 1].index ?? markdown.length) : markdown.length;
    const nextPageMatch = /<!--\s*PAGE:\s*\d+\s*-->/i.exec(markdown.slice(bodyStart, nextMarker));
    const nextPageIndex = nextPageMatch?.index !== undefined ? bodyStart + nextPageMatch.index : nextMarker;
    const body = markdown.slice(bodyStart, Math.min(nextMarker, nextPageIndex));
    return {
      caption: String(match[1] || '').trim(),
      reconstruction: String(match[2]).toLowerCase() as 'confident' | 'uncertain',
      rows: parseTableRows(body),
      startIndex,
      pageNumber: pageAt(markdown, startIndex),
    };
  });
}

function isBaselineTable(caption: string): boolean {
  return /\b(?:baseline\s+characteristics?|patient\s+characteristics?|demographic(?:s|\s+characteristics?)?|baseline\s+demographics?)\b/i.test(caption);
}

function isLiteratureComparatorTable(table: MarkdownTableBlock): boolean {
  const clean = stripMarkdown(table.caption);
  if (/\b(?:previous|prior|published|selected|other)\s+stud(?:y|ies)\b|\bstud(?:y|ies)\s+of\b|\bliterature\b|\bsystematic\s+review\b|\bmeta[- ]analysis\b|\b(?:comparison|comparative)\b[^|]{0,80}\b(?:studies|reports|series)\b/i.test(clean)) {
    return true;
  }

  const header = (table.rows[0] || []).map(stripMarkdown);
  const firstHeader = header[0] || '';
  const authorHeader = /^(?:author|study|reference|first author)$/i.test(firstHeader);
  const containsLiteratureRows = table.rows.slice(1, 5).some((row) => /\bet\s+al\.?\b|\[\d+\]/i.test(stripMarkdown(row[0] || '')));
  return authorHeader && containsLiteratureRows;
}

function outcomePatternFor(text: string): { key: string; label: string } | undefined {
  const clean = stripMarkdown(text);
  return OUTCOME_PATTERNS.find((pattern) => pattern.regex.test(clean));
}

function hasTableNumericValue(value: string): boolean {
  const clean = stripMarkdown(value).replace(/,/g, '');
  if (!clean || /^(?:not reported|not assessable|unknown|n\/?a|na)$/i.test(clean)) return false;
  return /\d/.test(clean);
}

function hasNarrativeQuantitativeValue(value: string): boolean {
  const clean = stripMarkdown(value).replace(/,/g, '');
  return /(?:\bn\s*=\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%|\b(?:median|mean)\b[^.;\n]{0,80}\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:days?|weeks?|months?|years?)\b)/i.test(clean);
}

function tableHeaderNames(rows: string[][], width: number): string[] {
  const first = rows.find((row) => row.length >= width) || rows[0] || [];
  return first.slice(1, width).map((cell, index) => stripMarkdown(cell) || `Group ${index + 1}`);
}

function isGenericValueHeader(header: string): boolean {
  return /^(?:value|result|results|outcome|outcomes|overall|all\s+patients?|study\s+cohort|n\s*\(%\)|n|%)$/i.test(stripMarkdown(header));
}

function tableLocation(table: MarkdownTableBlock): string {
  return `${table.caption}${table.pageNumber ? `, Page ${table.pageNumber}` : ''}`;
}

function extractClinicalOutcomesFromTable(table: MarkdownTableBlock): MarkdownClinicalOutcomeEntry[] {
  if (table.reconstruction !== 'confident' || isBaselineTable(table.caption) || table.rows.length < 2) return [];

  const entries: MarkdownClinicalOutcomeEntry[] = [];
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex];
    if (row.length < 2) continue;
    const labelText = stripMarkdown(row[0] || '');
    const outcome = outcomePatternFor(labelText);
    if (!outcome) continue;

    const values = row.slice(1).map(stripMarkdown);
    const populated = values.map((value, index) => ({ value, index })).filter((item) => hasTableNumericValue(item.value));
    if (!populated.length) continue;

    const headers = tableHeaderNames(table.rows, row.length);
    for (const { value, index } of populated) {
      const rawHeader = headers[index] || '';
      const group = populated.length === 1 || isGenericValueHeader(rawHeader) ? 'Overall' : rawHeader;
      entries.push({
        key: outcome.key,
        label: labelText || outcome.label,
        group,
        value,
        quote: row.map(stripMarkdown).join(' | '),
        location: tableLocation(table),
        source: 'confident_current_study_table',
      });
    }
  }
  return entries;
}

function splitResultSentences(text: string): Array<{ sentence: string; index: number }> {
  const out: Array<{ sentence: string; index: number }> = [];
  const regex = /[^.!?\n]+(?:[.!?](?=\s|$)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const sentence = stripMarkdown(match[0]);
    if (sentence) out.push({ sentence, index: match.index });
  }
  return out;
}

function extractClinicalOutcomesFromNarrative(markdown: string): MarkdownClinicalOutcomeEntry[] {
  const resultsText = currentStudyResultsMarkdown(markdown);
  const entries: MarkdownClinicalOutcomeEntry[] = [];

  for (const { sentence, index } of splitResultSentences(resultsText)) {
    if (/\bdefined\s+(?:as|by)\b|\bprimary\s+endpoints?\b|\bsecondary\s+endpoints?\b/i.test(sentence)) continue;
    if (!hasNarrativeQuantitativeValue(sentence)) continue;
    const outcome = outcomePatternFor(sentence);
    if (!outcome) continue;

    const page = pageAt(resultsText, index);
    entries.push({
      key: outcome.key,
      label: outcome.label,
      group: 'Overall',
      value: sentence,
      quote: sentence,
      location: page ? `Results, Page ${page}` : 'Results',
      source: 'current_study_results_narrative',
    });
  }

  return entries;
}

function deduplicateClinicalEntries(entries: MarkdownClinicalOutcomeEntry[]): MarkdownClinicalOutcomeEntry[] {
  const seen = new Set<string>();
  const output: MarkdownClinicalOutcomeEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.key}|${entry.group}|${stripMarkdown(entry.value).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function formatClinicalSummary(entries: MarkdownClinicalOutcomeEntry[]): string {
  return entries.slice(0, 12).map((entry) => {
    const groupPrefix = entry.group && entry.group !== 'Overall' ? `${entry.group} — ` : '';
    return `${groupPrefix}${entry.label}: ${entry.value}`;
  }).join('\n');
}

export function extractMarkdownClinicalOutcomeEvidence(markdown: string): MarkdownClinicalOutcomeEvidence | undefined {
  const source = normalizeMarkdownForParsing(markdown || '');
  if (!source.trim()) return undefined;
  const tableEntries = parseTables(source)
    // A current-study table can be emitted after a Discussion heading because
    // two-column PDF reading order is imperfect. Keep confident tables unless
    // their caption explicitly signals a literature/comparator summary.
    .filter((table) => !isLiteratureComparatorTable(table))
    .flatMap(extractClinicalOutcomesFromTable);
  const tableKeys = new Set(tableEntries.map((entry) => entry.key));
  const narrativeEntries = extractClinicalOutcomesFromNarrative(source)
    .filter((entry) => !tableKeys.has(entry.key));
  const entries = deduplicateClinicalEntries([...tableEntries, ...narrativeEntries]);
  if (!entries.length) return undefined;

  const preferred = entries.filter((entry) => entry.source === 'confident_current_study_table');
  const evidenceEntries = preferred.length ? preferred : entries;
  const quote = Array.from(new Set(evidenceEntries.slice(0, 6).map((entry) => entry.quote))).join('\n');
  const location = Array.from(new Set(evidenceEntries.slice(0, 6).map((entry) => entry.location))).join(', ');

  return {
    entries,
    formattedSummary: formatClinicalSummary(entries),
    quote,
    location: location || 'Results',
    confidence: preferred.length ? 'High' : 'Medium',
  };
}

export function extractMarkdownAppraisalEvidence(markdown: string): MarkdownAppraisalEvidence {
  const source = normalizeMarkdownForParsing(markdown || '');
  const statisticalSource = source
    .replace(/<!--\s*PAGE:\s*\d+\s*-->/gi, '\n')
    .replace(/<!--\s*TABLE:[\s\S]*?-->/gi, '\n')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1.');
  return {
    statistical: detectStatisticalEvidence(statisticalSource, {}),
    clinicalOutcomes: extractMarkdownClinicalOutcomeEvidence(source),
  };
}

function meaningful(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return Boolean(text) && !/^(?:not reported|not assessable|unknown|n\/?a|na)$/i.test(text);
}

function formatStatisticalValue(evidence: StatisticalEvidenceResult): string {
  if (!evidence.reported) return 'Not reported';
  const parts = [
    evidence.detectedSoftware.length ? `Software: ${evidence.detectedSoftware.join(', ')}` : '',
    evidence.detectedMethods.length ? `Methods: ${evidence.detectedMethods.join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'Statistical methods reported';
}

export function reconcileStatisticalEvidence(
  pdfEvidence: StatisticalEvidenceResult,
  markdownEvidence: StatisticalEvidenceResult,
  markdownAvailable: boolean
): { evidence: StatisticalEvidenceResult; validation: AppraisalEvidenceValidationItem } {
  const pdfReported = pdfEvidence.reported;
  const mdReported = markdownAvailable && markdownEvidence.reported;

  if (pdfReported && mdReported) {
    const detectedSoftware = Array.from(new Set([...pdfEvidence.detectedSoftware, ...markdownEvidence.detectedSoftware]));
    const detectedMethods = Array.from(new Set([...pdfEvidence.detectedMethods, ...markdownEvidence.detectedMethods]));
    const detectedBy = Array.from(new Set([...pdfEvidence.detectedBy, ...markdownEvidence.detectedBy])) as StatisticalEvidenceResult['detectedBy'];
    const evidence: StatisticalEvidenceResult = {
      ...pdfEvidence,
      detectedSoftware,
      detectedMethods,
      detectedBy,
      comment: `${pdfEvidence.comment} Markdown cross-check confirmed statistical evidence${detectedSoftware.length || detectedMethods.length ? ` (${[
        detectedSoftware.length ? `software: ${detectedSoftware.join(', ')}` : '',
        detectedMethods.length ? `methods: ${detectedMethods.join(', ')}` : '',
      ].filter(Boolean).join('; ')})` : ''}.`,
    };
    return {
      evidence,
      validation: {
        status: 'validated',
        pdfValue: formatStatisticalValue(pdfEvidence),
        markdownValue: formatStatisticalValue(markdownEvidence),
        selectedValue: formatStatisticalValue(evidence),
        evidenceQuote: markdownEvidence.evidenceQuote,
        evidenceLocation: markdownEvidence.evidenceLocation,
        note: 'PDF/Gemini evidence and Markdown independently confirm that statistical methods or statistical software are reported. Statistical software alone remains sufficient under the configured rule.',
      },
    };
  }

  if (mdReported) {
    return {
      evidence: {
        ...markdownEvidence,
        comment: `${markdownEvidence.comment} Recovered from Markdown cross-check; statistical software alone is sufficient under the configured rule.`,
      },
      validation: {
        status: 'md_only',
        pdfValue: 'Not reported',
        markdownValue: formatStatisticalValue(markdownEvidence),
        selectedValue: formatStatisticalValue(markdownEvidence),
        evidenceQuote: markdownEvidence.evidenceQuote,
        evidenceLocation: markdownEvidence.evidenceLocation,
        note: 'Statistical evidence was recovered from current-study Markdown and selected for appraisal scoring.',
      },
    };
  }

  if (pdfReported) {
    return {
      evidence: pdfEvidence,
      validation: {
        status: 'pdf_only',
        pdfValue: formatStatisticalValue(pdfEvidence),
        markdownValue: markdownAvailable ? 'Not reported' : 'Not available',
        selectedValue: formatStatisticalValue(pdfEvidence),
        evidenceQuote: pdfEvidence.evidenceQuote,
        evidenceLocation: pdfEvidence.evidenceLocation,
        note: markdownAvailable
          ? 'No independent Markdown statistical evidence was detected; existing PDF/Gemini statistical evidence was retained.'
          : 'Markdown was not available; existing PDF/Gemini statistical evidence was retained.',
      },
    };
  }

  return {
    evidence: pdfEvidence,
    validation: {
      status: 'not_available',
      pdfValue: 'Not reported',
      markdownValue: markdownAvailable ? 'Not reported' : 'Not available',
      selectedValue: 'Not reported',
      evidenceQuote: '',
      evidenceLocation: '',
      note: 'No statistical method, statistical software, or qualifying statistical methodology was detected in either source.',
    },
  };
}

function normalizeOutcomeText(value: string): string {
  return stripMarkdown(value).toLowerCase().replace(/[^a-z0-9%./=<>≥≤+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function outcomeKeysInText(value: string): string[] {
  const clean = stripMarkdown(value);
  return OUTCOME_PATTERNS.filter((pattern) => pattern.regex.test(clean)).map((pattern) => pattern.key);
}

function numericTokens(value: string): string[] {
  const clean = normalizeOutcomeText(value).replace(/,/g, '');
  return Array.from(clean.matchAll(/\b\d+(?:\.\d+)?(?:\s*%|\s*\/\s*\d+)?\b/g)).map((match) => match[0].replace(/\s+/g, ''));
}

export function isQuantitativeClinicalOutcomeText(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!meaningful(text)) return false;
  return outcomeKeysInText(text).length > 0 && /\d/.test(text);
}

export function reconcileClinicalOutcomeEvidence(
  pdfCandidates: unknown[],
  markdownEvidence?: MarkdownClinicalOutcomeEvidence,
  markdownAvailable = false
): AppraisalEvidenceValidationItem {
  const pdfTexts = pdfCandidates
    .map((value) => String(value ?? '').trim())
    .filter((value) => isQuantitativeClinicalOutcomeText(value));
  const pdfValue = Array.from(new Set(pdfTexts)).join('\n');
  const mdReported = Boolean(markdownEvidence?.entries.length);
  const mdValue = markdownEvidence?.formattedSummary || '';

  if (pdfTexts.length && mdReported && markdownEvidence) {
    const pdfKeys = new Set(pdfTexts.flatMap(outcomeKeysInText));
    const mdKeys = new Set(markdownEvidence.entries.map((entry) => entry.key));
    const sharedKeys = Array.from(pdfKeys).filter((key) => mdKeys.has(key));
    const pdfNumbers = new Set(pdfTexts.flatMap(numericTokens));
    const mdNumbers = new Set(markdownEvidence.entries.flatMap((entry) => numericTokens(`${entry.label} ${entry.value}`)));
    const sharedNumbers = Array.from(pdfNumbers).filter((value) => mdNumbers.has(value));
    const directlyValidated = sharedKeys.length > 0 && sharedNumbers.length > 0;

    return {
      status: directlyValidated ? 'validated' : 'supplemented',
      pdfValue,
      markdownValue: mdValue,
      selectedValue: mdValue,
      evidenceQuote: markdownEvidence.quote,
      evidenceLocation: markdownEvidence.location,
      note: directlyValidated
        ? 'PDF/Gemini outcome extraction and confident current-study Markdown outcome evidence overlap on endpoint type and quantitative value. Markdown structured evidence was selected for Step 3 display/scoring.'
        : 'Both sources contain quantitative current-study outcomes but emphasize different endpoints or values. Markdown structured outcomes supplement the PDF/Gemini extraction; no pooling or arithmetic reconciliation was performed.',
    };
  }

  if (mdReported && markdownEvidence) {
    return {
      status: 'md_only',
      pdfValue: 'Not reported',
      markdownValue: mdValue,
      selectedValue: mdValue,
      evidenceQuote: markdownEvidence.quote,
      evidenceLocation: markdownEvidence.location,
      note: 'Quantitative current-study clinical outcome evidence was recovered from confident Markdown tables or Results narrative.',
    };
  }

  if (pdfTexts.length) {
    return {
      status: 'pdf_only',
      pdfValue,
      markdownValue: markdownAvailable ? 'Not reported' : 'Not available',
      selectedValue: pdfValue,
      evidenceQuote: pdfTexts[0],
      evidenceLocation: 'Results / Tables',
      note: markdownAvailable
        ? 'No trusted quantitative Markdown outcome evidence was detected; existing PDF/Gemini outcome extraction was retained.'
        : 'Markdown was not available; existing PDF/Gemini outcome extraction was retained.',
    };
  }

  return {
    status: 'not_available',
    pdfValue: 'Not reported',
    markdownValue: markdownAvailable ? 'Not reported' : 'Not available',
    selectedValue: 'Not reported',
    evidenceQuote: '',
    evidenceLocation: '',
    note: 'No quantitative current-study clinical outcome was detected in either source.',
  };
}
