import type { ResearchGroup } from '../../types';
import type { CohortTableRow } from './cohortTableEvidence';

// A PDF's reading order can place a current-study table after Discussion.
// Accept only explicit table captions, named N-bearing columns, and tabular cells.
export function explicitOutcomeTables(text: string, groups: ResearchGroup[]): CohortTableRow[] {
  const source = text.replace(/[–—−]/g, '-').split(/\n\s*REFERENCES\s*\n/i)[0];
  const captions = [...source.matchAll(/^\s*Table\s+(?:\d+|[IVX]+)\.\s*([^\n]+)\n/gim)];
  const key = (s: string) => s.toLowerCase().replace(/side.by.side/g, 'sbs')
    .replace(/\b(?:sbs|stenting|at|the|group|cohort|arm)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Same rationale as cohortTableEvidence.ts: a group's stored name may carry a
  // descriptor the table's own column header omits (e.g. "sbs" stripped from
  // `key` here already covers "side by side", but other extra words can still
  // diverge), so fall back to token-set containment when no exact key match exists.
  const keyMatches = (columnKey: string, groupKey: string) => {
    if (columnKey === groupKey) return true;
    const columnTokens = new Set(columnKey.split(' ').filter(Boolean));
    const groupTokens = new Set(groupKey.split(' ').filter(Boolean));
    if (columnTokens.size === 0 || groupTokens.size === 0) return false;
    const isSubset = (small: Set<string>, big: Set<string>) => [...small].every(token => big.has(token));
    return isSubset(columnTokens, groupTokens) || isSubset(groupTokens, columnTokens);
  };
  const output: CohortTableRow[] = [];
  captions.forEach((caption, i) => {
    if (!/^(?:patient characteristics|baseline characteristics|clinical outcomes)\b/i.test(caption[1]) || /previous|published|literature|review|other studies/i.test(caption[1])) return;
    const block = source.slice(caption.index! + caption[0].length, captions[i + 1]?.index ?? source.length);
    const lines = block.split(/\r?\n/);
    const firstRow = lines.findIndex(line => /\t/.test(line) && /^\s*(?:Age|Procedure time|Technical success|Clinical success|Functional success)\b/i.test(line));
    if (firstRow < 0) return;
    const header = lines.slice(0, firstRow).join(' ').replace(/\s+/g, ' ').trim();
    const headers = [...header.matchAll(/([^()]+?)\(\s*n\s*=\s*(\d+)\s*\)/gi)];
    if (headers.length < 2 || !/^\s*(?:P[- ]?value)?\s*$/i.test(header.slice((headers.at(-1)!.index ?? 0) + headers.at(-1)![0].length))) return;
    const columns = headers.map(h => h[1].trim());
    const groupColumns = groups.map(g => {
      const groupKey = key(g.groupName);
      const exactFound = columns.flatMap((c, j) => key(c) === groupKey ? [j] : []);
      if (exactFound.length === 1) return exactFound[0];
      if (exactFound.length > 1) return undefined;
      const containmentFound = columns.flatMap((c, j) => keyMatches(key(c), groupKey) ? [j] : []);
      return containmentFound.length === 1 ? containmentFound[0] : undefined;
    });
    if (groupColumns.some(c => c === undefined) || new Set(groupColumns).size !== groups.length) return;
    const location = caption[0].trim();
    const base = { columns, groupColumns, location };
    output.push({...base, label: 'Number of patients', cells: headers.map(h => h[2]), quote: header});
    for (const line of lines.slice(firstRow)) {
      if (!line.trim()) continue;
      const cells = line.split(/\t+/).map(s => s.trim());
      if (cells.length !== columns.length + 2) break;
      if (!cells.slice(1, -1).every(s => /^(?:NR|Not reached|\d+(?:\.\d+)?(?:\s*\([^)]*\))?)$/i.test(s))) break;
      const values = cells.slice(1, -1).map(s => /^NR$/i.test(s) && /NR:\s*not reached/i.test(block) ? 'Not reached' : s);
      output.push({...base, label: cells[0].replace(/^Gender,\s*male\b/i, 'Male'), cells: values, quote: `${header} | ${line.trim()}`});
    }
  });
  return output;
}
