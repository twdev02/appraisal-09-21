import * as XLSX from 'xlsx';
import { ScreeningItem, ScreeningHistoryMap } from '../types/screening';

export function exportScreeningToExcel(items: ScreeningItem[], fileName = 'screening_results.xlsx') {
  // Format items for Excel export
  const rows = items.map((item, idx) => ({
    'No': idx + 1,
    '카테고리': item.category,
    '세부 모델': item.subModel,
    '검색 출처': item.searchSources?.join(', ') || '',
    '식별자 (PMID / NCT / DOI)': item.id,
    '논문/시험 제목': item.title,
    '평가 기준': item.evaluationStandard,
    '초록/요약': item.abstractSummary,
    'AI 판정': item.aiDecision,
    'Conclusion': item.conclusion,
    '원문 링크': item.link || item.doi || '',
    ...(item.clinicalStatus ? { '임상 진행 상태': item.clinicalStatus } : {}),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 6 },  // No
    { wch: 18 }, // 카테고리
    { wch: 26 }, // 세부 모델
    { wch: 28 }, // 검색 출처
    { wch: 18 }, // 식별자
    { wch: 45 }, // 제목
    { wch: 18 }, // 평가기준
    { wch: 40 }, // 초록
    { wch: 14 }, // AI 판정
    { wch: 45 }, // Conclusion
    { wch: 35 }, // 링크
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Screening Results');

  XLSX.writeFile(workbook, fileName);
}

export async function parsePmidListFromFile(file: File): Promise<string[]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (rows.length === 0) return [];

  // Find PMID column index
  const headerRow = rows[0];
  let pmidColIdx = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const colName = String(headerRow[i] || '').trim().toLowerCase();
    if (colName === 'pmid' || colName === 'pmids' || colName.includes('pmid')) {
      pmidColIdx = i;
      break;
    }
  }

  const pmids: string[] = [];

  if (pmidColIdx !== -1) {
    for (let r = 1; r < rows.length; r++) {
      const val = rows[r][pmidColIdx];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const cleanPmid = String(val).replace(/\.0$/, '').trim();
        if (/^\d+$/.test(cleanPmid)) {
          pmids.push(cleanPmid);
        }
      }
    }
  } else {
    // If no explicit PMID header, search entire first column or all cells
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const val = String(rows[r][c] || '').replace(/\.0$/, '').trim();
        if (/^\d{5,9}$/.test(val) && !pmids.includes(val)) {
          pmids.push(val);
        }
      }
    }
  }

  return Array.from(new Set(pmids));
}

export async function parseScreeningHistoryFile(file: File): Promise<ScreeningHistoryMap> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

  const historyMap: ScreeningHistoryMap = {};

  for (const row of rows) {
    let identifier = '';
    if (row['PMID']) {
      identifier = String(row['PMID']).replace(/\.0$/, '').trim();
    } else if (row['식별자 (PMID / NCT / DOI)']) {
      identifier = String(row['식별자 (PMID / NCT / DOI)']).replace(/\.0$/, '').trim().toLowerCase();
    } else if (row['NCT 번호 (URL)']) {
      const parts = String(row['NCT 번호 (URL)']).split('/');
      identifier = parts[parts.length - 1].trim().toLowerCase();
    } else if (row['DOI / URL']) {
      identifier = String(row['DOI / URL']).trim().toLowerCase();
    } else if (row['논문 제목'] || row['논문/시험 제목']) {
      identifier = String(row['논문 제목'] || row['논문/시험 제목']).trim().toLowerCase();
    } else if (row['임상시험 제목']) {
      identifier = String(row['임상시험 제목']).trim().toLowerCase();
    }

    if (identifier && identifier !== '-') {
      historyMap[identifier] = {
        category: String(row['카테고리'] || '기존 이력'),
        subModel: String(row['세부 모델'] || '과거 파일'),
        result: String(row['AI 판정'] || 'Screened'),
      };
    }
  }

  return historyMap;
}
