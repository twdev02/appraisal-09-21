import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { PDFParse } from 'pdf-parse';
import dotenv from 'dotenv';
import {
  DueItem,
  DueSetup,
  SimilarDevice,
  FullAppraisalData,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
} from './src/types';
import {
  classifyDeviceRelationship,
  classifyIndicationRelationship,
  classifyDeviceWithInventory,
  evaluateIndicationWithInventory,
  parseStructuredSafetyTableFromText,
  verifySafetyTableCompleteness,
  parseRangeOfTimeData,
  determineAspectsCovered,
  formatGenderDistribution,
  classifyDeviceWithAnatomicalContext,
  cleanExtractedIndicationText,
} from './src/utils/nlpRules';
import { runSelfValidation } from './src/utils/selfValidation';
import {
  DEFAULT_SUITABILITY_CRITERIA,
  DEFAULT_RELEVANCE_ITEMS,
  DEFAULT_METHODOLOGICAL_CRITERIA,
  DEFAULT_CONTRIBUTION_CRITERIA,
  calculateSuitabilityGrade,
  calculateMethodologicalGrade,
  calculateContributionGrade,
} from './src/data/appraisalStandards';
import {
  searchPubmedPmids,
  fetchPubmedArticle,
  fetchPmcFullText,
  searchClinicalTrialsStudies,
  runGeminiScreening,
} from './server/screeningService';

dotenv.config();


type SafetyHierarchyRelationship = 'none' | 'aggregate' | 'component' | 'cause' | 'unclear';
type SafetyHierarchyConfidence = 'High' | 'Medium' | 'Low';
type SafetyCountUnit = 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown';
type PercentageAssessmentStatus = 'reported_verified' | 'calculated' | 'reported_only' | 'review_required' | 'not_available';

function normalizeSafetyCountUnit(value: unknown): SafetyCountUnit {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (/patient|participant|subject|person/.test(normalized)) return 'patients';
  if (/procedure|intervention|placement|session/.test(normalized)) return 'procedures';
  if (/episode/.test(normalized)) return 'episodes';
  if (/event|occurrence|complication/.test(normalized)) return 'events';
  return 'unknown';
}

function normalizeMultipleEventsFlag(value: unknown): 'Yes' | 'No' | 'Not reported' | 'Unclear' {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const normalized = String(value ?? '').toLowerCase().trim();
  if (/^(yes|true|present|reported)$/.test(normalized)) return 'Yes';
  if (/^(no|false|absent|not present)$/.test(normalized)) return 'No';
  if (/unclear|ambig/.test(normalized)) return 'Unclear';
  return 'Not reported';
}

