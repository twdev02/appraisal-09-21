import React, { useState, useEffect, useRef } from 'react';
import {
  ScreeningCategory,
  EngineMode,
  PubMedSubMode,
  GieSubMode,
  ClinicalTrialsSubMode,
  ScreeningItem,
  ScreeningHistoryMap,
  ScreeningHistoryRecord,
  ScreeningSession,
  ScreeningSource,
} from '../../types/screening';
import {
  SCREENING_CATEGORIES,
  SUB_MODELS_BY_CATEGORY,
  getCategoryPresets,
} from '../../data/screeningPresets';
import { ScreeningDashboard } from './ScreeningDashboard';
import { ProductCatalogModal } from './ProductCatalogModal';
import { parseRisFile } from '../../utils/risParser';
import {
  parsePmidListFromFile,
  parseScreeningHistoryFile,
} from '../../utils/screeningExcel';
import {
  SCREENING_CRITERIA_VERSION,
  buildScreeningSessionId,
  clearAllScreeningData,
  clearScreeningDataForCategory,
  clearScreeningDataForContext,
  deleteScreeningSession,
  getCachedScreeningItem,
  getScreeningSession,
  listScreeningSessions,
  mergeScreeningSessionItems,
  saveScreeningSession,
} from '../../utils/screeningSessionDb';

