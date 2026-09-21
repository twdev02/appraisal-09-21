import { explicitOutcomeTables } from './explicitOutcomeTables';
import type { ResearchGroup } from '../../types';

// Resolve columns by their full cohort identity, never by the order of the UI
// groups. Parent totals and child cohorts occupy separate source columns.
const canonical = (value: string) => value.toLowerCase()
  .replace(/side[ -]+by[ -]+side/g, 'sbs').replace(/stent[ -]+in[ -]+stent/g, 'sis')
  .replace(/\(\s*n\s*=\s*\d+\s*\)/g, ' ').replace(/\b(?:group|arm|cohort)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const identity = (value: string) => canonical(value).replace(/\boverall\b/g, '').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A group's stored name may carry a clarifying descriptor (e.g. "Simultaneous
// group (side by side)") that the source table's own column header omits when
// the technique is already implied (e.g. the header just says "Simultaneous
// group"). Exact identity equality then never matches even though the column
// unambiguously belongs to that group. Fall back to token-set containment
// (one identity's words are a subset of the other's) so this still resolves,
// while still requiring the match to be unique among the table's columns.
const identityTokens = (value: string) => new Set(identity(value).split(' ').filter(Boolean));
const identitiesOverlapAsSubset = (a: string, b: string) => {
  const tokensA = identityTokens(a);
  const tokensB = identityTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const isSubset = (small: Set<string>, big: Set<string>) => [...small].every(token => big.has(token));
  return isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA);
};

export interface CohortTableRow {
  label: string;
  columns: string[];
  cells: string[];
  groupColumns: Array<number | undefined>;
  quote: string;
  location: string;
  footnoteMarkers?: string[];
}

export function mapCohortColumns(columns: string[], groups: ResearchGroup[]) {
  return groups.map(group => {
    const exactMatches = columns.map((column, index) => identity(column) === identity(group.groupName) ? index : -1)
      .filter(index => index >= 0);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return undefined;

    const containmentMatches = columns.map((column, index) => identitiesOverlapAsSubset(column, group.groupName) ? index : -1)
      .filter(index => index >= 0);
    return containmentMatches.length === 1 ? containmentMatches[0] : undefined;
  });
}

export function cohortDisplayName(row: CohortTableRow, group: ResearchGroup, column: number): string {
  return /\boverall\b/i.test(row.columns[column])
    ? `${group.groupName} (overall; includes subgroups)` : group.groupName;
}

// Conservative support for column-major wrapped PDF headers. If any extra
// column cannot be identified, callers must not zip its cells to UI groups.
export function extractCohortTableRows(text: string, groups: ResearchGroup[]): CohortTableRow[] {
  if (!groups.length) return [];
  const source = text.replace(/[–—−]/g, '-').split(/(?:^|\n)\s*(?:DISCUSSION|REFERENCES)\s*(?:\n|$)/i)[0];
  const tables = [...source.matchAll(/(?:^|\n)\s*(Table\s+\d+[^\n]*)\n/gi)];
  const roots = [...new Set(groups.flatMap(group => {
    const name = identity(group.groupName);
    const first = name.split(' ')[0];
    return [name, ...(first.length >= 4 ? [first] : [])];
  }).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!roots.length) return [];
  const result: CohortTableRow[] = explicitOutcomeTables(text, groups);
  for (let index = 0; index < tables.length; index++) {
    const table = tables[index];
    if (/univariate|multivariate|literature|prior studies/i.test(table[1])) continue;
    const block = source.slice(table.index! + table[0].length, tables[index + 1]?.index ?? source.length);
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const firstRow = lines.findIndex(line => /^(?:Number of patients|Total patients|Male|Female|Age[, ]|Technical success|Clinical success|Survival time|Time to |Mean |Median |Follow[- ]up)\b/i.test(line) && /\d/.test(line));
    if (firstRow < 1) continue;
    const header = canonical(lines.slice(0, firstRow).join(' '));
    const starts = [...header.matchAll(new RegExp(`\\b(?:${roots.map(escape).join('|')})\\b`, 'g'))];
    const columns = starts.map((start, i) => header.slice(start.index!, starts[i + 1]?.index ?? header.length)
      .replace(/\bp\s*(?:value)?\s*$/i, '').trim());
    if (columns.length < 2) continue;
    const groupColumns = mapCohortColumns(columns, groups);
    if (!groupColumns.some(column => column !== undefined)) continue;
    for (const line of lines.slice(firstRow)) {
      if (!/^(?:Number of patients|Total patients|Male\b|Female\b|Survival time|Overall survival|Patient survival|Time to |Mean |Median |Follow[- ]up|Stent patency|Reintervention after\b|Repeat procedures?\b)/i.test(line)) continue;
      const number = line.search(/\d/);
      if (number < 0) continue;
      const label = line.slice(0, number).trim();
      const rawCells = line.slice(number);
      const matches = [...rawCells.matchAll(/\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?(?:\s*\([^)]*\))?[¹²³⁴⁵⁶⁷⁸⁹]*/g)];
      // Reject prose, missing cells and extra columns other than one P value.
      if (rawCells.replace(/\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?(?:\s*\([^)]*\))?[¹²³⁴⁵⁶⁷⁸⁹]*/g, '').trim()) continue;
      if (matches.length !== columns.length && matches.length !== columns.length + 1) continue;
      result.push({ label, columns, groupColumns, cells: matches.slice(0, columns.length).map(match => match[0].trim()),
        quote: `${lines.slice(0, firstRow).join(' ')} | ${line}`, location: table[1],
        footnoteMarkers: [...block.matchAll(/(?:^|\n)\s*(\d{1,2})\s*n\s*=/g)].map(match => match[1]) });
    }
  }
  return result;
}
