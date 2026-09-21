export type ScreeningCategory =
  | '1. Biliary Stent'
  | '2. Esophageal Stent'
  | '3. Pyloric/Duodenal Stent'
  | '4. Colonic Stent'
  | '5. Drainage Stent';

export type ScreeningDecision = 'Include' | 'Exclude' | 'Review' | 'Duplicated';

export interface ScreeningItem {
  no: number;
  id: string; // PMID, NCT ID, DOI, or Title
  category: string;
  subModel: string;
  title: string;
  evaluationStandard: string; // 'Full-text (Open Access)', 'Abstract Only', 'No Data'
  abstractSummary: string;
  aiDecision: ScreeningDecision;
  conclusion: string;
  link?: string;
  clinicalStatus?: string; // For ClinicalTrials
  doi?: string;
  searchSources?: string[];
}

export interface ScreeningHistoryRecord {
  category: string;
  subModel: string;
  result: string;
}

export type ScreeningHistoryMap = Record<string, ScreeningHistoryRecord>;

export type EngineMode = 'PubMed Engine' | 'GIE Journal Engine' | 'ClinicalTrials Engine';

export type PubMedSubMode = 'PubMed PICO 자동 검색' | 'PMID 리스트 업로드' | '단일 PMID 입력';

export type GieSubMode = 'GIE RIS 파일 일괄 스크리닝';

export type ClinicalTrialsSubMode = 'ClinicalTrials 자동 검색';

export type ScreeningSource =
  | 'pubmed-pico'
  | 'pmid-list'
  | 'single-pmid'
  | 'gie-ris'
  | 'clinical-trials';

export interface ScreeningSession {
  id: string;
  source: ScreeningSource;
  label: string;
  variant: string;
  category: string;
  subModel: string;
  criteriaVersion: string;
  query?: string;
  updatedAt: string;
  items: ScreeningItem[];
}

export type DashboardFilter = 'ALL' | 'INC' | 'EXC' | 'PENDING' | 'DUP';

export interface PicoQueryPreset {
  p: string;
  i: string;
  c: string;
  o: string;
  addSearchQueries: string[];
  includeCriteria: string;
  excludeCriteria: string;
}

export interface StentProductCatalogItem {
  modelName: string;
  imageFileName: string;
  description: string;
}

export interface StentSubModelGroup {
  subGroupName: string;
  models: StentProductCatalogItem[];
}
