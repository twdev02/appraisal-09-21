import type {
  ArticleMetadata,
  ContributionAppraisalState,
  DemographicEvidenceValidationItem,
  EvidenceValidationState,
  MethodologicalAppraisalState,
  RelevanceAppraisalState,
  SourceConflictChoice,
} from '../types';
import {
  calculateContributionGrade,
  calculateMethodologicalGrade,
} from '../data/appraisalStandards';

export type SourceConflictField = 'patientCount' | 'gender' | 'followUp' | 'clinicalOutcome';

export interface SourceConflictState {
  articleMetadata: ArticleMetadata;
  relevance: RelevanceAppraisalState;
  methodological: MethodologicalAppraisalState;
  contribution: ContributionAppraisalState;
  evidenceValidation?: EvidenceValidationState;
}

const RESOLUTION_MARKER = '\nReviewer source selection:';

// Replaces any earlier reviewer note so switching the choice does not stack notes.
function withResolutionNote(comment: string, choice: SourceConflictChoice, item: DemographicEvidenceValidationItem): string {
  const base = String(comment || '').split(RESOLUTION_MARKER)[0];
  const note = choice === 'pdf'
    ? `PDF/Gemini value selected over Markdown (${item.markdownValue}).`
    : `Markdown value selected over PDF/Gemini (${item.pdfValue}).`;
  return `${base}${RESOLUTION_MARKER} ${note}`;
}

function chosenEvidence(choice: SourceConflictChoice, item: DemographicEvidenceValidationItem) {
  return choice === 'markdown'
    ? { quote: item.evidenceQuote || item.markdownValue, location: item.evidenceLocation || 'Markdown' }
    : { quote: item.pdfValue, location: 'PDF/Gemini extraction' };
}

// Mirrors the server-side patient count rule in buildAppraisalScoring.
export function patientCountScore(value: unknown): { selection: string; score: number } {
  const n = parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  if (isNaN(n)) return { selection: 'Poor(1-10) (0)', score: 0 };
  if (n >= 30) return { selection: 'High(30-) (2)', score: 2 };
  if (n >= 11) return { selection: 'Medium(11-29) (1)', score: 1 };
  return { selection: 'Poor(1-10) (0)', score: 0 };
}

function methodologicalTotal(m: MethodologicalAppraisalState): number {
  return m.informationElementary.userFinalScore + m.patientsNumber.userFinalScore +
    m.statisticalMethods.userFinalScore + m.adequateControls.userFinalScore +
    m.collectionMortalityAE.userFinalScore + m.interpretationAuthors.userFinalScore +
    m.studyLegality.userFinalScore;
}

function methodologicalAiTotal(m: MethodologicalAppraisalState): number {
  return m.informationElementary.aiRecommendedScore + m.patientsNumber.aiRecommendedScore +
    m.statisticalMethods.aiRecommendedScore + m.adequateControls.aiRecommendedScore +
    m.collectionMortalityAE.aiRecommendedScore + m.interpretationAuthors.aiRecommendedScore +
    m.studyLegality.aiRecommendedScore;
}

function contributionTotal(c: ContributionAppraisalState): number {
  return c.dataSourceType.userFinalScore + c.outcomeMeasures.userFinalScore +
    c.followUp.userFinalScore + c.statisticalSignificance.userFinalScore +
    c.clinicalSignificance.userFinalScore;
}

/**
 * Applies a reviewer's choice between the PDF/Gemini and Markdown values of a
 * source conflict to every place that value feeds, and records the choice so
 * self-validation stops flagging it. Choosing again simply re-applies.
 */
