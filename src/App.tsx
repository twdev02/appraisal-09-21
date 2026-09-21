import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Header, TopSection } from './components/Header';
import { LiteratureScreening } from './components/screening/LiteratureScreening';
import { Step1Setup } from './components/Step1Setup';
import { Step2Inventory } from './components/Step2Inventory';
import { Step3Appraisal } from './components/Step3Appraisal';
import { Step4Safety } from './components/Step4Safety';
import { ValidationTestModal } from './components/ValidationTestModal';
import { ThemeId } from './theme';
import { Download, FileText, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import {
  DueItem,
  DueSetup,
  SimilarDevice,
  ArticleMetadata,
  ResearchGroup,
  SuitabilityAppraisalState,
  RelevanceAppraisalState,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
  SafetyEventState,
  FullAppraisalData,
  Article,
} from './types';
import {
  DEFAULT_SUITABILITY_CRITERIA,
  DEFAULT_RELEVANCE_ITEMS,
  DEFAULT_METHODOLOGICAL_CRITERIA,
  DEFAULT_CONTRIBUTION_CRITERIA,
} from './data/appraisalStandards';
import { exportBatchAppraisalDocx } from './utils/docxExport';
import { runSelfValidation } from './utils/selfValidation';

export default function App() {
  const [activeSection, setActiveSection] = useState<TopSection>('screening');
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);

  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => {
    return (
      (localStorage.getItem('app_theme') as ThemeId) ||
      'professional-clinical'
    );
  });

  const handleThemeChange = (theme: ThemeId) => {
    setCurrentTheme(theme);
    localStorage.setItem('app_theme', theme);
  };

  const [dueList, setDueList] = useState<DueItem[]>([
    {
      id: 'DUE-1',
      productName: '',
      indications: [],
      rawIndicationText: '',
    },
  ]);

  const due = dueList[0] || {
    id: 'DUE-1',
    productName: '',
    indications: [],
    rawIndicationText: '',
  };

  const handleUpdateDueList = (newDueList: DueItem[]) => {
    setDueList(newDueList);
  };

  const handleUpdateDue = (newDue: DueSetup) => {
    setDueList((prev) => {
      if (prev.length === 0) {
        return [{ ...newDue, id: 'DUE-1' }];
      }

      return prev.map((item, index) =>
        index === 0 ? { ...item, ...newDue } : item
      );
    });
  };

  const [similarDevices, setSimilarDevices] = useState<SimilarDevice[]>([]);

  const [articles, setArticles] = useState<Article[]>([]);
  const [activeArticleIndex, setActiveArticleIndex] = useState<number>(0);

  // Keep stacked sticky UI regions aligned even when the header/article toolbar
  // changes height due to responsive layout, theme, or article count.
  useEffect(() => {
    const root = document.documentElement;
    const header = document.getElementById('app-main-header');
    const articleToolbar = document.getElementById('app-article-toolbar');

    const updateStickyOffsets = () => {
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const articleToolbarHeight =
        articleToolbar?.getBoundingClientRect().height ?? 0;

      root.style.setProperty('--app-header-height', `${headerHeight}px`);
      root.style.setProperty(
        '--app-article-toolbar-height',
        `${articleToolbarHeight}px`
      );
    };

    updateStickyOffsets();
    const frame = window.requestAnimationFrame(updateStickyOffsets);
    const observer = new ResizeObserver(updateStickyOffsets);

    if (header) observer.observe(header);
    if (articleToolbar) observer.observe(articleToolbar);
    window.addEventListener('resize', updateStickyOffsets);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updateStickyOffsets);
    };
  }, [activeSection, currentStep, articles.length]);

  const activeArticleIdRef = useRef<string | null>(null);
  const removedArticleIdsRef = useRef<Set<string>>(new Set());
  const isHydratingArticleRef = useRef<boolean>(false);

  const [articleMetadata, setArticleMetadata] = useState<ArticleMetadata>({
    title: '',
    journal: '',
    publicationYear: '',
    doi: '',
    authors: '',
    totalPatientCount: '',
    studyDesign: '',
    studyPeriod: '',
    followUpPeriod: '',
  });

  const [pdfFileName, setPdfFileName] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [failedField, setFailedField] = useState<string | null>(null);

  const [researchGroups, setResearchGroups] = useState<ResearchGroup[]>([]);

  const [suitability, setSuitability] =
    useState<SuitabilityAppraisalState>({
      ...DEFAULT_SUITABILITY_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

  const [relevance, setRelevance] =
    useState<RelevanceAppraisalState>(DEFAULT_RELEVANCE_ITEMS);

  const [methodological, setMethodological] =
    useState<MethodologicalAppraisalState>({
      ...DEFAULT_METHODOLOGICAL_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

  const [contribution, setContribution] =
    useState<ContributionAppraisalState>({
      ...DEFAULT_CONTRIBUTION_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

  const [safety, setSafety] = useState<SafetyEventState>({
    events: [],
    summary: {
      status: 'Not reported',
      overallStudyPopulation: 'Not reported',
      overallPatientsWithEvents: 'Not reported',
      overallMortality: 'Not reported',
      overallSeriousAdverseEvents: 'Not reported',
      overallReinterventionDueToEvent: 'Not reported',
      evidenceQuote: '',
      evidenceLocation: '',
      remarks: '',
    },
    hasExplicitNoEventsReported: false,
    hasSafetyNotReported: true,
  });

  const syncArticleToState = (article: Article) => {
    isHydratingArticleRef.current = true;

    setPdfFileName(article.pdfFileName);
    setArticleMetadata(article.data.articleMetadata);
    setResearchGroups(article.data.researchGroups);
    setSuitability(article.data.suitability);
    setRelevance(article.data.relevance);
    setMethodological(article.methodological);
    setContribution(article.contribution);

    if (article.data.safety) {
      setSafety(article.data.safety);
    }
  };

  const handleSelectArticle = (index: number) => {
    const selectedArticle = articles[index];

    if (!selectedArticle) {
      return;
    }

    setActiveArticleIndex(index);
    activeArticleIdRef.current = selectedArticle.id;
    syncArticleToState(selectedArticle);
  };

  const handleRemoveArticle = (articleId: string) => {
    const removeIndex = articles.findIndex(
      (article) => article.id === articleId
    );

    if (removeIndex === -1) {
      return;
    }

    removedArticleIdsRef.current.add(articleId);

    const wasActive =
      activeArticleIdRef.current === articleId;
    const remainingArticles = articles.filter(
      (article) => article.id !== articleId
    );

    setArticles(remainingArticles);

    if (remainingArticles.length === 0) {
      setActiveArticleIndex(0);
      activeArticleIdRef.current = null;

      setArticleMetadata({
        title: '',
        journal: '',
        publicationYear: '',
        doi: '',
        authors: '',
        totalPatientCount: '',
        studyDesign: '',
        studyPeriod: '',
        followUpPeriod: '',
      });
      setPdfFileName('');
      setAnalysisError(null);
      setFailedField(null);
      setResearchGroups([]);

      setSuitability({
        ...DEFAULT_SUITABILITY_CRITERIA,
        totalScoreAi: 0,
        totalScoreUser: 0,
        gradeAi: 'Poor',
        gradeUser: 'Poor',
      });
      setRelevance(DEFAULT_RELEVANCE_ITEMS);
      setMethodological({
        ...DEFAULT_METHODOLOGICAL_CRITERIA,
        totalScoreAi: 0,
        totalScoreUser: 0,
        gradeAi: 'Poor',
        gradeUser: 'Poor',
      });
      setContribution({
        ...DEFAULT_CONTRIBUTION_CRITERIA,
        totalScoreAi: 0,
        totalScoreUser: 0,
        gradeAi: 'Poor',
        gradeUser: 'Poor',
      });
      setSafety({
        events: [],
        summary: {
          status: 'Not reported',
          overallStudyPopulation: 'Not reported',
          overallPatientsWithEvents: 'Not reported',
          overallMortality: 'Not reported',
          overallSeriousAdverseEvents: 'Not reported',
          overallReinterventionDueToEvent: 'Not reported',
          evidenceQuote: '',
          evidenceLocation: '',
          remarks: '',
        },
        hasExplicitNoEventsReported: false,
        hasSafetyNotReported: true,
      });
      return;
    }

    if (wasActive) {
      const nextIndex = Math.min(
        removeIndex,
        remainingArticles.length - 1
      );
      const nextArticle = remainingArticles[nextIndex];

      setActiveArticleIndex(nextIndex);
      activeArticleIdRef.current = nextArticle.id;
      syncArticleToState(nextArticle);
    } else if (removeIndex < activeArticleIndex) {
      setActiveArticleIndex((previousIndex) =>
        Math.max(0, previousIndex - 1)
      );
    }

    if (
      remainingArticles.every(
        (article) => article.status !== 'failed'
      )
    ) {
      setAnalysisError(null);
      setFailedField(null);
    }
  };

  useEffect(() => {
    if (isHydratingArticleRef.current) {
      isHydratingArticleRef.current = false;
      return;
    }

    if (articles.length > 0 && activeArticleIdRef.current) {
      setArticles((previousArticles) =>
        previousArticles.map((article) => {
          if (article.id !== activeArticleIdRef.current) {
            return article;
          }

          return {
            ...article,
            pdfFileName,
            data: {
              ...article.data,
              articleMetadata,
              researchGroups,
              suitability,
              relevance,
              methodological,
              contribution,
              safety,
            },
            methodological,
            contribution,
          };
        })
      );
    }
  }, [
    articleMetadata,
    researchGroups,
    suitability,
    relevance,
    methodological,
    contribution,
    safety,
  ]);

  const handleNewEvaluation = () => {
    setCurrentStep(1);
    setArticles([]);
    setActiveArticleIndex(0);
    activeArticleIdRef.current = null;
    removedArticleIdsRef.current.clear();

    setDueList([
      {
        id: 'DUE-1',
        productName: '',
        indications: [],
        rawIndicationText: '',
      },
    ]);

    setSimilarDevices([]);

    setArticleMetadata({
      title: '',
      journal: '',
      publicationYear: '',
      doi: '',
      authors: '',
      totalPatientCount: '',
      studyDesign: '',
      studyPeriod: '',
      followUpPeriod: '',
    });

    setPdfFileName('');
    setIsAnalyzing(false);
    setAnalysisError(null);
    setFailedField(null);
    setResearchGroups([]);

    setSuitability({
      ...DEFAULT_SUITABILITY_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

    setRelevance(DEFAULT_RELEVANCE_ITEMS);

    setMethodological({
      ...DEFAULT_METHODOLOGICAL_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

    setContribution({
      ...DEFAULT_CONTRIBUTION_CRITERIA,
      totalScoreAi: 0,
      totalScoreUser: 0,
      gradeAi: 'Poor',
      gradeUser: 'Poor',
    });

    setSafety({
      events: [],
      summary: {
        status: 'Not reported',
        overallStudyPopulation: 'Not reported',
        overallPatientsWithEvents: 'Not reported',
        overallMortality: 'Not reported',
        overallSeriousAdverseEvents: 'Not reported',
        overallReinterventionDueToEvent: 'Not reported',
        evidenceQuote: '',
        evidenceLocation: '',
        remarks: '',
      },
      hasExplicitNoEventsReported: false,
      hasSafetyNotReported: true,
    });
  };

  const callAnalyzePdfApi = async (
    formData: FormData
  ): Promise<FullAppraisalData> => {
    let response: Response;

    try {
      response = await fetch('/api/analyze-pdf', {
        method: 'POST',
        body: formData,
      });
    } catch (networkError: any) {
      // A browser-level TypeError here means no HTTP response was received at all
      // (server restart, preview tunnel interruption, or a long request being cut).
      // Distinguish it from a normal Gemini/API 4xx/5xx response so the user knows
      // that Retry is safe and the PDF itself is not necessarily invalid.
      let backendReachable = false;
      try {
        const health = await fetch('/api/health', { cache: 'no-store' });
        backendReachable = health.ok;
      } catch {
        backendReachable = false;
      }

      if (backendReachable) {
        throw new Error(
          'Analysis connection was interrupted before the result returned. The backend is available; click Retry to analyze this article again.'
        );
      }

      throw new Error(
        'Analysis backend connection was lost. Wait a few seconds for the preview server to reconnect, then click Retry.'
      );
    }

    const contentType = response.headers.get('content-type') || '';
    const isJsonResponse = contentType
      .toLowerCase()
      .includes('application/json');

    let responseBodyText = '';

    try {
      responseBodyText = await response.text();
    } catch {
      responseBodyText = '';
    }

    const normalizedResponse = responseBodyText.trim().toLowerCase();

    const isHtmlResponse =
      normalizedResponse.startsWith('<!doctype') ||
      normalizedResponse.startsWith('<html') ||
      responseBodyText.includes('<body') ||
      responseBodyText.includes('<!DOCTYPE');

    if (!response.ok || !isJsonResponse || isHtmlResponse) {
      if (
        isHtmlResponse ||
        normalizedResponse.startsWith('<!doctype')
      ) {
        throw new Error(
          `PDF analysis request took longer than expected or gateway timeout occurred. Please click Retry to analyze this article again.`
        );
      }

      if (isJsonResponse && responseBodyText) {
        let parsedError: any;

        try {
          parsedError = JSON.parse(responseBodyText);
        } catch {
          parsedError = null;
        }

        if (parsedError?.error) {
          throw new Error(parsedError.error);
        }
      }

      throw new Error(
        `Server error (HTTP ${response.status}): ` +
          `${responseBodyText.slice(0, 500) || response.statusText}`
      );
    }

    let responseJson: any;

    try {
      responseJson = JSON.parse(responseBodyText);
    } catch (jsonError: any) {
      if (
        normalizedResponse.startsWith('<!doctype') ||
        responseBodyText.includes('<html')
      ) {
        throw new Error(
          `PDF analysis request took longer than expected or gateway timeout occurred. Please click Retry to analyze this article again.`
        );
      }

      throw new Error(
        `Invalid JSON response from server ` +
          `(HTTP ${response.status}): ${jsonError.message}`
      );
    }

    if (
      !responseJson ||
      !responseJson.success ||
      !responseJson.data
    ) {
      throw new Error(
        responseJson?.error ||
          'Failed to extract clinical data from PDF.'
      );
    }

    return responseJson.data;
  };

  const handleFileUpload = async (
    filesInput: File | File[]
  ) => {
    const fileList = Array.isArray(filesInput)
      ? filesInput
      : [filesInput];

    if (fileList.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    const newArticles: Article[] = fileList.map(
      (file, index) => ({
        id:
          `art-${Date.now()}-${index}-` +
          Math.random().toString(36).substring(2, 7),
        file,
        pdfFileName: file.name,
        status: 'pending',
        data: {
          due,
          dueList,
          similarDevices,
          articleMetadata: { ...articleMetadata },
          pdfFileName: file.name,
          researchGroups: [],
          suitability: { ...suitability },
          relevance: { ...relevance },
          methodological: { ...methodological },
          contribution: { ...contribution },
          safety: { ...safety },
        },
        methodological: { ...methodological },
        contribution: { ...contribution },
      })
    );

    const updatedArticles = [...articles, ...newArticles];
    const startIndex = articles.length;

    setArticles(updatedArticles);
    setActiveArticleIndex(startIndex);

    activeArticleIdRef.current =
      updatedArticles[startIndex].id;

    syncArticleToState(updatedArticles[startIndex]);

    for (
      let articleIndex = startIndex;
      articleIndex < updatedArticles.length;
      articleIndex += 1
    ) {
      const currentArticle =
        updatedArticles[articleIndex];

      if (
        removedArticleIdsRef.current.has(
          currentArticle.id
        )
      ) {
        continue;
      }

      setArticles((previousArticles) =>
        previousArticles.map((article) =>
          article.id === currentArticle.id
            ? {
                ...article,
                status: 'analyzing',
                errorMessage: undefined,
              }
            : article
        )
      );

      try {
        const formData = new FormData();

        formData.append('file', currentArticle.file);
        formData.append(
          'fileName',
          currentArticle.file.name
        );
        formData.append(
          'dueList',
          JSON.stringify(dueList)
        );
        formData.append(
          'due',
          JSON.stringify(dueList[0] || due)
        );
        formData.append(
          'similarDevices',
          JSON.stringify(similarDevices)
        );

        const extracted =
          await callAnalyzePdfApi(formData);

        if (
          removedArticleIdsRef.current.has(
            currentArticle.id
          )
        ) {
          continue;
        }

        const completedArticle: Article = {
          ...currentArticle,
          status: 'completed',
          errorMessage: undefined,
          data: {
            ...extracted,
            due,
            dueList,
            similarDevices,
            researchGroups:
              extracted.researchGroups || [],
          },
          methodological:
            extracted.methodological ||
            methodological,
          contribution:
            extracted.contribution ||
            contribution,
        };

        setArticles((previousArticles) =>
          previousArticles.map((article) =>
            article.id === currentArticle.id
              ? completedArticle
              : article
          )
        );

        if (
          activeArticleIdRef.current ===
          completedArticle.id
        ) {
          syncArticleToState(completedArticle);
        }

        if (
          articleIndex === startIndex &&
          extracted.researchGroups &&
          extracted.researchGroups.length > 0
        ) {
          setCurrentStep(2);
        }
      } catch (error: any) {
        if (
          removedArticleIdsRef.current.has(
            currentArticle.id
          )
        ) {
          continue;
        }

        console.error(
          `Error analyzing article ${currentArticle.pdfFileName}:`,
          error
        );

        const failedArticle: Article = {
          ...currentArticle,
          status: 'failed',
          errorMessage:
            error.message || 'PDF analysis failed',
        };

        setArticles((previousArticles) =>
          previousArticles.map((article) =>
            article.id === currentArticle.id
              ? failedArticle
              : article
          )
        );

        setAnalysisError(
          `Failed to analyze ${currentArticle.pdfFileName}: ` +
            `${error.message}`
        );
      }
    }

    setIsAnalyzing(false);
  };

  const handleRetryArticle = async (
    articleId: string
  ) => {
    const articleIndex = articles.findIndex(
      (article) => article.id === articleId
    );

    if (articleIndex === -1) {
      return;
    }

    const currentArticle = articles[articleIndex];

    setActiveArticleIndex(articleIndex);
    activeArticleIdRef.current = currentArticle.id;
    syncArticleToState(currentArticle);

    setArticles((previousArticles) =>
      previousArticles.map((article) =>
        article.id === articleId
          ? {
              ...article,
              status: 'analyzing',
              errorMessage: undefined,
            }
          : article
      )
    );

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const formData = new FormData();

      formData.append('file', currentArticle.file);
      formData.append(
        'fileName',
        currentArticle.file.name
      );
      formData.append(
        'dueList',
        JSON.stringify(dueList)
      );
      formData.append(
        'due',
        JSON.stringify(dueList[0] || due)
      );
      formData.append(
        'similarDevices',
        JSON.stringify(similarDevices)
      );

      const extracted =
        await callAnalyzePdfApi(formData);

      const completedArticle: Article = {
        ...currentArticle,
        status: 'completed',
        errorMessage: undefined,
        data: {
          ...extracted,
          due,
          dueList,
          similarDevices,
          researchGroups:
            extracted.researchGroups || [],
        },
        methodological:
          extracted.methodological ||
          methodological,
        contribution:
          extracted.contribution ||
          contribution,
      };

      setArticles((previousArticles) =>
        previousArticles.map((article) =>
          article.id === articleId
            ? completedArticle
            : article
        )
      );

      if (
        activeArticleIdRef.current ===
        completedArticle.id
      ) {
        syncArticleToState(completedArticle);
      }

      if (
        extracted.researchGroups &&
        extracted.researchGroups.length > 0
      ) {
        setCurrentStep(2);
      }
    } catch (error: any) {
      console.error('Retry analysis error:', error);

      setArticles((previousArticles) =>
        previousArticles.map((article) =>
          article.id === articleId
            ? {
                ...article,
                status: 'failed',
                errorMessage: error.message,
              }
            : article
        )
      );

      setAnalysisError(
        error.message ||
          'Error communicating with extraction backend.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const hasExtractedData = Boolean(
    pdfFileName && researchGroups.length > 0
  );

  const getAppBgClass = () => {
    switch (currentTheme) {
      case 'professional-clinical':
        return (
          'bg-[#f1f5f9] text-slate-900 ' +
          'selection:bg-slate-900 selection:text-white'
        );

      case 'navy-clinical':
        return (
          'bg-slate-50/80 text-slate-900 ' +
          'selection:bg-blue-100 selection:text-blue-900'
        );

      case 'modern-blue':
        return (
          'bg-blue-50/40 text-slate-900 ' +
          'selection:bg-blue-200 selection:text-blue-900'
        );

      case 'teal-medical':
        return (
          'bg-teal-50/30 text-zinc-900 ' +
          'selection:bg-teal-100 selection:text-teal-900'
        );

      case 'dark-slate':
        return (
          'bg-zinc-900 text-zinc-100 ' +
          'selection:bg-zinc-700 selection:text-zinc-100'
        );

      case 'warm-stone':
      default:
        return (
          'bg-stone-50/70 text-stone-900 ' +
          'selection:bg-stone-200 selection:text-stone-900'
        );
    }
  };

  const completedArticles = articles.filter(
    (article) => article.status === 'completed'
  );

  const selfValidation = useMemo(() => {
    const active = articles[activeArticleIndex];
    if (!active || active.status !== 'completed') return active?.data?.selfValidation;
    return runSelfValidation({
      ...active.data,
      due,
      dueList,
      similarDevices,
      articleMetadata,
      researchGroups,
      suitability,
      relevance,
      methodological,
      contribution,
      safety,
    });
  }, [
    articles,
    activeArticleIndex,
    due,
    dueList,
    similarDevices,
    articleMetadata,
    researchGroups,
    suitability,
    relevance,
    methodological,
    contribution,
    safety,
  ]);

  return (
    <div
      className={
        `min-h-screen ${getAppBgClass()} ` +
        'font-sans flex flex-col transition-colors duration-200'
      }
    >
      <Header
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        currentStep={currentStep}
        onStepChange={(step) => setCurrentStep(step)}
        onOpenTestModal={() => setIsTestModalOpen(true)}
        onNewEvaluation={handleNewEvaluation}
        hasExtractedData={hasExtractedData}
        currentTheme={currentTheme}
        onThemeChange={handleThemeChange}
      />

      <main
        className={
          'flex-1 max-w-7xl w-full mx-auto ' +
          'px-4 sm:px-6 lg:px-8 pt-6 pb-12'
        }
      >
        {activeSection === 'screening' && (
          <LiteratureScreening />
        )}

        {activeSection === 'appraisal' && (
          <>
            {currentStep === 1 && (
              <Step1Setup
                dueList={dueList}
                onUpdateDueList={handleUpdateDueList}
                due={due}
                onUpdateDue={handleUpdateDue}
                similarDevices={similarDevices}
                onUpdateSimilarDevices={
                  setSimilarDevices
                }
                articles={articles}
                activeArticleIndex={activeArticleIndex}
                onSelectArticle={handleSelectArticle}
                onRemoveArticle={handleRemoveArticle}
                pdfFileName={pdfFileName}
                isAnalyzing={isAnalyzing}
                analysisError={analysisError}
                failedField={failedField}
                selfValidation={selfValidation}
                onFileUpload={handleFileUpload}
                onRetryArticle={handleRetryArticle}
                onProceed={() => setCurrentStep(2)}
              />
            )}

            {currentStep > 1 &&
              articles.length > 0 && (
                <div
                  id="app-article-toolbar"
                  className={
                    'sticky z-30 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl ' +
                    'p-3 mb-6 shadow-sm flex flex-col sm:flex-row ' +
                    'sm:items-center gap-3'
                  }
                  style={{ top: 'var(--app-header-height, 0px)' }}
                >
                  <div
                    className={
                      'flex items-center gap-2 overflow-x-auto ' +
                      'flex-1 min-w-0 w-full py-1'
                    }
                  >
                    <span
                      className={
                        'text-xs font-bold text-slate-700 ' +
                        'uppercase tracking-wider shrink-0'
                      }
                    >
                      Articles ({articles.length}):
                    </span>

                    <div className="flex items-center gap-1.5 min-w-max">
                      {articles.map(
                        (article, index) => (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() =>
                              handleSelectArticle(index)
                            }
                            className={
                              `inline-flex items-center gap-1.5 ` +
                              `px-3 py-1.5 rounded-lg text-xs ` +
                              `font-medium transition-all ` +
                              `cursor-pointer shrink-0 ${
                                activeArticleIndex === index
                                  ? 'bg-slate-900 text-white shadow-2xs'
                                  : article.status ===
                                      'completed'
                                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                                    : article.status ===
                                        'failed'
                                      ? 'bg-rose-50 text-rose-900 border border-rose-200 hover:bg-rose-100'
                                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`
                            }
                          >
                            <FileText className="w-3.5 h-3.5" />

                            <span className="max-w-[140px] truncate">
                              {article.pdfFileName}
                            </span>

                            {article.status ===
                              'completed' && (
                              <CheckCircle2
                                className={
                                  'w-3.5 h-3.5 text-emerald-500'
                                }
                              />
                            )}

                            {article.status ===
                              'analyzing' && (
                              <Loader2
                                className={
                                  'w-3.5 h-3.5 animate-spin text-slate-600'
                                }
                              />
                            )}

                            {article.status ===
                              'failed' && (
                              <AlertCircle
                                className={
                                  'w-3.5 h-3.5 text-rose-600'
                                }
                              />
                            )}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {completedArticles.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        exportBatchAppraisalDocx(
                          completedArticles
                        )
                      }
                      className={
                        'inline-flex items-center gap-1.5 px-4 py-2 ' +
                        'bg-slate-900 hover:bg-slate-800 text-white ' +
                        'rounded-lg text-xs font-semibold transition-colors ' +
                        'shadow-xs cursor-pointer shrink-0 self-end sm:self-auto'
                      }
                    >
                      <Download className="w-3.5 h-3.5" />

                      <span>
                        Export All to Word (
                        {completedArticles.length})
                      </span>
                    </button>
                  )}
                </div>
              )}

            {currentStep === 2 && (
              <Step2Inventory
                researchGroups={researchGroups}
                onUpdateResearchGroups={
                  setResearchGroups
                }
                due={due}
                dueList={dueList}
                similarDevices={similarDevices}
                articleMetadata={articleMetadata}
                pdfFileName={pdfFileName}
                selfValidation={selfValidation}
                onProceed={() => setCurrentStep(3)}
                onBack={() => setCurrentStep(1)}
              />
            )}

            {currentStep === 3 && (
              <Step3Appraisal
                suitability={suitability}
                onUpdateSuitability={setSuitability}
                relevance={relevance}
                onUpdateRelevance={setRelevance}
                methodological={methodological}
                onUpdateMethodological={
                  setMethodological
                }
                contribution={contribution}
                onUpdateContribution={
                  setContribution
                }
                due={due}
                dueList={dueList}
                similarDevices={similarDevices}
                researchGroups={researchGroups}
                articleMetadata={articleMetadata}
                pdfFileName={pdfFileName}
                selfValidation={selfValidation}
                onBack={() => setCurrentStep(2)}
                onExportAll={() =>
                  exportBatchAppraisalDocx(completedArticles)
                }
                completedArticleCount={completedArticles.length}
              />
            )}

            {currentStep === 4 && (
              <Step4Safety
                safety={safety}
                selfValidation={selfValidation}
                fullData={{
                  due,
                  dueList,
                  similarDevices,
                  articleMetadata,
                  rawPaperText: '',
                  pdfFileName,
                  researchGroups,
                  suitability,
                  relevance,
                  methodological,
                  contribution,
                  safety,
                  selfValidation,
                }}
                methodological={methodological}
                contribution={contribution}
                onUpdateSafety={setSafety}
                onBack={() => setCurrentStep(3)}
                onNewEvaluation={
                  handleNewEvaluation
                }
              />
            )}
          </>
        )}
      </main>

      <footer
        className={
          'bg-white border-t border-stone-200 ' +
          'py-4 text-center text-xs text-stone-500'
        }
      >
        <div
          className={
            'max-w-7xl mx-auto px-4 flex flex-col ' +
            'sm:flex-row items-center justify-between gap-2'
          }
        >
          <span>
            Clinical Literature Appraisal Extractor
            {' • '}
            Regulatory Compliance Workspace
          </span>

          <span className="font-mono text-[10px] text-stone-400">
            IMDRF MDCE WG/N56FINAL:2019 Appendices D1
            {' & '}
            MEDDEV 2.7.1 Rev.4 Sec 9.3.2 c
          </span>
        </div>
      </footer>

      <ValidationTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />
    </div>
  );
}