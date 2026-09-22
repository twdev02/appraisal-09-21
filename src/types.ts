/**
 * Types for Clinical Literature Appraisal Extractor
 * Aligned with Appraisal Plan standards:
 * - IMDRF MDCE WG/N56FINAL:2019 Appendix D1 (Suitability Criteria)
 * - MEDDEV 2.7.1 Rev.4 Section 9.3.2 c (Relevance Appraisal)
 * - Methodological Appraisal Standard
 * - Contribution Criteria Standard
 * - Overall Synthesis and Regulatory Decision Engine
 */

export type ExtractionStatus = 'Reported' | 'Not reported' | 'Not assessable' | 'Mixed';

export type ValidationStatus = 'pass' | 'review' | 'fail';

export interface SelfValidationIssue {
  id: string;
  status: Exclude<ValidationStatus, 'pass'>;
  step: 1 | 2 | 3 | 4;
  targetId: string;
  field?: string;
  message: string;
}

export interface SelfValidationState {
  version: string;
  overallStatus: ValidationStatus;
  issues: SelfValidationIssue[];
  validatedAt: string;
}

export interface EvidenceCitation {
  quote: string;
  location: string; // e.g. "Page 3, Section 2.1" or "Table 2, Page 4"
  source_page?: string | number;
}

export interface SimilarDeviceMeta {
  raw: string; // e.g. "WallFlex Biliary Transhepatic Stent System (Boston Scientific)"
  fullName: string; // e.g. "WallFlex Biliary Transhepatic Stent System"
  manufacturer?: string; // e.g. "Boston Scientific"
  aliases: string[]; // e.g. ["WallFlex"]
}

export interface DueItem {
  id: string; // e.g. "DUE-1", "DUE-2"
  deviceCategory?: string; // e.g. "Biliary Stents", "Esophageal Stents", "Drainage Stents"
  productName: string;
  aliases?: string; // DUE product aliases / alternative names
  indications: string[]; // parsed / active indication chips
  rawIndicationText?: string; // original user-entered raw text
  similarDevices?: string[]; // independent similar devices and aliases for this DUE card
  similarDevicesMeta?: SimilarDeviceMeta[]; // parsed similar devices with fullName, manufacturer, aliases
  selectedPreset?: string; // preset name if chosen from presets
  selectionMode?: 'single' | 'categoryAll'; // explicit UI selection mode
  selectionGroupKey?: string; // stable key for grouped category-wide selections
  selectionGroupLabel?: string; // user-facing group label, e.g. All Biliary Stents
}

// Keep DueSetup alias for single item or compatibility
export type DueSetup = DueItem;

export interface SimilarDevice {
  id: string;
  productName: string;
  aliases: string;
  manufacturer?: string;
  fullName?: string;
}

export interface ArticleMetadata {
  title: string;
  journal: string;
  publicationYear: string;
  doi: string;
  authors: string;
  abstract?: string;
  totalPatientCount?: number | string;
  studyDesign?: string;
  studyPeriod?: string;
  followUpPeriod?: string;
}

export type DeviceRelationshipType = 'DUE' | 'Similar Device' | 'Other Device' | 'Not reported';
export type IndicationRelationshipType = 'Same indication' | 'Related indication' | 'Different indication' | 'Mixed indication' | 'Not reported' | 'Not assessable';

export interface ExtractedDeviceItem {
  id: string;
  deviceProductName: string;
  manufacturer: string;
  deviceType: string;
  coverType: string;
  coverDetermination?: 'Directly reported' | 'Inferred from text' | 'Inferred from model/preset' | 'Inferred from figure' | 'Review required' | 'Not assessable';
  coverEvidence?: EvidenceCitation;
  coverRationale?: string;
  coverConfidence?: 'High' | 'Medium' | 'Low';
  diameter: string; // Must be separate. If missing -> 'Not reported'
  length: string;   // Must be separate. If missing -> 'Not reported'
  devicePatientNumber: string; // e.g. "42" or "Not separately reported"
  deviceIndication: string;

