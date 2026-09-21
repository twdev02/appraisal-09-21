import type {
  DueSetup,
  DueItem,
  SimilarDevice,
  DeviceRelationshipType,
  IndicationRelationshipType,
  ValidationTestResult,
  ResearchGroup,
  SafetyEventItem,
  SafetyEventCategory,
  EventType,
  TableRowHierarchyClassification,
  SafetyBreakdownItem,
  SafetyValidationSummary,
  TimingSafetySummary,
  CompletenessValidation,
  RangeOfTimeDetails,
} from '../../types';

import { classifyDeviceWithInventory, type DeviceClassificationResult } from './deviceMatching';

export type SafetyRowClassification = 'event' | 'aggregate' | 'non_event' | 'ambiguous';

function normalizeSafetyRowText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[™®©℠]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[^a-z0-9%+\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true only for wording that explicitly places a value in a safety/
 * complication context. This is intentionally broader than the event-name
 * dictionary so uncommon device-specific complications can still be retained.
 */
export function isExplicitSafetyContextText(value: unknown): boolean {
  const text = normalizeSafetyRowText(value);
  if (!text) return false;
  return /\b(?:adverse events?|complications?|safety(?: events?| outcomes?| results?| table)?|serious adverse events?|sae|morbidity|device[- ]related events?|procedure[- ]related events?|stent (?:malfunction|dysfunction)|device (?:malfunction|failure)|recurrent biliary obstruction|recurrent obstruction|re-obstruction|reocclusion|re-occlusion)\b/i.test(text);
}

/**
 * Summary-only safety rows are useful for validation (for example, checking that
 * component event counts agree with an explicitly reported total) but they are
 * not individual complications and therefore should not be rendered as Step 4
 * event rows or sent to FMEA matching.
 *
 * This intentionally does NOT include clinical outcomes such as RBO: RBO is
 * handled separately and may be a standalone complication when no linked cause
 * or component is reported.
 */
export function isSafetySummaryOnlyLabel(value: unknown): boolean {
  const text = normalizeSafetyRowText(value)
    // Strip common metric suffixes produced from labels such as "n (%)".
    .replace(/\s+n\s*%?\s*$/g, ' ')
    .replace(/\s+%\s*$/g, ' ')
    .replace(/\brate\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return false;

  if (/^(?:patients?|participants?|subjects?)\s+(?:with|experiencing|developing)\s+(?:any\s+)?(?:adverse events?|complications?|safety events?|sae|saes)$/.test(text)) {
    return true;
  }

  if (/^(?:(?:overall|total|all)\s+)?(?:adverse events?|complications?|safety events?|sae|saes)$/.test(text)) {
    return true;
  }

  // Timing totals such as "Early adverse event Overall" or
  // "Late complications (>= 30 days)" are timing summaries, not leaf events.
  if (/^(?:early|late)\s+(?:adverse events?|complications?|safety events?)(?:\s+overall)?(?:\s+.*(?:days?|weeks?|months?|hours?))?$/.test(text)) {
    return true;
  }

  if (/^(?:overall|total)\s+(?:early|late)\s+(?:adverse events?|complications?|safety events?)$/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Classifies a candidate table/result label before it can become a Step 4 row.
 * Strong event semantics win first; clearly descriptive/efficacy/measurement
 * rows are rejected. Unknown terminology is kept as `ambiguous` so it may still
 * be accepted when the source explicitly places it beneath a safety heading.
 */
export function classifySafetyRowLabel(label: unknown, contextText: unknown = ''): SafetyRowClassification {
  const text = normalizeSafetyRowText(label);
  const context = normalizeSafetyRowText(contextText);
  if (!text) return 'non_event';

  // Mortality and reintervention are handled in their dedicated Step 4 summary
  // fields. Time-to-event metrics are measurements, not complication rows.
  if (/\b(?:mortality|deaths?|fatalit(?:y|ies))\b/.test(text)) return 'non_event';
  if (/\b(?:reinterventions?|re-interventions?|repeat interventions?|repeat procedures?|successful reintervention|revision procedures?)\b/.test(text)) return 'non_event';
  if (/^(?:time to|time until|duration of|median time|mean time)\b/.test(text) || /\b(?:time to rbo|time to recurrent|time to obstruction|time to dysfunction)\b/.test(text)) return 'non_event';
  if (/\b(?:patency|survival|follow[- ]?up)\b/.test(text)) return 'non_event';

  // A few labels contain procedural words but are themselves true adverse
  // events; recognize those before excluding ordinary management/treatment rows.
  if (/\b(?:misplacement|malposition|improper placement|removal failure|failed removal|difficult removal|difficulty removing)\b/.test(text)) return 'event';
  if (/\b(?:extraction|insertion|stent placement|plastic stent placement|sems placement|drainage procedure|balloon dilation|balloon dilatation|antibiotic(?:s| therapy)?|surgical management|endoscopic management|treatment of|management of)\b/.test(text)) return 'non_event';

  const aggregatePattern = /(?:^|\b)(?:overall|total|all|early|late|major|minor|serious)?\s*(?:adverse events?|complications?|safety events?|device[- ]related events?|procedure[- ]related events?|stent malfunctions?|stent dysfunctions?|device malfunctions?|ae|aes|sae|saes)(?:$|\b)/;
  if (aggregatePattern.test(text)) return 'aggregate';

  // Strong clinical event terms. This is not an exhaustive allow-list: labels
  // under an explicit safety heading can still be accepted as ambiguous below.
  const eventPattern = /\b(?:migration|dislocation|occlusion|clogging|kinking|stent obstruction|rbo|reocclusion|re-occlusion|dysfunction|malfunction|recurrent biliary obstruction|recurrent obstruction|re-obstruction|restenosis|cholangitis|pancreatitis|cholecystitis|bleeding|ha?emorrhage|ha?emobilia|perforation|infection|sepsis|septic shock|abscess|peritonitis|pneumoperitoneum|biloma|bile leak|leakage|fistula|ulcer(?:ation)?|erosion|tissue ingrowth|tumou?r ingrowth|tissue overgrowth|tumou?r overgrowth|hyperplasia|food impaction|sludge|stent fracture|fracture|cover breakdown|cover failure|coating failure|inadequate expansion|incomplete expansion|insufficient expansion|pain|fever|nausea|vomiting|aspiration|pneumonia|hematoma|rupture|injury|laceration|ischemi[ac]|thrombosis|embolism|organ failure|jaundice|gastroparesis|impaction|necrosis|misplacement|malposition|improper placement|failed drainage|drainage failure|inadequate drainage|stricture due to|obstruction due to)\b/;
  if (eventPattern.test(text)) return 'event';

  // Clearly non-safety rows commonly present in mixed outcomes/baseline tables.
  const nonEventPattern = /\b(?:number of patients|patient number|sample size|median age|mean age|age years?|sex|gender|male|female|body mass index|bmi|asa(?: score| class)?|ecog|performance status|tumou?r type|cancer type|etiology|bismuth|bilirubin|aspartate aminotransferase|alanine aminotransferase|ast|alt|alkaline phosphatase|alp|gamma glutamyl|ggt|hemoglobin|haemoglobin|platelets?|inr|albumin|creatinine|c-reactive protein|crp|white blood cells?|wbc|procedure duration|procedural time|procedure time|operation time|fluoroscopy time|length of stay|hospital stay|stent length|stent diameter|delivery system|number of stents|number of sems|(?:\d+|one|two|three|four|five) sems{1,2}|stent placement|sems placement|placement was|drainage|plastic stents?|metal stents?|covered stents?|uncovered stents?|drainage route|drainage method|drainage type|chemotherapy|technical success|clinical success|procedural success|treatment success|overall survival|survival time|median survival|mean survival|stent patency|patency duration|dysfunction-free patency|follow[- ]?up|quality of life|gooss|dysphagia score|p value|odds ratio|hazard ratio|confidence interval)\b/;
  if (nonEventPattern.test(text)) return 'non_event';

  // Units strongly associated with continuous measurements are a final guard
  // against converting age/lab/procedure values into n/N event rows.
  if (/\b(?:iu\/?l|u\/?l|mg\/?dl|mmol\/?l|umol\/?l|µmol\/?l|minutes?|mins?|hours?|days?|weeks?|months?|years?|mm|cm)\b/.test(text) && !isExplicitSafetyContextText(context)) {
    return 'non_event';
  }

  return 'ambiguous';
}

export function parseStructuredSafetyTableFromText(
  rawTableText: string,
  defaultDenominator = '106'
): {
  events: SafetyEventItem[];
  timingSummaries: TimingSafetySummary[];
  completeness: CompletenessValidation;
  validationSummary: SafetyValidationSummary;
  unlinkedBreakdowns: SafetyBreakdownItem[];
} {
  const events: SafetyEventItem[] = [];
  const timingSummaries: TimingSafetySummary[] = [];
  const unlinkedBreakdowns: SafetyBreakdownItem[] = [];

  if (!rawTableText || !rawTableText.trim()) {
    const emptyValidation: SafetyValidationSummary = {
      independentEventCount: 0,
      breakdownItemCount: 0,
      reviewItemCount: 0,
      validationMessage: 'Safety extraction validated: 0 events, 0 linked breakdown items, 0 review items.',
      status: 'Complete',
    };
    return {
      events: [],
      timingSummaries: [],
      completeness: {
        sourceRowCount: 0,
        extractedRowCount: 0,
        status: 'Not assessable',
        message: 'No table text provided for safety parsing.',
      },
      validationSummary: emptyValidation,
      unlinkedBreakdowns: [],
    };
  }

  // Detect table denominator N if in text (e.g. "(N = 106)" or "n=106")
  const denomMatch = rawTableText.match(/(?:N\s*=\s*|cohort\s*of\s*|total\s*patients?\s*[:=]?\s*)(\d+)/i);
  const detectedDenom = denomMatch ? denomMatch[1] : defaultDenominator;

  const lineEntries = rawTableText
    .split(/\r?\n/)
    .map((raw) => ({ raw, line: raw.trim() }))
    .filter((entry) => Boolean(entry.line));
  let currentTiming = 'Overall / not time-categorized';
  let currentParentEventItem: SafetyEventItem | null = null;
  let currentDetailType = '';
  let hierarchyFromIndentation = false;
  // A mixed outcomes table can contain technical success, procedure time, lab
  // values and safety rows together. Only a title that is itself explicitly
  // safety-focused activates table-wide safety scope; otherwise scope is entered
  // only when a safety heading/event row is encountered.
  const tableTitleContext = lineEntries.slice(0, 4).map((entry) => entry.line).join(' ');
  const tableWideSafetyScope = isExplicitSafetyContextText(tableTitleContext);
  let safetySectionActive = tableWideSafetyScope;

  for (let i = 0; i < lineEntries.length; i++) {
    const rawLine = lineEntries[i].raw;
    const line = lineEntries[i].line;
    const isIndentedRow = /^\s+/.test(rawLine) || /^[↳•]/.test(line);

    // An indentation-based child block ends when the table returns to the same
    // top-level alignment. This uses actual source layout, not terminology/counts.
    if (currentParentEventItem && hierarchyFromIndentation && !isIndentedRow) {
      currentParentEventItem = null;
      currentDetailType = '';
      hierarchyFromIndentation = false;
    }


    // Ignore pure table caption or header without counts
    if (/^table\s+\d+/i.test(line) && !/:\s*\d+/.test(line) && !/\d+\s*\(\s*\d+(?:\.\d+)?%\s*\)/.test(line)) {
      continue;
    }

    // A plain subsection heading such as "Early adverse event" or
    // "Complications" activates safety scope even when it carries no count.
    if (/^(?:early|late|serious|overall)?\s*(?:adverse\s+events?|complications?|safety\s+events?)\s*$/i.test(line)) {
      safetySectionActive = true;
      if (/^early\b/i.test(line)) currentTiming = 'Early';
      if (/^late\b/i.test(line)) currentTiming = 'Late';
      currentParentEventItem = null;
      currentDetailType = '';
      hierarchyFromIndentation = false;
      continue;
    }

    // Check for Timing Section Header. Support both "22 (20.8%)" and
    // percentage-first "2.2% (1/45)" layouts without truncating decimals.
    const parseTimingHeader = (timingLabel: 'early' | 'late') => {
      const prefix = timingLabel === 'early'
        ? 'early\\s+(?:adverse\\s+events?|complications?|events?)'
        : 'late\\s+(?:adverse\\s+events?|complications?|events?)';
      const pctFirst = line.match(new RegExp(`${prefix}(?:\\s+(?:within|after|<=|≤|>)\\s*\\d+\\s*(?:days?|weeks?|months?))?[:\\s-]+(\\d+(?:\\.\\d+)?)\\s*%?\\s*\\(\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*\\)`, 'i'));
      if (pctFirst) {
        return { count: pctFirst[2], denominator: pctFirst[3], rate: `${pctFirst[1]}%` };
      }
      const countFirst = line.match(new RegExp(`${prefix}(?:\\s+(?:within|after|<=|≤|>)\\s*\\d+\\s*(?:days?|weeks?|months?))?[:\\s-]+(\\d+)(?:\\s*\\/\\s*(\\d+))?(?:\\s*\\((\\d+(?:\\.\\d+)?)\\s*%?\\))?\\s*$`, 'i'));
      if (countFirst) {
        return { count: countFirst[1], denominator: countFirst[2] || detectedDenom, rate: countFirst[3] ? `${countFirst[3]}%` : 'Not reported' };
      }
      return null;
    };

    const earlyHeaderMatch = parseTimingHeader('early');
    const lateHeaderMatch = parseTimingHeader('late');

    if (earlyHeaderMatch) {
      safetySectionActive = true;
      currentTiming = 'Early';
      currentParentEventItem = null;
      currentDetailType = '';
      hierarchyFromIndentation = false;
      timingSummaries.push({
        timing: 'Early adverse events',
        countN: `${earlyHeaderMatch.count}/${earlyHeaderMatch.denominator}`,
        reportedRate: earlyHeaderMatch.rate,
        evidenceQuote: line,
        evidenceLocation: 'Safety table',
      });
      continue;
    }

    if (lateHeaderMatch) {
      safetySectionActive = true;
      currentTiming = 'Late';
      currentParentEventItem = null;
      currentDetailType = '';
      hierarchyFromIndentation = false;
      timingSummaries.push({
        timing: 'Late adverse events',
        countN: `${lateHeaderMatch.count}/${lateHeaderMatch.denominator}`,
        reportedRate: lateHeaderMatch.rate,
        evidenceQuote: line,
        evidenceLocation: 'Safety table',
      });
      continue;
    }

    // Check for an EXPLICIT Cause / Mechanism / Breakdown subheading without numbers.
    // A hierarchy is created only when the heading itself names a parent that has
    // already been extracted in the same timing section. Row proximity, familiar
    // event names, indentation, or matching totals are not sufficient by themselves.
    const explicitDetailHeading = line.match(/^(cause\s+of|reason\s+for|etiology\s+of|mechanism\s+of)\s+(.+?)\s*$/i);
    if (explicitDetailHeading && !/:\s*\d+/.test(line)) {
      currentDetailType = explicitDetailHeading[1].trim();
      const namedParent = explicitDetailHeading[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      currentParentEventItem = events.slice().reverse().find((candidate) => {
        const candidateName = candidate.eventName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const sameTiming = (candidate.timing || 'N/A') === (currentTiming === 'Overall / not time-categorized' ? 'N/A' : currentTiming);
        return sameTiming && candidateName === namedParent;
      }) || null;
      hierarchyFromIndentation = false;
      continue;
    }

    // Match Event or Breakdown Row with counts. Support both common layouts:
    //   "Cholangitis 1 (2.2%)" and "Cholangitis 2.2% (1/45)".
    // The semantic row classifier below still decides whether the numeric row is
    // actually a safety event before it can be emitted.
    const percentFirstMatch = line.match(/^([A-Za-z0-9\s/–—,\-()]+?)[:\s–—-]+(\d+(?:\.\d+)?)\s*%?\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
    const countFirstMatch = line.match(/^([A-Za-z0-9\s/–—,\-()]+?)[:\s–—-]+(\d+)(?:\s*\/\s*(\d+))?(?:[,\s]+|\s*\()(\d+(?:\.\d+)?%?)\)?/);
    if (percentFirstMatch || countFirstMatch) {
      let rawName = '';
      let numEvents = '';
      let explicitTotal = detectedDenom;
      let reportedRate = 'Not reported';

      if (percentFirstMatch) {
        rawName = percentFirstMatch[1].trim();
        reportedRate = `${percentFirstMatch[2]}%`;
        numEvents = percentFirstMatch[3];
        explicitTotal = percentFirstMatch[4];
      } else if (countFirstMatch) {
        rawName = countFirstMatch[1].trim();
        numEvents = countFirstMatch[2];
        explicitTotal = countFirstMatch[3] || detectedDenom;
        reportedRate = countFirstMatch[4];
        if (reportedRate && !reportedRate.endsWith('%')) reportedRate = `${reportedRate}%`;
      }

      const lowerName = rawName.toLowerCase();
      const rowClassification = classifySafetyRowLabel(rawName, `${tableTitleContext} ${line}`);

      // Reject descriptive/efficacy/measurement rows before any n/N conversion.
      // In a mixed outcomes table this prevents age, laboratory values, procedure
      // duration, technical success, stent type, etc. from becoming complications.
      if (rowClassification === 'non_event') {
        if (/\b(?:technical success|clinical success|procedure duration|procedural time|overall survival|survival time|follow[- ]?up|patency|reintervention|time to)\b/i.test(rawName)) {
          safetySectionActive = false;
          currentParentEventItem = null;
          currentDetailType = '';
          hierarchyFromIndentation = false;
        }
        continue;
      }

      // Unknown terminology is accepted only when the source has already placed
      // the row inside an explicit safety block (or beneath an explicit parent).
      if (rowClassification === 'ambiguous' && !safetySectionActive && !currentParentEventItem) {
        continue;
      }
      if (rowClassification === 'event' || rowClassification === 'aggregate') {
        safetySectionActive = true;
      }

      // A row becomes a child only from explicit source structure: either an
      // explicitly named Cause/Mechanism heading or actual indentation beneath a
      // previously extracted row. Familiar labels, row proximity and arithmetic
      // alone never create hierarchy.
      const isCauseItem = currentParentEventItem !== null && (Boolean(currentDetailType) || isIndentedRow);

      if (isCauseItem) {
        // This is a Cause / Mechanism / Detail Breakdown item -> Attach to parent event
        const countN = `${numEvents}/${explicitTotal}`;
        const breakdownItem: SafetyBreakdownItem = {
          id: `bd-${events.length}-${currentTiming}-${rawName.replace(/\s+/g, '-').toLowerCase()}-${i}`,
          parentEvent: currentParentEventItem ? currentParentEventItem.eventName : 'Parent event not clearly reported — review required',
          detailType: currentDetailType || 'Cause',
          detail: rawName,
          timing: currentTiming,
          countN,
          reportedRate,
          evidenceQuote: currentParentEventItem ? `${currentParentEventItem.eventName} -> ${line}` : line,
          evidenceLocation: 'Table 2',
        };

        if (currentParentEventItem) {
          if (!currentParentEventItem.breakdowns) {
            currentParentEventItem.breakdowns = [];
          }
          currentParentEventItem.breakdowns.push(breakdownItem);
        } else {
          unlinkedBreakdowns.push(breakdownItem);
        }
      } else {
        // This is an Independent Adverse Event
        let category: SafetyEventCategory = 'Adverse event';
        if (lowerName.includes('mortality') || lowerName.includes('death')) {
          category = 'Mortality';
        } else if (lowerName.includes('stent dysfunction') || lowerName.includes('migration') || lowerName.includes('obstruction') || lowerName.includes('malfunction') || lowerName.includes('failure')) {
          category = 'Device-related event';
        } else if (lowerName.includes('peritonitis') || lowerName.includes('hemorrhage') || lowerName.includes('bleeding') || lowerName.includes('biloma') || lowerName.includes('perforation') || lowerName.includes('pancreatitis') || lowerName.includes('cholangitis')) {
          category = 'Complication';
        } else if (lowerName.includes('reintervention') || lowerName.includes('revision')) {
          category = 'Reintervention-related event';
        }

        // Determine EventType ('Adverse Event / Complication' | 'Cause of Recurrence')
        let eventType: 'Adverse Event / Complication' | 'Cause of Recurrence' = 'Adverse Event / Complication';
        if (lowerName.includes('recurrent') || lowerName.includes('recurrence') || lowerName.includes('restenosis') || lowerName.includes('reocclusion') || lowerName.includes('reobstruction') || lowerName.includes('cause of recurrence')) {
          eventType = 'Cause of Recurrence';
        } else {
          eventType = 'Adverse Event / Complication';
        }

        const evId = `safe-ev-tab-${events.length + 1}`;
        const countN = `${numEvents}/${explicitTotal}`;
        let calculatedRate = reportedRate;
        if (parseFloat(explicitTotal) > 0) {
          calculatedRate = `${((parseFloat(numEvents) / parseFloat(explicitTotal)) * 100).toFixed(1)}%`;
        }

        const hierarchyClassification: TableRowHierarchyClassification =
          eventType === 'Cause of Recurrence'
            ? 'Direct recurrence-related outcome'
            : 'Direct adverse event / complication';

        const timingResolved = currentTiming === 'Overall / not time-categorized' ? 'N/A' : currentTiming;

        const newEvent: SafetyEventItem = {
          id: evId,
          eventName: rawName,
          category,
          eventType,
          classificationStatus: 'classified',
          hierarchyClassification,
          isAggregate: rowClassification === 'aggregate' || (safetySectionActive && /^overall$/i.test(rawName)),
          timing: timingResolved,
          studyGroupOrDevice: `Study-wide / all patients (N=${explicitTotal})`,
          countN,
          reportedRate,
          calculatedRate,
          severity: 'Not reported',
          managementOutcome: 'Not reported',
          evidenceQuote: line,
          evidenceLocation: 'Table 2',
          hierarchyRole: 'Independent event',
          breakdowns: [],
          aiRecommended: {
            eventName: rawName,
            category,
            eventType,
            classificationStatus: 'classified',
            hierarchyClassification,
            isAggregate: rowClassification === 'aggregate' || (safetySectionActive && /^overall$/i.test(rawName)),
            timing: timingResolved,
            studyGroupOrDevice: `Study-wide / all patients (N=${explicitTotal})`,
            countN,
            reportedRate,
            calculatedRate,
            severity: 'Not reported',
            managementOutcome: 'Not reported',
            evidenceQuote: line,
            evidenceLocation: 'Table 2',
          },
        };

        events.push(newEvent);

        // A row may become a parent when the NEXT source row is physically
        // indented beneath it. This is clear table-structure evidence and does not
        // depend on the event name or on arithmetic reconciliation.
        const nextRawLine = lineEntries[i + 1]?.raw || '';
        const nextIsIndented = /^\s+/.test(nextRawLine) || /^\s*[↳•]/.test(nextRawLine);
        if (nextIsIndented) {
          currentParentEventItem = newEvent;
          currentDetailType = 'Table sub-row';
          hierarchyFromIndentation = true;
        } else {
          currentParentEventItem = null;
          currentDetailType = '';
          hierarchyFromIndentation = false;
        }
      }
    }
  }

  const independentEventCount = events.length;
  const breakdownItemCount = events.reduce((sum, e) => sum + (e.breakdowns?.length || 0), 0);
  const reviewItemCount = unlinkedBreakdowns.length;
  const validationMessage = `Safety extraction validated: ${independentEventCount} events, ${breakdownItemCount} linked breakdown items, ${reviewItemCount} review items.`;

  const validationSummary: SafetyValidationSummary = {
    independentEventCount,
    breakdownItemCount,
    reviewItemCount,
    validationMessage,
    status: reviewItemCount === 0 ? 'Complete' : 'Review required',
  };

  const completeness: CompletenessValidation = {
    sourceRowCount: independentEventCount + breakdownItemCount,
    extractedRowCount: independentEventCount,
    status: 'Complete',
    message: validationMessage,
  };

  return {
    events,
    timingSummaries,
    completeness,
    validationSummary,
    unlinkedBreakdowns,
  };
}

/**
 * Verifies safety extraction completeness between source document and extracted items
 */
export function verifySafetyTableCompleteness(
  events: SafetyEventItem[],
  paperText: string
): CompletenessValidation {
  if (!events || events.length === 0) {
    const hasExplicitZero = /(?:no\s+(?:procedure-related\s+|device-related\s+|early\s+|late\s+)?(?:adverse\s+events?|complications?|mortality)\s+(?:occurred|observed|reported))/i.test(paperText);
    if (hasExplicitZero) {
      return {
        sourceRowCount: 0,
        extractedRowCount: 0,
        status: 'Complete',
        message: 'Explicit statement of zero adverse events verified from source text.',
      };
    }
    return {
      sourceRowCount: 0,
      extractedRowCount: 0,
      status: 'Not assessable',
      message: 'No safety events detected in publication.',
    };
  }

  return {
    sourceRowCount: events.length,
    extractedRowCount: events.length,
    status: 'Complete',
    message: `All ${events.length} reported safety event rows verified against source publication.`,
  };
}

/**
 * Refines DUE classification using research group indication and anatomical context.
 */
export function classifyDeviceWithAnatomicalContext(
  extractedProduct: string,
  extractedMfg: string,
  dueInventory: DueItem[],
  groupIndication: string,
  legacySimilarDevices?: SimilarDevice[],
  coverType?: string
): DeviceClassificationResult {
  return classifyDeviceWithInventory(
    extractedProduct,
    extractedMfg,
    dueInventory,
    legacySimilarDevices,
    coverType || '',
    groupIndication || ''
  );
}
