import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// ★ 추후 만들 screeningExamples.ts 파일 연동을 위한 임포트 (파일이 없으면 이 한 줄만 주석 처리하시면 됩니다)
// import { FEW_SHOT_EXAMPLES } from './screeningExamples';

export interface PubmedSearchParams {
  p_text?: string;
  i_text?: string;
  c_text?: string;
  o_text?: string;
  start_year?: number;
  start_month?: number;
  end_year?: number;
  end_month?: number;
  fetch_all?: boolean;
  max_results?: number;
  ncbi_api_key?: string;
  direct_query?: string;
  filters?: string[];
  sort?: 'relevance' | 'pub_date' | string;
}

export function parsePicoInput(text: string): string {
  if (!text || !text.trim()) return '';
  const rawKeywords = text.replace(/,/g, '\n').split('\n');
  const keywords = rawKeywords.map((kw) => kw.trim()).filter(Boolean);
  if (keywords.length === 0) return '';
  const formatted = keywords.map((kw) =>
    kw.includes('"') || kw.includes('[') ? kw : `(${kw})`
  );
  return formatted.length === 1 ? formatted[0] : `(${formatted.join(' OR ')})`;
}

export async function searchPubmedPmids(params: PubmedSearchParams): Promise<{
  pmids: string[];
  fullQuery: string;
  totalFound: number;
}> {
  let fullQuery = '';
  if (params.direct_query && params.direct_query.trim()) {
    fullQuery = params.direct_query.trim();
  } else {
    const parts = [
      parsePicoInput(params.p_text || ''),
      parsePicoInput(params.i_text || ''),
      parsePicoInput(params.c_text || ''),
      parsePicoInput(params.o_text || ''),
    ].filter(Boolean);
    fullQuery = parts.join(' AND ');
  }

  if (params.filters && params.filters.length > 0) {
    const activeFilters = params.filters.filter(Boolean);
    if (activeFilters.length > 0) {
      const articleTypeFilters = [
        'clinical trial[Filter]',
        'randomized controlled trial[Filter]',
        'systematic review[Filter]',
        'meta-analysis[Filter]',
        'review[Filter]',
      ];

      const selectedArticleTypes = activeFilters.filter((f) => articleTypeFilters.includes(f));
      const otherFilters = activeFilters.filter((f) => !articleTypeFilters.includes(f));
      const filterParts: string[] = [];

      otherFilters.forEach((f) => filterParts.push(`(${f})`));

      if (selectedArticleTypes.length > 0) {
        if (selectedArticleTypes.length === 1) {
          filterParts.push(`(${selectedArticleTypes[0]})`);
        } else {
          filterParts.push(`(${selectedArticleTypes.join(' OR ')})`);
        }
      }

      if (filterParts.length > 0) {
        const filterClause = filterParts.join(' AND ');
        fullQuery = fullQuery ? `(${fullQuery}) AND (${filterClause})` : filterClause;
      }
    }
  }

  if (!fullQuery) {
    return { pmids: [], fullQuery: '', totalFound: 0 };
  }

  const startYear = params.start_year || 2026;
  const startMonth = params.start_month || 1;
  const endYear = params.end_year || 2026;
  const endMonth = params.end_month || 12;

  // 해당 월의 실제 마지막 날짜 계산
  const lastDay = new Date(endYear, endMonth, 0).getDate(); 
  const minDateStr = `${startYear}/${String(startMonth).padStart(2, '0')}/01`;
  const maxDateStr = `${endYear}/${String(endMonth).padStart(2, '0')}/${lastDay}`;

  const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
  const queryParams = new URLSearchParams({
    db: 'pubmed',
    term: fullQuery,
    retmode: 'json',
    retmax: '0',
    datetype: 'pdat',
    mindate: minDateStr,
    maxdate: maxDateStr,
    sort: params.sort || 'relevance',
  });

  if (params.ncbi_api_key) {
    queryParams.set('api_key', params.ncbi_api_key);
  }

  const countRes = await fetch(`${baseUrl}?${queryParams.toString()}`);
  if (!countRes.ok) {
    throw new Error(`NCBI Search error: HTTP ${countRes.status}`);
  }
  const countData: any = await countRes.json();
  const totalFound = parseInt(countData?.esearchresult?.count || '0', 10);

  const actualRetmax = params.fetch_all
    ? totalFound
    : Math.min(params.max_results || 20, totalFound);

  if (actualRetmax === 0) {
    return { pmids: [], fullQuery, totalFound };
  }

  queryParams.set('retmax', String(actualRetmax));
  const fetchRes = await fetch(`${baseUrl}?${queryParams.toString()}`);
  if (!fetchRes.ok) {
    throw new Error(`NCBI Fetch PMIDs error: HTTP ${fetchRes.status}`);
  }
  const fetchData: any = await fetchRes.json();
  const pmids: string[] = fetchData?.esearchresult?.idlist || [];

  return { pmids, fullQuery, totalFound };
}

export async function fetchPubmedArticle(
  pmid: string,
  ncbiApiKey = ''
): Promise<{
  title: string;
  abstract: string | null;
  pmcid: string | null;
  journal: string;
  pubTypes: string[];
  lang: string;
  status: string;
}> {
  const cleanPmid = String(pmid).replace(/\.0$/, '').trim();
  let url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${cleanPmid}&retmode=xml`;
  if (ncbiApiKey) {
    url += `&api_key=${ncbiApiKey}`;
  }

  let res: Response | null = null;
  let lastStatus = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
      res = await fetch(url);
      if (res.status === 429) {
        lastStatus = 'NCBI HTTP 429 (Rate Limit)';
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        continue;
      }
      if (res.ok) {
        break;
      }
      lastStatus = `NCBI HTTP ${res.status}`;
    } catch (err: any) {
      lastStatus = err.message || 'Fetch failed';
    }
  }

  if (!res || !res.ok) {
    try {
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${cleanPmid}&retmode=json${ncbiApiKey ? `&api_key=${ncbiApiKey}` : ''}`;
      const sumRes = await fetch(summaryUrl);
      if (sumRes.ok) {
        const sumJson: any = await sumRes.json();
        const doc = sumJson?.result?.[cleanPmid];
        if (doc && doc.title) {
          return {
            title: doc.title.replace(/<[^>]+>/g, '').trim(),
            abstract: null,
            pmcid: doc.articleids?.find((a: any) => a.idtype === 'pmc')?.value || null,
            journal: doc.source || doc.fulljournalname || '',
            pubTypes: doc.pubtype || [],
            lang: 'eng',
            status: 'Summary Only',
          };
        }
      }
    } catch (e) {
      // Fallback ignore
    }

    return {
      title: `PMID ${cleanPmid}`,
      abstract: null,
      pmcid: null,
      journal: '',
      pubTypes: [],
      lang: 'eng',
      status: lastStatus || 'Lookup Error',
    };
  }

  const xmlText = await res.text();

  const titleMatch = xmlText.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : `PMID ${cleanPmid}`;

  const pmcidMatch = xmlText.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/i);
  const pmcid = pmcidMatch ? pmcidMatch[1].trim() : null;

  const journalMatch =
    xmlText.match(/<MedlineTA>([^<]+)<\/MedlineTA>/i) ||
    xmlText.match(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/i) ||
    xmlText.match(/<Journal>\s*(?:<ISSN[^>]*>[^<]*<\/ISSN>)?\s*(?:<JournalIssue[^>]*>[\s\S]*?<\/JournalIssue>)?\s*<Title>([^<]+)<\/Title>/i) ||
    xmlText.match(/<Title>([^<]+)<\/Title>/i);
  const journal = journalMatch ? journalMatch[1].trim() : '';

  const pubTypes = [...xmlText.matchAll(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/gi)].map(
    (m) => m[1].trim()
  );

  const langMatch = xmlText.match(/<Language>([^<]+)<\/Language>/i);
  const lang = langMatch ? langMatch[1].trim() : 'eng';

  const abstractMatch =
    xmlText.match(/<Abstract>([\s\S]*?)<\/Abstract>/i) ||
    xmlText.match(/<OtherAbstract[^>]*>([\s\S]*?)<\/OtherAbstract>/i);
  const abstract = abstractMatch
    ? abstractMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : null;

  return {
    title,
    abstract,
    pmcid,
    journal,
    pubTypes,
    lang,
    status: 'Success',
  };
}