  // Whether this study's reported clinical endpoints (technical/clinical success,
  // safety events, patency, etc.) can be attributed specifically to this device
  // rather than to the pooled cohort. Drives DUE/Similar Device scoring credit
  // when the device shares its research group with other devices.
  deviceOutcomeSeparability?: 'single_device_group' | 'fully_separable' | 'numerator_only' | 'not_separable';
  deviceOutcomeSeparabilityRationale?: string;
  evidence: EvidenceCitation;
  
  // DUE Inventory Linkage
  matchedDueId?: string; // e.g. "DUE-1"
  matchedDueName?: string; // e.g. "Niti-S Hot SPAXUS™ Stent"
  matchedDueIndication?: string; // e.g. "Transgastric or transduodenal gallbladder drainage"
  dueMatchStatus?: 'Exact DUE match' | 'Multiple DUE match – Review required' | 'Configuration conflict – Review required' | 'Similar Device Reference' | 'Multiple reference DUEs' | 'No DUE match' | 'Needs confirmation' | 'Review required';

  // Similar Device Details (when matched to a Similar Device)
  mappedSimilarDeviceName?: string; // mapped fullName
  mappedSimilarDeviceManufacturer?: string; // mapped manufacturer
  matchBasis?: 'Exact name match' | 'Registered alias match' | 'Hierarchical context match' | 'Needs confirmation';

  // Classification 1: Device relationship
  deviceRelationship: {
    aiRecommended: DeviceRelationshipType;
    userFinal: DeviceRelationshipType;
    evidence: EvidenceCitation;
    rationale: string;
  };

  // Classification 2: Indication relationship
  indicationRelationship: {
    aiRecommended: IndicationRelationshipType;
    userFinal: IndicationRelationshipType;
    evidence: EvidenceCitation;
    rationale: string;
    comparedAgainstDueId?: string;
    comparedAgainstDueName?: string;
    matchedDueIndication?: string;
  };
}

export interface ResearchGroup {
  id: string;
  groupName: string; // Original verbatim from article
  groupPatientNumber: string; // e.g. "80"
  devices: ExtractedDeviceItem[];
  groupIndicationSummary?: string;
  evidence: EvidenceCitation;
}

export type OptionScore = {
  label: string;
  score: number;
  description?: string;
};

// ==========================================
// 1. Suitability Criteria (IMDRF D1)
// ==========================================
export interface SuitabilityCriterionItem {
  id: string;
  name: string;
  question: string;
  weight: number; // Max possible score
  options: OptionScore[];
  aiRecommendedSelection: string;
  aiRecommendedScore: number;
  userFinalSelection: string;
  userFinalScore: number;
  evidence: EvidenceCitation;
  comment: string;
  status: ExtractionStatus;
  matchedDueProductName?: string;
  matchedDueIndication?: string;
  reportedChecklist?: {
    item: string;
    reported: boolean;
    evidenceQuote: string;
    location: string;
  }[];
}

export interface SuitabilityAppraisalState {
  appropriateDevice: SuitabilityCriterionItem;
  appropriateDeviceApplication: SuitabilityCriterionItem;
  appropriatePatientGroup: SuitabilityCriterionItem;
  acceptableReportDataCollation: SuitabilityCriterionItem;
  totalScoreAi: number;
  totalScoreUser: number;
  gradeAi: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
  gradeUser: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
}

// ==========================================
// 2. Relevance Appraisal (MEDDEV 2.7.1 c)
// ==========================================
export interface RangeOfTimeDetails {
  durationOfApplicationOrUse: string; // e.g. "[Group name: median stent patency 120 days (IQR 80–180)]" or "Not reported"
  numberOfRepeatExposures: string; // Explicit repeat device exposure/reintervention count, or 'Not reported' when absent
  durationOfFollowUp: string; // e.g. "[Study-wide: median follow-up 180 days (IQR 90–250)]" or "[Overall survival used as a proxy because follow-up duration was not reported: ...]"
  isFollowUpProxySurvival?: boolean;
}

export interface RelevanceChecklistItem {
  id: string;
  title: string;
  description: string;
  options: string[];
  isMultiSelect?: boolean;
  aiSelectedOptions: string[];
  userSelectedOptions: string[];
  evidence: EvidenceCitation;
  comment: string;
  status: ExtractionStatus;
  rangeOfTimeDetails?: RangeOfTimeDetails;
}

