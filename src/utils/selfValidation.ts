import type {
  FullAppraisalData,
  SelfValidationIssue,
  SelfValidationState,
  ValidationStatus,
} from '../types';

const missing = (value: unknown) => {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || ['not reported', 'not assessable', 'n/a', 'na', 'unknown'].includes(text);
};

const numeric = (value: unknown): number | null => {
  const m = String(value ?? '').replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const evidenceLooksPlaceholder = (quote: unknown) => {
  const q = String(quote ?? '').trim().toLowerCase();
  return !q || q === 'not reported' || q === 'direct sentence from paper' ||
    q === 'device description in paper' || q === 'group description in text' ||
    q === 'clinical and technical outcomes reported' || q === 'statistical analysis performed' ||
    q === 'statistical analysis was performed using standard methods';
};

const inDiscussionOrReferences = (location: unknown) =>
  /discussion|references?|literature review/i.test(String(location ?? ''));

const addIssue = (
  issues: SelfValidationIssue[],
  status: Exclude<ValidationStatus, 'pass'>,
  step: 1 | 2 | 3 | 4,
  targetId: string,
  message: string,
  field?: string,
) => {
  const id = `${targetId}:${field || 'general'}:${message}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 180);
  if (issues.some((issue) => issue.id === id)) return;
  issues.push({ id, status, step, targetId, field, message });
};

const optionScoreFor = (item: any, selection: string): number | null => {
  const option = Array.isArray(item?.options) ? item.options.find((o: any) => o.label === selection) : undefined;
  return option && Number.isFinite(Number(option.score)) ? Number(option.score) : null;
};

const detectClinicalOutcomeInCurrentStudy = (data: FullAppraisalData): boolean => {
  const source = String(data.rawPaperText || '').split(/(?:^|\n)\s*(?:discussion|references)\b/i)[0] || '';
  const outcomeTerm = /\b(?:technical success|clinical success|clinical response|treatment success|stent patency|patency|survival|dysphagia|gooss|reintervention|re-intervention|recurrence|recurrent|adverse events?|complications?|migration|occlusion|obstruction|bleeding|perforation|cholangitis|pancreatitis)\b/i;
  const quantitative = /(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*(?:days?|weeks?|months?|years?)\b)/i;
  return source.split(/\n|\.(?=\s+[A-Z])/).some((segment) => outcomeTerm.test(segment) && quantitative.test(segment));
};

const parseGenderPairs = (value: unknown): Array<{ male: number; female: number }> => {
  const text = String(value ?? '');
  const results: Array<{ male: number; female: number }> = [];
  const patterns = [
    /Male:\s*n\s*=\s*(\d+)[\s\S]{0,100}?Female:\s*n\s*=\s*(\d+)/gi,
    /Female:\s*n\s*=\s*(\d+)[\s\S]{0,100}?Male:\s*n\s*=\s*(\d+)/gi,
  ];
  for (let p = 0; p < patterns.length; p++) {
    let m: RegExpExecArray | null;
    while ((m = patterns[p].exec(text)) !== null) {
      results.push(p === 0
        ? { male: Number(m[1]), female: Number(m[2]) }
        : { male: Number(m[2]), female: Number(m[1]) });
    }
  }
  // The same study-wide gender pair is commonly repeated in both the UI comment
  // and the supporting evidence quote. De-duplicate identical pairs so that a
  // duplicated citation does not suppress the reconciliation check.
  return Array.from(
    new Map(results.map((pair) => [`${pair.male}:${pair.female}`, pair] as const)).values()
  );
};


const extractFollowUpCenter = (value: unknown, fieldIsFollowUp = false): { value: number; unit: string } | null => {
  const text = String(value ?? '').replace(/[–—−]/g, '-');
  if (!text.trim()) return null;
  const scope = fieldIsFollowUp
    ? text
    : (text.match(/follow[- ]?up[^.;\n]{0,180}/i)?.[0] || '');
  if (!scope) return null;
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(days?|weeks?|months?|years?)\b/i,
    /(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i,
  ];
  for (const re of patterns) {
    const m = scope.match(re);
    if (m) return { value: Number(m[1]), unit: m[2].toLowerCase().replace(/s$/, '') };
  }
  return null;
};

export function runSelfValidation(data: FullAppraisalData): SelfValidationState {
  const issues: SelfValidationIssue[] = [];
  const dueList = data.dueList?.length
    ? data.dueList
    : data.due
      ? [data.due]
      : [];

  // STEP 1 — DUE setup integrity. This is intentionally conservative because Step 1 is user-entered reference data.
  dueList.forEach((due, index) => {
    const targetId = `step1.due.${due.id || index}`;
    if (missing(due.productName)) addIssue(issues, 'fail', 1, targetId, 'DUE product name is missing.');
    if (!Array.isArray(due.indications) || due.indications.filter((x) => !missing(x)).length === 0) {
      addIssue(issues, 'fail', 1, targetId, 'No DUE indication is configured.');
    }
  });

  // STEP 2 — research group/device extraction and DUE classification.
  const articleN = numeric(data.articleMetadata?.totalPatientCount);
  (data.researchGroups || []).forEach((group) => {
    const groupTarget = `step2.group.${group.id}`;
    const groupN = numeric(group.groupPatientNumber);
    if (articleN !== null && groupN !== null && groupN > articleN) {
      addIssue(issues, 'fail', 2, groupTarget, `Group N (${groupN}) is larger than the reported study population (${articleN}).`, 'groupPatientNumber');
    }
    if (evidenceLooksPlaceholder(group.evidence?.quote)) {
      addIssue(issues, 'review', 2, groupTarget, 'Group evidence could not be independently confirmed from a verbatim quote.', 'evidence');
    }
    if (inDiscussionOrReferences(group.evidence?.location)) {
      addIssue(issues, 'fail', 2, groupTarget, 'Current-study group evidence points to Discussion/References.', 'evidence');
    }

    (group.devices || []).forEach((device) => {
      const target = `step2.device.${device.id}`;
      // Validate the value currently shown/used by the appraisal. User-final
      // selections supersede the original AI recommendation after manual edits.
      const relationship = device.deviceRelationship?.userFinal || device.deviceRelationship?.aiRecommended;
      const indicationRelationship = device.indicationRelationship?.userFinal || device.indicationRelationship?.aiRecommended;
      const genericName = /^(?:sems|stent|metal stent|self[- ]expandable(?: metal)? stent|covered stent|uncovered stent|device)$/i.test(String(device.deviceProductName || '').trim());
      if (relationship === 'DUE' && (!device.matchedDueId || genericName || missing(device.deviceProductName))) {
        addIssue(issues, 'fail', 2, target, 'DUE classification lacks a sufficiently specific source-backed product/alias match.', 'deviceRelationship');
      }
      if (relationship === 'DUE' && device.dueMatchStatus && /review|required|confirmation|conflict|multiple/i.test(device.dueMatchStatus)) {
        addIssue(issues, 'review', 2, target, 'DUE match is not unique or requires confirmation.', 'deviceRelationship');
      }
      if (indicationRelationship === 'Same indication' && missing(device.deviceIndication) && missing(group.groupIndicationSummary)) {
        addIssue(issues, 'review', 2, target, 'Same-indication classification is present, but the extracted group/device indication is not explicit.', 'indicationRelationship');
      }
      if (evidenceLooksPlaceholder(device.evidence?.quote)) {
        addIssue(issues, 'review', 2, target, 'Device evidence is not a confirmed verbatim source quote.', 'evidence');
      }
      if (inDiscussionOrReferences(device.evidence?.location)) {
        addIssue(issues, 'fail', 2, target, 'Current-study device evidence points to Discussion/References.', 'evidence');
      }
    });
  });

  // STEP 3 — scoring/evidence consistency.
  const validateScoredSection = (section: any, prefix: string) => {
    Object.values(section || {}).forEach((item: any) => {
      if (!item || typeof item !== 'object' || !item.id || !Array.isArray(item.options)) return;
      const target = `step3.${item.id}`;
      const selected = item.userFinalSelection || item.aiRecommendedSelection;
      const currentScore = item.userFinalScore !== undefined && item.userFinalScore !== null
        ? Number(item.userFinalScore)
        : Number(item.aiRecommendedScore);
      const expected = optionScoreFor(item, selected);
      if (expected !== null && currentScore !== expected) {
        addIssue(issues, 'fail', 3, target, `Score does not match the selected ${prefix} option.`, 'score');
      }
      if (item.status === 'Reported' && evidenceLooksPlaceholder(item.evidence?.quote)) {
        addIssue(issues, 'review', 3, target, 'The appraisal is marked Reported but its supporting quote is not independently verifiable.', 'evidence');
      }
      if (inDiscussionOrReferences(item.evidence?.location) && !/interpretation/i.test(String(item.id))) {
        addIssue(issues, 'review', 3, target, 'This appraisal item is supported only by Discussion/References; current-study Results/Methods should be checked.', 'evidence');
      }
    });
  };
  validateScoredSection(data.suitability, 'suitability');
  validateScoredSection(data.methodological, 'methodological');
  validateScoredSection(data.contribution, 'contribution');

  const gender = data.relevance?.itemH_gender;
  if (gender) {
    const pairs = parseGenderPairs(`${gender.comment || ''}\n${gender.evidence?.quote || ''}`);
    if (pairs.length === 1 && articleN !== null) {
      const total = pairs[0].male + pairs[0].female;
      if (total !== articleN) {
        addIssue(issues, 'review', 3, `step3.${gender.id}`, `Male + female count (${total}) does not reconcile with study N (${articleN}); confirm whether subgroup reporting is involved.`, 'gender');
      }
    }
    if (gender.status === 'Not reported' && /\b(?:sex|gender|male|female|m\/f)\b/i.test(String(data.rawPaperText || ''))) {
      addIssue(issues, 'review', 3, `step3.${gender.id}`, 'Gender is marked Not reported although sex/gender terms are present in the article; source confirmation is recommended.', 'gender');
    }
  }

  const range = data.relevance?.itemJ_rangeOfTime;
  if (range?.rangeOfTimeDetails) {
    const details = range.rangeOfTimeDetails;
    const allMissing = [details.durationOfApplicationOrUse, details.numberOfRepeatExposures, details.durationOfFollowUp].every(missing);
    const source = String(data.rawPaperText || '').split(/(?:^|\n)\s*(?:discussion|references)\b/i)[0] || '';
    if (allMissing && /\b(?:patency|indwell(?:ing)?|dwell\s+time|follow[- ]?up|survival|reintervention|repeat\s+(?:stent|procedure)|another\s+stent|second\s+stent)\b/i.test(source)) {
      addIssue(issues, 'review', 3, `step3.${range.id}`, 'All range-of-time fields are Not reported although relevant timing terms occur in the current-study text.', 'rangeOfTime');
    }

    // Cross-check the Relevance follow-up against independent full-paper fields.
    // This is REVIEW-only because legitimate studies can report more than one
    // follow-up definition. It specifically catches impossible overwrites such as
    // Relevance=8 months while metadata/contribution consistently report 48 months.
    const relevanceFu = extractFollowUpCenter(details.durationOfFollowUp, true);
    const metadataFu = extractFollowUpCenter(data.articleMetadata?.followUpPeriod, true);
    const contributionFu = extractFollowUpCenter(
      `${data.contribution?.followUp?.evidence?.quote || ''}\n${data.contribution?.followUp?.comment || ''}`,
      false,
    );
    const independentFu = metadataFu || contributionFu;
    if (
      relevanceFu && independentFu &&
      relevanceFu.unit === independentFu.unit &&
      relevanceFu.value !== independentFu.value
    ) {
      addIssue(
        issues,
        'review',
        3,
        `step3.${range.id}`,
        `Follow-up is inconsistent across appraisal sections (${relevanceFu.value} ${relevanceFu.unit}${relevanceFu.value === 1 ? '' : 's'} vs ${independentFu.value} ${independentFu.unit}${independentFu.value === 1 ? '' : 's'}); confirm the source definition before finalizing.`,
        'followUp',
      );
    }
  }

  const patientItem = data.methodological?.patientsNumber;
  if (patientItem && articleN !== null) {
    const expectedScore = articleN >= 30 ? 2 : articleN >= 11 ? 1 : 0;
    const currentScore = patientItem.userFinalScore !== undefined && patientItem.userFinalScore !== null
      ? Number(patientItem.userFinalScore)
      : Number(patientItem.aiRecommendedScore);
    if (currentScore !== expectedScore) {
      addIssue(issues, 'fail', 3, `step3.${patientItem.id}`, `Patient-number score is inconsistent with N=${articleN}.`, 'score');
    }
  }

  const clinicalItem = data.contribution?.clinicalSignificance;
  if (clinicalItem) {
    const clinicalOutcomeExists = detectClinicalOutcomeInCurrentStudy(data);
    const selected = clinicalItem.userFinalSelection || clinicalItem.aiRecommendedSelection;
    const saysYes = /^yes\b/i.test(String(selected || ''));
    if (clinicalOutcomeExists && !saysYes) {
      addIssue(issues, 'fail', 3, `step3.${clinicalItem.id}`, 'A quantitative clinical outcome is present, so Clinical significance should be Yes under the configured rule.', 'clinicalSignificance');
    } else if (saysYes && evidenceLooksPlaceholder(clinicalItem.evidence?.quote)) {
      addIssue(issues, 'review', 3, `step3.${clinicalItem.id}`, 'Clinical significance is Yes, but the supporting quantitative outcome quote needs confirmation.', 'clinicalSignificance');
    }
  }

  // Relevance items (non-scored) evidence checks.
  Object.values(data.relevance || {}).forEach((item: any) => {
    if (!item?.id) return;
    if (item.status === 'Reported' && evidenceLooksPlaceholder(item.evidence?.quote)) {
      addIssue(issues, 'review', 3, `step3.${item.id}`, 'The relevance item is marked Reported but its verbatim evidence needs confirmation.', 'evidence');
    }
    if (inDiscussionOrReferences(item.evidence?.location)) {
      addIssue(issues, 'review', 3, `step3.${item.id}`, 'Relevance evidence should come from the current study rather than Discussion/References.', 'evidence');
    }
  });

  // STEP 4 — hierarchy, current-study evidence, numerical consistency, mortality relatedness.
  const events = data.safety?.events || [];
  const byName = new Map(events.map((e) => [String(e.eventName || '').toLowerCase().trim(), e]));
  events.forEach((event) => {
    const target = `step4.event.${event.id}`;
    if (event.parentEvent) {
      const parentExists = byName.has(String(event.parentEvent).toLowerCase().trim());
      if (!parentExists) {
        addIssue(issues, 'fail', 4, target, 'A parent event is assigned but that parent is not present in the extracted current-study event list.', 'hierarchy');
      }
      if (!event.hierarchyEvidenceType || event.hierarchyEvidenceType === 'none' || event.hierarchyConfidence === 'Low') {
        addIssue(issues, 'review', 4, target, 'Parent–child hierarchy is not supported by strong explicit text/table evidence.', 'hierarchy');
      }
    }
    if (event.isAggregate && event.parentEvent && event.isSubItem === false) {
      addIssue(issues, 'review', 4, target, 'Nested aggregate metadata is internally inconsistent and should be checked.', 'hierarchy');
    }
    if (inDiscussionOrReferences(event.evidenceLocation)) {
      addIssue(issues, 'fail', 4, target, 'Safety event evidence points to Discussion/References rather than current-study Results/Tables.', 'evidence');
    }
    const n = numeric(event.numerator ?? event.numEvents);
    const N = numeric(event.denominator ?? event.totalPatients);
    const reportedPct = numeric(event.reportedPercentage || event.reportedRate);
    if (n !== null && N !== null && N > 0 && reportedPct !== null && event.multipleEventsPerPatient !== 'Yes') {
      const calculated = (n / N) * 100;
      if (Math.abs(calculated - reportedPct) > 1.1) {
        addIssue(issues, 'review', 4, target, `Reported percentage (${reportedPct}%) does not reconcile with n/N (${n}/${N}); confirm denominator/unit context.`, 'percentage');
      }
    }
  });

  const mortality = data.safety?.summary;
  if (mortality) {
    const source = String(data.rawPaperText || '').split(/(?:^|\n)\s*(?:discussion|references)\b/i)[0] || '';
    const explicitRelated = /\b(?:no\s+)?(?:stent|device|procedure|treatment)[- ]related\s+(?:mortality|deaths?)\b/i.test(source);
    if (explicitRelated && ['all_cause', 'unclear'].includes(String(mortality.overallMortalityRelatedness || ''))) {
      addIssue(issues, 'fail', 4, 'step4.summary.mortality', 'The article reports related mortality explicitly, but Step 4 is showing a less specific mortality category.', 'mortality');
    }
    if (mortality.overallMortalityVerificationRequired) {
      addIssue(issues, 'review', 4, 'step4.summary.mortality', 'Mortality is reported, but its relationship to the stent/device/procedure is unclear.', 'mortality');
    }
    (mortality.groupSummaries || []).forEach((group, index) => {
      const target = `step4.group.${group.groupId || index}.mortality`;
      if (explicitRelated && ['all_cause', 'unclear'].includes(String(group.mortalityRelatedness || ''))) {
        addIssue(issues, 'review', 4, target, 'A more device-specific mortality statement exists in the article; confirm this group-level mortality value.', 'mortality');
      }
      if (group.mortalityVerificationRequired) {
        addIssue(issues, 'review', 4, target, 'Mortality is reported, but its relationship to the stent/device/procedure is unclear.', 'mortality');
      }
    });
  }

  const overallStatus: ValidationStatus = issues.some((i) => i.status === 'fail')
    ? 'fail'
    : issues.some((i) => i.status === 'review')
      ? 'review'
      : 'pass';

  return {
    version: '1.0',
    overallStatus,
    issues,
    validatedAt: new Date().toISOString(),
  };
}

export function issuesForTarget(validation: SelfValidationState | undefined, targetId: string): SelfValidationIssue[] {
  return validation?.issues?.filter((issue) => issue.targetId === targetId) || [];
}
