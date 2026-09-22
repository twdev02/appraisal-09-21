import type { MethodologicalAppraisalState, ContributionAppraisalState } from '../../src/types';
import {
  parseRangeOfTimeData,
  determineAspectsCovered,
  formatGenderDistribution,
} from '../../src/utils/nlpRules';
import {
  DEFAULT_SUITABILITY_CRITERIA,
  DEFAULT_RELEVANCE_ITEMS,
  DEFAULT_METHODOLOGICAL_CRITERIA,
  DEFAULT_CONTRIBUTION_CRITERIA,
  calculateSuitabilityGrade,
  calculateMethodologicalGrade,
  calculateContributionGrade,
} from '../../src/data/appraisalStandards';
import { detectStatisticalEvidence } from './statisticalEvidence';
import { hasReportedObservationDuration, scoreReportCollation } from './reportCollation';
import { hasExplicitProductName, elementaryAspectsAdequate } from './elementaryAspects';
import { evaluateAdequateControls } from './adequateControls';
import { evaluateDataSourceType } from './dataSourceType';
import { isDeviceOutcomeExtractable } from './deviceOutcomeAttribution';
import { validateGenderEvidence } from './markdownEvidence';
import {
  reconcileStatisticalEvidence,
  reconcileClinicalOutcomeEvidence,
} from './markdownAppraisalEvidence';
import type { PreparedAnalysisContext } from './prepareAnalysisContext';

export interface AppraisalScoringResult {
  suitability: any;
  relevance: any;
  methodological: MethodologicalAppraisalState;
  contribution: ContributionAppraisalState;
  genderValidation: any;
  statisticalValidation: any;
  clinicalOutcomeValidation: any;
}