export const LiteratureScreening: React.FC = () => {

  // -------------------------------------------------------------------------
  // AI screening cancellation
  // -------------------------------------------------------------------------
  const screeningAbortControllerRef = useRef<AbortController | null>(null);
  const screeningStopRequestedRef = useRef(false);

  const startScreeningRun = () => {
    screeningAbortControllerRef.current?.abort();
    const controller = new AbortController();
    screeningAbortControllerRef.current = controller;
    screeningStopRequestedRef.current = false;
    return controller;
  };

  const stopScreening = () => {
    screeningStopRequestedRef.current = true;
    screeningAbortControllerRef.current?.abort();
    screeningAbortControllerRef.current = null;
    setProgressStatus('AI 스크리닝을 사용자가 중단했습니다. 현재까지 완료된 결과만 유지합니다.');
    setIsScreening(false);
  };

  const finishScreeningRun = () => {
    screeningAbortControllerRef.current = null;
  };

  const throwIfScreeningStopped = (controller: AbortController) => {
    if (screeningStopRequestedRef.current || controller.signal.aborted) {
      throw new DOMException('Screening stopped by user.', 'AbortError');
    }
  };

  // Category & Model Selection
  const [category, setCategory] = useState<ScreeningCategory>('1. Biliary Stent');
  const [subModel, setSubModel] = useState<string>(SUB_MODELS_BY_CATEGORY['1. Biliary Stent'][0]);

  // Engine & Sub-mode Selection
  const [engineMode, setEngineMode] = useState<EngineMode>('PubMed Engine');
  const [pubmedSubMode, setPubmedSubMode] = useState<PubMedSubMode>('PubMed PICO 자동 검색');
  const [gieSubMode] = useState<GieSubMode>('GIE RIS 파일 일괄 스크리닝');
  const [ctSubMode] = useState<ClinicalTrialsSubMode>('ClinicalTrials 자동 검색');

  // PICO Keywords state
  const [pText, setPText] = useState<string>('');
  const [iText, setIText] = useState<string>('');
  const [cText, setCText] = useState<string>('');
  const [oText, setOText] = useState<string>('');
  const [picoPreset, setPicoPreset] = useState<'P + I' | 'P + O' | 'P + C + O' | 'Custom'>('P + I');
  const [useP, setUseP] = useState<boolean>(true);
  const [useI, setUseI] = useState<boolean>(true);
  const [useC, setUseC] = useState<boolean>(false);
  const [useO, setUseO] = useState<boolean>(false);
  const [useAddSearch, setUseAddSearch] = useState<boolean>(false);
  const [addSearchQueries, setAddSearchQueries] = useState<string[]>([]);
  const [selectedAddQuery, setSelectedAddQuery] = useState<string>('');
  const [directQueryInput, setDirectQueryInput] = useState<string>('');

  // Date & limit settings (Default: 작년 한해 2025.01 ~ 2025.12)
  const [startYear, setStartYear] = useState<number>(2025);
  const [startMonth, setStartMonth] = useState<number>(1);
  const [endYear, setEndYear] = useState<number>(2025);
  const [endMonth, setEndMonth] = useState<number>(12);
  const [fetchAll, setFetchAll] = useState<boolean>(false);
  const [maxResults, setMaxResults] = useState<number>(20);
  const [pubmedFilters, setPubmedFilters] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<'relevance' | 'pub_date'>('relevance');

  // Single PMID state
  const [singlePmidInput, setSinglePmidInput] = useState<string>('');
  const [singlePmidResult, setSinglePmidResult] = useState<ScreeningItem | null>(null);

  // ClinicalTrials state
  const ALL_CT_STATUSES = [
    'NOT_YET_RECRUITING',
    'RECRUITING',
    'ENROLLING_BY_INVITATION',
    'ACTIVE_NOT_RECRUITING',
    'SUSPENDED',
    'TERMINATED',
    'COMPLETED',
    'WITHDRAWN',
    'UNKNOWN',
  ];
  const [ctCondition, setCtCondition] = useState<string>('("Biliary obstruction" OR "Biliary stricture")');
  const [ctIntervention, setCtIntervention] = useState<string>('("Self-expandable metal stent" OR "SEMS" OR "Biliary stent")');
  const [ctStatuses, setCtStatuses] = useState<string[]>(ALL_CT_STATUSES);

  // Results State
  const [screeningResults, setScreeningResults] = useState<ScreeningItem[]>([]);
  const [isScreening, setIsScreening] = useState<boolean>(false);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [executedQueryString, setExecutedQueryString] = useState<string>('');
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<ScreeningSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isCombinedResults, setIsCombinedResults] = useState<boolean>(false);

  // History State
  const [screenedHistory, setScreenedHistory] = useState<ScreeningHistoryMap>(() => {
    try {
      const saved = localStorage.getItem('screening_history_map');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState<boolean>(false);
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState<boolean>(false);

  // Update localStorage when history changes
  useEffect(() => {
    return () => {
      screeningStopRequestedRef.current = true;
      screeningAbortControllerRef.current?.abort();
      screeningAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('screening_history_map', JSON.stringify(screenedHistory));
    } catch (e) {
      console.error('Failed to save screening history to localStorage', e);
    }
  }, [screenedHistory]);

  const getCurrentSessionDescriptor = (): {
    id: string;
    source: ScreeningSource;
    label: string;
    variant: string;
  } => {
    let source: ScreeningSource = 'pubmed-pico';
    let label: string = picoPreset;
    let variant: string = picoPreset;

    if (engineMode === 'PubMed Engine' && pubmedSubMode === 'PMID 리스트 업로드') {
      source = 'pmid-list'; label = 'PMID 리스트'; variant = 'latest';
    } else if (engineMode === 'PubMed Engine' && pubmedSubMode === '단일 PMID 입력') {
      source = 'single-pmid'; label = '단일 PMID'; variant = 'latest';
    } else if (engineMode === 'GIE Journal Engine') {
      source = 'gie-ris'; label = 'GIE RIS'; variant = 'latest';
    } else if (engineMode === 'ClinicalTrials Engine') {
      source = 'clinical-trials'; label = 'ClinicalTrials'; variant = 'latest';
    }

    return { id: buildScreeningSessionId(category, subModel, source, variant), source, label, variant };
  };

  const refreshSavedSessions = async () => {
    try { setSavedSessions(await listScreeningSessions(category, subModel)); }
    catch (error) { console.error('Failed to load saved screening sessions', error); }
  };

  const persistResults = async (items: ScreeningItem[], query = executedQueryString) => {
    const descriptor = getCurrentSessionDescriptor();
    let itemsToSave = items;

    // 단일 PMID 검색은 매 실행 결과를 같은 세션에 누적한다.
    // 동일 PMID가 다시 들어오면 건수를 늘리지 않으며, 기존의 실제 AI 판정을
    // Duplicated 표시로 덮어쓰지 않는다.
    if (descriptor.source === 'single-pmid') {
      const existingSession = await getScreeningSession(descriptor.id);
      const merged = new Map<string, ScreeningItem>();

      (existingSession?.items || []).forEach((item) => {
        const key = (item.id || item.doi || item.title).trim().toLowerCase();
        if (key) merged.set(key, item);
      });

      items.forEach((item) => {
        const key = (item.id || item.doi || item.title).trim().toLowerCase();
        if (!key) return;
        const previous = merged.get(key);
        const previousHasDecision = previous?.aiDecision === 'Include' || previous?.aiDecision === 'Exclude';
        if (item.aiDecision === 'Duplicated' && previousHasDecision) return;
        merged.set(key, item);
      });

      itemsToSave = Array.from(merged.values()).map((item, index) => ({
        ...item,
        no: index + 1,
      }));
    }

    const session: ScreeningSession = {
      ...descriptor, category, subModel, criteriaVersion: SCREENING_CRITERIA_VERSION,
      query, updatedAt: new Date().toISOString(), items: itemsToSave,
    };
    await saveScreeningSession(session);
    setActiveSessionId(session.id);
    setIsCombinedResults(false);
    await refreshSavedSessions();
  };

  const updateAndPersistResults = async (items: ScreeningItem[], query = executedQueryString) => {
    setScreeningResults(items);
    await persistResults(items, query);
  };

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const descriptor = getCurrentSessionDescriptor();
      setActiveSessionId(descriptor.id);
      setIsCombinedResults(false);
      try {
        const session = await getScreeningSession(descriptor.id);
        if (cancelled) return;
        if (descriptor.source === 'single-pmid') {
          setSinglePmidResult(session?.items.at(-1) || null);
          setScreeningResults([]);
        } else {
          setScreeningResults(session?.items || []);
          setSinglePmidResult(null);
        }
        setExecutedQueryString(session?.query || '');
        await refreshSavedSessions();
      } catch (error) {
        if (!cancelled) console.error('Failed to restore screening session', error);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [category, subModel, engineMode, pubmedSubMode, picoPreset]);

  // Sync PICO presets when category or sub-model changes
  useEffect(() => {
    const presets = getCategoryPresets(category, subModel);
    setPText(presets.p);
    setIText(presets.i);
    setCText(presets.c);
    setOText(presets.o);
    setAddSearchQueries(presets.addSearchQueries);
    if (presets.addSearchQueries.length > 0) {
      setSelectedAddQuery(presets.addSearchQueries[0]);
      setDirectQueryInput(presets.addSearchQueries[0]);
    }

    // Sync ClinicalTrials default queries
    if (category === '1. Biliary Stent') {
      setCtCondition('("Biliary obstruction" OR "Biliary stricture")');
      setCtIntervention('("Self-expandable metal stent" OR "SEMS" OR "Biliary stent")');
    } else if (category === '2. Esophageal Stent') {
      setCtCondition('("Esophageal obstruction" OR "Esophageal stricture" OR "Tracheoesophageal fistula")');
      setCtIntervention('("Self-expandable metal stent" OR "SEMS" OR "Esophageal stent")');
    } else if (category === '3. Pyloric/Duodenal Stent') {
      setCtCondition('("Pyloric obstruction" OR "Duodenal obstruction" OR "Pyloric stricture" OR "Duodenal stricture")');
      setCtIntervention('("Self-expandable metal stent" OR "SEMS" OR "Pyloric stent" OR "Duodenal stent")');
    } else if (category === '4. Colonic Stent') {
      setCtCondition('("Colonic obstruction" OR "Colonic stricture")');
      setCtIntervention('("Self-expandable metal stent" OR "SEMS" OR "Colonic stent")');
    } else if (category === '5. Drainage Stent') {
      setCtCondition('("Pancreatic pseudocyst" OR "Walled off necrosis" OR "Gallbladder" OR "Biliary tract")');
      setCtIntervention('("Lumen apposing metal stent" OR "LAMS" OR "Drainage stent")');
    }
  }, [category, subModel]);

  // Quick PICO Preset handler
  const handlePicoPresetClick = (preset: 'P + I' | 'P + O' | 'P + C + O' | 'Custom') => {
    setPicoPreset(preset);
    if (preset === 'P + I') {
      setUseP(true);
      setUseI(true);
      setUseC(false);
      setUseO(false);
      setUseAddSearch(false);
    } else if (preset === 'P + O') {
      setUseP(true);
      setUseI(false);
      setUseC(false);
      setUseO(true);
      setUseAddSearch(false);
    } else if (preset === 'P + C + O') {
      setUseP(true);
      setUseI(false);
      setUseC(true);
      setUseO(true);
      setUseAddSearch(false);
    } else if (preset === 'Custom') {
      setUseP(false);
      setUseI(false);
      setUseC(false);
      setUseO(false);
      setUseAddSearch(true);
    }
  };

  // Helper to record history
  const recordHistory = (id: string, decision: string) => {
    // 중복·검토 결과는 원 판정 이력의 출처를 덮어쓰지 않는다.
    if (decision !== 'Include' && decision !== 'Exclude') return;
    const cleanId = id.toLowerCase().trim();
    setScreenedHistory((prev) => ({
      ...prev,
      [`${category.toLowerCase()}::${subModel.toLowerCase()}::${cleanId}`]: {
        category,
        subModel: subModel || 'General',
        result: decision,
      },
    }));
  };

  const getCurrentCategoryHistory = (): ScreeningHistoryMap =>
    Object.fromEntries(
      (Object.entries(screenedHistory) as [string, ScreeningHistoryRecord][])
        .filter(([, record]) => record.category === category)
        .map(([key, record]) => {
          const separatorIndex = key.lastIndexOf('::');
          const identifier = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : key;
          return [identifier, record];
        })
    ) as ScreeningHistoryMap;

  // 이미 평가한 문헌은 Gemini를 다시 호출하지 않고 이번 검색에서는 중복으로 표시한다.
  const toDuplicatedItem = (item: ScreeningItem, no: number): ScreeningItem => ({
    ...item,
    no,
    aiDecision: 'Duplicated',
    conclusion: 'Duplicated: This article was already screened and its original decision is preserved in the saved results.',
  });

  // =========================================================================
  // Screening Execution Handlers
  // =========================================================================

  // 1. PubMed PICO Auto Search & Screening
  const handleRunPubmedPicoScreening = async () => {
    const abortController = startScreeningRun();
    setIsScreening(true);
    setScreeningError(null);
    setProgressPercent(5);
    setProgressStatus('PubMed E-Utilities 공식 API에서 PICO 조건으로 논문 검색 중...');
    setScreeningResults([]);

    try {
      const presets = getCategoryPresets(category, subModel);

      // Search PMIDs
      const searchRes = await fetch('/api/screening/pubmed-search', {
        method: 'POST',
            signal: abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_text: useP ? pText : '',
          i_text: useI ? iText : '',
          c_text: useC ? cText : '',
          o_text: useO ? oText : '',
          start_year: startYear,
          start_month: startMonth,
          end_year: endYear,
          end_month: endMonth,
          fetch_all: fetchAll,
          max_results: maxResults,
          direct_query: useAddSearch ? directQueryInput : '',
          filters: pubmedFilters,
          sort: sortOrder,
        }),
      });

      const searchJson = await searchRes.json();
      if (!searchJson.success) {
        throw new Error(searchJson.error || 'PubMed search request failed.');
      }

      const { pmids, fullQuery, totalFound } = searchJson.data;
      setExecutedQueryString(fullQuery);

      if (!pmids || pmids.length === 0) {
        setProgressStatus(`검색 결과 부합하는 논문이 없습니다 (검색된 총 건수: ${totalFound}건).`);
        setIsScreening(false);
        return;
      }

      setProgressStatus(`총 ${pmids.length}건의 PMID 추출 완료. Gemini 2.5 Flash 정밀 AI 분석 시작...`);
      setProgressPercent(15);

      const items: ScreeningItem[] = [];
      const total = pmids.length;

      for (let idx = 0; idx < total; idx++) {
        throwIfScreeningStopped(abortController);
        const pmid = pmids[idx];
        setProgressStatus(`[${idx + 1}/${total}] PMID ${pmid} 초록/원문 수집 및 AI 심사 중...`);

        try {
          const cachedItem = await getCachedScreeningItem(category, subModel, pmid);
          if (cachedItem) {
            items.push(toDuplicatedItem(cachedItem, idx + 1));
            setProgressPercent(Math.round(15 + ((idx + 1) / total) * 85));
            await updateAndPersistResults([...items], fullQuery);
            continue;
          }
          const itemRes = await fetch('/api/screening/screen-pmid-item', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pmid,
              category,
              subModel,
              searchCombination: picoPreset,
              includeCriteria: presets.includeCriteria,
              excludeCriteria: presets.excludeCriteria,
              history: getCurrentCategoryHistory(),
            }),
          });

          const itemJson = await itemRes.json();
          if (itemJson.success && itemJson.data) {
            const screenedData = itemJson.data;
            const newItem: ScreeningItem = {
              no: idx + 1,
              id: screenedData.id,
              category,
              subModel,
              title: screenedData.title,
              evaluationStandard: screenedData.evaluationStandard,
              abstractSummary: screenedData.abstractSummary,
              aiDecision: screenedData.aiDecision,
              conclusion: screenedData.conclusion,
              link: screenedData.link,
            };
            items.push(newItem);
            recordHistory(pmid, screenedData.aiDecision);
          } else {
            items.push({
              no: idx + 1,
              id: pmid,
              category,
              subModel,
              title: `PMID ${pmid}`,
              evaluationStandard: 'Abstract Only',
              abstractSummary: itemJson?.error || 'Review required',
              aiDecision: 'Review',
              conclusion: itemJson?.error || 'Manual review required',
              link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            });
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || screeningStopRequestedRef.current) throw e;
          console.error(`Error screening PMID ${pmid}:`, e);
          items.push({
            no: idx + 1,
            id: pmid,
            category,
            subModel,
            title: `PMID ${pmid}`,
            evaluationStandard: 'Abstract Only',
            abstractSummary: e.message || 'Error occurred during fetch',
            aiDecision: 'Review',
            conclusion: `Manual Review Needed: ${e.message || 'Error'}`,
            link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          });
        }

        setProgressPercent(Math.round(15 + ((idx + 1) / total) * 85));
        await updateAndPersistResults([...items], fullQuery);
      }

      const incCount = items.filter((i) => i.aiDecision === 'Include').length;
      const excCount = items.filter((i) => i.aiDecision === 'Exclude').length;
      const dupCount = items.filter((i) => i.aiDecision === 'Duplicated').length;
      const revCount = items.filter((i) => i.aiDecision === 'Review').length;
      setProgressStatus(
        `스크리닝 완료: 총 ${items.length}건 판정 완료 (Include: ${incCount}건, Exclude: ${excCount}건${dupCount ? `, Duplicated: ${dupCount}건` : ''}${revCount ? `, Review: ${revCount}건` : ''})`
      );
    } catch (err: any) {
      if (err?.name === 'AbortError' || screeningStopRequestedRef.current) {
        setScreeningError(null);
      } else {
        setScreeningError(err.message || 'Error during PubMed PICO screening.');
      }
    } finally {
      finishScreeningRun();
      setIsScreening(false);
    }
  };

  // 2. PMID List File Upload Screening
  const handlePmidListFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const abortController = startScreeningRun();
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScreening(true);
    setScreeningError(null);
    setProgressPercent(10);
    setProgressStatus('업로드된 파일에서 PMID 목록을 추출하는 중...');

    try {
      const pmids = await parsePmidListFromFile(file);
      if (pmids.length === 0) {
        throw new Error('파일에서 유효한 PMID를 찾지 못했습니다. 파일 내 "PMID" 열이 있는지 확인해주세요.');
      }

      setProgressStatus(`총 ${pmids.length}건의 PMID 확인됨. 순차 AI 스크리닝 시작...`);
      const presets = getCategoryPresets(category, subModel);
      const items: ScreeningItem[] = [];
      const total = pmids.length;

      for (let idx = 0; idx < total; idx++) {
        throwIfScreeningStopped(abortController);
        const pmid = pmids[idx];
        setProgressStatus(`[${idx + 1}/${total}] PMID ${pmid} 초록/원문 분석 중...`);

        try {
          const cachedItem = await getCachedScreeningItem(category, subModel, pmid);
          if (cachedItem) {
            items.push(toDuplicatedItem(cachedItem, idx + 1));
            setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
            await updateAndPersistResults([...items], `PMID list: ${file.name}`);
            continue;
          }
          const itemRes = await fetch('/api/screening/screen-pmid-item', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pmid,
              category,
              subModel,
              searchCombination: picoPreset,
              includeCriteria: presets.includeCriteria,
              excludeCriteria: presets.excludeCriteria,
              history: getCurrentCategoryHistory(),
            }),
          });

          const itemJson = await itemRes.json();
          if (itemJson.success && itemJson.data) {
            const screenedData = itemJson.data;
            const newItem: ScreeningItem = {
              no: idx + 1,
              id: screenedData.id,
              category,
              subModel,
              title: screenedData.title,
              evaluationStandard: screenedData.evaluationStandard,
              abstractSummary: screenedData.abstractSummary,
              aiDecision: screenedData.aiDecision,
              conclusion: screenedData.conclusion,
              link: screenedData.link,
            };
            items.push(newItem);
            recordHistory(pmid, screenedData.aiDecision);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || screeningStopRequestedRef.current) throw e;
          items.push({
            no: idx + 1,
            id: pmid,
            category,
            subModel,
            title: `PMID ${pmid}`,
            evaluationStandard: 'Error',
            abstractSummary: 'Failed to process',
            aiDecision: 'Review',
            conclusion: `Manual Review Needed: ${e.message || 'Error'}`,
            link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          });
        }

        setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
        await updateAndPersistResults([...items], `PMID list: ${file.name}`);
      }

      setProgressStatus(`일괄 스크리닝 완료: 총 ${items.length}건 처리.`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || screeningStopRequestedRef.current) {
        setScreeningError(null);
      } else {
        setScreeningError(err.message || 'Error processing PMID list file.');
      }
    } finally {
      finishScreeningRun();
      setIsScreening(false);
      e.target.value = '';
    }
  };

  // 3. Single PMID Quick Screening
  const handleRunSinglePmid = async () => {
    const abortController = startScreeningRun();
    if (!singlePmidInput.trim()) return;
    setIsScreening(true);
    setScreeningError(null);
    setSinglePmidResult(null);
    setProgressStatus(`PubMed에서 PMID ${singlePmidInput.trim()} 정보 조회 및 AI 분석 중...`);

    try {
      const presets = getCategoryPresets(category, subModel);
      const normalizedPmid = singlePmidInput.trim();
      const cachedItem = await getCachedScreeningItem(category, subModel, normalizedPmid);
      if (cachedItem) {
        const restoredItem = toDuplicatedItem(cachedItem, 1);
        setSinglePmidResult(restoredItem);
        await persistResults([restoredItem], `PMID ${normalizedPmid}`);
        setProgressStatus(`PMID ${normalizedPmid}의 저장된 AI 판정 결과를 불러왔습니다.`);
        return;
      }
      const res = await fetch('/api/screening/screen-single-pmid', {
        method: 'POST',
            signal: abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pmid: singlePmidInput.trim(),
          category,
          subModel,
          searchCombination: picoPreset,
          includeCriteria: presets.includeCriteria,
          excludeCriteria: presets.excludeCriteria,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to screen single PMID.');
      }

      const item: ScreeningItem = {
        no: 1,
        id: json.data.id,
        category,
        subModel,
        title: json.data.title,
        evaluationStandard: json.data.evaluationStandard,
        abstractSummary: json.data.abstractSummary,
        aiDecision: json.data.aiDecision,
        conclusion: json.data.conclusion,
        link: json.data.link,
      };

      setSinglePmidResult(item);
      recordHistory(item.id, item.aiDecision);
      await persistResults([item], `PMID ${normalizedPmid}`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || screeningStopRequestedRef.current) {
        setScreeningError(null);
      } else {
        setScreeningError(err.message || 'Error during single PMID screening.');
      }
    } finally {
      finishScreeningRun();
      setIsScreening(false);
    }
  };

  // 4. GIE RIS File Upload Screening
  const handleGieRisFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const abortController = startScreeningRun();
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScreening(true);
    setScreeningError(null);
    setProgressPercent(10);
    setProgressStatus('GIE RIS 파일 파싱 중...');
    setScreeningResults([]);

    try {
      const text = await file.text();
      const entries = parseRisFile(text);

      if (entries.length === 0) {
        throw new Error('RIS 파일에서 유효한 서지 정보/초록을 추출하지 못했습니다.');
      }

      setProgressStatus(`총 ${entries.length}건의 GIE 논문 확인됨. AI 스크리닝 시작...`);
      const presets = getCategoryPresets(category, subModel);
      const items: ScreeningItem[] = [];
      const total = entries.length;

      for (let idx = 0; idx < total; idx++) {
        throwIfScreeningStopped(abortController);
        const entry = entries[idx];
        setProgressStatus(`[${idx + 1}/${total}] GIE 초록 AI 분석 진행 중... (${entry.title.slice(0, 30)}...)`);

        try {
          const cacheIdentifier = entry.doi || entry.title;
          const cachedItem = await getCachedScreeningItem(category, subModel, cacheIdentifier);
          if (cachedItem) {
            items.push(toDuplicatedItem(cachedItem, idx + 1));
            setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
            await updateAndPersistResults([...items], `GIE RIS: ${file.name}`);
            continue;
          }
          const itemRes = await fetch('/api/screening/screen-gie-item', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: entry.title,
              abstract: entry.abstract,
              doi: entry.doi,
              url: entry.url,
              category,
              subModel,
              searchCombination: 'Imported RIS',
              includeCriteria: presets.includeCriteria,
              excludeCriteria: presets.excludeCriteria,
              history: getCurrentCategoryHistory(),
            }),
          });

          const itemJson = await itemRes.json();
          if (itemJson.success && itemJson.data) {
            const screenedData = itemJson.data;
            const newItem: ScreeningItem = {
              no: idx + 1,
              id: screenedData.id,
              category,
              subModel,
              title: screenedData.title,
              evaluationStandard: screenedData.evaluationStandard,
              abstractSummary: screenedData.abstractSummary,
              aiDecision: screenedData.aiDecision,
              conclusion: screenedData.conclusion,
              link: screenedData.link,
              doi: screenedData.doi,
            };
            items.push(newItem);
            recordHistory(entry.doi || entry.title, screenedData.aiDecision);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || screeningStopRequestedRef.current) throw e;
          items.push({
            no: idx + 1,
            id: entry.doi || `GIE-${idx + 1}`,
            category,
            subModel,
            title: entry.title,
            evaluationStandard: 'Error',
            abstractSummary: 'Failed to process',
            aiDecision: 'Review',
            conclusion: `Manual Review Needed: ${e.message || 'Error'}`,
            link: entry.url,
          });
        }

        setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
        await updateAndPersistResults([...items], `GIE RIS: ${file.name}`);
      }

      setProgressStatus(`GIE RIS 스크리닝 완료: 총 ${items.length}건 처리.`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || screeningStopRequestedRef.current) {
        setScreeningError(null);
      } else {
        setScreeningError(err.message || 'Error processing GIE RIS file.');
      }
    } finally {
      finishScreeningRun();
      setIsScreening(false);
      e.target.value = '';
    }
  };

  // 5. ClinicalTrials Search & Screening
  const handleRunClinicalTrials = async () => {
    const abortController = startScreeningRun();
    setIsScreening(true);
    setScreeningError(null);
    setProgressPercent(10);
    setProgressStatus('ClinicalTrials.gov 공식 API에서 조건에 부합하는 임상시험 검색 중...');
    setScreeningResults([]);

    try {
      const searchRes = await fetch('/api/screening/clinicaltrials-search', {
        method: 'POST',
            signal: abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition: ctCondition,
          intervention: ctIntervention,
          statusFilters: ctStatuses,
          fetchAll,
          maxResults,
        }),
      });

      const searchJson = await searchRes.json();
      if (!searchJson.success) {
        throw new Error(searchJson.error || 'Failed to search ClinicalTrials.gov.');
      }

      const { studies, queryUrl } = searchJson.data;
      setExecutedQueryString(queryUrl);

      if (!studies || studies.length === 0) {
        setProgressStatus('검색 조건에 일치하는 임상시험을 찾을 수 없습니다.');
        setIsScreening(false);
        return;
      }

      setProgressStatus(`총 ${studies.length}건의 임상시험 데이터 수집됨. AI 심사 시작...`);
      const presets = getCategoryPresets(category, subModel);
      const items: ScreeningItem[] = [];
      const total = studies.length;

      for (let idx = 0; idx < total; idx++) {
        throwIfScreeningStopped(abortController);
        const study = studies[idx];
        setProgressStatus(`[${idx + 1}/${total}] 임상시험 브리핑(Summary) 분석 중... (${study.nctId})`);

        try {
          const cachedItem = await getCachedScreeningItem(category, 'All models', study.nctId);
          if (cachedItem) {
            items.push(toDuplicatedItem(cachedItem, idx + 1));
            setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
            await updateAndPersistResults([...items], queryUrl);
            continue;
          }
          const itemRes = await fetch('/api/screening/screen-ct-item', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              study,
              category,
              subModel: 'All models',
              searchCombination: 'ClinicalTrials',
              includeCriteria: presets.includeCriteria,
              excludeCriteria: presets.excludeCriteria,
              history: getCurrentCategoryHistory(),
            }),
          });

          const itemJson = await itemRes.json();
          if (itemJson.success && itemJson.data) {
            const screenedData = itemJson.data;
            const newItem: ScreeningItem = {
              no: idx + 1,
              id: screenedData.id,
              category,
              subModel: 'All models',
              title: screenedData.title,
              evaluationStandard: screenedData.evaluationStandard,
              abstractSummary: screenedData.abstractSummary,
              aiDecision: screenedData.aiDecision,
              conclusion: screenedData.conclusion,
              link: screenedData.link,
              clinicalStatus: screenedData.clinicalStatus,
            };
            items.push(newItem);
            recordHistory(study.nctId, screenedData.aiDecision);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || screeningStopRequestedRef.current) throw e;
          items.push({
            no: idx + 1,
            id: study.nctId,
            category,
            subModel: 'All models',
            title: study.title,
            evaluationStandard: 'Error',
            abstractSummary: 'Failed to process',
            aiDecision: 'Review',
            conclusion: `Manual Review Needed: ${e.message || 'Error'}`,
            link: `https://clinicaltrials.gov/study/${study.nctId}`,
            clinicalStatus: study.status,
          });
        }

        setProgressPercent(Math.round(10 + ((idx + 1) / total) * 90));
        await updateAndPersistResults([...items], queryUrl);
      }

      setProgressStatus(`ClinicalTrials 스크리닝 완료: 총 ${items.length}건 처리.`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || screeningStopRequestedRef.current) {
        setScreeningError(null);
      } else {
        setScreeningError(err.message || 'Error processing ClinicalTrials search.');
      }
    } finally {
      finishScreeningRun();
      setIsScreening(false);
    }
  };

  // Restore history from file
  const handleRestoreHistory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const restored = await parseScreeningHistoryFile(file);
      const count = Object.keys(restored).length;
      if (count === 0) {
        alert('복원할 수 있는 과거 스크리닝 이력이 파일에 없습니다.');
        return;
      }
      setScreenedHistory((prev) => ({ ...prev, ...restored }));
      alert(`총 ${count}건의 스크리닝 이력이 성공적으로 복원되었습니다.`);
    } catch (err: any) {
      alert(`이력 복원 오류: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleClearHistory = async () => {
    // 누적 스크리닝 이력 초기화
    setScreenedHistory({});

    try {
      localStorage.removeItem('screening_history_map');
      localStorage.setItem('screening_history_map', JSON.stringify({}));
    } catch (e) {
      console.error('Failed to clear localStorage history', e);
    }

    try {
      await clearAllScreeningData();
      setSavedSessions([]);
      setActiveSessionId('');
      setIsCombinedResults(false);
    } catch (e) {
      console.error('Failed to clear saved screening sessions', e);
    }

    // 현재 검색 및 스크리닝 결과 초기화
    setScreeningResults([]);
    setSinglePmidResult(null);
    setProgressStatus('');
    setProgressPercent(0);
     setExecutedQueryString('');
    setScreeningError(null);
  };

  const handleConfirmClearAllHistory = () => {
    setIsClearAllConfirmOpen(true);
  };

  const handleClearAllHistoryConfirmed = async () => {
    await handleClearHistory();
    setIsClearAllConfirmOpen(false);
  };

  const handleClearCurrentSubModelHistory = async () => {
    setScreenedHistory((previous) => Object.fromEntries(
      (Object.entries(previous) as [string, ScreeningHistoryRecord][]).filter(([, record]) =>
        record.category !== category || record.subModel !== subModel
      )
    ) as ScreeningHistoryMap);

    try {
      await clearScreeningDataForContext(category, subModel);
      setSavedSessions([]);
      setActiveSessionId('');
      setIsCombinedResults(false);
    } catch (e) {
      console.error('Failed to clear current sub-model screening history', e);
    }

    setScreeningResults([]);
    setSinglePmidResult(null);
    setProgressStatus('');
    setProgressPercent(0);
    setExecutedQueryString('');
    setScreeningError(null);
  };

  const handleClearCurrentCategoryHistory = async () => {
    setScreenedHistory((previous) => Object.fromEntries(
      (Object.entries(previous) as [string, ScreeningHistoryRecord][]).filter(([, record]) => record.category !== category)
    ) as ScreeningHistoryMap);

    try {
      await clearScreeningDataForCategory(category);
      setSavedSessions([]);
      setActiveSessionId('');
      setIsCombinedResults(false);
    } catch (e) {
      console.error('Failed to clear current category screening history', e);
    }

    setScreeningResults([]);
    setSinglePmidResult(null);
    setProgressStatus('');
    setProgressPercent(0);
    setExecutedQueryString('');
    setScreeningError(null);
  };

  const handleClearCurrentResults = () => {
    if (!isCombinedResults && activeSessionId) {
      void deleteScreeningSession(activeSessionId).then(refreshSavedSessions)
        .catch((error) => console.error('Failed to delete current screening session', error));
    }
    setScreeningResults([]);
    setSinglePmidResult(null);
    setProgressStatus('');
    setProgressPercent(0);
    setExecutedQueryString('');
    setScreeningError(null);
  };

  const handleLoadSavedSession = (session: ScreeningSession) => {
    if (session.source === 'pubmed-pico') {
      setEngineMode('PubMed Engine'); setPubmedSubMode('PubMed PICO 자동 검색');
      if (['P + I', 'P + O', 'P + C + O', 'Custom'].includes(session.variant)) {
        handlePicoPresetClick(session.variant as 'P + I' | 'P + O' | 'P + C + O' | 'Custom');
      }
    } else if (session.source === 'pmid-list') {
      setEngineMode('PubMed Engine'); setPubmedSubMode('PMID 리스트 업로드');
    } else if (session.source === 'single-pmid') {
      setEngineMode('PubMed Engine'); setPubmedSubMode('단일 PMID 입력');
    } else if (session.source === 'gie-ris') setEngineMode('GIE Journal Engine');
    else setEngineMode('ClinicalTrials Engine');

    setActiveSessionId(session.id); setIsCombinedResults(false);
    setExecutedQueryString(session.query || '');
    if (session.source === 'single-pmid') {
      setSinglePmidResult(null); setScreeningResults(session.items);
    } else {
      setSinglePmidResult(null); setScreeningResults(session.items);
    }
    setProgressStatus(`저장된 ${session.label} 결과 ${session.items.length}건을 불러왔습니다.`);
  };

  const handleShowCombinedResults = () => {
    const mergedItems = mergeScreeningSessionItems(savedSessions);
    setScreeningResults(mergedItems); setSinglePmidResult(null);
    setIsCombinedResults(true); setActiveSessionId(''); setExecutedQueryString('');
    setProgressStatus(`현재 품목의 저장된 전체 검색 결과를 PMID/DOI/NCT 기준으로 통합했습니다: ${mergedItems.length}건.`);
  };

  const handleDashboardUpdate = (items: ScreeningItem[]) => {
    setScreeningResults(items);
    if (isCombinedResults) {
      void (async () => {
        const updatedById = new Map(items.map((item) => [(item.id || item.doi || item.title).trim().toLowerCase(), item]));
        for (const session of savedSessions) {
          const updatedItems = session.items.map((sessionItem) => {
            const key = (sessionItem.id || sessionItem.doi || sessionItem.title).trim().toLowerCase();
            const updated = updatedById.get(key);
            return updated ? { ...sessionItem, aiDecision: updated.aiDecision, conclusion: updated.conclusion } : sessionItem;
          });
          await saveScreeningSession({ ...session, updatedAt: new Date().toISOString(), items: updatedItems });
        }
        await refreshSavedSessions();
      })().catch((error) => console.error('Failed to save manually updated combined results', error));
    } else {
      void persistResults(items).catch((error) => console.error('Failed to save manually updated screening results', error));
    }
  };

  const historyCount = Object.keys(screenedHistory).length;
  const currentSubModelHistoryCount = (Object.values(screenedHistory) as ScreeningHistoryRecord[]).filter(
    (record) => record.category === category && record.subModel === subModel
  ).length;
  const currentCategoryHistoryCount = (Object.values(screenedHistory) as ScreeningHistoryRecord[]).filter(
    (record) => record.category === category
  ).length;
  const categoryDisplayName = category
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+Stent$/i, '');

  return (
    <div className="space-y-6">
      {/* Top Hero Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-7 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="bg-gradient-to-r from-lime-500 to-cyan-500 text-slate-950 text-[11px] font-extrabold px-3 py-0.5 rounded-full uppercase tracking-wider">
                Taewoong Medical Clinical Evaluation Platform
              </span>
              <span className="text-xs text-slate-400 font-medium">Development 2nd Team</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              AI 문헌 스크리닝 시스템
            </h2>
            <p className="text-xs text-slate-300">
              Medical Device Regulatory Compliance &amp; Systematic Literature Review
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCatalogOpen(true)}
              className="inline-flex items-center justify-center px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              <span>Product Catalog</span>
            </button>
            <button
              type="button"
              onClick={handleConfirmClearAllHistory}
              className="inline-flex items-center justify-center px-3.5 py-2 bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-700/80 rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              <span>모든 품목 이력 초기화</span>
            </button>
          </div>
        </div>
      </div>

      {/* Category Selection Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            1. 스크리닝 대상 카테고리 선택
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {SCREENING_CATEGORIES.map((cat) => {
            const isSelected = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategory(cat);
                  setSubModel(SUB_MODELS_BY_CATEGORY[cat][0]);
                }}
                className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all text-center cursor-pointer border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/20'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {cat.replace(/^\d+\.\s*/, '')}
              </button>
            );
          })}
        </div>

        {/* Sub-model selector */}
        {(SUB_MODELS_BY_CATEGORY[category].length > 1 || category === '2. Esophageal Stent') && (
          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 shrink-0">세부 모델/유형:</span>
            <div className="flex flex-wrap gap-2 flex-1">
              {SUB_MODELS_BY_CATEGORY[category].map((mod) => {
                const isSelected = subModel === mod;
                return (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => setSubModel(mod)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {mod}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3-Engine Segmented Controller */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            2. 검색 엔진 선택 (Search Engine)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['PubMed Engine', 'GIE Journal Engine', 'ClinicalTrials Engine'] as EngineMode[]).map(
            (eng) => {
              const isSelected = engineMode === eng;
              return (
                <button
                  key={eng}
                  type="button"
                  onClick={() => setEngineMode(eng)}
                  className={`py-3 px-4 rounded-xl text-xs font-bold transition-all text-center cursor-pointer border flex items-center justify-center gap-2 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/20'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{eng}</span>
                </button>
              );
            }
          )}
        </div>

        {/* Engine Sub-mode switcher */}
        {engineMode === 'PubMed Engine' && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
            {(['PubMed PICO 자동 검색', 'PMID 리스트 업로드', '단일 PMID 입력'] as PubMedSubMode[]).map(
              (mode) => {
                const isSelected = pubmedSubMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPubmedSubMode(mode)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {mode}
                  </button>
                );
              }
            )}
          </div>
        )}
      </div>

      {/* Engine Body Section */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
        {/* =========================================================================
            ENGINE 1: PubMed Engine
            ========================================================================= */}
        {engineMode === 'PubMed Engine' && pubmedSubMode === 'PubMed PICO 자동 검색' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                PubMed PICO 키워드 설정
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                선택하신 품목 및 세부 모델에 맞춰 P, I, C, O 키워드가 자동으로 세팅되었습니다.
              </p>
            </div>

            {/* P, I, C, O Textareas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">P (Patient / Population / Problem)</label>
                <textarea
                  value={pText}
                  onChange={(e) => setPText(e.target.value)}
                  rows={4}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">I (Intervention)</label>
                <textarea
                  value={iText}
                  onChange={(e) => setIText(e.target.value)}
                  rows={4}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">C (Comparison)</label>
                <textarea
                  value={cText}
                  onChange={(e) => setCText(e.target.value)}
                  rows={4}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">O (Outcome)</label>
                <textarea
                  value={oText}
                  onChange={(e) => setOText(e.target.value)}
                  rows={4}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
            </div>

            {/* Quick Presets & Checkboxes */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">PICO 검색 조합 선택</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['P + I', 'P + O', 'P + C + O', 'Custom'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePicoPresetClick(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer border ${
                      picoPreset === preset
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-2">
                <label className="flex flex-none items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={useP}
                    onChange={(e) => setUseP(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span className="whitespace-nowrap">P (Patient/Population/Problem)</span>
                </label>
                <label className="flex flex-none items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={useI}
                    onChange={(e) => setUseI(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>I (Intervention)</span>
                </label>
                <label className="flex flex-none items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={useC}
                    onChange={(e) => setUseC(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>C (Comparison)</span>
                </label>
                <label className="flex flex-none items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={useO}
                    onChange={(e) => setUseO(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>O (Outcome)</span>
                </label>
                <label className="flex flex-none items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={useAddSearch}
                    onChange={(e) => setUseAddSearch(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>I (Additional Search)</span>
                </label>
              </div>

              {/* Additional Search Direct Query Box */}
              {useAddSearch && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg space-y-2 text-xs">
                  <span className="font-semibold text-amber-900">개별 Additional Search 정밀 쿼리 프리셋:</span>
                  <select
                    value={selectedAddQuery}
                    onChange={(e) => {
                      setSelectedAddQuery(e.target.value);
                      setDirectQueryInput(e.target.value);
                    }}
                    className="w-full p-2 bg-white border border-amber-300 rounded text-xs text-slate-900 font-mono"
                  >
                    {addSearchQueries.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={directQueryInput}
                    onChange={(e) => setDirectQueryInput(e.target.value)}
                    placeholder="실행될 쿼리문 (필요 시 직접 수정 가능)"
                    className="w-full p-2 bg-white border border-amber-300 rounded text-xs text-slate-900 font-mono"
                  />
                </div>
              )}
            </div>

            {/* Date Range & Fetch Limit */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">시작 연도</label>
                <input
                  type="number"
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">시작 월</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={startMonth}
                  onChange={(e) => setStartMonth(Number(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">종료 연도</label>
                <input
                  type="number"
                  value={endYear}
                  onChange={(e) => setEndYear(Number(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">종료 월</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={endMonth}
                  onChange={(e) => setEndMonth(Number(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            {/* Sort Order Selector (Best Match vs Most Recent) */}
            <div className="flex justify-end items-center">
              <div className="flex items-center bg-white p-1 rounded-lg border border-slate-200 shadow-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setSortOrder('relevance')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                    sortOrder === 'relevance'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Best Match (관련도순)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder('pub_date')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                    sortOrder === 'pub_date'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Most Recent (최신순)</span>
                </button>
              </div>
            </div>

            {/* PubMed Search Filters (Humans, Article Types, etc.) */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200/70">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900">PubMed 필터 (Search Filters)</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    (선택 시에만 적용되며, 기본은 제한 없는 '전체 검색'입니다.)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPubmedFilters([])}
                  className="px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer shadow-xs"
                >
                  초기화 (전체 검색)
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 pt-0.5">
                {[
                  { val: 'humans[Filter]', label: 'Humans' },
                  { val: 'english[Filter]', label: 'English' },
                  { val: 'hasabstract[Filter]', label: 'Abstract' },
                  { val: 'free full text[Filter]', label: 'Free Full Text' },
                  { val: 'full text[Filter]', label: 'Full Text' },
                ].map((f) => {
                  const isChecked = pubmedFilters.includes(f.val);
                  return (
                    <label
                      key={f.val}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-slate-900 border-slate-900 font-semibold text-white shadow-xs'
                          : 'bg-white/60 border-slate-200/80 text-slate-600 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) setPubmedFilters([...pubmedFilters, f.val]);
                          else setPubmedFilters(pubmedFilters.filter((x) => x !== f.val));
                        }}
                        className="rounded border-slate-400 text-slate-900 focus:ring-slate-900 shrink-0"
                      />
                      <span className="truncate">{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fetchAll}
                  onChange={(e) => setFetchAll(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>검색된 전체 논문 수집 (개수 제한 없음)</span>
              </label>

              {!fetchAll && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 font-medium">가져올 최대 논문 수:</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                    className="w-20 p-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-center font-mono font-bold"
                  />
                </div>
              )}
            </div>

            {/* Run Button */}
            <button
              type="button"
              disabled={isScreening}
              onClick={handleRunPubmedPicoScreening}
              className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center cursor-pointer"
            >
              <span>PICO 조합 검색 및 AI 스크리닝 실행</span>
            </button>
          </div>
        )}

        {/* Engine 1 - Submode 2: PMID List Upload */}
        {engineMode === 'PubMed Engine' && pubmedSubMode === 'PMID 리스트 업로드' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                PMID 리스트 파일 스크리닝
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                엑셀(.xlsx) 또는 CSV 파일 내 &apos;PMID&apos; 열을 기준으로 문헌 정보를 일괄 조회하고 AI 스크리닝을 진행합니다.
              </p>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-slate-400 bg-slate-50/50 transition-colors">
              <p className="text-xs font-semibold text-slate-700">
                PMID 파일(.xlsx, .csv)을 드래그하거나 클릭하여 업로드하세요.
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                파일에 &apos;PMID&apos; 열이 포함되어 있어야 합니다.
              </p>
              <label className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs">
                <span>파일 선택</span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  disabled={isScreening}
                  onChange={handlePmidListFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* Engine 1 - Submode 3: Single PMID */}
        {engineMode === 'PubMed Engine' && pubmedSubMode === '단일 PMID 입력' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                단일 PMID 스크리닝
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                PMID 번호를 직접 입력하여 문헌 정보를 실시간 조회하고 AI 스크리닝을 진행합니다.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={singlePmidInput}
                onChange={(e) => setSinglePmidInput(e.target.value)}
                placeholder="PubMed PMID 입력 (예: 31234567)"
                className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              <button
                type="button"
                disabled={isScreening || !singlePmidInput.trim()}
                onClick={handleRunSinglePmid}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                단일 PMID AI 스크리닝 실행
              </button>
            </div>

            {/* Single Result Card */}
            {singlePmidResult && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 mt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold">
                      PMID {singlePmidResult.id}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mt-1">{singlePmidResult.title}</h4>
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold border shrink-0 ${
                      singlePmidResult.aiDecision === 'Include'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : singlePmidResult.aiDecision === 'Exclude'
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}
                  >
                    {singlePmidResult.aiDecision}
                  </span>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200 text-xs space-y-1.5">
                  <div className="text-slate-500 font-medium">
                    평가 기준: <span className="font-semibold text-slate-800">{singlePmidResult.evaluationStandard}</span>
                  </div>
                  <div className="text-slate-900">
                    <span className="font-semibold">Conclusion: </span>
                    <span>{singlePmidResult.conclusion}</span>
                  </div>
                </div>

                {singlePmidResult.link && (
                  <div className="text-right">
                    <a
                      href={singlePmidResult.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                    >
                      PubMed 원문 바로가기
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            ENGINE 2: GIE Journal Engine
            ========================================================================= */}
        {engineMode === 'GIE Journal Engine' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                GIE Journal RIS 파일 일괄 스크리닝
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                giejournal.org 접속 ➔ Advanced Search 실행 ➔ [Export Citation] ➔ RIS 파일 다운로드 ➔ 업로드
              </p>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-slate-400 bg-slate-50/50 transition-colors">
              <p className="text-xs font-semibold text-slate-700">
                GIE RIS 파일(.ris, .txt)을 드래그하거나 클릭하여 업로드하세요
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                RIS 파일 내 Title(TI), Abstract(AB), DOI(DO)를 자동으로 파싱하여 일괄 심사합니다.
              </p>
              <label className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs">
                <span>GIE RIS 파일 선택</span>
                <input
                  type="file"
                  accept=".ris,.txt"
                  disabled={isScreening}
                  onChange={handleGieRisFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* =========================================================================
            ENGINE 3: ClinicalTrials Engine
            ========================================================================= */}
        {engineMode === 'ClinicalTrials Engine' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Clinical Trials Registry (NCT) 검색 및 스크리닝
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                선택하신 카테고리 전체의 임상시험(ClinicalTrials.gov) 데이터를 실시간 통합 검색합니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Condition / Disease</label>
                <input
                  type="text"
                  value={ctCondition}
                  onChange={(e) => setCtCondition(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Intervention / Treatment</label>
                <input
                  type="text"
                  value={ctIntervention}
                  onChange={(e) => setCtIntervention(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
            </div>

            {/* Study Status Selection */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/70">
                <div>
                  <span className="text-xs font-bold text-slate-900">임상 진행 상태 (Study Status)</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      if (ctStatuses.length === ALL_CT_STATUSES.length) {
                        setCtStatuses([]);
                      } else {
                        setCtStatuses([...ALL_CT_STATUSES]);
                      }
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                      ctStatuses.length === ALL_CT_STATUSES.length
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    All studies (전체 선택)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                {[
                  {
                    val: 'NOT_YET_RECRUITING',
                    label: 'Not yet recruiting',
                    desc: 'The study has not started recruiting participants.',
                  },
                  {
                    val: 'RECRUITING',
                    label: 'Recruiting',
                    desc: 'The study is currently recruiting participants.',
                  },
                  {
                    val: 'ENROLLING_BY_INVITATION',
                    label: 'Enrolling by invitation',
                    desc: 'The study is selecting its participants from a population, or group of people, decided on by the researchers in advance. These studies are not open to everyone who meets the eligibility criteria but only to people in that particular population, who are specifically invited to participate.',
                  },
                  {
                    val: 'ACTIVE_NOT_RECRUITING',
                    label: 'Active, not recruiting',
                    desc: 'The study is ongoing, and participants are receiving an intervention or being examined, but potential participants are not currently being recruited or enrolled.',
                  },
                  {
                    val: 'SUSPENDED',
                    label: 'Suspended',
                    desc: 'The study has stopped early but may start again.',
                  },
                  {
                    val: 'TERMINATED',
                    label: 'Terminated',
                    desc: 'The study has stopped early and will not start again. Participants are no longer being examined or treated.',
                  },
                  {
                    val: 'COMPLETED',
                    label: 'Completed',
                    desc: "The study has ended normally, and participants are no longer being examined or treated (that is, the last participant's last visit has occurred).",
                  },
                  {
                    val: 'WITHDRAWN',
                    label: 'Withdrawn',
                    desc: 'The study stopped early, before enrolling its first participant.',
                  },
                  {
                    val: 'UNKNOWN',
                    label: 'Unknown',
                    desc: 'A study on ClinicalTrials.gov whose last known status was recruiting; not yet recruiting; or active, not recruiting but that has passed its completion date, and the status has not been last verified within the past 2 years.',
                  },
                ].map((st) => {
                  const isChecked = ctStatuses.includes(st.val);
                  return (
                    <label
                      key={st.val}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-white border-slate-900 shadow-xs'
                          : 'bg-white/60 border-slate-200/80 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) setCtStatuses([...ctStatuses, st.val]);
                          else setCtStatuses(ctStatuses.filter((s) => s !== st.val));
                        }}
                        className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 shrink-0"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{st.label}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          {st.desc}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Fetch limits */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fetchAll}
                  onChange={(e) => setFetchAll(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>검색된 전체 임상시험 수집 (개수 제한 없음)</span>
              </label>

              {!fetchAll && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 font-medium">가져올 최대 임상시험 수:</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                    className="w-20 p-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-center font-mono font-bold"
                  />
                </div>
              )}
            </div>

            {/* Run button */}
            <button
              type="button"
              disabled={isScreening}
              onClick={handleRunClinicalTrials}
              className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center cursor-pointer"
            >
              <span>ClinicalTrials 검색 및 AI 스크리닝 실행</span>
            </button>
          </div>
        )}

        {/* Progress & Status Displays */}
        {isScreening && (
          <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-xl space-y-3">
            <div className="flex items-start justify-between gap-3 text-xs font-semibold text-blue-950">
              <span className="flex items-start gap-2 min-w-0">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-600 animate-pulse mt-1 shrink-0"></span>
                <span className="break-words">{progressStatus}</span>
              </span>
              <span className="font-mono shrink-0">{progressPercent}%</span>
            </div>
            <div className="w-full bg-blue-200/70 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={stopScreening}
                className="inline-flex items-center justify-center px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-bold transition-colors shadow-sm cursor-pointer"
              >
                ■ AI 스크리닝 중단
              </button>
            </div>
          </div>
        )}

        {!isScreening && progressStatus && (
          <div className="p-3.5 bg-slate-100/90 border border-slate-300/80 rounded-xl flex items-center justify-between text-xs text-slate-800">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">상태:</span>
              <span>{progressStatus}</span>
            </div>
            {screeningResults.length > 0 && (
              <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                총 {screeningResults.length}건
              </span>
            )}
          </div>
        )}

        {screeningError && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
            <div>
              <span className="font-bold">스크리닝 처리 중 오류 발생: </span>
              <span>{screeningError}</span>
            </div>
          </div>
        )}

        {/* Executed Query String Box */}
        {executedQueryString && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
            <span className="font-bold text-slate-700">생성된 API 쿼리식:</span>
            <div className="font-mono text-[11px] text-slate-800 break-all bg-white p-2 rounded border border-slate-200">
              {executedQueryString}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-cyan-200 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div><div className="text-xs font-bold text-slate-900">자동 저장된 검색 결과</div>
              </div>
            <div className="flex flex-wrap gap-2">
              {savedSessions.length > 0 && (
                <button type="button" onClick={handleShowCombinedResults}
                  className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                  전체 탭 통합 보기
                </button>
              )}
              <button type="button" onClick={() => setIsHistoryDrawerOpen(!isHistoryDrawerOpen)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                {categoryDisplayName} 누적 이력 ({currentCategoryHistoryCount}건)
              </button>
            </div>
          </div>
          {isHistoryDrawerOpen && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                  <span>{categoryDisplayName}</span>
                  <span className="text-slate-400">›</span>
                  <span>{subModel}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-white px-2 py-1 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
                    현재 모델 {currentSubModelHistoryCount}건
                  </span>
                  <span className="rounded-md bg-white px-2 py-1 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
                    {categoryDisplayName} 전체 {currentCategoryHistoryCount}건
                  </span>
                  <span className="rounded-md bg-white px-2 py-1 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
                    모든 품목 {historyCount}건
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center justify-center px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer">
                  <span>이전 Excel/CSV 불러오기</span>
                  <input type="file" accept=".xlsx,.csv" onChange={handleRestoreHistory} className="hidden" />
                </label>
                <button type="button" onClick={handleClearCurrentSubModelHistory}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-medium cursor-pointer">
                  현재 모델 초기화
                </button>
                <button type="button" onClick={handleClearCurrentCategoryHistory}
                  className="px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-300 rounded-lg text-xs font-medium cursor-pointer">
                  {categoryDisplayName} 전체 초기화
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {savedSessions.map((session) => (
              <button key={session.id} type="button" onClick={() => handleLoadSavedSession(session)}
                className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${activeSessionId === session.id && !isCombinedResults ? 'bg-cyan-50 border-cyan-500 text-cyan-950' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                <span className="block text-xs font-bold">{session.label} · {session.items.length}건</span>
                <span className="block text-[10px] opacity-70 mt-0.5">{new Date(session.updatedAt).toLocaleString('ko-KR')}</span>
              </button>
            ))}
            {savedSessions.length === 0 && (
              <span className="text-[11px] text-slate-400">{subModel}에 자동 저장된 검색 결과가 없습니다.</span>
            )}
          </div>
        </div>

      {/* Results Dashboard Component */}
      {screeningResults.length > 0 && (
        <ScreeningDashboard
          items={screeningResults}
          onUpdateItems={handleDashboardUpdate}
          onClearResults={handleClearCurrentResults}
          category={category}
          subModel={subModel}
        />
      )}

      {/* All-product history reset confirmation */}
      {isClearAllConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-all-history-title"
          onClick={() => setIsClearAllConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="clear-all-history-title" className="text-base font-bold text-slate-950">
              모든 품목 이력을 초기화할까요?
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Biliary, Esophageal, Pyloric/Duodenal, Colonic 및 Drainage의 자동 저장 결과와 중복 방지 이력이 모두 삭제됩니다.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Gemini API 키와 NCBI API 키는 삭제되지 않습니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsClearAllConfirmOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleClearAllHistoryConfirmed}
                className="rounded-lg border border-rose-700 bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800"
              >
                모든 이력 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Catalog Modal */}
      <ProductCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectModelForScreening={(catName, modelName) => {
          setCategory(catName as ScreeningCategory);
          const availableSubModels = SUB_MODELS_BY_CATEGORY[catName as ScreeningCategory] || [];
          const matched = availableSubModels.find((m) => m.toLowerCase().includes(modelName.toLowerCase())) || availableSubModels[0] || modelName;
          setSubModel(matched);
        }}
      />
    </div>
  );
};
