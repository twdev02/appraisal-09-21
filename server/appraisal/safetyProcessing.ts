export type SafetyHierarchyRelationship = 'none' | 'aggregate' | 'component' | 'cause' | 'unclear';
export type SafetyHierarchyConfidence = 'High' | 'Medium' | 'Low';
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

export function assessSafetyPercentage(
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

  // A patient-based incidence cannot have n > N. When the source does not
  // explicitly say the numerator is events/episodes/procedures or that patients
  // may contribute multiple events, do not calculate a >100% rate. This usually
  // indicates that a continuous table value (age/lab/time) was paired with the
  // cohort denominator or that the wrong table column was selected.
  if (nVal > totalVal && !explicitlyUnsafeUnit && multipleEventsPerPatient !== 'Yes' && !overlapWarning) {
    return {
      reportedRate,
      calculatedRate: 'Not reported',
      percentageSource: reportedRate !== 'Not reported' ? 'Reported' : 'Calculated',
      percentageAssessmentStatus: 'review_required',
      percentageAssessmentNote: `Extracted numerator (${nVal}) exceeds denominator (${totalVal}) without evidence that the numerator represents events/episodes or multiple events per patient. Verify the source row and denominator.`,
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

export function applyGeneralSafetyHierarchy(events: any[], paperText = ''): any[] {
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