/** Stage 3: Step 3 suitability/relevance/methodological/contribution scoring. */
export function buildAppraisalScoring(ctx: PreparedAnalysisContext): AppraisalScoringResult {
  const {
    paperText,
    markdownText,
    markdownDemographics,
    markdownAppraisalEvidence,
    dueList,
    due,
    parsedAi,
    articleMetadata,
    patientCountValidation,
    followUpValidation,
    useMarkdownFollowUp,
    isMissingExtractedValue,
    researchGroups,
    primaryResearchGroup,
  } = ctx;
  const suitabilityComments = parsedAi?.suitabilityComments || {};
  const allDevices = researchGroups.flatMap((g: any) =>
    (g.devices || []).map((d: any) => ({ ...d, __groupDeviceCount: (g.devices || []).length }))
  );
  // Require outcome attribution evidence, independently of device counts or names.

  const dueDevices = allDevices.filter((d: any) => d.deviceRelationship.aiRecommended === 'DUE');
  const extractableDueDevices = dueDevices.filter(isDeviceOutcomeExtractable);
  const pooledOnlyDueDevices = dueDevices.filter((d: any) => !isDeviceOutcomeExtractable(d));
  const simDevices = allDevices.filter((d: any) => d.deviceRelationship.aiRecommended === 'Similar Device');
  const extractableSimDevices = simDevices.filter(isDeviceOutcomeExtractable);

  const topDueDevice = extractableDueDevices[0] || dueDevices[0] || allDevices[0];
  const topSameIndDevice = allDevices.find((d: any) => d.indicationRelationship.aiRecommended === 'Same indication') || allDevices[0];

  const anyDueDevice = extractableDueDevices.length > 0;
  const anySimDevice = extractableSimDevices.length > 0;
  const matchedDueNames = Array.from(new Set(
    extractableDueDevices
      .flatMap((d: any) => {
        const direct = d.matchedDueName ? [d.matchedDueName] : [];
        return direct;
      })
      .filter(Boolean)
  ));
  const matchedDueDisplay = matchedDueNames.length > 0 ? matchedDueNames.join(' / ') : undefined;

  const deviceSelection = anyDueDevice
    ? 'Device under evaluation'
    : anySimDevice
    ? 'Equivalent device or Benchmark/Similar device'
    : 'Other devices and medical alternatives';
  const deviceScore = anyDueDevice ? 2 : anySimDevice ? 1 : 0;
  const creditedDevice = extractableDueDevices[0] || extractableSimDevices[0];

  const anySameIndication = allDevices.some(
    (d: any) => d.indicationRelationship.aiRecommended === 'Same indication'
  );
  const anyRelatedIndication = allDevices.some(
    (d: any) => d.indicationRelationship.aiRecommended === 'Related indication'
  );
  const appSelection = anySameIndication
    ? 'Same use'
    : anyRelatedIndication
    ? 'Minor deviation'
    : 'Major deviation';
  const appScore = anySameIndication ? 3 : anyRelatedIndication ? 2 : 1;

  // Suitability Criterion #4 is scored from 9 independent report/data-collation
  // dimensions. It no longer drops from 3 -> 2 solely because statistical
  // methods are absent. For THIS criterion, statistical software alone counts
  // as Reported; follow-up/observation requires an explicit numeric duration and unit.
  const reportDimsRaw = suitabilityComments.reportCollationDimensions || {};
  const currentStudyText = (() => {
    const source = String(paperText || '');
    return source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
  })();
  // One shared statistical-evidence state is used by Suitability, Methodological,
  // and Contribution. Deterministic text detection is OR-ed with the AI result
  // so explicit software/methods cannot be missed by one appraisal section.
  const pdfStatisticalEvidence = detectStatisticalEvidence(currentStudyText, suitabilityComments);
  const { evidence: statisticalEvidence, validation: statisticalValidation } = reconcileStatisticalEvidence(
    pdfStatisticalEvidence,
    markdownAppraisalEvidence.statistical,
    Boolean(markdownText.trim())
  );
  const hasStats = statisticalEvidence.reported;

  // Markdown clinical outcomes are an auxiliary, source-faithful evidence layer.
  // Only quantitative current-study Results evidence or confident pre-Discussion
  // table rows are eligible. Discussion/reference comparator outcomes are excluded.
  const clinicalOutcomeValidation = reconcileClinicalOutcomeEvidence(
    [
      parsedAi?.methodologicalExtracts?.clinicalOutcomeValue,
      parsedAi?.methodologicalExtracts?.clinicalOutcomeQuote,
      parsedAi?.contributionExtracts?.outcomeMeasuresQuote,
      parsedAi?.contributionExtracts?.clinicalSignificanceQuote,
    ],
    markdownAppraisalEvidence.clinicalOutcomes,
    Boolean(markdownText.trim())
  );
  const useMarkdownClinicalOutcome = Boolean(
    markdownAppraisalEvidence.clinicalOutcomes &&
    ['validated', 'supplemented', 'md_only'].includes(clinicalOutcomeValidation.status)
  );
  const isMeaningfulReportedText = (value: any) => {
    const t = String(value ?? '').trim();
    return Boolean(t) && !/^(not reported|not assessable|unknown|n\/?a)$/i.test(t);
  };
  const sentenceAround = (regex: RegExp): string => {
    const text = currentStudyText.replace(/\s+/g, ' ').trim();
    const match = regex.exec(text);
    if (!match || match.index == null) return 'Not reported';
    const idx = match.index;
    const left = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
    const nextDot = text.indexOf('.', idx + match[0].length);
    const right = nextDot >= 0 ? Math.min(text.length, nextDot + 1) : Math.min(text.length, idx + 300);
    return text.slice(left, right).trim().slice(0, 500) || 'Not reported';
  };
  const normalizeReportDimension = (
    key: string,
    item: string,
    fallbackReported: boolean,
    fallbackQuote: string,
    fallbackLocation: string
  ) => {
    const raw = reportDimsRaw?.[key] || {};
    const hasExplicitReported = typeof raw.reported === 'boolean';
    const reported = hasExplicitReported ? raw.reported : fallbackReported;
    const evidenceQuote = reported
      ? (isMeaningfulReportedText(raw.evidenceQuote) ? String(raw.evidenceQuote) : fallbackQuote)
      : 'Not reported';
    const location = reported
      ? (isMeaningfulReportedText(raw.evidenceLocation) ? String(raw.evidenceLocation) : fallbackLocation)
      : 'Not reported';
    return { item, reported, evidenceQuote, location };
  };

  const studyObjectiveQuote = sentenceAround(/\b(?:objective|aim|purpose)\b|\bwe\s+(?:aimed|sought|evaluated|investigated|assessed)\b/i);
  const studyDesignQuote = sentenceAround(/\b(?:prospective|retrospective|randomi[sz]ed|observational|cohort|case\s+series|case\s+report|multicenter|multi-center|single-center|single\s+center)\b/i);
  const patientPopulationQuote = sentenceAround(/\b(?:patients?|subjects?|participants?)\b.{0,100}\b(?:enrolled|included|treated|underwent|with)\b/i);
  const deviceEvidenceQuote = allDevices.find((d: any) => isMeaningfulReportedText(d?.evidence?.quote))?.evidence?.quote || 'Not reported';
  const outcomeEvidenceQuote = useMarkdownClinicalOutcome && markdownAppraisalEvidence.clinicalOutcomes
    ? markdownAppraisalEvidence.clinicalOutcomes.quote
    : (parsedAi?.contributionExtracts?.outcomeMeasuresQuote || parsedAi?.methodologicalExtracts?.clinicalOutcomeQuote || 'Not reported');
  const outcomeEvidenceLocation = useMarkdownClinicalOutcome && markdownAppraisalEvidence.clinicalOutcomes
    ? markdownAppraisalEvidence.clinicalOutcomes.location
    : (parsedAi?.contributionExtracts?.outcomeMeasuresLocation || parsedAi?.methodologicalExtracts?.clinicalOutcomeLocation || 'Methods / Results');
  const followUpEvidence = [
    { quote: reportDimsRaw.followUpObservation?.evidenceQuote, location: reportDimsRaw.followUpObservation?.evidenceLocation },
    { quote: followUpValidation?.evidenceQuote, location: followUpValidation?.evidenceLocation },
    { quote: parsedAi?.contributionExtracts?.followUpQuote, location: parsedAi?.contributionExtracts?.followUpLocation },
    ...currentStudyText.split(/(?<=[.!?])\s+|\n/).map(quote => ({ quote, location: 'Methods / Results' })),
  ].find(candidate => hasReportedObservationDuration(candidate.quote));
  const resultsEvidenceQuote = isMeaningfulReportedText(parsedAi?.contributionExtracts?.outcomeMeasuresQuote)
    ? parsedAi.contributionExtracts.outcomeMeasuresQuote
    : sentenceAround(/\bresults?\b/i);
  const safetyExtractForCriterion = parsedAi?.safetyEventsExtract || {};
  const firstSafetyQuote = (safetyExtractForCriterion.events || []).find((e: any) => isMeaningfulReportedText(e?.evidenceQuote))?.evidenceQuote
    || safetyExtractForCriterion.overallMortalityEvidenceQuote
    || sentenceAround(/\b(?:adverse\s+events?|complications?|safety|no\s+complications?|no\s+adverse\s+events?)\b/i);
  const reportChecklist = [
    normalizeReportDimension(
      'studyObjective',
      'Study objective',
      isMeaningfulReportedText(studyObjectiveQuote),
      studyObjectiveQuote,
      isMeaningfulReportedText(studyObjectiveQuote) ? 'Abstract / Introduction' : 'Not reported'
    ),
    normalizeReportDimension(
      'studyDesign',
      'Study design',
      isMeaningfulReportedText(articleMetadata.studyDesign) || isMeaningfulReportedText(studyDesignQuote),
      isMeaningfulReportedText(studyDesignQuote) ? studyDesignQuote : String(articleMetadata.studyDesign || 'Not reported'),
      'Methods'
    ),
    normalizeReportDimension(
      'patientPopulation',
      'Patient population',
      isMeaningfulReportedText(articleMetadata.totalPatientCount) || isMeaningfulReportedText(patientPopulationQuote),
      patientPopulationQuote,
      'Methods / Results'
    ),
    normalizeReportDimension(
      'deviceProcedureDescription',
      'Device or procedure description',
      isMeaningfulReportedText(deviceEvidenceQuote) || allDevices.some((d: any) => isMeaningfulReportedText(d?.deviceProductName)),
      isMeaningfulReportedText(deviceEvidenceQuote) ? deviceEvidenceQuote : String(primaryResearchGroup?.devices?.[0]?.deviceProductName || 'Not reported'),
      'Methods / Device description'
    ),
    normalizeReportDimension(
      'outcomesEndpoints',
      'Outcomes or endpoints',
      isMeaningfulReportedText(outcomeEvidenceQuote),
      String(outcomeEvidenceQuote || 'Not reported'),
      outcomeEvidenceLocation
    ),
    {
      item: 'Follow-up or observation',
      reported: Boolean(followUpEvidence),
      evidenceQuote: followUpEvidence ? String(followUpEvidence.quote) : 'Not reported',
      location: followUpEvidence ? String(followUpEvidence.location || 'Methods / Results') : 'Not reported',
    },
    normalizeReportDimension(
      'results',
      'Results',
      isMeaningfulReportedText(resultsEvidenceQuote),
      String(resultsEvidenceQuote || 'Not reported'),
      parsedAi?.contributionExtracts?.outcomeMeasuresLocation || 'Results'
    ),
    normalizeReportDimension(
      'adverseEventsSafety',
      'Adverse events / safety',
      safetyExtractForCriterion.status === 'Events reported' || safetyExtractForCriterion.status === 'No event reported' || isMeaningfulReportedText(firstSafetyQuote),
      String(firstSafetyQuote || 'Not reported'),
      (safetyExtractForCriterion.events || [])[0]?.evidenceLocation || 'Results / Safety'
    ),
    {
      item: 'Statistical methods / software',
      reported: statisticalEvidence.reported,
      evidenceQuote: statisticalEvidence.evidenceQuote,
      location: statisticalEvidence.evidenceLocation,
    },
  ];

  const reportMissingCount = reportChecklist.filter((d: any) => !d.reported).length;
  const reportReportedCount = reportChecklist.length - reportMissingCount;
  const { selection: reportSelection, score: reportScore } = scoreReportCollation(reportMissingCount);
  const missingDimensionNames = reportChecklist.filter((d: any) => !d.reported).map((d: any) => d.item);
  const reportEvidenceItem = reportChecklist.find((d: any) => d.reported && isMeaningfulReportedText(d.evidenceQuote));

  const deviceComment = pooledOnlyDueDevices.length > 0 && extractableDueDevices.length === 0
    ? `DUE use identified (${pooledOnlyDueDevices.map((d: any) => d.deviceProductName).join(', ')}), but product-specific outcome extractability is not established. Device usage counts and pooled group outcomes do not qualify. Scored as "${deviceSelection}" (${deviceScore}).`
    : creditedDevice
    ? `Product-specific outcome attribution verified (${creditedDevice.outcomeAttribution.basis}): ${creditedDevice.outcomeAttribution.outcome}. Product identity alone does not earn credit.`
    : 'No qualifying product-specific outcome evidence. Device identity or usage alone does not earn credit.';

  const appComment = topSameIndDevice?.indicationRelationship?.rationale
    ? topSameIndDevice.indicationRelationship.rationale
    : `Application evaluated against DUE indications: ${due.indications.join('; ')}`;

  const suitability = {
    appropriateDevice: {
      ...DEFAULT_SUITABILITY_CRITERIA.appropriateDevice,
      aiRecommendedSelection: deviceSelection,
      aiRecommendedScore: deviceScore,
      userFinalSelection: deviceSelection,
      userFinalScore: deviceScore,
      matchedDueProductName: anyDueDevice ? (matchedDueDisplay || topDueDevice?.matchedDueName || due.productName) : undefined,
      evidence: {
        quote: creditedDevice ? `${creditedDevice.outcomeAttribution.outcomeQuote}\n${creditedDevice.outcomeAttribution.attributionQuote}` : 'Product-specific outcome evidence not established.',
        location: creditedDevice ? `${creditedDevice.outcomeAttribution.outcomeLocation}; ${creditedDevice.outcomeAttribution.attributionLocation}` : 'Not reported',
      },
      comment: deviceComment,
      status: (anyDueDevice || anySimDevice ? 'Reported' : 'Not reported') as any,
    },
    appropriateDeviceApplication: {
      ...DEFAULT_SUITABILITY_CRITERIA.appropriateDeviceApplication,
      aiRecommendedSelection: appSelection,
      aiRecommendedScore: appScore,
      userFinalSelection: appSelection,
      userFinalScore: appScore,
      matchedDueIndication: topSameIndDevice?.indicationRelationship?.matchedDueIndication || (anySameIndication ? due.indications[0] : undefined),
      matchedDueProductName: anyDueDevice ? (matchedDueDisplay || topDueDevice?.matchedDueName || due.productName) : undefined,
      evidence: {
        quote: topSameIndDevice?.evidence?.quote || suitabilityComments.appropriateApplicationQuote || 'Indication and procedure description in text',
        location: topSameIndDevice?.evidence?.location || suitabilityComments.appropriateApplicationLocation || 'Abstract & Methods',
      },
      comment: appComment,
      status: 'Reported' as any,
    },
    appropriatePatientGroup: {
      ...DEFAULT_SUITABILITY_CRITERIA.appropriatePatientGroup,
      aiRecommendedSelection: suitabilityComments.appropriatePatientGroupSelection || 'Applicable',
      aiRecommendedScore: 3,
      userFinalSelection: suitabilityComments.appropriatePatientGroupSelection || 'Applicable',
      userFinalScore: 3,
      evidence: {
        quote: suitabilityComments.appropriatePatientGroupQuote || (articleMetadata.totalPatientCount ? `Total ${articleMetadata.totalPatientCount} patients enrolled.` : 'Patient population description'),
        location: suitabilityComments.appropriatePatientGroupLocation || 'Methods, Section 2.1',
      },
      comment: suitabilityComments.appropriatePatientGroupComment || `Evaluated target condition(s) across selected DUEs: ${Array.from(new Set(dueList.flatMap((d: any) => d.indications || []))).join(', ')}.`,
      status: 'Reported' as any,
    },
    acceptableReportDataCollation: {
      ...DEFAULT_SUITABILITY_CRITERIA.acceptableReportDataCollation,
      aiRecommendedSelection: reportSelection,
      aiRecommendedScore: reportScore,
      userFinalSelection: reportSelection,
      userFinalScore: reportScore,
      evidence: {
        quote: reportEvidenceItem?.evidenceQuote || 'Not reported',
        location: reportEvidenceItem?.location || 'Not reported',
      },
      comment: `Core quality dimensions reported: ${reportReportedCount}/9; Not reported: ${reportMissingCount}/9${missingDimensionNames.length > 0 ? ` (${missingDimensionNames.join(', ')})` : ''}. Score rule: 0 missing = High quality (3), 1–2 missing = Minor deficiencies (2), 3–9 missing = Insufficient information (1). Follow-up or observation requires an explicit numeric duration and unit.`,
      status: (reportReportedCount > 0 ? 'Reported' : 'Not reported') as any,
      reportedChecklist: reportChecklist,
    },
    totalScoreAi: deviceScore + appScore + 3 + reportScore,
    totalScoreUser: deviceScore + appScore + 3 + reportScore,
    gradeAi: calculateSuitabilityGrade(deviceScore + appScore + 3 + reportScore),
    gradeUser: calculateSuitabilityGrade(deviceScore + appScore + 3 + reportScore),
  };

  // Relevance Appraisal state according to MEDDEV 2.7.1 Rev.4 Section 9.3.2 c table
  const relExt = parsedAi?.relevanceExtracts || {};

  // 1. What aspects are covered? (Synthesize all extracted outcomes & evidence)
  const calculatedAspects = determineAspectsCovered(
    relExt.aspectsCovered,
    relExt.aspectsQuote,
    relExt.aspectsComment,
    researchGroups,
    parsedAi?.methodologicalExtracts,
    parsedAi?.contributionExtracts,
    parsedAi?.safetyExtracts || parsedAi?.safetyEventsExtract || {},
    paperText
  );

  // 2. Model, size, or setting of the device? (Always include Etc. as base)
  const modelSizeOptions = ['Etc.'];
  const modelSizeContext = [
    relExt.modelSizeQuote || '',
    relExt.modelSizeComment || '',
    researchGroups.map((g: any) => g.devices.map((d: any) => `${d.diameter} ${d.length}`).join(' ')).join(' '),
  ].join(' ').toLowerCase();
  if (modelSizeContext.includes('smallest') || modelSizeContext.includes('largest') || modelSizeContext.includes('size comparison') || modelSizeContext.includes('diameter comparison')) {
    modelSizeOptions.unshift('Smallest / intermediate / largest size');
  }
  if (modelSizeContext.includes('dose')) {
    modelSizeOptions.unshift('Lowest / intermediate / highest dose');
  }

  // 3. Gender? (Numeric distribution)
  const pdfParsedGender = formatGenderDistribution(
    relExt.genderComment,
    relExt.genderQuote,
    researchGroups,
    paperText
  );
  const genderValidation = validateGenderEvidence(
    pdfParsedGender.formattedDistribution,
    markdownDemographics.gender
  );
  const useMarkdownGender = Boolean(
    markdownDemographics.gender &&
    ['validated', 'md_only', 'conflict'].includes(genderValidation.status)
  );
  const parsedGender = useMarkdownGender && markdownDemographics.gender
    ? {
        formattedDistribution: markdownDemographics.gender.formattedDistribution,
        isReported: true,
        quote: markdownDemographics.gender.quote,
        location: markdownDemographics.gender.location,
      }
    : pdfParsedGender;
  const genderDistributionText = String(parsedGender.formattedDistribution || '');
  const genderSelectedOptions = parsedGender.isReported
    ? [
        ...(/(?:^|[—,;\n]\s*)Female:\s*n\s*=\s*\d+/i.test(genderDistributionText) ? ['Female'] : []),
        ...(/(?:^|[—,;\n]\s*)Male:\s*n\s*=\s*\d+/i.test(genderDistributionText) ? ['Male'] : []),
      ]
    : [];

  const relevance = {
    itemA_representativeness: {
      ...DEFAULT_RELEVANCE_ITEMS.itemA_representativeness,
      aiSelectedOptions: anyDueDevice ? ['Device under evaluation'] : anySimDevice ? ['Benchmark/Similar device'] : ['Other devices and medical alternatives'],
      userSelectedOptions: anyDueDevice ? ['Device under evaluation'] : anySimDevice ? ['Benchmark/Similar device'] : ['Other devices and medical alternatives'],
      evidence: {
        quote: suitability.appropriateDevice.evidence.quote,
        location: suitability.appropriateDevice.evidence.location,
      },
      comment: suitability.appropriateDevice.comment,
      status: 'Reported' as any,
    },
    itemB_aspectsCovered: {
      ...DEFAULT_RELEVANCE_ITEMS.itemB_aspectsCovered,
      aiSelectedOptions: calculatedAspects,
      userSelectedOptions: calculatedAspects,
      evidence: {
        quote: relExt.aspectsQuote || 'Efficacy, technical success, and complications reported in results',
        location: relExt.aspectsLocation || 'Results section',
      },
      comment: relExt.aspectsComment || 'Evaluates primary technical success, clinical performance, and complication safety profile.',
      status: 'Reported' as any,
    },
    itemC_intendedPurposeClaims: {
      ...DEFAULT_RELEVANCE_ITEMS.itemC_intendedPurposeClaims,
      aiSelectedOptions: ['Representative of the entire intended purpose with all patient populations and all claims foreseen for the device under evaluation'],
      userSelectedOptions: ['Representative of the entire intended purpose with all patient populations and all claims foreseen for the device under evaluation'],
      evidence: {
        quote: articleMetadata.title,
        location: 'Title / Abstract',
      },
      comment: `Pertains directly to intended indication: ${due.indications.join(', ')}`,
      status: 'Reported' as any,
    },
    itemD_modelSizeSetting: {
      ...DEFAULT_RELEVANCE_ITEMS.itemD_modelSizeSetting,
      aiSelectedOptions: modelSizeOptions,
      userSelectedOptions: modelSizeOptions,
      evidence: {
        quote: relExt.modelSizeQuote || researchGroups.map((g: any) => g.devices.map((d: any) => `Diameter: ${d.diameter}, Length: ${d.length}`).join('; ')).join(' | ') || 'Model specifications reported in text',
        location: relExt.modelSizeLocation || 'Methods, Section 2.2',
      },
      comment: relExt.modelSizeComment || `Diameter: ${primaryResearchGroup?.devices[0]?.diameter || 'Not reported'}; Length: ${primaryResearchGroup?.devices[0]?.length || 'Not reported'}`,
      status: 'Reported' as any,
    },
    itemE_userGroup: {
      ...DEFAULT_RELEVANCE_ITEMS.itemE_userGroup,
      aiSelectedOptions: ['Specialists'],
      userSelectedOptions: ['Specialists'],
      evidence: {
        quote: relExt.userGroupQuote || 'Performed by experienced medical specialists / endoscopists',
        location: relExt.userGroupLocation || 'Methods section',
      },
      comment: relExt.userGroupComment || 'Clinical specialists / interventional endoscopists.',
      status: 'Reported' as any,
    },
    itemF_medicalIndication: {
      ...DEFAULT_RELEVANCE_ITEMS.itemF_medicalIndication,
      aiSelectedOptions: ['Etc.'],
      userSelectedOptions: ['Etc.'],
      evidence: {
        quote: relExt.indicationQuote || due.indications[0] || 'Medical indication stated in text',
        location: relExt.indicationLocation || 'Abstract & Methods',
      },
      comment: relExt.indicationComment || `Documented indication: ${researchGroups.map((g: any) => g.devices.map((d: any) => d.deviceIndication).join(', ')).join('; ')}`,
      status: 'Reported' as any,
    },
    itemG_ageGroup: {
      ...DEFAULT_RELEVANCE_ITEMS.itemG_ageGroup,
      aiSelectedOptions: ['adults', 'old age'],
      userSelectedOptions: ['adults', 'old age'],
      evidence: {
        quote: relExt.ageGroupQuote || 'Adult patients enrolled in study',
        location: relExt.ageGroupLocation || 'Patient characteristics / Table 1',
      },
      comment: relExt.ageGroupComment || 'Adult and elderly cohort.',
      status: 'Reported' as any,
    },
    itemH_gender: {
      ...DEFAULT_RELEVANCE_ITEMS.itemH_gender,
      aiSelectedOptions: genderSelectedOptions,
      userSelectedOptions: genderSelectedOptions,
      evidence: {
        quote: parsedGender.isReported ? parsedGender.quote : 'Not reported',
        location: parsedGender.isReported ? (useMarkdownGender ? parsedGender.location : (relExt.genderLocation || parsedGender.location)) : 'Not reported',
      },
      comment: parsedGender.isReported
        ? `${parsedGender.formattedDistribution}${markdownText ? `
  MD cross-check: ${genderValidation.status}. ${genderValidation.note}` : ''}`
        : 'Not reported',
      status: (parsedGender.isReported ? 'Reported' : 'Not reported') as any,
    },
    itemI_typeSeverityCondition: {
      ...DEFAULT_RELEVANCE_ITEMS.itemI_typeSeverityCondition,
      aiSelectedOptions: relExt.severitySelectedOptions && relExt.severitySelectedOptions.length > 0 ? relExt.severitySelectedOptions : ['Etc.'],
      userSelectedOptions: relExt.severitySelectedOptions && relExt.severitySelectedOptions.length > 0 ? relExt.severitySelectedOptions : ['Etc.'],
      evidence: {
        quote: relExt.severityQuote || 'Not reported',
        location: relExt.severityLocation || 'Not reported',
      },
      comment: relExt.severityComment || `Direct clinical indication: ${primaryResearchGroup?.devices[0]?.deviceIndication || due.indications[0]}`,
      status: (relExt.severityQuote && relExt.severityQuote !== 'Not reported' ? 'Reported' : 'Not reported') as any,
    },
    itemJ_rangeOfTime: (() => {
      const parsedRangeOfTime = parseRangeOfTimeData(paperText, researchGroups, {
        durationOfApplicationOrUse: relExt.durationOfApplicationOrUse,
        durationOfApplicationOrUseQuote: relExt.durationOfApplicationOrUseQuote,
        durationOfApplicationOrUseLocation: relExt.durationOfApplicationOrUseLocation,
        durationOfFollowUp: relExt.durationOfFollowUp,
        durationOfFollowUpQuote: relExt.durationOfFollowUpQuote,
        durationOfFollowUpLocation: relExt.durationOfFollowUpLocation,
        isFollowUpProxySurvival: relExt.isFollowUpProxySurvival,
        survivalSecondaryInfo: relExt.survivalSecondaryInfo,
        rangeOfTimeQuote: relExt.rangeOfTimeQuote,
        rangeOfTimeLocation: relExt.rangeOfTimeLocation,
        rangeOfTimeComment: relExt.rangeOfTimeComment,
      });

      if (useMarkdownFollowUp && markdownDemographics.followUp) {
        const selectedOptions = Array.from(new Set([
          ...parsedRangeOfTime.selectedOptions,
          'Duration of follow-up',
        ]));
        const existingQuote = parsedRangeOfTime.evidenceQuote && parsedRangeOfTime.evidenceQuote !== 'Not reported'
          ? parsedRangeOfTime.evidenceQuote
          : '';
        const existingLocation = parsedRangeOfTime.evidenceLocation && parsedRangeOfTime.evidenceLocation !== 'Not reported'
          ? parsedRangeOfTime.evidenceLocation
          : '';
        return {
          ...DEFAULT_RELEVANCE_ITEMS.itemJ_rangeOfTime,
          aiSelectedOptions: selectedOptions,
          userSelectedOptions: selectedOptions,
          evidence: {
            quote: [existingQuote, `Follow-up: ${markdownDemographics.followUp.quote}`].filter(Boolean).join('\n'),
            location: [existingLocation, markdownDemographics.followUp.location].filter(Boolean).join(', '),
          },
          comment: `${parsedRangeOfTime.comment}\nFollow-up MD cross-check: ${followUpValidation.status}. ${followUpValidation.note}`,
          rangeOfTimeDetails: {
            ...parsedRangeOfTime.rangeOfTimeDetails,
            durationOfFollowUp: markdownDemographics.followUp.formattedDuration,
            isFollowUpProxySurvival: false,
          },
          status: 'Reported' as any,
        };
      }

      return {
        ...DEFAULT_RELEVANCE_ITEMS.itemJ_rangeOfTime,
        aiSelectedOptions: parsedRangeOfTime.selectedOptions,
        userSelectedOptions: parsedRangeOfTime.selectedOptions,
        evidence: {
          quote: parsedRangeOfTime.evidenceQuote,
          location: parsedRangeOfTime.evidenceLocation,
        },
        comment: parsedRangeOfTime.comment,
        rangeOfTimeDetails: parsedRangeOfTime.rangeOfTimeDetails,
        status: (parsedRangeOfTime.selectedOptions.length > 0 ? 'Reported' : 'Not reported') as any,
      };
    })(),
  };

  // 3. Methodological Appraisal State
  const methodExt = parsedAi?.methodologicalExtracts || {};
  const rawPatientText = String(articleMetadata.totalPatientCount || '').trim();
  const rawPatientNum = parseInt(rawPatientText.replace(/\D/g, ''), 10);
  const patientReported = !isMissingExtractedValue(rawPatientText) && !isNaN(rawPatientNum);
  const patientCount = patientReported ? rawPatientNum : null;
  const patientSelection = patientReported && patientCount !== null && patientCount >= 30
    ? 'High(30-) (2)'
    : patientReported && patientCount !== null && patientCount >= 11
      ? 'Medium(11-29) (1)'
      : 'Poor(1-10) (0)';
  const patientScore = patientReported && patientCount !== null
    ? (patientCount >= 30 ? 2 : patientCount >= 11 ? 1 : 0)
    : 0;

  // Build groupDeviceList from all study groups and devices as source of truth
  const groupDeviceList = researchGroups.flatMap((g: any) =>
    (g.devices || []).map((d: any) => ({
      studyGroup: g.groupName || 'Study Cohort',
      deviceUsed: `${d.deviceProductName || 'Not reported'}${d.manufacturer && d.manufacturer !== 'Not reported' ? ` (${d.manufacturer})` : ''}`,
      patientNumber: d.devicePatientNumber && d.devicePatientNumber !== 'Not separately reported' ? d.devicePatientNumber : g.groupPatientNumber,
      evidenceQuote: d.evidence?.quote || g.evidence?.quote || d.deviceProductName || 'Direct sentence from paper',
      evidenceLocation: d.evidence?.location || g.evidence?.location || 'Methods',
    }))
  );

  // Elementary aspects 3 sub-elements
  const methodVal = methodExt.methodValue || articleMetadata.studyDesign || 'Not reported';
  const methodQuote = methodExt.methodQuote || articleMetadata.studyDesign || 'Study design documented in methods';
  const methodLoc = methodExt.methodLocation || 'Methods';
  const methodReported = methodExt.methodReported !== false && methodVal !== 'Not reported';

  const devSummaryVal = groupDeviceList.length > 0
    ? groupDeviceList.map((x: any) => `${x.studyGroup}: ${x.deviceUsed}`).join('; ')
    : (methodExt.deviceIdentificationValue || primaryResearchGroup?.devices[0]?.deviceProductName || due.productName);
  const devSummaryQuote = groupDeviceList.length > 0
    ? groupDeviceList.map((x: any) => `${x.studyGroup} [${x.deviceUsed}]: "${x.evidenceQuote}"`).join('\n')
    : (methodExt.deviceIdentificationQuote || primaryResearchGroup?.devices[0]?.deviceProductName || due.productName);
  const devSummaryLoc = groupDeviceList.length > 0
    ? Array.from(new Set(groupDeviceList.map((x: any) => x.evidenceLocation).filter(Boolean))).join(', ')
    : (methodExt.deviceIdentificationLocation || 'Methods');
  const devReported = hasExplicitProductName(methodExt);

  const aiMethOutcomeVal = isMissingExtractedValue(methodExt.clinicalOutcomeValue)
    ? 'Not reported'
    : String(methodExt.clinicalOutcomeValue).trim();
  const aiMethOutcomeQuote = isMissingExtractedValue(methodExt.clinicalOutcomeQuote)
    ? 'Not reported'
    : String(methodExt.clinicalOutcomeQuote).trim();
  const methOutcomeVal = useMarkdownClinicalOutcome && markdownAppraisalEvidence.clinicalOutcomes
    ? markdownAppraisalEvidence.clinicalOutcomes.formattedSummary
    : aiMethOutcomeVal;
  const methOutcomeQuote = useMarkdownClinicalOutcome && markdownAppraisalEvidence.clinicalOutcomes
    ? markdownAppraisalEvidence.clinicalOutcomes.quote
    : aiMethOutcomeQuote;
  const methOutcomeLoc = methOutcomeQuote === 'Not reported'
    ? 'Not reported'
    : (useMarkdownClinicalOutcome && markdownAppraisalEvidence.clinicalOutcomes
      ? markdownAppraisalEvidence.clinicalOutcomes.location
      : (methodExt.clinicalOutcomeLocation || 'Results'));
  const methOutcomeReported = clinicalOutcomeValidation.status !== 'not_available' &&
    methOutcomeVal !== 'Not reported' && methOutcomeQuote !== 'Not reported';

  const isElementaryAdequate = elementaryAspectsAdequate(methodReported, devReported, methOutcomeReported);
  const methElementaryScore = isElementaryAdequate ? 2 : 1;
  const methElementarySelection = isElementaryAdequate ? 'Adequate (2)' : 'Non adequate (1)';

  const methStatsScore = hasStats ? 2 : 1;
  const methStatsSelection = hasStats ? 'Adequate (2)' : 'Non adequate (1)';

  const controlsAssessment = evaluateAdequateControls(methodExt);
  const methControlsSelection = controlsAssessment.selection;
  const methControlsScore = controlsAssessment.score;

  const methodologicalSafetyExtract = parsedAi?.safetyEventsExtract || parsedAi?.safetyExtracts || parsedAi?.safetyEvents || {};
  const methodologicalSafetyEvents = Array.isArray(methodologicalSafetyExtract?.events)
    ? methodologicalSafetyExtract.events
    : [];
  const reportedComplicationOrAEEvent = methodologicalSafetyEvents.find((event: any) => {
    const eventType = String(event?.eventType || '').toLowerCase();
    const category = String(event?.category || '').toLowerCase();
    if (eventType.includes('cause of recurrence') || category.includes('recurrence')) return false;
    return eventType.includes('adverse event') || eventType.includes('complication') ||
      category.includes('adverse event') || category.includes('complication') ||
      category.includes('serious adverse') || category.includes('device-related') ||
      category.includes('procedure-related') || category.includes('device malfunction');
  });
  const reportedMortalityEvent = methodologicalSafetyEvents.find((event: any) => {
    const descriptor = String(event?.eventType || event?.category || event?.eventName || event?.name || '').toLowerCase();
    return descriptor.includes('mortality') || descriptor.includes('death');
  });
  const hasReportedComplicationOrAE = Boolean(reportedComplicationOrAEEvent);
  const hasReportedMortality = !isMissingExtractedValue(methodologicalSafetyExtract?.overallMortality) || Boolean(reportedMortalityEvent);
  const explicitZeroSafetyMatch = paperText.match(/\b(?:no|zero)\s+(?:serious\s+)?(?:adverse\s+events?|complications?|deaths?|mortality)\b|\b(?:adverse\s+events?|complications?|deaths?|mortality)\s*(?:were|was|=|:)\s*(?:0|zero|none)\b/i);
  const hasExplicitZeroSafetyData = Boolean(explicitZeroSafetyMatch);
  const hasMethodExtSafetyEvidence = !isMissingExtractedValue(methodExt.mortalityAEQuote) &&
    String(methodExt.mortalityAEQuote).trim().toLowerCase() !== 'not reported';
  const mortalityAEReported = hasReportedComplicationOrAE || hasReportedMortality || hasExplicitZeroSafetyData || hasMethodExtSafetyEvidence;
  const mortalityAEEvidenceQuote = hasMethodExtSafetyEvidence
    ? String(methodExt.mortalityAEQuote).trim()
    : !isMissingExtractedValue(reportedComplicationOrAEEvent?.evidenceQuote)
      ? String(reportedComplicationOrAEEvent.evidenceQuote).trim()
      : !isMissingExtractedValue(reportedMortalityEvent?.evidenceQuote)
        ? String(reportedMortalityEvent.evidenceQuote).trim()
        : explicitZeroSafetyMatch?.[0]
          ? explicitZeroSafetyMatch[0]
          : !isMissingExtractedValue(methodologicalSafetyExtract?.overallMortality)
            ? String(methodologicalSafetyExtract.overallMortality).trim()
            : 'Not reported';
  const mortalityAEEvidenceLocation = mortalityAEReported
    ? (methodExt.mortalityAELocation || reportedComplicationOrAEEvent?.evidenceLocation || reportedMortalityEvent?.evidenceLocation || 'Results / Tables')
    : 'Not reported';
  const methMortalityScore = mortalityAEReported ? 2 : 1;
  const methMortalitySelection = mortalityAEReported ? 'Adequate (2)' : 'Non adequate (1)';
  const methInterpretationScore = 1;
  const methLegalityScore = 1;

  const methTotal = methElementaryScore + patientScore + methStatsScore + methControlsScore + methMortalityScore + methInterpretationScore + methLegalityScore;

  const methodological: MethodologicalAppraisalState = {
    informationElementary: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.informationElementary,
      aiRecommendedSelection: methElementarySelection,
      aiRecommendedScore: methElementaryScore,
      userFinalSelection: methElementarySelection,
      userFinalScore: methElementaryScore,
      evidence: {
        quote: `Method: ${methodVal}\nIdentification of the device:\n${devSummaryQuote}\nOutcomes: ${methOutcomeVal}`,
        location: 'Methods & Results',
      },
      comment: isElementaryAdequate
        ? 'All three elementary aspects are reported, including an explicit device product/model name.'
        : `Non adequate: Not reported — ${[!methodReported && 'Method', !devReported && 'Device product/model name', !methOutcomeReported && 'Clinical outcome'].filter(Boolean).join(', ')}. All three aspects are required.`,
      status: (isElementaryAdequate ? 'Reported' : 'Not reported') as any,
      subElements: [
        { label: 'Method', value: methodVal, reported: methodReported, quote: methodQuote, location: methodLoc },
        {
          label: 'Identification of the device',
          value: devSummaryVal,
          reported: devReported,
          quote: devSummaryQuote,
          location: devSummaryLoc,
          deviceList: groupDeviceList,
        },
        { label: 'Clinical outcome', value: methOutcomeVal, reported: methOutcomeReported, quote: methOutcomeQuote, location: methOutcomeLoc },
      ],
    },
    patientsNumber: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.patientsNumber,
      aiRecommendedSelection: patientSelection,
      aiRecommendedScore: patientScore,
      userFinalSelection: patientSelection,
      userFinalScore: patientScore,
      evidence: {
        quote: patientReported
          ? (patientCountValidation.evidenceQuote || `Total patient count reported: ${rawPatientText}`)
          : 'Not reported',
        location: patientReported
          ? (patientCountValidation.evidenceLocation || 'Methods / Results')
          : 'Not reported',
      },
      comment: patientReported && patientCount !== null
        ? `Total sample size: ${patientCount} patients evaluated.${markdownText ? ` MD cross-check: ${patientCountValidation.status}. ${patientCountValidation.note}` : ''}`
        : 'Not reported',
      status: (patientReported ? 'Reported' : 'Not reported') as any,
    },
    statisticalMethods: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.statisticalMethods,
      aiRecommendedSelection: methStatsSelection,
      aiRecommendedScore: methStatsScore,
      userFinalSelection: methStatsSelection,
      userFinalScore: methStatsScore,
      evidence: {
        quote: statisticalEvidence.evidenceQuote,
        location: statisticalEvidence.evidenceLocation,
      },
      comment: statisticalEvidence.comment,
      status: (statisticalEvidence.reported ? 'Reported' : 'Not reported') as any,
    },
    adequateControls: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.adequateControls,
      aiRecommendedSelection: methControlsSelection,
      aiRecommendedScore: methControlsScore,
      userFinalSelection: methControlsSelection,
      userFinalScore: methControlsScore,
      evidence: {
        quote: [methodExt.adequateControlsQuote, methodExt.adequateControlsConfoundingQuote].filter(Boolean).join('\n') || 'Not reported',
        location: [methodExt.adequateControlsLocation, methodExt.adequateControlsConfoundingLocation].filter(Boolean).join('; ') || 'Not reported',
      },
      comment: controlsAssessment.reason,
      status: 'Reported' as any,
    },
    collectionMortalityAE: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.collectionMortalityAE,
      aiRecommendedSelection: methMortalitySelection,
      aiRecommendedScore: methMortalityScore,
      userFinalSelection: methMortalitySelection,
      userFinalScore: methMortalityScore,
      evidence: {
        quote: mortalityAEEvidenceQuote,
        location: mortalityAEEvidenceLocation,
      },
      comment: mortalityAEReported
        ? (methodExt.mortalityAEComment || 'At least one complication/adverse-event or mortality data point is reported.')
        : 'Neither complication/adverse-event data nor mortality data were reported.',
      status: (mortalityAEReported ? 'Reported' : 'Not reported') as any,
    },
    interpretationAuthors: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.interpretationAuthors,
      aiRecommendedSelection: 'Good (1)',
      aiRecommendedScore: methInterpretationScore,
      userFinalSelection: 'Good (1)',
      userFinalScore: methInterpretationScore,
      evidence: {
        quote: methodExt.authorsInterpretationQuote || 'Author interpretations and conclusion based on clinical outcomes',
        location: methodExt.authorsInterpretationLocation || 'Discussion & Conclusions',
      },
      comment: methodExt.authorsInterpretationComment || 'Discussion provides justified conclusions directly referencing study outcomes.',
      status: 'Reported' as any,
    },
    studyLegality: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.studyLegality,
      aiRecommendedSelection: 'Legal (1)',
      aiRecommendedScore: methLegalityScore,
      userFinalSelection: 'Legal (1)',
      userFinalScore: methLegalityScore,
      evidence: {
        quote: methodExt.studyLegalityQuote || 'Institutional ethics approval (IRB) and informed consent obtained',
        location: methodExt.studyLegalityLocation || 'Methods / Ethics statement',
      },
      comment: methodExt.studyLegalityComment || 'Institutional ethical approval and compliance reported.',
      status: 'Reported' as any,
    },
    totalScoreAi: methTotal,
    totalScoreUser: methTotal,
    gradeAi: calculateMethodologicalGrade(methTotal),
    gradeUser: calculateMethodologicalGrade(methTotal),
  };

  // 4. Contribution Criteria State (Max 10)
  const contExt = parsedAi?.contributionExtracts || {};
  const dataSourceAssessment = evaluateDataSourceType(contExt, articleMetadata.studyDesign);

  // This criterion asks whether follow-up was long enough to observe treatment
  // effects and complications, so only a direct follow-up/observation duration
  // qualifies. Overall/patient survival is not accepted as a substitute here —
  // knowing when patients died does not establish that complications had time
  // to be observed. (Overall survival is still used as a proxy separately under
  // Relevance 'Duration of follow-up'.) Stent patency/time-to-RBO are intentionally
  // excluded here because they belong under Relevance 'Duration of application or use'.
  const followUpText = (articleMetadata.followUpPeriod && articleMetadata.followUpPeriod !== 'Not reported')
    ? articleMetadata.followUpPeriod
    : (currentStudyText.match(/(?:median|mean|mean\s*±\s*SD|range)?\s*(?:follow-up|follow\s*up|observation\s*period)\s*(?:duration\s*)?(?:of|was|:)?\s*([^\.\n;]+(?:months?|weeks?|days?|years?)[^\.\n;]*)/i)?.[0] || '');

  let fuQuote = 'Not reported';
  let fuLocation = 'Not reported';
  let fuComment = 'Direct follow-up duration was not reported for this criterion.';
  let fuSelection = 'No (1)';
  let fuScore = 1;
  let fuStatus = 'Not reported';

  if (useMarkdownFollowUp && markdownDemographics.followUp) {
    fuQuote = markdownDemographics.followUp.quote;
    fuLocation = markdownDemographics.followUp.location;
    fuComment = `Direct follow-up duration documented. MD cross-check: ${followUpValidation.status}. ${followUpValidation.note}`;
    fuSelection = 'Yes (2)';
    fuScore = 2;
    fuStatus = 'Reported';
  } else if (String(contExt.followUpMetricType || '') === 'follow_up' && contExt.followUpQuote && contExt.followUpQuote !== 'Not reported') {
    fuQuote = contExt.followUpQuote;
    fuLocation = contExt.followUpLocation || 'Results / Methods';
    fuComment = contExt.followUpComment || 'Longitudinal outcome observation period documented.';
    fuSelection = 'Yes (2)';
    fuScore = 2;
    fuStatus = 'Reported';
  } else if (followUpText && followUpText.trim().length > 0) {
    fuQuote = `Follow-up duration: "${followUpText.trim()}"`;
    fuLocation = 'Methods / Results';
    fuComment = 'Follow-up period is documented and sufficient to assess longitudinal clinical effect and potential complications.';
    fuSelection = 'Yes (2)';
    fuScore = 2;
    fuStatus = 'Reported';
  }

  // Outcome measures: a quantitative current-study outcome from either source is sufficient.
  // Confident Markdown table/Results evidence is preferred for display when available;
  // the existing PDF/Gemini result remains the fallback.
  const contOutcomeReported = clinicalOutcomeValidation.status !== 'not_available';
  const contOutcomeQuote = contOutcomeReported
    ? (clinicalOutcomeValidation.evidenceQuote || clinicalOutcomeValidation.selectedValue)
    : 'Not reported';
  const contOutcomeLoc = contOutcomeReported
    ? (clinicalOutcomeValidation.evidenceLocation || contExt.outcomeMeasuresLocation || 'Results / Tables')
    : 'Not reported';
  const contOutcomeComment = contOutcomeReported
    ? `${contExt.outcomeMeasuresComment || 'Quantitative performance or safety outcome(s) reported.'}${markdownText ? ` MD cross-check: ${clinicalOutcomeValidation.status}. ${clinicalOutcomeValidation.note}` : ''}`
    : 'No quantitative device performance or safety outcome was extracted from the article.';
  const contOutcomeScore = contOutcomeReported ? 2 : 1;
  const contOutcomeSelection = contOutcomeReported ? 'Yes (2)' : 'No (1)';

  // Configured rule: if at least one quantitative clinical outcome exists,
  // Clinical significance is Yes (2). The same validated outcome evidence is
  // reused so Methodological and Contribution cannot diverge solely by extractor.
  const clinReported = clinicalOutcomeValidation.status !== 'not_available';
  const clinQuote = clinReported
    ? (clinicalOutcomeValidation.evidenceQuote || clinicalOutcomeValidation.selectedValue)
    : 'Not reported';
  const clinLoc = clinReported
    ? (clinicalOutcomeValidation.evidenceLocation || contExt.clinicalSignificanceLocation || 'Results / Tables')
    : 'Not reported';
  const clinComment = clinReported
    ? `${contExt.clinicalSignificanceComment || 'Quantitative clinical outcome(s) support assessment of treatment effect.'}${markdownText ? ` MD cross-check: ${clinicalOutcomeValidation.status}. ${clinicalOutcomeValidation.note}` : ''}`
    : 'No quantitative clinical outcome was extracted to support clinical significance.';
  const clinScore = clinReported ? 2 : 1;
  const clinSelection = clinReported ? 'Yes (2)' : 'No (1)';

  const contStatsScore = hasStats ? 2 : 1;
  const contTotal = dataSourceAssessment.score + contOutcomeScore + fuScore + contStatsScore + clinScore;

  const contribution: ContributionAppraisalState = {
    dataSourceType: {
      ...DEFAULT_CONTRIBUTION_CRITERIA.dataSourceType,
      aiRecommendedSelection: dataSourceAssessment.selection,
      aiRecommendedScore: dataSourceAssessment.score,
      userFinalSelection: dataSourceAssessment.selection,
      userFinalScore: dataSourceAssessment.score,
      evidence: {
        quote: dataSourceAssessment.quote,
        location: dataSourceAssessment.location,
      },
      comment: dataSourceAssessment.comment,
      status: dataSourceAssessment.status as any,
    },
    outcomeMeasures: {
      ...DEFAULT_CONTRIBUTION_CRITERIA.outcomeMeasures,
      aiRecommendedSelection: contOutcomeSelection,
      aiRecommendedScore: contOutcomeScore,
      userFinalSelection: contOutcomeSelection,
      userFinalScore: contOutcomeScore,
      evidence: {
        quote: contOutcomeQuote,
        location: contOutcomeLoc,
      },
      comment: contOutcomeComment,
      status: (contOutcomeReported ? 'Reported' : 'Not reported') as any,
    },
    followUp: {
      ...DEFAULT_CONTRIBUTION_CRITERIA.followUp,
      aiRecommendedSelection: fuSelection,
      aiRecommendedScore: fuScore,
      userFinalSelection: fuSelection,
      userFinalScore: fuScore,
      evidence: {
        quote: fuQuote,
        location: fuLocation,
      },
      comment: fuComment,
      status: fuStatus as any,
    },
    statisticalSignificance: {
      ...DEFAULT_CONTRIBUTION_CRITERIA.statisticalSignificance,
      aiRecommendedSelection: statisticalEvidence.reported ? 'Yes (2)' : 'No (1)',
      aiRecommendedScore: contStatsScore,
      userFinalSelection: statisticalEvidence.reported ? 'Yes (2)' : 'No (1)',
      userFinalScore: contStatsScore,
      evidence: {
        quote: statisticalEvidence.evidenceQuote,
        location: statisticalEvidence.evidenceLocation,
      },
      comment: statisticalEvidence.comment,
      status: (statisticalEvidence.reported ? 'Reported' : 'Not reported') as any,
    },
    clinicalSignificance: {
      ...DEFAULT_CONTRIBUTION_CRITERIA.clinicalSignificance,
      aiRecommendedSelection: clinSelection,
      aiRecommendedScore: clinScore,
      userFinalSelection: clinSelection,
      userFinalScore: clinScore,
      evidence: {
        quote: clinQuote,
        location: clinLoc,
      },
      comment: clinComment,
      status: (clinReported ? 'Reported' : 'Not reported') as any,
    },
    totalScoreAi: contTotal,
    totalScoreUser: contTotal,
    gradeAi: calculateContributionGrade(contTotal),
    gradeUser: calculateContributionGrade(contTotal),
  };

  return {
    suitability,
    relevance,
    methodological,
    contribution,
    genderValidation,
    statisticalValidation,
    clinicalOutcomeValidation,
  };
}