export interface RelevanceAppraisalState {
  itemA_representativeness: RelevanceChecklistItem;
  itemB_aspectsCovered: RelevanceChecklistItem;
  itemC_intendedPurposeClaims: RelevanceChecklistItem;
  itemD_modelSizeSetting: RelevanceChecklistItem;
  itemE_userGroup: RelevanceChecklistItem;
  itemF_medicalIndication: RelevanceChecklistItem;
  itemG_ageGroup: RelevanceChecklistItem;
  itemH_gender: RelevanceChecklistItem;
  itemI_typeSeverityCondition: RelevanceChecklistItem;
  itemJ_rangeOfTime: RelevanceChecklistItem;
}

// ==========================================
// 3. Methodological Appraisal
// ==========================================
export interface MethodologicalCriterionItem {
  id: string;
  name: string;
  question: string;
  maxScore: number;
  options: OptionScore[];
  aiRecommendedSelection: string;
  aiRecommendedScore: number;
  userFinalSelection: string;
  userFinalScore: number;
  evidence: EvidenceCitation;
  comment: string;
  status: ExtractionStatus;
  subElements?: {
    label: string;
    value: string;
    reported: boolean;
    quote: string;
    location: string;
    deviceList?: {
      studyGroup: string;
      deviceUsed: string;
      patientNumber?: string;
      evidenceQuote: string;
      evidenceLocation: string;
    }[];
  }[];
}

export interface MethodologicalAppraisalState {
  informationElementary: MethodologicalCriterionItem;
  patientsNumber: MethodologicalCriterionItem;
  statisticalMethods: MethodologicalCriterionItem;
  adequateControls: MethodologicalCriterionItem;
  collectionMortalityAE: MethodologicalCriterionItem;
  interpretationAuthors: MethodologicalCriterionItem;
  studyLegality: MethodologicalCriterionItem;
  totalScoreAi: number;
  totalScoreUser: number;
  gradeAi: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
  gradeUser: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
}

// ==========================================
// 4. Contribution Criteria
// ==========================================
export interface ContributionCriterionItem {
  id: string;
  name: string;
  question: string;
  maxScore: number;
  options: OptionScore[];
  aiRecommendedSelection: string;
  aiRecommendedScore: number;
  userFinalSelection: string;
  userFinalScore: number;
  evidence: EvidenceCitation;
  comment: string;
  status: ExtractionStatus;
}

export interface ContributionAppraisalState {
  dataSourceType: ContributionCriterionItem;
  outcomeMeasures: ContributionCriterionItem;
  followUp: ContributionCriterionItem;
  statisticalSignificance: ContributionCriterionItem;
  clinicalSignificance: ContributionCriterionItem;
  totalScoreAi: number;
  totalScoreUser: number;
  gradeAi: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
  gradeUser: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
}

// ==========================================
// 5. Adverse Events, Complications & Recurrence (Step 4)
// ==========================================
export type EventType = 'Adverse Event / Complication' | 'Cause of Recurrence';

export type SafetyEventCategory =
  | 'Adverse event'
  | 'Complication'
  | 'Recurrence'
  | 'Serious adverse event'
  | 'Device-related event'
  | 'Procedure-related event'
  | 'Device malfunction / technical failure'
  | 'Mortality'
  | 'Reintervention-related event'
  | 'Other reported occurrence';

export type TableRowHierarchyClassification =
  | 'Direct adverse event / complication'
  | 'Direct recurrence-related outcome'
  | 'Summary total'
  | 'Cause / mechanism / subtype'
  | 'Management / revision method'
  | 'Efficacy or other clinical outcome'
  | 'Other non-safety data'
  | 'Hierarchy unclear';

export interface SafetyBreakdownItem {
  id: string;
  parentEvent: string; // e.g. "Biliary obstruction" or "Stent dysfunction"
  detailType: 'Cause' | 'Mechanism' | 'Etiology' | 'Management' | 'Revision method' | 'Sub-classification' | string;
  detail: string; // Verbatim term from paper e.g. "Obstruction", "Migration", "Sludges or food scraps", "Unknown"
  timing: string; // e.g. "Early (within 14 days)", "Late (after 14 days)"
  countN: string; // e.g. "3/106" or "1"
  reportedRate: string; // e.g. "2.8%" or "Not reported"
  evidenceQuote: string; // exact verbatim quote
  evidenceLocation: string; // e.g. "Table 2, Page 4"
  tableTitle?: string;
  tableNumber?: string;
  pageNumber?: string;
  userRemarks?: string;
}