export async function fetchPmcFullText(
  pmcid: string,
  ncbiApiKey = ''
): Promise<string | null> {
  try {
    let url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcid}&retmode=xml`;
    if (ncbiApiKey) {
      url += `&api_key=${ncbiApiKey}`;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return null;
    const text = bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 15000);
  } catch (e) {
    return null;
  }
}

export async function searchClinicalTrialsStudies(params: {
  condition?: string;
  intervention?: string;
  statusFilters?: string[];
  typeFilters?: string[];
  fetchAll?: boolean;
  maxResults?: number;
}): Promise<{
  studies: {
    nctId: string;
    title: string;
    summary: string;
    status: string;
  }[];
  queryUrl: string;
}> {
  const url = 'https://clinicaltrials.gov/api/v2/studies';
  const pageSize = params.fetchAll ? 1000 : Math.min(params.maxResults || 20, 1000);

  const queryParams = new URLSearchParams({
    pageSize: String(pageSize),
    format: 'json',
    countTotal: 'true',
  });

  if (params.condition && params.condition.trim()) {
    queryParams.set('query.cond', params.condition.trim());
  }
  if (params.intervention && params.intervention.trim()) {
    queryParams.set('query.intr', params.intervention.trim());
  }
  if (params.statusFilters && params.statusFilters.length > 0 && params.statusFilters.length < 9) {
    queryParams.set('filter.overallStatus', params.statusFilters.join(','));
  }
  if (params.typeFilters && params.typeFilters.length > 0) {
    queryParams.set('filter.studyType', params.typeFilters.join(','));
  }

  const studies: {
    nctId: string;
    title: string;
    summary: string;
    status: string;
  }[] = [];

  let pageToken: string | null = null;
  let firstUrl = '';

  while (true) {
    if (pageToken) {
      queryParams.set('pageToken', pageToken);
    }
    const fullUrl = `${url}?${queryParams.toString()}`;
    if (!firstUrl) firstUrl = fullUrl;

    const res = await fetch(fullUrl);
    if (!res.ok) {
      throw new Error(`ClinicalTrials API error: HTTP ${res.status}`);
    }
    const data: any = await res.json();
    const rawStudies = data?.studies || [];

    for (const study of rawStudies) {
      const protocol = study?.protocolSection || {};
      const ident = protocol?.identificationModule || {};
      const desc = protocol?.descriptionModule || {};
      const statusMod = protocol?.statusModule || {};

      const nctId = ident?.nctId || 'Unknown';
      const title = desc?.briefTitle || 'Untitled Study';
      const summary = desc?.briefSummary || '';
      const status = statusMod?.overallStatus || 'Unknown';

      studies.push({ nctId, title, summary, status });

      if (!params.fetchAll && studies.length >= (params.maxResults || 20)) {
        break;
      }
    }

    if (!params.fetchAll && studies.length >= (params.maxResults || 20)) {
      break;
    }

    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }

  return {
    studies: params.fetchAll ? studies : studies.slice(0, params.maxResults || 20),
    queryUrl: firstUrl,
  };
}

export interface ArticleMetadata {
  pmid?: string;
  journal?: string;
  pmcid?: string | null;
  pubTypes?: string[];
  lang?: string;
  doi?: string;
}

export function generateScreeningPrompt(
  category: string,
  subModel: string,
  includeCriteria: string,
  excludeCriteria: string,
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): string {
  const isGieOrOpenAccess =
    meta?.pmcid ||
    (meta?.journal &&
      (meta.journal.toLowerCase().includes('gastrointest endosc') ||
        meta.journal.toLowerCase().includes('gastrointestinal endoscopy') ||
        meta.journal.toLowerCase().includes('curr oncol') ||
        meta.journal.toLowerCase().includes('bmc') ||
        meta.journal.toLowerCase().includes('world j gastroenterol') ||
        meta.journal.toLowerCase().includes('j gastrointestin liver dis') ||
        meta.journal.toLowerCase().includes('int j surg')));

  return `너는 의료기기 임상평가(CER) 및 체계적 문헌고찰(Systematic Review) 전문가야. 
아래 제공된 논문 정보(제목, 초록 또는 전문)와 저널 정보, 그리고 태웅메디칼 CER 평가 기준 및 [인간 평가자 실제 판정 데이터(Ground Truth)]를 바탕으로 최종 판정(Include 또는 Exclude)과 1문장 Conclusion(판정 사유)을 작성하라.

[평가 대상 제품 및 분류]:
- 카테고리: ${category}
- 세부 모델: ${subModel}
${meta?.journal ? `- 저널명: ${meta.journal}` : ''}
${meta?.pmcid ? `- PubMed Central Open Access: PMC${meta.pmcid} (원문 무료 접근 가능)` : ''}
${meta?.pubTypes && meta.pubTypes.length > 0 ? `- 논문 유형: ${meta.pubTypes.join(', ')}` : ''}
${isGieOrOpenAccess ? `- 저널 구독 상태: GIE 저널 구독 또는 Open Access 저널 (원문 및 임상 데이터 검토 가능)` : `- 저널 구독 상태: 유료 폐쇄 저널 (원문 접근 제한 및 초록 기반 제한적 검토)`}

[태웅메디칼 CER 문헌 스크리닝 엄격 규칙]:

0. ★ [MEDDEV 2.7/1 rev 4 & MDR CER 관련성(Relevance) 기본 원칙] ★:
   - 다음 4가지 핵심 임상 정보 중 하나를 평가 기기(Actual device), 동등 기기(Equivalent device), 또는 벤치마크/대안 치료법(Alternative therapy/Comparator) 관점에서 실질적으로 제공하는 연구가 유의미한 임상 근거(Relevance)로 평가된다:
     1) Clinical conditions or history (대상 질환의 임상 병태생리 및 자연 경과)
     2) The clinical or technical results (기기 또는 대조군의 임상적/기술적 유효성 성과)
     3) Benefits-Risks information including complications (합병증을 포함한 유익성-유해성 분석)
     4) New technology or newly introduced device (새롭게 도입된 기술 및 임상 성능)
   - ★ **[사유 작성 시 획일적인 문구 지양 및 현재 논문 근거 원칙]**:
     * "LAMS 가 아닌~~", "위장관 스텐트를 사용하지 않기 때문에"와 같은 기계적이고 획일적인 문구는 CER 감사에서 부적절합니다.
     * **Include든 Exclude든 현재 논문 초록(Abstract)의 구체적인 연구 목적(Aim/Objective), 대상 환자/질환(Patients/Indication), 평가 기술/중재(Intervention/Comparator), 주요 결과(Results/Conclusion)를 근거로 자연스러운 1개의 영문 문장을 새로 작성하십시오. 원문의 1인칭 문장이나 참고 사례의 Conclusion을 그대로 인용·복사하지 마십시오.**

