import { SimilarDeviceMeta } from '../types';

export interface DuePresetItem {
  category: string;
  due: string;
  indications: string[];
  similarDevices: string[];
  similarDevicesParsed: SimilarDeviceMeta[];
}

export interface DuePresetsFetchResult {
  categories: string[];
  presets: DuePresetItem[];
  error?: string;
}

const GENERIC_DEVICE_WORDS = new Set([
  'stent',
  'stents',
  'system',
  'covered',
  'uncovered',
  'partially',
  'fully',
  'biliary',
  'esophageal',
  'duodenal',
  'pyloric',
  'colonic',
  'colorectal',
  'enteral',
  'transhepatic',
  'ng',
  'flare',
  'both',
  'bare',
  'end',
  'segmented',
  'controlled',
  'release',
  'soft',
  'type',
]);

/**
 * Extracts conservative, brand-specific short aliases from a device full name.
 * e.g., "WallFlex Biliary Transhepatic Stent System" -> ["WallFlex"]
 * e.g., "Ultraflex Esophageal NG Stent System" -> ["Ultraflex"]
 * e.g., "BONASTENT Biliary Stent" -> ["BONASTENT"]
 */
export function extractBrandAliases(fullName: string): string[] {
  if (!fullName) return [];
  const normalized = fullName.replace(/™|®/g, '').trim();
  const words = normalized.split(/[\s-]+/).filter((w) => w.length > 0);
  const aliases: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, '').trim();
    if (clean.length >= 3 && !GENERIC_DEVICE_WORDS.has(clean.toLowerCase())) {
      if (!aliases.some((a) => a.toLowerCase() === clean.toLowerCase())) {
        aliases.push(clean);
      }
    }
  }

  // Handle multi-word distinctive brand prefixes like "Leufen aixstent", "Hot AXIOS", "Micro-Tech"
  if (/micro[\s-]?tech/i.test(fullName) && !aliases.some((a) => /micro-?tech/i.test(a))) {
    aliases.push('Micro-Tech');
  }
  if (/aixstent/i.test(fullName) && !aliases.some((a) => /aixstent/i.test(a))) {
    aliases.push('aixstent');
  }

  return aliases;
}

/**
 * Parses a Similar Device string with format: "FullName (Manufacturer)"
 */
export function parseSimilarDeviceString(raw: string): SimilarDeviceMeta {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  let fullName = trimmed;
  let manufacturer = '';

  if (match) {
    fullName = match[1].trim();
    manufacturer = match[2].trim();
  }

  const aliases = extractBrandAliases(fullName);

  return {
    raw: trimmed,
    fullName,
    manufacturer,
    aliases,
  };
}

/**
 * Simple standard RFC 4180 compliant CSV parser
 */
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
      if (c === '\r' && next === '\n') {
        i++;
      }
      row.push(cur);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cur = '';
    } else {
      cur += c;
    }
  }

  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

export const GOOGLE_SHEET_PRESETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1Me9gsdpoQHZpD5qVjsvWlw8MF8WFiRdOEnwWLL8BXJA/gviz/tq?tqx=out:csv&sheet=DUE%20Presets';

/**
 * Fetches the latest DUE Presets from Google Sheet.
 * Reads Device Category, DUE Product Name, Target Indications (| separated), Similar Devices (|| separated).
 */
export async function fetchDuePresets(): Promise<DuePresetsFetchResult> {
  try {
    const response = await fetch(GOOGLE_SHEET_PRESETS_CSV_URL, {
      method: 'GET',
      headers: {
        Accept: 'text/csv,text/plain,*/*',
      },
      cache: 'no-store', // Always fetch latest data on page load
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} (${response.statusText})`);
    }

    const csvText = await response.text();
    if (!csvText || !csvText.trim()) {
      throw new Error('Google Sheet returned empty data.');
    }

    const rows = parseCSV(csvText);
    if (rows.length <= 1) {
      throw new Error('No data rows found in Google Sheet.');
    }

    const categoriesSet = new Set<string>();
    const presets: DuePresetItem[] = [];

    // Row 0 is header: "Device Category", "DUE Product Name", "Target Indications", "Similar Devices / Benchmark Devices"
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const category = (row[0] || '').trim();
      const due = (row[1] || '').trim();
      const rawIndications = (row[2] || '').trim();
      const rawSimilarDevices = (row[3] || '').trim();

      if (!due) continue;

      if (category) {
        categoriesSet.add(category);
      }

      // Target Indications split by | (preserve exact verbatim string, independent items)
      const indications = rawIndications
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Similar Devices split by ||
      const similarDevicesRaw = rawSimilarDevices
        .split('||')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const similarDevicesParsed = similarDevicesRaw.map(parseSimilarDeviceString);

      presets.push({
        category,
        due,
        indications,
        similarDevices: similarDevicesRaw,
        similarDevicesParsed,
      });
    }

    const categories = Array.from(categoriesSet);

    return {
      categories,
      presets,
    };
  } catch (err: any) {
    console.error('[fetchDuePresets] Failed to fetch presets from Google Sheet:', err);
    return {
      categories: [],
      presets: [],
      error: `Failed to load presets from Google Sheet: ${err.message || 'Network error'}. You can still enter DUE, indications, and similar devices manually.`,
    };
  }
}
