export type MarkdownEvidenceConfidence = 'High' | 'Medium';
export type DemographicValidationStatus = 'validated' | 'md_only' | 'conflict' | 'pdf_only' | 'not_available';

export interface MarkdownPatientCountEvidence {
  value: number;
  quote: string;
  location: string;
  confidence: MarkdownEvidenceConfidence;
  source: 'confident_baseline_table' | 'current_study_narrative';
}

export interface MarkdownGenderEvidence {
  formattedDistribution: string;
  male?: number;
  female?: number;
  total?: number;
  quote: string;
  location: string;
  confidence: MarkdownEvidenceConfidence;
  source: 'confident_baseline_table' | 'current_study_narrative';
}

export interface MarkdownFollowUpEntry {
  group: string;
  formattedValue: string;
  centralValue?: number;
  unit?: 'days' | 'weeks' | 'months' | 'years';
  statistic: 'median' | 'mean' | 'reported';
  quote: string;
  location: string;
}

export interface MarkdownFollowUpEvidence {
  formattedDuration: string;
  entries: MarkdownFollowUpEntry[];
  quote: string;
  location: string;
  confidence: MarkdownEvidenceConfidence;
  source: 'confident_followup_table' | 'current_study_narrative';
}

export interface MarkdownDemographicEvidence {
  patientCount?: MarkdownPatientCountEvidence;
  gender?: MarkdownGenderEvidence;
  followUp?: MarkdownFollowUpEvidence;
  trustedTableCount: number;
  uncertainTableCount: number;
}

export interface DemographicValidationItem {
  status: DemographicValidationStatus;
  pdfValue: string;
  markdownValue: string;
  selectedValue: string;
  evidenceQuote: string;
  evidenceLocation: string;
  note: string;
}

interface MarkdownTableBlock {
  caption: string;
  reconstruction: 'confident' | 'uncertain';
  markdown: string;
  startIndex: number;
  pageNumber?: number;
  rows: string[][];
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function normalizeMarkdownForParsing(value: string): string {
  return String(value || '')
    .replace(/\\%/g, '%')
    .replace(/\\geq?|\$\\geq?\$|\\ge/g, '≥')
    .replace(/\\leq?|\$\\leq?\$|\\le/g, '≤')
    .replace(/\\pm|\$\\pm\$/g, '±')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/[–—−]/g, '-')
    .replace(/<sup>\s*([^<]+?)\s*<\/sup>/gi, '⁽$1⁾');
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
      markdown: body,
      startIndex,
      pageNumber: pageAt(markdown, startIndex),
      rows: parseTableRows(body),
    };
  });
}

