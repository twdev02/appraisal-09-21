export interface BiliaryDuePreset {
  category?: string;
  due: string;
  indications: string[];
  similarDevices: string[];
}

export const GOOGLE_SHEET_PRESETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1Me9gsdpoQHZpD5qVjsvWlw8MF8WFiRdOEnwWLL8BXJA/gviz/tq?tqx=out:csv&sheet=DUE%20Presets';

// Initial fallback preset list
export const initialBiliaryDuePresets: BiliaryDuePreset[] = [
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Uncovered Stent [S-Type]',
    indications: ['Malignant biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Uncovered Stent [D-Type]',
    indications: ['Malignant biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Uncovered Stent [M-Type]',
    indications: ['Malignant biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Full Covered-Type]',
    indications: ['Malignant biliary stricture', 'Benign biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Giobor]',
    indications: ['Malignant biliary stricture'],
    similarDevices: ['EGIS Biliary Stent (S&G Biotech)', 'BONASTENT Biliary Stent (Sewoon Medical)', 'HANAROSTENT Biliary Stent (M.I. Tech)', 'WallFlex Biliary Transhepatic Stent System (Boston Scientific)', 'Evolution Biliary Stent System (Cook Medical)'],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Uncovered Stent [LCD-Type]',
    indications: ['Malignant biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Both Bare-Type]',
    indications: ['Malignant biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Flare-Type]',
    indications: ['Malignant biliary stricture', 'Benign biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Kaffes]',
    indications: ['Malignant biliary stricture', 'Benign biliary stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Biliary Stents',
    due: 'Niti-S Biliary Covered Stent [Bumpy]',
    indications: ['Benign biliary stricture', 'Benign pancreatic ductal stricture'],
    similarDevices: [
      'EGIS Biliary Stent (S&G Biotech)',
      'BONASTENT Biliary Stent (Sewoon Medical)',
      'HANAROSTENT Biliary Stent (M.I. Tech)',
      'WallFlex Biliary Transhepatic Stent System (Boston Scientific)',
      'Evolution Biliary Stent System (Cook Medical)',
    ],
  },
  {
    category: 'Drainage Stents',
    due: 'Niti-S Hot Giobor Stent',
    indications: ['EUS-HGS in patients with biliary obstruction'],
    similarDevices: [
      'Niti-S EUS-BD System Spring stopper (Taewoong Medical)',
      'BPD HANAROSTENT Biliary stent (M.I. Tech)',
      'BPE HANAROSTENT Biliary stent (M.I. Tech)',
    ],
  },
];

// Active in-memory storage of DUE Presets
export let biliaryDuePresets: BiliaryDuePreset[] = [...initialBiliaryDuePresets];

type PresetsListener = (presets: BiliaryDuePreset[]) => void;
const listeners: Set<PresetsListener> = new Set();

export function subscribeDuePresets(callback: PresetsListener): () => void {
  listeners.add(callback);
  callback(biliaryDuePresets);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb(biliaryDuePresets);
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * Standard CSV Parser handling quotes and multi-line values
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

/**
 * Fetches and parses DUE Presets from Google Sheet CSV on app startup.
 * Headers: `Device Category`, `DUE Product Name`, `Target Indications`, `Similar Devices / Benchmark Devices`.
 * Splits indications by `|` and Similar Devices by `||`.
 */
export async function fetchAndStoreDuePresets(): Promise<BiliaryDuePreset[]> {
  try {
    const res = await fetch(GOOGLE_SHEET_PRESETS_CSV_URL, {
      method: 'GET',
      headers: {
        Accept: 'text/csv,text/plain,*/*',
      },
      cache: 'no-cache',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const csvText = await res.text();
    if (!csvText || !csvText.trim()) {
      return biliaryDuePresets;
    }

    const rows = parseCSV(csvText);
    if (rows.length <= 1) {
      return biliaryDuePresets;
    }

    const parsedPresets: BiliaryDuePreset[] = [];

    // Header is row 0
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const category = (row[0] || '').trim();
      const dueName = (row[1] || '').trim();
      const rawIndications = (row[2] || '').trim();
      const rawSimilar = (row[3] || '').trim();

      if (!dueName) continue;

      const indications = rawIndications
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);

      const similarDevices = rawSimilar
        .split('||')
        .map((s) => s.trim())
        .filter(Boolean);

      parsedPresets.push({
        category: category || undefined,
        due: dueName,
        indications,
        similarDevices,
      });
    }

    if (parsedPresets.length > 0) {
      biliaryDuePresets = parsedPresets;
      notifyListeners();
    }

    return biliaryDuePresets;
  } catch (error) {
    console.warn('[DUE Presets] Failed to fetch live Google Sheet presets, using fallback:', error);
    return biliaryDuePresets;
  }
}

// Trigger initial fetch immediately on module load / startup
fetchAndStoreDuePresets().catch(() => {});
