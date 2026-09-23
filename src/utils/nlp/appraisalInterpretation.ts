import { extractCohortTableRows, cohortDisplayName } from './cohortTableEvidence';
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

export const ALL_ASPECTS_COVERED_OPTIONS = [
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
] as const;

/**
 * Automatically determine and check all relevant aspects covered based on comprehensive synthesis of
 * extracted performance/safety outcomes, research groups, remarks, quotes, and paper evidence without ungrounded guessing.
 */
export function determineAspectsCovered(
  extractedAspects: string[] | undefined,
  aspectsQuote: string | undefined,
  aspectsComment: string | undefined,
  researchGroups: ResearchGroup[] = [],
  methodologicalExtracts?: any,
  contributionExtracts?: any,
  safetyExtracts?: any,
  paperText: string = ''
): string[] {
  const selected = new Set<string>();

  // 1. Add any valid options extracted by AI
  if (Array.isArray(extractedAspects)) {
    for (const opt of extractedAspects) {
      if (!opt) continue;
      const match = ALL_ASPECTS_COVERED_OPTIONS.find(
        (vo) =>
          vo.toLowerCase() === opt.toLowerCase().trim() ||
          vo.toLowerCase().includes(opt.toLowerCase().trim()) ||
          opt.toLowerCase().trim().includes(vo.toLowerCase())
      );
      if (match) selected.add(match);
    }
  }

  // Combine all textual evidence context to check for grounded evidence
  const contextParts = [
    aspectsQuote || '',
    aspectsComment || '',
    researchGroups
      .map(
        (g: any) =>
          `${g.groupName || ''} ${g.groupIndicationSummary || ''} ${g.devices?.map((d: any) => `${d.deviceProductName || ''} ${d.deviceIndication || ''}`).join(' ') || ''}`
      )
      .join(' '),
    JSON.stringify(methodologicalExtracts || {}),
    JSON.stringify(contributionExtracts || {}),
    JSON.stringify(safetyExtracts || {}),
  ];
  if (paperText) {
    contextParts.push(paperText.slice(0, 5000));
  }
  const contextText = contextParts.join(' ').toLowerCase();

  // 2. Pivotal performance data
  // Efficacy, technical success, clinical success, stent patency, functional outcome, drainage, relief of obstruction
  if (
    contextText.includes('efficacy') ||
    contextText.includes('technical success') ||
    contextText.includes('clinical success') ||
    contextText.includes('stent patency') ||
    contextText.includes('patency') ||
    contextText.includes('drainage') ||
    contextText.includes('functional outcome') ||
    contextText.includes('performance') ||
    contextText.includes('procedure success') ||
    contextText.includes('success rate') ||
    researchGroups.some((g: any) => g.devices?.length > 0)
  ) {
    selected.add('Pivotal performance data');
  }

  // 3. Pivotal safety data
  // Adverse events, complications, safety, migration, dysfunction, bleeding, perforation, pancreatitis, cholangitis, mortality, occlusion
  if (
    contextText.includes('complication') ||
    contextText.includes('adverse event') ||
    contextText.includes('safety') ||
    contextText.includes('migration') ||
    contextText.includes('dysfunction') ||
    contextText.includes('bleeding') ||
    contextText.includes('perforation') ||
    contextText.includes('pancreatitis') ||
    contextText.includes('cholangitis') ||
    contextText.includes('mortality') ||
    contextText.includes('occlusion') ||
    (safetyExtracts?.events && safetyExtracts.events.length > 0)
  ) {
    selected.add('Pivotal safety data');
  }

  // 4. Claims (claims tested or verified regarding specific device advantages)
  if (
    contextText.includes('claim') ||
    contextText.includes('anti-migration') ||
    contextText.includes('prevent migration') ||
    contextText.includes('flare') ||
    contextText.includes('spring stopper')
  ) {
    selected.add('Claims');
  }

  // 5. Identification of hazards & Estimation and management of risks
  if (contextText.includes('hazard') || contextText.includes('risk factor') || contextText.includes('risk estimation')) {
    selected.add('Identification of hazards');
  }
  if (
    contextText.includes('management of risk') ||
    contextText.includes('reintervention') ||
    contextText.includes('rescue') ||
    contextText.includes('re-intervention')
  ) {
    selected.add('Estimation and management of risks');
  }

  // 6. Determination of equivalence & Establishment of current knowledge / the state of the art
  if (
    researchGroups.length > 1 ||
    contextText.includes('comparison') ||
    contextText.includes('comparative') ||
    contextText.includes('versus') ||
    contextText.includes(' vs ') ||
    contextText.includes('non-inferiority') ||
    contextText.includes('equivalence')
  ) {
    selected.add('Determination of equivalence');
    selected.add('Establishment of current knowledge / the state of the art');
  }

  // 7. Determination and justification of criteria for the evaluation of the risk/benefit relationship
  if (contextText.includes('risk/benefit') || contextText.includes('benefit-risk') || contextText.includes('benefit/risk')) {
    selected.add('Determination and justification of criteria for the evaluation of the risk/benefit relationship');
  }

  // Fallback: If still empty for any clinical evaluation paper with data, ensure at least Pivotal performance data and Pivotal safety data
  if (selected.size === 0) {
    selected.add('Pivotal performance data');
    selected.add('Pivotal safety data');
  }

  return Array.from(selected);
}

/**
 * Format gender distribution strictly as numbers:
 * Male: n = [number]
 * Female: n = [number]
 * Or by group if multiple groups exist:
 * Group A — Male: n = 12, Female: n = 8
 * Group B — Male: n = 10, Female: n = 11
 * If one binary sex is explicitly reported for the baseline cohort and the same
 * baseline cohort N is explicit, derive the opposite sex as N - reported sex.
 * Never borrow counts from subgroup/univariate/multivariate analysis tables.
 */