export interface SafetyEventItem {
  id: string;
  eventName: string; // Event / Complication / Recurrence (Verbatim from article)
  eventType: EventType; // Adverse Event / Complication | Cause of Recurrence
  classificationStatus: 'classified' | 'review_required';
  reviewReason?: string;
  suggestedType?: string;
  category?: SafetyEventCategory; // Backward-compatible category
  timing: string; // Early, Late, or verbatim timing distinction from paper, or N/A
  studyGroupOrDevice: string; // Verbatim group name from paper or "Study-wide"
  groupId?: string;
  groupName?: string;
  deviceName?: string;
  numEvents?: string | number; // n
  totalPatients?: string | number; // N
  numerator?: string | number;
  denominator?: string | number;
  countN: string; // Verbatim incidence count and denominator (e.g. "3/40", "5/35", "4")
  reportedRate: string; // Verbatim percentage from the paper (e.g. "7.5%", "12.5%", or "Not reported")
  calculatedRate?: string; // Calculated from n/N only when the percentage calculation is considered safe
  reportedPercentage?: string;
  percentageSource?: 'Reported' | 'Calculated';
  numeratorType?: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
  denominatorType?: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
  multipleEventsPerPatient?: 'Yes' | 'No' | 'Not reported' | 'Unclear';
  percentageAssessmentStatus?: 'reported_verified' | 'calculated' | 'reported_only' | 'review_required' | 'not_available';
  percentageAssessmentNote?: string;
  percentageContextQuote?: string;
  percentageContextLocation?: string;
  calculationBasis?: string;
  severity?: string; // Verbatim severity if reported or "Not reported"
  managementOutcome?: string; // Verbatim management if reported or "Not reported"
  evidenceQuote: string; // Verbatim sentence or table row
  evidenceLocation: string; // Page, Table number or Section
  causalRationale?: string;
  tableTitle?: string;
  tableNumber?: string;
  pageNumber?: string;
  parentEvent?: string;
  parentEventId?: string;
  isSubItem?: boolean;
  /** Relationship of this row TO its parent. 'aggregate' is kept only for backward compatibility. */
  relationshipType?: 'none' | 'aggregate' | 'component' | 'cause' | 'unclear';
  /** True when this row is a parent/subtotal that has explicitly supported child rows. */
  isAggregate?: boolean;
  /** Calculated nesting depth for display (0=root, 1=child, 2=grandchild...). */
  hierarchyLevel?: number;
  /** Source basis used to create a parent-child link. Arithmetic alone is never sufficient. */
  hierarchyEvidenceType?: 'explicit_text' | 'table_structure' | 'both' | 'none';
  hierarchyEvidenceQuote?: string;
  hierarchyEvidenceLocation?: string;
  hierarchyConfidence?: 'High' | 'Medium' | 'Low';
  hierarchyReason?: string;
  breakdownCompleteness?: 'Complete' | 'Partial' | 'Unknown';
  breakdowns?: SafetyBreakdownItem[];
  hierarchyClassification?: TableRowHierarchyClassification;
  hierarchyRole?: 'Independent event' | 'Aggregate event' | 'Component event' | 'Cause event' | 'Subtotal/Summary' | 'Cause/Mechanism breakdown' | 'Review required';
  userRemarks?: string;
  isUserModified?: boolean;
  // Manual review of an automatically detected New FMEA risk candidate.
  // When set to 'reviewed_not_new', Step 4 keeps the automatic comparison result
  // but removes the New-candidate highlight until the user restores automatic status.
  fmeaManualDecision?: 'reviewed_not_new';
  fmeaManualNote?: string;
  // Optional manual mapping when a New FMEA risk candidate is reviewed against
  // similar existing risks and the reviewer selects an existing FMEA risk.
  fmeaManualMappedRiskKey?: string;
  fmeaManualMappedRiskLabel?: string;
  aiRecommended?: {
    eventName: string;
    eventType: EventType;
    classificationStatus?: 'classified' | 'review_required';
    category?: SafetyEventCategory;
    hierarchyClassification?: TableRowHierarchyClassification;
    parentEvent?: string;
    parentEventId?: string;
    isSubItem?: boolean;
    relationshipType?: 'none' | 'aggregate' | 'component' | 'cause' | 'unclear';
    isAggregate?: boolean;
    hierarchyLevel?: number;
    hierarchyEvidenceType?: 'explicit_text' | 'table_structure' | 'both' | 'none';
    hierarchyEvidenceQuote?: string;
    hierarchyEvidenceLocation?: string;
    hierarchyConfidence?: 'High' | 'Medium' | 'Low';
    hierarchyReason?: string;
    breakdownCompleteness?: 'Complete' | 'Partial' | 'Unknown';
    hierarchyRole?: 'Independent event' | 'Aggregate event' | 'Component event' | 'Cause event' | 'Subtotal/Summary' | 'Cause/Mechanism breakdown' | 'Review required';
    timing: string;
    studyGroupOrDevice: string;
    countN: string;
    reportedRate: string;
    calculatedRate?: string;
    numeratorType?: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
    denominatorType?: 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
    multipleEventsPerPatient?: 'Yes' | 'No' | 'Not reported' | 'Unclear';
    percentageAssessmentStatus?: 'reported_verified' | 'calculated' | 'reported_only' | 'review_required' | 'not_available';
    percentageAssessmentNote?: string;
    percentageContextQuote?: string;
    percentageContextLocation?: string;
    calculationBasis?: string;
    severity?: string;
    managementOutcome?: string;
    evidenceQuote: string;
    evidenceLocation: string;
  };
}

