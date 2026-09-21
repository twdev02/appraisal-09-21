import {
  SuitabilityAppraisalState,
  RelevanceAppraisalState,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
  OverallAppraisalState,
} from '../types';

/**
 * 1. Appraisal Criteria for Suitability
 * Reference: IMDRF MDCE WG/N56FINAL:2019's Appendices D1
 * Max score: 11 (2 + 3 + 3 + 3)
 */
export const DEFAULT_SUITABILITY_CRITERIA: SuitabilityAppraisalState = {
  appropriateDevice: {
    id: 'crit_device',
    name: 'Appropriate Device',
    question: 'Were the data generated from the device in question?',
    weight: 2,
    options: [
      { label: 'Device under evaluation', score: 2, description: 'Device under evaluation (DUE)' },
      { label: 'Equivalent device or Benchmark/Similar device', score: 1, description: 'Equivalent device or Benchmark/Similar device' },
      { label: 'Other devices and medical alternatives', score: 0, description: 'Other devices and medical alternatives' },
    ],
    aiRecommendedSelection: 'Device under evaluation',
    aiRecommendedScore: 2,
    userFinalSelection: 'Device under evaluation',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  appropriateDeviceApplication: {
    id: 'crit_application',
    name: 'Appropriate device application',
    question: 'Was the device used for the same intended use (e.g., methods of deployment, application, etc.)?',
    weight: 3,
    options: [
      { label: 'Same use', score: 3, description: 'Same use' },
      { label: 'Minor deviation', score: 2, description: 'Minor deviation' },
      { label: 'Major deviation', score: 1, description: 'Major deviation' },
    ],
    aiRecommendedSelection: 'Same use',
    aiRecommendedScore: 3,
    userFinalSelection: 'Same use',
    userFinalScore: 3,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  appropriatePatientGroup: {
    id: 'crit_patient_group',
    name: 'Appropriate patient group',
    question: 'Was the data generated from a patient group that is representative of the intended treatment population (e.g., age, sex, etc.) and clinical condition (i.e., disease, including state and severity)?',
    weight: 3,
    options: [
      { label: 'Applicable', score: 3, description: 'Applicable' },
      { label: 'Limited', score: 2, description: 'Limited' },
      { label: 'Different population', score: 1, description: 'Different population' },
    ],
    aiRecommendedSelection: 'Applicable',
    aiRecommendedScore: 3,
    userFinalSelection: 'Applicable',
    userFinalScore: 3,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  acceptableReportDataCollation: {
    id: 'crit_report_quality',
    name: 'Acceptable report / data collation',
    question: 'Do the reports or collations of data contain sufficient information to be able to undertake a rational and objective assessment?',
    weight: 3,
    options: [
      { label: 'High quality', score: 3, description: 'High quality' },
      { label: 'Minor deficiencies', score: 2, description: 'Minor deficiencies' },
      { label: 'Insufficient information', score: 1, description: 'Insufficient information' },
    ],
    aiRecommendedSelection: 'Insufficient information',
    aiRecommendedScore: 1,
    userFinalSelection: 'Insufficient information',
    userFinalScore: 1,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Not reported',
    reportedChecklist: [
      { item: 'Study objective', reported: false, evidenceQuote: '', location: '' },
      { item: 'Study design', reported: false, evidenceQuote: '', location: '' },
      { item: 'Patient population', reported: false, evidenceQuote: '', location: '' },
      { item: 'Device or procedure description', reported: false, evidenceQuote: '', location: '' },
      { item: 'Outcomes or endpoints', reported: false, evidenceQuote: '', location: '' },
      { item: 'Follow-up or observation', reported: false, evidenceQuote: '', location: '' },
      { item: 'Results', reported: false, evidenceQuote: '', location: '' },
      { item: 'Adverse events / safety', reported: false, evidenceQuote: '', location: '' },
      { item: 'Statistical methods / software', reported: false, evidenceQuote: '', location: '' },
    ],
  },
  totalScoreAi: 9,
  totalScoreUser: 9,
  gradeAi: 'Very Good',
  gradeUser: 'Very Good',
};

export function calculateSuitabilityGrade(totalScore: number): 'Excellent' | 'Very Good' | 'Good' | 'Poor' {
  if (totalScore >= 10) return 'Excellent';
  if (totalScore >= 8) return 'Very Good';
  if (totalScore >= 6) return 'Good';
  return 'Poor';
}

/**
 * 2. Relevance Appraisal
 * Reference: MEDDEV 2.7.1 (Rev.4)’s Section 9.3.2 c)’s table
 */
export const DEFAULT_RELEVANCE_ITEMS: RelevanceAppraisalState = {
  itemA_representativeness: {
    id: 'rel_rep',
    title: 'To what extent are the data generated representative of the device under evaluation?',
    description: 'MEDDEV 2.7.1 (Rev.4) Section 9.3.2 c',
    options: [
      'Device under evaluation',
      'Equivalent device',
      'Benchmark/Similar device',
      'Other devices and medical alternatives',
      'Data concerning the medical conditions that are managed with the device',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['Device under evaluation'],
    userSelectedOptions: ['Device under evaluation'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemB_aspectsCovered: {
    id: 'rel_aspects',
    title: 'What aspects are covered?',
    description: 'MEDDEV 2.7.1 (Rev.4) Section 9.3.2 c',
    options: [
      'Pivotal performance data',
      'Pivotal safety data',
      'Claims',
      'Identification of hazards',
      'Estimation and management of risks',
      'Establishment of current knowledge / the state of the art',
      'Determination and justification of criteria for the evaluation of the risk/benefit relationship',
      'Determination and justification of criteria for the evaluation of acceptability of undesirable side-effects',
      'Determination of equivalence',
      'Justification of the validity of surrogate endpoints',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['Pivotal performance data', 'Pivotal safety data'],
    userSelectedOptions: ['Pivotal performance data', 'Pivotal safety data'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemC_intendedPurposeClaims: {
    id: 'rel_purpose_claims',
    title: 'Are the data relevant to the intended purpose of the device or to claims about the device?',
    description: 'MEDDEV 2.7.1 (Rev.4) Section 9.3.2 c',
    options: [
      'Representative of the entire intended purpose with all patient populations and all claims foreseen for the device under evaluation',
      'Concerns specific models / sizes / settings, or concerns specific aspects of the intended purpose or of claims',
      'Does not concern the intended purpose or claims',
    ],
    isMultiSelect: false,
    aiSelectedOptions: ['Concerns specific models / sizes / settings, or concerns specific aspects of the intended purpose or of claims'],
    userSelectedOptions: ['Concerns specific models / sizes / settings, or concerns specific aspects of the intended purpose or of claims'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemD_modelSizeSetting: {
    id: 'rel_model_size',
    title: '- Model, size, or setting of the device?',
    description: 'Diameter, Length, delivery system models or dose settings',
    options: [
      'Smallest / intermediate / largest size',
      'Lowest / intermediate / highest dose',
      'Etc.',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['Etc.'],
    userSelectedOptions: ['Etc.'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemE_userGroup: {
    id: 'rel_user_group',
    title: '- User group?',
    description: 'Specialists, practitioners, nurses, etc.',
    options: [
      'Specialists',
      'General practitioners',
      'Nurses',
      'Adult healthy lay persons',
      'Disabled persons',
      'Children',
      'Etc.',
    ],
    isMultiSelect: false,
    aiSelectedOptions: ['Specialists'],
    userSelectedOptions: ['Specialists'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemF_medicalIndication: {
    id: 'rel_indication',
    title: '- Medical indication (if applicable)?',
    description: 'Specific medical condition/indication reported',
    options: [
      'Migraine prophylaxis',
      'Treatment of acute migraine',
      'Rehabilitation after stroke',
      'Etc.',
    ],
    isMultiSelect: false,
    aiSelectedOptions: ['Etc.'],
    userSelectedOptions: ['Etc.'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemG_ageGroup: {
    id: 'rel_age_group',
    title: '- Age group?',
    description: 'Reported patient age category',
    options: [
      'pre-term infants',
      'neonates',
      'children',
      'adolescents',
      'adults',
      'old age',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['adults', 'old age'],
    userSelectedOptions: ['adults', 'old age'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemH_gender: {
    id: 'rel_gender',
    title: '- Gender?',
    description: 'Patient sex/gender distribution by cohort/group',
    options: [
      'Female',
      'Male',
    ],
    isMultiSelect: true,
    aiSelectedOptions: [],
    userSelectedOptions: [],
    evidence: { quote: 'Not reported', location: 'Not reported' },
    comment: 'Not reported',
    status: 'Not reported',
  },
  itemI_typeSeverityCondition: {
    id: 'rel_severity',
    title: '- Type and severity of the medical condition?',
    description: 'Stage, severity, acute/chronic phase (or Etc. with baseline condition; complications/AEs excluded)',
    options: [
      'Early stage',
      'Late stage',
      'Mild',
      'Intermediate',
      'Serious form',
      'Acute phase',
      'Chronic phase',
      'Etc.',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['Etc.'],
    userSelectedOptions: ['Etc.'],
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  itemJ_rangeOfTime: {
    id: 'rel_range_time',
    title: '- Range of time?',
    description: 'Device use duration (stent patency), explicitly reported repeat exposures/reinterventions, and clinical follow-up duration (or survival proxy)',
    options: [
      'Duration of application or use',
      'Number of repeat exposures',
      'Duration of follow-up',
    ],
    isMultiSelect: true,
    aiSelectedOptions: ['Duration of application or use', 'Duration of follow-up'],
    userSelectedOptions: ['Duration of application or use', 'Duration of follow-up'],
    evidence: { quote: '', location: '' },
    comment: 'Duration of application or use: Not reported\nNumber of repeat exposures: Not reported\nDuration of follow-up: Not reported',
    status: 'Reported',
    rangeOfTimeDetails: {
      durationOfApplicationOrUse: 'Not reported',
      numberOfRepeatExposures: 'Not reported',
      durationOfFollowUp: 'Not reported',
      isFollowUpProxySurvival: false,
    },
  },
};

/**
 * 3. Methodological Appraisal
 * Reference: MEDDEV 2.7.1 (Rev.4)’s Appendix 6
 * Max score: 12 (2 + 2 + 2 + 2 + 2 + 1 + 1)
 */
export const DEFAULT_METHODOLOGICAL_CRITERIA: MethodologicalAppraisalState = {
  informationElementary: {
    id: 'meth_elementary',
    name: 'Information on elementary aspects',
    question: 'Information on elementary aspects (Method, Identification of device, Clinical outcome)',
    maxScore: 2,
    options: [
      { label: 'Adequate (2)', score: 2, description: 'Adequate (2)' },
      { label: 'Non adequate (1)', score: 1, description: 'Non adequate (1)' },
    ],
    aiRecommendedSelection: 'Adequate (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Adequate (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
    subElements: [
      { label: 'Method', value: '', reported: true, quote: '', location: '' },
      { label: 'Identification of the device', value: '', reported: true, quote: '', location: '' },
      { label: 'Clinical outcome', value: '', reported: true, quote: '', location: '' },
    ],
  },
  patientsNumber: {
    id: 'meth_patients_number',
    name: 'Patients number',
    question: 'Patients number (>=30: High, 11-29: Medium, 1-10: Poor)',
    maxScore: 2,
    options: [
      { label: 'High(30-) (2)', score: 2, description: 'High(30-) (2)' },
      { label: 'Medium(11-29) (1)', score: 1, description: 'Medium(11-29) (1)' },
      { label: 'Poor(1-10) (0)', score: 0, description: 'Poor(1-10) (0)' },
    ],
    aiRecommendedSelection: 'High(30-) (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'High(30-) (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  statisticalMethods: {
    id: 'meth_statistical',
    name: 'Statistical method(s)',
    question: 'Statistical method(s)',
    maxScore: 2,
    options: [
      { label: 'Adequate (2)', score: 2, description: 'Adequate (2)' },
      { label: 'Non adequate (1)', score: 1, description: 'Non adequate (1)' },
    ],
    aiRecommendedSelection: 'Adequate (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Adequate (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  adequateControls: {
    id: 'meth_controls',
    name: 'Adequate controls',
    question: 'Adequate controls',
    maxScore: 2,
    options: [
      { label: 'Adequate (2)', score: 2, description: 'Adequate (2)' },
      { label: 'Non adequate (1)', score: 1, description: 'Non adequate (1)' },
    ],
    aiRecommendedSelection: 'Adequate (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Adequate (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  collectionMortalityAE: {
    id: 'meth_mortality_ae',
    name: 'Collection of mortality and serious adverse events data',
    question: 'Collection of mortality and serious adverse events data',
    maxScore: 2,
    options: [
      { label: 'Adequate (2)', score: 2, description: 'Adequate (2)' },
      { label: 'Non adequate (1)', score: 1, description: 'Non adequate (1)' },
    ],
    aiRecommendedSelection: 'Adequate (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Adequate (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  interpretationAuthors: {
    id: 'meth_interpretation',
    name: 'Interpretation of the authors',
    question: 'Interpretation of the authors',
    maxScore: 1,
    options: [
      { label: 'Good (1)', score: 1, description: 'Good (1)' },
      { label: 'Misinterpretation (0)', score: 0, description: 'Misinterpretation (0)' },
    ],
    aiRecommendedSelection: 'Good (1)',
    aiRecommendedScore: 1,
    userFinalSelection: 'Good (1)',
    userFinalScore: 1,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  studyLegality: {
    id: 'meth_legality',
    name: 'Study legality',
    question: 'Study legality',
    maxScore: 1,
    options: [
      { label: 'Legal (1)', score: 1, description: 'Legal (1)' },
      { label: 'Illegal (0)', score: 0, description: 'Illegal (0)' },
    ],
    aiRecommendedSelection: 'Legal (1)',
    aiRecommendedScore: 1,
    userFinalSelection: 'Legal (1)',
    userFinalScore: 1,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  totalScoreAi: 12,
  totalScoreUser: 12,
  gradeAi: 'Excellent',
  gradeUser: 'Excellent',
};

export function calculateMethodologicalGrade(totalScore: number): 'Excellent' | 'Very Good' | 'Good' | 'Poor' {
  if (totalScore >= 10) return 'Excellent';
  if (totalScore >= 8) return 'Very Good';
  if (totalScore >= 6) return 'Good';
  return 'Poor';
}

/**
 * 4. Appraisal Criteria for Data Contribution
 * Reference: IMDRF MDCE WG/N56FINAL:2019's Appendices D1
 * Max score: 10 (2 + 2 + 2 + 2 + 2)
 */
export const DEFAULT_CONTRIBUTION_CRITERIA: ContributionAppraisalState = {
  dataSourceType: {
    id: 'cont_data_source',
    name: 'Data source type: Was the design of the study appropriate?',
    question: 'Was the design of the study appropriate?',
    maxScore: 2,
    options: [
      { label: 'Yes (2)', score: 2, description: 'Yes (2)' },
      { label: 'No (1)', score: 1, description: 'No (1)' },
    ],
    aiRecommendedSelection: 'Yes (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Yes (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  outcomeMeasures: {
    id: 'cont_outcomes',
    name: 'Outcome measures: Does the outcome measures reported reflect the intended performance of the device?',
    question: 'Does the outcome measures reported reflect the intended performance of the device?',
    maxScore: 2,
    options: [
      { label: 'Yes (2)', score: 2, description: 'Yes (2)' },
      { label: 'No (1)', score: 1, description: 'No (1)' },
    ],
    aiRecommendedSelection: 'Yes (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Yes (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  followUp: {
    id: 'cont_followup',
    name: 'Follow up: Long enough to assess whether duration of treatment effects and identify complications?',
    question: 'Long enough to assess whether duration of treatment effects and identify complications?',
    maxScore: 2,
    options: [
      { label: 'Yes (2)', score: 2, description: 'Yes (2)' },
      { label: 'No (1)', score: 1, description: 'No (1)' },
    ],
    aiRecommendedSelection: 'Yes (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Yes (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  statisticalSignificance: {
    id: 'cont_statistical_significance',
    name: 'Statistical significance: Has a statistical analysis of the data been provided and is it appropriate?',
    question: 'Has a statistical analysis of the data been provided and is it appropriate?',
    maxScore: 2,
    options: [
      { label: 'Yes (2)', score: 2, description: 'Yes (2)' },
      { label: 'No (1)', score: 1, description: 'No (1)' },
    ],
    aiRecommendedSelection: 'Yes (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Yes (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  clinicalSignificance: {
    id: 'cont_clinical_significance',
    name: 'Clinical significance: Was the magnitude of the treatment effect observed clinically significant?',
    question: 'Was the magnitude of the treatment effect observed clinically significant?',
    maxScore: 2,
    options: [
      { label: 'Yes (2)', score: 2, description: 'Yes (2)' },
      { label: 'No (1)', score: 1, description: 'No (1)' },
    ],
    aiRecommendedSelection: 'Yes (2)',
    aiRecommendedScore: 2,
    userFinalSelection: 'Yes (2)',
    userFinalScore: 2,
    evidence: { quote: '', location: '' },
    comment: '',
    status: 'Reported',
  },
  totalScoreAi: 10,
  totalScoreUser: 10,
  gradeAi: 'Excellent',
  gradeUser: 'Excellent',
};

export function calculateContributionGrade(totalScore: number): 'Excellent' | 'Very Good' | 'Good' | 'Poor' {
  if (totalScore >= 10) return 'Excellent';
  if (totalScore >= 8) return 'Very Good';
  if (totalScore >= 6) return 'Good';
  return 'Poor';
}

/**
 * 5. Overall Appraisal
 * Reference: Appraisal Plan Page 4
 * "The overall appraisal shall totalize the result of the Methodological appraisal (12), the relevance appraisal (11), and the contribution appraisal (10)."
 * Total Max Score: 33 (11 + 12 + 10)
 * 31 to 33: Excellent
 * 26 to 30: Very Good
 * 20 to 25: Good
 * 12 to 19: Poor
 * Acceptance criteria: The overall result should be Very Good or Excellent.
 */
export function calculateOverallAppraisal(
  suitabilityScore: number,
  methodologicalScore: number,
  contributionScore: number
): OverallAppraisalState {
  const suitabilityGrade = calculateSuitabilityGrade(suitabilityScore);
  const methodologicalGrade = calculateMethodologicalGrade(methodologicalScore);
  const contributionGrade = calculateContributionGrade(contributionScore);

  const totalScore = suitabilityScore + methodologicalScore + contributionScore;
  const maxTotalScore = 11 + 12 + 10; // 33

  let overallGrade: 'Excellent' | 'Very Good' | 'Good' | 'Poor';
  if (totalScore >= 31) {
    overallGrade = 'Excellent';
  } else if (totalScore >= 26) {
    overallGrade = 'Very Good';
  } else if (totalScore >= 20) {
    overallGrade = 'Good';
  } else {
    overallGrade = 'Poor';
  }

  // Acceptance Decision Rule:
  // "Overall Grade가 Excellent 또는 Very Good이면 Accepted로 표시한다.
  // Overall Grade가 Good, Poor, Not assessable 또는 Excellent / Very Good 이외의 결과이면 큰 빨간색 REJECTED 표시를 한다."
  const overallResult: 'Accepted' | 'REJECTED' =
    overallGrade === 'Excellent' || overallGrade === 'Very Good' ? 'Accepted' : 'REJECTED';

  return {
    suitabilitySummary: {
      sectionName: 'Suitability Criteria',
      userScore: suitabilityScore,
      maxScore: 11,
      grade: suitabilityGrade,
    },
    methodologicalSummary: {
      sectionName: 'Methodological Appraisal',
      userScore: methodologicalScore,
      maxScore: 12,
      grade: methodologicalGrade,
    },
    contributionSummary: {
      sectionName: 'Contribution Criteria',
      userScore: contributionScore,
      maxScore: 10,
      grade: contributionGrade,
    },
    totalScore,
    maxTotalScore,
    overallGrade,
    overallResult,
  };
}