export function applySourceConflictChoice(
  state: SourceConflictState,
  field: SourceConflictField,
  choice: SourceConflictChoice,
  now: Date = new Date()
): SourceConflictState {
  const item = state.evidenceValidation?.[field];
  if (!state.evidenceValidation || !item || item.status !== 'conflict') return state;

  const value = choice === 'pdf' ? item.pdfValue : item.markdownValue;
  const evidence = chosenEvidence(choice, item);
  let { articleMetadata, relevance, methodological, contribution } = state;

  if (field === 'patientCount') {
    articleMetadata = { ...articleMetadata, totalPatientCount: value };
    const { selection, score } = patientCountScore(value);
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    const current = methodological.patientsNumber;
    // A score the reviewer set by hand differs from the recommendation; keep it.
    // The recommendation itself follows the chosen source, so switching sources
    // later is not mistaken for a manual edit.
    const manuallyScored = current.userFinalScore !== current.aiRecommendedScore ||
      current.userFinalSelection !== current.aiRecommendedSelection;
    const baseComment = isNaN(n) ? current.comment : `Total sample size: ${n} patients evaluated.`;
    methodological = {
      ...methodological,
      patientsNumber: {
        ...current,
        aiRecommendedSelection: selection,
        aiRecommendedScore: score,
        userFinalSelection: manuallyScored ? current.userFinalSelection : selection,
        userFinalScore: manuallyScored ? current.userFinalScore : score,
        evidence,
        comment: withResolutionNote(baseComment, choice, item) +
          (manuallyScored ? ` Reviewer-set score kept (${current.userFinalSelection}); recommended for this count: ${selection}.` : ''),
      },
    };
    methodological.totalScoreUser = methodologicalTotal(methodological);
    methodological.gradeUser = calculateMethodologicalGrade(methodological.totalScoreUser);
    methodological.totalScoreAi = methodologicalAiTotal(methodological);
    methodological.gradeAi = calculateMethodologicalGrade(methodological.totalScoreAi);
  }

  if (field === 'gender') {
    const options = [
      ...(/(?:^|[—,;\n]\s*)Female:\s*n\s*=\s*\d+/i.test(value) ? ['Female'] : []),
      ...(/(?:^|[—,;\n]\s*)Male:\s*n\s*=\s*\d+/i.test(value) ? ['Male'] : []),
    ];
    relevance = {
      ...relevance,
      itemH_gender: {
        ...relevance.itemH_gender,
        userSelectedOptions: options.length ? options : relevance.itemH_gender.userSelectedOptions,
        evidence,
        comment: withResolutionNote(value, choice, item),
      },
    };
  }

  if (field === 'followUp') {
    articleMetadata = { ...articleMetadata, followUpPeriod: value };
    const range = relevance.itemJ_rangeOfTime;
    relevance = {
      ...relevance,
      itemJ_rangeOfTime: {
        ...range,
        rangeOfTimeDetails: { ...range.rangeOfTimeDetails, durationOfFollowUp: value },
        comment: withResolutionNote(range.comment, choice, item),
      },
    };
    contribution = {
      ...contribution,
      followUp: {
        ...contribution.followUp,
        evidence,
        comment: withResolutionNote(contribution.followUp.comment, choice, item),
      },
    };
  }

  if (field === 'clinicalOutcome') {
    contribution = {
      ...contribution,
      outcomeMeasures: {
        ...contribution.outcomeMeasures,
        evidence,
        comment: withResolutionNote(contribution.outcomeMeasures.comment, choice, item),
      },
      clinicalSignificance: {
        ...contribution.clinicalSignificance,
        evidence,
        comment: withResolutionNote(contribution.clinicalSignificance.comment, choice, item),
      },
    };
  }

  if (contribution !== state.contribution) {
    contribution.totalScoreUser = contributionTotal(contribution);
    contribution.gradeUser = calculateContributionGrade(contribution.totalScoreUser);
  }

  return {
    articleMetadata,
    relevance,
    methodological,
    contribution,
    evidenceValidation: {
      ...state.evidenceValidation,
      [field]: {
        ...item,
        selectedValue: value,
        resolution: { choice, resolvedAt: now.toISOString() },
      },
    },
  };
}
