export interface FmeaRegistryRow {
  no: string;
  deviceCategory: string;
  productModelName: string;
  fmeaDocNo: string;
  hazardousSituation: string;
  harm: string;
  riskReductionControls: string;
}

export type FmeaMatchStatus = 'existing' | 'review' | 'new' | 'unavailable' | 'not_applicable';

export interface FmeaMatchResult {
  status: FmeaMatchStatus;
  matchedRows: FmeaRegistryRow[];
  candidateRows: number;
  checkedProducts: string[];
  reason: string;
}

export interface FmeaRegistryFetchResult {
  rows: FmeaRegistryRow[];
  source: 'live-google-sheet';
  error?: string;
}

const GOOGLE_SHEET_ID = '1Me9gsdpoQHZpD5qVjsvWlw8MF8WFiRdOEnwWLL8BXJA';
export const FMEA_SHEET_NAME = 'Itemized_FMEA_Registry';
export const GOOGLE_SHEET_FMEA_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(FMEA_SHEET_NAME)}`;

let cachedPromise: Promise<FmeaRegistryFetchResult> | null = null;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let cur = '';

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      row.push(cur);
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += c;
    }
  }

  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[().]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function fetchFmeaRegistry(forceRefresh = false): Promise<FmeaRegistryFetchResult> {
  if (cachedPromise && !forceRefresh) return cachedPromise;

  cachedPromise = (async () => {
    try {
      const response = await fetch(GOOGLE_SHEET_FMEA_CSV_URL, {
        method: 'GET',
        headers: { Accept: 'text/csv,text/plain,*/*' },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText})`);
      }

      const csvText = await response.text();
      if (!csvText.trim()) throw new Error('Google Sheet returned empty FMEA data.');

      const rows = parseCSV(csvText);
      if (rows.length < 2) throw new Error('FMEA sheet has no data rows.');

      // Header is normally row 1. Scan a few rows as a safeguard in case a title row is added later.
      let headerRowIndex = -1;
      let columnIndexes: Record<string, number> = {};
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        const headers = rows[i];
        const indexes = {
          no: findHeaderIndex(headers, ['No.', 'No']),
          category: findHeaderIndex(headers, ['Device Category']),
          product: findHeaderIndex(headers, ['Product Model / Name', 'Product Model/Name']),
          doc: findHeaderIndex(headers, ['FMEA Doc No.', 'FMEA Doc No']),
          hazard: findHeaderIndex(headers, ['Hazardous situation', 'Hazardous Situation']),
          harm: findHeaderIndex(headers, ['Harm']),
          controls: findHeaderIndex(headers, ['Risk reduction control(s)', 'Risk reduction controls', 'Risk Reduction Control(s)']),
        };

        if (indexes.product >= 0 && indexes.doc >= 0 && indexes.hazard >= 0 && indexes.harm >= 0 && indexes.controls >= 0) {
          headerRowIndex = i;
          columnIndexes = indexes;
          break;
        }
      }

      if (headerRowIndex < 0) {
        throw new Error(
          'Required FMEA headers were not found. Expected Product Model / Name, FMEA Doc No., Hazardous situation, Harm, and Risk reduction control(s).'
        );
      }

      const parsed: FmeaRegistryRow[] = [];
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const productModelName = (row[columnIndexes.product] || '').trim();
        const fmeaDocNo = (row[columnIndexes.doc] || '').trim();
        const hazardousSituation = (row[columnIndexes.hazard] || '').trim();
        const harm = (row[columnIndexes.harm] || '').trim();
        const riskReductionControls = (row[columnIndexes.controls] || '').trim();

        if (!productModelName) continue;
        if (!hazardousSituation && !harm && !riskReductionControls) continue;

        parsed.push({
          no: columnIndexes.no >= 0 ? (row[columnIndexes.no] || '').trim() : String(parsed.length + 1),
          deviceCategory: columnIndexes.category >= 0 ? (row[columnIndexes.category] || '').trim() : '',
          productModelName,
          fmeaDocNo,
          hazardousSituation,
          harm,
          riskReductionControls,
        });
      }

      if (parsed.length === 0) throw new Error('No usable FMEA rows were found.');

      return { rows: parsed, source: 'live-google-sheet' as const };
    } catch (error: any) {
      console.error('[FMEA Registry] Failed to load live Google Sheet:', error);
      return {
        rows: [],
        source: 'live-google-sheet' as const,
        error: error?.message || 'Unknown FMEA loading error',
      };
    }
  })();

  return cachedPromise;
}

