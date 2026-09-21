import { explicitOutcomeTables } from '../../src/utils/nlp/explicitOutcomeTables';
import { extractReinterventionNarrative } from './reinterventionNarrative';
import {
  parseStructuredSafetyTableFromText,
  verifySafetyTableCompleteness,
} from '../../src/utils/nlpRules';
import {
  assessSafetyPercentage,
  applyGeneralSafetyHierarchy,
  type SafetyHierarchyRelationship,
  type SafetyHierarchyConfidence,
} from './safetyProcessing';
import { callGeminiWithRetry } from './geminiClient';
import { sanitizeSafetyEventCandidates, mergeSafetyEventCandidates, collapseDuplicateSafetyEventCandidates } from './safetyEventValidation';
import {
  extractMarkdownSafetyEvidence,
  reconcileSafetyCandidatesWithMarkdown,
} from './markdownSafetyEvidence';
import type { PreparedAnalysisContext } from './prepareAnalysisContext';

/** Stage 4: safety events, mortality, reintervention and completeness processing. */
export async function buildSafetyResult(ctx: PreparedAnalysisContext): Promise<any> {
  const {
    res,
    paperText,
    markdownText,
    documentContentParts,
    ai,
    parsedAi,
    articleMetadata,
    isMissingExtractedValue,
    researchGroups,
  } = ctx;
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

  // Step 4 must be grounded in the CURRENT study only. Discussion/reference
  // comparisons are intentionally excluded before any safety presence checks or
  // deterministic rescue logic are run.
  const currentStudySafetyText = (() => {
    const source = String(paperText || '');
    const resultsMatch = source.match(/(?:^|\n)\s*(?:\d+\.?\s*)?results\s*(?:\n|$)([\s\S]*?)(?=(?:\n\s*(?:\d+\.?\s*)?(?:discussion|conclusion|conclusions|references)\b)|$)/i);
    if (resultsMatch?.[1]) return resultsMatch[1];
    return source.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || source;
  })();

  const explicitRows = explicitOutcomeTables(paperText, researchGroups);
  // Recover only rows inside a source-defined adverse-event block.
  let safetyBlock = false;
  let safetyTable = '';
  for (const row of explicitRows) {
    if (row.location !== safetyTable) { safetyBlock = false; safetyTable = row.location; }
    if (/^Adverse events\b/i.test(row.label)) { safetyBlock = true; continue; }
    if (/^(?:RBO|Cumulative|Re-?intervention|Technical success|Overall survival)\b/i.test(row.label)) safetyBlock = false;
    if (!safetyBlock) continue;
    const population = explicitRows.find(r => r.location === row.location && r.label === 'Number of patients');
    researchGroups.forEach((group: any, index: number) => {
      const column = row.groupColumns[index];
      if (column === undefined) return;
      const metric = row.cells[column].match(/^(\d+)(?:\s*\(([0-9.]+)\))?$/);
      if (!metric) return;
      rawSafetyEvents = rawSafetyEvents.filter(event => !(
        String(event.eventName || '').toLowerCase() === row.label.toLowerCase() &&
        (event.groupId === group.id || event.groupName === group.groupName)));
      rawSafetyEvents.push({eventName: row.label, eventType: 'Adverse Event / Complication',
        groupId: group.id, groupName: group.groupName, numerator: metric[1],
        denominator: population?.cells[column] || 'Not reported',
        reportedPercentage: metric[2] ? `${metric[2]}%` : 'Not reported',
        numeratorType: 'patients', denominatorType: 'patients', timing: 'Not reported',
        evidenceQuote: row.quote, evidenceLocation: row.location});
    });
  }

  const initialSafetyValidation = sanitizeSafetyEventCandidates(rawSafetyEvents, {
    paperText: currentStudySafetyText,
    totalPatientCount: articleMetadata.totalPatientCount,
    researchGroups,
  });
  rawSafetyEvents = initialSafetyValidation.events;
  if (initialSafetyValidation.rejected.length > 0) {
    console.log(`[Safety] Rejected ${initialSafetyValidation.rejected.length} non-safety/invalid candidate rows before Step 4 processing.`);
  }

  // Markdown Safety layer: use only confident CURRENT-STUDY tables. This does
  // not replace the PDF/Gemini extraction. It validates matching rows and
  // supplements events/reinterventions that the PDF text flattening missed.
  // Uncertain or literature-comparison tables are intentionally ignored.
  const markdownSafetyEvidence = extractMarkdownSafetyEvidence(
    markdownText || '',
    researchGroups,
    articleMetadata.totalPatientCount
  );
  const markdownSafetyValidation = sanitizeSafetyEventCandidates(markdownSafetyEvidence.events, {
    paperText: currentStudySafetyText,
    totalPatientCount: articleMetadata.totalPatientCount,
    researchGroups,
  });
  if (markdownSafetyValidation.events.length > 0) {
    rawSafetyEvents = reconcileSafetyCandidatesWithMarkdown(rawSafetyEvents, markdownSafetyValidation.events, researchGroups);
    console.log(`[Safety][Markdown] ${markdownSafetyValidation.events.length} validated event row(s) from ${markdownSafetyEvidence.trustedSafetyTableCount} confident safety table(s).`);
  }
  if (markdownSafetyValidation.rejected.length > 0) {
    console.log(`[Safety][Markdown] Rejected ${markdownSafetyValidation.rejected.length} invalid/non-safety Markdown row(s).`);
  }

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
  const hasPositiveSafetyEvidence = positiveSafetyEvidencePatterns.some((pattern) => pattern.test(currentStudySafetyText));
  const hasExplicitNoOverallEventMatch = explicitNoOverallEventPattern.test(currentStudySafetyText);
  const hasExplicitNoMortalityMatch = explicitNoMortalityPattern.test(currentStudySafetyText);
  const isExplicitNoEventsReported =
    rawSafetyEvents.length === 0 &&
    hasExplicitNoOverallEventMatch &&
    !hasPositiveSafetyEvidence;

  // Check for actual complication/safety-event evidence in CURRENT-STUDY text.
  // Mortality or reintervention alone does not force creation of a complication row.
  const hasSafetyMention = /(?:adverse\s+events?|complications?|adverse\s+effects?|early\s+complications?|late\s+complications?|stent\s+malfunction|device\s+malfunction|morbidity|procedure-related\s+events?|treatment-related\s+events?|serious\s+adverse\s+events?|sae|recurrent\s+(?:biliary\s+)?obstruction|re-obstruction|stent\s+dysfunction|stent\s+occlusion|migration|perforation|pancreatitis|cholangitis|cholecystitis|bleeding|ha?emorrhage|infection|sepsis)/i.test(currentStudySafetyText);

  // Perform corrective retry for safety if safety is mentioned but 0 events found and not explicitly no events
  let safetyRetryAttempt = 0;
  const maxSafetyRetries = 1;
  while (rawSafetyEvents.length === 0 && hasSafetyMention && !isExplicitNoEventsReported && safetyRetryAttempt < maxSafetyRetries) {
    safetyRetryAttempt++;
    console.log(`[Gemini API] Warning: 0 safety events extracted despite safety mentions. Performing safety corrective retry ${safetyRetryAttempt}/${maxSafetyRetries}...`);

    const safetyRetryPrompt = [
      ...documentContentParts,
      {
        text: `[SAFETY CORRECTIVE RETRY (Attempt ${safetyRetryAttempt})]: The CURRENT-STUDY Results/Tables contain complication or adverse-event evidence, but the previous response returned 0 valid safety events. Re-examine ONLY true event rows (e.g., stent occlusion, migration, insufficient expansion, cholangitis, pancreatitis, perforation, bleeding, infection). DO NOT turn baseline/demographic rows, laboratory values, procedure duration, stent/device characteristics, technical/clinical success, patency/survival/follow-up, time-to-event metrics, reintervention rows, or mortality/death into complication rows. In mixed outcome tables, extract only the safety-event subsection/rows. Pair numerator/denominator/percentage only from the same event row/column and its explicit header/footnote; if the denominator is not safely known, use Not reported instead of guessing. Do not output a patient-based n/N with n>N unless the source explicitly says the numerator is events/episodes/procedures or allows multiple events per patient. Mortality belongs only in overallMortality/group mortality summary fields; reintervention belongs only in the reintervention summary. Return valid JSON with 'safetyEventsExtract' containing 'events' array with required fields: eventName, eventType ('Adverse Event / Complication' or 'Cause of Recurrence'), timing, groupName, deviceName, numerator, denominator, reportedPercentage, numeratorType ('patients'|'events'|'procedures'|'episodes'|'unknown'), denominatorType ('patients'|'events'|'procedures'|'episodes'|'unknown'), multipleEventsPerPatient ('Yes'|'No'|'Not reported'|'Unclear'), percentageContextQuote, percentageContextLocation, parentEvent, isSubItem, relationshipType ('none'|'component'|'cause'|'unclear'), isAggregate, hierarchyEvidenceType ('explicit_text'|'table_structure'|'both'|'none'), hierarchyEvidenceQuote, hierarchyEvidenceLocation, hierarchyConfidence ('High'|'Low'), hierarchyReason, breakdownCompleteness ('Complete'|'Partial'|'Unknown'), classificationStatus ('classified'|'review_required'), evidenceQuote, evidenceLocation, linkedRecurrenceCause. Reconstruct hierarchy ONLY from explicit current-study wording or clearly structured table hierarchy. Row proximity and matching arithmetic totals are validation clues only and MUST NOT create a relationship. If uncertain, keep the row flat and mark review_required. Preserve paper-reported percentages verbatim.`
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
          const retryValidation = sanitizeSafetyEventCandidates(retryEvents, {
            paperText: currentStudySafetyText,
            totalPatientCount: articleMetadata.totalPatientCount,
            researchGroups,
          });
          if (retryValidation.events.length > 0) {
            rawSafetyEvents = retryValidation.events;
            console.log(`[Gemini API] Safety corrective retry ${safetyRetryAttempt} succeeded with ${rawSafetyEvents.length} validated events.`);
            break;
          }
          console.log(`[Safety] Corrective retry returned only non-safety/invalid rows (${retryValidation.rejected.length} rejected).`);
        }
      }
    } catch (err: any) {
      console.log(`[Gemini API] Safety corrective retry ${safetyRetryAttempt} failed: ${err.message}`);
    }
  }

  // Deterministic structured-table rescue is intentionally conservative. The
  // legacy parser has no reliable way to map multiple table columns to multiple
  // study arms, so it is used only for single-group/study-wide tables. Any rows
  // it proposes must still pass the same safety-row validation gate as Gemini.
  let parsedTableData: ReturnType<typeof parseStructuredSafetyTableFromText> | null = null;
  if (researchGroups.length <= 1) {
    const tableBlocks = currentStudySafetyText.match(/(?:^|\n)\s*table\s+\d+[a-z]?\b[\s\S]*?(?=(?:\n\s*table\s+\d+[a-z]?\b)|$)/gi) || [];
    const denom = articleMetadata.totalPatientCount !== 'Not reported'
      ? articleMetadata.totalPatientCount
      : researchGroups[0]?.groupPatientNumber || 'Not reported';

    let bestCandidate: ReturnType<typeof parseStructuredSafetyTableFromText> | null = null;
    let bestValidatedEvents: any[] = [];
    for (const block of tableBlocks) {
      if (!/(?:adverse\s+events?|complications?|stent\s+(?:dysfunction|malfunction|occlusion|migration)|recurrent\s+(?:biliary\s+)?obstruction|pancreatitis|cholangitis|bleeding|perforation)/i.test(block)) continue;
      const candidate = parseStructuredSafetyTableFromText(block, String(denom));
      const candidateValidation = sanitizeSafetyEventCandidates(candidate.events, {
        paperText: currentStudySafetyText,
        totalPatientCount: articleMetadata.totalPatientCount,
        researchGroups,
      });
      if (candidateValidation.events.length > bestValidatedEvents.length) {
        bestCandidate = candidate;
        bestValidatedEvents = candidateValidation.events;
      }
    }

    if (bestCandidate && bestValidatedEvents.length > 0) {
      parsedTableData = { ...bestCandidate, events: bestValidatedEvents as any };
    }
  }

  // Merge validated table rescue rows; never replace the entire AI extraction
  // just because the parser found more rows. Replacement was a major source of
  // false positives when mixed outcome tables contained age/labs/procedure data.
  if (parsedTableData && parsedTableData.events.length > 0) {
    rawSafetyEvents = mergeSafetyEventCandidates(rawSafetyEvents, parsedTableData.events, researchGroups);
    if (rawTimingSummaries.length === 0 && parsedTableData.timingSummaries.length > 0) {
      rawTimingSummaries = parsedTableData.timingSummaries;
    }
  }

  // Deterministic rescue for explicit positive narrative safety statements that can be
  // missed when a paper reports an event in prose rather than in a complete table.
  // Example: "Two mild cholangitis cases occurred ... in the control group." This
  // reads CURRENT-study text only and never imports events from Discussion/References.
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

  // Re-apply the confident Markdown reconciliation after all PDF/table/narrative
  // rescue paths so a later fallback cannot reintroduce a duplicate/conflicting
  // row that the structured Markdown table has already resolved.
  if (markdownSafetyValidation.events.length > 0) {
    rawSafetyEvents = reconcileSafetyCandidatesWithMarkdown(rawSafetyEvents, markdownSafetyValidation.events, researchGroups);
  }

  // Final safety gate after AI extraction, table rescue and narrative rescue.
  // This is intentionally repeated so no later rescue path can reintroduce a
  // baseline/laboratory/procedural row into the Step 4 complication list.
  const finalSafetyValidation = sanitizeSafetyEventCandidates(rawSafetyEvents, {
    paperText: currentStudySafetyText,
    totalPatientCount: articleMetadata.totalPatientCount,
    researchGroups,
  });
  // Final semantic de-duplication after ALL extraction/rescue paths. This is
  // deliberately after the final gate so duplicate PDF/Markdown rows with a
  // missing denominator or percentage collapse to the more complete row, while
  // genuinely conflicting counts remain separate for human review.
  rawSafetyEvents = collapseDuplicateSafetyEventCandidates(finalSafetyValidation.events, researchGroups);
  if (finalSafetyValidation.rejected.length > 0) {
    console.log(`[Safety] Final gate rejected ${finalSafetyValidation.rejected.length} non-safety/invalid candidate rows.`);
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
  const formatMarkdownReintervention = (entry: any) => {
    if (!entry) return 'Not reported';
    const n = String(entry.numerator || '').trim();
    const d = String(entry.denominator || '').trim();
    const pct = String(entry.percentage || '').trim();
    if (!n) return 'Not reported';
    if (d && !/not reported/i.test(d) && pct && !/not reported/i.test(pct)) return `${n}/${d} (${pct})`;
    if (d && !/not reported/i.test(d)) return `${n}/${d}`;
    if (pct && !/not reported/i.test(pct)) return `${n} (${pct})`;
    return n;
  };
  const studyWideMarkdownReintervention = markdownSafetyEvidence.reinterventions.find((entry: any) =>
    !entry.groupId && /study-wide|all patients/i.test(String(entry.groupName || ''))
  ) || (researchGroups.length === 1 ? markdownSafetyEvidence.reinterventions[0] : undefined);
  let overallReinterventionDueToEvent = rawSafety.overallReinterventionDueToEvent ||
    (studyWideMarkdownReintervention ? formatMarkdownReintervention(studyWideMarkdownReintervention) :
      (isExplicitNoEventsReported ? '0 (0%)' : 'Not reported'));

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

  // Prefer source-structured Markdown reintervention rows when they map to a
  // known research group. They are inserted before PDF-text fallbacks so the
  // latter only fill genuinely missing groups/timepoints. Conditional rows such
  // as "Reintervention after RBO" keep denominator=Not reported unless the
  // Markdown table explicitly supplied that denominator.
  markdownSafetyEvidence.reinterventions.forEach((entry: any) => {
    let groupIndex = researchGroups.findIndex((group: any) => entry.groupId && group.id === entry.groupId);
    if (groupIndex < 0 && researchGroups.length === 1) groupIndex = 0;
    if (groupIndex < 0) return;
    pushReinterventionMetric(groupIndex, {
      timing: entry.timing || 'Overall / not time-categorized',
      numerator: entry.numerator,
      denominator: entry.denominator || 'Not reported',
      percentage: entry.percentage || 'Not reported',
      percentageSource: entry.percentageSource === 'Reported' ? 'Reported' as const : 'Reported' as const,
      evidenceQuote: entry.evidenceQuote,
      evidenceLocation: `${entry.evidenceLocation} [Markdown]`,
      status: 'Reported' as const,
      markdownValidated: true,
    });
  });
  // Narrative Results fallback for papers that state re-intervention in prose rather
  // than a dedicated table row. Preserve every primary arm, not only the first DUE arm.
  const currentStudyReinterventionText = (() => {
    const resultsMatches = Array.from(normalizedSafetyText.matchAll(/(?:^|\n)\s*(?:\d+\.?\s*)?results\s*(?:\n|$)([\s\S]*?)(?=(?:\n\s*(?:\d+\.?\s*)?(?:discussion|conclusion|conclusions|references)\b)|$)/gi));
    const resultsMatch = resultsMatches.at(-1);
    if (resultsMatch?.[1]) return resultsMatch[1];
    return normalizedSafetyText.split(/(?:^|\n)\s*(?:\d+\.?\s*)?(?:discussion|references)\b/i)[0] || normalizedSafetyText;
  })();
  // Bind counts to explicit intervention actions, not nearby cohort totals.
  const narrativeReinterventions = extractReinterventionNarrative(currentStudyReinterventionText, researchGroups);

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

  // Named source columns override positional and MD reintervention guesses.
  const explicitReintervention = explicitRows.find(row => /^Re-?intervention\s*[, (]/i.test(row.label));
  if (explicitReintervention) {
    const population = explicitRows.find(row => row.location === explicitReintervention.location && row.label === 'Number of patients');
    researchGroups.forEach((_: any, index: number) => {
      const column = explicitReintervention.groupColumns[index];
      if (column === undefined) return;
      const metric = explicitReintervention.cells[column].match(/^(\d+)(?:\s*\(([0-9.]+)\))?$/);
      if (!metric) return;
      tableReinterventionMetricsByGroup[index] = [{numerator: metric[1], denominator: population?.cells[column] || 'Not reported',
        percentage: metric[2] ? `${metric[2]}%` : '', percentageSource: 'Reported', status: 'Reported',
        evidenceQuote: explicitReintervention.quote, evidenceLocation: explicitReintervention.location}];
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
    // A research group's stored name can carry a clarifying descriptor (e.g.
    // "Simultaneous group (side by side)") that the table's own column/row
    // header omits when the technique is already implied by contrast with the
    // other rows (the header just says "Simultaneous group"). Exact-key
    // equality then never finds that header line. Fall back to token-set
    // containment, only when it resolves to exactly one line.
    const tableGroupKeyMatchesLine = (groupKey: string, lineKey: string) => {
      if (groupKey === lineKey) return true;
      const groupTokens = new Set(groupKey.split(' ').filter(Boolean));
      const lineTokens = new Set(lineKey.split(' ').filter(Boolean));
      if (groupTokens.size === 0 || lineTokens.size === 0) return false;
      const isSubset = (small: Set<string>, big: Set<string>) => [...small].every((token) => big.has(token));
      return isSubset(groupTokens, lineTokens) || isSubset(lineTokens, groupTokens);
    };

    const tableChunks = normalizedSafetyText.split(/(?=\bTable\s+\d+\b)/i);
    for (const tableChunk of tableChunks) {
      if (!/Re-?interventions?/i.test(tableChunk)) continue;
      const tableLines = tableChunk
        .split(/\r?\n/)
        .map((line: string) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const groupLineIndices = researchGroups.map((group: any) => {
        const key = normalizeTableGroupKey(group.groupName);
        const exactIndex = tableLines.findIndex((line: string) => normalizeTableGroupKey(line) === key);
        if (exactIndex >= 0) return exactIndex;
        const containmentIndices = tableLines
          .map((line: string, index: number) => (tableGroupKeyMatchesLine(key, normalizeTableGroupKey(line)) ? index : -1))
          .filter((index: number) => index >= 0);
        return containmentIndices.length === 1 ? containmentIndices[0] : -1;
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
  // Whole-word containment fallback for when the AI echoes the group name
  // without a clarifying descriptor our researchGroups entry carries (e.g.
  // "Simultaneous group" vs "Simultaneous group (side by side)"). Comparing
  // whole tokens (not substrings) keeps "Covered SEMS" from matching
  // "Uncovered SEMS" the way naive substring matching would.
  const summaryGroupKeyMatches = (a: string, b: string) => {
    if (a === b) return true;
    const tokensA = new Set(a.split(' ').filter(Boolean));
    const tokensB = new Set(b.split(' ').filter(Boolean));
    if (tokensA.size === 0 || tokensB.size === 0) return false;
    const isSubset = (small: Set<string>, big: Set<string>) => [...small].every((token) => big.has(token));
    return isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA);
  };

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
        const byIdOrExactName = rawGroupSummaries.find(
          (summary: any) =>
            (summary.groupId && summary.groupId === matchedG.id) ||
            (summary.groupName && normalizeSummaryGroupKey(summary.groupName) === matchedKey)
        );
        const containmentCandidates = byIdOrExactName ? [] : rawGroupSummaries.filter(
          (summary: any) => summary.groupName && summaryGroupKeyMatches(normalizeSummaryGroupKey(summary.groupName), matchedKey)
        );
        const gs = byIdOrExactName || (containmentCandidates.length === 1 ? containmentCandidates[0] : {});

        const deterministicReinterventions = tableReinterventionMetricsByGroup[index] || [];
        const narrative = narrativeReinterventions.find(item => item.groupIndex === index);
        const reinterventions = narrative ? narrative.value : deterministicReinterventions.length > 1
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
          deviceName: matchedG.devices?.map((device: any) => device.deviceProductName).filter(Boolean).join(' / ') || gs.deviceName || 'Not reported',
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
            narrative?.evidenceQuote || deterministicEvidence?.evidenceQuote || gs.evidenceQuote || 'Not reported',
          evidenceLocation:
            (narrative ? 'Results narrative - Re-intervention' : '') || deterministicEvidence?.evidenceLocation || gs.evidenceLocation || 'Not reported',
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
    markdownEvidence: {
      available: Boolean(markdownText?.trim()),
      trustedSafetyTableCount: markdownSafetyEvidence.trustedSafetyTableCount,
      ignoredUncertainSafetyTableCount: markdownSafetyEvidence.ignoredUncertainSafetyTableCount,
      ignoredComparisonTableCount: markdownSafetyEvidence.ignoredComparisonTableCount,
      validatedEventRows: markdownSafetyValidation.events.length,
      reinterventionRows: markdownSafetyEvidence.reinterventions.length,
    },
  };

  return safety;
}