export function formatGenderDistribution(
  aiGenderComment?: string,
  aiGenderQuote?: string,
  researchGroups: ResearchGroup[] = [],
  paperText: string = ''
): {
  formattedDistribution: string;
  isReported: boolean;
  quote: string;
  location: string;
} {
  const combinedText = `${aiGenderComment || ''}\n${aiGenderQuote || ''}\n${paperText}`.replace(/[–—−]/g, '-');
  const groupNames = researchGroups.map((g, i) => g?.groupName || `Group ${i + 1}`);

  const baselineRows = extractCohortTableRows(paperText, researchGroups)
    .filter(row => /baseline|patient characteristics|demographic/i.test(row.location));
  const counts = baselineRows.find(row => /^(?:Number of patients|Total patients)/i.test(row.label));
  const males = baselineRows.find(row => /^Male\b/i.test(row.label) && row.location === counts?.location);
  const females = baselineRows.find(row => /^Female\b/i.test(row.label) && row.location === counts?.location);
  if (counts && (males || females)) {
    const rows = researchGroups.map((group, index) => {
      const column = counts.groupColumns[index];
      if (column === undefined) return `${group.groupName} — Not reported (column mapping requires review)`;
      const total = Number(counts.cells[column]);
      const male = males ? Number(males.cells[column].match(/^\d+/)?.[0]) : undefined;
      const female = females ? Number(females.cells[column].match(/^\d+/)?.[0]) : undefined;
      const name = cohortDisplayName(counts, group, column);
      if (!Number.isFinite(total) || (male !== undefined && male > total) || (female !== undefined && female > total)
        || (male !== undefined && female !== undefined && male + female !== total)) {
        return `${name} — Not reported (inconsistent baseline counts; review required)`;
      }
      const canDerive = !/\b(?:unknown|other|non[- ]?binary)\s*(?:sex|gender)?\s*\d/i.test(paperText);
      return `${name} — ${male !== undefined ? `Male: n = ${male}` : canDerive ? `Male: n = ${total - female!} [derived from group N=${total}]` : 'Male: Not reported'}, ` +
        `${female !== undefined ? `Female: n = ${female}` : canDerive ? `Female: n = ${total - male!} [derived from group N=${total}]` : 'Female: Not reported'}`;
    });
    return { formattedDistribution: rows.join('\n'), isReported: rows.some(row => /n = \d/.test(row)),
      quote: [counts, males, females].filter(Boolean).map(row => row!.quote).join(' | '), location: counts.location };
  }

  const formatPct = (_n: number, _total?: number, reportedPct?: string) => {
    if (reportedPct) return ` (${reportedPct}%)`;
    return '';
  };

  const formatDerivedPct = (n: number, total?: number) => {
    if (!total || total <= 0 || n < 0 || n > total) return '';
    const pct = (n / total) * 100;
    const rounded = Math.round(pct * 10) / 10;
    return ` (${rounded.toFixed(1)}%)`;
  };

  const parseMetricCells = (text: string): Array<{ n: number; pct?: string }> => {
    const out: Array<{ n: number; pct?: string }> = [];
    const re = /(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ n: Number(m[1]), pct: m[2] });
    return out;
  };

  const parsePatientCountCells = (text: string): number[] => {
    if (!text) return [];
    const labelStripped = text.replace(/^\s*(?:number\s+of\s+patients|total\s+(?:number\s+of\s+)?patients|sample\s+size|patients?,?\s*n)\b[^0-9]*/i, '');
    return Array.from(labelStripped.matchAll(/\b(\d{1,5})\b/g))
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
  };

  const pctConsistentWithTotal = (metric: { n: number; pct?: string }, total?: number): boolean => {
    if (!metric.pct || !total || total <= 0) return false;
    const pct = Number(metric.pct);
    if (!Number.isFinite(pct)) return false;
    return Math.abs((metric.n / total) * 100 - pct) <= 1.5;
  };

  const metricPctForGroup = (metric: { n: number; pct?: string }, total?: number): string | undefined => {
    // Some papers report subgroup shares in parentheses rather than within-group
    // sex percentages (e.g. 21 (51) and 20 (49) under two child cohorts). Preserve
    // the patient count but do not present a misleading group-level percentage.
    return pctConsistentWithTotal(metric, total) ? metric.pct : undefined;
  };

  const groupN = (index: number): number | undefined => {
    const raw = String(researchGroups[index]?.groupPatientNumber || '');
    const m = raw.match(/\d+/);
    return m ? Number(m[0]) : undefined;
  };

  // -------------------------------------------------------------------------
  // A0. Population-level demographics take priority over individual case captions.
  // This prevents a cohort paper with an illustrative "78-year-old man" figure/case
  // from being misclassified as a one-patient case report when Table 1 reports sex.
  // -------------------------------------------------------------------------
  const currentStudyPopulationText = (() => {
    const source = (paperText || '').replace(/[–—−]/g, '-');
    const discussionIdx = source.search(/\bDiscussion\b/i);
    const referencesIdx = source.search(/\bReferences\b/i);
    const cutPoints = [discussionIdx, referencesIdx].filter((i) => i >= 0);
    const endPos = cutPoints.length > 0 ? Math.min(...cutPoints) : source.length;
    return source.slice(0, endPos);
  })();

  // Two-column PDF layouts are frequently extracted out of visual order: a
  // full-width table embedded mid-page can land AFTER a "Discussion" heading
  // from an adjacent column in the linearized text, even though the table
  // itself belongs to Results. An explicitly captioned baseline/demographics
  // table ("Table N. Baseline characteristics of...") is unambiguous evidence
  // of the current study regardless of where extraction placed it, so only cut
  // at References (never fabricated inside a paper) for this specific search.
  // Narrative/heading-based extraction below stays restricted to pre-Discussion
  // text, since unstructured prose is more likely to pick up a comparator's
  // numbers quoted in the Discussion section.
  const textForTableCaptions = (() => {
    const source = (paperText || '').replace(/[–—−]/g, '-');
    const referencesIdx = source.search(/\bReferences\b/i);
    return referencesIdx >= 0 ? source.slice(0, referencesIdx) : source;
  })();

  // -------------------------------------------------------------------------
  // A0-1. Baseline-first gender extraction.
  //
  // Gender values can appear again in subgroup, univariate, multivariate, RBO,
  // TRBO, or per-protocol analyses. Those later analysis-cohort values must not
  // overwrite the study's baseline demographics. Build explicit baseline scopes
  // first and only use directly anchored Sex/Gender/Male/Female values from them.
  // -------------------------------------------------------------------------
  const baselineScopes: Array<{ text: string; location: string }> = [];

  // Older journals often caption tables with Roman numerals ("Table I", "Table IV").
  const tableCaptionPattern = /\bTable\s+(?:\d+|[IVXLCDM]+)\b[^\n\r]{0,220}\b(?:patient\s+characteristics?|baseline\s+characteristics?|demographic(?:s|\s+characteristics?)?|baseline\s+demographics?)\b/gi;
  const tableCaptions = Array.from(textForTableCaptions.matchAll(tableCaptionPattern));
  for (const caption of tableCaptions) {
    const captionIndex = caption.index ?? 0;
    const nextTable = textForTableCaptions.slice(captionIndex + caption[0].length)
      .search(/\n\s*Table\s+(?:\d+|[IVXLCDM]+)\b/i);
    const end = nextTable >= 0
      ? captionIndex + caption[0].length + nextTable
      : Math.min(textForTableCaptions.length, captionIndex + 7000);
    // PDF extraction can place column headers just before the literal table caption.
    const start = Math.max(0, captionIndex - 1200);
    baselineScopes.push({
      text: textForTableCaptions.slice(start, end),
      location: 'Baseline / Patient characteristics table',
    });
  }

  const baselineSectionPattern = /(?:^|\n)\s*(?:patient\s+characteristics?|baseline\s+characteristics?|demographic(?:s|\s+characteristics?)?|baseline\s+demographics?)\s*(?:\n|$)/gi;
  for (const section of Array.from(currentStudyPopulationText.matchAll(baselineSectionPattern))) {
    const start = section.index ?? 0;
    const after = currentStudyPopulationText.slice(start + section[0].length);
    const nextHeading = after.search(/\n\s*(?:procedural\s+outcomes?|clinical\s+outcomes?|treatment\s+outcomes?|study\s+outcomes?|statistical\s+analysis|discussion|results)\s*(?:\n|$)/i);
    const end = nextHeading >= 0
      ? start + section[0].length + nextHeading
      : Math.min(currentStudyPopulationText.length, start + 5000);
    baselineScopes.push({
      text: currentStudyPopulationText.slice(start, end),
      location: 'Patient characteristics / Results',
    });
  }

  const extractCohortNFromScope = (scope: string): number | undefined => {
    const candidates: number[] = [];
    const cohortParenN = Array.from(scope.matchAll(/\b(?:cohort|group|arm)\b[^\n\r]{0,80}\(\s*[Nn]\s*=\s*(\d{1,5})\s*\)/gi));
    for (const m of cohortParenN) candidates.push(Number(m[1]));
    const explicitN = Array.from(scope.matchAll(/\b[Nn]\s*=\s*(\d{1,5})\b/g));
    for (const m of explicitN) candidates.push(Number(m[1]));
    const enrolled = scope.match(/\b(?:of\s+)?(\d{1,5})\s+(?:consecutive\s+)?patients?\s+(?:were\s+)?(?:enrolled|included|registered|recruited)\b/i);
    if (enrolled) candidates.unshift(Number(enrolled[1]));
    return candidates.find((n) => Number.isFinite(n) && n > 0);
  };

  const studyWideCohortN = (() => {
    for (const scope of baselineScopes) {
      const n = extractCohortNFromScope(scope.text);
      if (n) return n;
    }
    const enrolled = currentStudyPopulationText.match(
      /\b(?:of\s+)?(\d{1,5})\s+(?:consecutive\s+)?patients?\s+(?:were\s+)?(?:enrolled|included|registered|recruited)\b/i
    );
    return enrolled ? Number(enrolled[1]) : undefined;
  })();

  type AnchoredSexMetric = { n: number; pct?: string; quote: string; lineIndex: number };

  const parseAnchoredSexMetric = (
    scope: string,
    sex: 'male' | 'female'
  ): AnchoredSexMetric | null => {
    const lines = scope.split(/\r?\n/);
    const sexToken = sex === 'male' ? '(?:male|men)' : '(?:female|women)';
    const anchorRegex = new RegExp(
      `(?:\\b(?:sex|gender)\\b[^\\n\\r]{0,35}\\b${sexToken}\\b|\\b${sexToken}\\b[^\\n\\r]{0,20}\\b(?:sex|gender)\\b|^\\s*${sexToken}\\b)`,
      'i'
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const anchorMatch = anchorRegex.exec(line);
      if (!anchorMatch) continue;

      // Reject later statistical-analysis rows unless this is explicitly within
      // a baseline/patient-characteristics context.
      const surrounding = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 3)).join(' ');
      if (/\b(?:univariate|multivariate|hazard\s+ratio|odds\s+ratio|\bHR\b|\bOR\b|TRBO|RBO)\b/i.test(surrounding)
          && !/\b(?:patient\s+characteristics?|baseline|demographic)\b/i.test(surrounding)) {
        continue;
      }

      const anchorEnd = (anchorMatch.index ?? 0) + anchorMatch[0].length;
      const tail = line.slice(anchorEnd).replace(/^[\s,:;-]+/, '');
      const headerContext = lines.slice(Math.max(0, i - 5), i + 1).join(' ');
      const headerPctThenN = /%\s*\(\s*n\s*\)/i.test(headerContext) || /%\s*,?\s*\(\s*n\s*\)/i.test(headerContext);
      const headerNThenPct = /\bn\s*\(\s*%\s*\)/i.test(headerContext);

      const fracPct = tail.match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/);
      if (fracPct) {
        return { n: Number(fracPct[1]), pct: fracPct[3], quote: line, lineIndex: i };
      }

      const pctFrac = tail.match(/(\d+(?:\.\d+)?)\s*%?\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
      if (pctFrac) {
        return { n: Number(pctFrac[2]), pct: pctFrac[1], quote: line, lineIndex: i };
      }

      const parenPair = tail.match(/(\d+(?:\.\d+)?)\s*%?\s*\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/);
      if (parenPair) {
        const first = Number(parenPair[1]);
        const second = Number(parenPair[2]);
        const totalN = extractCohortNFromScope(scope) || studyWideCohortN;

        if (
          headerPctThenN ||
          (!headerNThenPct && (
            (/\./.test(parenPair[1]) && Number.isInteger(second)) ||
            Boolean(totalN && first > totalN && second <= totalN)
          ))
        ) {
          return { n: second, pct: parenPair[1], quote: line, lineIndex: i };
        }
        return { n: first, pct: parenPair[2], quote: line, lineIndex: i };
      }

      const explicitN = tail.match(/\bn\s*=\s*(\d+)\b/i);
      if (explicitN) return { n: Number(explicitN[1]), quote: line, lineIndex: i };

      const firstInteger = tail.match(/\b(\d+)\b/);
      if (firstInteger) return { n: Number(firstInteger[1]), quote: line, lineIndex: i };
    }
    return null;
  };

  const hasNonBinaryOrUnknownSexCategoryNear = (scope: string, lineIndex: number): boolean => {
    const lines = scope.split(/\r?\n/);
    const local = lines.slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 4)).join(' ');
    return (
      /\b(?:sex|gender)\b[^.;\n]{0,100}\b(?:unknown|other|non[- ]?binary|not\s+reported)\b/i.test(local) ||
      /(?:^|\s)(?:unknown|other|non[- ]?binary)\s*(?:sex|gender)?\s*(?:[:=]|\d)/i.test(local)
    );
  };

  const derivedPercentFromReported = (reportedPct?: string): string | undefined => {
    if (!reportedPct) return undefined;
    const pct = Number(reportedPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return undefined;
    const derived = Math.round((100 - pct) * 10) / 10;
    return derived.toFixed(1);
  };

  if (researchGroups.length <= 1) {
    for (const scope of baselineScopes) {
      const maleMetric = parseAnchoredSexMetric(scope.text, 'male');
      const femaleMetric = parseAnchoredSexMetric(scope.text, 'female');
      const baselineN = extractCohortNFromScope(scope.text) || studyWideCohortN;

      if (maleMetric && femaleMetric) {
        return {
          formattedDistribution: `Male: n = ${maleMetric.n}${formatPct(maleMetric.n, baselineN, maleMetric.pct)}, Female: n = ${femaleMetric.n}${formatPct(femaleMetric.n, baselineN, femaleMetric.pct)}`,
          isReported: true,
          quote: maleMetric.quote === femaleMetric.quote ? maleMetric.quote : `${maleMetric.quote} | ${femaleMetric.quote}`,
          location: scope.location,
        };
      }

      if (maleMetric) {
        const canDeriveFemale = Boolean(
          baselineN &&
          maleMetric.n <= baselineN &&
          !hasNonBinaryOrUnknownSexCategoryNear(scope.text, maleMetric.lineIndex)
        );
        if (canDeriveFemale) {
          const female = (baselineN as number) - maleMetric.n;
          const derivedPct = derivedPercentFromReported(maleMetric.pct);
          return {
            formattedDistribution: `Male: n = ${maleMetric.n}${formatPct(maleMetric.n, baselineN, maleMetric.pct)}, Female: n = ${female}${derivedPct ? ` (${derivedPct}%)` : formatDerivedPct(female, baselineN)} [derived from baseline N=${baselineN}]`,
            isReported: true,
            quote: maleMetric.quote,
            location: scope.location,
          };
        }
        return {
          formattedDistribution: `Male: n = ${maleMetric.n}${formatPct(maleMetric.n, baselineN, maleMetric.pct)}, Female: Not reported`,
          isReported: true,
          quote: maleMetric.quote,
          location: scope.location,
        };
      }

      if (femaleMetric) {
        const canDeriveMale = Boolean(
          baselineN &&
          femaleMetric.n <= baselineN &&
          !hasNonBinaryOrUnknownSexCategoryNear(scope.text, femaleMetric.lineIndex)
        );
        if (canDeriveMale) {
          const male = (baselineN as number) - femaleMetric.n;
          const derivedPct = derivedPercentFromReported(femaleMetric.pct);
          return {
            formattedDistribution: `Male: n = ${male}${derivedPct ? ` (${derivedPct}%)` : formatDerivedPct(male, baselineN)} [derived from baseline N=${baselineN}], Female: n = ${femaleMetric.n}${formatPct(femaleMetric.n, baselineN, femaleMetric.pct)}`,
            isReported: true,
            quote: femaleMetric.quote,
            location: scope.location,
          };
        }
        return {
          formattedDistribution: `Male: Not reported, Female: n = ${femaleMetric.n}${formatPct(femaleMetric.n, baselineN, femaleMetric.pct)}`,
          isReported: true,
          quote: femaleMetric.quote,
          location: scope.location,
        };
      }
    }
  }

  const chooseSexPairsForGroups = (pairs: Array<RegExpMatchArray>) => {
    if (researchGroups.length === 0) return pairs.slice(0, 1);
    const selected: RegExpMatchArray[] = [];
    let cursor = 0;
    for (let gi = 0; gi < researchGroups.length; gi++) {
      const expectedN = groupN(gi);
      let selectedIndex = -1;
      if (expectedN) {
        for (let pi = cursor; pi < pairs.length; pi++) {
          if (Number(pairs[pi][1]) + Number(pairs[pi][2]) === expectedN) {
            selectedIndex = pi;
            break;
          }
        }
      }
      if (selectedIndex < 0) {
        for (let pi = cursor; pi < pairs.length; pi++) {
          const total = Number(pairs[pi][1]) + Number(pairs[pi][2]);
          // A slash-pair summing to 100 immediately after a valid count pair is
          // commonly the M/F percentage pair (e.g. 33/17 66/34), not another arm.
          if (!(total === 100 && expectedN !== 100 && pairs.length > researchGroups.length)) {
            selectedIndex = pi;
            break;
          }
        }
      }
      if (selectedIndex < 0) break;
      selected.push(pairs[selectedIndex]);
      cursor = selectedIndex + 1;
    }
    return selected;
  };

  const matchWithTableFallback = (regex: RegExp): string | undefined => {
    return currentStudyPopulationText.match(regex)?.[0] ?? textForTableCaptions.match(regex)?.[0];
  };
  const sourceSexPairLine = matchWithTableFallback(/(?:Sex\s*\(\s*male\s*\/\s*female\s*\)|Sex\s*\(\s*M\s*\/\s*F\s*\)|Male\s*\/\s*Female|M\s*\/\s*F)[^\n\r]*/i);
  if (sourceSexPairLine) {
    const allPairs = Array.from(sourceSexPairLine.matchAll(/(\d+)\s*\/\s*(\d+)/g));
    const sexPairs = chooseSexPairsForGroups(allPairs);
    if (sexPairs.length > 0 && (researchGroups.length === 0 || sexPairs.length >= researchGroups.length)) {
      if (researchGroups.length <= 1) {
        const m = sexPairs[0];
        return {
          formattedDistribution: `Male: n = ${Number(m[1])}, Female: n = ${Number(m[2])}`,
          isReported: true,
          quote: sourceSexPairLine.trim(),
          location: 'Baseline / Patient characteristics table',
        };
      }
      const rows = sexPairs.slice(0, researchGroups.length).map((m, i) =>
        `${groupNames[i]} — Male: n = ${Number(m[1])}, Female: n = ${Number(m[2])}`
      );
      return { formattedDistribution: rows.join('\n'), isReported: true, quote: sourceSexPairLine.trim(), location: 'Baseline / Patient characteristics table' };
    }
  }

  // A single-row "Gender, male" / "Sex, male" label (with only one binary sex
  // reported per column) is as common as a standalone "Male" line; recognize
  // both instead of requiring the line to start with the bare word.
  const sourceMaleLine = matchWithTableFallback(/(?:^|\n)\s*(?:Sex[,\s:()-]*|Gender[,\s:()-]*)?Male\b[^\n\r]*/im) || '';
  const sourceFemaleLine = matchWithTableFallback(/(?:^|\n)\s*(?:Sex[,\s:()-]*|Gender[,\s:()-]*)?Female\b[^\n\r]*/im) || '';
  const sourcePatientLine = matchWithTableFallback(/(?:^|\n)\s*(?:Number\s+of\s+patients|Total\s+(?:number\s+of\s+)?patients|Sample\s+size|Patients?,?\s*n)\b[^\n\r]*/im) || '';
  const sourceMaleCells = parseMetricCells(sourceMaleLine);
  const sourceFemaleCells = parseMetricCells(sourceFemaleLine);
  const sourcePatientCounts = parsePatientCountCells(sourcePatientLine);

  // Multi-group baseline tables often report only a Male row and expect Female
  // to be derived from each column N. Align sex cells to the table's own patient-N
  // columns first, then map those columns to research groups by N. This avoids
  // shifting a composite/overall column onto a treatment arm and avoids using an
  // AI phrase such as "62 Male" as if it were source evidence.
  if (researchGroups.length > 0 && sourcePatientCounts.length > 0 && (sourceMaleCells.length > 0 || sourceFemaleCells.length > 0)) {
    const maxSexColumns = Math.max(sourceMaleCells.length, sourceFemaleCells.length);
    if (maxSexColumns >= sourcePatientCounts.length) {
      const usedColumns = new Set<number>();
      const columnForGroup = (groupIndex: number): number | undefined => {
        const expectedN = groupN(groupIndex);
        if (expectedN) {
          const exact = sourcePatientCounts.map((n, idx) => n === expectedN && !usedColumns.has(idx) ? idx : -1).filter(idx => idx >= 0);
          if (exact.length === 1 && researchGroups.filter((_, index) => groupN(index) === expectedN).length === 1) {
            usedColumns.add(exact[0]);
            return exact[0];
          }
        }
        return undefined;
      };

      const rows: string[] = [];
      for (let i = 0; i < researchGroups.length; i++) {
        const col = columnForGroup(i);
        if (col === undefined) continue;
        const total = sourcePatientCounts[col] || groupN(i);
        let male = sourceMaleCells[col];
        let female = sourceFemaleCells[col];

        if (male && total && male.n > total) male = undefined;
        if (female && total && female.n > total) female = undefined;
        if (total && male && !female) female = { n: total - male.n };
        if (total && female && !male) male = { n: total - female.n };
        if (!male && !female) continue;

        const malePct = male ? metricPctForGroup(male, total) : undefined;
        const femalePct = female ? metricPctForGroup(female, total) : undefined;
        rows.push(
          `${groupNames[i]} — ${male ? `Male: n = ${male.n}${formatPct(male.n, total, malePct)}` : 'Male: Not reported'}, ` +
          `${female ? `Female: n = ${female.n}${formatPct(female.n, total, femalePct)}` : 'Female: Not reported'}`
        );
      }

      if (rows.length > 0) {
        return {
          formattedDistribution: rows.join('\n'),
          isReported: true,
          quote: [sourcePatientLine.trim(), sourceMaleLine.trim(), sourceFemaleLine.trim()].filter(Boolean).join(' | '),
          location: 'Baseline / Patient characteristics table',
        };
      }
    }
  }

  // Some multi-group baseline tables report only a single "Gender, male" row
  // (one cell per group, no dedicated body "Number of patients" row) and rely
  // on each column header carrying its own N (e.g. "FCSEMS-AF (n = 73)"). When
  // there is exactly one sex cell per research group, align them positionally
  // and derive the other sex from that group's already-known patient count.
  if (
    researchGroups.length > 1 &&
    sourcePatientCounts.length === 0 &&
    ((sourceMaleCells.length === researchGroups.length && sourceFemaleCells.length === 0) ||
      (sourceFemaleCells.length === researchGroups.length && sourceMaleCells.length === 0))
  ) {
    const usingMale = sourceMaleCells.length === researchGroups.length;
    const rows: string[] = [];
    for (let i = 0; i < researchGroups.length; i++) {
      const total = groupN(i);
      const metric = usingMale ? sourceMaleCells[i] : sourceFemaleCells[i];
      if (!total || !metric || metric.n > total) continue;
      const pct = metricPctForGroup(metric, total);
      const other = total - metric.n;
      rows.push(
        usingMale
          ? `${groupNames[i]} — Male: n = ${metric.n}${formatPct(metric.n, total, pct)}, Female: n = ${other}${formatDerivedPct(other, total)}`
          : `${groupNames[i]} — Male: n = ${other}${formatDerivedPct(other, total)}, Female: n = ${metric.n}${formatPct(metric.n, total, pct)}`
      );
    }
    if (rows.length === researchGroups.length) {
      return {
        formattedDistribution: rows.join('\n'),
        isReported: true,
        quote: (usingMale ? sourceMaleLine : sourceFemaleLine).trim(),
        location: 'Baseline / Patient characteristics table',
      };
    }
  }

  if (sourceMaleCells.length > 0 && sourceFemaleCells.length > 0) {
    if (researchGroups.length <= 1) {
      const m = sourceMaleCells[0];
      const f = sourceFemaleCells[0];
      const total = groupN(0);
      return {
        formattedDistribution: `Male: n = ${m.n}${formatPct(m.n, total, metricPctForGroup(m, total))}, Female: n = ${f.n}${formatPct(f.n, total, metricPctForGroup(f, total))}`,
        isReported: true,
        quote: `${sourceMaleLine.trim()} | ${sourceFemaleLine.trim()}`,
        location: 'Baseline / Patient characteristics table',
      };
    }
  }

  // Patient-level baseline tables sometimes list one Sex cell per patient (M/F)
  // instead of an aggregate "Sex (M/F) 9/2" row. For a single-cohort study,
  // count those explicit cells only inside a table that contains a Sex/Gender column,
  // and accept the count only when it reconciles exactly with the reported cohort N.
  if (researchGroups.length <= 1) {
    const expectedN = groupN(0);
    if (expectedN && expectedN > 0) {
      const tableStarts = Array.from(currentStudyPopulationText.matchAll(/\bTable\s+(?:\d+|[IVXLCDM]+)\b/gi));
      for (let ti = 0; ti < tableStarts.length; ti++) {
        const start = tableStarts[ti].index ?? 0;
        const end = ti + 1 < tableStarts.length ? (tableStarts[ti + 1].index ?? currentStudyPopulationText.length) : currentStudyPopulationText.length;
        // PDF column extraction can place table headers (including "Sex") just
        // before the literal "Table 1" caption, so inspect a short pre-caption window.
        const blockStart = Math.max(0, start - 900);
        let block = currentStudyPopulationText.slice(blockStart, end);
        const headerWindow = currentStudyPopulationText.slice(blockStart, Math.min(end, start + 1800));
        if (!/\b(?:Sex|Gender)\b/i.test(headerWindow)) continue;

        // Remove header notation itself so "Sex (M/F)" is not counted as two patients.
        block = block.replace(/\b(?:Sex|Gender)\s*\(\s*M\s*\/\s*F\s*\)/gi, 'Sex')
          .replace(/\bM\s*\/\s*F\b/gi, '');
        const maleCells = Array.from(block.matchAll(/(?:^|\s)M(?=\s|$|[|;])/g));
        const femaleCells = Array.from(block.matchAll(/(?:^|\s)F(?=\s|$|[|;])/g));
        const countedN = maleCells.length + femaleCells.length;
        if (countedN === expectedN && countedN > 0) {
          const positions = [...maleCells, ...femaleCells].map((m) => m.index ?? 0).sort((a, b) => a - b);
          const quoteStart = Math.max(0, (positions[0] || 0) - 80);
          const quoteEnd = Math.min(block.length, (positions[positions.length - 1] || 0) + 120);
          return {
            formattedDistribution: `Male: n = ${maleCells.length}, Female: n = ${femaleCells.length}`,
            isReported: true,
            quote: block.slice(quoteStart, quoteEnd).trim(),
            location: 'Baseline / Patient characteristics table',
          };
        }
      }

      // Some PDF engines emit a patient-level table column as a detached vertical
      // run of M/F cells far from the caption/header. Detect only a contiguous run
      // that exactly reconciles with cohort N and has a Sex/Gender header nearby.
      const standaloneCells = Array.from(currentStudyPopulationText.matchAll(/(?:^|\n)\s*([MF])\s*(?=\n|$)/g));
      const clusters: typeof standaloneCells[] = [];
      let cluster: typeof standaloneCells = [];
      for (const cell of standaloneCells) {
        const pos = cell.index ?? 0;
        const prevPos = cluster.length > 0 ? (cluster[cluster.length - 1].index ?? 0) : -9999;
        if (cluster.length === 0 || pos - prevPos <= 80) {
          cluster.push(cell);
        } else {
          clusters.push(cluster);
          cluster = [cell];
        }
      }
      if (cluster.length > 0) clusters.push(cluster);

      for (const cells of clusters) {
        if (cells.length !== expectedN) continue;
        const firstPos = cells[0].index ?? 0;
        const headerContext = currentStudyPopulationText.slice(Math.max(0, firstPos - 5000), firstPos);
        if (!/\b(?:Sex|Gender)\b/i.test(headerContext)) continue;
        const male = cells.filter((m) => m[1] === 'M').length;
        const female = cells.filter((m) => m[1] === 'F').length;
        const last = cells[cells.length - 1];
        const quoteStart = firstPos;
        const quoteEnd = Math.min(currentStudyPopulationText.length, (last.index ?? firstPos) + last[0].length);
        return {
          formattedDistribution: `Male: n = ${male}, Female: n = ${female}`,
          isReported: true,
          quote: currentStudyPopulationText.slice(quoteStart, quoteEnd).trim(),
          location: 'Baseline / Patient characteristics table',
        };
      }
    }
  }

  const numberWordMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20,
  };
  const parseCountToken = (token: string): number | null => {
    if (/^\d+$/.test(token)) return Number(token);
    return numberWordMap[token.toLowerCase()] ?? null;
  };
  const wordCountMale = currentStudyPopulationText.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+patients?\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s+(?:were\s+)?male\b/i
  );
  if (wordCountMale) {
    const male = parseCountToken(wordCountMale[1]);
    if (male !== null) {
      const canDeriveFemale = Boolean(studyWideCohortN && male <= studyWideCohortN);
      const female = canDeriveFemale ? (studyWideCohortN as number) - male : undefined;
      const derivedPct = derivedPercentFromReported(wordCountMale[2]);
      return {
        formattedDistribution: canDeriveFemale
          ? `Male: n = ${male}${wordCountMale[2] ? ` (${wordCountMale[2]}%)` : ''}, Female: n = ${female}${derivedPct ? ` (${derivedPct}%)` : formatDerivedPct(female as number, studyWideCohortN)} [derived from baseline N=${studyWideCohortN}]`
          : `Male: n = ${male}${wordCountMale[2] ? ` (${wordCountMale[2]}%)` : ''}, Female: Not reported`,
        isReported: true,
        quote: wordCountMale[0],
        location: 'Patient characteristics / Results',
      };
    }
  }

  const sourceNarrativeMF = currentStudyPopulationText.match(/\b(\d+)\s+males?\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s*(?:,|and)\s*(\d+)\s+females?\s*(?:\(\s*([\d.]+)\s*%\s*\))?/i);
  if (sourceNarrativeMF) {
    const male = Number(sourceNarrativeMF[1]);
    const female = Number(sourceNarrativeMF[3]);
    return {
      formattedDistribution: `Male: n = ${male}${formatPct(male, male + female, sourceNarrativeMF[2])}, Female: n = ${female}${formatPct(female, male + female, sourceNarrativeMF[4])}`,
      isReported: true,
      quote: sourceNarrativeMF[0],
      location: 'Patient characteristics / Results',
    };
  }

  const sourceNarrativeFM = currentStudyPopulationText.match(/\b(\d+)\s+females?\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s*(?:,|and)\s*(\d+)\s+males?\s*(?:\(\s*([\d.]+)\s*%\s*\))?/i);
  if (sourceNarrativeFM) {
    const female = Number(sourceNarrativeFM[1]);
    const male = Number(sourceNarrativeFM[3]);
    return {
      formattedDistribution: `Male: n = ${male}${formatPct(male, male + female, sourceNarrativeFM[4])}, Female: n = ${female}${formatPct(female, male + female, sourceNarrativeFM[2])}`,
      isReported: true,
      quote: sourceNarrativeFM[0],
      location: 'Patient characteristics / Results',
    };
  }

  // -------------------------------------------------------------------------
  // A. Case report / case series fallback: use patient narrative ONLY when the
  // paper itself is genuinely a case report/series, not merely because a cohort
  // paper contains an illustrative case presentation or figure caption.
  // -------------------------------------------------------------------------
  const currentStudyCaseText = (() => {
    const discussionIdx = paperText.search(/\bDiscussion\b/i);
    const referencesIdx = paperText.search(/\bReferences\b/i);
    const cutPoints = [discussionIdx, referencesIdx].filter((i) => i >= 0);
    const endPos = cutPoints.length > 0 ? Math.min(...cutPoints) : paperText.length;
    return paperText.slice(0, endPos);
  })();

  const parsedGroupNs = researchGroups
    .map((_, i) => groupN(i))
    .filter((n): n is number => typeof n === 'number');
  const hasLargeStudyCohort = parsedGroupNs.some((n) => n > 10) ||
    /\b(?:1[1-9]|[2-9]\d|\d{3,})\s+(?:consecutive\s+)?patients?\b[^.\n]{0,100}\b(?:enrolled|included|analyzed|analysed)\b/i.test(currentStudyCaseText);
  const openingStudyText = currentStudyCaseText.slice(0, 3500);
  const isLikelyCaseStudy = !hasLargeStudyCohort && (
    /\bcase\s+(?:report|series)\b/i.test(openingStudyText) ||
    (/\bCase\s*1\b/i.test(currentStudyCaseText) && /\bCase\s*2\b/i.test(currentStudyCaseText))
  );

  const caseSexById = new Map<string, 'Male' | 'Female'>();
  if (isLikelyCaseStudy) {
    const numberedCasePattern = /\b(?:Case|Patient)\s*(\d+)\b[\s\S]{0,240}?\b(?:an?\s+)?(?:\d{1,3})\s*[- ]?year\s*[- ]?old\s+(male|female|man|woman)\b/gi;
    let numberedCaseMatch: RegExpExecArray | null;
    while ((numberedCaseMatch = numberedCasePattern.exec(currentStudyCaseText)) !== null) {
      const sexToken = numberedCaseMatch[2].toLowerCase();
      caseSexById.set(numberedCaseMatch[1], /female|woman/.test(sexToken) ? 'Female' : 'Male');
    }

    // Single unnumbered case reports often say only "An 88-year-old man...".
    if (caseSexById.size === 0) {
      const singleCaseMatch = currentStudyCaseText.match(
        /\b(?:an?\s+)?(?:\d{1,3})\s*[- ]?year\s*[- ]?old\s+(male|female|man|woman)\b/i
      );
      if (singleCaseMatch) {
        const sexToken = singleCaseMatch[1].toLowerCase();
        caseSexById.set('1', /female|woman/.test(sexToken) ? 'Female' : 'Male');
      }
    }
  }

  if (caseSexById.size > 0) {
    const sexes = Array.from(caseSexById.values());
    const male = sexes.filter((v) => v === 'Male').length;
    const female = sexes.filter((v) => v === 'Female').length;
    const total = male + female;
    const explicitPhrase = currentStudyCaseText.match(
      /\b(?:Case|Patient)?\s*\d*[^.\n]{0,40}?\d{1,3}\s*[- ]?year\s*[- ]?old\s+(?:male|female|man|woman)\b/i
    )?.[0];
    return {
      formattedDistribution: `Male: n = ${male}${formatPct(male, total)}, Female: n = ${female}${formatPct(female, total)}`,
      isReported: true,
      quote: explicitPhrase || 'Explicit age/sex stated in current-study case presentation',
      location: 'Case Report / Case Presentation',
    };
  }

  // -------------------------------------------------------------------------
  // B. Multi-group table: exact M/F pairs, e.g.
  //    Sex (male/female) 24/17 32/28 .685
  // Supports 2, 3, or more research groups.
  // -------------------------------------------------------------------------
  if (researchGroups.length > 0) {
    const sexPairLine = currentStudyPopulationText.match(/(?:Sex\s*\(\s*male\s*\/\s*female\s*\)|Sex\s*\(\s*M\s*\/\s*F\s*\)|Male\s*\/\s*Female|M\s*\/\s*F)[^\n\r]*/i)?.[0];
    if (sexPairLine) {
      const pairMatches = Array.from(sexPairLine.matchAll(/(\d+)\s*\/\s*(\d+)/g));
      if (pairMatches.length >= researchGroups.length) {
        const rows = pairMatches.slice(0, researchGroups.length).map((m, i) => {
          const male = Number(m[1]);
          const female = Number(m[2]);
          const total = male + female;
          return `${groupNames[i]} — Male: n = ${male}${formatPct(male, total)}, Female: n = ${female}${formatPct(female, total)}`;
        });
        return { formattedDistribution: rows.join('\n'), isReported: true, quote: sexPairLine.trim(), location: 'Baseline / Patient characteristics table' };
      }
    }

    // Separate Male / Female rows, including tables with extra matched-cohort columns.
    // We take the first N treatment-arm cells because researchGroups represents treatment arms,
    // not pre/post-matching duplicate cohorts.
    const maleLine = currentStudyPopulationText.match(/(?:^|\n)\s*Male\b[^\n\r]*/im)?.[0] || '';
    const femaleLine = currentStudyPopulationText.match(/(?:^|\n)\s*Female\b[^\n\r]*/im)?.[0] || '';
    const maleCells = parseMetricCells(maleLine);
    const femaleCells = parseMetricCells(femaleLine);
    if (maleCells.length >= researchGroups.length && femaleCells.length >= researchGroups.length) {
      const rows = researchGroups.map((_, i) => {
        const m = maleCells[i];
        const f = femaleCells[i];
        return `${groupNames[i]} — Male: n = ${m.n}${formatPct(m.n, groupN(i), m.pct)}, Female: n = ${f.n}${formatPct(f.n, groupN(i), f.pct)}`;
      });
      return {
        formattedDistribution: rows.join('\n'),
        isReported: true,
        quote: `${maleLine.trim()} | ${femaleLine.trim()}`,
        location: 'Baseline / Patient characteristics table',
      };
    }

    // "Sex, male/female, n (%) 14 (58.3%) 11 (47.8%) 17 (70.8%)" may report
    // only one binary sex per group. When that group's baseline N is explicit and
    // there is no extra/unknown sex category, derive the opposite sex per group.
    const sexPercentLine = currentStudyPopulationText.match(/(?:Sex[^\n\r]{0,40}male\s*\/\s*female[^\n\r]*)/i)?.[0] || '';
    const sexPercentCells = parseMetricCells(sexPercentLine);
    if (sexPercentCells.length >= researchGroups.length) {
      const rows = researchGroups.map((_, i) => {
        const m = sexPercentCells[i];
        const total = groupN(i);
        if (total && m.n <= total && !/\b(?:unknown|other|non[- ]?binary)\b/i.test(sexPercentLine)) {
          const female = total - m.n;
          const femalePct = derivedPercentFromReported(m.pct);
          return `${groupNames[i]} — Male: n = ${m.n}${formatPct(m.n, total, m.pct)}, Female: n = ${female}${femalePct ? ` (${femalePct}%)` : formatDerivedPct(female, total)} [derived from group N=${total}]`;
        }
        return `${groupNames[i]} — Male: n = ${m.n}${formatPct(m.n, total, m.pct)}, Female: Not reported`;
      });
      return { formattedDistribution: rows.join('\n'), isReported: true, quote: sexPercentLine.trim(), location: 'Baseline / Patient characteristics table' };
    }
  }

  // -------------------------------------------------------------------------
  // C. Narrative demographics.
  // -------------------------------------------------------------------------
  const narrativeMaleFemale = currentStudyPopulationText.match(
    /\b(\d+)\s+males?\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s*(?:,|and)\s*(\d+)\s+females?\s*(?:\(\s*([\d.]+)\s*%\s*\))?/i
  );
  if (narrativeMaleFemale) {
    const male = Number(narrativeMaleFemale[1]);
    const female = Number(narrativeMaleFemale[3]);
    return {
      formattedDistribution: `Male: n = ${male}${formatPct(male, male + female, narrativeMaleFemale[2])}, Female: n = ${female}${formatPct(female, male + female, narrativeMaleFemale[4])}`,
      isReported: true,
      quote: narrativeMaleFemale[0],
      location: 'Patient characteristics / Results',
    };
  }

  const narrativeFemaleMale = currentStudyPopulationText.match(
    /\b(\d+)\s+females?\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s*(?:,|and)\s*(\d+)\s+males?\s*(?:\(\s*([\d.]+)\s*%\s*\))?/i
  );
  if (narrativeFemaleMale) {
    const female = Number(narrativeFemaleMale[1]);
    const male = Number(narrativeFemaleMale[3]);
    return {
      formattedDistribution: `Male: n = ${male}${formatPct(male, male + female, narrativeFemaleMale[4])}, Female: n = ${female}${formatPct(female, male + female, narrativeFemaleMale[2])}`,
      isReported: true,
      quote: narrativeFemaleMale[0],
      location: 'Patient characteristics / Results',
    };
  }

  // "Fifty-six patients were men" / "42 (59.2%) were male".
  const overallMale = currentStudyPopulationText.match(/\b(\d+)\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s+(?:patients?\s+)?(?:were\s+)?(?:men|male)\b/i);
  if (overallMale) {
    const male = Number(overallMale[1]);
    const canDeriveFemale = Boolean(studyWideCohortN && male <= studyWideCohortN);
    const female = canDeriveFemale ? (studyWideCohortN as number) - male : undefined;
    const femalePct = derivedPercentFromReported(overallMale[2]);
    return {
      formattedDistribution: canDeriveFemale
        ? `Male: n = ${male}${overallMale[2] ? ` (${overallMale[2]}%)` : ''}, Female: n = ${female}${femalePct ? ` (${femalePct}%)` : formatDerivedPct(female as number, studyWideCohortN)} [derived from baseline N=${studyWideCohortN}]`
        : `Male: n = ${male}${overallMale[2] ? ` (${overallMale[2]}%)` : ''}, Female: Not reported`,
      isReported: true,
      quote: overallMale[0],
      location: 'Patient characteristics / Results',
    };
  }

  const overallFemale = currentStudyPopulationText.match(/\b(\d+)\s*(?:\(\s*([\d.]+)\s*%\s*\))?\s+(?:patients?\s+)?(?:were\s+)?(?:women|female)\b/i);
  if (overallFemale) {
    const female = Number(overallFemale[1]);
    const canDeriveMale = Boolean(studyWideCohortN && female <= studyWideCohortN);
    const male = canDeriveMale ? (studyWideCohortN as number) - female : undefined;
    const malePct = derivedPercentFromReported(overallFemale[2]);
    return {
      formattedDistribution: canDeriveMale
        ? `Male: n = ${male}${malePct ? ` (${malePct}%)` : formatDerivedPct(male as number, studyWideCohortN)} [derived from baseline N=${studyWideCohortN}], Female: n = ${female}${overallFemale[2] ? ` (${overallFemale[2]}%)` : ''}`
        : `Male: Not reported, Female: n = ${female}${overallFemale[2] ? ` (${overallFemale[2]}%)` : ''}`,
      isReported: true,
      quote: overallFemale[0],
      location: 'Patient characteristics / Results',
    };
  }

  // AI result is a final fallback only after direct source parsing. When source
  // text is available, require at least one reported sex count in the AI result to
  // be directly supported by a Male/Female anchor in the current-study source.
  // This blocks cross-column hallucinations such as treating a group N (e.g. 62)
  // as the male count merely because Gemini returned "62 Male".
  if (aiGenderComment && /Male|Female/i.test(aiGenderComment) && !/Not reported/i.test(aiGenderComment)) {
    const aiMale = aiGenderComment.match(/Male:\s*n\s*=\s*(\d+)/i)?.[1]
      || aiGenderQuote?.match(/\b(\d+)\s+(?:men|males?)\b/i)?.[1]
      || aiGenderQuote?.match(/\bMale\b[^\n\r]{0,40}?(\d+)/i)?.[1];
    const aiFemale = aiGenderComment.match(/Female:\s*n\s*=\s*(\d+)/i)?.[1]
      || aiGenderQuote?.match(/\b(\d+)\s+(?:women|females?)\b/i)?.[1]
      || aiGenderQuote?.match(/\bFemale\b[^\n\r]{0,40}?(\d+)/i)?.[1];
    const sourceSupports = (sex: 'male' | 'female', count?: string) => {
      if (!count) return false;
      const token = sex === 'male' ? '(?:male|men)' : '(?:female|women)';
      return new RegExp(`\b${token}\b[^\n\r]{0,120}\b${count}\b`, 'i').test(currentStudyPopulationText)
        || new RegExp(`\b${count}\b[^\n\r]{0,40}\b${token}\b`, 'i').test(currentStudyPopulationText);
    };
    const sourceBacked = !currentStudyPopulationText.trim() || sourceSupports('male', aiMale) || sourceSupports('female', aiFemale);
    if (sourceBacked) {
      return {
        formattedDistribution: aiGenderComment.trim(),
        isReported: true,
        quote: aiGenderQuote || aiGenderComment,
        location: 'Table 1 / Demographics',
      };
    }
  }

  return { formattedDistribution: 'Not reported', isReported: false, quote: 'Not reported', location: 'Not reported' };
}

/**
 * Structured Safety Event Table Parser
 * Parses medical literature tables (such as Table 2 adverse events) adhering strictly to:
 * 1. Scanning full paper tables and text
 * 2. Preserving hierarchy ONLY when the source explicitly identifies it (e.g. a 'Cause of X' heading)
 * 3. Keeping ambiguous/proximate rows flat rather than inferring hierarchy from terminology or arithmetic
 * 4. Linking cause/mechanism rows only to an explicitly named parent
 * 5. Preserving exact denominators and rates (Study-wide / all patients without artificial subgrouping)
 * 6. Emitting validation summary: "Safety extraction validated: [X] events, [Y] linked breakdown items, [Z] review items."
 */