1. ★ [PICO 3단계 적합성 절대 검증 및 Include/Exclude 판정 원칙] ★:
   - **Evidence synthesis 보호 원칙**:
     * Systematic review, meta-analysis, clinical guideline, consensus 또는 appropriate-use criteria는 원저가 아니라는 이유만으로 배제하지 않는다.
     * 해당 품목의 스텐트와 허가 적응증을 직접 다루면서 임상 성능, 안전성, 유익성-위해성, 합병증 또는 사용 권고를 종합하면 **Include**한다.
     * 이러한 문헌의 본문에서 동물실험, in-vitro 또는 bench test가 배경 근거로 언급되더라도 논문 자체를 전임상 연구로 분류하지 않는다. 전임상 배제 사유는 평가 대상 연구 자체가 동물·실험실·벤치 연구인 경우에만 사용한다.
   - **Step 1 [평가 기기 및 사전 정의 Comparator 검증 - 최우선 원칙]**:
     * 이 Comparator 포함 원칙은 아래의 일반적인 intervention 관련 문구 또는 유사 참고 사례보다 우선한다.
     * 자가팽창형 금속 스텐트(SEMS/LAMS)의 임상 성능·안전성을 평가한 연구라도, 선택한 세부 품목의 기기 구성·적용 경로와 관련되거나 사전 정의된 Comparator/SOTA에 해당하는지 확인한 후 Include한다.
     * 스텐트와 Comparator를 직접 비교한 연구뿐 아니라, LSP의 Comparator 항목에 사전 정의된 치료법이 단독으로 사용된 연구도 아래 조건을 모두 충족하면 Include한다.
       1) 평가 제품의 허가 적응증과 정확히 일치한다.
       2) 평가 제품의 대상 환자군과 임상적으로 유사한 환자군이다.
       3) 해당 Comparator가 연구에서 실제 치료 중재로 사용되었다.
       4) 임상 성공, 증상 개선, 합병증, 재중재, 생존 등 평가 제품과 비교 가능한 임상 성능·안전성 결과를 제공한다.
       5) 실제 인간 대상 임상연구이며 유효한 결과가 제시되어 있다.
     * Comparator가 검색어·배경·고찰에서 언급만 되었거나, 진단법·수술기법 설명만 있고 비교 가능한 임상 결과가 없으면 Include하지 않는다.
   - **Step 2 [Indication 일치성 검증]**:
     * 연구 대상 질환이 해당 제품의 허가 적응증(장관 협착/폐색, 담도 협착, 악성/양성 폐색, TEF 누공, 췌장 가성낭종/WON 등)과 일치해야 한다.
     * 장기(Organ)가 같더라도 적응증이 림프종(DLBCL/Lymphoma), 육종(Sarcoma), 단순 용종/선종 발견율(Adenoma detection), 변비/배변장애, 직장탈출증/직장류(Rectocele), 소장세균과다증식(SIBO), 호산구성 위장염, 소아 선천성 기형, 단순 수술 후 창상감염/신부전인 경우 **100% Exclude (Irrelevant articles)**한다!
   - **Step 3 [Comparator 단독 연구의 포함·배제 원칙]**:
     * LSP에 사전 정의된 Comparator라면 스텐트군이 없는 단독 연구라는 이유만으로 배제하지 않는다. Step 1의 적응증·환자군·실제 중재·임상 결과 조건을 모두 충족하면 Include한다.
     * 장기만 같고 적응증이 다르거나, 환자군이 평가 제품 대상군과 크게 다르거나, Comparator가 실제로 평가되지 않았거나, 비교 가능한 임상 결과가 없으면 Exclude한다.
     * 예시: Esophageal SEMS의 Comparator에 Surgery가 사전 정의되어 있고 TEF가 허가 적응증에 해당한다면, 동일 TEF 환자에서 외과적 복원술의 성공, 합병증, 재중재 또는 생존 결과를 보고한 수술 단독 임상연구도 Include한다.

   - **Step 4 [Biliary 품목별 보수적 검토 원칙]**:
     * 카테고리가 Biliary이고 제공된 정보가 초록 중심인 경우, 관련 가능성이 있는 인간 임상 문헌을 과도하게 배제하지 않되, 동일한 담도 적응증이라는 이유만으로 자동 Include하지 않는다.
     * 대상 질환, 실제 중재, 삽입 경로, 스텐트의 covered/uncovered/partially covered 구성 및 선택한 세부 품목(${subModel})과의 관련성을 함께 검토한다.
     * 초록에 metal, SEMS, uncovered 또는 covered 여부가 명시되지 않은 경우에는 그 이유만으로 배제하지 않고 다른 근거와 전문가 사례를 종합한다. 반대로 초록 또는 원문에 선택 품목과 다른 기기 구성이나 전용 삽입 경로가 명확하면 이를 무시하여 Include하지 않는다.
     * EUS-HGS 또는 EUS-CDS 전용 partially covered stent 연구는, 해당 경로·기기가 사전 정의된 Comparator/SOTA이거나 선택 품목과 직접 관련된 경우에만 Include한다. 일반적인 transpapillary biliary stent 또는 Biliary Uncovered 품목과 동일한 근거로 자동 취급하지 않는다.
     * 담도 스텐트가 실제 치료 중재에 포함되어 있다면 iodine-125 seed strand, chemotherapy, PD-1 inhibitor, radiotherapy, RFA 또는 기타 보조치료와 병용되었다는 이유만으로 배제하지 않는다. 해당 복합치료의 유효성 또는 안전성을 평가한 인간 임상 비교연구도 **Include**하여 Full-text appraisal 단계로 넘긴다.
     * "Different indication"은 질환 또는 해부학적 적용 부위가 실제 평가 대상 적응증과 다른 경우에만 사용한다. Cholangiocarcinoma with malignant obstructive jaundice는 Biliary 적응증에 해당하므로 "Different indication"으로 배제하지 않는다.
     * 예시: supra-ampullary versus trans-ampullary biliary stent placement 후 감염률과 스텐트 폐색을 비교한 인간 임상연구는 Include한다.
     * 예시: cholangiocarcinoma with malignant obstructive jaundice 환자에서 biliary stenting with iodine-125 seed strand와 chemotherapy/PD-1 inhibitor 병용치료의 유효성 및 안전성을 평가한 인간 임상 비교연구는 Include한다.

2. Include (선택) 판정 및 Conclusion 작성 양식:
   - **[Include 사유 작성 지침]**:
     * 원문 초록의 Aim/Conclusion/Methods에 명시된 **구체적인 스텐트/시술 방식**, **구체적 대상 적응증**, **핵심 평가 지표**를 원문 텍스트에서 직접 추출하여 영문 1문장으로 작성하라.
     * 전문가 참고 사례는 판정 패턴만 이해하는 데 사용하고, 해당 Conclusion의 문장 구조·표현·고유 문구를 복사하거나 유사하게 바꾸어 사용하지 않는다.
     * 현재 평가 대상 논문의 내용만을 근거로 독립적인 Conclusion을 새로 작성한다.
     * 반드시 중립적인 3인칭 관점으로 작성한다. "we", "our", "ours", "us", "our study", "our results" 등의 1인칭 표현을 사용하지 않고 "the study", "this study", "the authors", "the reported results" 등으로 바꾼다.
     * 해당 연구를 태웅메디칼이 수행·후원·소유한 것처럼 표현하지 않는다(논문에 명시된 경우 제외).
     * 권장 시작 형식:
       - "This meta-analysis compared [원문 목적/결과]..."
       - "This review aims to compare [원문 목적/결과]..."
       - "This study aims to explore the clinical efficacy and safety of [원문 목적/결과]..."
       - "The study was included as it evaluates/compares/assesses [원문 내용]..."
       - "This comparative study presents [원문 내용]..."
   - ★ [품목별 인간 평가자 판정 패턴 요약 - 문장 예시가 아님]:
     * [Colonic]: 동일 적응증의 colonic stenting, 수술 또는 사전 정의된 comparator에 대한 임상 성능·안전성 결과를 평가하면 Include를 고려한다.
     * [Biliary]: 관련 biliary obstruction/stricture에서 선택한 세부 품목에 적용 가능한 SEMS 또는 사전 정의된 comparator의 배액, 개통성, 성공률, 재중재 및 안전성 결과를 평가하면 Include를 고려한다. 동일 적응증만으로 다른 스텐트 구성·전용 삽입 경로까지 자동 Include하지 않는다.
     * [Esophageal]: 관련 esophageal obstruction/stricture 또는 malignant dysphagia에서 esophageal stent와 사전 정의된 comparator의 임상 성능·안전성 및 유익성-위해성을 평가하면 Include를 고려한다. PMID 40557604와 같은 임상 근거 종합 문헌도 이 패턴에 포함된다.
     * [Pyloric/Duodenal]: 관련 GOO/MGOO에서 duodenal stenting, EUS-GJ/EUS-GE, surgical gastrojejunostomy 또는 기타 사전 정의된 comparator의 임상 결과를 평가하면 Include를 고려한다.
     * [Drainage/LAMS]: 관련 적응증에서 LAMS를 이용한 배액의 임상 성공, 병변 해소 및 이상사례를 평가하면 Include를 고려한다.