function currentStudyMarkdown(markdown: string): string {
  const source = normalizeMarkdownForParsing(markdown);
  const discussion = source.search(/^#{1,6}\s+Discussion\b/im);
  const references = source.search(/^#{1,6}\s+References\b/im);
  const cuts = [discussion, references].filter((n) => n >= 0);
  return cuts.length ? source.slice(0, Math.min(...cuts)) : source;
}

function isBaselineCaption(caption: string): boolean {
  return /\b(?:baseline\s+characteristics?|patient\s+characteristics?|demographic(?:s|\s+characteristics?)?|baseline\s+demographics?)\b/i.test(caption);
}

function stripMarkdown(value: string): string {
  return normalizeMarkdownForParsing(value)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumericToken(raw: string): number | undefined {
  const clean = stripMarkdown(raw).replace(/,/g, '');
  const m = clean.match(/\b(\d{1,6})\b/);
  if (!m) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseWordOrDigit(raw: string): number | undefined {
  const clean = String(raw || '').toLowerCase().trim();
  if (/^\d+$/.test(clean)) return Number(clean);
  return NUMBER_WORDS[clean];
}

function tableLocation(table: MarkdownTableBlock): string {
  return `${table.caption}${table.pageNumber ? `, Page ${table.pageNumber}` : ''}`;
}

function findSingleStudyNFromBaselineTable(table: MarkdownTableBlock): MarkdownPatientCountEvidence | undefined {
  if (table.reconstruction !== 'confident' || !isBaselineCaption(table.caption)) return undefined;

  for (const row of table.rows) {
    if (row.length < 2) continue;
    const label = stripMarkdown(row[0]);
    if (!/^(?:number\s+of\s+patients(?:,?\s*n)?|total\s+(?:number\s+of\s+)?patients(?:,?\s*n)?|sample\s+size(?:,?\s*n)?|patients?,?\s*n)$/i.test(label)) {
      continue;
    }

    const populatedValues = row.slice(1).map(stripMarkdown).filter(Boolean);
    if (populatedValues.length !== 1) continue;
    const value = parseNumericToken(populatedValues[0]);
    if (!value || value <= 0) continue;

    return {
      value,
      quote: row.join(' | '),
      location: tableLocation(table),
      confidence: 'High',
      source: 'confident_baseline_table',
    };
  }
  return undefined;
}

function findPatientNFromNarrative(markdown: string): MarkdownPatientCountEvidence | undefined {
  const source = currentStudyMarkdown(markdown);
  const patterns = [
    /\b(\d{1,5})\s+(?:consecutive\s+)?patients?\s+(?:were\s+)?(?:included|enrolled|recruited|analy[sz]ed)\b/i,
    /\b(?:included|enrolled|recruited|analy[sz]ed)\s+(\d{1,5})\s+(?:consecutive\s+)?patients?\b/i,
    /\b(?:study|cohort)\s+(?:included|comprised|consisted\s+of)\s+(\d{1,5})\s+patients?\b/i,
    /\b(\d{1,5})\s+patients?\s+(?:with|who)\b[^.\n]{0,140}\b(?:underwent|received|were\s+treated)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    return {
      value,
      quote: match[0].trim(),
      location: pageAt(source, match.index ?? 0) ? `Current-study narrative, Page ${pageAt(source, match.index ?? 0)}` : 'Current-study narrative',
      confidence: 'High',
      source: 'current_study_narrative',
    };
  }

  return undefined;
}

interface SexMetric {
  n: number;
  pct?: string;
}

function parseSexMetric(cell: string, knownTotal?: number): SexMetric | undefined {
  const clean = stripMarkdown(cell);

  const fraction = clean.match(/\b(\d+)\s*\/\s*(\d+)\b(?:\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\))?/);
  if (fraction) return { n: Number(fraction[1]), pct: fraction[3] };

  const pair = clean.match(/\b(\d+(?:\.\d+)?)\s*%?\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/);
  if (pair) {
    const first = Number(pair[1]);
    const second = Number(pair[2]);
    const firstIsPct = /\./.test(pair[1]) && Number.isInteger(second) && (!knownTotal || second <= knownTotal);
    if (firstIsPct || (knownTotal && first > knownTotal && second <= knownTotal)) {
      return { n: second, pct: pair[1] };
    }
    return { n: first, pct: pair[2] };
  }

  const explicitN = clean.match(/\bn\s*=\s*(\d+)\b/i);
  if (explicitN) return { n: Number(explicitN[1]) };

  const integer = clean.match(/\b(\d+)\b/);
  if (integer) return { n: Number(integer[1]) };
  return undefined;
}

function parseHeaderNames(rows: string[][], width: number): string[] {
  const first = rows.find((row) => row.length >= width) || rows[0] || [];
  const names = first.slice(1, width).map((cell, index) => stripMarkdown(cell) || `Group ${index + 1}`);
  return names;
}

function baselineTableHasGenderRow(table: MarkdownTableBlock): boolean {
  return table.rows.some((row) =>
    /^(?:sex[\s,:-]*(?:male|female)|gender[\s,:-]*(?:male|female)|male|men|female|women)(?:\b|,)/i.test(
      stripMarkdown(row[0] || '')
    )
  );
}

function isSexMetricConsistent(
  metric: { n: number; pct?: string } | undefined,
  total?: number
): boolean {
  if (!metric) return true;
  if (!Number.isFinite(metric.n) || metric.n < 0) return false;
  const pct = metric.pct !== undefined ? Number(metric.pct) : undefined;
  if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return false;
  if (!total || total <= 0) return true;
  if (metric.n > total) return false;

  // Reject a clear shifted-cell failure such as Total N=62 + Male=62 (56%).
  // Other papers may legitimately show a parent-row share in parentheses for a
  // child cohort (e.g. Male 21 (51) with subgroup N=35). In that case the count
  // remains usable, but the percentage is stripped later rather than causing the
  // entire confident baseline table to be rejected.
  if (pct !== undefined) {
    const calculated = (metric.n / total) * 100;
    const mismatch = Math.abs(calculated - pct);
    if (mismatch > 1.5 && ((metric.n === total && pct < 98.5) || (metric.n === 0 && pct > 1.5))) {
      return false;
    }
  }
  return true;
}

function normalizeSexMetricForTotal(
  metric: { n: number; pct?: string } | undefined,
  total?: number
): { n: number; pct?: string } | undefined {
  if (!metric) return undefined;
  if (!total || total <= 0 || metric.pct === undefined) return metric;
  const pct = Number(metric.pct);
  if (!Number.isFinite(pct)) return { n: metric.n };
  const calculated = (metric.n / total) * 100;
  return Math.abs(calculated - pct) <= 1.5 ? metric : { n: metric.n };
}

function areGenderMetricsConsistent(
  male: { n: number; pct?: string } | undefined,
  female: { n: number; pct?: string } | undefined,
  total: number | undefined,
  hasUnknownCategory: boolean
): boolean {
  if (!isSexMetricConsistent(male, total) || !isSexMetricConsistent(female, total)) return false;
  if (total && male && female && !hasUnknownCategory && male.n + female.n !== total) return false;
  return true;
}

function findGenderFromBaselineTable(
  table: MarkdownTableBlock,
  patientCount?: MarkdownPatientCountEvidence
): MarkdownGenderEvidence | undefined {
  if (table.reconstruction !== 'confident' || !isBaselineCaption(table.caption)) return undefined;

  const maleRow = table.rows.find((row) => /^(?:sex[,\s:-]*male|gender[,\s:-]*male|male|men)(?:\b|,)/i.test(stripMarkdown(row[0] || '')));
  const femaleRow = table.rows.find((row) => /^(?:sex[,\s:-]*female|gender[,\s:-]*female|female|women)(?:\b|,)/i.test(stripMarkdown(row[0] || '')));
  if (!maleRow && !femaleRow) return undefined;

  const patientRow = table.rows.find((row) => /^(?:number\s+of\s+patients|total\s+(?:number\s+of\s+)?patients|sample\s+size|patients?,?\s*n)(?:\b|,)/i.test(stripMarkdown(row[0] || '')));
  const valueWidth = Math.max(maleRow?.length || 0, femaleRow?.length || 0, patientRow?.length || 0);
  const groupCount = Math.max(1, valueWidth - 1);

  const totals = Array.from({ length: groupCount }, (_, i) => {
    const fromPatientRow = patientRow ? parseNumericToken(patientRow[i + 1] || '') : undefined;
    if (groupCount === 1) return fromPatientRow || patientCount?.value;
    return fromPatientRow;
  });

  const parsedMales = Array.from({ length: groupCount }, (_, i) => maleRow ? parseSexMetric(maleRow[i + 1] || '', totals[i]) : undefined);
  const parsedFemales = Array.from({ length: groupCount }, (_, i) => femaleRow ? parseSexMetric(femaleRow[i + 1] || '', totals[i]) : undefined);
  const hasUnknownCategory = table.rows.some((row) => /^(?:unknown|other|non[- ]?binary)(?:\b|,)/i.test(stripMarkdown(row[0] || '')));

  // Do not trust a table merely because Gemini labelled its reconstruction as
  // confident. Cross-check each sex count against the group N. A clearly shifted
  // cell is rejected; a percentage that appears to use a different parent
  // denominator is discarded while preserving the directly reported count.
  for (let i = 0; i < groupCount; i++) {
    if (!areGenderMetricsConsistent(parsedMales[i], parsedFemales[i], totals[i], hasUnknownCategory)) {
      return undefined;
    }
  }
  const males = parsedMales.map((metric, i) => normalizeSexMetricForTotal(metric, totals[i]));
  const females = parsedFemales.map((metric, i) => normalizeSexMetricForTotal(metric, totals[i]));

  const headers = parseHeaderNames(table.rows, valueWidth);
  const outputs: string[] = [];

  for (let i = 0; i < groupCount; i++) {
    let male = males[i];
    let female = females[i];
    const total = totals[i];

    if (!hasUnknownCategory && total && male && !female && male.n <= total) {
      female = { n: total - male.n };
    }
    if (!hasUnknownCategory && total && female && !male && female.n <= total) {
      male = { n: total - female.n };
    }
    if (!male && !female) continue;

    const maleText = male ? `Male: n = ${male.n}${male.pct ? ` (${male.pct}%)` : ''}` : 'Male: Not reported';
    const femaleText = female ? `Female: n = ${female.n}${female.pct ? ` (${female.pct}%)` : ''}` : 'Female: Not reported';
    const prefix = groupCount > 1 ? `${headers[i] || `Group ${i + 1}`} — ` : '';
    outputs.push(`${prefix}${maleText}, ${femaleText}`);
  }

  if (!outputs.length) return undefined;

  const singleMale = groupCount === 1 ? males[0]?.n : undefined;
  const derivedFemale = groupCount === 1 && totals[0] && singleMale !== undefined && !females[0] && !hasUnknownCategory
    ? totals[0]! - singleMale
    : undefined;
  const singleFemale = groupCount === 1 ? (females[0]?.n ?? derivedFemale) : undefined;

  return {
    formattedDistribution: outputs.join('\n'),
    male: singleMale,
    female: singleFemale,
    total: groupCount === 1 ? totals[0] : undefined,
    quote: [maleRow?.join(' | '), femaleRow?.join(' | '), patientRow?.join(' | ')].filter(Boolean).join(' ; '),
    location: tableLocation(table),
    confidence: 'High',
    source: 'confident_baseline_table',
  };
}

function findGenderFromNarrative(
  markdown: string,
  patientCount?: MarkdownPatientCountEvidence
): MarkdownGenderEvidence | undefined {
  const source = currentStudyMarkdown(markdown);
  const token = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

  const both = new RegExp(`\\b(${token})\\s+(?:men|males?)\\s*(?:,|and)\\s*(${token})\\s+(?:women|females?)\\b`, 'i').exec(source)
    || new RegExp(`\\b(${token})\\s+(?:women|females?)\\s*(?:,|and)\\s*(${token})\\s+(?:men|males?)\\b`, 'i').exec(source);

  if (both) {
    const phrase = both[0];
    const first = parseWordOrDigit(both[1]);
    const second = parseWordOrDigit(both[2]);
    if (first !== undefined && second !== undefined) {
      const femaleFirst = /women|female/i.test(phrase.split(/,|and/i)[0] || '');
      const male = femaleFirst ? second : first;
      const female = femaleFirst ? first : second;
      return {
        formattedDistribution: `Male: n = ${male}, Female: n = ${female}`,
        male,
        female,
        total: male + female,
        quote: phrase,
        location: pageAt(source, both.index ?? 0) ? `Patient characteristics / Results, Page ${pageAt(source, both.index ?? 0)}` : 'Patient characteristics / Results',
        confidence: 'High',
        source: 'current_study_narrative',
      };
    }
  }

  const maleMatch = new RegExp(`\\b(${token})\\s+(?:men|males?)\\b`, 'i').exec(source);
  const femaleMatch = new RegExp(`\\b(${token})\\s+(?:women|females?)\\b`, 'i').exec(source);
  const total = patientCount?.value;

  if (maleMatch) {
    const male = parseWordOrDigit(maleMatch[1]);
    if (male !== undefined) {
      const female = total && male <= total ? total - male : undefined;
      return {
        formattedDistribution: female !== undefined ? `Male: n = ${male}, Female: n = ${female} [derived from baseline N=${total}]` : `Male: n = ${male}, Female: Not reported`,
        male,
        female,
        total,
        quote: maleMatch[0],
        location: pageAt(source, maleMatch.index ?? 0) ? `Patient characteristics / Results, Page ${pageAt(source, maleMatch.index ?? 0)}` : 'Patient characteristics / Results',
        confidence: total ? 'High' : 'Medium',
        source: 'current_study_narrative',
      };
    }
  }

  if (femaleMatch) {
    const female = parseWordOrDigit(femaleMatch[1]);
    if (female !== undefined) {
      const male = total && female <= total ? total - female : undefined;
      return {
        formattedDistribution: male !== undefined ? `Male: n = ${male} [derived from baseline N=${total}], Female: n = ${female}` : `Male: Not reported, Female: n = ${female}`,
        male,
        female,
        total,
        quote: femaleMatch[0],
        location: pageAt(source, femaleMatch.index ?? 0) ? `Patient characteristics / Results, Page ${pageAt(source, femaleMatch.index ?? 0)}` : 'Patient characteristics / Results',
        confidence: total ? 'High' : 'Medium',
        source: 'current_study_narrative',
      };
    }
  }

  return undefined;
}


function currentStudyBoundaryIndex(markdown: string): number {
  const discussion = markdown.search(/^#{1,6}\s+Discussion\b/im);
  const references = markdown.search(/^#{1,6}\s+References\b/im);
  const cuts = [discussion, references].filter((n) => n >= 0);
  return cuts.length ? Math.min(...cuts) : markdown.length;
}

function normalizeTimeUnit(raw: string): 'days' | 'weeks' | 'months' | 'years' | undefined {
  const unit = String(raw || '').toLowerCase();
  if (/^day/.test(unit)) return 'days';
  if (/^week/.test(unit)) return 'weeks';
  if (/^month/.test(unit)) return 'months';
  if (/^year/.test(unit)) return 'years';
  return undefined;
}

function inferFollowUpStatistic(text: string): 'median' | 'mean' | 'reported' {
  if (/\bmedian\b/i.test(text)) return 'median';
  if (/\bmean\b/i.test(text)) return 'mean';
  return 'reported';
}

function isDirectFollowUpLabel(text: string): boolean {
  const clean = stripMarkdown(text);
  if (!/\bfollow[- ]?up\b|\bobservation(?:al)?\s+period\b/i.test(clean)) return false;
  // These are different longitudinal endpoints and must never be promoted to true follow-up.
  if (/\boverall\s+survival\b|\bstent\s+patency\b|\bpatency\s+duration\b|\btime\s+to\s+(?:rbo|recurrent|obstruction)|\bdysfunction[- ]?free\b/i.test(clean)) {
    return false;
  }
  return true;
}

function extractCentralFollowUpValue(label: string, value: string): { value?: number; unit?: 'days' | 'weeks' | 'months' | 'years' } {
  const cleanLabel = stripMarkdown(label);
  const cleanValue = stripMarkdown(value);
  const unitFromLabel = cleanLabel.match(/\b(days?|weeks?|months?|years?)\b/i)?.[1];
  const unitFromValue = cleanValue.match(/\b(days?|weeks?|months?|years?)\b/i)?.[1];
  const unit = normalizeTimeUnit(unitFromValue || unitFromLabel || '');
  const numberMatch = cleanValue.replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\b/);
  return {
    value: numberMatch ? Number(numberMatch[1]) : undefined,
    unit,
  };
}

function formatFollowUpValue(label: string, rawValue: string): string {
  const cleanLabel = stripMarkdown(label);
  const cleanValue = stripMarkdown(rawValue);
  const parsed = extractCentralFollowUpValue(cleanLabel, cleanValue);
  const stat = inferFollowUpStatistic(`${cleanLabel} ${cleanValue}`);
  const statPrefix = stat === 'reported' ? '' : `${stat[0].toUpperCase()}${stat.slice(1)} `;
  const central = parsed.value;
  const unit = parsed.unit;

  if (central !== undefined && unit) {
    const interval = cleanValue.match(/[\[(]\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*[\])]/);
    const intervalKind = /95\s*%\s*CI/i.test(cleanLabel) ? '95% CI' : /\bIQR\b/i.test(cleanLabel) ? 'IQR' : /\brange\b/i.test(cleanLabel) ? 'range' : '';
    if (interval) {
      return `${statPrefix}follow-up: ${central} ${unit}${intervalKind ? ` (${intervalKind} ${interval[1]}-${interval[2]})` : ` (${interval[1]}-${interval[2]})`}`;
    }
    return `${statPrefix}follow-up: ${central} ${unit}`;
  }

  return `${statPrefix}follow-up: ${cleanValue || cleanLabel}`.trim();
}

function findFollowUpFromConfidentTable(table: MarkdownTableBlock): MarkdownFollowUpEvidence | undefined {
  if (table.reconstruction !== 'confident') return undefined;
  const followRow = table.rows.find((row) => row.length >= 2 && isDirectFollowUpLabel(row[0] || ''));
  if (!followRow) return undefined;

  const width = followRow.length;
  const headers = parseHeaderNames(table.rows, width);
  const values = followRow.slice(1).map((cell) => stripMarkdown(cell));
  const populated = values.map((value, index) => ({ value, index })).filter((item) => Boolean(item.value));
  if (!populated.length) return undefined;

  const entries: MarkdownFollowUpEntry[] = populated.map(({ value, index }) => {
    const label = stripMarkdown(followRow[0] || 'Follow-up');
    const parsed = extractCentralFollowUpValue(label, value);
    const statistic = inferFollowUpStatistic(`${label} ${value}`);
    const header = headers[index] || '';
    const genericHeader = /^(?:value|result|results|overall|all\s+patients?|study\s+cohort|group\s+\d+)$/i.test(header);
    const group = populated.length === 1 || genericHeader ? 'Overall' : header;
    const formattedCore = formatFollowUpValue(label, value);
    return {
      group,
      formattedValue: group === 'Overall' ? formattedCore : `${group} — ${formattedCore}`,
      centralValue: parsed.value,
      unit: parsed.unit,
      statistic,
      quote: followRow.join(' | '),
      location: tableLocation(table),
    };
  });

  return {
    formattedDuration: entries.map((entry) => entry.formattedValue).join('\n'),
    entries,
    quote: followRow.join(' | '),
    location: tableLocation(table),
    confidence: 'High',
    source: 'confident_followup_table',
  };
}

function sentenceAroundIndex(text: string, index: number): string {
  const left = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('\n', index));
  const nextDot = text.indexOf('.', index);
  const nextNewline = text.indexOf('\n', index);
  const rightCandidates = [nextDot, nextNewline].filter((n) => n >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) + 1 : Math.min(text.length, index + 320);
  return stripMarkdown(text.slice(left >= 0 ? left + 1 : Math.max(0, index - 120), right));
}

function findFollowUpFromNarrative(markdown: string): MarkdownFollowUpEvidence | undefined {
  const source = currentStudyMarkdown(markdown);
  const patterns = [
    /\b(?:median|mean)\s+follow[- ]?up\s+(?:period|duration)?\s*(?:was|of|:)?\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i,
    /\bfollow[- ]?up\s+(?:period|duration)?\s*(?:was|of|:)?\s*(?:a\s+)?(?:median|mean)?\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i,
    /\b(?:patients?|participants?|subjects?)\s+were\s+followed(?:\s+up)?\s+for\s+(?:a\s+)?(?:median|mean)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i,
    /\bfollowed(?:\s+up)?\s+for\s+(?:a\s+)?(?:median|mean)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const sentence = sentenceAroundIndex(source, match.index ?? 0);
    if (!isDirectFollowUpLabel(sentence) && !/\bfollowed(?:\s+up)?\s+for\b/i.test(sentence)) continue;
    const value = Number(match[1]);
    const unit = normalizeTimeUnit(match[2]);
    if (!Number.isFinite(value) || !unit) continue;
    const statistic = inferFollowUpStatistic(sentence);
    const entry: MarkdownFollowUpEntry = {
      group: 'Overall',
      formattedValue: `${statistic === 'reported' ? '' : `${statistic[0].toUpperCase()}${statistic.slice(1)} `}follow-up: ${value} ${unit}`,
      centralValue: value,
      unit,
      statistic,
      quote: sentence,
      location: pageAt(source, match.index ?? 0) ? `Methods / Results, Page ${pageAt(source, match.index ?? 0)}` : 'Methods / Results',
    };
    return {
      formattedDuration: entry.formattedValue,
      entries: [entry],
      quote: sentence,
      location: entry.location,
      confidence: 'High',
      source: 'current_study_narrative',
    };
  }

  return undefined;
}

function parseFollowUpCandidates(value: unknown): Array<{ value: number; unit: 'days' | 'weeks' | 'months' | 'years' }> {
  const source = normalizeMarkdownForParsing(String(value ?? '')).replace(/,/g, '');
  if (!source || /not\s+reported|n\/a|unknown/i.test(source)) return [];
  const out: Array<{ value: number; unit: 'days' | 'weeks' | 'months' | 'years' }> = [];
  const regex = /(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const unit = normalizeTimeUnit(match[2]);
    const num = Number(match[1]);
    if (unit && Number.isFinite(num)) out.push({ value: num, unit });
  }
  return out;
}

function followUpCandidatesMatch(
  pdfCandidates: Array<{ value: number; unit: 'days' | 'weeks' | 'months' | 'years' }>,
  mdEntries: MarkdownFollowUpEntry[]
): boolean {
  const mdCandidates = mdEntries
    .filter((entry) => entry.centralValue !== undefined && entry.unit)
    .map((entry) => ({ value: entry.centralValue as number, unit: entry.unit as 'days' | 'weeks' | 'months' | 'years' }));
  if (!pdfCandidates.length || !mdCandidates.length) return false;
  return mdCandidates.some((md) => pdfCandidates.some((pdf) => pdf.unit === md.unit && Math.abs(pdf.value - md.value) < 0.001));
}

export function validateFollowUpEvidence(
  pdfValue: unknown,
  mdEvidence?: MarkdownFollowUpEvidence
): DemographicValidationItem {
  const rawPdf = String(pdfValue ?? '').trim();
  const pdfReported = Boolean(rawPdf) && !/not\s+reported|n\/a|unknown/i.test(rawPdf);
  const pdfCandidates = parseFollowUpCandidates(rawPdf);
  const mdReported = Boolean(mdEvidence?.formattedDuration && mdEvidence.entries.length > 0);

  if (pdfReported && mdReported && mdEvidence) {
    const matches = followUpCandidatesMatch(pdfCandidates, mdEvidence.entries)
      || stripMarkdown(rawPdf).toLowerCase().includes(stripMarkdown(mdEvidence.formattedDuration).toLowerCase());
    return {
      status: matches ? 'validated' : 'conflict',
      pdfValue: rawPdf,
      markdownValue: mdEvidence.formattedDuration,
      selectedValue: mdEvidence.formattedDuration,
      evidenceQuote: mdEvidence.quote,
      evidenceLocation: mdEvidence.location,
      note: matches
        ? 'PDF/Gemini follow-up extraction and explicit current-study Markdown follow-up evidence agree.'
        : 'PDF/Gemini follow-up extraction conflicts with explicit current-study Markdown follow-up evidence; the direct Markdown follow-up value was selected. Survival, patency, and time-to-event metrics are not treated as follow-up.',
    };
  }

  if (mdReported && mdEvidence) {
    return {
      status: 'md_only',
      pdfValue: pdfReported ? rawPdf : 'Not reported',
      markdownValue: mdEvidence.formattedDuration,
      selectedValue: mdEvidence.formattedDuration,
      evidenceQuote: mdEvidence.quote,
      evidenceLocation: mdEvidence.location,
      note: 'Follow-up duration was recovered from explicit current-study Markdown evidence.',
    };
  }

  if (pdfReported) {
    return {
      status: 'pdf_only',
      pdfValue: rawPdf,
      markdownValue: 'Not available',
      selectedValue: rawPdf,
      evidenceQuote: '',
      evidenceLocation: '',
      note: 'No trusted Markdown follow-up evidence was available; PDF/Gemini extraction was retained.',
    };
  }

  return {
    status: 'not_available',
    pdfValue: 'Not reported',
    markdownValue: 'Not available',
    selectedValue: 'Not reported',
    evidenceQuote: '',
    evidenceLocation: '',
    note: 'True follow-up duration was not available from either source.',
  };
}

export function extractMarkdownDemographicEvidence(markdown: string): MarkdownDemographicEvidence {
  const source = normalizeMarkdownForParsing(markdown || '');
  const tables = parseTables(source);
  const confidentBaselineTables = tables.filter((table) => table.reconstruction === 'confident' && isBaselineCaption(table.caption));

  let patientCount: MarkdownPatientCountEvidence | undefined;
  for (const table of confidentBaselineTables) {
    patientCount = findSingleStudyNFromBaselineTable(table);
    if (patientCount) break;
  }
  if (!patientCount) patientCount = findPatientNFromNarrative(source);

  let gender: MarkdownGenderEvidence | undefined;
  let rejectedInconsistentGenderTable = false;
  for (const table of confidentBaselineTables) {
    const hasGenderRow = baselineTableHasGenderRow(table);
    gender = findGenderFromBaselineTable(table, patientCount);
    if (gender) break;
    if (hasGenderRow) rejectedInconsistentGenderTable = true;
  }
  // If a confident baseline table explicitly contained gender but failed the
  // n/N/% consistency check, do not rescue gender from free-text derived from
  // that same malformed Markdown. Fall back to the independent PDF/Gemini
  // extraction during validation instead.
  if (!gender && !rejectedInconsistentGenderTable) {
    gender = findGenderFromNarrative(source, patientCount);
  }

  const currentStudyBoundary = currentStudyBoundaryIndex(source);
  const currentStudyConfidentTables = tables.filter(
    (table) => table.reconstruction === 'confident' && table.startIndex < currentStudyBoundary
  );
  let followUp: MarkdownFollowUpEvidence | undefined;
  for (const table of currentStudyConfidentTables) {
    followUp = findFollowUpFromConfidentTable(table);
    if (followUp) break;
  }
  if (!followUp) followUp = findFollowUpFromNarrative(source);

  return {
    patientCount,
    gender,
    followUp,
    trustedTableCount: tables.filter((table) => table.reconstruction === 'confident').length,
    uncertainTableCount: tables.filter((table) => table.reconstruction === 'uncertain').length,
  };
}

export function parsePatientCountValue(value: unknown): number | undefined {
  const clean = String(value ?? '').trim();
  if (!clean || /not\s+reported|n\/a|unknown/i.test(clean)) return undefined;
  const match = clean.replace(/,/g, '').match(/\b(\d{1,6})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseGenderPairs(formatted: string): Array<{ male?: number; female?: number }> {
  const source = String(formatted || '');
  if (!source || /not\s+reported/i.test(source)) return [];
  return source.split(/\r?\n/).map((line) => {
    const male = line.match(/Male:\s*n\s*=\s*(\d+)/i)?.[1];
    const female = line.match(/Female:\s*n\s*=\s*(\d+)/i)?.[1];
    return {
      male: male ? Number(male) : undefined,
      female: female ? Number(female) : undefined,
    };
  }).filter((pair) => pair.male !== undefined || pair.female !== undefined);
}

export function validatePatientCountEvidence(
  pdfValue: unknown,
  mdEvidence?: MarkdownPatientCountEvidence
): DemographicValidationItem {
  const pdfCount = parsePatientCountValue(pdfValue);
  const mdCount = mdEvidence?.value;

  if (mdCount !== undefined && pdfCount !== undefined) {
    const matches = mdCount === pdfCount;
    return {
      status: matches ? 'validated' : 'conflict',
      pdfValue: String(pdfCount),
      markdownValue: String(mdCount),
      selectedValue: String(mdCount),
      evidenceQuote: mdEvidence?.quote || '',
      evidenceLocation: mdEvidence?.location || '',
      note: matches
        ? 'PDF/Gemini extraction and confident Markdown evidence agree.'
        : 'PDF/Gemini extraction conflicts with explicit current-study Markdown evidence; the confident Markdown value was selected for appraisal scoring.',
    };
  }

  if (mdCount !== undefined) {
    return {
      status: 'md_only',
      pdfValue: 'Not reported',
      markdownValue: String(mdCount),
      selectedValue: String(mdCount),
      evidenceQuote: mdEvidence?.quote || '',
      evidenceLocation: mdEvidence?.location || '',
      note: 'Patient count was recovered from explicit current-study Markdown evidence.',
    };
  }

  if (pdfCount !== undefined) {
    return {
      status: 'pdf_only',
      pdfValue: String(pdfCount),
      markdownValue: 'Not available',
      selectedValue: String(pdfCount),
      evidenceQuote: '',
      evidenceLocation: '',
      note: 'No trusted Markdown patient-count evidence was available; PDF/Gemini extraction was retained.',
    };
  }

  return {
    status: 'not_available',
    pdfValue: 'Not reported',
    markdownValue: 'Not available',
    selectedValue: 'Not reported',
    evidenceQuote: '',
    evidenceLocation: '',
    note: 'Patient count was not available from either source.',
  };
}

export function validateGenderEvidence(
  pdfFormattedDistribution: string,
  mdEvidence?: MarkdownGenderEvidence
): DemographicValidationItem {
  const pdfPairs = parseGenderPairs(pdfFormattedDistribution);
  const mdPairs = mdEvidence ? parseGenderPairs(mdEvidence.formattedDistribution) : [];

  if (mdEvidence && mdPairs.length > 0 && pdfPairs.length > 0) {
    const same = mdPairs.length === pdfPairs.length && mdPairs.every((pair, index) => {
      const other = pdfPairs[index] || {};
      return pair.male === other.male && pair.female === other.female;
    });
    return {
      status: same ? 'validated' : 'conflict',
      pdfValue: pdfFormattedDistribution,
      markdownValue: mdEvidence.formattedDistribution,
      selectedValue: mdEvidence.formattedDistribution,
      evidenceQuote: mdEvidence.quote,
      evidenceLocation: mdEvidence.location,
      note: same
        ? 'PDF/Gemini gender extraction and confident Markdown baseline evidence agree.'
        : 'PDF/Gemini gender extraction conflicts with confident baseline Markdown evidence; the Markdown baseline value was selected.',
    };
  }

  if (mdEvidence && mdPairs.length > 0) {
    return {
      status: 'md_only',
      pdfValue: pdfPairs.length ? pdfFormattedDistribution : 'Not reported',
      markdownValue: mdEvidence.formattedDistribution,
      selectedValue: mdEvidence.formattedDistribution,
      evidenceQuote: mdEvidence.quote,
      evidenceLocation: mdEvidence.location,
      note: 'Gender distribution was recovered from current-study Markdown evidence.',
    };
  }

  if (pdfPairs.length > 0) {
    return {
      status: 'pdf_only',
      pdfValue: pdfFormattedDistribution,
      markdownValue: 'Not available',
      selectedValue: pdfFormattedDistribution,
      evidenceQuote: '',
      evidenceLocation: '',
      note: 'No trusted Markdown gender evidence was available; PDF/Gemini extraction was retained.',
    };
  }

  return {
    status: 'not_available',
    pdfValue: 'Not reported',
    markdownValue: 'Not available',
    selectedValue: 'Not reported',
    evidenceQuote: '',
    evidenceLocation: '',
    note: 'Gender distribution was not available from either source.',
  };
}