export interface ReportedTotalItem {
  timingLabel: string; // e.g. "Early reported total", "Late reported total", "Overall reported total"
  countN: string; // e.g. "22/106"
  reportedRate: string; // e.g. "20.8%"
  evidenceQuote: string;
  evidenceLocation: string;
}

export interface SafetyValidationSummary {
  independentEventCount: number;
  breakdownItemCount: number;
  reviewItemCount: number;
  validationMessage: string;
  status: 'Complete' | 'Verified' | 'Reprocessed' | 'Review required';
  tableSummaries?: {
    tableNumber: string;
    tableTitle: string;
    pageNumber?: string;
    independentEvents: number;
    subtotals: number;
    breakdownItems: number;
    otherOutcomes: number;
  }[];
}

export interface TimingSafetySummary {
  timing: string; // e.g. "Early", "Late", "Early adverse events within 14 days"
  countN: string; // e.g. "22/106"
  reportedRate: string; // e.g. "20.8%"
  evidenceQuote: string;
  evidenceLocation: string;
}

export interface CompletenessValidation {
  sourceRowCount?: number;
  extractedRowCount?: number;
  status: 'Complete' | 'Reprocessed' | 'Verified' | 'Mismatch' | 'Not assessable';
  message: string;
}

export interface GroupSummaryMetric {
  timing?: string;
  numerator?: string | number;
  denominator?: string | number;
  percentage?: string;
  percentageSource?: 'Reported' | 'Calculated';
  evidenceQuote?: string;
  evidenceLocation?: string;
  status?: 'Reported' | 'Not reported' | 'N/A';
}

export type MortalityRelatedness =
  | 'stent_related'
  | 'device_related'
  | 'procedure_related'
  | 'treatment_related'
  | 'all_cause'
  | 'unclear'
  | 'not_reported';

export interface GroupSafetySummary {
  groupId?: string;
  groupName: string;
  deviceName?: string;
  populationN: string;
  patientsWithEvents: string | GroupSummaryMetric;
  mortality: string | GroupSummaryMetric;
  mortalityLabel?: string;
  mortalityRelatedness?: MortalityRelatedness;
  mortalityVerificationRequired?: boolean;
  mortalityVerificationNote?: string;
  mortalityEvidenceQuote?: string;
  mortalityEvidenceLocation?: string;
  seriousAdverseEvents?: string | GroupSummaryMetric;
  reinterventions: string | GroupSummaryMetric | GroupSummaryMetric[];
  evidenceQuote: string;
  evidenceLocation: string;
}

