import {
  classifySafetyRowLabel,
  isExplicitSafetyContextText,
} from '../../src/utils/nlpRules';

export interface MarkdownSafetyEventEvidence {
  eventName: string;
  eventType: 'Adverse Event / Complication' | 'Cause of Recurrence';
  category: string;
  timing: string;
  groupId?: string;
  groupName: string;
  deviceName?: string;
  numerator: string;
  denominator: string;
  countN: string;
  reportedPercentage: string;
  numeratorType: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
  denominatorType: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
  multipleEventsPerPatient: 'Yes' | 'No' | 'Not reported' | 'Unclear';
  parentEvent?: string;
  isSubItem?: boolean;
  relationshipType?: 'none' | 'component' | 'cause' | 'unclear';
  isAggregate?: boolean;
  classificationStatus: 'classified' | 'review_required';
  reviewReason?: string;
  evidenceQuote: string;
  evidenceLocation: string;
  percentageContextQuote: string;
  percentageContextLocation: string;
  source: 'confident_markdown_table';
}

export interface MarkdownReinterventionEvidence {
  groupId?: string;
  groupName: string;
  deviceName?: string;
  timing: string;
  numerator: string;
  denominator: string;
  percentage: string;
  percentageSource: 'Reported' | 'Not reported';
  evidenceQuote: string;
  evidenceLocation: string;
  source: 'confident_markdown_table';
}

export interface MarkdownSafetyEvidenceResult {
  events: MarkdownSafetyEventEvidence[];
  reinterventions: MarkdownReinterventionEvidence[];
  trustedSafetyTableCount: number;
  ignoredUncertainSafetyTableCount: number;
  ignoredComparisonTableCount: number;
}

interface MarkdownTableBlock {
  caption: string;
  reconstruction: 'confident' | 'uncertain';
  markdown: string;
  rows: string[][];
  pageNumber?: number;
  startIndex: number;
}

interface ParsedMetric {
  numerator: string;
  denominator: string;
  percentage: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\\%/g, '%')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\\geq?|\\ge/g, '≥')
    .replace(/\\leq?|\\le/g, '≤')
    .replace(/\\pm/g, '±')
    .replace(/[–—−]/g, '-')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[™®©℠]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:group|cohort|arm)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMetricLabel(value: string): string {
  return normalizeText(value)
    .replace(/[,;:]?\s*n\s*\(\s*%\s*\)\s*$/i, '')
    .replace(/[,;:]?\s*%\s*\(\s*n\s*\)\s*$/i, '')
    .replace(/[,;:]?\s*\(\s*n\s*,\s*%\s*\)\s*$/i, '')
    .replace(/[,;:]?\s*\(\s*%\s*,\s*n\s*\)\s*$/i, '')
    .replace(/(?:[,;:]|\s)\s*\(?\s*n\s*\)?\s*$/i, '')
    .replace(/(?:[,;:]|\s)\s*\(?\s*no\.?\s*\)?\s*$/i, '')
    .trim();
}

