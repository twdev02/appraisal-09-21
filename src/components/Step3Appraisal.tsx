import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowLeft,
  Quote,
  MapPin,
  CheckSquare,
  Square,
  FileCheck,
  ChevronDown,
  ChevronUp,
  Table,
  Info,
  Download,
  ShieldAlert,
  ShieldCheck,
  BarChart3,
  Sliders,
  Check,
  Clock,
  Users,
} from 'lucide-react';
import {
  SuitabilityAppraisalState,
  RelevanceAppraisalState,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
  SuitabilityCriterionItem,
  RelevanceChecklistItem,
  MethodologicalCriterionItem,
  ContributionCriterionItem,
  DueSetup,
  DueItem,
  SimilarDevice,
  ResearchGroup,
  FullAppraisalData,
  ArticleMetadata,
  SelfValidationState,
} from '../types';
import { EvidenceBadge } from './EvidenceBadge';
import { SelfValidationBadge } from './SelfValidationBadge';
import { issuesForTarget } from '../utils/selfValidation';
import {
  calculateSuitabilityGrade,
  calculateMethodologicalGrade,
  calculateContributionGrade,
  calculateOverallAppraisal,
} from '../data/appraisalStandards';
import { exportAppraisalPlanDocx } from '../utils/docxExport';

interface GroupTextSegment {
  group: string;
  value: string;
}

// Extraction fills fields like `durationOfApplicationOrUse` with one "GroupName: value" line per
// study group (joined by \n). Split them back apart so each group renders in its own cell instead
// of one run-on paragraph.
function parseGroupTextSegments(text: string | undefined, groupNames: string[]): GroupTextSegment[] {
  if (!text || !text.trim() || text.trim() === 'Not reported') return [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const knownName = groupNames.find((name) => name && line.startsWith(`${name}:`));
    if (knownName) {
      return { group: knownName, value: line.slice(knownName.length + 1).trim() || 'Not reported' };
    }
    const generic = line.match(/^([^:]{1,100}?):\s*(.+)$/);
    if (generic) {
      return { group: generic[1].trim(), value: generic[2].trim() };
    }
    return { group: '', value: line };
  });
}

