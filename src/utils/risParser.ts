export interface RisEntry {
  title: string;
  abstract: string;
  doi: string;
  url: string;
  authors: string[];
  year?: string;
  journal?: string;
}

export function parseRisFile(content: string): RisEntry[] {
  const entries: RisEntry[] = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let currentEntry: Partial<RisEntry> | null = null;
  let currentTag = '';
  let currentVal = '';

  const saveCurrentField = () => {
    if (!currentEntry || !currentTag) return;
    const tag = currentTag.toUpperCase().trim();
    const val = currentVal.trim();

    if (tag === 'TI' || tag === 'T1' || tag === 'CT' || tag === 'BT') {
      currentEntry.title = currentEntry.title ? `${currentEntry.title} ${val}` : val;
    } else if (tag === 'AB' || tag === 'N2') {
      currentEntry.abstract = currentEntry.abstract ? `${currentEntry.abstract} ${val}` : val;
    } else if (tag === 'DO' || tag === 'DI') {
      currentEntry.doi = val;
    } else if (tag === 'UR' || tag === 'LK') {
      currentEntry.url = val;
    } else if (tag === 'AU' || tag === 'A1') {
      if (!currentEntry.authors) currentEntry.authors = [];
      currentEntry.authors.push(val);
    } else if (tag === 'PY' || tag === 'Y1' || tag === 'DA') {
      currentEntry.year = val.slice(0, 4);
    } else if (tag === 'JO' || tag === 'JF' || tag === 'JA' || tag === 'T2') {
      currentEntry.journal = val;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line matches "TAG  - Value" or "TAG - Value"
    const tagMatch = line.match(/^([A-Z0-9]{2})\s*-\s*(.*)$/);

    if (tagMatch) {
      saveCurrentField();
      currentTag = tagMatch[1];
      currentVal = tagMatch[2] || '';

      if (currentTag === 'TY') {
        currentEntry = {
          title: '',
          abstract: '',
          doi: '',
          url: '',
          authors: [],
        };
      } else if (currentTag === 'ER') {
        if (currentEntry && (currentEntry.title || currentEntry.abstract || currentEntry.doi)) {
          entries.push({
            title: currentEntry.title || 'Untitled',
            abstract: currentEntry.abstract || '',
            doi: currentEntry.doi || currentEntry.url || '-',
            url: currentEntry.url || '',
            authors: currentEntry.authors || [],
            year: currentEntry.year,
            journal: currentEntry.journal,
          });
        }
        currentEntry = null;
        currentTag = '';
        currentVal = '';
      }
    } else if (currentEntry && currentTag) {
      // Multi-line continuation
      currentVal += ` ${trimmed}`;
    }
  }

  // Final flush if no explicit ER at end
  if (currentEntry && (currentEntry.title || currentEntry.abstract || currentEntry.doi)) {
    saveCurrentField();
    entries.push({
      title: currentEntry.title || 'Untitled',
      abstract: currentEntry.abstract || '',
      doi: currentEntry.doi || currentEntry.url || '-',
      url: currentEntry.url || '',
      authors: currentEntry.authors || [],
      year: currentEntry.year,
      journal: currentEntry.journal,
    });
  }

  return entries;
}