export interface OverallSafetySummary {
  status: 'Events reported' | 'No event reported' | 'Not reported';
  overallStudyPopulation: string; // e.g. "N = 80" or "Not reported"
  overallPatientsWithEvents: string; // "n/N (%)" directly reported in paper or "Not reported"
  overallMortality: string; // Selected mortality value for Step 4 (prefer stent/device/procedure/treatment-related)
  overallMortalityLabel?: string;
  overallMortalityRelatedness?: MortalityRelatedness;
  overallMortalityVerificationRequired?: boolean;
  overallMortalityVerificationNote?: string;
  overallMortalityEvidenceQuote?: string;
  overallMortalityEvidenceLocation?: string;
  overallSeriousAdverseEvents: string; // "n/N (%)" or "Not reported"
  overallReinterventionDueToEvent: string; // "n/N (%)" or "Not reported"
  earlyReportedTotal?: ReportedTotalItem;
  lateReportedTotal?: ReportedTotalItem;
  overallReportedTotal?: ReportedTotalItem;
  groupSummaries?: GroupSafetySummary[];
  timingSummaries?: TimingSafetySummary[];
  completenessValidation?: CompletenessValidation;
  validationSummary?: SafetyValidationSummary;
  reviewRequiredItems?: SafetyEventItem[];
  unlinkedBreakdowns?: SafetyBreakdownItem[];
  remarks?: string;
  evidenceQuote: string;
  evidenceLocation: string;
}

export interface SafetyEventState {
  events: SafetyEventItem[];
  summary: OverallSafetySummary;
  hasExplicitNoEventsReported: boolean;
  hasSafetyNotReported: boolean;
  markdownEvidence?: {
    available: boolean;
    trustedSafetyTableCount: number;
    ignoredUncertainSafetyTableCount: number;
    ignoredComparisonTableCount: number;
    validatedEventRows: number;
    reinterventionRows: number;
  };
}

// ==========================================
// 6. Overall Appraisal & Synthesis
// ==========================================
export interface SectionSummaryScore {
  sectionName: string;
  userScore: number;
  maxScore: number;
  grade: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
}

export interface OverallAppraisalState {
  suitabilitySummary: SectionSummaryScore;
  methodologicalSummary: SectionSummaryScore;
  contributionSummary: SectionSummaryScore;
  totalScore: number;
  maxTotalScore: number;
  overallGrade: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
  overallResult: 'Accepted' | 'REJECTED';
}


export interface DemographicEvidenceValidationItem {
  status: 'validated' | 'supplemented' | 'md_only' | 'conflict' | 'pdf_only' | 'not_available';
  pdfValue: string;
  markdownValue: string;
  selectedValue: string;
  evidenceQuote: string;
  evidenceLocation: string;
  note: string;
}

export interface EvidenceValidationState {
  markdownAvailable: boolean;
  trustedMarkdownTables: number;
  uncertainMarkdownTables: number;
  patientCount: DemographicEvidenceValidationItem;
  gender: DemographicEvidenceValidationItem;
  followUp: DemographicEvidenceValidationItem;
  statisticalMethod?: DemographicEvidenceValidationItem;
  clinicalOutcome?: DemographicEvidenceValidationItem;
}

export interface FullAppraisalData {
  due?: DueSetup;
  dueList: DueItem[];
  similarDevices: SimilarDevice[];
  articleMetadata: ArticleMetadata;
  rawPaperText?: string;
  evidenceValidation?: EvidenceValidationState;
  pdfFileName?: string;
  researchGroups: ResearchGroup[];
  suitability: SuitabilityAppraisalState;
  relevance: RelevanceAppraisalState;
  methodological: MethodologicalAppraisalState;
  contribution: ContributionAppraisalState;
  safety?: SafetyEventState;
  selfValidation?: SelfValidationState;
}

export interface ValidationTestResult {
  testId: number;
  title: string;
  passed: boolean;
  expected: string;
  actual: string;
  details: string;
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

export interface Article {
  id: string;
  file: File;
  pdfFileName: string;
  status: AnalysisStatus;
  errorMessage?: string;
  markdownFile?: File;
  markdownFileName?: string;
  markdownNeedsAnalysis?: boolean;
  data: FullAppraisalData;
  methodological: MethodologicalAppraisalState;
  contribution: ContributionAppraisalState;
}