3. Exclude (배제) 판정 기준 및 Conclusion 작성 양식:
   - 반드시 아래 5가지 표준 카테고리 중 가장 먼저 부합하는 사유를 선택하여 지정된 접두어로 시작할 것:

   ① [1순위] Literature without result of clinical research on human beings:
      - 동물실험, 세포/In-vitro 연구, 생체역학 등 인간 임상 결과가 없는 경우.
      - 예시: "Literature without result of clinical research on human beings: Preclinical in-vitro / animal study without human clinical safety or performance outcomes."

   ② [2순위] Irrelevant article:
      - 접두어: "Irrelevant articles:" (또는 "Irrelevant article:")
      - 초록의 연구 목적/증례 내용/연구 유형에 맞춰 원문 문장을 연결하여 작성한다.
      - 논문이 실제로 평가한 대상과 중재를 긍정형으로 직접 기술한다.
      - "without placement/use/evaluation of [해당 스텐트]", "did not evaluate [해당 스텐트]", "does not involve [해당 스텐트]"처럼 평가 품목을 하지 않았다는 부정형·획일적 문구를 덧붙이지 않는다.
      - 예시: "Irrelevant articles: This study aims to [초록 목적]..." / "Irrelevant articles: This review covers [다룬 내용]..."
      - 권장 예시: "Irrelevant article: The study evaluated the clinical outcomes of endoscopic balloon dilation and surgical reconstruction for corrosive esophageal injuries."

   ③ [3순위] Different indication:
      - 전혀 다른 적응증에 사용된 경우.
      - 예시: "Different indication: The case report described..."

   ④ [4순위] Insufficient information:
      - Letter / Editorial / Comment / Protocol 또는 제공된 제목·초록·원문만으로 관련성이나 임상 정보를 실제로 판단할 수 없는 경우에만 사용한다.
      - ★ 최종수단 원칙: 먼저 Irrelevant article과 Different indication 해당 여부를 끝까지 검토하고, 두 사유로도 판단할 수 없을 때만 사용한다.
      - 논문의 언어가 영어가 아니더라도 영어 제목이나 영어 초록이 제공되어 연구 목적·중재·적응증을 파악할 수 있으면 Non-English 또는 정보 부족으로 배제하지 않는다.
      - 제목·초록에서 TIPS, 수술, 약물, 진단법 등 평가 품목과 무관한 중재가 명확하면 정보 부족이 아니라 "Irrelevant article:"을 사용한다.
      - 예시: "Insufficient information: Letters to Editor" / "Insufficient information: Protocol"

   ⑤ [5순위] Duplicated / Held by Taewoong Medical:
      - "Duplicated" 또는 "This article is already held by Taewoong Medical."

[포함기준 (Inclusion Criteria)]:
${includeCriteria}

[제외기준 (Exclusion Criteria)]:
${excludeCriteria}

[평가 대상 논문 정보]
- [논문 제목]: ${title}
- [제공된 텍스트]: 
${articleContent}

답변형식 (한국어 설명 없이 오직 아래 영문 형식으로만 작성할 것):

판정: (Include 또는 Exclude)

Conclusion:
(영문 사유 1문장)