function pageAt(markdown: string, index: number): number | undefined {
  const prefix = markdown.slice(0, Math.max(0, index));
  const matches = [...prefix.matchAll(/<!--\s*PAGE:\s*(\d+)\s*-->/gi)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : undefined;
}

function currentStudyMarkdown(markdown: string): string {
  // Do NOT cut at Discussion/Conclusion here. Multi-column PDF conversion can
  // legitimately emit a current-study Results table after a Discussion heading
  // on the same page. Table-level safety/comparison filters below are safer.
  // References, however, are never a source for current-study Step 4 evidence.
  const references = markdown.search(/^#{1,6}\s+References\b/im);
  return references >= 0 ? markdown.slice(0, references) : markdown;
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
      cells.push(normalizeText(current));
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(normalizeText(current));
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseRows(block: string): string[][] {
  return block
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map(splitMarkdownRow)
    .filter((cells) => !isSeparatorRow(cells));
}

function parseTables(markdown: string): MarkdownTableBlock[] {
  const source = currentStudyMarkdown(markdown);
  const marker = /<!--\s*TABLE:\s*(.*?)\s*\|\s*reconstruction=(confident|uncertain)\s*-->/gi;
  const matches = [...source.matchAll(marker)];

  return matches.map((match, index) => {
    const startIndex = match.index ?? 0;
    const bodyStart = startIndex + match[0].length;
    const nextMarker = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const nextPageMatch = /<!--\s*PAGE:\s*\d+\s*-->/i.exec(source.slice(bodyStart, nextMarker));
    const nextPageIndex = nextPageMatch?.index !== undefined ? bodyStart + nextPageMatch.index : nextMarker;
    const body = source.slice(bodyStart, Math.min(nextMarker, nextPageIndex));
    return {
      caption: normalizeText(match[1]),
      reconstruction: String(match[2]).toLowerCase() as 'confident' | 'uncertain',
      markdown: body,
      rows: parseRows(body),
      pageNumber: pageAt(source, startIndex),
      startIndex,
    };
  });
}

function isComparisonOrLiteratureTable(table: MarkdownTableBlock): boolean {
  const caption = normalizeKey(table.caption);
  if (/\b(?:studies|published studies|previous studies|prior studies|literature|review|meta analysis|comparison with other|reported studies)\b/.test(caption)) {
    return true;
  }

  const firstRows = table.rows.slice(0, 3).flat().map(normalizeKey).join(' ');
  return /\bauthor\b/.test(firstRows) && /\b(?:year|study|patients?)\b/.test(firstRows);
}

function isSafetyCaption(caption: string): boolean {
  return isExplicitSafetyContextText(caption) || /\b(?:safety|patient outcomes?|clinical outcomes?|outcomes?)\b/i.test(caption);
}

function locationFor(table: MarkdownTableBlock): string {
  return `${table.caption}${table.pageNumber ? `, Page ${table.pageNumber}` : ''}`;
}

function parseHeaderN(value: string): string {
  const match = normalizeText(value).match(/\b[nN]\s*=\s*(\d{1,6})\b/);
  return match ? match[1] : '';
}

function parseMetric(value: string, nPercentContext: boolean): ParsedMetric | null {
  const text = normalizeText(value);
  if (!text || /^(?:-|--|—|n\/?a|not reported|nr)$/i.test(text)) return null;

  let match = text.match(/(\d+(?:\.\d+)?)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
  if (match) {
    return { numerator: match[2], denominator: match[3], percentage: `${match[1]}%` };
  }

  match = text.match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/);
  if (match) {
    return { numerator: match[1], denominator: match[2], percentage: `${match[3]}%` };
  }

  match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (match) {
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    return { numerator: match[1], denominator: match[2], percentage: pct ? `${pct[1]}%` : 'Not reported' };
  }

  match = text.match(/^(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)$/);
  if (match) {
    return {
      numerator: match[1],
      denominator: '',
      percentage: nPercentContext || /%/.test(text) ? `${match[2]}%` : 'Not reported',
    };
  }

  match = text.match(/^(\d+(?:\.\d+)?)\s*%\s*\(\s*(\d+)\s*\)$/);
  if (match) {
    return { numerator: match[2], denominator: '', percentage: `${match[1]}%` };
  }

  match = text.match(/^(\d+)\s*\((?:n\s*=\s*)?(\d+(?:\.\d+)?)\s*%\)$/i);
  if (match) {
    return { numerator: match[1], denominator: '', percentage: `${match[2]}%` };
  }

  if (/^\d+$/.test(text)) {
    return { numerator: text, denominator: '', percentage: 'Not reported' };
  }

  return null;
}

function inferTiming(label: string, currentTiming: string): string {
  const text = normalizeText(label);
  if (/\bearly\b/i.test(text)) return 'Early';
  if (/\blate\b/i.test(text)) return 'Late';
  if (/after\s+(?:rbo|recurrent|obstruction|dysfunction)/i.test(text)) return 'After recurrence / obstruction';
  return currentTiming || 'N/A';
}

function isReinterventionLabel(label: string): boolean {
  const text = normalizeKey(label);
  if (!text) return false;
  if (/^(?:successful|failed|unsuccessful)\s+(?:re intervention|reintervention)\b/.test(text)) return false;
  if (/\b(?:success|failure)\s+rate\s+(?:of|for)\s+(?:re intervention|reintervention)\b/.test(text)) return false;
  if (/\b(?:initial|planned|routine|scheduled)\b/.test(text) && !/\b(?:repeat|additional|rescue)\b/.test(text)) return false;
  return /\b(?:re intervention|reintervention|repeat intervention|repeat procedure|repeat ercp|reoperation|revision|retreatment|repeat stent|stent replacement|additional procedure|additional intervention|additional drainage|rescue procedure|rescue intervention)\b/.test(text);
}

function buildGroupAliases(group: any): string[] {
  const values = [group?.groupName, ...(group?.devices || []).map((d: any) => d?.deviceProductName)].filter(Boolean);
  const aliases = new Set<string>();
  for (const value of values) {
    const key = normalizeKey(value);
    if (!key) continue;
    aliases.add(key);
    const compact = key.replace(/\b(?:sequential|simultaneous|overall)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (compact.length >= 3) aliases.add(compact);
  }
  return [...aliases];
}

function matchHeaderToGroup(header: string, researchGroups: any[]): any | null {
  const key = normalizeKey(header);
  if (!key) return researchGroups.length === 1 ? researchGroups[0] : null;

  const scored = researchGroups
    .map((group) => {
      const aliases = buildGroupAliases(group);
      const score = Math.max(0, ...aliases.map((alias) => {
        if (!alias) return 0;
        if (key === alias) return 1000 + alias.length;
        if (key.includes(alias) || alias.includes(key)) return alias.length;
        const tokens = alias.split(' ').filter((t) => t.length >= 2);
        const overlap = tokens.filter((t) => key.includes(t)).length;
        return overlap * 5;
      }));
      return { group, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score > 0 && scored[0]?.score > (scored[1]?.score ?? -1)) return scored[0].group;
  return researchGroups.length === 1 ? researchGroups[0] : null;
}

function findDataStart(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = rows[i];
    const label = normalizeText(row[0]);
    const hasNumericValue = row.slice(1).some((cell) => /\d/.test(cell));
    if (!label) continue;
    if (hasNumericValue && i > 0) return i;
    if (isExplicitSafetyContextText(label) || isReinterventionLabel(label)) return i;
  }
  return Math.min(1, Math.max(0, rows.length - 1));
}

function columnHeaderLabels(rows: string[][], dataStart: number, maxColumns: number): string[] {
  const labels: string[] = [];
  for (let col = 1; col < maxColumns; col++) {
    const parts = rows
      .slice(0, dataStart)
      .map((row) => normalizeText(row[col] || ''))
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
    labels[col] = parts.join(' ');
  }
  return labels;
}

function findNamedParent(label: string, priorEvents: MarkdownSafetyEventEvidence[]): MarkdownSafetyEventEvidence | undefined {
  const heading = normalizeText(label).match(/^(?:cause|causes|reason|reasons|etiology|mechanism)\s+(?:of|for)\s+(.+)$/i);
  if (!heading) return undefined;
  const parentKey = normalizeKey(heading[1]);
  return priorEvents.slice().reverse().find((event) => normalizeKey(event.eventName) === parentKey);
}

export function extractMarkdownSafetyEvidence(
  markdownText: string,
  researchGroups: any[] = [],
  totalPatientCount: unknown = 'Not reported'
): MarkdownSafetyEvidenceResult {
  const result: MarkdownSafetyEvidenceResult = {
    events: [],
    reinterventions: [],
    trustedSafetyTableCount: 0,
    ignoredUncertainSafetyTableCount: 0,
    ignoredComparisonTableCount: 0,
  };

  if (!markdownText?.trim()) return result;

  const tables = parseTables(markdownText);
  for (const table of tables) {
    const containsSafetyRows = table.rows.some((row) => {
      const label = normalizeText(row[0]);
      const cls = classifySafetyRowLabel(label, `${table.caption} ${label}`);
      return cls === 'event' || cls === 'aggregate' || isReinterventionLabel(label) || isExplicitSafetyContextText(label);
    });
    if (!isSafetyCaption(table.caption) && !containsSafetyRows) continue;

    if (table.reconstruction !== 'confident') {
      result.ignoredUncertainSafetyTableCount += 1;
      continue;
    }
    if (isComparisonOrLiteratureTable(table)) {
      result.ignoredComparisonTableCount += 1;
      continue;
    }
    if (table.rows.length < 2) continue;

    result.trustedSafetyTableCount += 1;
    const dataStart = findDataStart(table.rows);
    const maxColumns = Math.max(...table.rows.map((row) => row.length));
    const headers = columnHeaderLabels(table.rows, dataStart, maxColumns);
    const tableNonRowText = table.markdown
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('|'))
      .join(' ');
    const nPercentContext = /\b(?:data|values?|results?)\s+(?:are|were|shown|presented|reported)(?:\s+as)?[^.]{0,40}\bn\s*\(\s*%\s*\)/i.test(tableNonRowText);
    const tableLocation = locationFor(table);
    const tableWideSafety = isExplicitSafetyContextText(table.caption);
    let safetySectionActive = tableWideSafety;
    let currentTiming = 'N/A';
    let currentSafetySectionLabel = tableWideSafety ? table.caption : '';
    let explicitParent: MarkdownSafetyEventEvidence | undefined;

    for (let rowIndex = dataStart; rowIndex < table.rows.length; rowIndex++) {
      const row = table.rows[rowIndex];
      const rawLabel = normalizeText(row[0]);
      if (!rawLabel) continue;

      const valueCells = row.slice(1);
      const hasNumeric = valueCells.some((cell) => /\d/.test(cell));

      // A safety section header can itself carry the aggregate n/% on the same
      // row (for example `Early adverse event | Overall 23 (31) ...`). Keep its
      // timing active for the following child event rows instead of treating the
      // timing as belonging only to the aggregate row. Without this, a PDF event
      // tagged `Early` and the matching Markdown row tagged `N/A` fail to
      // reconcile, leaving a stale Review Required flag despite identical counts.
      if (/\bearly\b.*\b(?:adverse events?|complications?|events?)\b/i.test(rawLabel)) {
        safetySectionActive = true;
        currentTiming = 'Early';
        currentSafetySectionLabel = rawLabel;
        explicitParent = undefined;
      } else if (/\blate\b.*\b(?:adverse events?|complications?|events?)\b/i.test(rawLabel)) {
        safetySectionActive = true;
        currentTiming = 'Late';
        currentSafetySectionLabel = rawLabel;
        explicitParent = undefined;
      }

      if (!hasNumeric) {
        if (/\bearly\b.*\b(?:adverse events?|complications?|events?)\b/i.test(rawLabel)) {
          safetySectionActive = true;
          currentTiming = 'Early';
          currentSafetySectionLabel = rawLabel;
          explicitParent = undefined;
          continue;
        }
        if (/\blate\b.*\b(?:adverse events?|complications?|events?)\b/i.test(rawLabel)) {
          safetySectionActive = true;
          currentTiming = 'Late';
          currentSafetySectionLabel = rawLabel;
          explicitParent = undefined;
          continue;
        }
        if (/^(?:adverse events?|complications?|safety events?)$/i.test(rawLabel)) {
          safetySectionActive = true;
          currentSafetySectionLabel = rawLabel;
          explicitParent = undefined;
          continue;
        }
        const namedParent = findNamedParent(rawLabel, result.events);
        if (namedParent) {
          explicitParent = namedParent;
          safetySectionActive = true;
        }
        continue;
      }

      if (isReinterventionLabel(rawLabel)) {
        const rowNPercentContext = nPercentContext || /\bn\s*\(\s*%\s*\)/i.test(rawLabel);
        const patientBasedReintervention = /\bpatients?\s+with\b/i.test(rawLabel) || /\brate\b/i.test(rawLabel) || rowNPercentContext;
        for (let col = 1; col < row.length; col++) {
          const metric = parseMetric(row[col], rowNPercentContext);
          if (!metric || Number(metric.numerator) <= 0) continue;
          const header = headers[col] || '';
          const group = matchHeaderToGroup(header, researchGroups);
          const isConditionalDenominator = /\b(?:after|among|following|successful|failed|unsuccessful|clinically unsuccessful|rbo|recurrent|obstruction|dysfunction)\b/i.test(rawLabel);
          const headerN = parseHeaderN(header);
          const groupN = group?.groupPatientNumber && !/not reported/i.test(String(group.groupPatientNumber))
            ? String(group.groupPatientNumber).match(/\d+/)?.[0] || ''
            : '';
          const totalN = String(totalPatientCount ?? '').match(/\d+/)?.[0] || '';
          const denominator = metric.denominator || headerN ||
            (!isConditionalDenominator && patientBasedReintervention
              ? (groupN || (researchGroups.length <= 1 ? totalN : ''))
              : '');
          result.reinterventions.push({
            groupId: group?.id,
            groupName: group?.groupName || header || (researchGroups.length === 1 ? researchGroups[0]?.groupName : 'Study-wide / all patients') || 'Study-wide / all patients',
            deviceName: group?.devices?.[0]?.deviceProductName || '',
            timing: inferTiming(rawLabel, currentTiming),
            numerator: metric.numerator,
            denominator: denominator || 'Not reported',
            percentage: metric.percentage,
            percentageSource: metric.percentage !== 'Not reported' ? 'Reported' : 'Not reported',
            evidenceQuote: row.join(' | '),
            evidenceLocation: tableLocation,
            source: 'confident_markdown_table',
          });
        }
        continue;
      }

      let classification = classifySafetyRowLabel(rawLabel, `${table.caption} ${rawLabel}`);
      if (/^overall$/i.test(rawLabel) && safetySectionActive) classification = 'aggregate';
      if (classification === 'non_event') continue;
      if (classification === 'ambiguous' && !safetySectionActive && !explicitParent) continue;
      if (classification === 'event' || classification === 'aggregate') safetySectionActive = true;

      const rowNPercentContext = nPercentContext || /\bn\s*\(\s*%\s*\)/i.test(rawLabel);
      for (let col = 1; col < row.length; col++) {
        const metric = parseMetric(row[col], rowNPercentContext);
        if (!metric || Number(metric.numerator) <= 0) continue;

        const header = headers[col] || '';
        const group = matchHeaderToGroup(header, researchGroups);
        const headerN = parseHeaderN(header);
        const groupN = group?.groupPatientNumber && !/not reported/i.test(String(group.groupPatientNumber))
          ? String(group.groupPatientNumber).match(/\d+/)?.[0] || ''
          : '';
        const totalN = String(totalPatientCount ?? '').match(/\d+/)?.[0] || '';
        const explicitlyPatientBased = /\bpatients?\s+(?:with|experiencing|developing)\b/i.test(rawLabel);
        const hasReportedPercentage = metric.percentage !== 'Not reported';
        const denominator = metric.denominator || headerN ||
          ((explicitlyPatientBased || hasReportedPercentage || rowNPercentContext)
            ? (groupN || (researchGroups.length <= 1 ? totalN : ''))
            : '');
        const numeratorType: 'patients' | 'events' = (explicitlyPatientBased || hasReportedPercentage || rowNPercentContext)
          ? 'patients'
          : 'events';
        const relation = explicitParent ? 'cause' as const : 'none' as const;
        const cleanedLabel = cleanMetricLabel(rawLabel) || rawLabel;
        const eventLabel = /^overall$/i.test(cleanedLabel) && currentSafetySectionLabel
          ? `${cleanMetricLabel(currentSafetySectionLabel) || currentSafetySectionLabel} (overall)`
          : cleanedLabel;
        const evidence: MarkdownSafetyEventEvidence = {
          eventName: eventLabel,
          eventType: explicitParent ? 'Cause of Recurrence' : 'Adverse Event / Complication',
          category: classification === 'aggregate' ? 'Complication' : 'Adverse event',
          timing: inferTiming(rawLabel, currentTiming),
          groupId: group?.id,
          groupName: group?.groupName || header || (researchGroups.length === 1 ? researchGroups[0]?.groupName : 'Study-wide / all patients') || 'Study-wide / all patients',
          deviceName: group?.devices?.[0]?.deviceProductName || '',
          numerator: metric.numerator,
          denominator: denominator || 'Not reported',
          countN: denominator ? `${metric.numerator}/${denominator}` : metric.numerator,
          reportedPercentage: metric.percentage,
          numeratorType,
          denominatorType: denominator ? 'patients' : 'unknown',
          multipleEventsPerPatient: 'Not reported',
          parentEvent: explicitParent?.eventName,
          isSubItem: Boolean(explicitParent),
          relationshipType: relation,
          isAggregate: classification === 'aggregate',
          classificationStatus: classification === 'ambiguous' ? 'review_required' : 'classified',
          reviewReason: classification === 'ambiguous' ? 'Retained because the row appears inside a confident Markdown safety table.' : undefined,
          evidenceQuote: row.join(' | '),
          evidenceLocation: tableLocation,
          percentageContextQuote: row.join(' | '),
          percentageContextLocation: tableLocation,
          source: 'confident_markdown_table',
        };
        result.events.push(evidence);
      }
    }
  }

  return result;
}

function normalizeTimingKey(value: unknown): string {
  const key = normalizeKey(value || '');
  if (!key || /^(?:n a|overall not time categorized|overall)$/.test(key)) return 'overall';
  if (/\bearly\b/.test(key)) return 'early';
  if (/\blate\b/.test(key)) return 'late';
  return key;
}

function eventNameKey(event: any): string {
  return normalizeKey(event?.eventName || event?.name || event?.complicationName || event?.event || '');
}

function eventGroupKey(event: any): string {
  return normalizeKey(event?.groupId || event?.groupName || event?.studyGroupOrDevice || '');
}

function groupCompatible(existing: any, mdEvent: any, researchGroups: any[]): boolean {
  if (researchGroups.length === 1) return true;
  const existingId = String(existing?.groupId || '').trim();
  const mdId = String(mdEvent?.groupId || '').trim();
  if (existingId && mdId) return existingId === mdId;

  const left = eventGroupKey(existing);
  const right = eventGroupKey(mdEvent);
  if (left && right && left === right) return true;
  const generic = (value: string) => !value || /study wide|all patients|overall/.test(value);
  return generic(left) && generic(right);
}

function numericPart(value: unknown): string {
  return String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0] || '';
}

function eventCountParts(event: any): { numerator: string; denominator: string; percentage: string } {
  const countN = String(event?.countN ?? event?.count_n ?? '');
  const pair = countN.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const numerator = pair?.[1] || numericPart(event?.numerator ?? event?.numEvents ?? event?.count ?? event?.n);
  const denominator = pair?.[2] || numericPart(event?.denominator ?? event?.totalPatients ?? event?.populationN);
  const percentage = numericPart(event?.reportedPercentage ?? event?.reportedRate ?? event?.percentage ?? event?.rate);
  return { numerator, denominator, percentage };
}

function countComparison(existing: any, mdEvent: any): 'compatible' | 'conflict' {
  const a = eventCountParts(existing);
  const b = eventCountParts(mdEvent);
  if (a.numerator && b.numerator && a.numerator !== b.numerator) return 'conflict';
  if (a.denominator && b.denominator && a.denominator !== b.denominator) return 'conflict';
  if (a.percentage && b.percentage && Math.abs(Number(a.percentage) - Number(b.percentage)) > 0.6) return 'conflict';
  return 'compatible';
}

function compactCount(event: any): string {
  const p = eventCountParts(event);
  return `${p.numerator || '?'} / ${p.denominator || '?'} / ${p.percentage ? `${p.percentage}%` : '?'}`;
}

/**
 * Merge confident Markdown table evidence into the existing PDF/Gemini safety
 * extraction without deleting valid PDF-only events. When both sources describe
 * the same event/group/timing, the confident Markdown table row is preferred for
 * fields it explicitly contains. Missing PDF denominator/percentage is treated as
 * supplementation, not a conflict. A real contradiction is retained for review.
 */
export function reconcileSafetyCandidatesWithMarkdown(
  primary: any[],
  markdownEvents: any[],
  researchGroups: any[] = []
): any[] {
  const output = [...(Array.isArray(primary) ? primary : [])];

  for (const mdEvent of Array.isArray(markdownEvents) ? markdownEvents : []) {
    const mdName = eventNameKey(mdEvent);
    const mdTiming = normalizeTimingKey(mdEvent?.timing);
    const candidateMatches = output
      .map((existing, index) => ({ existing, index }))
      .filter(({ existing }) =>
        eventNameKey(existing) === mdName &&
        groupCompatible(existing, mdEvent, researchGroups)
      );
    const exactTimingMatches = candidateMatches.filter(({ existing }) =>
      normalizeTimingKey(existing?.timing) === mdTiming
    );
    const timingCompatible = (value: unknown) => {
      const key = normalizeTimingKey(value);
      return !key || key === 'n a' || key === 'na' || key === 'not reported';
    };
    const fallbackTimingMatches = candidateMatches.filter(({ existing }) =>
      timingCompatible(existing?.timing) || timingCompatible(mdEvent?.timing)
    );
    const matchingIndexes = (exactTimingMatches.length > 0 ? exactTimingMatches : fallbackTimingMatches)
      .map(({ index }) => index);

    if (matchingIndexes.length === 0) {
      output.push({
        ...mdEvent,
        markdownValidationStatus: 'md_only',
      });
      continue;
    }

    const existingIndex = matchingIndexes[0];
    const existing = output[existingIndex];
    const comparison = countComparison(existing, mdEvent);
    const merged = {
      ...existing,
      ...mdEvent,
      markdownValidationStatus: comparison === 'compatible' ? 'validated_or_supplemented' : 'conflict_md_preferred',
      // A matching row from a confident Markdown safety table resolves a stale
      // PDF/Gemini hierarchy-review flag when the Markdown row itself is clearly
      // classified. Keep Review Required only for a real n/N/% conflict or when
      // the Markdown hierarchy is also ambiguous.
      classificationStatus: comparison === 'compatible'
        ? (mdEvent?.classificationStatus === 'classified'
            ? 'classified'
            : (existing?.classificationStatus || mdEvent?.classificationStatus || 'classified'))
        : 'review_required',
      reviewReason: comparison === 'compatible'
        ? (mdEvent?.classificationStatus === 'classified'
            ? undefined
            : (existing?.reviewReason || mdEvent?.reviewReason))
        : [
            existing?.reviewReason,
            `PDF/Gemini and confident Markdown table disagreed for this event; Markdown table n/N/% selected. PDF/Gemini=${compactCount(existing)}, Markdown=${compactCount(mdEvent)}.`,
          ].filter(Boolean).join('; '),
      pdfEvidenceQuote: existing?.evidenceQuote,
      pdfEvidenceLocation: existing?.evidenceLocation,
    };
    output[existingIndex] = merged;
    // Later PDF/table rescue paths may have emitted duplicate rows for the same
    // event/group/timing with a different denominator. Once a confident Markdown
    // row exists, collapse those duplicates into the reconciled row.
    for (const duplicateIndex of matchingIndexes.slice(1).sort((a, b) => b - a)) {
      output.splice(duplicateIndex, 1);
    }
  }

  return output;
}
