import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(projectDir, 'server', 'training-source');
const outputPath = path.join(projectDir, 'server', 'productScreeningTrainingData.jsonl');

const sources = [
  { file: '1. Biliary.txt', category: '1. Biliary Stent' },
  { file: '2. Esophageal.txt', category: '2. Esophageal Stent' },
  { file: '3. Pyloric.txt', category: '3. Pyloric/Duodenal Stent' },
  { file: '4. Colonic.txt', category: '4. Colonic Stent' },
  { file: '5. Drainage.txt', category: '5. Drainage Stent' },
];

function normalizeSearchCombination(line) {
  const lower = line.toLowerCase();
  if (lower.includes('specializing in search scope')) return 'I-only';
  if (lower.includes('comparator') && lower.includes('outcome')) return 'P+C+O';
  if (lower.includes('population') && lower.includes('outcome')) return 'P+O';
  if (lower.includes('population') && lower.includes('intervention')) return 'P+I';
  return 'Unspecified';
}

function normalizeSection(category, heading) {
  const normalized = heading.replace(/^[A-C][.．]\s*/i, '').trim();
  if (normalized) return normalized;
  return category.replace(/^\d+\.\s*/, '');
}

function parseSource({ file, category }) {
  const lines = fs.readFileSync(path.join(sourceDir, file), 'utf8').split(/\r?\n/);
  const recordsByPmid = new Map();
  let productSection = category.replace(/^\d+\.\s*/, '');
  let searchCombination = 'Unspecified';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^[A-C][.．]\s*/i.test(line) && !/PMID:/i.test(line)) {
      productSection = normalizeSection(category, line);
      continue;
    }
    if (/Search Terms:/i.test(line)) {
      searchCombination = normalizeSearchCombination(line);
      continue;
    }

    const pmidMatch = line.match(/PMID:\s*(\d+)/i);
    const statusMatch = line.match(/\s+(Not\s+Selected|Selected(?:\s*\(\d+\))?|Duplicated)\s*$/i);
    if (!pmidMatch || !statusMatch) continue;

    const pmid = pmidMatch[1];
    const rawStatus = statusMatch[1];
    if (/^Duplicated$/i.test(rawStatus) || recordsByPmid.has(pmid)) continue;

    const decision = /^Selected/i.test(rawStatus) ? 'Include' : 'Exclude';
    let article = line
      .replace(/^\d+[.]?\s*/, '')
      .replace(/\s+(?:Not\s+Selected|Selected(?:\s*\(\d+\))?|Duplicated)\s*$/i, '')
      .trim();

    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (/^Reason for (?:Exclusion|Selection)/i.test(lines[cursor]?.trim() || '')) {
      cursor += 1;
      while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    }

    const possibleReason = lines[cursor]?.trim() || '';
    const isNextRecord = /PMID:\s*\d+/i.test(possibleReason);
    const isNewSection = /Search Terms:|^Articles\s*\(/i.test(possibleReason);
    const conclusion = !isNextRecord && !isNewSection
      ? possibleReason
      : decision === 'Include'
        ? 'The article was selected by the expert for this product-specific screening context.'
        : 'Irrelevant article: The article did not satisfy the product-specific screening criteria.';

    recordsByPmid.set(pmid, {
      pmid,
      category,
      productSection,
      searchCombination,
      article,
      decision,
      conclusion,
      sourceFile: file,
    });
  }

  return [...recordsByPmid.values()];
}

const records = sources.flatMap(parseSource);
const output = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
fs.writeFileSync(outputPath, output, 'utf8');

const byCategory = Object.fromEntries(
  sources.map(({ category }) => {
    const rows = records.filter((record) => record.category === category);
    return [category, {
      total: rows.length,
      include: rows.filter((record) => record.decision === 'Include').length,
      exclude: rows.filter((record) => record.decision === 'Exclude').length,
    }];
  })
);

console.log(JSON.stringify({ outputPath, total: records.length, byCategory }, null, 2));