[작성 규칙]:
1. 마크다운 별표(**)를 일체 사용하지 마라.
2. Include인 경우: "This meta-analysis compared...", "This review aims to compare...", "This study aims to explore the clinical efficacy and safety of...", 또는 "The study was included as it evaluates..." 로 시작하여 구체적 스텐트 방식과 대상 질환, 평가 지표를 명시한 완결된 1개 영문 문장만 작성하라.
3. Exclude인 경우: 반드시 위 5개 카테고리 접두어 중 하나를 정확히 붙여서 작성하라.
4. Irrelevant article 또는 Different indication의 사유는 논문이 실제로 평가한 목적·질환·중재를 긍정형으로 서술하고, "without...", "did not...", "does not..." 뒤에 평가 품목을 언급하는 부정형 문구를 추가하지 마라.
5. 참고 사례의 Conclusion을 그대로 복사하거나 가깝게 바꾸어 쓰지 말고, 현재 논문의 정보만으로 새로운 사유를 작성하라.
6. 중립적인 3인칭 관점만 사용하라. "we", "our", "ours", "us"를 사용하지 말고, 필요한 경우 "the study", "the authors" 또는 "the reported results"로 표현하라.`;
}

export function evaluateArticleRuleBased(
  category: string,
  subModel: string,
  includeCriteria: string,
  excludeCriteria: string,
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): {
  decision: 'Include' | 'Exclude' | 'Review';
  conclusion: string;
} {
  const combinedText = `${title} ${articleContent}`.trim();
  const lower = combinedText.toLowerCase();

  // Systematic reviews/guidelines can mention preclinical evidence in their full text.
  // In that case, preclinical screening must inspect the publication itself (title/type),
  // not incidental animal or bench-test terms contained in the reviewed references.
  const publicationTypes = (meta?.pubTypes || []).join(' ');
  const isEvidenceSynthesis =
    /\b(systematic\s+review|meta[-\s]?analysis|guidelines?|practice\s+guideline|consensus|appropriate\s+use\s+criteria)\b/i.test(
      `${title} ${publicationTypes}`
    );
  const preclinicalDetectionText = isEvidenceSynthesis
    ? `${title} ${publicationTypes}`
    : combinedText;

  // 1. 전임상 / 동물실험 / 인비트로 필터링
  const animalChecks: Array<{ pattern: RegExp; desc: string }> = [
    { pattern: /\b(in\s*vitro|cell\s*culture|phantom\s*model|bench\s*test|finite\s*element)\b/i, desc: 'in-vitro / bench test evaluation' },
    { pattern: /\b(swine|porcine|pig\s*model|piglet)\b/i, desc: 'porcine / animal model' },
    { pattern: /\b(canine|dog\s*model)\b/i, desc: 'canine / animal model' },
    { pattern: /\b(rabbit|murine|mouse\s*model|rat\s*model|rats\b|mice\b)\b/i, desc: 'rodent / animal study' },
    { pattern: /\b(cadaver|cadaveric|ex\s*vivo|biomechanical)\b/i, desc: 'cadaveric / ex-vivo evaluation' },
  ];

  const isPigtailOnly = lower.includes('pigtail') || lower.includes('pig-tail') || lower.includes('piggyback');
  for (const check of animalChecks) {
    if (check.pattern.test(preclinicalDetectionText)) {
      if (check.desc.includes('porcine') && isPigtailOnly && !lower.includes('swine') && !lower.includes('pig model') && !lower.includes('porcine model')) {
        continue;
      }
      return {
        decision: 'Exclude',
        conclusion: `Literature without result of clinical research on human beings: Preclinical ${check.desc} without human clinical safety or performance outcomes.`,
      };
    }
  }

  // 2. Letter / Editorial / Comment 형식 배제
  if (meta?.pubTypes?.some((pt) => /letter|comment|editorial/i.test(pt)) || /\b(letter\s*to\s*the\s*editor|author\s*reply|correspondence|editorial)\b/i.test(combinedText)) {
    if (!lower.includes('patients') && !lower.includes('results') && !lower.includes('case report')) {
      return {
        decision: 'Exclude',
        conclusion: 'Insufficient information: Letter',
      };
    }
  }

  // 3. 실제 환자 데이터가 없는 단순 프로토콜 배제
  const isExplicitProtocol =
    /\b(study\s*protocol|trial\s*protocol|protocol\s*for\s*a|study\s*design\s*and\s*rationale|protocol\b)/i.test(title) ||
    (meta?.pubTypes?.some((pt) => /clinical\s*trial\s*protocol/i.test(pt)) && !lower.includes('results:') && !lower.includes('conclusion:'));

  if (isExplicitProtocol) {
    if (!/\b(patients\s*(were|underwent)|median\s*survival|technical\s*success\s*rate|clinical\s*success\s*rate|patency\s*rate|stent\s*dysfunction)\b/i.test(articleContent)) {
      return {
        decision: 'Exclude',
        conclusion: 'Insufficient information: Protocol',
      };
    }
  }

  const englishWordCount = (articleContent.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  const hasUsableEnglishContent = englishWordCount >= 25;

  // 4. 제목/초록만으로 명백히 평가 품목과 무관한 중재는 정보 부족보다 관련성 배제를 우선한다.
  if (/\b(?:TIPS|transjugular\s+intrahepatic\s+portosystemic\s+shunt|portocaval\s+shunts?|portosystemic\s+gradient)\b/i.test(combinedText)) {
    return {
      decision: 'Exclude',
      conclusion:
        'Irrelevant article: The study presents two clinical cases describing various endovascular techniques for correcting dysfunction of previously established portocaval shunts, aimed at reducing the portosystemic gradient.',
    };
  }

  // 비영어 논문도 영어 제목/초록으로 관련성을 판단할 수 있으면 Gemini로 보낸다.
  // 읽을 수 있는 임상 정보가 실제로 없는 경우에만 마지막 수단으로 정보 부족을 적용한다.
  if (meta?.lang && meta.lang !== 'eng' && !hasUsableEnglishContent) {
    return {
      decision: 'Exclude',
      conclusion: 'Insufficient information: Valid information relevant to performance and/or safety is limited because no usable English abstract or full text was available.',
    };
  }

  // 5. Biliary 초록 스크리닝에서는 관련 가능성이 있는 인간 임상 문헌을
  // 원문 appraisal 전에 과도하게 배제하지 않는다.
  const isBiliaryCategory = /biliary/i.test(`${category} ${subModel}`);
  const hasRelevantBiliaryIndication =
    /\b(malignant\s+biliary\s+(?:obstruction|stricture)|malignant\s+obstructive\s+jaundice|biliary\s+(?:obstruction|stricture|sepsis)|cholangiocarcinoma)\b/i.test(combinedText);
  const hasBiliaryStentIntervention =
    /\bbiliary\s+stent(?:ing|s)?\b|\bstent\s+placement\b/i.test(combinedText);
  const hasHumanClinicalContext =
    /\bpatients?\b|\bretrospective\b|\bprospective\b|\bcohort\b|\bcomparative\s+study\b/i.test(combinedText);
  const hasRelevantClinicalOutcome =
    /\b(infection|sepsis|obstruction|occlusion|patency|clinical\s+success|technical\s+success|adverse\s+events?|complications?|safety|efficacy|reintervention|survival)\b/i.test(combinedText);

  // 동일한 담도 적응증이라도 선택한 세부 품목과 기기 구성·삽입 경로가
  // 명백히 다른 경우에는 광범위한 Biliary 자동 Include를 적용하지 않는다.
  const isUncoveredBiliarySelection =
    isBiliaryCategory && /\buncovered\b/i.test(subModel);
  const isDedicatedEusHgsStudy =
    /\bEUS[-\s]?(?:HGS|guided\s+hepaticogastrostomy)\b|\bhepaticogastrostomy\b/i.test(combinedText) &&
    /\bdedicated\b/i.test(combinedText);
  const isExplicitPartiallyCoveredStent =
    /\bpartially[-\s]?covered\b|\bpcSEMS\b|\bpartial(?:ly)?\s+covered\s+(?:self[-\s]?expandable\s+metal\s+)?stent\b/i.test(combinedText);
  const isEusHgsDeclaredForInclusion =
    /\bEUS[-\s]?(?:HGS|guided\s+hepaticogastrostomy)\b|\bhepaticogastrostomy\b/i.test(includeCriteria);

  if (
    isUncoveredBiliarySelection &&
    isDedicatedEusHgsStudy &&
    isExplicitPartiallyCoveredStent &&
    !isEusHgsDeclaredForInclusion
  ) {
    return {
      decision: 'Exclude',
      conclusion:
        'Irrelevant article: The prospective study evaluated the safety and feasibility of EUS-guided hepaticogastrostomy using a dedicated partially covered self-expandable metal stent in patients with malignant biliary obstruction.',
    };
  }

  if (
    isBiliaryCategory &&
    hasRelevantBiliaryIndication &&
    hasBiliaryStentIntervention &&
    hasHumanClinicalContext &&
    hasRelevantClinicalOutcome
  ) {
    if (/supra[-\s]?ampullary/i.test(combinedText) && /trans[-\s]?ampullary/i.test(combinedText)) {
      return {
        decision: 'Include',
        conclusion:
          'The study was included as it evaluates infection rates and stent obstruction following supra-ampullary versus trans-ampullary biliary stent placement in patients with malignant biliary obstruction.',
      };
    }

    if (/\b(?:125\s*i|i(?:odine)?[-\s]?125)\b/i.test(combinedText)) {
      return {
        decision: 'Include',
        conclusion:
          'The study was included as it evaluates the efficacy and safety of biliary stent implantation combined with an iodine-125 seed strand and systemic anticancer treatment in patients with cholangiocarcinoma and malignant obstructive jaundice.',
      };
    }

    // 그 밖의 Biliary 문헌은 동일 적응증·스텐트 언급만으로 강제 Include하지 않는다.
    // 세부 품목, 적용 경로, 사전 정의 Comparator와 615건 전문가 사례를
    // Gemini가 함께 비교하도록 Review 단계로 전달한다.
  }

  // 6. 전문 확보가 불가능한 유료 저널 배제
  const isGieJournal = meta?.journal && (meta.journal.toLowerCase().includes('gastrointest endosc') || meta.journal.toLowerCase().includes('gastrointestinal endoscopy'));
  const isOpenAccessJournal = Boolean(meta?.pmcid) || /free pmc article|open access|curr oncol|bmc|world j gastroenterol|j gastrointestin liver dis|gut liver|int j surg/i.test(lower);
  const closedPaidJournals = ['lancet', 'expert rev', 'curr opin', 'j gastrointest surg', 'gut', 'surg endosc', 'dig endosc', 'endoscopy', 'j hepatobiliary pancreat sci', 'eur radiol', 'acad radiol'];
  
  const isClosedPaid = meta?.journal && closedPaidJournals.some((cj) => meta.journal!.toLowerCase().includes(cj)) && !isOpenAccessJournal && !isGieJournal;
  if (isClosedPaid && !hasUsableEnglishContent) {
    return {
      decision: 'Exclude',
      conclusion: 'Insufficient information: Valid information relevant to performance and/or safety are limited.',
    };
  }

  // 7. 필터를 통과한 임상 논문은 Gemini AI 추론으로 전송
  return {
    decision: 'Review',
    conclusion: '',
  };
}

export interface ExpertScreeningCase {
  pmid: string;
  article: string;
  decision: 'Include' | 'Exclude';
  conclusion: string;
  tokens: Set<string>;
}

let cachedExpertCases: ExpertScreeningCase[] | null = null;

export function tokenizeScreeningText(text: string): Set<string> {
  if (!text) return new Set();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return new Set(words);
}

export function calculateBinaryTokenCosineSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionCount = 0;
  const [smaller, larger] = setA.size < setB.size ? [setA, setB] : [setB, setA];
  for (const token of smaller) {
    if (larger.has(token)) {
      intersectionCount++;
    }
  }
  return intersectionCount / (Math.sqrt(setA.size) * Math.sqrt(setB.size));
}

function loadExpertCasesFromFile(): ExpertScreeningCase[] {
  let moduleDir = '';
  try {
    moduleDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  } catch {
    moduleDir = process.cwd();
  }

  const candidatePaths = [
    path.join(process.cwd(), 'server', 'screeningTrainingData.jsonl'),
    path.join(process.cwd(), 'server', 'taewoong_vertex_full.jsonl'),
    path.join(process.cwd(), 'screeningTrainingData.jsonl'),
    path.join(process.cwd(), 'taewoong_vertex_full.jsonl'),
    path.join(moduleDir, 'screeningTrainingData.jsonl'),
    path.join(moduleDir, 'taewoong_vertex_full.jsonl'),
  ];

  let resolvedPath = '';
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      resolvedPath = p;
      break;
    }
  }

  if (!resolvedPath) {
    console.warn('[Screening Engine] Warning: Neither screeningTrainingData.jsonl nor taewoong_vertex_full.jsonl found.');
    return [];
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = rawContent.split('\n').filter(Boolean);
    const results: ExpertScreeningCase[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const userText = item.contents?.[0]?.parts?.[0]?.text || '';
        const modelText = item.contents?.[1]?.parts?.[0]?.text || '';

        // Extract decision: Include or Exclude
        const decisionMatch = modelText.match(/판정\s*:\s*(Include|Exclude)/i);
        if (!decisionMatch) continue;
        const decision: 'Include' | 'Exclude' = decisionMatch[1].toLowerCase() === 'include' ? 'Include' : 'Exclude';

        // Extract conclusion
        const conclusionMatch = modelText.match(/(?:^|\n)\s*Conclusion\s*:\s*([\s\S]*)$/i);
        const conclusion = conclusionMatch ? conclusionMatch[1].trim() : '';
        if (!conclusion) continue;

        // Extract PMID
        const pmidMatch = userText.match(/PMID:\s*(\d+)/i);
        const pmid = pmidMatch ? pmidMatch[1] : '';

        // Clean article text: remove 'Evaluate article suitability:\n', leading number/tab,
        // and remove trailing Selected, Selected (숫자), Not Selected, Duplicated
        let cleanArticle = userText.replace(/^Evaluate article suitability:\s*/i, '').trim();
        cleanArticle = cleanArticle.replace(/^\d+\t\s*/, '').trim();
        cleanArticle = cleanArticle.replace(/\t?\s*(?:Selected(?:\s*\(\d+\))?|Not\s*Selected|Duplicated)\s*$/i, '').trim();

        const tokens = tokenizeScreeningText(cleanArticle);

        results.push({
          pmid,
          article: cleanArticle,
          decision,
          conclusion,
          tokens,
        });
      } catch {
        // Skip malformed lines
      }
    }

    console.log(`[Screening Engine] Loaded ${results.length} total expert screening cases from ${path.basename(resolvedPath)}`);
    return results;
  } catch (err: any) {
    console.error(`[Screening Engine] Failed to load expert cases: ${err?.message || err}`);
    return [];
  }
}

export function getExpertCases(): ExpertScreeningCase[] {
  if (cachedExpertCases !== null) {
    return cachedExpertCases;
  }
  cachedExpertCases = loadExpertCasesFromFile();
  return cachedExpertCases;
}

// 7. server/screeningTrainingData.jsonl을 서버 시작 시 한 번만 읽으세요.
cachedExpertCases = loadExpertCasesFromFile();

export function extractArticlePmid(meta?: ArticleMetadata, title?: string, articleContent?: string): string {
  if (meta?.pmid && String(meta.pmid).trim()) {
    return String(meta.pmid).trim();
  }
  const combined = `${title || ''} ${articleContent || ''}`;
  const match = combined.match(/\bPMID:\s*(\d+)\b/i) || combined.match(/\b(\d{7,9})\b/);
  if (match) {
    return match[1];
  }
  return '';
}

export function findExpertReferenceCases(
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): {
  includes: ExpertScreeningCase[];
  excludes: ExpertScreeningCase[];
} {
  const allCases = getExpertCases();
  if (!allCases || allCases.length === 0) {
    return { includes: [], excludes: [] };
  }

  // 15. 현재 평가 논문의 PMID와 동일한 사례는 반드시 제외하세요.
  // 16. PMID는 meta.pmid를 우선 사용하고, 없으면 제목과 본문에서 추출하세요.
  const currentPmid = extractArticlePmid(meta, title, articleContent);

  // 11. 현재 논문의 제목과 초록을 정규화하고, token/keyword overlap 방식으로 615건과 유사도를 계산하세요.
  const currentText = `${title || ''} ${articleContent || ''}`.trim();
  const currentTokens = tokenizeScreeningText(currentText);

  const eligibleCases = allCases.filter((c) => {
    if (currentPmid && c.pmid && c.pmid === currentPmid) {
      return false;
    }
    return true;
  });

  // 12. 너무 긴 문헌이 무조건 높은 점수를 받지 않도록 binary token cosine similarity를 사용하세요.
  const scoredCases = eligibleCases.map((c) => ({
    ...c,
    score: calculateBinaryTokenCosineSimilarity(currentTokens, c.tokens),
  }));

  // 13. 검색 결과는 판정별로 구분하세요: Include 최대 5건, Exclude 최대 5건
  // 14. 전체 상위 10건을 그대로 선택하지 마세요.
  const sortedIncludes = scoredCases
    .filter((c) => c.decision === 'Include')
    .sort((a, b) => b.score - a.score);

  const sortedExcludes = scoredCases
    .filter((c) => c.decision === 'Exclude')
    .sort((a, b) => b.score - a.score);

  const topIncludes = (
    sortedIncludes.filter((c) => c.score > 0).length > 0
      ? sortedIncludes.filter((c) => c.score > 0)
      : sortedIncludes
  ).slice(0, 5);

  const topExcludes = (
    sortedExcludes.filter((c) => c.score > 0).length > 0
      ? sortedExcludes.filter((c) => c.score > 0)
      : sortedExcludes
  ).slice(0, 5);

  return {
    includes: topIncludes,
    excludes: topExcludes,
  };
}

function formatExpertReferenceSection(
  includes: ExpertScreeningCase[],
  excludes: ExpertScreeningCase[]
): string {
  if (includes.length === 0 && excludes.length === 0) {
    return '';
  }

  let text = '\n\n============================================================\n';
  text += '[참고용 이전 전문가 판정 사례 (Expert Reference Cases)]\n';
  text += '다음 사례들은 과거 다른 문헌에 대해 전문가가 내린 실제 판정 및 Conclusion 예시입니다.\n\n';
  text += '[중요 지침 - 반드시 준수]:\n';
  text += '1. 참고 사례는 이전 전문가 판정의 예시일 뿐이다.\n';
  text += '2. 참고 사례의 판정을 무조건 복사하지 않는다.\n';
  text += '3. 현재 논문에는 기존 CER screening criteria(상단의 MEDDEV 2.7/1 rev 4 & PICO 규칙)를 우선 적용한다.\n';
  text += '4. 참고 사례는 경계성 또는 모호한 사례의 보조자료로만 사용한다.\n';
  text += '5. 개별 사례의 유사성보다 명시된 screening criteria를 우선한다.\n';
  text += '6. 참고 사례의 Conclusion은 판단 논리를 이해하기 위한 자료일 뿐 답안 문장이 아니다. 그 문장을 그대로 복사하거나 일부 단어만 바꾸어 사용하지 않는다.\n';
  text += '7. 현재 논문의 제목·초록·원문에 실제로 나타난 목적, 환자군, 적응증, 중재 및 결과만으로 새로운 Conclusion을 작성한다.\n';
  text += '8. "we", "our", "ours", "us"를 사용하지 않고 중립적인 3인칭으로 작성한다.\n\n';

  if (includes.length > 0) {
    text += `[유사 Include 참고 사례 (최대 5건, 현재 ${includes.length}건)]:\n`;
    includes.forEach((item, idx) => {
      text += `[사례 ${idx + 1}]\n`;
      text += `- PMID: ${item.pmid || 'N/A'}\n`;
      text += `- Article: ${item.article}\n`;
      text += `- Expert Decision: ${item.decision}\n`;
      text += `- Conclusion: ${item.conclusion}\n\n`;
    });
  }

  if (excludes.length > 0) {
    text += `[유사 Exclude 참고 사례 (최대 5건, 현재 ${excludes.length}건)]:\n`;
    excludes.forEach((item, idx) => {
      text += `[사례 ${idx + 1}]\n`;
      text += `- PMID: ${item.pmid || 'N/A'}\n`;
      text += `- Article: ${item.article}\n`;
      text += `- Expert Decision: ${item.decision}\n`;
      text += `- Conclusion: ${item.conclusion}\n\n`;
    });
  }

  text += '============================================================\n';
  text += '최종 답변 형식 (반드시 준수):\n\n';
  text += '판정: Include\n또는\n판정: Exclude\n\n';
  text += 'Conclusion: 완결된 영문 1문장\n';

  return text;
}

export function isConclusionCompleteSentence(text: string): boolean {
  if (!text) return false;

  const trimmed = text.trim();

  // 실제로 잘린 응답은 거부
  if (/\.{2,}$/.test(trimmed) || /…$/.test(trimmed)) {
    return false;
  }

  // 마침표 및 닫는 따옴표·괄호·인용표시 허용
  if (/[.!?][“”"'’)\]]*(?:\s*\[\d+(?:[-–,]\d+)*\])?$/.test(trimmed)) {
    return true;
  }

  // 접속사나 전치사로 갑자기 끝난 경우 거부
  if (
    /\b(and|or|but|the|a|an|of|to|in|for|with|by|at|from|that|which|as|on)\s*$/i.test(
      trimmed
    )
  ) {
    return false;
  }

  // 내용은 충분하지만 마지막 마침표만 빠진 경우 허용
  return trimmed.length >= 40 && trimmed.split(/\s+/).length >= 7;
}

export function isValidExcludePrefix(text: string): boolean {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  const validPrefixes = [
    'literature without result of clinical research on human beings',
    'irrelevant article',
    'irrelevant articles',
    'different indication',
    'insufficient information',
    'duplicated',
    'this article is already held by taewoong medical',
    'already held by taewoong medical',
  ];
  return validPrefixes.some((prefix) => lower.startsWith(prefix));
}

export function usesFirstPersonPerspective(text: string): boolean {
  // Case-sensitive alternatives avoid treating the country abbreviation "US" as the pronoun "us".
  return /\b(?:[Ww]e|[Oo]ur|[Oo]urs|[Uu]s)\b/.test(text);
}

export function normalizeExcludeConclusionStyle(text: string): string {
  const trimmed = text.trim();
  if (!/^(?:irrelevant articles?|different indication)\s*:/i.test(trimmed)) {
    return trimmed;
  }

  // 배제 대상 연구가 실제로 수행한 내용을 남기고, 평가 품목의 부재를 반복하는
  // 획일적인 후행 문구는 제거한다.
  return trimmed
    .replace(
      /(?:,|;)?\s+(?:without(?:\s+the)?|and\s+(?:did|does)\s+not|which\s+(?:did|does)\s+not)\s+(?:include|involve|use|evaluate|assess|report|place|implant|perform|provide|the\s+placement|the\s+use|the\s+evaluation)[\s\S]*?[.!?]?$/i,
      '.'
    )
    .replace(/\.{2,}$/, '.')
    .trim();
}

function hasAcceptedFullTextAccess(
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): boolean {
  const accessText = `${meta?.journal || ''} ${title} ${articleContent}`.toLowerCase();
  const hasFetchedFullText = /\[full-text body\]/i.test(articleContent);
  const isGieJournal = Boolean(
    meta?.journal && /gastrointest(?:inal)?\s+endosc/i.test(meta.journal)
  );
  const isOpenAccess =
    Boolean(meta?.pmcid) ||
    /free\s+pmc\s+article|open\s+access|curr\s+oncol|bmc|world\s+j\s+gastroenterol|j\s+gastrointestin\s+liver\s+dis|gut\s+liver|int\s+j\s+surg/i.test(accessText);
  return hasFetchedFullText || isGieJournal || isOpenAccess;
}

function applyFullTextAccessRule(
  result: { decision: 'Include' | 'Exclude' | 'Review'; conclusion: string },
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): { decision: 'Include' | 'Exclude' | 'Review'; conclusion: string } {
  if (result.decision !== 'Include' || hasAcceptedFullTextAccess(title, articleContent, meta)) {
    return result;
  }
  return {
    decision: 'Exclude',
    conclusion: 'Insufficient information: Valid information relevant to performance and/or safety is limited.',
  };
}

export async function runGeminiScreening(
  ai: GoogleGenAI | null,
  category: string,
  subModel: string,
  includeCriteria: string,
  excludeCriteria: string,
  title: string,
  articleContent: string,
  meta?: ArticleMetadata
): Promise<{
  decision: 'Include' | 'Exclude' | 'Review';
  conclusion: string;
}> {
  // 1. Rule-based 평가
  const ruleResult = evaluateArticleRuleBased(
    category,
    subModel,
    includeCriteria,
    excludeCriteria,
    title,
    articleContent,
    meta
  );

  if (ruleResult.decision === 'Exclude') {
    return ruleResult;
  }
  if (ruleResult.decision === 'Include') {
    return applyFullTextAccessRule(ruleResult, title, articleContent, meta);
  }

  if (!ai) {
    return ruleResult;
  }

  // 3. 기존 generateScreeningPrompt()의 CER/MEDDEV 평가 기준은 삭제하거나 수정하지 마세요.
  const basePrompt = generateScreeningPrompt(
    category,
    subModel,
    includeCriteria,
    excludeCriteria,
    title,
    articleContent,
    meta
  );

  // Retrieve expert reference cases
  const { includes, excludes } = findExpertReferenceCases(title, articleContent, meta);

  // 23. Required server logs:
  // - 로드된 전체 전문가 사례 수
  // - 검색된 Include 사례 수
  // - 검색된 Exclude 사례 수
  // - 검색된 사례들의 PMID
  console.log(`[Screening Engine] Total expert cases loaded in memory: ${getExpertCases().length}`);
  console.log(`[Screening Engine] Retrieved reference cases count: Include=${includes.length}, Exclude=${excludes.length}`);
  const allRefPmids = [...includes.map((c) => c.pmid), ...excludes.map((c) => c.pmid)].filter(Boolean);
  console.log(`[Screening Engine] Retrieved reference PMIDs: [${allRefPmids.join(', ')}]`);

  // 17. 기존 generateScreeningPrompt()가 반환한 프롬프트 뒤에 Expert Reference Cases를 추가하세요.
  const referenceSection = formatExpertReferenceSection(includes, excludes);
  const prompt = basePrompt + referenceSection;

  // Screening models (stable text-generation endpoints):
  // Primary: gemini-3.8-flash
  // Fallbacks: gemini-flash-latest, gemini-3.5-flash-lite, gemini-3.1-flash-lite
  const candidateModels = [
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ];

  let lastGeminiError: any = null;

  const geminiApiKey =
    process.env.APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  for (const modelName of candidateModels) {
    const isPrimary = modelName === candidateModels[0];

    let activeClient = ai;
    if (geminiApiKey) {
      try {
        activeClient = new GoogleGenAI({ apiKey: geminiApiKey });
      } catch {
        activeClient = ai;
      }
    }

    if (!activeClient) {
      continue;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (isPrimary) {
          if (attempt === 1) {
            console.log(`[Screening Engine] PRIMARY: ${modelName}`);
          } else {
            console.log(`[Screening Engine] PRIMARY retry (attempt ${attempt}/2)...`);
          }
        } else {
          if (attempt === 1) {
            console.log(`[Screening Engine] FALLBACK: ${modelName}`);
          }
        }

        // For Gemini 3.5 Flash, remove the temperature parameter and use default sampling
        const response = await activeClient.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { maxOutputTokens: 2048 },
        });

        const ansText = response?.text?.trim() || '';
        if (!ansText) throw new Error(`Gemini returned an empty response for model "${modelName}".`);

        let decision: 'Include' | 'Exclude' | 'Review' = 'Review';
        const decisionMatch = ansText.match(/판정\s*:\s*(Include|Exclude)/i);
        if (decisionMatch) {
          decision = decisionMatch[1].toLowerCase() === 'include' ? 'Include' : 'Exclude';
        } else {
          const lower = ansText.toLowerCase();
          if (/\binclude\b/.test(lower) && !/\bexclude\b/.test(lower)) decision = 'Include';
          else if (/\bexclude\b/.test(lower) && !/\binclude\b/.test(lower)) decision = 'Exclude';
        }

        // Parse a clean, concise conclusion.
        let conclusion = '';

        const normalizedAnswer = ansText
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p\s*>/gi, '\n')
          .replace(/<p\s*>/gi, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .trim();

        const conclusionMatch = normalizedAnswer.match(
          /(?:^|\n)\s*(?:#{1,6}\s*)?Conclusion\s*:\s*([\s\S]*)$/i
        );

        if (conclusionMatch?.[1]) {
          conclusion = conclusionMatch[1].trim();
        } else {
          const koreanMatch = normalizedAnswer.match(
            /(?:^|\n)\s*(?:결론|판정\s*사유)\s*[:：-]\s*([\s\S]*)$/i
          );
          if (koreanMatch?.[1]) {
            conclusion = koreanMatch[1].trim();
          } else {
            const lines = normalizedAnswer
              .split(/\n+/)
              .map((line) => line.trim())
              .filter(Boolean);
            conclusion = lines[lines.length - 1] || '';
          }
        }

        conclusion = conclusion
          .replace(/<\/?(?:b|i|strong|em|p|br|div|span|ul|li|ol)[^>]*>/gi, ' ')
          .replace(/\*\*/g, '')
          .replace(/^\s*(?:Conclusion|결론|판정\s*사유)\s*[:：-]\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (decision === 'Exclude') {
          conclusion = normalizeExcludeConclusionStyle(conclusion);
        }

        // 내용은 완전하지만 마지막 마침표만 누락된 경우 자동 보정
        if (conclusion && !/[.!?][“”"'’\)\]]*$/.test(conclusion)) {
          conclusion += '.';
        }

        // 22. Conclusion을 글자 수 기준으로 강제로 잘라서 말줄임표를 붙이지 마세요.
        // (Do NOT slice or truncate conclusion with ellipsis)

        // 21. Conclusion이 잘렸거나, 문장이 끝나지 않았거나, Exclude 접두어가 올바르지 않으면 해당 결과를 채택하지 말고 다음 Gemini 모델을 호출하세요.
        const isSentenceComplete = isConclusionCompleteSentence(conclusion);
        const hasValidPrefix = decision === 'Exclude' ? isValidExcludePrefix(conclusion) : true;
        const hasFirstPersonPerspective = usesFirstPersonPerspective(conclusion);

        if (decision !== 'Include' && decision !== 'Exclude') {
          console.warn(`[Screening Engine] Model "${modelName}" did not return a clear Include/Exclude decision: "${ansText.slice(0, 100)}"`);
          lastGeminiError = new Error(`Model "${modelName}" returned unclear decision.`);
          break; // break inner attempt loop to call next candidate model
        }

        if (!isSentenceComplete || !hasValidPrefix || hasFirstPersonPerspective) {
          console.warn(
            `[Screening Engine] Model "${modelName}" output rejected (sentenceComplete=${isSentenceComplete}, validExcludePrefix=${hasValidPrefix}, firstPerson=${hasFirstPersonPerspective}): "${conclusion}". Calling next Gemini model.`
          );
          lastGeminiError = new Error(
            `Model "${modelName}" rejected due to incomplete sentence, invalid exclude prefix, or first-person wording.`
          );
          break; // break inner attempt loop to call next candidate model
        }

        // 관련성 판단을 먼저 완료한 뒤, Include 후보에만 원문 접근성 기준을 적용한다.
        // 따라서 명백히 무관한 논문은 유료 저널이어도 Irrelevant/Different indication 사유를 유지한다.
        if (decision === 'Include') {
          const accessAdjusted = applyFullTextAccessRule(
            { decision, conclusion },
            title,
            articleContent,
            meta
          );
          if (accessAdjusted.decision === 'Exclude') {
            console.log(
              `[Screening Engine] Relevant article excluded by full-text access rule: ${accessAdjusted.conclusion}`
            );
            return accessAdjusted;
          }
        }

        // 23. Log final Gemini decision
        console.log(`[Screening Engine] Final Gemini decision: ${decision} (Conclusion: ${conclusion})`);

        return {
          decision,
          conclusion,
        };

        // If the model succeeded technically but returned Review due to response format
        if (isPrimary) {
          console.warn(`[Screening Engine] Primary model returned Review: raw answer="${ansText.slice(0, 150).replace(/\s+/g, ' ')}"`);
          console.log('[Screening Engine] Primary model returned Review; trying fallback model.');
        } else {
          console.log(`[Screening Engine] Fallback model "${modelName}" returned Review; trying next fallback model.`);
        }
        lastGeminiError = new Error(`Model "${modelName}" returned Review.`);
        break;
      } catch (err: any) {
        lastGeminiError = err;
        const status = err?.status ?? err?.code ?? err?.error?.code ?? err?.response?.status ?? '';
        const message = err?.message || err?.error?.message || String(err);
        const lower = String(message).toLowerCase();
        const isTransient = String(status) === '429' || String(status) === '503' || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('unavailable') || lower.includes('overloaded') || lower.includes('temporarily');

        console.error(`[Screening Engine] Model "${modelName}" failed (status=${status || 'n/a'}): ${message}`);
        if (isTransient && attempt === 1) {
          console.warn(`[Screening Engine] Model "${modelName}" transient error; failing over to next candidate model...`);
          break;
        }
        break;
      }
    }
  }

  if (lastGeminiError) {
    console.error('[Screening Engine] Gemini failed after all model fallbacks.');
    console.error(lastGeminiError);
  }
  console.log('[Screening Engine] Gemini unavailable. Falling back to rule-based.');
  
  if (ruleResult.decision === 'Review') {
    const failureMessage = lastGeminiError?.message
      ? String(lastGeminiError.message).replace(/\s+/g, ' ').slice(0, 240)
      : 'No Gemini model returned a valid response.';
    return {
       decision: 'Review',
       conclusion: `Manual Review Required: AI screening failed (${failureMessage})`
    };
  }
  
  return ruleResult;
}