const GroupSegmentedField: React.FC<{ text?: string; groupNames: string[] }> = ({ text, groupNames }) => {
  const segments = parseGroupTextSegments(text, groupNames);

  if (segments.length <= 1) {
    return (
      <p className="text-xs font-mono text-slate-900 bg-white p-2 rounded border border-slate-200 leading-snug">
        {segments[0]?.value || text || 'Not reported'}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {segments.map((seg, i) => (
        <div key={i} className="bg-white rounded border border-slate-200 p-2">
          {seg.group && (
            <div className="text-[11px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 mb-1 inline-block">
              {seg.group}
            </div>
          )}
          <p className="text-xs font-mono text-slate-900 leading-snug">{seg.value}</p>
        </div>
      ))}
    </div>
  );
};

interface Step3AppraisalProps {
  suitability: SuitabilityAppraisalState;
  onUpdateSuitability: (suitability: SuitabilityAppraisalState) => void;
  relevance: RelevanceAppraisalState;
  onUpdateRelevance: (relevance: RelevanceAppraisalState) => void;
  methodological: MethodologicalAppraisalState;
  onUpdateMethodological: (methodological: MethodologicalAppraisalState) => void;
  contribution: ContributionAppraisalState;
  onUpdateContribution: (contribution: ContributionAppraisalState) => void;
  due?: DueSetup;
  dueList?: DueItem[];
  similarDevices: SimilarDevice[];
  researchGroups: ResearchGroup[];
  articleMetadata?: ArticleMetadata;
  pdfFileName?: string;
  selfValidation?: SelfValidationState;
  onBack: () => void;
  onExportAll?: () => Promise<void> | void;
  completedArticleCount?: number;
}

export const Step3Appraisal: React.FC<Step3AppraisalProps> = ({
  suitability,
  onUpdateSuitability,
  relevance,
  onUpdateRelevance,
  methodological,
  onUpdateMethodological,
  contribution,
  onUpdateContribution,
  due,
  dueList,
  similarDevices,
  researchGroups,
  articleMetadata,
  pdfFileName,
  selfValidation,
  onBack,
  onExportAll,
  completedArticleCount = 0,
}) => {
  const [activeTab, setActiveTab] = useState<
    'suitability' | 'relevance' | 'methodological' | 'contribution' | 'overall'
  >('suitability');
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(event.target as Node)
      ) {
        setIsDownloadMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Overall Appraisal summary state
  const overall = calculateOverallAppraisal(
    suitability.totalScoreUser,
    methodological.totalScoreUser,
    contribution.totalScoreUser
  );

  // 1. Suitability item selection handler
  const handleUpdateSuitabilityItem = (
    key: keyof SuitabilityAppraisalState,
    selection: string,
    score: number
  ) => {
    const currentItem = suitability[key] as SuitabilityCriterionItem;
    if (!currentItem || typeof currentItem !== 'object') return;

    const updatedItem = {
      ...currentItem,
      userFinalSelection: selection,
      userFinalScore: score,
    };

    const newSuitability: SuitabilityAppraisalState = {
      ...suitability,
      [key]: updatedItem,
    };

    const totalUserScore =
      (key === 'appropriateDevice' ? score : suitability.appropriateDevice.userFinalScore) +
      (key === 'appropriateDeviceApplication' ? score : suitability.appropriateDeviceApplication.userFinalScore) +
      (key === 'appropriatePatientGroup' ? score : suitability.appropriatePatientGroup.userFinalScore) +
      (key === 'acceptableReportDataCollation' ? score : suitability.acceptableReportDataCollation.userFinalScore);

    newSuitability.totalScoreUser = totalUserScore;
    newSuitability.gradeUser = calculateSuitabilityGrade(totalUserScore);

    onUpdateSuitability(newSuitability);
  };

  const handleUpdateSuitabilityComment = (key: keyof SuitabilityAppraisalState, comment: string) => {
    const currentItem = suitability[key] as SuitabilityCriterionItem;
    if (!currentItem) return;
    onUpdateSuitability({
      ...suitability,
      [key]: { ...currentItem, comment },
    });
  };

  // 2. Relevance checklist item handler
  const handleToggleRelevanceOption = (
    key: keyof RelevanceAppraisalState,
    option: string,
    isMultiSelect: boolean = true
  ) => {
    const currentItem = relevance[key] as RelevanceChecklistItem;
    if (!currentItem) return;

    let updatedOptions: string[];
    if (isMultiSelect) {
      if (currentItem.userSelectedOptions.includes(option)) {
        updatedOptions = currentItem.userSelectedOptions.filter((o) => o !== option);
      } else {
        updatedOptions = [...currentItem.userSelectedOptions, option];
      }
    } else {
      updatedOptions = [option];
    }

    onUpdateRelevance({
      ...relevance,
      [key]: {
        ...currentItem,
        userSelectedOptions: updatedOptions,
      },
    });
  };

  const handleUpdateRelevanceComment = (key: keyof RelevanceAppraisalState, comment: string) => {
    const currentItem = relevance[key] as RelevanceChecklistItem;
    if (!currentItem) return;
    onUpdateRelevance({
      ...relevance,
      [key]: { ...currentItem, comment },
    });
  };

  // 3. Methodological item selection handler
  const handleUpdateMethodologicalItem = (
    key: keyof MethodologicalAppraisalState,
    selection: string,
    score: number
  ) => {
    const currentItem = methodological[key] as MethodologicalCriterionItem;
    if (!currentItem || typeof currentItem !== 'object') return;

    const updatedItem = {
      ...currentItem,
      userFinalSelection: selection,
      userFinalScore: score,
    };

    const newMethodological: MethodologicalAppraisalState = {
      ...methodological,
      [key]: updatedItem,
    };

    const totalUserScore =
      (key === 'informationElementary' ? score : methodological.informationElementary.userFinalScore) +
      (key === 'patientsNumber' ? score : methodological.patientsNumber.userFinalScore) +
      (key === 'statisticalMethods' ? score : methodological.statisticalMethods.userFinalScore) +
      (key === 'adequateControls' ? score : methodological.adequateControls.userFinalScore) +
      (key === 'collectionMortalityAE' ? score : methodological.collectionMortalityAE.userFinalScore) +
      (key === 'interpretationAuthors' ? score : methodological.interpretationAuthors.userFinalScore) +
      (key === 'studyLegality' ? score : methodological.studyLegality.userFinalScore);

    newMethodological.totalScoreUser = totalUserScore;
    newMethodological.gradeUser = calculateMethodologicalGrade(totalUserScore);

    onUpdateMethodological(newMethodological);
  };

  const handleUpdateMethodologicalComment = (
    key: keyof MethodologicalAppraisalState,
    comment: string
  ) => {
    const currentItem = methodological[key] as MethodologicalCriterionItem;
    if (!currentItem) return;
    onUpdateMethodological({
      ...methodological,
      [key]: { ...currentItem, comment },
    });
  };

  // 4. Contribution item selection handler
  const handleUpdateContributionItem = (
    key: keyof ContributionAppraisalState,
    selection: string,
    score: number
  ) => {
    const currentItem = contribution[key] as ContributionCriterionItem;
    if (!currentItem || typeof currentItem !== 'object') return;

    const updatedItem = {
      ...currentItem,
      userFinalSelection: selection,
      userFinalScore: score,
    };

    const newContribution: ContributionAppraisalState = {
      ...contribution,
      [key]: updatedItem,
    };

    const totalUserScore =
      (key === 'dataSourceType' ? score : contribution.dataSourceType.userFinalScore) +
      (key === 'outcomeMeasures' ? score : contribution.outcomeMeasures.userFinalScore) +
      (key === 'followUp' ? score : contribution.followUp.userFinalScore) +
      (key === 'statisticalSignificance' ? score : contribution.statisticalSignificance.userFinalScore) +
      (key === 'clinicalSignificance' ? score : contribution.clinicalSignificance.userFinalScore);

    newContribution.totalScoreUser = totalUserScore;
    newContribution.gradeUser = calculateContributionGrade(totalUserScore);

    onUpdateContribution(newContribution);
  };

  const handleUpdateContributionComment = (
    key: keyof ContributionAppraisalState,
    comment: string
  ) => {
    const currentItem = contribution[key] as ContributionCriterionItem;
    if (!currentItem) return;
    onUpdateContribution({
      ...contribution,
      [key]: { ...currentItem, comment },
    });
  };

  // Export DOCX handler
  const handleExportDocx = async () => {
    setIsExporting(true);
    try {
      const fullData: FullAppraisalData = {
        due: dueList && dueList[0] ? dueList[0] : due,
        dueList: dueList || (due ? [due] : []),
        similarDevices,
        articleMetadata: articleMetadata || {
          title: pdfFileName || '',
          journal: '',
          publicationYear: '',
          doi: '',
          authors: '',
        },
        pdfFileName,
        researchGroups,
        suitability,
        relevance,
        methodological,
        contribution,
      };
      await exportAppraisalPlanDocx(fullData, methodological, contribution);
    } catch (err) {
      console.error('Error exporting DOCX:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAllDocx = async () => {
    if (!onExportAll || completedArticleCount < 1) return;

    setIsBatchExporting(true);
    try {
      await onExportAll();
    } catch (err) {
      console.error('Error exporting batch DOCX:', err);
    } finally {
      setIsBatchExporting(false);
    }
  };

  const suitabilityItems: { key: keyof SuitabilityAppraisalState; item: SuitabilityCriterionItem }[] = [
    { key: 'appropriateDevice', item: suitability.appropriateDevice },
    { key: 'appropriateDeviceApplication', item: suitability.appropriateDeviceApplication },
    { key: 'appropriatePatientGroup', item: suitability.appropriatePatientGroup },
    { key: 'acceptableReportDataCollation', item: suitability.acceptableReportDataCollation },
  ];

  const relevanceItems: { key: keyof RelevanceAppraisalState; item: RelevanceChecklistItem }[] = [
    { key: 'itemA_representativeness', item: relevance.itemA_representativeness },
    { key: 'itemB_aspectsCovered', item: relevance.itemB_aspectsCovered },
    { key: 'itemC_intendedPurposeClaims', item: relevance.itemC_intendedPurposeClaims },
    { key: 'itemD_modelSizeSetting', item: relevance.itemD_modelSizeSetting },
    { key: 'itemE_userGroup', item: relevance.itemE_userGroup },
    { key: 'itemF_medicalIndication', item: relevance.itemF_medicalIndication },
    { key: 'itemG_ageGroup', item: relevance.itemG_ageGroup },
    { key: 'itemH_gender', item: relevance.itemH_gender },
    { key: 'itemI_typeSeverityCondition', item: relevance.itemI_typeSeverityCondition },
    { key: 'itemJ_rangeOfTime', item: relevance.itemJ_rangeOfTime },
  ];

  const methodologicalItems: {
    key: keyof MethodologicalAppraisalState;
    item: MethodologicalCriterionItem;
  }[] = [
    { key: 'informationElementary', item: methodological.informationElementary },
    { key: 'patientsNumber', item: methodological.patientsNumber },
    { key: 'statisticalMethods', item: methodological.statisticalMethods },
    { key: 'adequateControls', item: methodological.adequateControls },
    { key: 'collectionMortalityAE', item: methodological.collectionMortalityAE },
    { key: 'interpretationAuthors', item: methodological.interpretationAuthors },
    { key: 'studyLegality', item: methodological.studyLegality },
  ];

  const contributionItems: {
    key: keyof ContributionAppraisalState;
    item: ContributionCriterionItem;
  }[] = [
    { key: 'dataSourceType', item: contribution.dataSourceType },
    { key: 'outcomeMeasures', item: contribution.outcomeMeasures },
    { key: 'followUp', item: contribution.followUp },
    { key: 'statisticalSignificance', item: contribution.statisticalSignificance },
    { key: 'clinicalSignificance', item: contribution.clinicalSignificance },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Step 3. Article Appraisal
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Standard 5-section evaluation pursuant to IMDRF MDCE WG/N56 &amp; MEDDEV 2.7.1 Rev.4.
        </p>
      </div>

      {/* Overall status scrolls normally */}
      {/* Top Overall Status Bar */}
      <div
        className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs ${
          overall.overallResult === 'Accepted'
            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
            : 'bg-rose-50/70 border-rose-300 text-rose-950'
        }`}
      >
        <div className="flex items-center gap-3">
          {overall.overallResult === 'Accepted' ? (
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
              <Check className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Appraisal Result:</span>
              <span
                className={`font-black text-sm uppercase tracking-wide ${
                  overall.overallResult === 'Accepted' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {overall.overallResult}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                (Overall Grade: {overall.overallGrade})
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5 font-medium">
              Total Score: {overall.totalScore} / {overall.maxTotalScore} points (Suitability {suitability.totalScoreUser}/11 + Methodological {methodological.totalScoreUser}/12 + Contribution {contribution.totalScoreUser}/10)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('overall')}
          className="text-xs font-bold text-slate-800 hover:text-slate-950 underline underline-offset-2 self-start sm:self-auto cursor-pointer"
        >
          View Full Synthesis Table &rarr;
        </button>
      </div>

      {/* 5-Tab Navigation */}
      <div
        className="sticky z-20 border-b border-slate-200 bg-slate-100/95 backdrop-blur-md pt-2 -mx-2 px-2 shadow-[0_6px_12px_-12px_rgba(15,23,42,0.45)]"
        style={{
          top: 'calc(var(--app-header-height, 0px) + var(--app-article-toolbar-height, 0px))',
        }}
      >
        <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto pb-px text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('suitability')}
            className={`py-3 px-3 border-b-2 font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'suitability'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>1. Suitability</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-xs">
              {suitability.totalScoreUser}/11 ({suitability.gradeUser})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('relevance')}
            className={`py-3 px-3 border-b-2 font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'relevance'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>2. Relevance Checklist</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-xs">
              10 Items
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('methodological')}
            className={`py-3 px-3 border-b-2 font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'methodological'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>3. Methodological</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-xs">
              {methodological.totalScoreUser}/12 ({methodological.gradeUser})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('contribution')}
            className={`py-3 px-3 border-b-2 font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'contribution'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>4. Contribution</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-xs">
              {contribution.totalScoreUser}/10 ({contribution.gradeUser})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('overall')}
            className={`py-3 px-3 border-b-2 font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'overall'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>5. Overall Synthesis</span>
            <span
              className={`px-2 py-0.5 rounded-full font-mono text-xs ${
                overall.overallResult === 'Accepted'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {overall.overallResult}
            </span>
          </button>
        </nav>
      </div>

      {/* TAB 1: Suitability Criteria */}
      {activeTab === 'suitability' && (
        <div className="space-y-6">
          <div className="bg-slate-50/90 p-4 rounded-xl border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-2xs">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Appraisal Criteria for Suitability (IMDRF MDCE WG/N56FINAL:2019 Appendices D1)
              </h3>
              <p className="text-slate-600 mt-0.5">
                Evaluates appropriate device, device application, patient cohort, and report collation quality. Max score: 11.
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 font-medium">Suitability Grade: </span>
              <span className="font-bold text-sm text-slate-900">{suitability.gradeUser}</span>
              <span className="text-xs text-slate-600 ml-1 font-semibold">
                ({suitability.totalScoreUser} / 11 pts)
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {suitabilityItems.map(({ key, item }, idx) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        Criterion #{idx + 1}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900">{item.name}</h4>
                      <SelfValidationBadge issues={issuesForTarget(selfValidation, `step3.${item.id}`)} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1 italic leading-relaxed font-medium">
                      &quot;{item.question}&quot;
                    </p>
                    {key === 'appropriateDevice' && (item.matchedDueProductName || due?.productName) && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-semibold text-slate-700">Matched DUE Product:</span>
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-medium">
                          {item.matchedDueProductName || due?.productName}
                        </span>
                      </div>
                    )}
                    {key === 'appropriateDeviceApplication' && (item.matchedDueIndication || due?.indications?.[0]) && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-semibold text-slate-700">Matched DUE Indication:</span>
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-medium">
                          {item.matchedDueIndication || due?.indications?.[0]}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-slate-900">
                      User Final Score: {item.userFinalScore} / {item.weight}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-medium">
                      (AI Recommended: {item.aiRecommendedScore})
                    </span>
                  </div>
                </div>

                {/* Radio Options Grid */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Scoring Options (Select User final value):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {item.options.map((opt) => {
                      const isSelected = item.userFinalSelection === opt.label;
                      const isAiRec = item.aiRecommendedSelection === opt.label;

                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => handleUpdateSuitabilityItem(key, opt.label, opt.score)}
                          className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className="font-semibold text-xs">{opt.label}</span>
                            <span
                              className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                                isSelected ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {opt.score} pts
                            </span>
                          </div>
                          {isAiRec && (
                            <span
                              className={`text-[10px] uppercase tracking-wider font-semibold mt-1 inline-block ${
                                isSelected ? 'text-amber-300' : 'text-amber-700'
                              }`}
                            >
                              ★ AI Recommended
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Evidence & Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <Quote className="w-3.5 h-3.5 text-slate-500" />
                        <span>Verbatim Evidence Quote</span>
                      </span>
                      {item.evidence?.location && (
                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>{item.evidence.location}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 italic leading-relaxed font-medium">
                      &quot;{item.evidence?.quote || 'Not reported in paper.'}&quot;
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Comment / Remarks
                    </label>
                    <textarea
                      value={item.comment || ''}
                      onChange={(e) => handleUpdateSuitabilityComment(key, e.target.value)}
                      placeholder="Enter rationale or regulatory justification..."
                      rows={2}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                    />
                  </div>
                </div>

                {/* 9-item checklist for Acceptable report/data collation */}
                {item.reportedChecklist && item.reportedChecklist.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <h5 className="text-xs font-bold text-slate-800">
                        Report Collation Elements (9 Core Quality Dimensions)
                      </h5>
                      <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                        Reported {item.reportedChecklist.filter((chk) => chk.reported).length}/9 · Not reported {item.reportedChecklist.filter((chk) => !chk.reported).length}/9
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {item.reportedChecklist.map((chk, chkIdx) => (
                        <div
                          key={chkIdx}
                          className="p-2 rounded bg-slate-50 border border-slate-200 text-xs flex items-center justify-between"
                        >
                          <span className="text-slate-700 font-medium">{chk.item}</span>
                          <span
                            className={`font-semibold text-[11px] px-1.5 py-0.5 rounded ${
                              chk.reported
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {chk.reported ? 'Reported' : 'Not reported'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Relevance Checklist */}
      {activeTab === 'relevance' && (
        <div className="space-y-6">
          <div className="bg-slate-50/90 p-4 rounded-xl border border-slate-200/90 text-xs shadow-2xs">
            <h3 className="font-bold text-slate-900 text-sm">
              Relevance Appraisal (MEDDEV 2.7.1 Rev.4 Section 9.3.2 c&apos;s Table)
            </h3>
            <p className="text-slate-600 mt-0.5">
              Check all applicable dimensions covered by the clinical publication. Provide verbatim citations for all checked aspects.
            </p>
          </div>

          <div className="space-y-6">
            {relevanceItems.map(({ key, item }) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-6 space-y-4"
              >
                <div className="border-b border-slate-100 pb-2">
                  <h4 className="font-bold text-sm text-slate-900">{item.title}</h4>
                  <SelfValidationBadge issues={issuesForTarget(selfValidation, `step3.${item.id}`)} />
                  <p className="text-xs text-slate-500">{item.description}</p>
                </div>

                {/* Option Checkboxes or Custom Gender View */}
                {key === 'itemH_gender' ? (
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-600" />
                        Reported Gender Distribution
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          item.comment &&
                          item.comment !== 'Not reported' &&
                          !item.comment.includes('Male: Not reported, Female: Not reported')
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {item.comment &&
                        item.comment !== 'Not reported' &&
                        !item.comment.includes('Male: Not reported, Female: Not reported')
                          ? 'Reported in Paper'
                          : 'Not Reported'}
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-md border border-slate-200 text-xs font-mono text-slate-900 whitespace-pre-line leading-relaxed">
                      {item.comment || 'Not reported'}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {item.options.map((opt) => {
                      const isChecked = item.userSelectedOptions.includes(opt);
                      const isAiSelected = item.aiSelectedOptions.includes(opt);

                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            handleToggleRelevanceOption(key, opt, item.isMultiSelect !== false)
                          }
                          className={`p-2.5 rounded-lg border text-left text-xs transition-colors flex items-start gap-2.5 cursor-pointer ${
                            isChecked
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-white" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1">
                            <span className="font-medium">{opt}</span>
                            {isAiSelected && (
                              <span
                                className={`block text-[10px] font-semibold mt-0.5 ${
                                  isChecked ? 'text-amber-300' : 'text-amber-700'
                                }`}
                              >
                                ★ AI Recommended
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {key === 'itemI_typeSeverityCondition' && (
                  <div className="text-[11px] text-blue-900 bg-blue-50/80 px-3 py-1.5 rounded-md border border-blue-200/70">
                    <span className="font-semibold">Classification Guide: </span>
                    <span>Direct clinical condition for stent intervention (adverse events/complications excluded). Check severity categories only if explicitly written in the paper.</span>
                  </div>
                )}

                {key === 'itemJ_rangeOfTime' && (() => {
                  const groupNames = (researchGroups || []).map((g) => g.groupName).filter(Boolean);
                  return (
                    <div className="space-y-3">
                      {/* 3 Sub-Items Visual Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-800">1. Application / Use Duration</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-slate-200 text-slate-700">Patency / Indwell time</span>
                          </div>
                          <GroupSegmentedField
                            groupNames={groupNames}
                            text={
                              item.rangeOfTimeDetails?.durationOfApplicationOrUse ||
                              (item.comment.match(/Duration of application or use:\s*([^\n]+)/i)?.[1] ?? undefined)
                            }
                          />
                        </div>

                        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-800">2. Repeat Exposures</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-slate-200 text-slate-700">Reintervention</span>
                          </div>
                          <GroupSegmentedField
                            groupNames={groupNames}
                            text={
                              item.rangeOfTimeDetails?.numberOfRepeatExposures ||
                              (item.comment.match(/Number of repeat exposures:[ \t]*([^\r\n]+)/i)?.[1] ?? undefined)
                            }
                          />
                        </div>
                        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-800">3. Follow-up Duration</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-slate-200 text-slate-700">Follow-up / OS</span>
                          </div>
                          <GroupSegmentedField
                            groupNames={groupNames}
                            text={
                              item.rangeOfTimeDetails?.durationOfFollowUp ||
                              (item.comment.match(/Duration of follow-up:[ \t]*([^\r\n]+)/i)?.[1] ?? undefined)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Evidence & Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">Verbatim Evidence Quote</span>
                      {item.evidence?.location && (
                        <span className="text-[11px] font-mono text-slate-500">
                          {item.evidence.location}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 italic font-medium">
                      &quot;{item.evidence?.quote || 'Not reported'}&quot;
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Comment / Remarks
                    </label>
                    {key === 'itemJ_rangeOfTime' ? (
                      <textarea
                        rows={3}
                        value={item.comment || ''}
                        onChange={(e) => handleUpdateRelevanceComment(key, e.target.value)}
                        placeholder="Duration of application or use: [Group name: ...]\nNumber of repeat exposures: \nDuration of follow-up: [Study-wide: ...]"
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900 leading-relaxed"
                      />
                    ) : (
                      <input
                        type="text"
                        value={item.comment || ''}
                        onChange={(e) => handleUpdateRelevanceComment(key, e.target.value)}
                        placeholder={
                          key === 'itemH_gender'
                            ? 'e.g. Female: 18/42 (42.9%); Male: 24/42 (57.1%)'
                            : 'Specific note or clinical rationale...'
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Methodological Appraisal */}
      {activeTab === 'methodological' && (
        <div className="space-y-6">
          <div className="bg-slate-50/90 p-4 rounded-xl border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-2xs">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Methodological Appraisal (MEDDEV 2.7.1 Rev.4 Appendix 6)
              </h3>
              <p className="text-slate-600 mt-0.5">
                Evaluates study methodology, sample size, controls, adverse events, statistics, and legality. Max score: 12.
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 font-medium">Methodological Grade: </span>
              <span className="font-bold text-sm text-slate-900">{methodological.gradeUser}</span>
              <span className="text-xs text-slate-600 ml-1 font-semibold">
                ({methodological.totalScoreUser} / 12 pts)
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {methodologicalItems.map(({ key, item }, idx) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        Item #{idx + 1}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900">{item.name}</h4>
                      <SelfValidationBadge issues={issuesForTarget(selfValidation, `step3.${item.id}`)} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1 italic font-medium">&quot;{item.question}&quot;</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-slate-900">
                      User Final Score: {item.userFinalScore} / {item.maxScore}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-medium">
                      (AI Rec: {item.aiRecommendedScore})
                    </span>
                  </div>
                </div>

                {/* Sub-elements for Item 1 (Information on elementary aspects) */}
                {key === 'informationElementary' && item.subElements && item.subElements.length > 0 && (
                  <div className="bg-slate-50/70 rounded-lg p-4 border border-slate-200/80 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-200 pb-2">
                      <span className="text-xs font-bold text-slate-800">
                        Elementary Aspects Evaluation (3 Independent Sub-Items):
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        Standard: Adequate (2 pts) if ≥1 reported; Non adequate (1 pt) if all 3 are Not reported
                      </span>
                    </div>

                    {/* Method & Clinical Outcome side-by-side cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {item.subElements
                        .filter((sub) => sub.label !== 'Identification of the device')
                        .map((sub, sIdx) => (
                          <div
                            key={sIdx}
                            className="bg-white p-3.5 rounded-lg border border-slate-200 flex flex-col justify-between space-y-2 shadow-2xs"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-bold text-slate-900">
                                  {sub.label === 'Method' ? '1. Method' : '3. Clinical outcome'}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    sub.reported
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {sub.reported ? 'Reported' : 'Not reported'}
                                </span>
                              </div>
                              <p className="text-xs font-medium text-slate-800">
                                {sub.value || (sub.reported ? 'Reported in text' : 'Not reported')}
                              </p>
                            </div>

                            <div className="pt-2 border-t border-slate-100 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-slate-500">
                                <span className="font-semibold text-[10px]">Evidence</span>
                                {sub.location && (
                                  <span className="font-mono text-[10px] text-slate-500">
                                    {sub.location}
                                  </span>
                                )}
                              </div>
                              <p className="italic text-slate-600 line-clamp-2 font-mono text-[11px]">
                                &quot;{sub.quote || 'Not reported'}&quot;
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Identification of the device: Full Study Groups & Devices Table */}
                    {(() => {
                      const devSub = item.subElements.find((s) => s.label === 'Identification of the device');
                      const deviceEntries = (devSub?.deviceList && devSub.deviceList.length > 0)
                        ? devSub.deviceList
                        : (researchGroups || []).flatMap((g) => (g.devices || []).map((d) => ({
                            studyGroup: g.groupName || 'Study Cohort',
                            deviceUsed: `${d.deviceProductName || 'Not reported'}${d.manufacturer && d.manufacturer !== 'Not reported' ? ` (${d.manufacturer})` : ''}`,
                            patientNumber: d.devicePatientNumber && d.devicePatientNumber !== 'Not separately reported' ? d.devicePatientNumber : g.groupPatientNumber,
                            evidenceQuote: d.evidence?.quote || g.evidence?.quote || d.deviceProductName || 'Direct sentence from paper',
                            evidenceLocation: d.evidence?.location || g.evidence?.location || 'Methods',
                          })));

                      const isDevReported = devSub?.reported !== false && (deviceEntries.length > 0 || devSub?.value !== 'Not reported');

                      return (
                        <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-2.5 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-bold text-slate-900">
                                2. Identification of the device (All Study Groups &amp; Devices)
                              </span>
                              <p className="text-[11px] text-slate-500 font-medium">
                                Sourced from Step 2 Research Group Inventory ({deviceEntries.length} device record{deviceEntries.length === 1 ? '' : 's'})
                              </p>
                            </div>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                isDevReported
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {isDevReported ? 'Reported' : 'Not reported'}
                            </span>
                          </div>

                          {deviceEntries.length > 0 ? (
                            <div className="overflow-x-auto rounded-md border border-slate-200">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 text-[11px]">
                                    <th className="py-2 px-3 w-1/4">Study group</th>
                                    <th className="py-2 px-3 w-1/4">Device used</th>
                                    <th className="py-2 px-3 w-1/3">Evidence</th>
                                    <th className="py-2 px-3 w-1/6">Location</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                  {deviceEntries.map((devEntry, dIdx) => (
                                    <tr key={dIdx} className="hover:bg-slate-50/50">
                                      <td className="py-2.5 px-3 font-semibold text-slate-900 align-top">
                                        {devEntry.studyGroup}
                                        {devEntry.patientNumber && devEntry.patientNumber !== 'Not reported' && (
                                          <span className="block text-[10px] text-slate-500 font-normal mt-0.5">
                                            Patients: {devEntry.patientNumber}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 font-medium text-slate-800 align-top">
                                        {devEntry.deviceUsed}
                                      </td>
                                      <td className="py-2.5 px-3 text-slate-600 italic text-[11px] align-top">
                                        &quot;{devEntry.evidenceQuote}&quot;
                                      </td>
                                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500 align-top whitespace-nowrap">
                                        {devEntry.evidenceLocation}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic p-2 bg-slate-50 rounded">
                              No study groups recorded or device identification is not reported.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Radio Options */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Scoring Selection:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {item.options.map((opt) => {
                      const isSelected = item.userFinalSelection === opt.label;
                      const isAiRec = item.aiRecommendedSelection === opt.label;

                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => handleUpdateMethodologicalItem(key, opt.label, opt.score)}
                          className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className="font-semibold text-xs">{opt.label}</span>
                            <span
                              className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                                isSelected ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {opt.score} pts
                            </span>
                          </div>
                          {isAiRec && (
                            <span
                              className={`text-[10px] uppercase tracking-wider font-semibold mt-1 inline-block ${
                                isSelected ? 'text-amber-300' : 'text-amber-700'
                              }`}
                            >
                              ★ AI Recommended
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Evidence & Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Evidence Quote</span>
                      {item.evidence?.location && (
                        <span className="text-[11px] font-mono text-slate-500">
                          {item.evidence.location}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 italic font-medium whitespace-pre-line">
                      &quot;{item.evidence?.quote || 'Not reported'}&quot;
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Comment / Remarks
                    </label>
                    <textarea
                      value={item.comment || ''}
                      onChange={(e) => handleUpdateMethodologicalComment(key, e.target.value)}
                      placeholder="Enter methodological justification and citations..."
                      rows={2}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: Contribution Criteria */}
      {activeTab === 'contribution' && (
        <div className="space-y-6">
          <div className="bg-slate-50/90 p-4 rounded-xl border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-2xs">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Appraisal Criteria for Data Contribution (IMDRF MDCE WG/N56FINAL:2019 Appendices D1)
              </h3>
              <p className="text-slate-600 mt-0.5">
                Evaluates study design suitability, outcome performance reflection, follow-up duration, and statistical / clinical significance. Max score: 10.
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 font-medium">Contribution Grade: </span>
              <span className="font-bold text-sm text-slate-900">{contribution.gradeUser}</span>
              <span className="text-xs text-slate-600 ml-1 font-semibold">
                ({contribution.totalScoreUser} / 10 pts)
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {contributionItems.map(({ key, item }, idx) => (
              <div
                key={item.id}
                className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        Item #{idx + 1}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900">{item.name}</h4>
                      <SelfValidationBadge issues={issuesForTarget(selfValidation, `step3.${item.id}`)} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1 italic font-medium">&quot;{item.question}&quot;</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-slate-900">
                      User Final Score: {item.userFinalScore} / {item.maxScore}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-medium">
                      (AI Rec: {item.aiRecommendedScore})
                    </span>
                  </div>
                </div>

                {/* Radio Options */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Scoring Selection:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {item.options.map((opt) => {
                      const isSelected = item.userFinalSelection === opt.label;
                      const isAiRec = item.aiRecommendedSelection === opt.label;

                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => handleUpdateContributionItem(key, opt.label, opt.score)}
                          className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className="font-semibold text-xs">{opt.label}</span>
                            <span
                              className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                                isSelected ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {opt.score} pts
                            </span>
                          </div>
                          {isAiRec && (
                            <span
                              className={`text-[10px] uppercase tracking-wider font-semibold mt-1 inline-block ${
                                isSelected ? 'text-amber-300' : 'text-amber-700'
                              }`}
                            >
                              ★ AI Recommended
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Evidence & Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Evidence Quote</span>
                      {item.evidence?.location && (
                        <span className="text-[11px] font-mono text-slate-500">
                          {item.evidence.location}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 italic font-medium whitespace-pre-line">
                      &quot;{item.evidence?.quote || 'Not reported in paper.'}&quot;
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Comment / Remarks
                    </label>
                    <textarea
                      value={item.comment || ''}
                      onChange={(e) => handleUpdateContributionComment(key, e.target.value)}
                      placeholder="Enter contribution justification..."
                      rows={2}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: Overall Synthesis */}
      {activeTab === 'overall' && (
        <div className="space-y-6">
          {/* Prominent Regulatory Result Banner */}
          {overall.overallResult === 'Accepted' ? (
            <div className="p-8 rounded-2xl bg-emerald-50 border-2 border-emerald-500 text-center space-y-2 shadow-2xs">
              <span className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-emerald-200 text-emerald-900 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4" />
                Regulatory Status: Accepted
              </span>
              <h3 className="text-3xl font-black text-emerald-800 tracking-tight">ACCEPTED</h3>
              <p className="text-sm text-emerald-700 max-w-xl mx-auto font-medium">
                The total score ({overall.totalScore} / {overall.maxTotalScore}) meets the regulatory acceptance threshold ({overall.overallGrade}). The clinical data qualifies for clinical evaluation contribution.
              </p>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-rose-50 border-2 border-rose-600 text-center space-y-2 shadow-2xs">
              <span className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-rose-200 text-rose-900 text-xs font-bold uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4" />
                Regulatory Status: Rejected
              </span>
              <h3 className="text-4xl font-black text-rose-700 tracking-tight">REJECTED</h3>
              <p className="text-sm text-rose-700 max-w-xl mx-auto font-medium">
                The overall grade is &quot;{overall.overallGrade}&quot; (Score: {overall.totalScore} / {overall.maxTotalScore}). Pursuant to Appraisal Plan criteria, only &quot;Excellent&quot; and &quot;Very Good&quot; results are Accepted.
              </p>
            </div>
          )}

          {/* Summary Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="bg-slate-50/90 px-6 py-4 border-b border-slate-200">
              <h4 className="text-sm font-bold text-slate-900">
                Overall Appraisal Summary Matrix
              </h4>
              <p className="text-xs text-slate-500">
                Synthesis of Suitability (11), Methodological (12), and Contribution (10) scores.
              </p>
            </div>

            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/80 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-600 font-semibold">
                <tr>
                  <th className="py-3.5 px-6">Appraisal Section</th>
                  <th className="py-3.5 px-4 text-center">User Final Score</th>
                  <th className="py-3.5 px-4 text-center">Maximum Score</th>
                  <th className="py-3.5 px-6 text-right">Section Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white text-slate-800 font-medium">
                <tr className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-6 font-semibold text-slate-900">
                    Suitability Criteria (IMDRF Appendices D1)
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-900">
                    {suitability.totalScoreUser}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-500">11</td>
                  <td className="py-3.5 px-6 text-right font-bold text-slate-900">
                    {suitability.gradeUser}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-6 font-semibold text-slate-900">
                    Methodological Appraisal (MEDDEV 2.7.1 Appendix 6)
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-900">
                    {methodological.totalScoreUser}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-500">12</td>
                  <td className="py-3.5 px-6 text-right font-bold text-slate-900">
                    {methodological.gradeUser}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-6 font-semibold text-slate-900">
                    Contribution Criteria (IMDRF Appendices D1)
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-900">
                    {contribution.totalScoreUser}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-500">10</td>
                  <td className="py-3.5 px-6 text-right font-bold text-slate-900">
                    {contribution.gradeUser}
                  </td>
                </tr>
                {/* Total Row */}
                <tr className="bg-slate-100/90 text-slate-900 font-bold border-t-2 border-slate-300">
                  <td className="py-4 px-6 uppercase tracking-wider text-xs">
                    Total Final Score &amp; Overall Grade
                  </td>
                  <td className="py-4 px-4 text-center font-mono text-sm">
                    {overall.totalScore}
                  </td>
                  <td className="py-4 px-4 text-center font-mono text-sm text-slate-600">
                    33
                  </td>
                  <td className="py-4 px-6 text-right text-sm font-black">
                    {overall.overallGrade}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Grade Threshold Reference Card */}
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs text-slate-700 shadow-2xs">
            <h5 className="font-bold text-slate-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-600" />
              <span>Official Regulatory Grade Thresholds (Appraisal Plan Standard)</span>
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-[11px]">
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block font-sans text-xs">
                  Suitability (Max 11)
                </span>
                <p>10 - 11: Excellent</p>
                <p>8 - 9: Very Good</p>
                <p>6 - 7: Good</p>
                <p>3 - 5: Poor</p>
              </div>
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block font-sans text-xs">
                  Methodological (Max 12)
                </span>
                <p>10 - 12: Excellent</p>
                <p>8 - 9: Very Good</p>
                <p>6 - 7: Good</p>
                <p>4 - 5: Poor</p>
              </div>
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block font-sans text-xs">
                  Contribution (Max 10)
                </span>
                <p>10: Excellent</p>
                <p>8 - 9: Very Good</p>
                <p>6 - 7: Good</p>
                <p>5: Poor</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 italic mt-2 font-medium">
              Overall Total (Max 33): 31-33 Excellent &bull; 26-30 Very Good &bull; 20-25 Good &bull; 12-19 Poor. Accepted only if Excellent or Very Good.
            </p>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg text-sm font-semibold transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Step 2</span>
        </button>

        <div ref={downloadMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsDownloadMenuOpen((open) => !open)}
            disabled={isExporting || isBatchExporting}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors shadow-2xs cursor-pointer"
            aria-haspopup="menu"
            aria-expanded={isDownloadMenuOpen}
          >
            <Download className="w-4 h-4" />
            <span>
              {isExporting || isBatchExporting
                ? 'Generating...'
                : 'Download Word (.docx) Report'}
            </span>
            <ChevronDown className="w-4 h-4" />
          </button>

          {isDownloadMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 bottom-full mb-2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 z-30"
            >
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setIsDownloadMenuOpen(false);
                  await handleExportDocx();
                }}
                className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="block text-sm font-semibold text-slate-900">
                  Current article only
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Download the appraisal report for the article currently open.
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!onExportAll || completedArticleCount < 1}
                onClick={async () => {
                  setIsDownloadMenuOpen(false);
                  await handleExportAllDocx();
                }}
                className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <span className="block text-sm font-semibold text-slate-900">
                  All completed articles ({completedArticleCount})
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Combine all completed article appraisals into one Word file.
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