function hasMultipleSafetyEventsPerPatientWarning(text: unknown): boolean {
  const value = String(text ?? '');
  if (!value.trim()) return false;
  const patterns = [
    /(?:some|one|individual|the same)\s+patients?[^.\n]{0,120}(?:more than one|multiple|two or more|several)\s+(?:adverse\s+events?|complications?|events?|occurrences?)/i,
    /patients?[^.\n]{0,120}(?:could|may|might|can|did|had|experienced|developed)[^.\n]{0,80}(?:more than one|multiple|two or more|several)\s+(?:adverse\s+events?|complications?|events?|occurrences?)/i,
    /(?:more than one|multiple|two or more|several)\s+(?:adverse\s+events?|complications?|events?|occurrences?)[^.\n]{0,120}(?:same|single|one)\s+patient/i,
    /(?:events?|complications?|adverse\s+events?)\s+(?:were|are|may be|can be)\s+not\s+mutually\s+exclusive/i,
    /(?:number|count)\s+of\s+(?:events?|complications?)[^.\n]{0,100}(?:exceed|greater than)[^.\n]{0,80}(?:number|count)\s+of\s+patients?/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function parsePercentageNumber(value: unknown): number | null {
  const match = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function assessSafetyPercentage(
  event: any,
  countN: string,
  reportedRateRaw: string,
  paperText: string
): {
  reportedRate: string;
  calculatedRate: string;
  percentageSource: 'Reported' | 'Calculated';
  percentageAssessmentStatus: PercentageAssessmentStatus;
  percentageAssessmentNote: string;
  numeratorType: SafetyCountUnit;
  denominatorType: SafetyCountUnit;
  multipleEventsPerPatient: 'Yes' | 'No' | 'Not reported' | 'Unclear';
  percentageContextQuote: string;
  percentageContextLocation: string;
  calculationBasis: string;
} {
  const reportedRate = reportedRateRaw && reportedRateRaw !== 'Not reported'
    ? String(reportedRateRaw).trim()
    : 'Not reported';
  const countMatch = String(countN || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const numeratorType = normalizeSafetyCountUnit(
    event?.numeratorType ?? event?.numeratorUnit ?? event?.countUnit ?? event?.countType
  );
  const denominatorType = normalizeSafetyCountUnit(
    event?.denominatorType ?? event?.denominatorUnit ?? event?.populationUnit
  );
  const multipleEventsPerPatient = normalizeMultipleEventsFlag(
    event?.multipleEventsPerPatient ?? event?.multipleEventsPossible ?? event?.overlappingEvents
  );
  const percentageContextQuote = String(
    event?.percentageContextQuote ?? event?.countInterpretationQuote ?? event?.footnoteQuote ?? ''
  ).trim();
  const percentageContextLocation = String(
    event?.percentageContextLocation ?? event?.countInterpretationLocation ?? event?.footnoteLocation ?? ''
  ).trim();

  const localContext = [
    event?.evidenceQuote,
    event?.hierarchyReason,
    percentageContextQuote,
  ].filter(Boolean).join(' ');
  const localOverlapWarning = hasMultipleSafetyEventsPerPatientWarning(localContext);
  const documentOverlapWarning = hasMultipleSafetyEventsPerPatientWarning(paperText);
  const overlapWarning =
    multipleEventsPerPatient === 'Yes' ||
    localOverlapWarning ||
    (documentOverlapWarning && multipleEventsPerPatient !== 'No');

  const explicitlyUnsafeUnit =
    numeratorType === 'events' ||
    numeratorType === 'episodes' ||
    numeratorType === 'procedures' ||
    (denominatorType !== 'unknown' && numeratorType !== 'unknown' && numeratorType !== denominatorType);

  if (!countMatch) {
    return {
      reportedRate,
      calculatedRate: 'Not reported',
      percentageSource: 'Reported',
      percentageAssessmentStatus: reportedRate !== 'Not reported' ? 'reported_only' : 'not_available',
      percentageAssessmentNote:
        reportedRate !== 'Not reported'
          ? 'Percentage is reported in the paper, but a valid n/N pair was not available for independent calculation.'
          : 'Percentage cannot be calculated because a valid n/N pair was not available.',
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis: 'Not available',
    };
  }

  const nVal = Number(countMatch[1]);
  const totalVal = Number(countMatch[2]);
  const calculationBasis = `${countMatch[1]}/${countMatch[2]}`;

  if (!Number.isFinite(nVal) || !Number.isFinite(totalVal) || totalVal <= 0) {
    return {
      reportedRate,
      calculatedRate: 'Not reported',
      percentageSource: reportedRate !== 'Not reported' ? 'Reported' : 'Calculated',
      percentageAssessmentStatus: reportedRate !== 'Not reported' ? 'reported_only' : 'not_available',
      percentageAssessmentNote: 'Percentage cannot be calculated because the denominator is invalid or zero.',
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis,
    };
  }

  if (overlapWarning || explicitlyUnsafeUnit || multipleEventsPerPatient === 'Unclear') {
    let reason = 'Automatic percentage calculation was withheld because the numerator/denominator meaning is not safely patient-based.';
    if (overlapWarning) {
      reason = 'Automatic percentage calculation was withheld because the paper indicates that one patient may contribute more than one complication/event.';
    } else if (explicitlyUnsafeUnit) {
      reason = `Automatic percentage calculation was withheld because the numerator is classified as ${numeratorType} while the denominator is ${denominatorType}.`;
    } else if (multipleEventsPerPatient === 'Unclear') {
      reason = 'Automatic percentage calculation was withheld because possible multiple events per patient could not be excluded.';
    }

    return {
      reportedRate,
      calculatedRate: 'Not reported',
      percentageSource: reportedRate !== 'Not reported' ? 'Reported' : 'Calculated',
      percentageAssessmentStatus: 'review_required',
      percentageAssessmentNote: reason,
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis,
    };
  }

  const calculatedValue = (nVal / totalVal) * 100;
  const calculatedRate = `${calculatedValue.toFixed(1)}%`;

  if (reportedRate === 'Not reported') {
    return {
      reportedRate,
      calculatedRate,
      percentageSource: 'Calculated',
      percentageAssessmentStatus: 'calculated',
      percentageAssessmentNote: 'Percentage calculated from the extracted n/N. No multiple-event-per-patient warning was identified in the table note, caption, or surrounding text.',
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis,
    };
  }

  const reportedValue = parsePercentageNumber(reportedRate);
  if (reportedValue === null) {
    return {
      reportedRate,
      calculatedRate,
      percentageSource: 'Reported',
      percentageAssessmentStatus: 'reported_only',
      percentageAssessmentNote: 'The paper reports a percentage, but its format is not suitable for numeric verification. The reported value is preserved.',
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis,
    };
  }

  // Allow ordinary rounding differences (for example 3/26 = 11.538... reported as 11.5%).
  const difference = Math.abs(reportedValue - calculatedValue);
  if (difference <= 0.2) {
    return {
      reportedRate,
      calculatedRate,
      percentageSource: 'Reported',
      percentageAssessmentStatus: 'reported_verified',
      percentageAssessmentNote: `Reported percentage (${reportedRate}) agrees with n/N calculation (${calculatedRate}) within rounding tolerance.`,
      numeratorType,
      denominatorType,
      multipleEventsPerPatient,
      percentageContextQuote,
      percentageContextLocation,
      calculationBasis,
    };
  }

  return {
    reportedRate,
    calculatedRate,
    percentageSource: 'Reported',
    percentageAssessmentStatus: 'review_required',
    percentageAssessmentNote: `Reported percentage (${reportedRate}) does not agree with n/N calculation (${calculatedRate}); review the denominator, count unit, table footnote, and source row.`,
    numeratorType,
    denominatorType,
    multipleEventsPerPatient,
    percentageContextQuote,
    percentageContextLocation,
    calculationBasis,
  };
}

function normalizeHierarchyText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[™®©℠]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getHierarchyCount(event: any): number | null {
  const explicit = event?.numerator ?? event?.numEvents;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const parsed = Number(String(explicit).trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  const countMatch = String(event?.countN || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/|$)/);
  if (countMatch) {
    const parsed = Number(countMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getHierarchyContextKey(event: any): string {
  const group = normalizeHierarchyText(event?.groupId || event?.groupName || event?.studyGroupOrDevice || '');
  const timing = normalizeHierarchyText(event?.timing || 'overall');
  const rawLocation = normalizeHierarchyText(event?.evidenceLocation || '');
  const tableMatch = rawLocation.match(/\btable\s*(\d+[a-z]?)\b/i);
  const location = tableMatch
    ? `table ${tableMatch[1].toLowerCase()}`
    : rawLocation
        .replace(/\bpage\s+\d+\b/g, '')
        .replace(/\bresults?\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
  return `${group}||${timing}||${location}`;
}

function isAggregateSafetyLabel(name: unknown): boolean {
  const normalized = normalizeHierarchyText(name);
  if (!normalized) return false;
  return (
    /\b(?:overall|total|all)\s+(?:adverse\s+events?|complications?|events?|malfunctions?|dysfunctions?|failures?)\b/.test(normalized) ||
    /\b(?:stent|device|procedure)\s+(?:malfunctions?|dysfunctions?|complications?|failures?)\b/.test(normalized) ||
    /\bother\s+complications?\b/.test(normalized) ||
    /^(?:complications?|adverse\s+events?|malfunctions?|dysfunctions?|failures?)$/.test(normalized)
  );
}

function applyGeneralSafetyHierarchy(events: any[], paperText = ''): any[] {
  if (!Array.isArray(events) || events.length === 0) return events;

  const currentStudyText = (() => {
    const source = String(paperText || '');
    const resultsMatch = source.match(/(?:^|\n)\s*(?:\d+\.?\s*)?results\s*(?:\n|$)([\s\S]*?)(?=(?:\n\s*(?:\d+\.?\s*)?(?:discussion|conclusion|conclusions|references)\b)|$)/i);
    if (resultsMatch?.[1]) return resultsMatch[1];
    return source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
  })();
  const normalizedCurrentStudyText = normalizeHierarchyText(currentStudyText);

  const validEvidenceTypes = new Set(['explicit_text', 'table_structure', 'both']);
  const isUsableEvidence = (event: any) => {
    const evidenceType = String(event?.hierarchyEvidenceType || '').toLowerCase();
    const quote = String(event?.hierarchyEvidenceQuote || '').trim();
    const location = String(event?.hierarchyEvidenceLocation || event?.evidenceLocation || '').trim();
    const confidence = String(event?.hierarchyConfidence || 'Low');
    if (confidence !== 'High' || !validEvidenceTypes.has(evidenceType) || !quote || !location) return false;

    // Explicit-text hierarchy must be grounded in the current-study source itself;
    // a model-generated/paraphrased relationship is not enough.
    if (evidenceType === 'explicit_text' || evidenceType === 'both') {
      const normalizedQuote = normalizeHierarchyText(quote);
      if (!normalizedQuote || !normalizedCurrentStudyText.includes(normalizedQuote)) {
        if (evidenceType === 'explicit_text') return false;
        // With 'both', a clearly identified current-study table can still support
        // the edge even when PDF text extraction prevents exact quote matching.
        if (!/\btable\b/i.test(location)) return false;
      }
    }

    if (evidenceType === 'table_structure') {
      return /\btable\b/i.test(location);
    }
    return true;
  };

  const findParent = (child: any, parentName: string) => {
    const parentKey = normalizeHierarchyText(parentName);
    const childGroup = normalizeHierarchyText(child.groupId || child.groupName || child.studyGroupOrDevice);
    const childTiming = normalizeHierarchyText(child.timing || '');
    const matches = events.filter((candidate) => {
      if (candidate.id === child.id || normalizeHierarchyText(candidate.eventName) !== parentKey) return false;
      const candidateGroup = normalizeHierarchyText(candidate.groupId || candidate.groupName || candidate.studyGroupOrDevice);
      return !(childGroup && candidateGroup && childGroup !== candidateGroup);
    });
    if (matches.length <= 1) return matches[0];

    // Timing is a disambiguator only when duplicate parent labels exist. A parent
    // category can legitimately span different child timings (e.g. a Major
    // complications parent with early and late component events).
    const sameTiming = matches.find((candidate) => normalizeHierarchyText(candidate.timing || '') === childTiming);
    if (sameTiming) return sameTiming;
    const overallParent = matches.find((candidate) => {
      const timing = normalizeHierarchyText(candidate.timing || '');
      return !timing || timing === 'n a' || timing.includes('overall') || timing.includes('not time categorized');
    });
    return overallParent;
  };

  // Normalize the raw model fields first. relationshipType describes the edge TO
  // a parent; whether a row is itself an aggregate parent is stored separately in
  // isAggregate. This allows nested structures such as:
  // Complications -> Major complications -> Tracheal compression.
  events.forEach((event) => {
    const rawRelation = String(event.relationshipType || 'none').toLowerCase();
    event.isAggregate = Boolean(
      event.isAggregate || rawRelation === 'aggregate' || event.hierarchyRole === 'Aggregate event' || event.hierarchyRole === 'Subtotal/Summary'
    );
    event.relationshipType = rawRelation === 'aggregate' ? 'none' : (rawRelation || 'none');
    if (!['none', 'component', 'cause', 'unclear'].includes(event.relationshipType)) {
      event.relationshipType = 'none';
    }
    event.hierarchyEvidenceType = event.hierarchyEvidenceType || 'none';
    event.hierarchyConfidence = event.hierarchyConfidence || 'Low';
    event.breakdownCompleteness = event.breakdownCompleteness || 'Unknown';
    event.isSubItem = false;
    event.parentEventId = undefined;
    event.hierarchyLevel = 0;
    if (!event.hierarchyRole || event.hierarchyRole === 'Aggregate event' || event.hierarchyRole === 'Subtotal/Summary') {
      event.hierarchyRole = 'Independent event';
    }
  });

  // 1) Link component/cause rows ONLY when the source relationship itself is
  // explicitly supported. Counts, row proximity, semantic similarity, or matching
  // totals can validate a relationship but can NEVER create one.
  for (const child of events) {
    const suggestedParentName = child.parentEvent || child.linkedParentEvent || child.parentEventName;
    if (!suggestedParentName) continue;

    const relation = child.relationshipType === 'cause' || child.eventType === 'Cause of Recurrence'
      ? 'cause'
      : 'component';
    const parent = findParent(child, suggestedParentName);

    if (!parent || !isUsableEvidence(child)) {
      child.parentEvent = undefined;
      child.parentEventId = undefined;
      child.isSubItem = false;
      child.relationshipType = 'none';
      child.hierarchyRole = 'Independent event';
      child.hierarchyConfidence = 'Low';
      child.classificationStatus = 'review_required';
      child.reviewReason = child.reviewReason || (
        !parent
          ? `Suggested parent "${suggestedParentName}" could not be matched to a reported event row.`
          : `Possible relationship to "${suggestedParentName}" was not applied because explicit source hierarchy evidence was not sufficient.`
      );
      continue;
    }

    child.parentEvent = parent.eventName;
    child.parentEventId = parent.id;
    child.isSubItem = true;
    child.relationshipType = relation;
    child.hierarchyRole = relation === 'cause' ? 'Cause event' : 'Component event';
    child.classificationStatus = 'classified';
    child.hierarchyConfidence = 'High';

    if (relation === 'component') {
      parent.isAggregate = true;
    }
  }

  // 2) Explicit causal prose is independently sufficient evidence. This pass is
  // intentionally strict: both event names and a causal connector must occur in
  // the same Results/current-study sentence. It does not use Discussion-only text.
  const sentences = currentStudyText
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((raw) => ({ raw: raw.trim(), normalized: normalizeHierarchyText(raw) }))
    .filter((item) => item.normalized.length > 0);
  const forwardCauseMarkers = ['because of', 'due to', 'caused by', 'secondary to', 'resulting from', 'attributed to', 'causes were', 'causes included'];
  const reverseCauseMarkers = ['caused', 'causing', 'resulted in', 'leading to', 'led to'];

  for (const causeCandidate of events) {
    if (causeCandidate.parentEventId) continue;
    const causeName = normalizeHierarchyText(causeCandidate.eventName);
    if (!causeName || causeName.length < 4) continue;

    for (const parentCandidate of events) {
      if (parentCandidate.id === causeCandidate.id) continue;
      const sameGroup = normalizeHierarchyText(parentCandidate.groupId || parentCandidate.groupName || parentCandidate.studyGroupOrDevice) ===
        normalizeHierarchyText(causeCandidate.groupId || causeCandidate.groupName || causeCandidate.studyGroupOrDevice);
      if (!sameGroup) continue;
      const parentName = normalizeHierarchyText(parentCandidate.eventName);
      if (!parentName || parentName.length < 4) continue;

      const supportingSentence = sentences.find(({ normalized }) => {
        const parentIndex = normalized.indexOf(parentName);
        const causeIndex = normalized.indexOf(causeName);
        if (parentIndex < 0 || causeIndex < 0) return false;
        for (const marker of forwardCauseMarkers) {
          const markerIndex = normalized.indexOf(marker);
          if (markerIndex > parentIndex && causeIndex > markerIndex) return true;
        }
        for (const marker of reverseCauseMarkers) {
          const markerIndex = normalized.indexOf(marker);
          if (causeIndex < markerIndex && markerIndex < parentIndex) return true;
        }
        return false;
      });
      if (!supportingSentence) continue;

      causeCandidate.parentEvent = parentCandidate.eventName;
      causeCandidate.parentEventId = parentCandidate.id;
      causeCandidate.isSubItem = true;
      causeCandidate.relationshipType = 'cause';
      causeCandidate.hierarchyRole = 'Cause event';
      causeCandidate.hierarchyConfidence = 'High';
      causeCandidate.hierarchyEvidenceType = causeCandidate.hierarchyEvidenceType === 'table_structure' ? 'both' : 'explicit_text';
      causeCandidate.hierarchyEvidenceQuote = causeCandidate.hierarchyEvidenceQuote || supportingSentence.raw;
      causeCandidate.hierarchyEvidenceLocation = causeCandidate.hierarchyEvidenceLocation || 'Results / current-study text';
      causeCandidate.hierarchyReason = causeCandidate.hierarchyReason || 'Cause relationship explicitly stated in the current-study text.';
      causeCandidate.classificationStatus = 'classified';
      break;
    }
  }

  // 3) Reject cycles before calculating depth. Cyclic/invalid suggestions are kept
  // as flat review items rather than forcing an incorrect hierarchy.
  const byId = new Map(events.map((event) => [event.id, event]));
  const createsCycle = (event: any) => {
    const seen = new Set<string>([event.id]);
    let current = event;
    while (current?.parentEventId) {
      const pid = String(current.parentEventId);
      if (seen.has(pid)) return true;
      seen.add(pid);
      current = byId.get(pid);
      if (!current) break;
    }
    return false;
  };
  for (const event of events) {
    if (!event.parentEventId || !createsCycle(event)) continue;
    event.parentEvent = undefined;
    event.parentEventId = undefined;
    event.isSubItem = false;
    event.relationshipType = 'none';
    event.hierarchyRole = 'Independent event';
    event.hierarchyConfidence = 'Low';
    event.classificationStatus = 'review_required';
    event.reviewReason = event.reviewReason || 'Hierarchy cycle detected; relationship was not applied.';
  }

  // 4) Mark parents and validate arithmetic AFTER links already exist. Arithmetic
  // is validation evidence only; it never creates parent/child links.
  for (const parent of events) {
    const componentChildren = events.filter(
      (child) => child.parentEventId === parent.id && child.relationshipType === 'component'
    );
    const causeChildren = events.filter(
      (child) => child.parentEventId === parent.id && child.relationshipType === 'cause'
    );
    if (componentChildren.length > 0) parent.isAggregate = true;
    if (componentChildren.length === 0) continue;

    const parentCount = getHierarchyCount(parent);
    const childCounts = componentChildren.map(getHierarchyCount);
    if (parentCount === null || childCounts.some((value) => value === null)) {
      parent.breakdownCompleteness = 'Unknown';
      continue;
    }
    const childTotal = childCounts.reduce((sum, value) => sum + (value || 0), 0);
    parent.breakdownCompleteness = childTotal === parentCount ? 'Complete' : childTotal < parentCount ? 'Partial' : 'Unknown';
    const arithmeticNote = childTotal === parentCount
      ? `Linked component counts reconcile with the parent total (${childTotal}/${parentCount}).`
      : `Linked component counts do not fully reconcile with the parent total (${childTotal} vs ${parentCount}); relationship is retained only because it has explicit source evidence.`;
    parent.hierarchyReason = [parent.hierarchyReason, arithmeticNote].filter(Boolean).join(' ');

    // causeChildren are intentionally not included in aggregate arithmetic because
    // a cause breakdown and a component subtotal are different relationships.
    void causeChildren;
  }

  // 5) Calculate arbitrary nesting depth. This is display-only and enables
  // root -> sub-aggregate -> leaf event without hard-coding Major/Minor/etc.
  const depthMemo = new Map<string, number>();
  const getDepth = (event: any, trail = new Set<string>()): number => {
    if (depthMemo.has(event.id)) return depthMemo.get(event.id)!;
    if (!event.parentEventId) {
      depthMemo.set(event.id, 0);
      return 0;
    }
    if (trail.has(event.id)) return 0;
    const nextTrail = new Set(trail);
    nextTrail.add(event.id);
    const parent = byId.get(event.parentEventId);
    const depth = parent ? Math.min(getDepth(parent, nextTrail) + 1, 8) : 0;
    depthMemo.set(event.id, depth);
    return depth;
  };
  events.forEach((event) => {
    event.hierarchyLevel = getDepth(event);
    event.isSubItem = event.hierarchyLevel > 0;
  });

  return events;
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  // Ensure JSON content-type header for all /api routes
  app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });

  // Shared Gemini client with lazy/conditional key handling.
  // Multiple keys are supported so the app can keep using the SAME model when
  // one Google AI project reaches its per-project daily quota. A backup key
  // should come from a different Google AI project; another key from the same
  // project normally shares the same quota.
  const getGeminiApiKeys = (): string[] => {
    const candidates = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GOOGLE_API_KEY,
      process.env.API_KEY,
    ];

    return Array.from(
      new Set(
        candidates
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
  };

  const getGeminiErrorText = (error: any): string => {
    const pieces = [
      error?.message,
      error?.status,
      error?.code,
      error?.error?.message,
      error?.error?.status,
      error?.error?.code,
      error?.details ? JSON.stringify(error.details) : '',
    ]
      .filter(Boolean)
      .map(String);
    return pieces.join(' ');
  };

  const isGeminiDailyQuotaError = (error: any): boolean => {
    const text = getGeminiErrorText(error);
    return (
      /GenerateRequestsPerDayPerProjectPerModel/i.test(text) ||
      /RequestsPerDayPerProjectPerModel/i.test(text) ||
      (/RESOURCE_EXHAUSTED/i.test(text) && /quota/i.test(text) && /per.?day|daily/i.test(text)) ||
      (/quota exceeded/i.test(text) && /per.?day|daily/i.test(text))
    );
  };

  const getSuggestedRetryDelayMs = (error: any): number | null => {
    const text = getGeminiErrorText(error);
    const match = text.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i)
      || text.match(/retry(?:\s+in|\s+after)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
    if (!match) return null;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(Math.ceil(seconds * 1000), 60_000);
  };

  const getGeminiClient = (): GoogleGenAI | null => {
    const keys = getGeminiApiKeys();
    if (keys.length === 0) return null;

    const clients = keys.map(
      (key) =>
        new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        })
    );

    // Keep the rest of the extraction pipeline unchanged: it can continue to
    // call ai.models.generateContent(...). Only quota failover is handled here.
    const pooledClient = {
      models: {
        generateContent: async (args: any) => {
          let lastQuotaError: any = null;

          for (let index = 0; index < clients.length; index++) {
            try {
              if (index > 0) {
                console.warn(
                  `[Gemini API] Trying backup API project ${index + 1}/${clients.length} with the same model...`
                );
              }
              return await clients[index].models.generateContent(args);
            } catch (error: any) {
              if (!isGeminiDailyQuotaError(error)) {
                throw error;
              }

              lastQuotaError = error;
              console.warn(
                `[Gemini API] API project ${index + 1}/${clients.length} reached its daily quota.`
              );

              if (index < clients.length - 1) {
                continue;
              }
            }
          }

          const quotaError: any = new Error(
            clients.length > 1
              ? 'Gemini daily free-tier quota is exhausted for all configured API projects. Add another backup key from a different Google AI project or retry after the quota resets.'
              : 'Gemini daily free-tier quota is exhausted for gemini-3.5-flash. Add GEMINI_API_KEY_2 from a different Google AI project or retry after the quota resets.'
          );
          quotaError.status = 429;
          quotaError.code = 'GEMINI_DAILY_QUOTA_EXCEEDED';
          quotaError.retryable = false;
          quotaError.cause = lastQuotaError;
          throw quotaError;
        },
      },
    };

    return pooledClient as unknown as GoogleGenAI;
  };

  // Health check API
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Robust Gemini caller using gemini-3.5-flash. It retries transient provider
  // failures, but it DOES NOT waste retries on the daily per-project quota.
  async function callGeminiWithRetry(
    genAi: GoogleGenAI,
    contents: any,
    config: any,
    maxRetries = 2
  ): Promise<string> {
    const model = 'gemini-3.5-flash';
    // Main extraction may retry transient provider failures. Focused repair calls
    // pass maxRetries=0 so one difficult paper cannot keep a single HTTP request
    // open through several full retry cycles and trigger a browser "Failed to fetch".
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Gemini API] Requesting extraction with model "${model}" (attempt ${attempt + 1}/${maxRetries + 1})...`);

        const response = await genAi.models.generateContent({
          model,
          contents,
          config,
        });

        const text = response.text;
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          throw new Error('Received empty response from Gemini API.');
        }

        // Log safe preview of response body (first 200 characters)
        const safePreview = text.trim().slice(0, 200).replace(/\n/g, ' ');
        console.log(`[Gemini API] Response body preview: ${safePreview}...`);

        // Detect HTML or non-JSON response (e.g., error pages or gateways returning HTML)
        const trimmed = text.trim();
        if (
          trimmed.startsWith('<!DOCTYPE') ||
          trimmed.startsWith('<html') ||
          trimmed.startsWith('<HTML') ||
          trimmed.includes('<body') ||
          trimmed.includes('<HEAD>')
        ) {
          throw new Error(`Received HTML / non-JSON response from Gemini API (Preview: ${safePreview})`);
        }

        // Enforce structured JSON output with schema validation (JSON.parse)
        try {
          JSON.parse(text);
        } catch (jsonErr: any) {
          throw new Error(`Invalid JSON response from Gemini API: ${jsonErr.message} (Preview: ${safePreview})`);
        }

        console.log(`[Gemini API] Extraction succeeded with model "${model}"`);
        return text;
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.code || err?.error?.code || '';
        console.log(`[Gemini API] Attempt ${attempt + 1} failed: ${errMsg}`);

        // Daily quota is not a short-lived transient error. Retrying the same
        // project after 1-2 seconds only burns time and produces the huge 429
        // message the UI was showing. Backup-project failover has already been
        // attempted inside getGeminiClient().
        if (isGeminiDailyQuotaError(err) || err?.code === 'GEMINI_DAILY_QUOTA_EXCEEDED') {
          break;
        }

        const isTransient =
          status === 503 ||
          status === 'UNAVAILABLE' ||
          status === 429 ||
          status === 'RESOURCE_EXHAUSTED' ||
          errMsg.includes('503') ||
          errMsg.includes('429') ||
          errMsg.includes('high demand') ||
          errMsg.includes('temporarily overloaded') ||
          errMsg.includes('overloaded') ||
          errMsg.includes('temporary') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('empty response') ||
          errMsg.includes('Invalid JSON') ||
          errMsg.includes('HTML');

        if (isTransient && attempt < maxRetries) {
          const providerDelay = getSuggestedRetryDelayMs(err);
          const fallbackDelay = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
          const delayMs = providerDelay ?? fallbackDelay;
          console.log(`[Gemini API] Transient failure encountered. Retrying in ${delayMs}ms (attempt ${attempt + 2}/${maxRetries + 1})...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          break;
        }
      }
    }

    throw lastError || new Error('Gemini API extraction failed with gemini-3.5-flash after maximum retries.');
  }

  // PDF & Paper Text Extraction API
  app.post('/api/analyze-pdf', (req, res, next) => {
    upload.single('file')(req as any, res as any, (err: any) => {
      if (err) {
        console.error('[Multer upload error]:', err);
        return res.status(400).json({
          success: false,
          error: `File upload error: ${err.message || String(err)}`,
          failedField: 'File Upload',
        });
      }
      next();
    });
  }, async (req, res) => {
    try {
      req.setTimeout(120000);
      res.setTimeout(120000);
      let paperText = req.body.paperText || '';
      const dueListStr = req.body.dueList;
      const dueDataStr = req.body.due;
      const similarDevicesStr = req.body.similarDevices;
      const fileName = req.file ? req.file.originalname : req.body.fileName || 'Uploaded_Paper.pdf';

      let dueList: DueItem[] = [];
      if (dueListStr) {
        try {
          dueList = typeof dueListStr === 'string' ? JSON.parse(dueListStr) : dueListStr;
        } catch (e) {
          console.warn('Error parsing dueList:', e);
        }
      }

      if (dueList.length === 0 && dueDataStr) {
        try {
          const singleDue = typeof dueDataStr === 'string' ? JSON.parse(dueDataStr) : dueDataStr;
          dueList = [{ ...singleDue, id: singleDue.id || 'DUE-1' }];
        } catch (e) {
          console.warn('Error parsing due:', e);
        }
      }

      if (dueList.length === 0) {
        dueList = [{
          id: 'DUE-1',
          productName: 'Niti-S Biliary Covered Stent',
          indications: ['Malignant biliary obstruction'],
        }];
      }

      let due: DueSetup = dueList[0];

      let similarDevices: SimilarDevice[] = [];
      try {
        if (similarDevicesStr) similarDevices = typeof similarDevicesStr === 'string' ? JSON.parse(similarDevicesStr) : similarDevicesStr;
      } catch (e) {
        console.warn('Error parsing similarDevices:', e);
      }

      // Extract raw text from PDF buffer if available. Always destroy the parser,
      // including failure paths, so batch analysis cannot leak PDF workers/resources.
      let extractedPdfText = '';
      if (req.file && req.file.buffer) {
        let parser: PDFParse | null = null;
        try {
          const uint8Data = new Uint8Array(req.file.buffer);
          parser = new PDFParse({ data: uint8Data });
          const textResult = await parser.getText();
          if (textResult && textResult.text && textResult.text.trim().length > 0) {
            extractedPdfText = textResult.text.trim();
            if (!paperText) {
              paperText = extractedPdfText;
            }
          }
        } catch (pdfErr) {
          console.warn('Direct PDF text extraction notice, using raw buffer/fallback:', pdfErr);
        } finally {
          if (parser) {
            try {
              await parser.destroy();
            } catch (destroyErr) {
              console.warn('PDF parser cleanup notice:', destroyErr);
            }
          }
        }
      }

      const contentParts: any[] = [];

      // Prioritize extracted clean text (from pdf-parse) over heavy multimodal
      // base64 inlineData when available. Text processing is significantly faster
      // and prevents gateway timeouts on large multi-page clinical papers.
      if (paperText && paperText.trim().length > 50) {
        contentParts.push({ text: `DOCUMENT FULL TEXT:\n${paperText}` });
      } else if (req.file && req.file.buffer) {
        contentParts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: req.file.buffer.toString('base64'),
          },
        });
      } else if (paperText && paperText.trim().length > 0) {
        contentParts.push({ text: `DOCUMENT FULL TEXT:\n${paperText}` });
      }

      const promptInstructions = `You are a certified Clinical Evaluation specialist extracting medical device literature data adhering strictly to IMDRF MDCE WG/N56FINAL:2019 Appendices D1 and MEDDEV 2.7.1 Rev.4.

USER EVALUATION SETUP:
- Device Under Evaluation (DUE) Inventory:
${dueList.map((d, idx) => `  * [${d.id || `DUE-${idx + 1}`}] Device Category: ${d.deviceCategory || 'Not specified'}, Product Name: ${d.productName}, Indications: ${JSON.stringify(d.indications)}${d.similarDevices && d.similarDevices.length > 0 ? `, Configured Similar Devices: ${JSON.stringify(d.similarDevices)}` : ''}`).join('\n') || '  (None configured)'}

MANDATORY EXTRACTION RULES:
1. Use ONLY information and exact sentences actually in the document.
2. If any item is missing or not explicitly stated, mark it as "Not reported" or "Not assessable". NEVER extrapolate, assume, or invent numbers, diameters, lengths, sample sizes, or statistical methods.
3. Every single extracted item and appraisal decision MUST have an exact verbatim evidence quote ("evidence_quote") directly copied from the text, along with its precise location ("evidence_location", e.g. "Page 3, Section 2.2" or "Table 2, Page 4"). If location is not identifiable, specify "Location not identified".
4. Never generate an AI summary as an evidence quote. It must be verbatim.
5. Identify ALL PRIMARY research groups/cohorts/arms used in the current study. There is NO two-group limit: if the study has 3 or more treatment/device arms, return every arm. NEVER filter the group list to DUE-only groups; comparator/control/other-device groups must also be returned. Do not mistake subgroup analyses (e.g. hilar vs nonhilar) or pre-/post-propensity-matching versions of the same treatment arm for new primary treatment groups. If multiple devices are in a single cohort, keep 1 group and list each device as a sub-item. Never duplicate pooled patient numbers across devices. If per-device n is not broken down, set devicePatientNumber to "Not separately reported".
   - When the SAME stent/DUE is used in multiple arms but one arm adds an adjunctive non-device treatment/procedure and another arm uses the device alone or standard care, preserve every arm. Treat the device-only/standard arm as the main device-evaluation group and the added-treatment arm as adjunctive; never treat the adjunctive procedure itself as a separate device.
6. Manufacturer Extraction Rules:
   - Extract manufacturer strictly and ONLY from the device description, figure caption, table, or Methods directly linked to the device (e.g. from "(Spring Stopper; Taewoong Medical, Seoul, Korea)" -> "Taewoong Medical, Seoul, Korea" or "Taewoong Medical").
   - NEVER extract a manufacturer from hospital names, universities, author affiliations, study sites, publishers, journals, or ethics/IRB statements (e.g. 'the human research committee at Osaka Medical College' is an ethics statement, NEVER a manufacturer). If no manufacturer is directly linked to the device, set to "Not reported".
7. Diameter & Length Extraction Rules:
   - Must be extracted independently. Diameter and Length are separate fields. If only diameter is stated, Diameter is recorded and Length remains "Not reported".
8. Device Extraction & Classification Rules:
   - CORE RULE: EXTRACT FIRST, CLASSIFY SECOND. For every study group, first extract the exact device product name as written in the paper (e.g., 'PCSEMS-AF (Spring Stopper)', 'WallFlex Biliary Stent', 'Hanarostent', etc.).
   - NEVER overwrite or substitute the verbatim extracted device name with a configured DUE or Similar Device name. The configured DUE inventory and Similar Device registry are reference data only.
   - Exact device evidence requirement: A device may be classified as DUE or Similar Device ONLY when the paper contains direct, device-specific evidence for that product name or registered alias. Do NOT classify based on generic features alone (e.g., 'metal stent', 'SEMS', 'PCSEMS', 'covered', 'EUS-HGS', 'biliary drainage', diameter, or flange design).
   - If the paper describes 'PCSEMS-AF (Spring Stopper)' manufactured by 'Taewoong Medical, Seoul, Korea', extract deviceProductName: 'PCSEMS-AF (Spring Stopper)' and manufacturer: 'Taewoong Medical, Seoul, Korea'. Do NOT output 'Niti-S Hot Giobor Stent'.
9. Indication Relationship:
   - Must evaluate against ALL configured DUE indications.
   - Must expand medical abbreviations (e.g. 'EUS-GBD' = EUS-guided gallbladder drainage = transgastric/transduodenal gallbladder drainage; 'WON' = walled-off necrosis; 'PFC' = pancreatic fluid collection).
   - If primary target organ and drainage procedure match any DUE indication, classify as "Same indication".
10. Relevance Checklist - Gender (Item H):
    - Extract exact reported patient sex/gender counts in the strict format:
       Male: n = [number]
       Female: n = [number]
    - IMPORTANT: Pay attention to alternative formats such as "Sex", "Sex (M/F)", "Sex (male/female)", "Sex, male/female, n (%)", "M/F: 33/17", separate Male/Female rows, and patient-level baseline tables where each patient row contains only an M or F value in the Sex column. When a patient-level Sex column is used, count the explicit M/F cells once per current-study patient and reconcile the count with the reported cohort N before using it. Also recognize narrative demographic sentences such as "20 patients, 9 males (45%) and 11 female (55%)", "nine patients (81%) were male", or "Twenty patients (9 males)". For multi-group tables, extract ALL treatment-arm columns (including 3+ groups), not only the first one or two. Scan the Abstract, Results, baseline/patient-characteristics text, and tables before concluding gender is not reported.
    - POPULATION PRIORITY RULE: Population-level sex/gender data from baseline/patient-characteristics tables or cohort Results ALWAYS take priority over an individual illustrative case, figure caption, or case presentation. Do not let a phrase such as "a 78-year-old man" inside a cohort paper override a reported Table 1 row such as "Sex (M/F) 33/17".
    - CASE REPORT / CASE SERIES RULE: Use patient-introduction sex only when the paper itself is genuinely a case report/case series and no population-level demographic distribution is reported. Treat explicit phrases such as "A 59-year-old male...", "a 53-year-old woman...", "Case 1 ... male", or "Patient 2 ... female" as valid gender evidence for that case study. For numbered Case/Patient sections, count each distinct current-study case once and aggregate the sex distribution across those cases. Do NOT double-count the same patient when repeated in the Abstract/body, and do NOT count illustrative cases embedded in a larger cohort, historical cases in Discussion, literature review, or References.
    - For multi-group / comparative studies (e.g., Covered vs Uncovered or Group A vs Group B), parse side-by-side table rows (e.g., "Male gender 40 (67.8%) 37 (60.7%)") and format each group distinctly:
       [Covered SEMS: Male n = 40 (67.8%); Uncovered SEMS: Male n = 37 (60.7%)]
    - Extract ONLY numbers actually reported in the paper. Never use publication years (e.g. 2017) or citation numbers as patient sex counts.
    - If gender is not reported for a group or study, do NOT display 0; display "Not reported" (e.g. "Not reported" or "Male: Not reported, Female: Not reported").
    - NEVER guess, estimate, or reverse-calculate unstated numbers from total patient count.
    - Provide verbatim quote and location in remarks. The verbatim quote must reproduce the actual source row (e.g. "Male sex 217 (59.6) 49 (54.4)"), NOT generic generated text. If not reported, state 'Not reported'.
11. Relevance Checklist - Type & Severity of Medical Condition (Item I):
    - For Relevance Checklist Item I only, do not place adverse events, complications, or procedure-related events in the medical-condition/severity field. This restriction applies only to Relevance Item I. These events MUST still be independently extracted in full for Step 4 safetyEventsExtract.
    - Extract the direct medical condition / baseline pathology for stent placement (e.g. malignant biliary obstruction, benign biliary stricture, pancreatic pseudocyst, walled-off necrosis, gastric outlet obstruction).
    - Checkboxes: 'Early stage', 'Late stage', 'Mild', 'Intermediate', 'Serious form', 'Acute phase', 'Chronic phase', 'Etc.'
    - Select severity categories ONLY if explicitly written in the paper; otherwise select 'Etc.' and provide the exact condition in comment/remarks.
12. Relevance Checklist - Range of time? (Item J):
    - This item consists of 3 distinct sub-items:
       1) 'Duration of application or use': Actual device usage duration. Treat stent patency AND explicit stent/device indwell duration as eligible duration concepts. Recognize study-specific terms including 'stent indwell time', 'stent indwelling time', 'indwell/indwelling duration', 'dwell time', 'time in situ', 'duration of stent placement', 'time to recurrent biliary obstruction (TRBO)', 'time to RBO', 'time to stent occlusion', 'time to stent dysfunction', and 'time to recurrent obstruction'. Recognize both prose and table formats, including 'median stents indwell time (months) 7 (6-10)', 'mean stent patency (± SD) was 149.8 ± 8.9 days', and 'Mean ± SD stent patency, d 149.8 ± 8.9'. Preserve the EXACT reported time unit (days/weeks/months/years) and range/IQR/CI/SD; NEVER convert units and NEVER assume an unlabeled number is days. Read the endpoint/value as a semantic pair: do not borrow a nearby pain score, age, laboratory value, or unrelated timepoint simply because it is numerically close in the extracted text. Example: if Results state "median stent patency was 7 months (range 3-13)", output 7 months (range 3-13), NOT 7 days. In comparative studies, extract EVERY primary treatment arm (2, 3, or more), not only two groups. Use ONLY data from the CURRENT STUDY. Historical/comparator values from Introduction, Discussion, cited prior studies, literature-review tables, or References are NOT eligible extraction sources and must be ignored completely. Do not use them even when the current study does not report the endpoint. If the current study does not report the value, return 'Not reported'. Current-study evidence may come from the Abstract Results, Results section, or a table/figure row explicitly identified as the current study. NEVER extract a cited prior-study figure from Discussion.
       2) 'Number of repeat exposures': Extract the number of explicit repeat device exposures/reinterventions (e.g., repeat ERCP, repeat stenting, endoscopic/surgical reintervention due to stent failure or occlusion). Also recognize equivalent wording such as 'received another stent', 'received a second stent', 'an additional stent was placed', or 'another/new stent was inserted/deployed'. If the paper explicitly says 'another patient' or 'one patient' received the repeat stent, record 1. Do not infer repeat exposure from a complication alone when no repeat procedure/device use is stated. In comparative studies, report EVERY primary treatment arm, including 3+ groups. If a Results paragraph explicitly states that stent occlusion required reintervention/ERCP and then gives occlusion counts for the compared arms in that same comparison, retain the group-specific reintervention-linked counts rather than dropping later groups.
       3) 'Duration of follow-up': Observation duration of clinical outcomes. Prioritize directly reported follow-up duration (median/mean follow-up). Read the follow-up statement/table row semantically and keep its own reported value and unit; never substitute an adjacent VAS/pain score, age, laboratory value, or other endpoint number. If direct follow-up duration is absent, use CURRENT-STUDY overall/patient survival duration as a proxy and explicitly label it 'Overall survival used as a proxy because follow-up duration was not reported'. Prefer median survival when both median and mean survival are reported. Recognize table forms such as 'Median patient survival, d 106' as well as prose. In comparative studies, extract all primary groups where available. NEVER use "loss to follow-up" dropout rates (e.g., 5% or n=7), and never use Discussion/reference survival values as the proxy.
    - Format comment as:
      Duration of application or use: [Group name / Study-wide: ...]
      Number of repeat exposures: [reported count or Not reported]
      Duration of follow-up: [Study-wide: ...]
13. Methodological Appraisal - Information on elementary aspects:
    - Extract 3 independent sub-elements:
      1. Method: Exact study design / type (e.g. 'Retrospective observational study', 'Prospective cohort study')
      2. Identification of the device: All devices used in the study across all research groups. If multiple study groups exist, extract EVERY primary treatment/device group and its device with exact quote and location. Do NOT output only the first DUE group, first comparator, or first two groups.
      3. Clinical outcome: Reported clinical endpoints (e.g. 'Technical success, clinical success, stent patency, adverse events')
    - Each sub-element must have extracted value, exact verbatim quote, location, and reported status.
14. Methodological Appraisal - Adequate controls:
    - Evaluate whether confounding factors exist (e.g. baseline characteristic imbalance, disease severity differences, selection bias, differing access route, operator variation, co-interventions) that could materially influence reported results.
    - If no confounding factor materially impacting results is identified, recommend 'Adequate (2)'. If confounding factors exist and were not controlled, recommend 'Non adequate (1)'.
15. Methodological Appraisal - Collection of mortality and serious adverse events data:
    - Recommend 'Adequate (2)' when the paper reports ANY complication/adverse-event data OR ANY mortality data. Explicit zero-event statements such as 'no complications', 'no adverse events', 'no deaths', or mortality 0 are still considered reported data.
    - Recommend 'Non adequate (1)' only when neither complication/adverse-event data nor mortality data are reported anywhere in the paper.
    - Provide the exact verbatim supporting quote and location. If neither is reported, use 'Not reported'.
16. Methodological Appraisal - Interpretation of authors:
    - AI recommended selection is ALWAYS 'Good (1)'. Quote the authors' interpretation/conclusion sentence if found; otherwise state 'Not reported' in quote and remarks.
17. Methodological Appraisal - Study legality:
    - AI recommended selection is ALWAYS 'Legal (1)'. Quote ethics approval / IRB / informed consent statement if found; otherwise state 'Not reported' in quote and remarks.
18. Contribution Criteria - Outcome measures:
    - Extract actual quantitative results from Results, Tables, or Figures (e.g. 'Technical success: 95.0% (38/40)', 'Clinical success: 87.5% (35/40)', 'Median stent patency: 180 days', 'Adverse events: 12.5% (5/40)'). Do NOT output endpoint names alone.
    - If multiple study groups (e.g. DPPS vs SEMS) exist, present quantitative results for each group separately. Do not average, pool, or blur them.
19. Contribution Criteria - Follow-up:
    - Apply strict priority hierarchy for time metric:
      1. Follow-up duration (e.g. 'median follow-up of 12.4 months')
      2. Overall survival period (e.g. 'median overall survival of 8.6 months')
      3. Stent patency duration (duration only, e.g. 'median stent patency 180 days'; not percentages)
      4. Not reported (if none of the 3 are found)
    - If 1, 2, or 3 found: Recommend 'Yes (2)'. If using #2 or #3, explicitly note that follow-up was not reported and survival or patency was used as available longitudinal metric.
    - If 4 (none found): Recommend 'No (1)' and status 'Not reported'.
20. Contribution Criteria - Clinical significance:
    - Extract specific quantitative clinical outcomes and values from Results/Tables (e.g. procedural success rates, clinical drainage rates, complication rates, patency).
    - If multiple groups (DPPS vs SEMS), present each group's quantitative values distinctly without pooling.
    - Avoid qualitative summaries like 'high rate' or 'effective' without figures. Recommend 'Yes (2)' if quantitative clinical outcomes exist, 'No (1)' if absent.
21. Suitability Criterion #4 - Acceptable report/data collation (9 CORE QUALITY DIMENSIONS):
    - Evaluate EACH of the following 9 dimensions independently for the CURRENT STUDY only. The question is whether the information is reported, NOT whether the study did it perfectly.
    - Do NOT use Discussion, References, or historical comparator studies as evidence for these nine dimensions.
    - Return suitabilityComments.reportCollationDimensions with one object per dimension, each containing: reported (boolean), evidenceQuote (exact verbatim current-study quote), evidenceLocation.
    - Dimension rules:
      1) studyObjective: Reported when the study aim/objective/purpose is stated or clearly described. Otherwise Not reported.
      2) studyDesign: Reported when the design is stated (e.g. prospective, retrospective, randomized, observational, cohort, case series/report, multicenter/single-center design). Otherwise Not reported.
      3) patientPopulation: Reported when the study population/condition or enrolled patient group is described. Otherwise Not reported.
      4) deviceProcedureDescription: Reported when the device used OR the relevant procedure is described. Otherwise Not reported.
      5) outcomesEndpoints: Reported when at least one efficacy/performance/safety outcome or endpoint being assessed is stated. Otherwise Not reported.
      6) followUpObservation: SPECIAL RULE FOR THIS CRITERION ONLY — any explicit mention of follow-up/followed-up/observation is enough for Reported, even when the numerical follow-up duration is absent. This does NOT change the separate Relevance 'Duration of Follow-up' extraction, which still requires an actual duration/value.
      7) results: Reported when at least one current-study result or outcome result is presented. Otherwise Not reported.
      8) adverseEventsSafety: Reported when adverse events, complications, or safety are mentioned, INCLUDING explicit zero-event wording such as 'no adverse events'/'no complications'/0 events. Otherwise Not reported.
      9) statisticalMethods: FOR THIS CRITERION ONLY, Reported when either (a) a statistical method/test is stated OR (b) statistical software alone is stated (e.g. SPSS, SAS, R, Stata, StatView, GraphPad Prism, MedCalc, JMP). A software-only statement is sufficient here. This does NOT relax the separate Methodological Appraisal statistical-method criterion below.
    - Do NOT calculate the final Criterion #4 score yourself; the application will count Not reported dimensions deterministically.
22. Statistical Method Extraction & Classification Rules (MANDATORY STRICT STANDARDS FOR THE SEPARATE METHODOLOGICAL APPRAISAL):
    - Statistical Method is present ONLY if an actual statistical analysis technique, procedure, or comparative test is explicitly confirmed in the paper.
    - DO NOT judge based on general words like 'analysis', 'analyzed', 'evaluation', 'evaluated', 'assessment', or 'assessed' alone.
    - DO NOT treat study design terms as statistical methods (e.g. 'multicenter', 'single-center', 'retrospective', 'prospective', 'observational study', 'cohort', 'randomized'). Specifically, 'multicenter' is a study design descriptor, NEVER a statistical method.
    - DO NOT treat data collection, chart review, follow-up, or enrollment as statistical methods.
    - DO NOT treat simple listings of percentages or counts without statistical methodology as statistical methods.
    - Valid Statistical Methods that confirm 'hasStatisticalMethodsReported: true' include explicit mentions of:
      * Student's t-test, paired/unpaired t-test
      * Chi-square test (χ2 test), Fisher's exact test
      * Mann–Whitney U test, Wilcoxon rank-sum / signed-rank test
      * ANOVA (analysis of variance), Kruskal–Wallis test
      * Kaplan–Meier method, log-rank test
      * Cox proportional hazards regression model
      * Logistic regression, linear regression, multivariable regression
      * Pearson's or Spearman's rank correlation
      * Explicit descriptive statistical methodology defining how continuous variables (e.g. mean ± SD, median with IQR/range) and categorical variables (e.g. frequencies, percentages) were tested or compared
      * Specific statistical software with stated analysis description (e.g. SPSS, SAS, R software, Stata, GraphPad Prism used for statistical comparisons)
    - If the paper contains NO such explicit statistical methods or if it is ambiguous:
      * Set 'hasStatisticalMethodsReported': false
      * acceptableReportQuote: 'Not reported'
      * acceptableReportLocation: 'Not reported'
      * acceptableReportComment: 'No specific statistical methods or comparative statistical analysis techniques were reported in the text.'
    - If valid explicit statistical methods ARE present:
      * Set 'hasStatisticalMethodsReported': true
      * acceptableReportQuote: EXACT VERBATIM sentence from the paper stating the statistical methods/tests/software used
      * acceptableReportLocation: EXACT section/page location (e.g. 'Methods, Statistical analysis section')
      * acceptableReportComment: 'Statistical methods explicitly documented: [list the specific methods found]'
23. Safety Event Extraction (Step 4) - MANDATORY TABLE FIDELITY RULES:
    - PRIMARY RULE: PARSE EVERY SOURCE TABLE ROW.
      * When an adverse-event, complication, occurrence, reintervention, or clinical-outcome table is present, treat it as structured source data.
      * Read EVERY non-header row in the table from top to bottom, including rows that:
        - use unfamiliar terminology (e.g. 'Sludges or food scraps');
        - use plural forms, spelling variations, or uncommon terms;
        - are labelled 'Unknown';
        - are below a broader event heading (e.g. sub-items under 'Stent dysfunction': 'Obstruction', 'Migration', 'Sludges or food scraps', 'Unknown');
        - have the same event name in both early and late periods.
      * Do NOT limit extraction to a predefined adverse-event dictionary. A row must NOT be omitted merely because its label is unfamiliar.
    - PRESERVE SOURCE HIERARCHY AND TIMING:
      * Inherit timing from the nearest source heading (e.g. 'Early adverse events within 14 days' -> 'Early (within 14 days)'; 'Late adverse events after 14 days' -> 'Late (after 14 days)').
      * Keep Early and Late records separate even when the event name is identical.
      * Preserve the event name exactly as written in the article.
      * Do NOT merge 'Migration', 'Obstruction', 'Sludges or food scraps', 'Unknown', or 'Stent dysfunction' into one record unless the source explicitly combines them.
      * Capture table-level timing totals (e.g. 'Early adverse events within 14 days: 22/106 (20.8%)', 'Late adverse events after 14 days: 40/106 (37.7%)') in 'timingSummaries'.
    - GENERAL HIERARCHY RECONSTRUCTION — APPLIES TO ALL TABLE STYLES:
      * Do NOT rely only on visual indentation. Some PDFs lose indentation, borders, merged cells, or column alignment during text extraction.
      * Determine parent/child relationships ONLY when the publication itself explicitly supports the relationship through (a) direct Abstract/Results wording, (b) a clearly structured current-study table/subheading/indentation grouping, or (c) both. Do NOT use Discussion or References to create hierarchy.
      * An aggregate row is a reported total that is broken down by one or more component rows. Example: 'Stent malfunction 8' with following 'Migration 3' and 'Occlusion 5' means Stent malfunction is an aggregate and Migration/Occlusion are components when the source supports that relationship.
      * 'Other complications 3' followed by three separate 1-patient complications may be treated as a parent ONLY when the source table/text clearly groups those rows beneath 'Other complications'. The numeric sum 1+1+1=3 alone is NOT sufficient.
      * A cause is NOT the same relationship as a component. Example: if Occlusion is followed by a 'Cause' section containing Tumor overgrowth, record Tumor overgrowth as relationshipType='cause' with parentEvent='Occlusion', not merely as another component of the aggregate.
      * Nested sub-aggregates are allowed ONLY when the source explicitly supports each edge. Example: if the source explicitly shows 'Complications' -> 'Major complications' -> 'Tracheal compression', then 'Major complications' must have parentEvent='Complications', relationshipType='component', AND isAggregate=true because it also has its own child. Do not hard-code the words Major/Minor; use the same rule for any source-defined category.
      * Never force a hierarchy from semantic similarity, row proximity, row order, or arithmetic alone. A broad term such as 'complications' appearing near several events is insufficient unless the source explicitly groups those events beneath it.
      * Arithmetic is VALIDATION ONLY: matching parent/child totals may increase confidence after a relationship is already source-supported, but an exact numeric sum must NEVER create a parent-child relationship.
      * Set hierarchyConfidence='High' only when the relationship is explicitly supported by Abstract/Results text and/or clearly structured current-study table hierarchy. Discussion/References are excluded.
      * If the source suggests a possible relationship but it is not explicit enough, DO NOT nest the row. Leave parentEvent=null, relationshipType='none' or 'unclear', and classificationStatus='review_required'.
      * If a parent cannot be determined reliably, leave parentEvent null, relationshipType='unclear' or 'none', hierarchyConfidence='Low', and preserve the row as an independent/review item rather than inventing a relationship.
      * Mark breakdownCompleteness='Complete' only when the reported component counts fully reconcile with the parent total; use 'Partial' when only some components are reported; otherwise 'Unknown'.
      * Aggregate rows and their component rows must NEVER be summed together as separate patients/events for an overall total.
    - DENOMINATOR AND STUDY-GROUP FIDELITY:
      * The source table determines the denominator and group assignment.
      * If a table header states 'N = 106', output values as 'n/106' and retain the reported percentage (e.g., '10/106', '9.4%').
      * If the table is study-wide and does not divide results by device or treatment group, the 'studyGroupOrDevice' field MUST be 'Study-wide / all patients (N=106)' or 'Study-wide; group not separately reported'.
      * NEVER infer or create SEMS, DPPS, DUE, Similar Device, or any other subgroup assignment from another table, article context, or device inventory.
      * Use a group-specific denominator ONLY when that exact row is explicitly reported for that group in the same source table.
      * If a field is not directly stated, use 'Not separately reported'; never infer it.
      * Do NOT create an event row when the reported numerator is 0 (e.g. 0/61 or 0%). A zero count means that event did not occur in that group.
      * Results narrative is equally authoritative as a table. If a positive event appears only in the Results text (e.g. "Two mild cholangitis cases occurred ... in the control group") while a table shows only the other arm, you MUST still create the positive event row for the stated group. Preserve severity words such as "mild" in the event name/severity.
    - MORTALITY / DEATH IS NOT A COMPLICATION ROW:
      * Do NOT put mortality, death, deaths, fatality, or fatality-rate rows into safetyEventsExtract.events.
      * Mortality belongs ONLY in Overall Safety Summary fields such as overallMortality and the applicable group-level mortality summary.
      * Examples to EXCLUDE from events: 'Overall 30-day mortality', '30-day mortality', 'Procedure-related death', 'Death from persistent bleeding'.
      * If a death is caused by a complication (e.g. persistent bleeding), do NOT convert the death count into the complication count. Extract the underlying complication as an event only when the paper separately reports that complication with its own valid count/rate.
      * Mortality may still be used for the methodological appraisal item 'Collection of mortality and serious adverse events data'; this exclusion applies only to the Step 4 complication/event list.
    - REQUIRED FIELDS PER EVENT ROW:
      - eventName: Exact verbatim event name from paper (e.g. 'Bile peritonitis including pneumoperitoneum', 'Stent dysfunction', 'Obstruction', 'Migration', 'Sludges or food scraps', 'Unknown')
      - category: One of ['Adverse event', 'Complication', 'Serious adverse event', 'Device-related event', 'Procedure-related event', 'Device malfunction / technical failure', 'Mortality', 'Reintervention-related event', 'Other reported occurrence']
      - timing: Exact timing category ('Early (within 14 days)', 'Late (after 14 days)', 'Short-term', 'Long-term', 'Overall / not time-categorized')
      - studyGroupOrDevice: 'Study-wide / all patients (N=...)' if study-wide table; otherwise explicit group name
      - numEvents: Number of events (e.g. '10' or 'Not reported')
      - totalPatients: Total group/study patients (e.g. '106' or 'Not reported')
      - countN: Formatted 'n/N' (e.g. '10/106')
      - reportedRate: Percentage explicitly reported in the paper (e.g. '9.4%' or 'Not reported'). NEVER place a calculated value in this field.
      - calculatedRate: Prefer 'Not reported' in the AI response. The application will independently calculate this only when n/N interpretation is considered safe.
      - numeratorType: One of ['patients', 'events', 'procedures', 'episodes', 'unknown'] based on the table row, headers, footnotes/caption, and nearby Results text.
      - denominatorType: One of ['patients', 'events', 'procedures', 'episodes', 'unknown'].
      - multipleEventsPerPatient: One of ['Yes', 'No', 'Not reported', 'Unclear']. Set 'Yes' when a footnote/caption/text states that one patient can contribute multiple complications/events or categories are non-mutually-exclusive.
      - percentageContextQuote: Exact verbatim footnote, caption, header, or nearby Results sentence that is relevant to interpreting n/N; otherwise ''.
      - percentageContextLocation: Location of percentageContextQuote (e.g. 'Table 2 footnote, Page 4'); otherwise ''.
      - PERCENTAGE INTERPRETATION RULE: Before any rate is independently calculated, inspect the table title, column headers, row label, footnotes, caption, and nearby Results text. Do NOT assume that an event count equals a patient count. If counts are events/episodes/procedures, if one patient may have multiple complications/events, or if the unit is ambiguous, preserve n/N and the paper-reported percentage but do not infer a patient incidence. Mark the unit/overlap fields accordingly so the application can flag the row for review.
      - severity: Severity or Clavien-Dindo grade if reported, or 'Not reported'
      - managementOutcome: Reported management or outcome, or 'Not reported'
      - parentEvent: Exact parent event name ONLY when the source explicitly supports that row as a component/cause under the parent; otherwise null
      - isSubItem: true only when this row is linked beneath a source-supported parent event
      - relationshipType: Relationship TO the parent: one of ['none', 'component', 'cause', 'unclear']. Use 'none' for root parent/aggregate rows.
      - isAggregate: true when this row is itself a source-supported parent/subtotal with one or more child component rows; false otherwise. A row may simultaneously be a component of its own parent AND isAggregate=true (nested hierarchy).
      - hierarchyEvidenceType: One of ['explicit_text', 'table_structure', 'both', 'none']
      - hierarchyEvidenceQuote: Exact source wording/table lines demonstrating the relationship; empty when no hierarchy is applied
      - hierarchyEvidenceLocation: Exact Results/Table location supporting the relationship
      - hierarchyConfidence: 'High' only for explicit source-supported links; otherwise 'Low'
      - hierarchyReason: Brief source-based reason for the relationship; do not invent evidence
      - breakdownCompleteness: One of ['Complete', 'Partial', 'Unknown']; mainly relevant for aggregate rows
      - classificationStatus: 'classified' when relationship is clear; 'review_required' when hierarchy is ambiguous
      - evidenceQuote: Exact verbatim sentence or table cell
      - evidenceLocation: Page, Section, Table, or Figure (e.g. 'Table 2, Page 4')
    - MORTALITY RELATEDNESS PRIORITY FOR STEP 4:
      * Step 4 is intended to show stent/device/procedure/treatment-related mortality when the publication reports it.
      * Priority: stent-related > device-related > procedure-related > treatment-related > mortality with unclear relatedness > all-cause mortality. Use the most device-relevant mortality available; do NOT substitute all-cause deaths when a related mortality value is explicitly reported.
      * Example: if the paper reports '97 patients died' AND 'no stent-related mortality', Step 4 mortality MUST be the stent-related value 0, not 97/100.
      * If mortality is reported but its relationship to the stent/device/procedure cannot be determined, preserve the reported mortality value and set mortalityVerificationRequired=true with a short note that relatedness requires confirmation.
      * Extract mortality relatedness from CURRENT-STUDY Results/tables only, not Discussion/reference comparisons.
    - Overall Safety Summary:
      - status: 'Events reported' (if >=1 event occurred), 'No event reported' (if paper explicitly states no events/complications occurred), or 'Not reported' (if safety not mentioned)
      - overallStudyPopulation: 'N = ...'
      - overallPatientsWithEvents: Directly reported in paper (e.g. '8/80 (10.0%)') or 'Not reported'. NEVER sum individual event counts.
      - overallMortality: Selected mortality value using the relatedness priority above, or 'Not reported'
      - overallMortalityLabel: e.g. 'Stent-related mortality', 'Device-related mortality', 'Procedure-related mortality', 'Treatment-related mortality', or 'Mortality'
      - overallMortalityRelatedness: One of ['stent_related','device_related','procedure_related','treatment_related','all_cause','unclear','not_reported']
      - overallMortalityVerificationRequired: true only when a mortality value is shown but its stent/device/procedure relatedness is unclear
      - overallMortalityVerificationNote: Short reason for verification requirement
      - overallMortalityEvidenceQuote / overallMortalityEvidenceLocation: Exact supporting source
      - overallSeriousAdverseEvents: Directly reported in paper or 'Not reported'
      - overallReinterventionDueToEvent: Directly reported in paper or 'Not reported'
      - groupSummaries: Per-group overall figures if multi-group paper. Extract each group's directly reported reintervention count, denominator, and percentage from Results tables. For mortality also return mortalityLabel, mortalityRelatedness, mortalityVerificationRequired, mortalityVerificationNote, mortalityEvidenceQuote, and mortalityEvidenceLocation using the mortality relatedness priority above.
      - timingSummaries: Timing-specific aggregate rows from table headers (e.g. Early total 22/106 20.8%, Late total 40/106 37.7%).

FINAL INTERNAL SELF-CHECK BEFORE RETURNING JSON:
- Re-read every value you are about to return against its verbatim evidence. Do not output a value merely because it is clinically plausible.
- Verify that current-study Results/Methods/Table data are not taken from Discussion, References, historical comparisons, or illustrative cases.
- Check all n/N/% values for transcription consistency; do not silently recalculate a paper-reported percentage when event units may overlap.
- Confirm DUE/Similar classification only after the exact product/registered alias and indication context are supported.
- Confirm any safety parent-child/cause relationship from explicit wording or clear table structure; arithmetic agreement alone must never create hierarchy.
- If a field remains uncertain after this check, preserve the source-backed value if present and mark the relevant classification as review_required where supported by the schema; otherwise use Not reported.

Return one valid JSON object. The response MUST include all of these top-level keys:
articleMetadata, researchGroups, suitabilityComments, relevanceExtracts,
methodologicalExtracts, contributionExtracts, and safetyEventsExtract.

Do not omit an entire section when an individual field is unavailable. Use
"Not reported" for the unavailable field and preserve all other extracted data.

The minimum required structure is:
{
  "articleMetadata": {
    "title": "", "journal": "", "publicationYear": "", "doi": "",
    "authors": "", "totalPatientCount": "", "studyDesign": "",
    "studyPeriod": "", "followUpPeriod": "", "studyIndication": ""
  },
  "researchGroups": [{
    "groupName": "", "groupPatientNumber": "", "groupIndicationSummary": "", "groupRole": "Main | Adjunctive | Comparator | Study group",
    "evidenceQuote": "", "evidenceLocation": "",
    "devices": [{
      "deviceProductName": "", "manufacturer": "", "deviceType": "",
      "coverType": "", "diameter": "", "length": "",
      "devicePatientNumber": "", "deviceIndication": "",
      "evidenceQuote": "", "evidenceLocation": ""
    }]
  }],
  "suitabilityComments": {
    "reportCollationDimensions": {
      "studyObjective": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "studyDesign": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "patientPopulation": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "deviceProcedureDescription": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "outcomesEndpoints": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "followUpObservation": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "results": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "adverseEventsSafety": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""},
      "statisticalMethods": {"reported": false, "evidenceQuote": "", "evidenceLocation": ""}
    }
  },
  "relevanceExtracts": {},
  "methodologicalExtracts": {
    "methodValue": "", "methodQuote": "", "methodLocation": "", "methodReported": false,
    "deviceIdentificationValue": "", "deviceIdentificationQuote": "", "deviceIdentificationLocation": "", "deviceIdentificationReported": false,
    "clinicalOutcomeValue": "", "clinicalOutcomeQuote": "", "clinicalOutcomeLocation": "", "clinicalOutcomeReported": false,
    "adequateControlsSelection": "", "adequateControlsQuote": "", "adequateControlsLocation": "", "adequateControlsComment": "",
    "mortalityAEQuote": "", "mortalityAELocation": "", "mortalityAEComment": "",
    "authorsInterpretationQuote": "", "authorsInterpretationLocation": "", "authorsInterpretationComment": "",
    "studyLegalityQuote": "", "studyLegalityLocation": "", "studyLegalityComment": ""
  },
  "contributionExtracts": {
    "outcomeMeasuresQuote": "", "outcomeMeasuresLocation": "", "outcomeMeasuresComment": "",
    "followUpMetricType": "follow_up | overall_survival | stent_patency | not_reported", "followUpQuote": "", "followUpLocation": "", "followUpComment": "",
    "clinicalSignificanceQuote": "", "clinicalSignificanceLocation": "", "clinicalSignificanceComment": ""
  },
  "safetyEventsExtract": {
    "status": "Events reported | No event reported | Not reported",
    "events": [{
      "eventName": "", "eventType": "Adverse Event / Complication | Cause of Recurrence",
      "timing": "", "groupName": "", "deviceName": "",
      "numEvents": "", "totalPatients": "", "reportedRate": "",
      "numeratorType": "patients | events | procedures | episodes | unknown",
      "denominatorType": "patients | events | procedures | episodes | unknown",
      "multipleEventsPerPatient": "Yes | No | Not reported | Unclear",
      "percentageContextQuote": "", "percentageContextLocation": "",
      "parentEvent": null, "isSubItem": false,
      "relationshipType": "none | component | cause | unclear", "isAggregate": false,
      "hierarchyEvidenceType": "explicit_text | table_structure | both | none",
      "hierarchyEvidenceQuote": "", "hierarchyEvidenceLocation": "",
      "hierarchyConfidence": "High | Low",
      "hierarchyReason": "", "breakdownCompleteness": "Complete | Partial | Unknown",
      "classificationStatus": "classified | review_required",
      "evidenceQuote": "", "evidenceLocation": "", "linkedRecurrenceCause": ""
    }],
    "overallMortality": "", "overallMortalityLabel": "",
    "overallMortalityRelatedness": "stent_related | device_related | procedure_related | treatment_related | all_cause | unclear | not_reported",
    "overallMortalityVerificationRequired": false, "overallMortalityVerificationNote": "",
    "overallMortalityEvidenceQuote": "", "overallMortalityEvidenceLocation": "",
    "groupSummaries": [{
      "groupName": "", "deviceName": "", "populationN": "",
      "patientsWithEvents": "", "reinterventions": "",
      "mortality": "", "mortalityLabel": "",
      "mortalityRelatedness": "stent_related | device_related | procedure_related | treatment_related | all_cause | unclear | not_reported",
      "mortalityVerificationRequired": false, "mortalityVerificationNote": "",
      "mortalityEvidenceQuote": "", "mortalityEvidenceLocation": "",
      "evidenceQuote": "", "evidenceLocation": ""
    }]
  }
}

Populate every section according to the extraction rules above. Do not copy a
configured DUE indication into deviceIndication unless the publication itself
supports that indication.`;

      // Keep a lightweight document source for focused corrective calls. These
      // follow-up prompts do not need the PDF binary again when extracted text is
      // available, which keeps repair calls well below preview/proxy time limits.
      const documentContentParts: any[] = paperText && paperText.trim().length > 0
        ? [{ text: `DOCUMENT FULL TEXT:\n${paperText}` }]
        : [...contentParts];
      contentParts.push({ text: promptInstructions });

      let aiResponseText = '';
      let geminiExtractionSuccess = false;

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(500).json({
          success: false,
          error: 'GEMINI_API_KEY is not configured in environment variables. Please set your Gemini API key in Settings > Secrets.',
          failedField: 'Gemini Configuration',
        });
      }

      if (ai) {
        try {
          const contents = contentParts.length === 1 && contentParts[0].text ? contentParts[0].text : contentParts;
          const config = {
            responseMimeType: 'application/json',
          };

          aiResponseText = await callGeminiWithRetry(ai, contents, config);
          if (aiResponseText) geminiExtractionSuccess = true;
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.error('Gemini extraction error:', err);
          if (errMsg.includes('401') || errMsg.includes('UNAUTHENTICATED') || errMsg.includes('authentication credentials') || errMsg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
            return res.status(500).json({
              success: false,
              error: 'GEMINI_API_KEY is invalid or unauthenticated (401). Please check your Gemini API key in Settings > Secrets.',
              failedField: 'Gemini Authentication',
            });
          }
          if (isGeminiDailyQuotaError(err) || err?.code === 'GEMINI_DAILY_QUOTA_EXCEEDED') {
            return res.status(429).json({
              success: false,
              error: errMsg,
              failedField: 'Gemini API Quota',
              errorCode: 'GEMINI_DAILY_QUOTA_EXCEEDED',
              retryable: false,
            });
          }
          return res.status(500).json({
            success: false,
            error: `Gemini extraction failed: ${errMsg}`,
            failedField: 'Gemini PDF Analysis',
          });
        }
      }

      if (!geminiExtractionSuccess || !aiResponseText) {
        return res.status(500).json({
          success: false,
          error: 'Gemini extraction failed: gemini-3.5-flash failed to respond.',
          failedField: 'Gemini PDF Analysis',
        });
      }

      let parsedAi: any = null;
      try {
        parsedAi = JSON.parse(aiResponseText);
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: `Gemini extraction failed: Invalid JSON response from Gemini (${e.message})`,
          failedField: 'Gemini PDF Analysis',
        });
      }

      // Diagnostic logging as requested
      console.log('[Diagnostic] Raw JSON top-level keys:', Object.keys(parsedAi));
      const sampleGroupDiag = (parsedAi?.researchGroups || parsedAi?.research_groups || parsedAi?.groups || parsedAi?.studyGroups || parsedAi?.cohorts || parsedAi?.study_groups || [])[0] || {};
      console.log('[Diagnostic] Research Group internal keys:', Object.keys(sampleGroupDiag));
      const sampleDeviceDiag = (sampleGroupDiag.devices || sampleGroupDiag.deviceList || sampleGroupDiag.stents || [])[0] || {};
      console.log('[Diagnostic] Device internal keys:', Object.keys(sampleDeviceDiag));
      const rawSafetyDiag = parsedAi?.safetyEventsExtract || 
                            parsedAi?.safetyExtracts || 
                            parsedAi?.safetyEvents || 
                            parsedAi?.safety_events || 
                            parsedAi?.adverseEvents || 
                            parsedAi?.adverse_events || 
                            parsedAi?.complications || 
                            parsedAi?.events || 
                            parsedAi?.safety || 
                            parsedAi?.stentMalfunctions || 
                            parsedAi?.stent_malfunctions || 
                            parsedAi?.safetyData || {};
      console.log('[Diagnostic] Safety object internal keys:', Object.keys(rawSafetyDiag));
      console.log('[Diagnostic] Array lengths - researchGroups:', (parsedAi?.researchGroups || parsedAi?.research_groups || parsedAi?.groups || parsedAi?.studyGroups || parsedAi?.cohorts || parsedAi?.study_groups || []).length, 'safetyEvents:', (rawSafetyDiag.events || rawSafetyDiag.complications || rawSafetyDiag.adverseEvents || rawSafetyDiag.eventsList || (Array.isArray(rawSafetyDiag) ? rawSafetyDiag : [])).length);
      console.log('[Diagnostic] Normalization before/after check - sampleDevice before normalization:', {
        deviceType: sampleDeviceDiag.deviceType || sampleDeviceDiag.device_type || sampleDeviceDiag.stentType || 'missing',
        coverType: sampleDeviceDiag.coverType || sampleDeviceDiag.coveringType || sampleDeviceDiag.cover || 'missing',
        indication: sampleDeviceDiag.deviceIndication || sampleDeviceDiag.reportedIndication || sampleDeviceDiag.indication || 'missing',
      });

      // Build structured response with strict validation
      const rawArticleMetadata = parsedAi?.articleMetadata || parsedAi?.metadata || {};
      let articleMetadata = {
        title: rawArticleMetadata.title || parsedAi?.title || fileName.replace('.pdf', '').replace(/_/g, ' '),
        journal: rawArticleMetadata.journal || parsedAi?.journal || 'Not reported',
        publicationYear: rawArticleMetadata.publicationYear || rawArticleMetadata.year || parsedAi?.publicationYear || 'Not reported',
        doi: rawArticleMetadata.doi || parsedAi?.doi || 'Not reported',
        authors: rawArticleMetadata.authors || parsedAi?.authors || 'Not reported',
        totalPatientCount: rawArticleMetadata.totalPatientCount || rawArticleMetadata.patientCount || rawArticleMetadata.sampleSize || parsedAi?.totalPatientCount || 'Not reported',
        studyDesign: rawArticleMetadata.studyDesign || parsedAi?.studyDesign || 'Not reported',
        studyPeriod: rawArticleMetadata.studyPeriod || parsedAi?.studyPeriod || 'Not reported',
        followUpPeriod: rawArticleMetadata.followUpPeriod || rawArticleMetadata.followUp || parsedAi?.followUpPeriod || 'Not reported',
        studyIndication: rawArticleMetadata.studyIndication || rawArticleMetadata.indication || rawArticleMetadata.condition || rawArticleMetadata.population || parsedAi?.studyIndication || parsedAi?.indication || '',
      };

      let rawGroups = parsedAi?.researchGroups || parsedAi?.research_groups || parsedAi?.groups || parsedAi?.studyGroups || parsedAi?.cohorts || parsedAi?.study_groups || [];
      let effectiveGroups = Array.isArray(rawGroups) ? rawGroups : [];

      let correctiveAttempt = 0;
      const maxCorrectiveRetries = 1;

      while (effectiveGroups.length === 0 && correctiveAttempt < maxCorrectiveRetries) {
        correctiveAttempt++;
        console.log(`[Gemini API] Warning: 0 research groups extracted. Performing corrective retry ${correctiveAttempt}/${maxCorrectiveRetries}...`);
        
        const correctivePrompt = [
          ...documentContentParts,
          {
            text: `[CORRECTIVE RETRY REQUIRED (Attempt ${correctiveAttempt})]: Your previous response did not return any valid research groups in 'researchGroups'. You MUST re-examine the document text and extract all actual research groups (study cohorts, arms, or study-wide patient groups) with groupName, groupPatientNumber, devices, and indications. Do NOT fabricate data. If data is missing, use 'Not reported'. Return valid JSON with keys "articleMetadata" and "researchGroups" (array of objects).`
          }
        ];

        try {
          const retryResponseText = await callGeminiWithRetry(ai, correctivePrompt, { responseMimeType: 'application/json' }, 0);
          if (retryResponseText) {
            const retryParsed = JSON.parse(retryResponseText);
            const retryRaw = retryParsed?.researchGroups || retryParsed?.research_groups || retryParsed?.groups || retryParsed?.studyGroups || retryParsed?.cohorts || retryParsed?.study_groups || [];
            if (Array.isArray(retryRaw) && retryRaw.length > 0) {
              effectiveGroups = retryRaw;
              parsedAi = {
                ...parsedAi,
                ...retryParsed,
                articleMetadata: {
                  ...(parsedAi?.articleMetadata || {}),
                  ...(retryParsed?.articleMetadata || {}),
                },
                researchGroups: retryRaw,
              };
              console.log(`[Gemini API] Corrective retry ${correctiveAttempt} succeeded with ${effectiveGroups.length} research groups.`);
              break;
            }
          }
        } catch (retryErr: any) {
          console.log(`[Gemini API] Corrective retry ${correctiveAttempt} failed: ${retryErr.message}`);
        }
      }

      // Validate PRIMARY treatment-arm completeness even when Gemini returned one or two groups.
      // The former code retried only when the group array was empty, which allowed 2-arm and
      // 3-arm studies to be silently truncated. Detect strong source cues and run a focused audit.
      const detectExpectedPrimaryGroupCount = (text: string): number => {
        // General source-structure detector. It intentionally does NOT know any
        // product, study, or arm names. Group-count validation is restricted to
        // the current-study body before Discussion/References so cited literature
        // cannot create false comparator groups.
        const source = String(text || '');
        const t = source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
        let expected = 1;

        const numberWords: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5,
          six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        };
        const toCount = (raw: string | undefined): number => {
          if (!raw) return 0;
          const key = raw.toLowerCase();
          const numeric = Number.parseInt(key, 10);
          return Number.isFinite(numeric) ? numeric : (numberWords[key] || 0);
        };

        // Explicit statements such as "three groups", "4 treatment arms",
        // "randomized into three groups", or "one of three types of stents".
        const explicitCountPatterns = [
          /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:primary\s+|treatment\s+|study\s+|device\s+)?(?:groups?|arms?|cohorts?)\b/gi,
          /\b(?:randomized|randomised|assigned|allocated|divided)\b[\s\S]{0,120}?\b(?:into|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:groups?|arms?|cohorts?)\b/gi,
          /\bone\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:types?|kinds?)\s+of\s+(?:devices?|stents?|treatments?|interventions?)\b/gi,
        ];
        for (const pattern of explicitCountPatterns) {
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(t)) !== null) {
            expected = Math.max(expected, toCount(match[1]));
          }
        }
        if (/\bboth\s+(?:primary\s+|study\s+|treatment\s+)?(?:groups?|arms?|cohorts?)\b/i.test(t)) {
          expected = Math.max(expected, 2);
        }

        // Table/header structure: count unique labels immediately preceding "(n=...)".
        // This works for 2, 3, 4+ arms and deduplicates repeated before/after-matching
        // versions of the same arm because labels are normalized before counting.
        const normalizeArmLabel = (value: string) => value
          .toLowerCase()
          .replace(/\b(?:group|arm|cohort)\b/g, ' ')
          .replace(/[^a-z0-9+&/-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        for (const line of t.split(/\r?\n/)) {
          const labels = new Set<string>();
          const armCellRegex = /\b([A-Za-z][A-Za-z0-9+&/.-]*(?:\s+(?:group|arm|cohort))?)\s*\(\s*n\s*=\s*\d+\s*\)/gi;
          let cell: RegExpExecArray | null;
          while ((cell = armCellRegex.exec(line)) !== null) {
            const label = normalizeArmLabel(cell[1]);
            if (!label || /^(?:n|no|number|total|overall|matched|unmatched|value|smd|p)$/.test(label)) continue;
            labels.add(label);
          }
          if (labels.size >= 2) expected = Math.max(expected, labels.size);
        }

        // Narrative labels with explicit sample sizes, e.g. "treatment group (n=20)"
        // and "control group (n=21)". Count unique labels anywhere in the current study.
        const namedArms = new Set<string>();
        const namedArmRegex = /\b([A-Za-z][A-Za-z0-9+&/.-]*(?:\s+[A-Za-z][A-Za-z0-9+&/.-]*){0,3}\s+(?:group|arm|cohort))\s*\(\s*n\s*=\s*\d+\s*\)/gi;
        let namedArm: RegExpExecArray | null;
        while ((namedArm = namedArmRegex.exec(t)) !== null) {
          const label = normalizeArmLabel(namedArm[1]);
          if (label) namedArms.add(label);
        }
        if (namedArms.size >= 2) expected = Math.max(expected, namedArms.size);

        return Math.max(1, expected);
      };

      const expectedPrimaryGroups = detectExpectedPrimaryGroupCount(paperText);
      if (effectiveGroups.length > 0 && effectiveGroups.length < expectedPrimaryGroups) {
        console.log(`[Gemini API] Group completeness audit: extracted ${effectiveGroups.length}, source strongly indicates at least ${expectedPrimaryGroups}.`);
        const groupAuditPrompt = [
          ...documentContentParts,
          {
            text: `PRIMARY GROUP COMPLETENESS AUDIT — Return JSON only. The current-study source strongly indicates at least ${expectedPrimaryGroups} PRIMARY treatment/device groups, but the previous extraction returned only ${effectiveGroups.length}. Re-read Abstract, Methods/randomization, Results, and the headers of baseline/outcome tables. Return ALL primary treatment/device arms with no maximum group count. Include comparator/control/other-device groups even when they are not DUE. Do NOT create subgroup-analysis cohorts (e.g. anatomic or disease subgroups) as primary groups, and do NOT duplicate the same treatment arms merely because results are reported at multiple analysis timepoints or before/after matching. For each arm return exact source-backed groupName, groupPatientNumber, groupIndicationSummary, groupRole, evidenceQuote/evidenceLocation, and devices (deviceProductName, manufacturer, deviceType, coverType, diameter, length, devicePatientNumber, deviceIndication, evidenceQuote/evidenceLocation). If the same device is used in a device-only/standard arm and an arm with an additional non-device treatment, mark the device-only/standard arm as groupRole="Main" and the added-treatment arm as groupRole="Adjunctive". Never fabricate a device name.`
          },
        ];
        try {
          const auditText = await callGeminiWithRetry(ai, groupAuditPrompt, { responseMimeType: 'application/json' }, 0);
          const auditParsed = JSON.parse(auditText);
          const auditGroups = auditParsed?.researchGroups || auditParsed?.research_groups || auditParsed?.groups || auditParsed?.studyGroups || [];
          if (Array.isArray(auditGroups) && auditGroups.length > effectiveGroups.length) {
            effectiveGroups = auditGroups;
            parsedAi = { ...parsedAi, researchGroups: auditGroups };
            console.log(`[Gemini API] Group completeness audit repaired inventory to ${auditGroups.length} groups.`);
          }
        } catch (auditErr: any) {
          console.warn('[Gemini API] Group completeness audit failed:', auditErr?.message || String(auditErr));
        }
      }

      // Short case reports / video reports may contain valid current-study patients
      // without a conventional arm table. The fallback below is source-structure based:
      // it does not know any manufacturer or product family and never copies DUE input.
      if (effectiveGroups.length === 0) {
        const sourceBeforeDiscussion = String(paperText || '').split(/\b(?:Discussion|References)\b/i)[0] || String(paperText || '');

        const patientIntroMatches = Array.from(sourceBeforeDiscussion.matchAll(
          /\b(?:an?\s+)?(\d{1,3})\s*[- ]?year\s*[- ]?old\s+(male|female|man|woman)\b/gi
        ));
        const caseHeadingMatches = Array.from(sourceBeforeDiscussion.matchAll(/\bcase\s+(\d+)\b/gi));
        const explicitCaseCount = sourceBeforeDiscussion.match(
          /\b(?:we\s+)?(?:report|describe|present)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cases?\b/i
        );
        const caseWordCount: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5,
          six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        };
        const explicitCount = explicitCaseCount
          ? (Number.parseInt(explicitCaseCount[1], 10) || caseWordCount[explicitCaseCount[1].toLowerCase()] || 0)
          : 0;
        const headingCount = caseHeadingMatches.length
          ? Math.max(...caseHeadingMatches.map((m) => Number.parseInt(m[1], 10) || 0))
          : 0;
        const inferredPatientCount = Math.max(explicitCount, headingCount, patientIntroMatches.length > 0 ? patientIntroMatches.length : 0);

        // Generic device form commonly used in case reports:
        // "... stent/device (Product Name; Manufacturer, City, Country)".
        const parentheticalDevices = Array.from(sourceBeforeDiscussion.matchAll(
          /\b(?:stent|device|SEMS|LAMS)\s*\(\s*([^;()]{2,120}?)\s*;\s*([^)]{2,180})\)/gi
        )).map((m) => ({
          productName: m[1].trim(),
          manufacturer: m[2].trim(),
          quote: m[0].trim(),
        }));

        // Also support "Product Stent (Manufacturer...)" when the product name is
        // written before the parenthetical manufacturer.
        const namedProductDevices = Array.from(sourceBeforeDiscussion.matchAll(
          /\b([A-Z][A-Za-z0-9™®+'’.-]*(?:\s+[A-Z0-9][A-Za-z0-9™®+'’.-]*){0,5}\s+(?:Stent|SEMS|LAMS))\s*\(\s*([^)]{2,180})\)/g
        )).map((m) => ({
          productName: m[1].trim(),
          manufacturer: m[2].trim(),
          quote: m[0].trim(),
        }));

        const dedupedDevices = Array.from(
          new Map(
            [...parentheticalDevices, ...namedProductDevices]
              .filter((d) => d.productName && !/^(?:metal|biliary|uncovered|covered|novel)\s+stent$/i.test(d.productName))
              .map((d) => [`${d.productName.toLowerCase()}|${d.manufacturer.toLowerCase()}`, d])
          ).values()
        );

        if (inferredPatientCount > 0 && dedupedDevices.length > 0) {
          const patientSentence = sourceBeforeDiscussion.match(
            /[^.\n]{0,80}\b(?:an?\s+)?\d{1,3}\s*[- ]?year\s*[- ]?old\s+(?:male|female|man|woman)\b[^.\n]{0,200}/i
          )?.[0]?.trim() || `${inferredPatientCount} case(s) described`;

          effectiveGroups = [{
            groupName: inferredPatientCount === 1 ? 'Case report / Study-wide' : 'Case series / Study-wide',
            groupPatientNumber: String(inferredPatientCount),
            groupIndicationSummary: articleMetadata.studyIndication || articleMetadata.title || 'Not reported',
            groupRole: 'Main',
            evidenceQuote: patientSentence,
            evidenceLocation: 'Case presentation',
            devices: dedupedDevices.map((device) => {
              const escapedProduct = device.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const deviceSentence = sourceBeforeDiscussion.match(
                new RegExp(`[^.\\n]{0,140}${escapedProduct}[^.\\n]{0,220}`, 'i')
              )?.[0]?.trim() || device.quote;
              const localSizeMatches = Array.from(deviceSentence.matchAll(
                /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\b/gi
              ));
              const diameters = Array.from(new Set(localSizeMatches.map((m) => `${m[1]} mm`)));
              const lengths = Array.from(new Set(localSizeMatches.map((m) => `${m[2]} mm`)));

              return {
                deviceProductName: device.productName,
                manufacturer: device.manufacturer || 'Not reported',
                deviceType: /\b(?:SEMS|self[- ]expand(?:able|ing)|metal\s+stent|nitinol)\b/i.test(deviceSentence)
                  ? 'Self-expandable metal stent'
                  : /\bLAMS\b/i.test(deviceSentence)
                    ? 'Lumen-apposing metal stent'
                    : 'Not reported',
                coverType: /\buncovered\b/i.test(deviceSentence)
                  ? 'Uncovered'
                  : /\bfully\s+covered\b/i.test(deviceSentence)
                    ? 'Fully covered'
                    : /\bpartially\s+covered\b/i.test(deviceSentence)
                      ? 'Partially covered'
                      : 'Not reported',
                diameter: diameters.length ? diameters.join('; ') : 'Not reported',
                length: lengths.length ? lengths.join('; ') : 'Not reported',
                devicePatientNumber: dedupedDevices.length === 1 ? String(inferredPatientCount) : 'Not separately reported',
                deviceIndication: articleMetadata.studyIndication || articleMetadata.title || 'Not reported',
                evidenceQuote: deviceSentence,
                evidenceLocation: 'Case presentation / Figure caption',
              };
            }),
          }];
          parsedAi = { ...parsedAi, researchGroups: effectiveGroups };
          console.log(`[Gemini API] Source-backed case-report fallback created a study-wide group with ${inferredPatientCount} patient(s) and ${dedupedDevices.length} named device(s).`);
        }
      }

      if (effectiveGroups.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Research group extraction incomplete after validation retry. No source-backed group could be recovered.',
          failedField: 'Gemini PDF Analysis',
        });
      }

      // Repair only explicitly evidenced core fields that the broad extraction
      // omitted. The retry returns source-backed values and never copies DUE input.
      const isMissingExtractedValue = (value: unknown) => {
        const normalized = String(value ?? '').trim().toLowerCase();
        return !normalized || normalized === 'not reported' || normalized === 'not assessable' || normalized === 'unknown' || normalized === 'n/a' || normalized === 'na';
      };
      const rawDeviceList = (group: any): any[] => group?.devices || group?.deviceList || group?.stents || [];
      const rawGroupIndication = (group: any) =>
        group?.groupIndicationSummary || group?.groupIndication || group?.indication || group?.targetIndication || '';
      const rawDeviceIndication = (device: any) =>
        device?.deviceIndication || device?.reportedIndication || device?.indication || device?.studyIndication ||
        device?.groupIndication || device?.targetIndication || device?.disease || device?.condition ||
        device?.population || device?.clinicalIndication || '';

      const hasClinicalIndicationEvidence = /\b(?:malignant|benign|unresectable|cancer|carcinoma|stricture|obstruction|dysphagia|fistula|pseudocyst|walled[- ]off necrosis|fluid collection|gallbladder drainage)\b/i.test(paperText);
      const hasCoverEvidence = /\b(?:fully covered|partially covered|uncovered|bare[- ](?:ended|type)|covered metal stent|fcsems|pcsems|ucsems)\b/i.test(paperText);
      const hasDeviceTypeEvidence = /\b(?:self[- ]expand(?:able|ing)|sems|lams|metal stent|nitinol stent|plastic stent)\b/i.test(paperText);

      const needsCoreFieldRepair = effectiveGroups.some((group: any) => {
        const groupIndicationMissing = isMissingExtractedValue(rawGroupIndication(group));
        return rawDeviceList(group).some((device: any) =>
          (hasClinicalIndicationEvidence && groupIndicationMissing && isMissingExtractedValue(rawDeviceIndication(device))) ||
          (hasCoverEvidence && isMissingExtractedValue(device.coverType || device.coveringType || device.cover)) ||
          (hasDeviceTypeEvidence && isMissingExtractedValue(device.deviceType || device.stentType || device.productType))
        );
      });

      if (needsCoreFieldRepair) {
        console.log('[Gemini API] Core device/indication fields are incomplete despite document evidence. Performing focused corrective retry...');
        const coreFieldRepairPrompt = [
          ...documentContentParts,
          {
            text: `FOCUSED CORE-FIELD REPAIR: Return JSON only. Re-examine the title, abstract, patient eligibility, methods, device description, tables, and figure captions. Extract only source-backed values; never copy the configured DUE indication and never guess. Return: {"articleMetadata":{"studyIndication":"","studyIndicationEvidenceQuote":"","studyIndicationEvidenceLocation":""},"researchGroups":[{"groupName":"","groupIndicationSummary":"","evidenceQuote":"","evidenceLocation":"","devices":[{"deviceProductName":"","deviceType":"","coverType":"","deviceIndication":"","evidenceQuote":"","evidenceLocation":""}]}]}. Use exact article terminology. If a value is genuinely absent, use "Not reported".`
          },
        ];

        try {
          const repairResponseText = await callGeminiWithRetry(ai, coreFieldRepairPrompt, { responseMimeType: 'application/json' }, 0);
          const repairParsed = JSON.parse(repairResponseText);
          const repairGroups = repairParsed?.researchGroups || repairParsed?.research_groups || repairParsed?.groups || [];
          const normalizeMatchKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const preferExisting = (current: unknown, repaired: unknown) =>
            isMissingExtractedValue(current) && !isMissingExtractedValue(repaired) ? repaired : current;

          if (Array.isArray(repairGroups) && repairGroups.length > 0) {
            effectiveGroups = effectiveGroups.map((group: any, groupIndex: number) => {
              const groupKey = normalizeMatchKey(group.groupName || group.name || group.cohortName || group.studyGroup);
              const repairGroup = repairGroups.find((candidate: any) => {
                const candidateKey = normalizeMatchKey(candidate.groupName || candidate.name || candidate.cohortName || candidate.studyGroup);
                return groupKey && candidateKey && (groupKey === candidateKey || groupKey.includes(candidateKey) || candidateKey.includes(groupKey));
              }) || (repairGroups.length === effectiveGroups.length ? repairGroups[groupIndex] : undefined);
              if (!repairGroup) return group;

              const existingDevices = rawDeviceList(group);
              const repairedDevices = rawDeviceList(repairGroup);
              const mergedDevices = existingDevices.map((device: any, deviceIndex: number) => {
                const deviceKey = normalizeMatchKey(device.deviceProductName || device.productName || device.deviceName || device.name);
                const repairDevice = repairedDevices.find((candidate: any) => {
                  const candidateKey = normalizeMatchKey(candidate.deviceProductName || candidate.productName || candidate.deviceName || candidate.name);
                  return deviceKey && candidateKey && (deviceKey === candidateKey || deviceKey.includes(candidateKey) || candidateKey.includes(deviceKey));
                }) || (repairedDevices.length === existingDevices.length ? repairedDevices[deviceIndex] : undefined);
                if (!repairDevice) return device;
                return {
                  ...device,
                  deviceType: preferExisting(device.deviceType || device.stentType || device.productType, repairDevice.deviceType || repairDevice.stentType || repairDevice.productType),
                  coverType: preferExisting(device.coverType || device.coveringType || device.cover, repairDevice.coverType || repairDevice.coveringType || repairDevice.cover),
                  deviceIndication: preferExisting(rawDeviceIndication(device), rawDeviceIndication(repairDevice)),
                  evidenceQuote: preferExisting(device.evidenceQuote, repairDevice.evidenceQuote),
                  evidenceLocation: preferExisting(device.evidenceLocation, repairDevice.evidenceLocation),
                };
              });

              return {
                ...group,
                groupIndicationSummary: preferExisting(rawGroupIndication(group), rawGroupIndication(repairGroup)),
                evidenceQuote: preferExisting(group.evidenceQuote, repairGroup.evidenceQuote),
                evidenceLocation: preferExisting(group.evidenceLocation, repairGroup.evidenceLocation),
                devices: mergedDevices.length > 0 ? mergedDevices : repairedDevices,
              };
            });
          }

          const repairedArticleMetadata = repairParsed?.articleMetadata || {};
          articleMetadata = {
            ...articleMetadata,
            studyIndication: preferExisting(
              articleMetadata.studyIndication,
              repairedArticleMetadata.studyIndication || repairedArticleMetadata.indication || repairParsed?.studyIndication || repairParsed?.indication
            ) as string,
          };
        } catch (repairError: any) {
          console.warn('[Gemini API] Focused core-field repair failed:', repairError?.message || String(repairError));
        }
      }

      // Enrich research groups with strict deterministic classification rules
      let researchGroups = effectiveGroups.map((g: any, gIdx: number) => {
        const gId = g.id || `grp-${gIdx + 1}`;
        const gName = g.groupName || g.name || g.cohortName || g.studyGroup || g.group_name || `Group ${gIdx + 1}`;
        const gPatNum = g.groupPatientNumber || g.patientsN || g.totalPatients || g.n || g.patient_number || 'Not reported';
        const gIndSum = g.groupIndicationSummary || g.indication || g.groupIndication || g.targetIndication || articleMetadata.studyIndication || '';

        const groupDevices = (g.devices || g.deviceList || g.stents || []).map((d: any, dIdx: number) => {
          const dId = `dev-${gIdx + 1}-${dIdx + 1}`;
          let prodName = d.deviceProductName || d.productName || d.deviceName || d.name || d.device_name || 'Not reported';
          let mfg = d.manufacturer || d.maker || d.company || d.brand || 'Not reported';
          let devType = d.deviceType || d.device_type || d.stentType || d.stent_type || d.productType || d.category || 'Not reported';
          let coverType = d.coverType || d.coveringType || d.covering_type || d.coverage || d.coveredType || d.stentCovering || d.stent_covering || d.cover || 'Not reported';
          let diameter = d.diameter || d.stentDiameter || d.size || d.diameter_mm || 'Not reported';
          let length = d.length || d.stentLength || d.length_mm || 'Not reported';
          let devPatNum = d.devicePatientNumber || d.patientNumber || d.n || 'Not separately reported';
          let rawInd = d.deviceIndication || d.reportedIndication || d.indication || d.studyIndication || d.groupIndication || d.targetIndication || d.disease || d.condition || d.population || d.clinicalIndication || gIndSum || articleMetadata.studyIndication || 'Not reported';

          const cleanIndRes = cleanExtractedIndicationText(rawInd);
          const ind = cleanIndRes.isRelationshipOnly || !cleanIndRes.cleaned ? 'Not reported' : cleanIndRes.cleaned;

          // Strictly filter ethics committees out of manufacturer
          if (/human research committee|institutional review board|ethics committee|hospital|university|college|department of/i.test(mfg)) {
            mfg = 'Not reported';
          }

          const indicationContext = ind !== 'Not reported' ? ind : (gIndSum || gName || '');
          const devRel = classifyDeviceWithAnatomicalContext(prodName, mfg, dueList, indicationContext, similarDevices, coverType);
          let indRel = evaluateIndicationWithInventory(
            ind,
            devRel.type,
            devRel.matchedDueId,
            devRel.dueMatchStatus,
            dueList
          );

          // In a single-cohort study, the article title is valid study-level
          // indication evidence. Use it as a conservative fallback only when
          // the device/group text was Related or Not reported, never to
          // override an explicit Different/Mixed indication.
          const articleTitle = String(articleMetadata.title || '').trim();
          const titleHasClinicalIndication =
            /(?:malignant|benign|cancer|carcinoma|stricture|stenosis|obstruction|dysphagia|fistula|pseudocyst|walled[- ]off necrosis|fluid collection|cholecystitis)/i.test(articleTitle);

          if (
            effectiveGroups.length === 1 &&
            titleHasClinicalIndication &&
            (indRel.type === 'Related indication' || indRel.type === 'Not reported')
          ) {
            const titleIndRel = evaluateIndicationWithInventory(
              articleTitle,
              devRel.type,
              devRel.matchedDueId,
              devRel.dueMatchStatus,
              dueList
            );

            if (titleIndRel.type === 'Same indication') {
              indRel = {
                ...titleIndRel,
                rationale: `Matched DUE Indication: "${titleIndRel.matchedDueIndication || 'Configured DUE indication'}". Extracted indication: "${ind}". Article title: "${articleTitle}". The title explicitly identifies the study population as the same clinical indication and resolves the broader wording used in the group/device text.`,
              };
            }
          }

          console.log(`[Diagnostic] Normalization after check for device ${dId}:`, {
            prodName,
            mfg,
            devType,
            coverType,
            diameter,
            length,
            ind,
          });

          return {
            id: dId,
            deviceProductName: prodName,
            manufacturer: mfg,
            deviceType: devType,
            coverType: coverType,
            diameter: diameter,
            length: length,
            devicePatientNumber: devPatNum,
            deviceIndication: ind,
            matchedDueId: devRel.matchedDueId,
            matchedDueName: devRel.matchedDueName,
            dueMatchStatus: devRel.dueMatchStatus,
            mappedSimilarDeviceName: devRel.mappedSimilarDeviceName,
            mappedSimilarDeviceManufacturer: devRel.mappedSimilarDeviceManufacturer,
            matchBasis: devRel.matchBasis,
            evidence: {
              quote: d.evidenceQuote || 'Direct sentence from paper',
              location: d.evidenceLocation || 'Methods section',
              source_page: d.evidenceLocation || 'Page 1',
            },
            deviceRelationship: {
              aiRecommended: devRel.type,
              userFinal: devRel.type,
              evidence: {
                quote: d.evidenceQuote || `${prodName} (${mfg})`,
                location: d.evidenceLocation || 'Methods',
              },
              rationale: devRel.rationale,
            },
            indicationRelationship: {
              aiRecommended: indRel.type,
              userFinal: indRel.type,
              comparedAgainstDueId: indRel.comparedAgainstDueId,
              comparedAgainstDueName: indRel.comparedAgainstDueName,
              evidence: {
                quote: d.evidenceQuote || ind,
                location: d.evidenceLocation || 'Methods',
              },
              rationale: indRel.rationale,
            },
          };
        });

        return {
          id: gId,
          groupName: gName,
          groupPatientNumber: gPatNum,
          groupIndicationSummary: gIndSum,
          groupRole: g.groupRole || g.role || 'Study group',
          evidence: {
            quote: g.evidenceQuote || 'Group description in text',
            location: g.evidenceLocation || 'Methods',
            source_page: g.evidenceLocation || 'Page 1',
          },
          devices: groupDevices,
        };
      });

      // Generic device-evaluation role repair. If two or more arms use the same
      // device/DUE but one arm is explicitly device-only/standard/control and another
      // adds a non-device adjunctive treatment, keep every arm and label their roles.
      // No study name, product name, or specific adjunctive modality is required.
      if (researchGroups.length >= 2) {
        const normalizeProductKey = (value: unknown) => String(value ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const groupDeviceKeys = researchGroups.map((g: any) => {
          const keys = new Set<string>();
          (g.devices || []).forEach((d: any) => {
            if (d.matchedDueName) keys.add(`due:${normalizeProductKey(d.matchedDueName)}`);
            const productKey = normalizeProductKey(d.deviceProductName);
            if (productKey && productKey !== 'not reported') keys.add(`product:${productKey}`);
          });
          return keys;
        });
        const sharesDevice = (a: number, b: number) =>
          Array.from(groupDeviceKeys[a]).some((key) => groupDeviceKeys[b].has(key));

        const roleText = (g: any) =>
          `${g.groupName || ''} ${g.groupRole || ''} ${g.evidence?.quote || ''}`.toLowerCase();
        const mainCue = /\b(?:control|standard|conventional|usual\s+care|device[- ]only|stent[- ]only|implant[- ]only|alone|without\s+(?:adjunct|additional|add[- ]on))\b/i;
        const adjunctCue = /\b(?:adjunct(?:ive)?|add[- ]on|plus|combined|combination|with\s+(?:additional\s+)?(?:therapy|treatment|procedure|ablation|radiotherapy|chemotherapy|drug|balloon|dilation)|radiofrequency\s+ablation)\b/i;

        const roleUpdates = new Map<number, 'Main' | 'Adjunctive'>();
        for (let i = 0; i < researchGroups.length; i++) {
          for (let j = i + 1; j < researchGroups.length; j++) {
            if (!sharesDevice(i, j)) continue;
            const iText = roleText(researchGroups[i]);
            const jText = roleText(researchGroups[j]);
            const iMain = mainCue.test(iText);
            const jMain = mainCue.test(jText);
            const iAdjunct = adjunctCue.test(iText);
            const jAdjunct = adjunctCue.test(jText);

            if (iMain && jAdjunct && !jMain) {
              roleUpdates.set(i, 'Main');
              roleUpdates.set(j, 'Adjunctive');
            } else if (jMain && iAdjunct && !iMain) {
              roleUpdates.set(j, 'Main');
              roleUpdates.set(i, 'Adjunctive');
            }
          }
        }

        if (roleUpdates.size > 0) {
          researchGroups = researchGroups.map((g: any, idx: number) => ({
            ...g,
            groupRole: roleUpdates.get(idx) || g.groupRole,
          }));
        }
      }

      // Keep source order for group-wise table parsing, but separately identify the
      // device-evaluation main arm. This prevents an adjunctive first-listed arm
      // using the same DUE device from being treated as the main device group.
      const primaryResearchGroup = researchGroups.find((g: any) => g.groupRole === 'Main') || researchGroups[0];

      // Compute Suitability Appraisal according to IMDRF MDCE WG/N56FINAL:2019 Appendices D1
      const suitabilityComments = parsedAi?.suitabilityComments || {};
      const allDevices = researchGroups.flatMap((g: any) => g.devices);
      const topDueDevice = allDevices.find((d: any) => d.deviceRelationship.aiRecommended === 'DUE') || allDevices[0];
      const topSameIndDevice = allDevices.find((d: any) => d.indicationRelationship.aiRecommended === 'Same indication') || allDevices[0];

      const anyDueDevice = allDevices.some((d: any) => d.deviceRelationship.aiRecommended === 'DUE');
      const anySimDevice = allDevices.some((d: any) => d.deviceRelationship.aiRecommended === 'Similar Device');
      const matchedDueNames = Array.from(new Set(
        allDevices
          .filter((d: any) => d.deviceRelationship.aiRecommended === 'DUE')
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

      // Keep the separate Methodological Appraisal statistical-method rule strict.
      const hasStats = Boolean(suitabilityComments.hasStatisticalMethodsReported);

      // Suitability Criterion #4 is scored from 9 independent report/data-collation
      // dimensions. It no longer drops from 3 -> 2 solely because statistical
      // methods are absent. For THIS criterion, statistical software alone counts
      // as Reported and any follow-up mention counts as Reported even without a duration.
      const reportDimsRaw = suitabilityComments.reportCollationDimensions || {};
      const currentStudyText = (() => {
        const source = String(paperText || '');
        return source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
      })();
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
      const outcomeEvidenceQuote = parsedAi?.contributionExtracts?.outcomeMeasuresQuote || parsedAi?.methodologicalExtracts?.clinicalOutcomeQuote || 'Not reported';
      const followMentionQuote = sentenceAround(/\bfollow(?:ed)?[- ]?up\b|\bfollowing\s+up\b|\bobservation(?:al)?\s+period\b/i);
      const resultsEvidenceQuote = isMeaningfulReportedText(parsedAi?.contributionExtracts?.outcomeMeasuresQuote)
        ? parsedAi.contributionExtracts.outcomeMeasuresQuote
        : sentenceAround(/\bresults?\b/i);
      const safetyExtractForCriterion = parsedAi?.safetyEventsExtract || {};
      const firstSafetyQuote = (safetyExtractForCriterion.events || []).find((e: any) => isMeaningfulReportedText(e?.evidenceQuote))?.evidenceQuote
        || safetyExtractForCriterion.overallMortalityEvidenceQuote
        || sentenceAround(/\b(?:adverse\s+events?|complications?|safety|no\s+complications?|no\s+adverse\s+events?)\b/i);
      const statisticalSoftwareQuote = sentenceAround(/\b(?:SPSS|SAS|Stata|StatView|GraphPad\s+Prism|MedCalc|JMP|R\s+(?:software|version|package))\b/i);

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
          parsedAi?.contributionExtracts?.outcomeMeasuresLocation || parsedAi?.methodologicalExtracts?.clinicalOutcomeLocation || 'Methods / Results'
        ),
        normalizeReportDimension(
          'followUpObservation',
          'Follow-up or observation',
          isMeaningfulReportedText(followMentionQuote) || isMeaningfulReportedText(articleMetadata.followUpPeriod) || isMeaningfulReportedText(parsedAi?.contributionExtracts?.followUpQuote),
          isMeaningfulReportedText(followMentionQuote) ? followMentionQuote : String(parsedAi?.contributionExtracts?.followUpQuote || articleMetadata.followUpPeriod || 'Not reported'),
          parsedAi?.contributionExtracts?.followUpLocation || 'Methods / Results'
        ),
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
        normalizeReportDimension(
          'statisticalMethods',
          'Statistical methods / software',
          hasStats || isMeaningfulReportedText(statisticalSoftwareQuote),
          isMeaningfulReportedText(statisticalSoftwareQuote) ? statisticalSoftwareQuote : (hasStats ? String(suitabilityComments.acceptableReportQuote || 'Statistical methods reported') : 'Not reported'),
          isMeaningfulReportedText(statisticalSoftwareQuote) ? 'Methods / Statistical analysis' : (suitabilityComments.acceptableReportLocation || 'Methods')
        ),
      ];

      const reportMissingCount = reportChecklist.filter((d: any) => !d.reported).length;
      const reportReportedCount = reportChecklist.length - reportMissingCount;
      const reportSelection = reportMissingCount <= 2
        ? 'High quality'
        : reportMissingCount <= 6
        ? 'Minor deficiencies'
        : 'Insufficient information';
      const reportScore = reportMissingCount <= 2 ? 3 : reportMissingCount <= 6 ? 2 : 1;
      const missingDimensionNames = reportChecklist.filter((d: any) => !d.reported).map((d: any) => d.item);
      const reportEvidenceItem = reportChecklist.find((d: any) => d.reported && isMeaningfulReportedText(d.evidenceQuote));

      const deviceComment = topDueDevice?.deviceRelationship?.rationale
        ? topDueDevice.deviceRelationship.rationale
        : `Evaluated device(s): ${allDevices.map((d: any) => `${d.deviceProductName} (${d.manufacturer})`).join(', ')}`;

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
          matchedDueProductName: matchedDueDisplay || topDueDevice?.matchedDueName || (anyDueDevice ? due.productName : undefined),
          evidence: {
            quote: topDueDevice?.evidence?.quote || suitabilityComments.appropriateDeviceQuote || 'Device description in paper',
            location: topDueDevice?.evidence?.location || suitabilityComments.appropriateDeviceLocation || 'Methods',
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
          matchedDueProductName: matchedDueDisplay || topDueDevice?.matchedDueName || (anyDueDevice ? due.productName : undefined),
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
          comment: `Core quality dimensions reported: ${reportReportedCount}/9; Not reported: ${reportMissingCount}/9${missingDimensionNames.length > 0 ? ` (${missingDimensionNames.join(', ')})` : ''}. Score rule: 0–2 missing = High quality (3), 3–6 missing = Minor deficiencies (2), 7–9 missing = Insufficient information (1).`,
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
      const parsedGender = formatGenderDistribution(
        relExt.genderComment,
        relExt.genderQuote,
        researchGroups,
        paperText
      );
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
            location: parsedGender.isReported ? (relExt.genderLocation || parsedGender.location) : 'Not reported',
          },
          comment: parsedGender.isReported ? parsedGender.formattedDistribution : 'Not reported',
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
      const methodVal = methodExt.methodValue || articleMetadata.studyDesign || 'Cohort study';
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
      const devReported = groupDeviceList.length > 0 || (methodExt.deviceIdentificationReported !== false && devSummaryVal !== 'Not reported');

      const methOutcomeVal = isMissingExtractedValue(methodExt.clinicalOutcomeValue)
        ? 'Not reported'
        : String(methodExt.clinicalOutcomeValue).trim();
      const methOutcomeQuote = isMissingExtractedValue(methodExt.clinicalOutcomeQuote)
        ? 'Not reported'
        : String(methodExt.clinicalOutcomeQuote).trim();
      const methOutcomeLoc = methOutcomeQuote === 'Not reported'
        ? 'Not reported'
        : (methodExt.clinicalOutcomeLocation || 'Results');
      const methOutcomeReported = methOutcomeVal !== 'Not reported' && methOutcomeQuote !== 'Not reported';

      const isElementaryAdequate = methodReported || devReported || methOutcomeReported;
      const methElementaryScore = isElementaryAdequate ? 2 : 1;
      const methElementarySelection = isElementaryAdequate ? 'Adequate (2)' : 'Non adequate (1)';

      const methStatsScore = hasStats ? 2 : 1;
      const methStatsSelection = hasStats ? 'Adequate (2)' : 'Non adequate (1)';

      const methControlsSelection = methodExt.adequateControlsSelection === 'Non adequate (1)' ? 'Non adequate (1)' : 'Adequate (2)';
      const methControlsScore = methControlsSelection === 'Adequate (2)' ? 2 : 1;

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
            ? `All ${groupDeviceList.length || 1} study group device(s) and elementary aspects (Method, Device identification, Clinical outcomes) documented from research group inventory.`
            : 'None of the three elementary aspects are reported in the article.',
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
            quote: patientReported ? `Total patient count reported: ${rawPatientText}` : 'Not reported',
            location: patientReported ? 'Methods / Results' : 'Not reported',
          },
          comment: patientReported && patientCount !== null
            ? `Total sample size: ${patientCount} patients evaluated.`
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
            quote: hasStats ? (suitabilityComments.acceptableReportQuote || 'Statistical analysis was performed using standard methods') : 'Not reported',
            location: hasStats ? (suitabilityComments.acceptableReportLocation || 'Methods') : 'Not reported',
          },
          comment: hasStats ? (suitabilityComments.acceptableReportComment || 'Statistical methods explicitly documented.') : 'No specific statistical methods or comparative statistical analysis techniques were reported in the text.',
          status: (hasStats ? 'Reported' : 'Not reported') as any,
        },
        adequateControls: {
          ...DEFAULT_METHODOLOGICAL_CRITERIA.adequateControls,
          aiRecommendedSelection: methControlsSelection,
          aiRecommendedScore: methControlsScore,
          userFinalSelection: methControlsSelection,
          userFinalScore: methControlsScore,
          evidence: {
            quote: methodExt.adequateControlsQuote || 'Study cohorts and patient allocation described',
            location: methodExt.adequateControlsLocation || 'Methods',
          },
          comment: methodExt.adequateControlsComment || 'Evaluation of confounding factors and patient selection.',
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

      // Follow-up priority hierarchy: 1. Follow-up duration -> 2. Overall survival -> 3. Stent patency duration -> 4. Not reported
      const followUpText = (articleMetadata.followUpPeriod && articleMetadata.followUpPeriod !== 'Not reported')
        ? articleMetadata.followUpPeriod
        : (paperText.match(/(?:median|mean|mean\s*±\s*SD|range)?\s*(?:follow-up|follow\s*up|observation\s*period)\s*(?:duration\s*)?(?:of|was|:)?\s*([^\.\n;]+(?:months?|weeks?|days?|years?)[^\.\n;]*)/i)?.[0] || '');

      const survivalMatch = paperText.match(/(?:median|mean)?\s*(?:overall\s*survival|OS)\s*(?:of|was|:)?\s*([^\.\n;]+(?:months?|weeks?|days?|years?)[^\.\n;]*)/i);
      const survivalText = survivalMatch ? survivalMatch[0] : '';

      const patencyMatch = paperText.match(/(?:median|mean)?\s*(?:stent\s*patency|patency\s*duration|functional\s*patency)\s*(?:of|was|:)?\s*([^\.\n;]+(?:months?|weeks?|days?|years?)[^\.\n;]*)/i);
      const patencyDurationText = patencyMatch ? patencyMatch[0] : '';

      let fuQuote = 'Not reported';
      let fuLocation = 'Not reported';
      let fuComment = 'Neither follow-up period, overall survival, nor patency duration were reported in the text.';
      let fuSelection = 'No (1)';
      let fuScore = 1;
      let fuStatus = 'Not reported';

      if (contExt.followUpMetricType && contExt.followUpMetricType !== 'not_reported' && contExt.followUpQuote && contExt.followUpQuote !== 'Not reported') {
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
      } else if (survivalText && survivalText.trim().length > 0) {
        fuQuote = `Follow-up period not reported. Overall survival was used as the available longitudinal metric: "${survivalText.trim()}"`;
        fuLocation = 'Results';
        fuComment = 'Follow-up period was not reported. Overall survival duration was utilized as the alternative longitudinal time metric.';
        fuSelection = 'Yes (2)';
        fuScore = 2;
        fuStatus = 'Reported';
      } else if (patencyDurationText && patencyDurationText.trim().length > 0) {
        fuQuote = `Follow-up period and overall survival not reported. Stent patency duration was used as the available time metric: "${patencyDurationText.trim()}"`;
        fuLocation = 'Results';
        fuComment = 'Follow-up period and overall survival were not reported. Stent patency duration was utilized as the available time metric.';
        fuSelection = 'Yes (2)';
        fuScore = 2;
        fuStatus = 'Reported';
      }

      // Outcome measures: score 2 only when an actual quantitative performance/safety result is extracted.
      const contOutcomeQuote = isMissingExtractedValue(contExt.outcomeMeasuresQuote)
        ? 'Not reported'
        : String(contExt.outcomeMeasuresQuote).trim();
      const contOutcomeReported = contOutcomeQuote !== 'Not reported' && /\d|%/.test(contOutcomeQuote);
      const contOutcomeLoc = contOutcomeReported
        ? (contExt.outcomeMeasuresLocation || 'Results / Tables')
        : 'Not reported';
      const contOutcomeComment = contOutcomeReported
        ? (contExt.outcomeMeasuresComment || 'Quantitative performance or safety outcome(s) reported.')
        : 'No quantitative device performance or safety outcome was extracted from the article.';
      const contOutcomeScore = contOutcomeReported ? 2 : 1;
      const contOutcomeSelection = contOutcomeReported ? 'Yes (2)' : 'No (1)';

      // Clinical significance: score 2 only when an actual quantitative clinical result is extracted.
      const clinQuote = isMissingExtractedValue(contExt.clinicalSignificanceQuote)
        ? 'Not reported'
        : String(contExt.clinicalSignificanceQuote).trim();
      const clinReported = clinQuote !== 'Not reported' && /\d|%/.test(clinQuote);
      const clinLoc = clinReported
        ? (contExt.clinicalSignificanceLocation || 'Results / Tables')
        : 'Not reported';
      const clinComment = clinReported
        ? (contExt.clinicalSignificanceComment || 'Quantitative clinical outcome(s) support assessment of treatment effect.')
        : 'No quantitative clinical outcome was extracted to support clinical significance.';
      const clinScore = clinReported ? 2 : 1;
      const clinSelection = clinReported ? 'Yes (2)' : 'No (1)';

      const contStatsScore = hasStats ? 2 : 1;
      const contTotal = 2 + contOutcomeScore + fuScore + contStatsScore + clinScore;

      const contribution: ContributionAppraisalState = {
        dataSourceType: {
          ...DEFAULT_CONTRIBUTION_CRITERIA.dataSourceType,
          aiRecommendedSelection: 'Yes (2)',
          aiRecommendedScore: 2,
          userFinalSelection: 'Yes (2)',
          userFinalScore: 2,
          evidence: {
            quote: articleMetadata.studyDesign || 'Clinical observational study design',
            location: 'Methods',
          },
          comment: 'Appropriate clinical study design documented.',
          status: 'Reported' as any,
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
          aiRecommendedSelection: hasStats ? 'Yes (2)' : 'No (1)',
          aiRecommendedScore: contStatsScore,
          userFinalSelection: hasStats ? 'Yes (2)' : 'No (1)',
          userFinalScore: contStatsScore,
          evidence: {
            quote: hasStats ? (suitabilityComments.acceptableReportQuote || 'Statistical analysis performed') : 'Not reported',
            location: hasStats ? (suitabilityComments.acceptableReportLocation || 'Methods') : 'Not reported',
          },
          comment: hasStats ? (suitabilityComments.acceptableReportComment || 'Statistical analysis provided in publication.') : 'No specific statistical analysis methods reported in the text.',
          status: (hasStats ? 'Reported' : 'Not reported') as any,
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

      // ==========================================
      // Step 4: Safety Event Extraction Builder
      // ==========================================
      const rawSafety = parsedAi?.safetyEventsExtract || 
                        parsedAi?.safetyExtracts || 
                        parsedAi?.safetyEvents || 
                        parsedAi?.safety_events || 
                        parsedAi?.adverseEvents || 
                        parsedAi?.adverse_events || 
                        parsedAi?.complications || 
                        parsedAi?.events || 
                        parsedAi?.safety || 
                        parsedAi?.stentMalfunctions || 
                        parsedAi?.stent_malfunctions ||
                        parsedAi?.safetyData || {};

      let rawSafetyEvents: any[] = Array.isArray(rawSafety.events) ? rawSafety.events :
                                    Array.isArray(rawSafety.complications) ? rawSafety.complications :
                                    Array.isArray(rawSafety.adverseEvents) ? rawSafety.adverseEvents :
                                    Array.isArray(rawSafety.eventsList) ? rawSafety.eventsList :
                                    Array.isArray(rawSafety) ? rawSafety : [];
      let rawTimingSummaries: any[] = Array.isArray(rawSafety.timingSummaries) ? rawSafety.timingSummaries : 
                                      Array.isArray(rawSafety.timing_summaries) ? rawSafety.timing_summaries : [];

      // A zero-mortality statement is not an overall no-event statement. Keep
      // mortality and event absence as independent facts.
      const explicitNoOverallEventPattern = /(?:\bno\s+(?:(?:overall|major|minor|serious|device[- ]related|procedure[- ]related)\s+)?(?:adverse\s+events?|complications?|safety\s+events?|safety\s+issues?)\s+(?:(?:were|was)\s+)?(?:observed|reported|noted|found|recorded|identified|occurred)\b|\bwithout\s+(?:(?:the|any)\s+)?(?:occurrence\s+of\s+)?(?:adverse\s+events?|complications?|safety\s+events?)\b|\b(?:adverse\s+events?|complications?)\s+(?:did\s+not|were\s+not)\s+(?:occur|develop|arise|occurred|observed|reported)\b)/i;
      const explicitNoMortalityPattern = /\bno\s+(?:procedure[- ]related\s+|device[- ]related\s+|treatment[- ]related\s+)?(?:deaths?|mortality)\s+(?:(?:were|was)\s+)?(?:observed|reported|noted|found|recorded|occurred)\b/i;

      const positiveSafetyEvidencePatterns = [
        /\b(?:stent\s+)?(?:occlusion|migration|malfunction|dysfunction|perforation|bleeding|pancreatitis|cholangitis|insufficient\s+(?:stent\s+)?expansion)\s+(?:occurred|developed|was\s+observed|were\s+observed)\s+in\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:mild\s+|moderate\s+|severe\s+)?(?:cases?|patients?)\b/i,
        /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:mild\s+|moderate\s+|severe\s+)?(?:cases?|patients?)\s+(?:experienced|developed|had|underwent|occurred)\s+(?:an?\s+)?(?:adverse\s+event|complication|stent\s+occlusion|stent\s+migration|reintervention|perforation|bleeding|pancreatitis|cholangitis)/i,
        /\b(?:other|early|late|serious|procedure[- ]related|device[- ]related)?\s*complications?\s+(?:occurred|developed|included|consisted\s+of)\b/i,
        /\b(?:adverse\s+events?|complications?|stent\s+(?:occlusion|migration|malfunction|dysfunction)|reinterventions?)\b[^\n]{0,120}\b(?:n\s*[=⫽]\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%)\b/i,
      ];
      const hasPositiveSafetyEvidence = positiveSafetyEvidencePatterns.some((pattern) => pattern.test(paperText));
      const hasExplicitNoOverallEventMatch = explicitNoOverallEventPattern.test(paperText);
      const hasExplicitNoMortalityMatch = explicitNoMortalityPattern.test(paperText);
      const isExplicitNoEventsReported =
        rawSafetyEvents.length === 0 &&
        hasExplicitNoOverallEventMatch &&
        !hasPositiveSafetyEvidence;

      // Check if safety is mentioned in paper at all.
      const hasSafetyMention = /(?:adverse\s+event|complications?|adverse\s+effect|early\s+complication|late\s+complication|stent\s+malfunction|device\s+malfunction|morbidity|procedure-related\s+event|treatment-related\s+event|serious\s+adverse\s+event|sae|mortality|procedure-related\s+death|reintervention|recurrence|recurrent\s+obstruction|re-obstruction|stent\s+dysfunction|stent\s+occlusion|migration|perforation|pancreatitis|cholangitis|bleeding|safety)/i.test(paperText);

      // Perform corrective retry for safety if safety is mentioned but 0 events found and not explicitly no events
      let safetyRetryAttempt = 0;
      const maxSafetyRetries = 1;
      while (rawSafetyEvents.length === 0 && hasSafetyMention && !isExplicitNoEventsReported && safetyRetryAttempt < maxSafetyRetries) {
        safetyRetryAttempt++;
        console.log(`[Gemini API] Warning: 0 safety events extracted despite safety mentions. Performing safety corrective retry ${safetyRetryAttempt}/${maxSafetyRetries}...`);
        
        const safetyRetryPrompt = [
          ...documentContentParts,
          {
            text: `[SAFETY CORRECTIVE RETRY (Attempt ${safetyRetryAttempt})]: The paper discusses safety, complications, adverse events, or outcomes, but your previous response returned 0 events in 'safetyEventsExtract'. You MUST re-examine the results and tables for complications (e.g., stent occlusion, migration, insufficient expansion, cholangitis, pancreatitis, perforation, bleeding, reintervention, timing). Do NOT return mortality/death/fatality as event rows; mortality belongs only in overallMortality/group mortality summary fields. Return valid JSON with 'safetyEventsExtract' containing 'events' array with required fields: eventName, eventType ('Adverse Event / Complication' or 'Cause of Recurrence'), timing, groupName, deviceName, numerator, denominator, reportedPercentage, numeratorType ('patients'|'events'|'procedures'|'episodes'|'unknown'), denominatorType ('patients'|'events'|'procedures'|'episodes'|'unknown'), multipleEventsPerPatient ('Yes'|'No'|'Not reported'|'Unclear'), percentageContextQuote, percentageContextLocation, parentEvent, isSubItem, relationshipType ('none'|'component'|'cause'|'unclear'), isAggregate, hierarchyEvidenceType ('explicit_text'|'table_structure'|'both'|'none'), hierarchyEvidenceQuote, hierarchyEvidenceLocation, hierarchyConfidence ('High'|'Low'), hierarchyReason, breakdownCompleteness ('Complete'|'Partial'|'Unknown'), classificationStatus ('classified'|'review_required'), evidenceQuote, evidenceLocation, linkedRecurrenceCause. Reconstruct hierarchy ONLY from explicit current-study wording or clearly structured table hierarchy. Row proximity and matching arithmetic totals are validation clues only and MUST NOT create a relationship. If uncertain, keep the row flat and mark review_required. For percentage interpretation, inspect table headers, footnotes/captions, and nearby text for statements that one patient can contribute multiple complications/events. Preserve the paper-reported percentage verbatim and do not invent a reported percentage from n/N.`
          }
        ];

        try {
          const retryResponseText = await callGeminiWithRetry(ai, safetyRetryPrompt, { responseMimeType: 'application/json' }, 0);
          if (retryResponseText) {
            const retryParsed = JSON.parse(retryResponseText);
            const retryRawSafety = retryParsed?.safetyEventsExtract || retryParsed?.safetyExtracts || retryParsed?.safetyEvents || retryParsed?.safety_events || retryParsed?.adverseEvents || retryParsed?.adverse_events || retryParsed?.complications || retryParsed?.events || retryParsed?.safety || retryParsed?.stentMalfunctions || retryParsed?.stent_malfunctions || retryParsed?.safetyData || {};
            const retryEvents = Array.isArray(retryRawSafety.events) ? retryRawSafety.events :
                                Array.isArray(retryRawSafety.complications) ? retryRawSafety.complications :
                                Array.isArray(retryRawSafety.adverseEvents) ? retryRawSafety.adverseEvents :
                                Array.isArray(retryRawSafety.eventsList) ? retryRawSafety.eventsList :
                                Array.isArray(retryRawSafety) ? retryRawSafety : [];
            if (retryEvents.length > 0) {
              rawSafetyEvents = retryEvents;
              console.log(`[Gemini API] Safety corrective retry ${safetyRetryAttempt} succeeded with ${rawSafetyEvents.length} events.`);
              break;
            }
          }
        } catch (err: any) {
          console.log(`[Gemini API] Safety corrective retry ${safetyRetryAttempt} failed: ${err.message}`);
        }
      }

      // Check if paperText contains a structured Table (e.g. Table 2 Adverse events with N=106 or similar)
      const table2Match = paperText.match(/(?:table\s+2[.:\s\S]*?(?:early|late)\s+adverse\s+events[\s\S]*?)(?=(?:table\s+3|discussion|references|conclusions?|\n\s*\n\s*\n\s*\n|$))/i);
      let parsedTableData: ReturnType<typeof parseStructuredSafetyTableFromText> | null = null;
      if (table2Match) {
        const denom = articleMetadata.totalPatientCount !== 'Not reported'
          ? articleMetadata.totalPatientCount
          : researchGroups[0]?.groupPatientNumber || 'Not reported';
        parsedTableData = parseStructuredSafetyTableFromText(table2Match[0], denom);
      }

      // If AI extraction missed table rows (e.g. fewer rows than structured table) or didn't run, use structured table rows
      if (parsedTableData && parsedTableData.events.length > 0) {
        if (rawSafetyEvents.length < parsedTableData.events.length) {
          rawSafetyEvents = parsedTableData.events;
        }
        if (rawTimingSummaries.length === 0 && parsedTableData.timingSummaries.length > 0) {
          rawTimingSummaries = parsedTableData.timingSummaries;
        }
      }

      // Deterministic rescue for explicit positive narrative safety statements that can be
      // missed when a paper reports an event in prose rather than in a complete table.
      // Example: "Two mild cholangitis cases occurred ... in the control group." This
      // reads CURRENT-study text only and never imports events from Discussion/References.
      const currentStudySafetyText = (() => {
        const source = String(paperText || '');
        const resultsMatch = source.match(/(?:^|\n)\s*(?:\d+\.?\s*)?results\s*(?:\n|$)([\s\S]*?)(?=(?:\n\s*(?:\d+\.?\s*)?(?:discussion|conclusion|conclusions|references)\b)|$)/i);
        if (resultsMatch?.[1]) return resultsMatch[1];
        return source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
      })();

      const safetyWordNumbers: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      const parseSafetyCount = (value: string): number | null => {
        if (/^\d+$/.test(value)) return Number(value);
        return safetyWordNumbers[value.toLowerCase()] ?? null;
      };
      const normalizeSafetyKey = (value: unknown) => String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:the|study|cohort|arm)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const locateNarrativeSafetyGroup = (sentence: string): any | null => {
        if (researchGroups.length === 1) return researchGroups[0];
        const sentenceKey = normalizeSafetyKey(sentence);
        const matches = researchGroups.filter((group: any) => {
          const groupKey = normalizeSafetyKey(group.groupName);
          const strippedGroupKey = groupKey.replace(/\bgroup\b/g, ' ').replace(/\s+/g, ' ').trim();
          if (groupKey && sentenceKey.includes(groupKey)) return true;
          if (strippedGroupKey.length >= 3 && sentenceKey.includes(strippedGroupKey)) return true;
          return (group.devices || []).some((device: any) => {
            const deviceKey = normalizeSafetyKey(device.deviceProductName);
            return deviceKey.length >= 4 && sentenceKey.includes(deviceKey);
          });
        });
        return matches.length === 1 ? matches[0] : null;
      };
      const safetyCanonicalEventName = (raw: string) => {
        const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
        const names: Record<string, string> = {
          cholangitis: 'Cholangitis', pancreatitis: 'Pancreatitis', cholecystitis: 'Cholecystitis',
          migration: 'Stent migration', 'stent migration': 'Stent migration', bleeding: 'Bleeding',
          hemobilia: 'Hemobilia', haemobilia: 'Haemobilia', perforation: 'Perforation',
          'bile duct perforation': 'Bile duct perforation', occlusion: 'Stent occlusion',
          'stent occlusion': 'Stent occlusion', dysfunction: 'Stent dysfunction',
          'stent dysfunction': 'Stent dysfunction', infection: 'Infection', sepsis: 'Sepsis',
        };
        return names[key] || raw.trim().replace(/^./, (c) => c.toUpperCase());
      };
      const narrativeSafetySentences = currentStudySafetyText
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      const narrativeEventTerm = '(?:cholangitis|pancreatitis|cholecystitis|stent\\s+migration|migration|bleeding|h[ae]emobilia|bile\\s+duct\\s+perforation|perforation|stent\\s+occlusion|occlusion|stent\\s+dysfunction|dysfunction|infection|sepsis)';
      const countToken = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
      const countFirstSafety = new RegExp(`\\b(${countToken})\\s+(?:(mild|moderate|severe)\\s+)?(${narrativeEventTerm})\\s+(?:cases?|patients?|events?|episodes?)\\s+(?:occurred|developed|were\\s+reported|were\\s+observed|were\\s+noted|were\\s+recorded)\\b`, 'i');
      const eventFirstSafety = new RegExp(`\\b(${narrativeEventTerm})\\s+(?:occurred|developed|was\\s+reported|were\\s+reported|was\\s+observed|were\\s+observed)\\s+(?:in|among)\\s+(${countToken})\\s+(?:cases?|patients?|events?|episodes?)\\b`, 'i');

      for (const sentence of narrativeSafetySentences) {
        let eventName = '';
        let severity = 'Not reported';
        let count: number | null = null;
        const countFirst = countFirstSafety.exec(sentence);
        if (countFirst) {
          count = parseSafetyCount(countFirst[1]);
          severity = countFirst[2] ? countFirst[2].replace(/^./, (c) => c.toUpperCase()) : 'Not reported';
          eventName = safetyCanonicalEventName(countFirst[3]);
        } else {
          const eventFirst = eventFirstSafety.exec(sentence);
          if (eventFirst) {
            eventName = safetyCanonicalEventName(eventFirst[1]);
            count = parseSafetyCount(eventFirst[2]);
          }
        }
        if (!eventName || count == null || count <= 0) continue;

        const matchedGroup = locateNarrativeSafetyGroup(sentence);
        if (researchGroups.length > 1 && !matchedGroup) continue;
        const groupName = matchedGroup?.groupName || 'Study-wide / all patients';
        const groupId = matchedGroup?.id;
        const denominator = matchedGroup?.groupPatientNumber || articleMetadata.totalPatientCount || 'Not reported';
        const normalizedEvent = normalizeSafetyKey(eventName);
        const duplicate = rawSafetyEvents.some((event: any) => {
          const existingName = normalizeSafetyKey(event.eventName || event.name || event.complicationName || event.event || '');
          const existingGroup = normalizeSafetyKey(event.groupName || event.group_name || event.studyGroupOrDevice || event.studyGroup || '');
          return existingName === normalizedEvent && (!matchedGroup || !existingGroup || existingGroup.includes(normalizeSafetyKey(groupName)) || normalizeSafetyKey(groupName).includes(existingGroup));
        });
        if (duplicate) continue;

        rawSafetyEvents.push({
          eventName,
          eventType: 'Adverse Event / Complication',
          category: 'Adverse event',
          timing: 'N/A',
          groupId,
          groupName,
          deviceName: matchedGroup?.devices?.[0]?.deviceProductName || '',
          numerator: String(count),
          denominator: String(denominator),
          countN: !isMissingExtractedValue(denominator) ? `${count}/${denominator}` : String(count),
          reportedPercentage: 'Not reported',
          numeratorType: 'patients',
          denominatorType: 'patients',
          multipleEventsPerPatient: 'Not reported',
          severity,
          managementOutcome: 'Not reported',
          relationshipType: 'none',
          hierarchyConfidence: 'High',
          hierarchyReason: 'Explicit positive current-study Results narrative.',
          breakdownCompleteness: 'Unknown',
          classificationStatus: 'classified',
          evidenceQuote: sentence,
          evidenceLocation: 'Results narrative',
        });
      }

      if (rawSafetyEvents.length === 0 && hasSafetyMention && !isExplicitNoEventsReported) {
        return res.status(500).json({
          success: false,
          error: 'Safety extraction incomplete: safety evidence was found but structured events were not preserved.',
          failedField: 'Gemini PDF Analysis',
        });
      }

      const isSafetyNotReported = (!rawSafety.status && !hasSafetyMention && rawSafetyEvents.length === 0) || rawSafety.status === 'Not reported';

      let safetyStatus: 'Events reported' | 'No event reported' | 'Not reported' = 'Events reported';
      if (isExplicitNoEventsReported) {
        safetyStatus = 'No event reported';
      } else if (isSafetyNotReported && rawSafetyEvents.length === 0) {
        safetyStatus = 'Not reported';
      } else if (rawSafetyEvents.length > 0 || hasSafetyMention) {
        safetyStatus = 'Events reported';
      }

      // Process and format each event row with strict table fidelity
      const defaultGroupScope = researchGroups.length === 1
        ? (researchGroups[0].groupPatientNumber && researchGroups[0].groupPatientNumber !== 'Not reported' ? `Study-wide / all patients (N=${researchGroups[0].groupPatientNumber})` : researchGroups[0].groupName)
        : (articleMetadata.totalPatientCount !== 'Not reported' ? `Study-wide / all patients (N=${articleMetadata.totalPatientCount})` : 'Study-wide; group not separately reported');

      const processedEvents: any[] = rawSafetyEvents.map((ev: any, idx: number) => {
        const evId = ev.id || `safe-ev-${idx + 1}`;
        const eventName = ev.eventName || ev.name || ev.complicationName || ev.adverseEventName || ev.event || 'Reported Event';
        
        let eventType: 'Adverse Event / Complication' | 'Cause of Recurrence' = 'Adverse Event / Complication';
        const rawEt = String(ev.eventType || '').toLowerCase();
        if (rawEt.includes('recurrence') || rawEt.includes('reobstruction') || rawEt.includes('restenosis') || /cause of recurrence/i.test(eventName)) {
          eventType = 'Cause of Recurrence';
        } else {
          eventType = 'Adverse Event / Complication';
        }

        const classificationStatus = ev.classificationStatus === 'review_required' ? 'review_required' : 'classified';

        const validCategories = [
          'Adverse event',
          'Complication',
          'Serious adverse event',
          'Device-related event',
          'Procedure-related event',
          'Device malfunction / technical failure',
          'Mortality',
          'Reintervention-related event',
          'Other reported occurrence',
        ];
        const category = validCategories.includes(ev.category) ? ev.category : 'Adverse event';
        
        let timing = ev.timing;
        if (!timing || timing === 'Overall / not time-categorized' || timing === 'Not reported') {
          timing = 'N/A';
        }
        
        let groupId = ev.groupId || ev.group_id;
        let groupName = ev.groupName || ev.group_name || ev.studyGroupOrDevice || ev.studyGroup || defaultGroupScope;
        let deviceName = ev.deviceName || ev.device || ev.stentName || '';

        if (researchGroups && researchGroups.length > 0) {
          // Match study groups by a normalized EXACT key first.
          // Do not use naive substring matching here: e.g. "Covered SEMS" is a
          // substring of "Uncovered SEMS" and would otherwise be assigned to
          // the wrong arm. Only fall back to an exact device-name match.
          const normalizeGroupKey = (value: unknown) =>
            String(value ?? '')
              .toLowerCase()
              .replace(/\([^)]*\bn\s*=\s*[^)]*\)/gi, ' ')
              .replace(/[^a-z0-9]+/g, ' ')
              .replace(/\b(?:group|cohort|arm)\b$/i, '')
              .replace(/\s+/g, ' ')
              .trim();

          const eventGroupKey = normalizeGroupKey(groupName);
          const eventDeviceKey = normalizeGroupKey(deviceName);
          const matchedGroup = researchGroups.find((g: any) => {
            if (groupId && g.id === groupId) return true;

            const researchGroupKey = normalizeGroupKey(g.groupName);
            const groupBoundaryMatch = Boolean(
              eventGroupKey && researchGroupKey && (
                researchGroupKey === eventGroupKey ||
                eventGroupKey.startsWith(`${researchGroupKey} `) ||
                researchGroupKey.startsWith(`${eventGroupKey} `)
              )
            );
            if (groupBoundaryMatch) return true;

            if (eventDeviceKey && Array.isArray(g.devices)) {
              return g.devices.some((d: any) =>
                normalizeGroupKey(d.deviceProductName) === eventDeviceKey
              );
            }
            return false;
          });
          if (matchedGroup) {
            groupId = matchedGroup.id;
            groupName = matchedGroup.groupName;
            deviceName = matchedGroup.devices?.[0]?.deviceProductName || deviceName || '';
          }
        }

        let studyGroupOrDevice = groupName;
        
        let numEvents = ev.numEvents ?? ev.numerator ?? ev.count ?? ev.eventCount ?? ev.n ?? '';
        let totalPatients = ev.totalPatients ?? ev.denominator ?? ev.populationN ?? ev.groupN ?? '';
        numEvents = numEvents !== '' ? String(numEvents) : '';
        totalPatients = totalPatients !== '' ? String(totalPatients) : '';
        let countN = ev.countN || ev.count_n || (numEvents && totalPatients ? `${numEvents}/${totalPatients}` : numEvents || 'Not reported');
        
        const countNMatch = countN.match(/(\d+)\s*\/\s*(\d+)/);
        if (countNMatch) {
          numEvents = countNMatch[1];
          totalPatients = countNMatch[2];
        }

        const reportedRateRaw = ev.reportedRate || ev.reportedPercentage || ev.percentage || ev.rate || 'Not reported';
        const percentageAssessment = assessSafetyPercentage(
          ev,
          countN,
          String(reportedRateRaw),
          paperText
        );
        const {
          reportedRate,
          calculatedRate,
          percentageSource,
          percentageAssessmentStatus,
          percentageAssessmentNote,
          numeratorType,
          denominatorType,
          multipleEventsPerPatient,
          percentageContextQuote,
          percentageContextLocation,
          calculationBasis,
        } = percentageAssessment;

        const severity = ev.severity || 'Not reported';
        const managementOutcome = ev.managementOutcome || 'Not reported';
        const parentEvent = ev.parentEvent || ev.linkedParentEvent || ev.parentEventName || undefined;
        const parentEventId = ev.parentEventId || undefined;
        const rawRelationshipType = String(ev.relationshipType || '').toLowerCase();
        const legacyAggregateRelation = rawRelationshipType === 'aggregate';
        const relationshipType: SafetyHierarchyRelationship =
          ['none', 'component', 'cause', 'unclear'].includes(rawRelationshipType)
            ? rawRelationshipType as SafetyHierarchyRelationship
            : (parentEvent ? (eventType === 'Cause of Recurrence' ? 'cause' : 'component') : 'none');
        const isAggregate = Boolean(ev.isAggregate || legacyAggregateRelation || ev.hierarchyRole === 'Aggregate event' || ev.hierarchyRole === 'Subtotal/Summary');
        const isSubItem = Boolean(ev.isSubItem || parentEvent);
        const rawEvidenceType = String(ev.hierarchyEvidenceType || '').toLowerCase();
        const hierarchyEvidenceType = ['explicit_text', 'table_structure', 'both', 'none'].includes(rawEvidenceType)
          ? rawEvidenceType
          : 'none';
        const hierarchyEvidenceQuote = String(ev.hierarchyEvidenceQuote || '').trim();
        const hierarchyEvidenceLocation = String(ev.hierarchyEvidenceLocation || '').trim();
        const rawHierarchyConfidence = String(ev.hierarchyConfidence || '');
        const hierarchyConfidence: SafetyHierarchyConfidence =
          rawHierarchyConfidence === 'High' || rawHierarchyConfidence === 'Medium' || rawHierarchyConfidence === 'Low'
            ? rawHierarchyConfidence
            : 'Low';
        const hierarchyReason = ev.hierarchyReason || undefined;
        const breakdownCompleteness =
          ev.breakdownCompleteness === 'Complete' || ev.breakdownCompleteness === 'Partial' || ev.breakdownCompleteness === 'Unknown'
            ? ev.breakdownCompleteness
            : 'Unknown';
        const hierarchyRole =
          ev.hierarchyRole ||
          (relationshipType === 'component' ? 'Component event' :
            relationshipType === 'cause' ? 'Cause event' :
            relationshipType === 'unclear' ? 'Review required' :
            'Independent event');
        const evidenceQuote = ev.evidenceQuote || ev.evidence_quote || 'Not reported';
        const evidenceLocation = ev.evidenceLocation || ev.evidence_location || ev.location || 'Not reported';
        const breakdowns = Array.isArray(ev.breakdowns) ? ev.breakdowns : [];

        return {
          id: evId,
          eventName,
          eventType,
          classificationStatus,
          reviewReason: ev.reviewReason,
          suggestedType: ev.suggestedType,
          category,
          timing,
          studyGroupOrDevice,
          groupId,
          groupName,
          deviceName,
          numEvents,
          totalPatients,
          numerator: numEvents,
          denominator: totalPatients,
          countN,
          reportedRate,
          calculatedRate,
          reportedPercentage: reportedRate,
          percentageSource,
          numeratorType,
          denominatorType,
          multipleEventsPerPatient,
          percentageAssessmentStatus,
          percentageAssessmentNote,
          percentageContextQuote,
          percentageContextLocation,
          calculationBasis,
          severity,
          managementOutcome,
          parentEvent,
          parentEventId,
          isSubItem,
          relationshipType,
          isAggregate,
          hierarchyEvidenceType,
          hierarchyEvidenceQuote,
          hierarchyEvidenceLocation,
          hierarchyConfidence,
          hierarchyReason,
          breakdownCompleteness,
          hierarchyRole,
          hierarchyClassification: ev.hierarchyClassification,
          breakdowns,
          evidenceQuote,
          evidenceLocation,
          causalRationale: ev.causalRationale,
          userRemarks: '',
          aiRecommended: {
            eventName,
            eventType,
            classificationStatus,
            category,
            parentEvent,
            parentEventId,
            isSubItem,
            relationshipType,
            isAggregate,
            hierarchyEvidenceType,
            hierarchyEvidenceQuote,
            hierarchyEvidenceLocation,
            hierarchyConfidence,
            hierarchyReason,
            breakdownCompleteness,
            hierarchyRole,
            hierarchyClassification: ev.hierarchyClassification,
            timing,
            studyGroupOrDevice,
            countN,
            reportedRate,
            calculatedRate,
            numeratorType,
            denominatorType,
            multipleEventsPerPatient,
            percentageAssessmentStatus,
            percentageAssessmentNote,
            percentageContextQuote,
            percentageContextLocation,
            calculationBasis,
            severity,
            managementOutcome,
            evidenceQuote,
            evidenceLocation,
          },
        };
      }).filter((event: any) => {
        // Mortality/death outcomes are reported separately in the Step 4 mortality
        // summary and are not complication rows. Keep this deterministic guard even
        // if the model incorrectly returns them inside safetyEventsExtract.events.
        const mortalityLabel = String(event.eventName || '').toLowerCase();
        const mortalityCategory = String(event.category || '').toLowerCase();
        if (
          mortalityCategory === 'mortality' ||
          /\b(?:mortality|death|deaths|fatality|fatalities)\b/i.test(mortalityLabel)
        ) {
          return false;
        }

        // A table row with zero affected patients describes the absence of an
        // event in that group, so it must not become a listed safety event.
        const explicitNumerator = event.numerator ?? event.numEvents;
        if (!isMissingExtractedValue(explicitNumerator)) {
          const numericNumerator = Number(String(explicitNumerator).trim());
          if (Number.isFinite(numericNumerator)) return numericNumerator > 0;
        }

        const countMatch = String(event.countN || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/|$)/);
        if (countMatch) return Number(countMatch[1]) > 0;

        const reportedRate = String(event.reportedRate || event.reportedPercentage || '').trim();
        if (/^0(?:\.0+)?\s*%$/.test(reportedRate)) return false;

        return true;
      });

      // Reconstruct parent/child/cause relationships after zero-count rows are
      // removed. Relationships are applied only when the current-study source
      // explicitly supports the hierarchy (text and/or clear table structure).
      // Arithmetic is used only to validate an already-supported relationship.
      applyGeneralSafetyHierarchy(processedEvents, paperText);
      processedEvents.forEach((event: any) => {
        if (!event.aiRecommended) return;
        event.aiRecommended.parentEvent = event.parentEvent;
        event.aiRecommended.parentEventId = event.parentEventId;
        event.aiRecommended.isSubItem = event.isSubItem;
        event.aiRecommended.relationshipType = event.relationshipType;
        event.aiRecommended.isAggregate = event.isAggregate;
        event.aiRecommended.hierarchyLevel = event.hierarchyLevel;
        event.aiRecommended.hierarchyEvidenceType = event.hierarchyEvidenceType;
        event.aiRecommended.hierarchyEvidenceQuote = event.hierarchyEvidenceQuote;
        event.aiRecommended.hierarchyEvidenceLocation = event.hierarchyEvidenceLocation;
        event.aiRecommended.hierarchyConfidence = event.hierarchyConfidence;
        event.aiRecommended.hierarchyReason = event.hierarchyReason;
        event.aiRecommended.breakdownCompleteness = event.breakdownCompleteness;
        event.aiRecommended.hierarchyRole = event.hierarchyRole;
        event.aiRecommended.hierarchyClassification = event.hierarchyClassification;
        event.aiRecommended.classificationStatus = event.classificationStatus;
      });

      // Overall safety summary (strictly honoring directly reported values, NEVER summing individual counts)
      const overallStudyPop = articleMetadata.totalPatientCount !== 'Not reported' ? `N = ${articleMetadata.totalPatientCount}` : (rawSafety.overallStudyPopulation || 'Not reported');
      
      const overallPatientsWithEvents = rawSafety.overallPatientsWithEvents || (isExplicitNoEventsReported ? '0 (0%)' : 'Not reported');
      const mortalityDenominator = researchGroups.length === 1
        ? researchGroups[0].groupPatientNumber
        : articleMetadata.totalPatientCount;

      type MortalityRelatednessValue = 'stent_related' | 'device_related' | 'procedure_related' | 'treatment_related' | 'all_cause' | 'unclear' | 'not_reported';
      const normalizeMortalityRelatednessValue = (value: unknown): MortalityRelatednessValue => {
        const normalized = String(value ?? '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
        if (/stent/.test(normalized)) return 'stent_related';
        if (/device/.test(normalized)) return 'device_related';
        if (/procedure/.test(normalized)) return 'procedure_related';
        if (/treatment/.test(normalized)) return 'treatment_related';
        if (/all.*cause|overall/.test(normalized)) return 'all_cause';
        if (/unclear|unknown|not.*clear|ambig/.test(normalized)) return 'unclear';
        return 'not_reported';
      };
      const mortalityLabelFor = (relatedness: MortalityRelatednessValue) =>
        relatedness === 'stent_related' ? 'Stent-related mortality' :
        relatedness === 'device_related' ? 'Device-related mortality' :
        relatedness === 'procedure_related' ? 'Procedure-related mortality' :
        relatedness === 'treatment_related' ? 'Treatment-related mortality' :
        'Mortality';
      const formatMortalityValue = (numerator: string | number, denominator: string | number | undefined, percentage?: string) => {
        const n = String(numerator ?? '').trim();
        const d = String(denominator ?? '').trim();
        const pct = String(percentage ?? '').trim();
        if (n && d && d !== 'Not reported') {
          const resolvedPct = pct || (Number(d) > 0 && Number.isFinite(Number(n)) ? `${((Number(n) / Number(d)) * 100).toFixed(1)}%` : '');
          return resolvedPct ? `${n}/${d} (${resolvedPct})` : `${n}/${d}`;
        }
        if (n && pct) return `${n} (${pct})`;
        return n || 'Not reported';
      };

      const findPreferredRelatedMortality = () => {
        const source = String(currentStudySafetyText || '');
        const lines = source.split(/\r?\n/).map((line: string) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const relationDefs: Array<{ key: MortalityRelatednessValue; token: string }> = [
          { key: 'stent_related', token: 'stent' },
          { key: 'device_related', token: 'device' },
          { key: 'procedure_related', token: 'procedure' },
          { key: 'treatment_related', token: 'treatment' },
        ];

        for (const def of relationDefs) {
          const zeroRegex = new RegExp(`\\b(?:there\\s+(?:was|were)\\s+)?no\\s+${def.token}[-\\s]?related\\s+(?:mortality|deaths?|death|fatalit(?:y|ies))\\b`, 'i');
          const zeroLine = lines.find((line: string) => zeroRegex.test(line));
          if (zeroLine) {
            return {
              value: formatMortalityValue(0, mortalityDenominator, '0%'),
              label: mortalityLabelFor(def.key),
              relatedness: def.key,
              verificationRequired: false,
              verificationNote: '',
              evidenceQuote: zeroLine,
              evidenceLocation: 'Results / current-study mortality statement',
            };
          }

          const rowRegex = new RegExp(`\\b${def.token}[-\\s]?related(?:\\s+(?:mortality|deaths?|death|fatalit(?:y|ies)))?\\s*[:=]?\\s*(\\d+)\\s*(?:\\/\\s*(\\d+))?\\s*(?:\\((\\d+(?:\\.\\d+)?)%\\))?`, 'i');
          const mortalityWordRegex = new RegExp(`\\b${def.token}[-\\s]?related\\s+(?:mortality|deaths?|death|fatalit(?:y|ies))[^\\n.]{0,80}?(\\d+)\\s*(?:\\/\\s*(\\d+))?\\s*(?:\\((\\d+(?:\\.\\d+)?)%\\))?`, 'i');
          for (const line of lines) {
            const match = line.match(mortalityWordRegex) || line.match(rowRegex);
            if (!match) continue;
            const numerator = match[1];
            const denominator = match[2] || mortalityDenominator;
            const percentage = match[3] ? `${match[3]}%` : '';
            return {
              value: formatMortalityValue(numerator, denominator, percentage),
              label: mortalityLabelFor(def.key),
              relatedness: def.key,
              verificationRequired: false,
              verificationNote: '',
              evidenceQuote: line,
              evidenceLocation: 'Results / current-study mortality statement',
            };
          }
        }
        return null;
      };

      const deterministicRelatedMortality = findPreferredRelatedMortality();
      const rawOverallMortality = !isMissingExtractedValue(rawSafety.overallMortality)
        ? String(rawSafety.overallMortality).trim()
        : 'Not reported';
      const rawOverallRelatedness = normalizeMortalityRelatednessValue(rawSafety.overallMortalityRelatedness);
      const rawOverallIsSpecific = ['stent_related', 'device_related', 'procedure_related', 'treatment_related'].includes(rawOverallRelatedness);
      const explicitGenericZeroMortality = hasExplicitNoMortalityMatch && !isMissingExtractedValue(mortalityDenominator)
        ? formatMortalityValue(0, mortalityDenominator, '0%')
        : hasExplicitNoMortalityMatch ? '0 (0%)' : 'Not reported';

      const selectedMortality = deterministicRelatedMortality || (rawOverallMortality !== 'Not reported'
        ? {
            value: rawOverallMortality,
            label: rawSafety.overallMortalityLabel || mortalityLabelFor(rawOverallRelatedness),
            relatedness: rawOverallRelatedness === 'not_reported' ? 'unclear' as MortalityRelatednessValue : rawOverallRelatedness,
            verificationRequired: rawOverallIsSpecific ? false : true,
            verificationNote: rawOverallIsSpecific
              ? ''
              : (rawSafety.overallMortalityVerificationNote || 'Stent/device/procedure-related mortality was not clearly established for this reported mortality value. Verification required.'),
            evidenceQuote: rawSafety.overallMortalityEvidenceQuote || 'Not reported',
            evidenceLocation: rawSafety.overallMortalityEvidenceLocation || 'Results / Tables',
          }
        : explicitGenericZeroMortality !== 'Not reported'
          ? {
              value: explicitGenericZeroMortality,
              label: rawSafety.overallMortalityLabel || 'Mortality',
              relatedness: 'unclear' as MortalityRelatednessValue,
              verificationRequired: true,
              verificationNote: 'A zero mortality statement was found, but its stent/device/procedure relatedness was not explicit. Verification required.',
              evidenceQuote: paperText.match(explicitNoMortalityPattern)?.[0] || 'Not reported',
              evidenceLocation: 'Results / current-study text',
            }
          : {
              value: 'Not reported',
              label: 'Mortality',
              relatedness: 'not_reported' as MortalityRelatednessValue,
              verificationRequired: false,
              verificationNote: '',
              evidenceQuote: 'Not reported',
              evidenceLocation: 'Not reported',
            });

      const overallMortality = selectedMortality.value;
      const overallMortalityLabel = selectedMortality.label;
      const overallMortalityRelatedness = selectedMortality.relatedness;
      const overallMortalityVerificationRequired = selectedMortality.verificationRequired;
      const overallMortalityVerificationNote = selectedMortality.verificationNote;
      const overallMortalityEvidenceQuote = selectedMortality.evidenceQuote;
      const overallMortalityEvidenceLocation = selectedMortality.evidenceLocation;
      const overallSeriousAdverseEvents = rawSafety.overallSeriousAdverseEvents || (isExplicitNoEventsReported ? '0 (0%)' : 'Not reported');
      const overallReinterventionDueToEvent = rawSafety.overallReinterventionDueToEvent || (isExplicitNoEventsReported ? '0 (0%)' : 'Not reported');

      // Deterministic multi-group / multi-timepoint fallback for group-specific
      // re-intervention rows. This is intentionally table-driven: the denominator
      // comes from the same timepoint/table header, not from the baseline group N.
      // It supports layouts such as:
      //   4-Week complication (no.) 99 55 26
      //   Re-intervention (n, %)    10 (10.1) 6 (10.9) 3 (11.5)
      // as well as simpler one-row "Reintervention rate ..." tables.
      const normalizedSafetyText = paperText.replace(/[\u2012\u2013\u2014\u2212]/g, '-');
      const safetyLines = normalizedSafetyText
        .split(/\r?\n/)
        .map((line: string) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const parseMetricCells = (text: string) => {
        const cells: Array<{ numerator: string; percentage: string }> = [];
        const metricRegex = /(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/g;
        let metricMatch: RegExpExecArray | null;
        while ((metricMatch = metricRegex.exec(text)) !== null) {
          cells.push({
            numerator: metricMatch[1],
            percentage: `${metricMatch[2]}%`,
          });
        }
        return cells;
      };

      const tableReinterventionMetricsByGroup: any[][] = researchGroups.map(() => []);
      const pushReinterventionMetric = (groupIndex: number, metric: any) => {
        if (!tableReinterventionMetricsByGroup[groupIndex]) return;
        const duplicateIndex = tableReinterventionMetricsByGroup[groupIndex].findIndex((existing: any) =>
          String(existing.timing || '') === String(metric.timing || '') &&
          String(existing.numerator || '') === String(metric.numerator || '') &&
          String(existing.denominator || '') === String(metric.denominator || '')
        );
        if (duplicateIndex < 0) {
          tableReinterventionMetricsByGroup[groupIndex].push(metric);
        } else if (
          tableReinterventionMetricsByGroup[groupIndex][duplicateIndex]?.percentageSource === 'Calculated' &&
          metric?.percentageSource === 'Reported'
        ) {
          tableReinterventionMetricsByGroup[groupIndex][duplicateIndex] = metric;
        }
      };
      // Narrative Results fallback for papers that state re-intervention in prose rather
      // than a dedicated table row. Preserve every primary arm, not only the first DUE arm.
      const currentStudyReinterventionText = (() => {
        const resultsMatch = normalizedSafetyText.match(/(?:^|\n)\s*(?:\d+\.?\s*)?results\s*(?:\n|$)([\s\S]*?)(?=(?:\n\s*(?:\d+\.?\s*)?(?:discussion|conclusion|conclusions|references)\b)|$)/i);
        if (resultsMatch?.[1]) return resultsMatch[1];
        return normalizedSafetyText.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || normalizedSafetyText;
      })();
      const normalizeReintKey = (value: unknown) => String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:group|cohort|arm)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const reintGroupAliases = researchGroups.map((group: any) => {
        const aliases = new Set<string>();
        const addAlias = (value: unknown) => {
          const raw = String(value ?? '').trim();
          if (!raw || /not reported/i.test(raw)) return;
          aliases.add(raw);
          const stripped = raw.replace(/\b(?:group|cohort|arm)\b/gi, ' ').replace(/\s+/g, ' ').trim();
          if (stripped.length >= 2) aliases.add(stripped);
          const compactTokens = raw.match(/\b[A-Za-z][A-Za-z0-9+/-]{1,14}\b/g) || [];
          const genericStopTokens = new Set([
            'group', 'cohort', 'arm', 'patients', 'patient', 'stent', 'device',
            'sems', 'lams', 'ercp', 'eus', 'cbd', 'covered', 'uncovered',
            'biliary', 'metal', 'self', 'expandable', 'study'
          ]);
          compactTokens.forEach((token: string) => {
            const lower = token.toLowerCase();
            const uppercaseCount = (token.match(/[A-Z]/g) || []).length;
            const looksLikeAbbreviation = uppercaseCount >= 2 || /^[A-Z0-9+/-]{2,10}$/.test(token);
            if (looksLikeAbbreviation && !genericStopTokens.has(lower)) aliases.add(token);
          });
        };
        addAlias(group.groupName);
        (group.devices || []).forEach((device: any) => addAlias(device.deviceProductName));
        return Array.from(aliases).sort((a, b) => b.length - a.length);
      });
      const aliasPositionInText = (text: string, groupIndex: number): number => {
        const lower = text.toLowerCase();
        let best = -1;
        for (const alias of reintGroupAliases[groupIndex] || []) {
          const needle = alias.toLowerCase();
          const pos = lower.indexOf(needle);
          if (pos >= 0 && (best < 0 || pos < best)) best = pos;
        }
        return best;
      };
      const resultBlocks = currentStudyReinterventionText
        .split(/\n\s*\n|(?=\b(?:Comparison|Stent patency|Long-term outcomes|Patient survival|Adverse events)\b)/i)
        .map((block) => block.trim())
        .filter(Boolean);

      for (const block of resultBlocks) {
        if (!/re-?intervention|repeat\s+ERCP|requiring\s+ERCP|repeat\s+stent/i.test(block)) continue;

        const respectively = /(?:occurred\s+in\s+)?(\d+)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?\s+and\s+(\d+)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?\s+patients?\s+(?:of|in)\s+the\s+([^,;.]+?)\s+and\s+([^,;.]+?)\s+groups?,\s*respectively/i.exec(block);
        if (respectively) {
          researchGroups.forEach((group: any, groupIndex: number) => {
            const groupKey = normalizeReintKey(group.groupName);
            const leftKey = normalizeReintKey(respectively[5]);
            const rightKey = normalizeReintKey(respectively[6]);
            let numerator = '';
            let pct = '';
            if (groupKey && (leftKey.includes(groupKey) || groupKey.includes(leftKey))) {
              numerator = respectively[1]; pct = respectively[2] ? `${respectively[2]}%` : '';
            } else if (groupKey && (rightKey.includes(groupKey) || groupKey.includes(rightKey))) {
              numerator = respectively[3]; pct = respectively[4] ? `${respectively[4]}%` : '';
            }
            if (!numerator) return;
            const denominator = group.groupPatientNumber || 'Not reported';
            pushReinterventionMetric(groupIndex, {
              timing: 'Overall / not time-categorized',
              numerator,
              denominator,
              percentage: pct || (!isMissingExtractedValue(denominator) ? `${((Number(numerator) / Number(String(denominator).match(/\d+/)?.[0] || 0)) * 100).toFixed(1)}%` : 'Not reported'),
              percentageSource: pct ? 'Reported' as const : 'Calculated' as const,
              evidenceQuote: block.replace(/\s+/g, ' ').trim(),
              evidenceLocation: 'Results narrative - Re-intervention',
              status: 'Reported' as const,
            });
          });
        }

        // Source-backed nearest-count fallback. This captures any additional arm when
        // a group-specific count is reported elsewhere in the same re-intervention paragraph.
        researchGroups.forEach((group: any, groupIndex: number) => {
          if (tableReinterventionMetricsByGroup[groupIndex]?.length) return;

          const blockSentences = block
            .replace(/\bvs\.\s+/gi, 'vs ')
            .replace(/\n+/g, '. ')
            .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
            .map((sentence) => sentence.trim())
            .filter(Boolean);
          const sentenceCandidates = blockSentences
            .filter((sentence) => aliasPositionInText(sentence, groupIndex) >= 0 && /\d+\s*(?:\([^)]*\))?\s+patients?\b/i.test(sentence))
            .sort((a, b) => {
              const rank = (sentence: string) => /re-?intervention|requiring\s+ERCP|stent\s+occlusion/i.test(sentence) ? 2 : 1;
              return rank(b) - rank(a);
            });
          const countScope = sentenceCandidates[0] || block;
          const groupPos = aliasPositionInText(countScope, groupIndex);
          if (groupPos < 0) return;
          const patientMatches = Array.from(countScope.matchAll(/(\d+)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?\s+patients?\b/gi)) as RegExpMatchArray[];
          if (patientMatches.length === 0) return;
          const closest = patientMatches
            .map((match) => ({ numerator: match[1], pct: match[2], pos: match.index || 0 }))
            .sort((a, b) => Math.abs(a.pos - groupPos) - Math.abs(b.pos - groupPos))[0];
          const denominator = group.groupPatientNumber || 'Not reported';
          const denominatorNumber = Number(String(denominator).match(/\d+/)?.[0] || 0);
          const calculatedPct = denominatorNumber > 0 ? `${((Number(closest.numerator) / denominatorNumber) * 100).toFixed(1)}%` : 'Not reported';
          pushReinterventionMetric(groupIndex, {
            timing: 'Overall / not time-categorized',
            numerator: closest.numerator,
            denominator,
            percentage: closest.pct ? `${closest.pct}%` : calculatedPct,
            percentageSource: closest.pct ? 'Reported' as const : 'Calculated' as const,
            evidenceQuote: block.replace(/\s+/g, ' ').trim(),
            evidenceLocation: 'Results narrative - Re-intervention',
            status: 'Reported' as const,
          });
        });
      }

      let activeTiming = 'Overall / not time-categorized';
      let activeDenominators: string[] = [];

      for (const line of safetyLines) {
        const timingHeaderMatch = line.match(
          /^(\d+(?:\.\d+)?\s*[- ]\s*(?:day|week|month|year)s?)\s+(?:complications?|adverse\s+events?|events?)\s*(?:\(\s*(?:no\.?|n)\s*\))?\s+(.+)$/i
        );
        if (timingHeaderMatch) {
          activeTiming = timingHeaderMatch[1]
            .replace(/\s*[- ]\s*/g, '-')
            .replace(/\b(day|week|month|year)s?\b/i, (_, unit) => unit.charAt(0).toUpperCase() + unit.slice(1).toLowerCase());
          const denominatorCandidates = timingHeaderMatch[2].match(/\b\d+\b/g) || [];
          activeDenominators = denominatorCandidates.slice(0, researchGroups.length);
          continue;
        }

        const reinterventionLineMatch = line.match(
          /^Re-?interventions?(?:\s+rate)?\s*(?:\(\s*n\s*,\s*%\s*\))?\s+(.+)$/i
        );
        if (!reinterventionLineMatch) continue;

        const cells = parseMetricCells(reinterventionLineMatch[1]);
        if (cells.length < researchGroups.length) continue;

        cells.slice(0, researchGroups.length).forEach((cell, index) => {
          const sourceDenominator = activeDenominators[index];
          const baselineDenominator = researchGroups[index]?.groupPatientNumber;
          const denominator = sourceDenominator || baselineDenominator || 'Not reported';
          pushReinterventionMetric(index, {
            timing: activeTiming,
            numerator: cell.numerator,
            denominator,
            percentage: cell.percentage,
            percentageSource: 'Reported' as const,
            evidenceQuote: line,
            evidenceLocation: `Results table - ${activeTiming} Re-intervention`,
            status: 'Reported' as const,
          });
        });
      }

      // Some PDF text extractors flatten a table by columns instead of rows.
      // Example order: all row labels -> all group headers -> all values for
      // group 1 -> all values for group 2 -> ... . Reconstruct that matrix so
      // group/timepoint-specific re-intervention values are not lost.
      if (!tableReinterventionMetricsByGroup.some((items) => items.length > 0) && researchGroups.length >= 2) {
        const normalizeTableGroupKey = (value: unknown) =>
          String(value ?? '')
            .toLowerCase()
            .replace(/\([^)]*\bn\s*=\s*[^)]*\)/gi, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\b(?:group|cohort|arm)\b$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        const tableChunks = normalizedSafetyText.split(/(?=\bTable\s+\d+\b)/i);
        for (const tableChunk of tableChunks) {
          if (!/Re-?interventions?/i.test(tableChunk)) continue;
          const tableLines = tableChunk
            .split(/\r?\n/)
            .map((line: string) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

          const groupLineIndices = researchGroups.map((group: any) => {
            const key = normalizeTableGroupKey(group.groupName);
            return tableLines.findIndex((line: string) => normalizeTableGroupKey(line) === key);
          });
          if (groupLineIndices.some((index: number) => index < 0)) continue;

          const firstGroupLine = Math.min(...groupLineIndices);
          const lastGroupLine = Math.max(...groupLineIndices);
          let descriptorTiming = 'Overall / not time-categorized';
          const descriptors: Array<{ kind: 'denominator' | 'reintervention' | 'other'; timing: string; label: string }> = [];

          for (const labelLine of tableLines.slice(0, firstGroupLine)) {
            const timingHeader = labelLine.match(
              /^(\d+(?:\.\d+)?\s*[- ]\s*(?:day|week|month|year)s?)\s+(?:complications?|adverse\s+events?|events?)\s*(?:\(\s*(?:no\.?|n)\s*\))?/i
            );
            if (timingHeader) {
              descriptorTiming = timingHeader[1]
                .replace(/\s*[- ]\s*/g, '-')
                .replace(/\b(day|week|month|year)s?\b/i, (_, unit) => unit.charAt(0).toUpperCase() + unit.slice(1).toLowerCase());
              descriptors.push({ kind: 'denominator', timing: descriptorTiming, label: labelLine });
              continue;
            }
            if (/^Re-?interventions?(?:\s+rate)?\s*(?:\(\s*n\s*,\s*%\s*\))?/i.test(labelLine)) {
              descriptors.push({ kind: 'reintervention', timing: descriptorTiming, label: labelLine });
              continue;
            }
            if (/\(\s*n\s*,\s*%\s*\)/i.test(labelLine)) {
              descriptors.push({ kind: 'other', timing: descriptorTiming, label: labelLine });
            }
          }

          if (!descriptors.some((descriptor) => descriptor.kind === 'reintervention')) continue;
          const cellsPerGroup = descriptors.length;
          if (cellsPerGroup === 0) continue;

          const afterGroups = tableLines.slice(lastGroupLine + 1);
          const pValueIndex = afterGroups.findIndex((line: string) => /^P-?value\b/i.test(line));
          const valueRegion = pValueIndex >= 0 ? afterGroups.slice(0, pValueIndex) : afterGroups;
          const valueCells = valueRegion.filter((line: string) =>
            /^\d+$/.test(line) || /^\d+\s*\(\s*\d+(?:\.\d+)?\s*%?\s*\)$/.test(line)
          );

          if (valueCells.length < cellsPerGroup * researchGroups.length) continue;

          researchGroups.forEach((_: any, groupIndex: number) => {
            const groupCells = valueCells.slice(
              groupIndex * cellsPerGroup,
              (groupIndex + 1) * cellsPerGroup
            );
            let sourceDenominator = 'Not reported';
            descriptors.forEach((descriptor, descriptorIndex) => {
              const sourceCell = groupCells[descriptorIndex] || '';
              if (descriptor.kind === 'denominator') {
                if (/^\d+$/.test(sourceCell)) sourceDenominator = sourceCell;
                return;
              }
              if (descriptor.kind !== 'reintervention') return;
              const metric = parseMetricCells(sourceCell)[0];
              if (!metric) return;
              pushReinterventionMetric(groupIndex, {
                timing: descriptor.timing,
                numerator: metric.numerator,
                denominator: sourceDenominator,
                percentage: metric.percentage,
                percentageSource: 'Reported' as const,
                evidenceQuote: `${descriptor.label}: ${sourceCell}`,
                evidenceLocation: `Results table - ${descriptor.timing} Re-intervention`,
                status: 'Reported' as const,
              });
            });
          });

          if (tableReinterventionMetricsByGroup.some((items) => items.length > 0)) break;
        }
      }

      // Backward-compatible fallback for a simple table that reports one
      // re-intervention row without a timepoint header.
      if (!tableReinterventionMetricsByGroup.some((items) => items.length > 0)) {
        const simpleRow = safetyLines.find((line: string) =>
          /^Re-?interventions?(?:\s+rate)?\b/i.test(line) &&
          parseMetricCells(line).length >= researchGroups.length
        );
        if (simpleRow) {
          const cells = parseMetricCells(simpleRow);
          cells.slice(0, researchGroups.length).forEach((cell, index) => {
            pushReinterventionMetric(index, {
              timing: 'Overall / not time-categorized',
              numerator: cell.numerator,
              denominator: researchGroups[index]?.groupPatientNumber || 'Not reported',
              percentage: cell.percentage,
              percentageSource: 'Reported' as const,
              evidenceQuote: simpleRow,
              evidenceLocation: 'Results table - Re-intervention',
              status: 'Reported' as const,
            });
          });
        }
      }

      // Use the Research Group Inventory as the authoritative group list. Match
      // group names by normalized exact equality so "Covered SEMS" cannot match
      // "Uncovered SEMS" merely because it is a substring.
      const rawGroupSummaries = Array.isArray(rawSafety.groupSummaries)
        ? rawSafety.groupSummaries
        : [];
      const normalizeSummaryGroupKey = (value: unknown) =>
        String(value ?? '')
          .toLowerCase()
          .replace(/\([^)]*\bn\s*=\s*[^)]*\)/gi, ' ')
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\b(?:group|cohort|arm)\b$/i, '')
          .replace(/\s+/g, ' ')
          .trim();

      const resolveGroupMortality = (gs: any, useOverallFallback: boolean) => {
        const groupValue = !isMissingExtractedValue(gs?.mortality) ? String(gs.mortality).trim() : 'Not reported';
        const groupRelatedness = normalizeMortalityRelatednessValue(gs?.mortalityRelatedness);
        const groupIsSpecific = ['stent_related', 'device_related', 'procedure_related', 'treatment_related'].includes(groupRelatedness);
        const overallIsSpecific = ['stent_related', 'device_related', 'procedure_related', 'treatment_related'].includes(overallMortalityRelatedness);

        // In a single-group study, a source-confirmed stent/device/procedure/treatment-
        // related mortality value outranks a generic/all-cause group mortality value.
        // This prevents e.g. 97 all-cause deaths from replacing an explicitly reported
        // stent-related mortality of 0.
        if (useOverallFallback && overallIsSpecific && !groupIsSpecific) {
          return {
            mortality: overallMortality,
            mortalityLabel: overallMortalityLabel,
            mortalityRelatedness: overallMortalityRelatedness,
            mortalityVerificationRequired: overallMortalityVerificationRequired,
            mortalityVerificationNote: overallMortalityVerificationNote,
            mortalityEvidenceQuote: overallMortalityEvidenceQuote,
            mortalityEvidenceLocation: overallMortalityEvidenceLocation,
          };
        }

        if (groupValue !== 'Not reported') {
          const relatedness = groupRelatedness === 'not_reported' ? 'unclear' as MortalityRelatednessValue : groupRelatedness;
          return {
            mortality: groupValue,
            mortalityLabel: gs?.mortalityLabel || mortalityLabelFor(relatedness),
            mortalityRelatedness: relatedness,
            mortalityVerificationRequired: groupIsSpecific ? false : true,
            mortalityVerificationNote: groupIsSpecific
              ? ''
              : (gs?.mortalityVerificationNote || 'Stent/device/procedure-related mortality is not clearly identified for this group-level mortality value. Verification required.'),
            mortalityEvidenceQuote: gs?.mortalityEvidenceQuote || gs?.evidenceQuote || 'Not reported',
            mortalityEvidenceLocation: gs?.mortalityEvidenceLocation || gs?.evidenceLocation || 'Results / Tables',
          };
        }

        if (useOverallFallback) {
          return {
            mortality: overallMortality,
            mortalityLabel: overallMortalityLabel,
            mortalityRelatedness: overallMortalityRelatedness,
            mortalityVerificationRequired: overallMortalityVerificationRequired,
            mortalityVerificationNote: overallMortalityVerificationNote,
            mortalityEvidenceQuote: overallMortalityEvidenceQuote,
            mortalityEvidenceLocation: overallMortalityEvidenceLocation,
          };
        }

        return {
          mortality: 'Not reported',
          mortalityLabel: 'Mortality',
          mortalityRelatedness: 'not_reported' as MortalityRelatednessValue,
          mortalityVerificationRequired: false,
          mortalityVerificationNote: '',
          mortalityEvidenceQuote: 'Not reported',
          mortalityEvidenceLocation: 'Not reported',
        };
      };

      const groupSummaries = researchGroups.length > 0
        ? researchGroups.map((matchedG: any, index: number) => {
            const matchedKey = normalizeSummaryGroupKey(matchedG.groupName);
            const gs = rawGroupSummaries.find(
              (summary: any) =>
                (summary.groupId && summary.groupId === matchedG.id) ||
                (summary.groupName && normalizeSummaryGroupKey(summary.groupName) === matchedKey)
            ) || (rawGroupSummaries.length === researchGroups.length ? rawGroupSummaries[index] : {}) || {};

            const deterministicReinterventions = tableReinterventionMetricsByGroup[index] || [];
            const reinterventions = deterministicReinterventions.length > 1
              ? deterministicReinterventions
              : deterministicReinterventions.length === 1
                ? deterministicReinterventions[0]
                : !isMissingExtractedValue(gs.reinterventions)
                  ? gs.reinterventions
                  : 'Not reported';
            const deterministicEvidence = deterministicReinterventions[0];
            const mortalityMeta = resolveGroupMortality(gs, researchGroups.length === 1);

            return {
              groupId: matchedG.id,
              groupName: matchedG.groupName,
              deviceName: matchedG.devices?.[0]?.deviceProductName || gs.deviceName || 'Not reported',
              populationN: !isMissingExtractedValue(gs.populationN)
                ? gs.populationN
                : matchedG.groupPatientNumber || 'Not reported',
              patientsWithEvents: gs.patientsWithEvents || 'Not reported',
              mortality: mortalityMeta.mortality,
              mortalityLabel: mortalityMeta.mortalityLabel,
              mortalityRelatedness: mortalityMeta.mortalityRelatedness,
              mortalityVerificationRequired: mortalityMeta.mortalityVerificationRequired,
              mortalityVerificationNote: mortalityMeta.mortalityVerificationNote,
              mortalityEvidenceQuote: mortalityMeta.mortalityEvidenceQuote,
              mortalityEvidenceLocation: mortalityMeta.mortalityEvidenceLocation,
              seriousAdverseEvents: gs.seriousAdverseEvents || 'Not reported',
              reinterventions,
              evidenceQuote:
                gs.evidenceQuote || deterministicEvidence?.evidenceQuote || 'Not reported',
              evidenceLocation:
                gs.evidenceLocation || deterministicEvidence?.evidenceLocation || 'Not reported',
            };
          })
        : rawGroupSummaries.map((gs: any, index: number) => ({
            groupId: gs.groupId || `group-${index + 1}`,
            groupName: gs.groupName || 'Study Group',
            deviceName: gs.deviceName || 'Not reported',
            populationN: gs.populationN || 'Not reported',
            patientsWithEvents: gs.patientsWithEvents || 'Not reported',
            ...resolveGroupMortality(gs, false),
            seriousAdverseEvents: gs.seriousAdverseEvents || 'Not reported',
            reinterventions: gs.reinterventions || 'Not reported',
            evidenceQuote: gs.evidenceQuote || 'Not reported',
            evidenceLocation: gs.evidenceLocation || 'Not reported',
          }));

      // Timing summaries (Early vs Late aggregate rates directly reported in table headers)
      const timingSummaries = rawTimingSummaries.map((ts: any) => ({
        timing: ts.timing || 'Reported Period',
        countN: ts.countN || 'Not reported',
        reportedRate: ts.reportedRate || 'Not reported',
        evidenceQuote: ts.evidenceQuote || 'Not reported',
        evidenceLocation: ts.evidenceLocation || 'Not reported',
      }));

      // Completeness and Validation Summary check
      const completenessValidation = verifySafetyTableCompleteness(processedEvents, paperText);
      const independentCount = processedEvents.length;
      const breakdownCount = processedEvents.reduce((sum, e) => sum + (e.breakdowns?.length || 0), 0);
      const unlinkedBreakdowns = parsedTableData?.unlinkedBreakdowns || [];
      const reviewCount = unlinkedBreakdowns.length;

      const validationSummary = parsedTableData?.validationSummary || {
        independentEventCount: independentCount,
        breakdownItemCount: breakdownCount,
        reviewItemCount: reviewCount,
        validationMessage: `Safety extraction validated: ${independentCount} events, ${breakdownCount} linked breakdown items, ${reviewCount} review items.`,
        status: reviewCount === 0 ? 'Complete' : 'Review required',
      };

      const safetySummary = {
        status: safetyStatus,
        overallStudyPopulation: overallStudyPop,
        overallPatientsWithEvents,
        overallMortality,
        overallMortalityLabel,
        overallMortalityRelatedness,
        overallMortalityVerificationRequired,
        overallMortalityVerificationNote,
        overallMortalityEvidenceQuote,
        overallMortalityEvidenceLocation,
        overallSeriousAdverseEvents,
        overallReinterventionDueToEvent,
        timingSummaries: timingSummaries.length > 0 ? timingSummaries : undefined,
        groupSummaries: groupSummaries.length > 0 ? groupSummaries : undefined,
        completenessValidation,
        validationSummary,
        unlinkedBreakdowns: unlinkedBreakdowns.length > 0 ? unlinkedBreakdowns : undefined,
        remarks: rawSafety.remarks || 'Not reported',
        evidenceQuote: rawSafety.evidenceQuote || (isExplicitNoEventsReported ? (paperText.match(explicitNoOverallEventPattern)?.[0] || 'Not reported') : 'Not reported'),
        evidenceLocation: rawSafety.evidenceLocation || 'Not reported',
      };

      const safety = {
        events: processedEvents,
        summary: safetySummary,
        hasExplicitNoEventsReported: isExplicitNoEventsReported,
        hasSafetyNotReported: isSafetyNotReported && processedEvents.length === 0,
      };

      const result: FullAppraisalData = {
        due,
        dueList,
        similarDevices,
        articleMetadata,
        rawPaperText: paperText,
        pdfFileName: fileName,
        researchGroups,
        suitability,
        relevance,
        methodological,
        contribution,
        safety,
      };

      // Final deterministic self-validation layer. PASS items remain invisible in the UI;
      // only unresolved REVIEW/FAIL findings are attached to the result. This layer never
      // invents clinical values and does not add another Gemini call, so normal analyses
      // do not consume additional model quota.
      result.selfValidation = runSelfValidation(result);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('Extraction handler error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to extract clinical data from PDF.',
        failedField: 'Extraction Pipeline',
      });
    }
  });

  // =========================================================================
  // Literature Screening API Endpoints
  // =========================================================================

  // 1. PubMed PICO Search
  app.post('/api/screening/pubmed-search', async (req, res) => {
    try {
      const {
        p_text,
        i_text,
        c_text,
        o_text,
        start_year,
        start_month,
        end_year,
        end_month,
        fetch_all,
        max_results,
        ncbi_api_key,
        direct_query,
        filters,
        sort,
      } = req.body;

      const result = await searchPubmedPmids({
        p_text,
        i_text,
        c_text,
        o_text,
        start_year: Number(start_year) || 2026,
        start_month: Number(start_month) || 1,
        end_year: Number(end_year) || 2026,
        end_month: Number(end_month) || 12,
        fetch_all: Boolean(fetch_all),
        max_results: Number(max_results) || 20,
        ncbi_api_key: ncbi_api_key || process.env.NCBI_API_KEY || '',
        direct_query,
        filters: Array.isArray(filters) ? filters : [],
        sort: sort === 'pub_date' ? 'pub_date' : 'relevance',
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      console.error('PubMed Search Error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to execute PubMed search.',
      });
    }
  });

  // 2. Screen Single PMID
  app.post('/api/screening/screen-single-pmid', async (req, res) => {
    try {
      const { pmid, category, subModel, includeCriteria, excludeCriteria, ncbiApiKey } = req.body;
      if (!pmid) {
        return res.status(400).json({ success: false, error: 'PMID is required.' });
      }

      const apiKey = ncbiApiKey || process.env.NCBI_API_KEY || '';
      const article = await fetchPubmedArticle(pmid, apiKey);

      let fullText = null;
      let evalSource = 'No Data';
      let contentForAi = '';

      if (article.pmcid) {
        fullText = await fetchPmcFullText(article.pmcid, apiKey);
        if (fullText) {
          evalSource = 'Full-text (Open Access)';
          contentForAi = `[Title]\n${article.title}\n\n[Full-text Body]\n${fullText}`;
        } else if (article.abstract) {
          evalSource = 'Abstract Only';
          contentForAi = `[Title]\n${article.title}\n\n[Abstract]\n${article.abstract}`;
        }
      } else if (article.abstract) {
        evalSource = 'Abstract Only';
        contentForAi = `[Title]\n${article.title}\n\n[Abstract]\n${article.abstract}`;
      }

      if (evalSource === 'No Data') {
        return res.json({
          success: true,
          data: {
            id: pmid,
            title: article.title || 'Lookup Failed',
            evaluationStandard: 'No Data',
            abstractSummary: 'No Abstract or Full-text Available',
            aiDecision: 'Review',
            conclusion: 'Insufficient information: Abstract/Full-text is unavailable. Manual full-text review is required.',
            link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          },
        });
      }

      const ai = getGeminiClient();
      const screeningRes = await runGeminiScreening(
        ai,
        category || '1. Biliary Stent',
        subModel || 'Niti-S Biliary Uncovered Stent',
        includeCriteria || '',
        excludeCriteria || '',
        article.title,
        contentForAi,
        article
      );

      res.json({
        success: true,
        data: {
          id: pmid,
          title: article.title,
          evaluationStandard: evalSource,
          abstractSummary: article.abstract || 'Full-text evaluated',
          aiDecision: screeningRes.decision,
          conclusion: screeningRes.conclusion,
          link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        },
      });
    } catch (err: any) {
      console.error('Single PMID screening error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Error processing PMID screening.',
      });
    }
  });

  // 3. Batch Screen PubMed PMIDs (Processes single item or small batch with streaming/polling support)
  app.post('/api/screening/screen-pmid-item', async (req, res) => {
    try {
      const {
        pmid,
        category,
        subModel,
        includeCriteria,
        excludeCriteria,
        history,
        ncbiApiKey,
      } = req.body;

      const identifier = String(pmid).replace(/\.0$/, '').trim();
      const apiKey = ncbiApiKey || process.env.NCBI_API_KEY || '';

      // Check deduplication
      if (history && history[identifier]) {
        const prevInfo = history[identifier];
        return res.json({
          success: true,
          data: {
            id: identifier,
            title: `PMID ${identifier}`,
            evaluationStandard: 'Deduplicated',
            abstractSummary: 'Previously screened article',
            aiDecision: 'Duplicated',
            conclusion: `Duplicate literature previously screened in [${prevInfo.subModel || 'previous'}] step.`,
            link: `https://pubmed.ncbi.nlm.nih.gov/${identifier}/`,
          },
        });
      }

      const article = await fetchPubmedArticle(identifier, apiKey).catch((err) => {
        console.warn(`[Screening] Failed to fetch article details for PMID ${identifier}:`, err.message);
        return {
          title: `PMID ${identifier} Literature Record`,
          abstract: '',
          pmcid: null,
          doi: undefined,
          journal: '',
          pubDate: '',
        };
      });
      let fullText = null;
      let evalSource = 'No Data';
      let contentForAi = '';

      if (article.pmcid) {
        fullText = await fetchPmcFullText(article.pmcid, apiKey).catch(() => null);
        if (fullText) {
          evalSource = 'Full-text (Open Access)';
          contentForAi = `[Title]\n${article.title}\n\n[Full-text Body]\n${fullText}`;
        } else if (article.abstract) {
          evalSource = 'Abstract Only';
          contentForAi = `[Title]\n${article.title}\n\n[Abstract]\n${article.abstract}`;
        }
      } else if (article.abstract) {
        evalSource = 'Abstract Only';
        contentForAi = `[Title]\n${article.title}\n\n[Abstract]\n${article.abstract}`;
      }

      if (evalSource === 'No Data') {
        return res.json({
          success: true,
          data: {
            id: identifier,
            title: article.title || `PMID ${identifier}`,
            evaluationStandard: 'No Data',
            abstractSummary: 'No Abstract or Full-text Available on PubMed API',
            aiDecision: 'Review',
            conclusion: 'Insufficient information: Abstract text is unavailable via PubMed API. Manual retrieval and full-text review required.',
            link: `https://pubmed.ncbi.nlm.nih.gov/${identifier}/`,
          },
        });
      }

      const ai = getGeminiClient();
      const screeningRes = await runGeminiScreening(
        ai,
        category,
        subModel,
        includeCriteria,
        excludeCriteria,
        article.title,
        contentForAi,
        article
      );

      res.json({
        success: true,
        data: {
          id: identifier,
          title: article.title,
          evaluationStandard: evalSource,
          abstractSummary: article.abstract ? `${article.abstract.slice(0, 180)}...` : 'Full-text checked',
          aiDecision: screeningRes.decision,
          conclusion: screeningRes.conclusion,
          link: `https://pubmed.ncbi.nlm.nih.gov/${identifier}/`,
        },
      });
    } catch (err: any) {
      console.error('Batch PMID item error:', err);
      // Even in catch block, return a valid data item so client table never drops the item
      const identifier = String(req.body?.pmid || 'Unknown');
      res.json({
        success: true,
        data: {
          id: identifier,
          title: `PMID ${identifier}`,
          evaluationStandard: 'Error Recovery',
          abstractSummary: err.message || 'Processing warning during fetch',
          aiDecision: 'Review',
          conclusion: `Manual Review Required: ${err.message || 'Error occurred during automated screening.'}`,
          link: `https://pubmed.ncbi.nlm.nih.gov/${identifier}/`,
        },
      });
    }
  });

  // 4. Batch Screen GIE RIS Entry
  app.post('/api/screening/screen-gie-item', async (req, res) => {
    try {
      const {
        title,
        abstract,
        doi,
        url,
        category,
        subModel,
        includeCriteria,
        excludeCriteria,
        history,
      } = req.body;

      const identifier = (doi && doi !== '-' ? doi : title || 'unknown').toLowerCase().trim();

      // Check duplicate
      if (history && history[identifier]) {
        const prevInfo = history[identifier];
        return res.json({
          success: true,
          data: {
            id: doi || title,
            title: title || 'Untitled',
            evaluationStandard: 'Deduplicated',
            abstractSummary: abstract ? `${abstract.slice(0, 150)}...` : 'No Abstract',
            aiDecision: 'Duplicated',
            conclusion: `Duplicate literature previously screened in [${prevInfo.subModel || 'previous'}] step.`,
            link: url || (doi ? `https://doi.org/${doi}` : undefined),
            doi,
          },
        });
      }

      const evalSource = abstract && abstract.trim() ? 'Abstract Only' : 'No Data';

      if (evalSource === 'No Data') {
        return res.json({
          success: true,
          data: {
            id: doi || title,
            title: title || 'Untitled',
            evaluationStandard: 'No Data',
            abstractSummary: 'No Abstract Available',
            aiDecision: 'Review',
            conclusion: 'Insufficient information: Abstract text is missing in the GIE RIS file. Manual full-text review is required.',
            link: url || (doi ? `https://doi.org/${doi}` : undefined),
            doi,
          },
        });
      }

      const ai = getGeminiClient();
      const screeningRes = await runGeminiScreening(
        ai,
        category,
        subModel,
        includeCriteria,
        excludeCriteria,
        title,
        abstract,
        { journal: 'Gastrointestinal Endoscopy', doi }
      );

      res.json({
        success: true,
        data: {
          id: doi || title,
          title: title || 'Untitled',
          evaluationStandard: evalSource,
          abstractSummary: `${abstract.slice(0, 180)}...`,
          aiDecision: screeningRes.decision,
          conclusion: screeningRes.conclusion,
          link: url || (doi ? `https://doi.org/${doi}` : undefined),
          doi,
        },
      });
    } catch (err: any) {
      console.error('GIE RIS item screening error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to screen GIE RIS item.',
      });
    }
  });

  // 5. ClinicalTrials.gov Search & Screen
  app.post('/api/screening/clinicaltrials-search', async (req, res) => {
    try {
      const {
        condition,
        intervention,
        statusFilters,
        typeFilters,
        fetchAll,
        maxResults,
      } = req.body;

      const result = await searchClinicalTrialsStudies({
        condition,
        intervention,
        statusFilters,
        typeFilters,
        fetchAll: Boolean(fetchAll),
        maxResults: Number(maxResults) || 20,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      console.error('ClinicalTrials search error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to search ClinicalTrials.gov.',
      });
    }
  });

  // 6. ClinicalTrials Single Study Screen
  app.post('/api/screening/screen-ct-item', async (req, res) => {
    try {
      const {
        study,
        category,
        subModel,
        includeCriteria,
        excludeCriteria,
        history,
      } = req.body;

      const nctId = study.nctId || 'Unknown';
      const identifier = nctId.toLowerCase().trim();
      const nctUrl = `https://clinicaltrials.gov/study/${nctId}`;

      // Check duplicate
      if (history && history[identifier]) {
        const prevInfo = history[identifier];
        return res.json({
          success: true,
          data: {
            id: nctId,
            title: study.title || 'Untitled Study',
            evaluationStandard: 'Deduplicated',
            abstractSummary: study.summary ? `${study.summary.slice(0, 150)}...` : '',
            aiDecision: 'Duplicated',
            conclusion: `Duplicate literature previously screened in [${prevInfo.subModel || 'previous'}] step.`,
            link: nctUrl,
            clinicalStatus: study.status,
          },
        });
      }

      const evalSource = study.summary && study.summary.trim() ? 'Abstract Only' : 'No Data';

      if (evalSource === 'No Data') {
        return res.json({
          success: true,
          data: {
            id: nctId,
            title: study.title || 'Untitled Study',
            evaluationStandard: 'No Data',
            abstractSummary: 'No Summary Available',
            aiDecision: 'Review',
            conclusion: `Insufficient information: No brief summary available for ${nctId}.`,
            link: nctUrl,
            clinicalStatus: study.status,
          },
        });
      }

      const articleContent = `[NCT ID]: ${nctId}\n[Status]: ${study.status}\n[Title]\n${study.title}\n\n[Brief Summary]\n${study.summary}`;

      const ai = getGeminiClient();
      const screeningRes = await runGeminiScreening(
        ai,
        category,
        subModel || 'All models',
        includeCriteria,
        excludeCriteria,
        study.title,
        articleContent
      );

      res.json({
        success: true,
        data: {
          id: nctId,
          title: study.title,
          evaluationStandard: evalSource,
          abstractSummary: `${study.summary.slice(0, 180)}...`,
          aiDecision: screeningRes.decision,
          conclusion: screeningRes.conclusion,
          link: nctUrl,
          clinicalStatus: study.status,
        },
      });
    } catch (err: any) {
      console.error('ClinicalTrials study screening error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to screen ClinicalTrials study.',
      });
    }
  });

  // Explicit API error handling to always return JSON for API requests
  app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Middleware Error]:', err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal Server Error in API processing',
      failedField: 'API Middleware',
    });
  });

  // Catch-all 404 handler for unmatched /api routes to prevent Vite from returning index.html
  app.all(['/api', '/api/*'], (req, res) => {
    res.status(404).json({
      success: false,
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      failedField: 'Routing',
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Clinical Literature Appraisal Extractor running on port ${PORT}`);
  });

  // Long PDF/model requests can legitimately exceed Node's conservative defaults.
  // Keep the connection alive while Gemini is working instead of terminating the
  // browser request and surfacing only a generic "Failed to fetch" message.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;
  httpServer.keepAliveTimeout = 120_000;
}

startServer();