export function normalizeProductName(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[™®]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTerm(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[™®]/g, '')
    .toLowerCase()
    .replace(/haemorrhag/g, 'hemorrhag')
    .replace(/tumour/g, 'tumor')
    .replace(/oedema/g, 'edema')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_EVENT_TOKENS = new Set([
  'adverse', 'event', 'events', 'complication', 'complications', 'stent', 'stents',
  'device', 'devices', 'patient', 'patients', 'procedure', 'procedural', 'related',
  'associated', 'reported', 'new', 'onset', 'overall', 'other', 'the', 'a', 'an',
  'of', 'to', 'in', 'with', 'without', 'and', 'or', 'due', 'during', 'after', 'before',
]);

function stemToken(token: string): string {
  if (token.length > 6 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function meaningfulTokens(value: string): string[] {
  return normalizeTerm(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !GENERIC_EVENT_TOKENS.has(token))
    .map(stemToken)
    .filter((token) => token.length >= 3);
}

const DIRECT_SYNONYM_GROUPS: string[][] = [
  ['bleeding', 'hemorrhage', 'haemorrhage'],
  ['fracture', 'breakage'],
];

const RELATED_SYNONYM_GROUPS: string[][] = [
  ['occlusion', 'obstruction', 'blockage', 'blocked'],
  ['migration', 'dislodgement', 'displacement'],
  ['perforation', 'rupture'],
  ['infection', 'infectious', 'cholangitis', 'cholecystitis', 'abscess', 'sepsis'],
  ['bleeding', 'hemorrhage', 'haemorrhage', 'hemobilia', 'haematoma', 'hematoma'],
  ['ingrowth', 'overgrowth', 'hyperplasia'],
];

function containsAnyGroupPair(a: string, b: string, groups: string[][]): boolean {
  const aa = normalizeTerm(a);
  const bb = normalizeTerm(b);
  return groups.some((group) => {
    const aHit = group.some((term) => aa.includes(normalizeTerm(term)));
    const bHit = group.some((term) => bb.includes(normalizeTerm(term)));
    return aHit && bHit;
  });
}

function directTermMatch(eventName: string, registryText: string): boolean {
  const e = normalizeTerm(eventName);
  const r = normalizeTerm(registryText);
  if (!e || !r) return false;
  if (e === r) return true;

  const eTokens = meaningfulTokens(e);
  const rTokens = meaningfulTokens(r);
  if (eTokens.length === 0 || rTokens.length === 0) return false;

  const eSet = new Set(eTokens);
  const rSet = new Set(rTokens);
  const eventSubset = eTokens.every((token) => rSet.has(token));
  const registrySubset = rTokens.every((token) => eSet.has(token));

  // Direct containment after removing generic words: e.g. "stent migration" -> "migration".
  if ((eventSubset || registrySubset) && Math.min(eTokens.length, rTokens.length) >= 1) {
    const shared = eTokens.filter((token) => rSet.has(token));
    if (shared.some((token) => token.length >= 4)) return true;
  }

  if (containsAnyGroupPair(e, r, DIRECT_SYNONYM_GROUPS)) return true;
  return false;
}

function relatedTermMatch(eventName: string, registryText: string): boolean {
  if (directTermMatch(eventName, registryText)) return false;
  const eTokens = meaningfulTokens(eventName);
  const rTokens = meaningfulTokens(registryText);
  if (eTokens.length === 0 || rTokens.length === 0) return false;

  const rSet = new Set(rTokens);
  const shared = eTokens.filter((token) => rSet.has(token));
  const eventCoverage = shared.length / eTokens.length;
  if (shared.some((token) => token.length >= 5) && eventCoverage >= 0.5) return true;

  return containsAnyGroupPair(eventName, registryText, RELATED_SYNONYM_GROUPS);
}

export function getRowsForProducts(rows: FmeaRegistryRow[], productNames: string[]): FmeaRegistryRow[] {
  const wanted = new Set(productNames.map(normalizeProductName).filter(Boolean));
  if (wanted.size === 0) return [];
  return rows.filter((row) => wanted.has(normalizeProductName(row.productModelName)));
}

export function compareEventToFmea(
  eventName: string,
  rows: FmeaRegistryRow[],
  checkedProducts: string[]
): FmeaMatchResult {
  if (!rows.length) {
    return {
      status: 'unavailable',
      matchedRows: [],
      candidateRows: 0,
      checkedProducts,
      reason: 'No DUE-specific FMEA rows were available, so this event was not classified as new.',
    };
  }

  const directMatches = rows.filter(
    (row) => directTermMatch(eventName, row.harm) || directTermMatch(eventName, row.hazardousSituation)
  );
  if (directMatches.length > 0) {
    return {
      status: 'existing',
      matchedRows: directMatches,
      candidateRows: rows.length,
      checkedProducts,
      reason: 'The reported event directly matches a Harm or Hazardous situation in the selected DUE FMEA.',
    };
  }

  const relatedMatches = rows.filter(
    (row) => relatedTermMatch(eventName, row.harm) || relatedTermMatch(eventName, row.hazardousSituation)
  );
  if (relatedMatches.length > 0) {
    return {
      status: 'review',
      matchedRows: relatedMatches,
      candidateRows: rows.length,
      checkedProducts,
      reason: 'A related FMEA term was found, but the wording is not an unambiguous direct match. Manual review is recommended.',
    };
  }

  return {
    status: 'new',
    matchedRows: [],
    candidateRows: rows.length,
    checkedProducts,
    reason: 'No matching Harm or Hazardous situation was found in the selected DUE FMEA registry.',
  };
}
