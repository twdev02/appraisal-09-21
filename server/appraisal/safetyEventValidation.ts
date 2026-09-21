import {
  classifySafetyRowLabel,
  isExplicitSafetyContextText,
  type SafetyRowClassification,
} from '../../src/utils/nlpRules';

export interface SafetyEventValidationContext {
  paperText?: string;
  totalPatientCount?: unknown;
  researchGroups?: any[];
}

export interface RejectedSafetyCandidate {
  event: any;
  reason: string;
}

export interface SanitizedSafetyCandidates {
  events: any[];
  rejected: RejectedSafetyCandidate[];
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[™®©℠]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[^a-z0-9%+\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parsePercentage(value: unknown): number | null {
  const match = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function normalizeCountUnit(value: unknown): 'patients' | 'events' | 'procedures' | 'episodes' | 'unknown' {
  const text = normalizeText(value);
  if (/patient|participant|subject|person/.test(text)) return 'patients';
  if (/procedure|intervention|placement|session/.test(text)) return 'procedures';
  if (/episode/.test(text)) return 'episodes';
  if (/event|occurrence|complication/.test(text)) return 'events';
  return 'unknown';
}

function normalizeYesNo(value: unknown): 'yes' | 'no' | 'unknown' {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  const text = normalizeText(value);
  if (/^(?:yes|true|present|reported)$/.test(text)) return 'yes';
  if (/^(?:no|false|absent)$/.test(text)) return 'no';
  return 'unknown';
}

function getEventName(event: any): string {
  return String(
    event?.eventName ??
    event?.name ??
    event?.complicationName ??
    event?.adverseEventName ??
    event?.event ??
    ''
  ).trim();
}

function getCountPair(event: any): { numerator: number | null; denominator: number | null } {
  const countN = String(event?.countN ?? event?.count_n ?? '');
  const pair = countN.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (pair) {
    return { numerator: Number(pair[1]), denominator: Number(pair[2]) };
  }
  const explicitNumerator = parseFiniteNumber(event?.numEvents ?? event?.numerator ?? event?.count ?? event?.eventCount ?? event?.n);
  // Some table-rescue rows carry only countN="2". Treat a pure numeric
  // countN as the numerator so it can be reconciled with a richer 2/N row.
  const countOnlyNumerator = /^\s*\d+(?:\.\d+)?\s*$/.test(countN) ? Number(countN.trim()) : null;
  return {
    numerator: explicitNumerator ?? countOnlyNumerator,
    denominator: parseFiniteNumber(event?.totalPatients ?? event?.denominator ?? event?.populationN ?? event?.groupN),
  };
}

function eventContextText(event: any): string {
  return [
    event?.eventName,
    event?.name,
    event?.category,
    event?.eventType,
    event?.parentEvent,
    event?.hierarchyRole,
    event?.evidenceQuote,
    event?.evidenceLocation,
    event?.percentageContextQuote,
  ].filter(Boolean).join(' ');
}

function isOutsideCurrentStudy(event: any): boolean {
  const location = normalizeText(event?.evidenceLocation ?? event?.evidence_location ?? event?.location);
  return /\b(?:discussion|references?|literature review|published studies?|previous studies?|prior studies?)\b/.test(location);
}

function hasExplicitSafetyRelationship(event: any): boolean {
  const relationship = normalizeText(event?.relationshipType);
  return Boolean(
    event?.parentEvent ||
    event?.isSubItem ||
    ['component', 'cause'].includes(relationship)
  );
}

function isExplicitEventCountUnit(event: any): boolean {
  const numeratorType = normalizeCountUnit(
    event?.numeratorType ?? event?.numeratorUnit ?? event?.countUnit ?? event?.countType
  );
  return ['events', 'episodes', 'procedures'].includes(numeratorType);
}

function hasMultipleEventAllowance(event: any): boolean {
  return normalizeYesNo(
    event?.multipleEventsPerPatient ?? event?.multipleEventsPossible ?? event?.overlappingEvents
  ) === 'yes';
}

function markReviewRequired(event: any, reason: string): any {
  const existingReason = String(event?.reviewReason ?? '').trim();
  return {
    ...event,
    classificationStatus: 'review_required',
    reviewReason: existingReason ? `${existingReason}; ${reason}` : reason,
  };
}

/**
 * Deterministic gate between Gemini/table extraction and the Step 4 UI.
 * It rejects clearly non-safety measurements before they can be converted into
 * complication rows while preserving uncommon terms when the source explicitly
 * places them in a safety block.
 */
export function sanitizeSafetyEventCandidates(
  candidates: any[],
  context: SafetyEventValidationContext = {}
): SanitizedSafetyCandidates {
  const events: any[] = [];
  const rejected: RejectedSafetyCandidate[] = [];

  for (const original of Array.isArray(candidates) ? candidates : []) {
    const event = { ...original };
    const eventName = getEventName(event);
    const sourceContext = eventContextText(event);
    const classification: SafetyRowClassification = classifySafetyRowLabel(eventName, sourceContext);
    const explicitSafetyContext = isExplicitSafetyContextText(sourceContext);

    const reject = (reason: string) => {
      rejected.push({ event: original, reason });
    };

    if (!eventName) {
      reject('Missing event label.');
      continue;
    }

    if (isOutsideCurrentStudy(event)) {
      reject('Evidence comes from Discussion/References rather than current-study Results/Tables.');
      continue;
    }

    if (classification === 'non_event') {
      reject('Row is a demographic, laboratory, procedural, efficacy, mortality, reintervention, or time-to-event measure rather than a complication.');
      continue;
    }

    if (classification === 'ambiguous' && !explicitSafetyContext && !hasExplicitSafetyRelationship(event)) {
      reject('Ambiguous row lacks an explicit safety/complication context.');
      continue;
    }

    const { numerator, denominator } = getCountPair(event);
    if (numerator !== null && numerator <= 0) {
      reject('Zero-count rows are not listed as occurred complications.');
      continue;
    }
    if (denominator !== null && denominator <= 0) {
      reject('Invalid denominator.');
      continue;
    }

    // Patient counts cannot exceed their patient denominator. Counts may exceed
    // N only when the source explicitly identifies events/episodes/procedures or
    // multiple events per patient.
    if (
      numerator !== null &&
      denominator !== null &&
      numerator > denominator &&
      !isExplicitEventCountUnit(event) &&
      !hasMultipleEventAllowance(event)
    ) {
      reject(`Numerator ${numerator} exceeds denominator ${denominator} without event/episode or multiple-event justification.`);
      continue;
    }

    const reportedPercentage = parsePercentage(
      event?.reportedRate ?? event?.reportedPercentage ?? event?.percentage ?? event?.rate
    );
    if (
      reportedPercentage !== null &&
      reportedPercentage > 100 &&
      !isExplicitEventCountUnit(event) &&
      !hasMultipleEventAllowance(event)
    ) {
      reject(`Reported percentage ${reportedPercentage}% exceeds 100% without event-count justification.`);
      continue;
    }

    let accepted = event;
    if (classification === 'aggregate') {
      accepted = { ...accepted, isAggregate: true };
    }
    if (classification === 'ambiguous') {
      accepted = markReviewRequired(
        accepted,
        'Uncommon/ambiguous event label retained because the source explicitly places it in a safety context.'
      );
    }

    // A large n/N-vs-reported-% disagreement does not automatically delete a
    // genuine event, because tables may report events rather than patients. It is
    // retained but forced to review so no misleading calculated rate is trusted.
    if (numerator !== null && denominator !== null && denominator > 0 && reportedPercentage !== null) {
      const calculated = (numerator / denominator) * 100;
      if (Math.abs(calculated - reportedPercentage) > 5) {
        accepted = markReviewRequired(
          accepted,
          `Reported percentage (${reportedPercentage}%) differs materially from extracted n/N (${calculated.toFixed(1)}%); verify table column/denominator.`
        );
      }
    }

    events.push(accepted);
  }

  return { events, rejected };
}

function normalizeTimingForDedup(value: unknown): string {
  const text = normalizeText(value);
  const compact = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact || /^(?:n a|na|not reported|overall|overall not time categorized)$/.test(compact)) return 'overall';
  if (/\bearly\b/.test(compact)) return 'early';
  if (/\blate\b/.test(compact)) return 'late';
  return compact;
}

function canonicalGroupForDedup(event: any, researchGroups: any[] = []): string {
  const groupId = String(event?.groupId ?? '').trim();
  if (groupId) {
    const matched = researchGroups.find((group: any) => String(group?.id ?? '') === groupId);
    if (matched?.groupName) return normalizeText(matched.groupName);
  }

  const rawGroup = normalizeText(event?.groupName ?? event?.studyGroupOrDevice ?? '');
  if (rawGroup && !/^(?:study wide|all patients|overall)$/.test(rawGroup)) return rawGroup;
  if (researchGroups.length === 1) return normalizeText(researchGroups[0]?.groupName ?? rawGroup);
  return rawGroup || normalizeText(groupId);
}

function duplicateIdentity(event: any, researchGroups: any[] = []): string {
  const name = normalizeText(getEventName(event));
  const group = canonicalGroupForDedup(event, researchGroups);
  const timing = normalizeTimingForDedup(event?.timing);
  const parent = normalizeText(event?.parentEvent ?? '');
  return `${name}||${group}||${timing}||${parent}`;
}

function metricCompletenessScore(event: any): number {
  const { numerator, denominator } = getCountPair(event);
  const pct = parsePercentage(event?.reportedRate ?? event?.reportedPercentage ?? event?.percentage ?? event?.rate);
  let score = 0;
  if (numerator !== null) score += 2;
  if (denominator !== null) score += 4;
  if (pct !== null) score += 3;
  if (/\d+\s*\/\s*\d+/.test(String(event?.countN ?? ''))) score += 2;
  if (event?.source === 'confident_markdown_table') score += 1;
  if (event?.classificationStatus === 'classified') score += 1;
  return score;
}

function metricsAreCompatible(a: any, b: any): boolean {
  const ac = getCountPair(a);
  const bc = getCountPair(b);
  const ap = parsePercentage(a?.reportedRate ?? a?.reportedPercentage ?? a?.percentage ?? a?.rate);
  const bp = parsePercentage(b?.reportedRate ?? b?.reportedPercentage ?? b?.percentage ?? b?.rate);
  if (ac.numerator !== null && bc.numerator !== null && ac.numerator !== bc.numerator) return false;
  if (ac.denominator !== null && bc.denominator !== null && ac.denominator !== bc.denominator) return false;
  if (ap !== null && bp !== null && Math.abs(ap - bp) > 0.6) return false;
  return true;
}

function mergeCompatibleDuplicate(preferred: any, other: any): any {
  const preferredCount = getCountPair(preferred);
  const otherCount = getCountPair(other);
  const preferredPct = parsePercentage(preferred?.reportedRate ?? preferred?.reportedPercentage ?? preferred?.percentage ?? preferred?.rate);
  const otherPct = parsePercentage(other?.reportedRate ?? other?.reportedPercentage ?? other?.percentage ?? other?.rate);

  const numerator = preferredCount.numerator ?? otherCount.numerator;
  const denominator = preferredCount.denominator ?? otherCount.denominator;
  const pct = preferredPct ?? otherPct;
  const merged = { ...other, ...preferred };

  if (numerator !== null) {
    merged.numerator = preferred?.numerator ?? preferred?.numEvents ?? other?.numerator ?? other?.numEvents ?? String(numerator);
    merged.numEvents = preferred?.numEvents ?? other?.numEvents ?? merged.numEvents;
  }
  if (denominator !== null) {
    merged.denominator = preferred?.denominator ?? preferred?.totalPatients ?? other?.denominator ?? other?.totalPatients ?? String(denominator);
    merged.totalPatients = preferred?.totalPatients ?? other?.totalPatients ?? merged.totalPatients;
  }
  if (numerator !== null && denominator !== null) merged.countN = `${numerator}/${denominator}`;
  else if (numerator !== null) merged.countN = String(numerator);

  if (pct !== null) {
    const pctText = `${pct}%`;
    merged.reportedPercentage = preferredPct !== null
      ? (preferred?.reportedPercentage ?? preferred?.reportedRate ?? pctText)
      : (other?.reportedPercentage ?? other?.reportedRate ?? pctText);
    merged.reportedRate = preferredPct !== null
      ? (preferred?.reportedRate ?? preferred?.reportedPercentage ?? pctText)
      : (other?.reportedRate ?? other?.reportedPercentage ?? pctText);
  }

  if (preferred?.classificationStatus === 'classified' || other?.classificationStatus === 'classified') {
    merged.classificationStatus = 'classified';
    if (!preferred?.reviewReason && !other?.reviewReason) merged.reviewReason = undefined;
  }

  merged.pdfEvidenceQuote = merged.pdfEvidenceQuote ?? (preferred?.source === 'confident_markdown_table' ? other?.evidenceQuote : preferred?.evidenceQuote);
  merged.pdfEvidenceLocation = merged.pdfEvidenceLocation ?? (preferred?.source === 'confident_markdown_table' ? other?.evidenceLocation : preferred?.evidenceLocation);
  return merged;
}

/**
 * Collapse compatible duplicate safety rows emitted by PDF/Gemini, Markdown and
 * deterministic table rescue. The semantic identity intentionally ignores a
 * missing denominator/percentage so e.g. "Obstruction 2" and
 * "Obstruction 2/15 (13.3%)" become one row, preferring the more complete
 * evidence. Truly conflicting counts are preserved for review rather than
 * silently merged.
 */
export function collapseDuplicateSafetyEventCandidates(candidates: any[], researchGroups: any[] = []): any[] {
  const output: any[] = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const identity = duplicateIdentity(candidate, researchGroups);
    const compatibleIndex = output.findIndex((existing) =>
      duplicateIdentity(existing, researchGroups) === identity && metricsAreCompatible(existing, candidate)
    );
    if (compatibleIndex < 0) {
      output.push(candidate);
      continue;
    }

    const existing = output[compatibleIndex];
    const preferred = metricCompletenessScore(candidate) > metricCompletenessScore(existing) ? candidate : existing;
    const other = preferred === candidate ? existing : candidate;
    output[compatibleIndex] = mergeCompatibleDuplicate(preferred, other);
  }
  return output;
}

export function mergeSafetyEventCandidates(primary: any[], secondary: any[], researchGroups: any[] = []): any[] {
  return collapseDuplicateSafetyEventCandidates([
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(secondary) ? secondary : []),
  ], researchGroups);
}
