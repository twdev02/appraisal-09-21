import React, { useEffect, useMemo, useState } from 'react';
import {
  SafetyEventState,
  SafetyEventItem,
  FullAppraisalData,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
  SelfValidationState,
} from '../types';
import {
  ShieldCheck,
  AlertTriangle,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  X,
  Eye,
} from 'lucide-react';
import { SelfValidationBadge } from './SelfValidationBadge';
import { issuesForTarget } from '../utils/selfValidation';
import { isSafetySummaryOnlyLabel } from '../utils/nlpRules';
import {
  compareEventToFmea,
  fetchFmeaRegistry,
  FmeaMatchResult,
  FmeaRegistryRow,
  FMEA_SHEET_NAME,
  normalizeProductName,
} from '../data/fmeaRegistry';

interface Step4SafetyProps {
  safety: SafetyEventState;
  fullData: FullAppraisalData;
  methodological: MethodologicalAppraisalState;
  contribution: ContributionAppraisalState;
  selfValidation?: SelfValidationState;
  onUpdateSafety: (newSafety: SafetyEventState) => void;
  onBack: () => void;
  onNewEvaluation?: () => void;
}

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Adverse Event / Complication': { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  'Cause of Recurrence': { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
  'Adverse event': { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  'Complication': { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200' },
  'Recurrence': { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
};

export const Step4Safety: React.FC<Step4SafetyProps> = ({
  safety,
  fullData,
  methodological,
  contribution,
  selfValidation,
  onUpdateSafety,
  onBack,
  onNewEvaluation,
}) => {
  const [editingEvent, setEditingEvent] = useState<SafetyEventItem | null>(null);
  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);
  const [fmeaRows, setFmeaRows] = useState<FmeaRegistryRow[]>([]);
  const [fmeaLoading, setFmeaLoading] = useState<boolean>(true);
  const [fmeaError, setFmeaError] = useState<string>('');
  const [selectedFmeaReview, setSelectedFmeaReview] = useState<{
    event: SafetyEventItem;
    result: FmeaMatchResult;
  } | null>(null);
  const [selectedSimilarRiskKey, setSelectedSimilarRiskKey] = useState<string>('');
  const [selectedEvidenceEvent, setSelectedEvidenceEvent] = useState<SafetyEventItem | null>(null);

  const researchGroups = fullData.researchGroups || [];

  useEffect(() => {
    let active = true;
    setFmeaLoading(true);
    setFmeaError('');

    fetchFmeaRegistry()
      .then((result) => {
        if (!active) return;
        setFmeaRows(result.rows);
        setFmeaError(result.error || '');
      })
      .catch((error) => {
        if (!active) return;
        setFmeaRows([]);
        setFmeaError(error?.message || 'Failed to load FMEA registry.');
      })
      .finally(() => {
        if (active) setFmeaLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const fmeaRowsByProduct = useMemo(() => {
    const index = new Map<string, FmeaRegistryRow[]>();
    fmeaRows.forEach((row) => {
      const key = normalizeProductName(row.productModelName);
      if (!key) return;
      const bucket = index.get(key) || [];
      bucket.push(row);
      index.set(key, bucket);
    });
    return index;
  }, [fmeaRows]);

  const groupOptions = [
    'Study-wide; group not separately reported',
    ...researchGroups.map((g) => g.groupName),
  ];

  const formatTiming = (t: string) => {
    if (!t || t === 'Overall / not time-categorized' || t === 'Not reported' || t === 'Overall') {
      return 'N/A';
    }
    return t;
  };

  const parsePercentNumber = (value?: string) => {
    const match = String(value || '').match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getPercentagePresentation = (event: SafetyEventItem) => {
    const reported = event.reportedRate && event.reportedRate !== 'Not reported'
      ? event.reportedRate
      : '';
    const calculated = event.calculatedRate && event.calculatedRate !== 'Not reported'
      ? event.calculatedRate
      : '';
    let status = event.percentageAssessmentStatus;

    // Backward-compatible display for already-saved analyses created before
    // percentageAssessmentStatus was introduced.
    if (!status) {
      if (reported && calculated) {
        const reportedValue = parsePercentNumber(reported);
        const calculatedValue = parsePercentNumber(calculated);
        status =
          reportedValue !== null && calculatedValue !== null && Math.abs(reportedValue - calculatedValue) <= 0.2
            ? 'reported_verified'
            : 'reported_only';
      } else if (reported) {
        status = 'reported_only';
      } else if (calculated) {
        status = 'calculated';
      } else {
        status = 'not_available';
      }
    }

    switch (status) {
      case 'reported_verified':
        return {
          value: calculated || reported,
          badge: 'Verified',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          secondary: reported && calculated && reported !== calculated ? `Paper: ${reported}` : '',
        };
      case 'calculated':
        return {
          value: calculated || 'N/A',
          badge: 'Calculated',
          badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
          secondary: '',
        };
      case 'reported_only':
        return {
          value: reported || 'N/A',
          badge: 'Reported',
          badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
          secondary: '',
        };
      case 'review_required':
        return {
          value: reported || 'Review required',
          badge: 'Review required',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          secondary: reported && calculated ? `Calculated: ${calculated}` : '',
        };
      default:
        return {
          value: 'N/A',
          badge: '',
          badgeClass: '',
          secondary: '',
        };
    }
  };

  const hasPositiveEventCount = (event: SafetyEventItem) => {
    const explicitNumerator = event.numerator ?? event.numEvents;
    if (explicitNumerator !== undefined && explicitNumerator !== null && String(explicitNumerator).trim() !== '') {
      const numericNumerator = Number(String(explicitNumerator).trim());
      if (Number.isFinite(numericNumerator)) return numericNumerator > 0;
    }

    const countMatch = String(event.countN || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/|$)/);
    if (countMatch) return Number(countMatch[1]) > 0;

    const reportedRate = String(event.reportedRate || event.reportedPercentage || '').trim();
    if (/^0(?:\.0+)?\s*%$/.test(reportedRate)) return false;

    return true;
  };

  // Mortality is tracked separately in the Step 4 mortality summary and must not
  // be treated as an adverse-event / complication row. This also hides mortality
  // rows from older saved analyses that were created before this rule existed.
  const isMortalityOutcome = (event: SafetyEventItem) => {
    const label = String(event.eventName || '').toLowerCase();
    const category = String(event.category || '').toLowerCase();
    return (
      category === 'mortality' ||
      /\b(?:mortality|death|deaths|fatality|fatalities)\b/i.test(label)
    );
  };

  const displayedEvents = safety.events
    .filter(hasPositiveEventCount)
    .filter((event) => !isMortalityOutcome(event))
    // Keep aggregate totals such as "Patients with complications",
    // "Overall complications" and Early/Late totals in the analysis state for
    // completeness/self-validation, but do not present them as actual Step 4
    // complication rows. Only leaf/clinically meaningful events are displayed.
    .filter((event) => !isSafetySummaryOnlyLabel(event.eventName));

  const handleDeleteEvent = (id: string) => {
    const updatedEvents = safety.events.filter((ev) => ev.id !== id);
    onUpdateSafety({
      ...safety,
      events: updatedEvents,
      summary: {
        ...safety.summary,
        status: updatedEvents.length > 0 ? 'Events reported' : (safety.hasExplicitNoEventsReported ? 'No event reported' : 'Not reported'),
      },
    });
  };

  const handleSaveEvent = (savedItem: SafetyEventItem) => {
    const nMatch = savedItem.countN.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    const hasReportedRate = Boolean(savedItem.reportedRate && savedItem.reportedRate !== 'Not reported');
    const unsafeCountUnit =
      savedItem.numeratorType === 'events' ||
      savedItem.numeratorType === 'episodes' ||
      savedItem.numeratorType === 'procedures' ||
      (
        savedItem.numeratorType &&
        savedItem.denominatorType &&
        savedItem.numeratorType !== 'unknown' &&
        savedItem.denominatorType !== 'unknown' &&
        savedItem.numeratorType !== savedItem.denominatorType
      );
    const multipleEventWarning =
      savedItem.multipleEventsPerPatient === 'Yes' ||
      savedItem.multipleEventsPerPatient === 'Unclear';
    const contextualCalculationBlock =
      savedItem.percentageAssessmentStatus === 'review_required' &&
      /withheld|multiple|patient-based|could not be excluded|unit is not/i.test(savedItem.percentageAssessmentNote || '');

    let calculatedRate = 'Not reported';
    let percentageSource: 'Reported' | 'Calculated' = hasReportedRate ? 'Reported' : 'Calculated';
    let percentageAssessmentStatus = savedItem.percentageAssessmentStatus || (hasReportedRate ? 'reported_only' : 'not_available');
    let percentageAssessmentNote = savedItem.percentageAssessmentNote || '';

    if (nMatch && !unsafeCountUnit && !multipleEventWarning && !contextualCalculationBlock) {
      const nVal = parseFloat(nMatch[1]);
      const totalVal = parseFloat(nMatch[2]);

      if (totalVal > 0) {
        const calculatedValue = (nVal / totalVal) * 100;
        calculatedRate = `${calculatedValue.toFixed(1)}%`;

        if (hasReportedRate) {
          const reportedValue = parsePercentNumber(savedItem.reportedRate);
          if (reportedValue !== null && Math.abs(reportedValue - calculatedValue) <= 0.2) {
            percentageAssessmentStatus = 'reported_verified';
            percentageAssessmentNote = `Reported percentage (${savedItem.reportedRate}) agrees with n/N calculation (${calculatedRate}) within rounding tolerance.`;
          } else if (reportedValue !== null) {
            percentageAssessmentStatus = 'review_required';
            percentageAssessmentNote = `Reported percentage (${savedItem.reportedRate}) does not agree with n/N calculation (${calculatedRate}); review the denominator, count unit, and source note.`;
          } else {
            percentageAssessmentStatus = 'reported_only';
            percentageAssessmentNote = 'The reported percentage was preserved but could not be numerically verified.';
          }
          percentageSource = 'Reported';
        } else {
          percentageAssessmentStatus = 'calculated';
          percentageAssessmentNote = 'Percentage calculated from n/N after the source-level safety check found no reason to block calculation.';
          percentageSource = 'Calculated';
        }
      }
    } else if (nMatch && (unsafeCountUnit || multipleEventWarning || contextualCalculationBlock)) {
      calculatedRate = 'Not reported';
      percentageAssessmentStatus = 'review_required';
      percentageAssessmentNote =
        percentageAssessmentNote ||
        'Automatic percentage calculation is withheld because the n/N unit or possible multiple events per patient requires review.';
    } else if (!nMatch) {
      calculatedRate = 'Not reported';
      percentageAssessmentStatus = hasReportedRate ? 'reported_only' : 'not_available';
      percentageAssessmentNote =
        percentageAssessmentNote ||
        (hasReportedRate
          ? 'Percentage is reported in the paper, but a valid n/N pair is not available for verification.'
          : 'Percentage cannot be calculated because a valid n/N pair is not available.');
    }

    const selectedParent =
      savedItem.parentEvent && (savedItem.relationshipType === 'component' || savedItem.relationshipType === 'cause')
        ? safety.events.find((event) => event.id !== savedItem.id && event.eventName === savedItem.parentEvent)
        : undefined;

    const relationshipType = savedItem.relationshipType || 'none';
    const hierarchyRole: SafetyEventItem['hierarchyRole'] =
      relationshipType === 'aggregate' ? 'Aggregate event' :
      relationshipType === 'component' ? 'Component event' :
      relationshipType === 'cause' ? 'Cause event' :
      relationshipType === 'unclear' ? 'Review required' :
      'Independent event';

    const itemToSave: SafetyEventItem = {
      ...savedItem,
      calculatedRate,
      percentageSource,
      percentageAssessmentStatus,
      percentageAssessmentNote,
      calculationBasis: nMatch ? `${nMatch[1]}/${nMatch[2]}` : 'Not available',
      timing: formatTiming(savedItem.timing),
      parentEvent:
        relationshipType === 'component' || relationshipType === 'cause'
          ? savedItem.parentEvent
          : undefined,
      parentEventId:
        relationshipType === 'component' || relationshipType === 'cause'
          ? selectedParent?.id
          : undefined,
      isSubItem: relationshipType === 'component' || relationshipType === 'cause',
      hierarchyRole,
      hierarchyConfidence: relationshipType === 'unclear' ? 'Medium' as const : 'High' as const,
      classificationStatus: relationshipType === 'unclear' ? 'review_required' as const : 'classified' as const,
      reviewReason: relationshipType === 'unclear' ? (savedItem.reviewReason || 'Hierarchy relationship requires manual review.') : undefined,
    };

    let updatedList: SafetyEventItem[];
    if (isAddingNew) {
      updatedList = [...safety.events, itemToSave];
    } else {
      updatedList = safety.events.map((ev) => (ev.id === itemToSave.id ? itemToSave : ev));
    }

    onUpdateSafety({
      ...safety,
      events: updatedList,
      summary: {
        ...safety.summary,
        status: 'Events reported',
      },
    });

    setEditingEvent(null);
    setIsAddingNew(false);
  };

  const handleResetToAi = (id: string) => {
    const updatedList = safety.events.map((ev) => {
      if (ev.id === id && ev.aiRecommended) {
        return {
          ...ev,
          ...ev.aiRecommended,
        };
      }
      return ev;
    });
    onUpdateSafety({
      ...safety,
      events: updatedList,
    });
  };

  const handleCreateNew = () => {
    const newId = `safe-ev-${Date.now()}`;
    const defaultGroup = researchGroups?.[0]?.groupName || 'Study-wide; group not separately reported';
    const newEvent: SafetyEventItem = {
      id: newId,
      eventName: '',
      eventType: 'Adverse Event / Complication',
      classificationStatus: 'classified',
      category: 'Adverse event',
      timing: 'N/A',
      studyGroupOrDevice: defaultGroup,
      countN: 'Not reported',
      reportedRate: 'Not reported',
      calculatedRate: 'Not reported',
      numeratorType: 'unknown',
      denominatorType: 'unknown',
      multipleEventsPerPatient: 'Not reported',
      percentageAssessmentStatus: 'not_available',
      percentageAssessmentNote: 'Percentage has not been assessed.',
      severity: 'Not reported',
      managementOutcome: 'Not reported',
      evidenceQuote: '',
      evidenceLocation: 'Results / Tables',
    };
    setEditingEvent(newEvent);
    setIsAddingNew(true);
  };

  const formatSingleMetricDisplay = (val: any, denom?: string | number) => {
    if (!val || val === 'Not reported' || val === 'N/A') return 'N/A';
    if (typeof val === 'object') {
      const num = val.numerator !== undefined ? val.numerator : '';
      const d = val.denominator !== undefined ? val.denominator : denom;
      const pct = val.percentage;
      if (num !== '' && d !== undefined && d !== 'Not reported' && pct) {
        return `${num}/${d} (${pct})`;
      }
      if (num !== '' && d !== undefined && d !== 'Not reported') {
        const pCalc = Number(d) > 0 ? `${((Number(num) / Number(d)) * 100).toFixed(1)}%` : '0%';
        return `${num}/${d} (${pCalc})`;
      }
      if (num !== '' && pct) return `${num} (${pct})`;
    }
    return String(val);
  };

  const formatMetricDisplay = (val: any, denom?: string | number): React.ReactNode => {
    if (Array.isArray(val)) {
      if (val.length === 0) return 'N/A';
      return (
        <div className="space-y-1">
          {val.map((metric: any, metricIndex: number) => {
            const rawTiming = String(metric?.timing || '').trim();
            const timingLabel = rawTiming &&
              rawTiming !== 'Overall / not time-categorized' &&
              rawTiming !== 'Not reported'
                ? rawTiming
                : '';
            return (
              <div key={`${timingLabel}-${metricIndex}`} className="flex items-baseline gap-2">
                {timingLabel && (
                  <span className="text-[10px] font-semibold text-slate-500 min-w-[48px]">
                    {timingLabel}
                  </span>
                )}
                <span>{formatSingleMetricDisplay(metric, denom)}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return formatSingleMetricDisplay(val, denom);
  };

  const cleanGroupLabel = (value?: string) => {
    if (!value) return 'Study-wide';

    const cleaned = value
      .split('·')[0]
      .replace(/\s*\(\s*[nN]\s*=\s*[^)]+\)\s*/g, ' ')
      .replace(/\s+[nN]\s*=\s*[^\s]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || 'Study-wide';
  };

  const getGroupKey = (value?: string) =>
    cleanGroupLabel(value)
      .toLowerCase()
      .replace(/\b(?:group|cohort|arm)\b\s*$/i, '')
      .trim();

  const resolveEventGroupName = (ev: SafetyEventItem) => {
    const groupById = ev.groupId
      ? researchGroups.find((group) => group.id === ev.groupId)
      : undefined;
    if (groupById) return groupById.groupName;

    const rawLabel = ev.groupName || ev.studyGroupOrDevice || 'Study-wide';
    const cleanedLabel = cleanGroupLabel(rawLabel);
    const cleanedKey = getGroupKey(cleanedLabel);
    const matchedGroup = researchGroups.find(
      (group) => getGroupKey(group.groupName) === cleanedKey
    );

    return matchedGroup?.groupName || cleanedLabel;
  };

  const normalizeFmeaEventLabel = (value?: string) =>
    String(value || '')
      .toLowerCase()
      .replace(/[™®©℠]/g, '')
      .replace(/[–—−]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  type FmeaRiskGroup = {
    key: string;
    label: string;
    harms: string[];
    hazardousSituations: string[];
    rows: FmeaRegistryRow[];
    products: string[];
    docNos: string[];
    controls: Array<{ text: string; products: string[] }>;
    score: number;
  };

  const riskGenericTokens = new Set([
    'adverse', 'event', 'events', 'complication', 'complications', 'stent', 'stents',
    'device', 'devices', 'procedure', 'procedural', 'post', 'after', 'following',
    'related', 'associated', 'reported', 'new', 'onset', 'overall', 'early', 'late',
    'immediate', 'delayed', 'the', 'a', 'an', 'of', 'to', 'in', 'with', 'and', 'or',
  ]);

  const canonicalRiskToken = (token: string) => {
    const normalized = token.toLowerCase();
    const synonymMap: Record<string, string> = {
      painful: 'pain', pain: 'pain', discomfort: 'pain', ache: 'pain',
      bleeding: 'bleed', bleed: 'bleed', hemorrhage: 'bleed', haemorrhage: 'bleed',
      obstruction: 'obstruct', obstructed: 'obstruct', occlusion: 'obstruct', blockage: 'obstruct', blocked: 'obstruct',
      migration: 'migrate', migrated: 'migrate', displacement: 'migrate', dislodgement: 'migrate',
      perforation: 'perforate', perforated: 'perforate', rupture: 'perforate',
      infection: 'infect', infectious: 'infect', cholangitis: 'infect', cholecystitis: 'infect', abscess: 'infect', sepsis: 'infect',
      fracture: 'fracture', breakage: 'fracture',
      ingrowth: 'tissuegrowth', overgrowth: 'tissuegrowth', hyperplasia: 'tissuegrowth',
    };
    return synonymMap[normalized] || normalized;
  };

  const getRiskTokens = (value?: string) =>
    normalizeFmeaEventLabel(value)
      .split(' ')
      .filter(Boolean)
      .filter((token) => !riskGenericTokens.has(token))
      .map(canonicalRiskToken)
      .filter((token) => token.length >= 3);

  const getFmeaRiskKey = (row: FmeaRegistryRow) => {
    const harm = normalizeFmeaEventLabel(row.harm);
    const hazard = normalizeFmeaEventLabel(row.hazardousSituation);
    // Risk-centric grouping: when the Harm is available, group the same risk across
    // multiple DUE product rows. This prevents category-wide selections from rendering
    // the same clinical risk once per product.
    return harm ? `harm:${harm}` : `hazard:${hazard || row.no}`;
  };

  const uniqueNonEmpty = (values: string[]) =>
    Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

  const groupFmeaRowsByRisk = (rows: FmeaRegistryRow[]): FmeaRiskGroup[] => {
    const grouped = new Map<string, FmeaRegistryRow[]>();
    rows.forEach((row) => {
      const key = getFmeaRiskKey(row);
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    });

    return Array.from(grouped.entries()).map(([key, groupRows]) => {
      const harms = uniqueNonEmpty(groupRows.map((row) => row.harm));
      const hazardousSituations = uniqueNonEmpty(groupRows.map((row) => row.hazardousSituation));
      const products = uniqueNonEmpty(groupRows.map((row) => row.productModelName));
      const docNos = uniqueNonEmpty(groupRows.map((row) => row.fmeaDocNo));
      const controlMap = new Map<string, { text: string; products: string[] }>();

      groupRows.forEach((row) => {
        const text = String(row.riskReductionControls || '').trim();
        if (!text) return;
        const controlKey = normalizeFmeaEventLabel(text) || text;
        const current = controlMap.get(controlKey) || { text, products: [] };
        if (row.productModelName && !current.products.includes(row.productModelName)) {
          current.products.push(row.productModelName);
        }
        controlMap.set(controlKey, current);
      });

      return {
        key,
        label: harms[0] || hazardousSituations[0] || 'Unnamed FMEA risk',
        harms,
        hazardousSituations,
        rows: groupRows,
        products,
        docNos,
        controls: Array.from(controlMap.values()),
        score: 0,
      };
    });
  };

  const scoreRiskSimilarity = (eventName: string, group: FmeaRiskGroup) => {
    const eventText = normalizeFmeaEventLabel(eventName);
    const riskText = normalizeFmeaEventLabel(
      [...group.harms, ...group.hazardousSituations].join(' ')
    );
    if (!eventText || !riskText) return 0;
    if (eventText === riskText) return 1;

    const eventTokens = Array.from(new Set(getRiskTokens(eventName)));
    const riskTokens = Array.from(new Set(getRiskTokens(riskText)));
    if (eventTokens.length === 0 || riskTokens.length === 0) return 0;

    const eventSet = new Set(eventTokens);
    const riskSet = new Set(riskTokens);
    const shared = eventTokens.filter((token) => riskSet.has(token));
    if (shared.length === 0) return 0;

    const eventCoverage = shared.length / eventTokens.length;
    const riskCoverage = shared.length / riskTokens.length;
    const unionSize = new Set([...eventTokens, ...riskTokens]).size;
    const jaccard = unionSize > 0 ? shared.length / unionSize : 0;
    let score = Math.max(eventCoverage, riskCoverage) * 0.72 + jaccard * 0.28;

    // Strong signal for expressions such as "post-procedure pain" vs "Pain".
    if (eventCoverage === 1 || riskCoverage === 1) score = Math.max(score, 0.9);
    if (eventText.includes(riskText) || riskText.includes(eventText)) score = Math.max(score, 0.95);
    return Math.min(score, 1);
  };

  // FMEA comparison is intended for the actual, individual safety event (leaf item),
  // not for totals, umbrella outcomes, or parent rows that merely summarize components.
  // Keep this deliberately conservative: an ambiguous hierarchy is excluded rather than
  // being falsely highlighted as a "new FMEA risk".
  const isBroadSafetyOutcomeLabel = (eventName?: string) => {
    const label = normalizeFmeaEventLabel(eventName);
    if (!label) return false;

    return (
      /^(?:(?:overall|total|all)\s+)?(?:adverse\s+events?|complications?|safety\s+events?)$/.test(label) ||
      /^(?:persistent|recurrent)\s+(?:obstructive\s+)?symptoms?$/.test(label) ||
      // Recurrent biliary obstruction (RBO) is NOT automatically an aggregate.
      // If the paper reports only RBO itself, treat it as a standalone complication
      // and allow FMEA cross-check. It becomes a parent/aggregate only when explicit
      // linked causes/components are present (handled above by isAggregate,
      // hasLinkedChildEvents, or breakdowns).
      /^(?:stent|device)\s+(?:dysfunction|malfunction|failure)s?$/.test(label) ||
      /^(?:reintervention|re intervention)s?(?:\s+rate)?$/.test(label) ||
      /^(?:recurrence|recurrences)(?:\s+rate)?$/.test(label)
    );
  };

  const hasLinkedChildEvents = (event: SafetyEventItem) => {
    const parentLabel = normalizeFmeaEventLabel(event.eventName);
    const parentGroupKey = getGroupKey(resolveEventGroupName(event));

    return displayedEvents.some((candidate) => {
      if (candidate.id === event.id) return false;
      if (getGroupKey(resolveEventGroupName(candidate)) !== parentGroupKey) return false;
      if (candidate.parentEventId && candidate.parentEventId === event.id) return true;
      return Boolean(
        candidate.parentEvent &&
        parentLabel &&
        normalizeFmeaEventLabel(candidate.parentEvent) === parentLabel
      );
    });
  };

  const getFmeaEligibility = (event: SafetyEventItem): { eligible: boolean; reason: string } => {
    const isAggregate =
      event.isAggregate === true ||
      event.relationshipType === 'aggregate' ||
      event.hierarchyRole === 'Aggregate event' ||
      event.hierarchyRole === 'Subtotal/Summary' ||
      event.hierarchyClassification === 'Summary total' ||
      hasLinkedChildEvents(event) ||
      Boolean(event.breakdowns && event.breakdowns.length > 0);

    if (isAggregate) {
      return {
        eligible: false,
        reason: 'Aggregate / parent row. FMEA is cross-checked only for its individual component events.',
      };
    }

    if (
      isMortalityOutcome(event) ||
      event.hierarchyClassification === 'Efficacy or other clinical outcome' ||
      event.hierarchyClassification === 'Other non-safety data' ||
      event.hierarchyClassification === 'Management / revision method' ||
      isBroadSafetyOutcomeLabel(event.eventName)
    ) {
      return {
        eligible: false,
        reason: 'Summary or clinical outcome, not an individual complication. FMEA cross-check is not applicable.',
      };
    }

    if (
      event.relationshipType === 'unclear' ||
      event.hierarchyRole === 'Review required' ||
      event.hierarchyClassification === 'Hierarchy unclear'
    ) {
      return {
        eligible: false,
        reason: 'Event hierarchy is unclear. Classify it as an individual event before FMEA cross-check.',
      };
    }

    return { eligible: true, reason: 'Individual adverse event / complication eligible for FMEA cross-check.' };
  };


  const getRelevantDueNamesForEvent = (_event: SafetyEventItem): string[] => {
    const names: string[] = [];
    const pushName = (value?: string) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      if (!names.some((name) => normalizeProductName(name) === normalizeProductName(trimmed))) {
        names.push(trimmed);
      }
    };

    // FMEA comparison scope follows the DUE selection made for this appraisal, not the
    // publication group/device assignment. This keeps the rule deterministic:
    //   - Single DUE: compare every eligible event against that DUE's FMEA list.
    //   - Multi DUE: compare every eligible event against the combined FMEA lists of ALL
    //     selected DUEs. A match in any selected DUE is sufficient to avoid a New candidate.
    //
    // Example: if S-Type, D-Type and M-Type are selected, Migration is checked against the
    // FMEA rows for all three products even when the paper reports the event for only one group.
    (fullData.dueList || []).forEach((due) => pushName(due.productName));

    // Backward-compatible fallback for older/single-DUE data structures that may not yet
    // contain dueList.
    if (names.length === 0 && fullData.due?.productName) {
      pushName(fullData.due.productName);
    }

    return names;
  };

  const getCandidateFmeaRowsForEvent = (event: SafetyEventItem): FmeaRegistryRow[] => {
    const checkedProducts = getRelevantDueNamesForEvent(event);
    const candidateRows: FmeaRegistryRow[] = [];
    checkedProducts.forEach((productName) => {
      const rows = fmeaRowsByProduct.get(normalizeProductName(productName)) || [];
      candidateRows.push(...rows);
    });
    return candidateRows;
  };

  const getSimilarRiskGroupsForEvent = (event: SafetyEventItem, limit = 5): FmeaRiskGroup[] => {
    const groups = groupFmeaRowsByRisk(getCandidateFmeaRowsForEvent(event))
      .map((group) => ({ ...group, score: scoreRiskSimilarity(event.eventName, group) }))
      .filter((group) => group.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

    return groups.slice(0, limit);
  };

  const getManualMappedRowsForEvent = (event: SafetyEventItem): FmeaRegistryRow[] => {
    if (!event.fmeaManualMappedRiskKey) return [];
    return getCandidateFmeaRowsForEvent(event).filter(
      (row) => getFmeaRiskKey(row) === event.fmeaManualMappedRiskKey
    );
  };

  const getFmeaScopeLabel = (checkedProducts: string[]) => {
    const dueList = fullData.dueList || [];
    const categoryAllItem = dueList.find(
      (due) => due.selectionMode === 'categoryAll' && due.selectionGroupLabel
    );
    if (categoryAllItem && checkedProducts.length > 1) {
      return `${categoryAllItem.selectionGroupLabel} · ${checkedProducts.length} DUEs`;
    }
    if (checkedProducts.length <= 2) return checkedProducts.join(', ') || 'Not resolved';
    return `${checkedProducts.length} selected DUEs`;
  };

  const getFmeaMatchForEvent = (event: SafetyEventItem): FmeaMatchResult => {
    const checkedProducts = getRelevantDueNamesForEvent(event);
    const eligibility = getFmeaEligibility(event);

    if (!eligibility.eligible) {
      return {
        status: 'not_applicable',
        matchedRows: [],
        candidateRows: 0,
        checkedProducts,
        reason: eligibility.reason,
      };
    }

    if (fmeaLoading) {
      return {
        status: 'unavailable',
        matchedRows: [],
        candidateRows: 0,
        checkedProducts,
        reason: 'FMEA registry is still loading.',
      };
    }
    if (fmeaError || fmeaRows.length === 0) {
      return {
        status: 'unavailable',
        matchedRows: [],
        candidateRows: 0,
        checkedProducts,
        reason: fmeaError
          ? `FMEA registry could not be loaded: ${fmeaError}`
          : 'FMEA registry is unavailable.',
      };
    }

    const candidateRows = getCandidateFmeaRowsForEvent(event);

    // Exact product-name filtering is intentional. If the selected DUE has no registry rows,
    // do not fall back to another product/category because that could hide a genuinely missing risk file.
    return compareEventToFmea(event.eventName, candidateRows, checkedProducts);
  };

  const fmeaMatchByEventId = useMemo(() => {
    const map = new Map<string, FmeaMatchResult>();
    displayedEvents.forEach((event) => map.set(event.id, getFmeaMatchForEvent(event)));
    return map;
    // fmeaRowsByProduct changes only when the live registry changes; safety/fullData changes refresh the event mapping.
  }, [displayedEvents, fmeaLoading, fmeaError, fmeaRowsByProduct, fullData.dueList, fullData.due, researchGroups]);

  const isManuallyClearedNewCandidate = (event: SafetyEventItem, result: FmeaMatchResult) =>
    result.status === 'new' && event.fmeaManualDecision === 'reviewed_not_new';

  const openFmeaReview = (event: SafetyEventItem, result: FmeaMatchResult) => {
    setSelectedSimilarRiskKey(event.fmeaManualMappedRiskKey || '');
    setSelectedFmeaReview({ event, result });
  };

  const handleClearNewFmeaCandidate = (id: string) => {
    const updatedEvents = safety.events.map((event) =>
      event.id === id
        ? {
            ...event,
            fmeaManualDecision: 'reviewed_not_new' as const,
            fmeaManualMappedRiskKey: undefined,
            fmeaManualMappedRiskLabel: undefined,
            isUserModified: true,
          }
        : event
    );

    onUpdateSafety({
      ...safety,
      events: updatedEvents,
    });
  };

  const handleApplySimilarRisk = () => {
    if (!selectedFmeaReview || !selectedSimilarRiskKey) return;
    const suggestion = getSimilarRiskGroupsForEvent(selectedFmeaReview.event).find(
      (group) => group.key === selectedSimilarRiskKey
    );
    if (!suggestion) return;

    const updatedEvents = safety.events.map((event) =>
      event.id === selectedFmeaReview.event.id
        ? {
            ...event,
            fmeaManualDecision: 'reviewed_not_new' as const,
            fmeaManualMappedRiskKey: suggestion.key,
            fmeaManualMappedRiskLabel: suggestion.label,
            isUserModified: true,
          }
        : event
    );

    onUpdateSafety({
      ...safety,
      events: updatedEvents,
    });
    setSelectedFmeaReview(null);
    setSelectedSimilarRiskKey('');
  };

  const handleRestoreNewFmeaCandidate = (id: string) => {
    const updatedEvents = safety.events.map((event) =>
      event.id === id
        ? {
            ...event,
            fmeaManualDecision: undefined,
            fmeaManualNote: undefined,
            fmeaManualMappedRiskKey: undefined,
            fmeaManualMappedRiskLabel: undefined,
            isUserModified: true,
          }
        : event
    );

    onUpdateSafety({
      ...safety,
      events: updatedEvents,
    });
  };


  const groupedEvents: Array<{ groupName: string; events: SafetyEventItem[] }> = displayedEvents.reduce(
    (groups: Array<{ groupName: string; events: SafetyEventItem[] }>, event: SafetyEventItem) => {
      const groupName = resolveEventGroupName(event);
      const existingGroup = groups.find(
        (group) => getGroupKey(group.groupName) === getGroupKey(groupName)
      );

      if (existingGroup) {
        existingGroup.events.push(event);
      } else {
        groups.push({ groupName, events: [event] });
      }

      return groups;
    },
    []
  ).sort((a, b) => {
    const aIndex = researchGroups.findIndex(
      (group) => getGroupKey(group.groupName) === getGroupKey(a.groupName)
    );
    const bIndex = researchGroups.findIndex(
      (group) => getGroupKey(group.groupName) === getGroupKey(b.groupName)
    );
    const aOrder = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const bOrder = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return aOrder - bOrder;
  });

  const getEventsForSummaryGroup = (groupId: string | undefined, groupName: string) =>
    displayedEvents.filter((event) => {
      if (groupId && event.groupId && event.groupId === groupId) return true;
      return getGroupKey(resolveEventGroupName(event)) === getGroupKey(groupName);
    });

  const buildHierarchyRows = (events: SafetyEventItem[]): Array<{ event: SafetyEventItem; depth: number }> => {
    const sourceOrder = new Map(events.map((event, index) => [event.id, index]));
    const byId = new Map(events.map((event) => [event.id, event]));
    const normalizeLabel = (value?: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const resolveParentId = (event: SafetyEventItem): string | undefined => {
      if (event.parentEventId && byId.has(event.parentEventId)) return event.parentEventId;
      if (!event.parentEvent) return undefined;
      const parentLabel = normalizeLabel(event.parentEvent);
      const eventTiming = normalizeLabel(event.timing);
      const match = events.find((candidate) =>
        candidate.id !== event.id &&
        normalizeLabel(candidate.eventName) === parentLabel &&
        (!eventTiming || !candidate.timing || normalizeLabel(candidate.timing) === eventTiming)
      );
      return match?.id;
    };

    const childrenByParent = new Map<string, SafetyEventItem[]>();
    const roots: SafetyEventItem[] = [];
    events.forEach((event) => {
      const parentId = resolveParentId(event);
      if (!parentId || parentId === event.id) {
        roots.push(event);
        return;
      }
      const bucket = childrenByParent.get(parentId) || [];
      bucket.push(event);
      childrenByParent.set(parentId, bucket);
    });

    const sortBySource = (items: SafetyEventItem[]) =>
      items.slice().sort((a, b) => (sourceOrder.get(a.id) ?? 0) - (sourceOrder.get(b.id) ?? 0));
    const rows: Array<{ event: SafetyEventItem; depth: number }> = [];
    const visited = new Set<string>();
    const walk = (event: SafetyEventItem, depth: number, trail = new Set<string>()) => {
      if (visited.has(event.id) || trail.has(event.id)) return;
      visited.add(event.id);
      rows.push({ event, depth: Math.min(depth, 8) });
      const nextTrail = new Set(trail);
      nextTrail.add(event.id);
      sortBySource(childrenByParent.get(event.id) || []).forEach((child) => walk(child, depth + 1, nextTrail));
    };

    sortBySource(roots).forEach((root) => walk(root, 0));
    // Defensive fallback: never hide an event because of an invalid/cyclic parent reference.
    sortBySource(events.filter((event) => !visited.has(event.id))).forEach((event) => walk(event, 0));
    return rows;
  };

  const getUniqueAdverseEventItems = (events: SafetyEventItem[]) =>
    Array.from(
      new Map(
        events
          .filter((event) => event.eventName?.trim())
          .map((event) => {
            const relationKey = `${event.parentEvent || ''}|${event.relationshipType || 'none'}|${event.eventName.trim().toLowerCase()}`;
            return [relationKey, event] as const;
          })
      ).values()
    );

  const rawGroupSummaries = safety.summary.groupSummaries || [];
  const displayGroupSummaries = researchGroups.length > 0
    ? researchGroups.map((researchGroup, index) => {
        const directlyMatchedSummary = rawGroupSummaries.find(
          (summary) =>
            (summary.groupId && summary.groupId === researchGroup.id) ||
            getGroupKey(summary.groupName) === getGroupKey(researchGroup.groupName)
        );
        const summary = directlyMatchedSummary || rawGroupSummaries[index];
        const summaryPopulation = summary?.populationN;

        return {
          groupId: researchGroup.id,
          groupName: researchGroup.groupName,
          deviceName:
            summary?.deviceName ||
            researchGroup.devices?.[0]?.deviceProductName ||
            'Not reported',
          populationN:
            summaryPopulation && summaryPopulation !== 'Not reported'
              ? summaryPopulation
              : researchGroup.groupPatientNumber || 'Not reported',
          patientsWithEvents: summary?.patientsWithEvents || 'Not reported',
          mortality: summary?.mortality || 'Not reported',
          mortalityLabel: summary?.mortalityLabel || 'Mortality',
          mortalityRelatedness: summary?.mortalityRelatedness,
          mortalityVerificationRequired: summary?.mortalityVerificationRequired || false,
          mortalityVerificationNote: summary?.mortalityVerificationNote || '',
          mortalityEvidenceQuote: summary?.mortalityEvidenceQuote || '',
          mortalityEvidenceLocation: summary?.mortalityEvidenceLocation || '',
          seriousAdverseEvents: summary?.seriousAdverseEvents || 'Not reported',
          reinterventions: summary?.reinterventions || 'Not reported',
          evidenceQuote: summary?.evidenceQuote || 'Not reported',
          evidenceLocation: summary?.evidenceLocation || 'Not reported',
        };
      })
    : rawGroupSummaries;

  return (
    <div id="step4-safety-container" className="space-y-6 pb-16">
      {/* Streamlined Header */}
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          FMEA Risk Validation via Safety Events & Recurrence
        </h2>
        <div className="flex items-center gap-3">
          <button
            id="btn-add-safety-event"
            onClick={handleCreateNew}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Safety Event
          </button>
        </div>
      </div>

      {/* Explicit No Events Banner */}
      {safety.summary.status === 'No event reported' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-emerald-950">
              No Safety Events Reported in Publication
            </h4>
            <p className="text-xs text-emerald-800">
              The article explicitly states that no procedure-related or device-related adverse events, complications, or mortalities occurred.
            </p>
          </div>
        </div>
      )}

      {/* Group-Specific Summary Cards (Central Focus) */}
      {displayGroupSummaries.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider px-1">
            Study Group Safety & Reintervention Summaries
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayGroupSummaries.map((gs, idx) => {
              const matchedG = researchGroups.find(
                (g) => g.groupName.toLowerCase() === gs.groupName.toLowerCase() || (gs.groupId && g.id === gs.groupId)
              );
              const denom = gs.populationN || matchedG?.groupPatientNumber || '';
              const devName = gs.deviceName || matchedG?.devices?.[0]?.deviceProductName || 'Not reported';
              const groupAdverseEventItems = getUniqueAdverseEventItems(
                getEventsForSummaryGroup(gs.groupId, gs.groupName)
              );
              const groupHierarchyRows = buildHierarchyRows(groupAdverseEventItems);

              return (
                <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="font-bold text-base text-slate-900">
                        {gs.groupName} (n={denom})
                      </h4>
                      <p className="text-xs text-indigo-700 font-medium mt-0.5">
                        Device: {devName}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-700 font-mono text-xs font-bold rounded">
                      N={denom}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                      <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Reintervention
                      </span>
                      <div className="font-mono font-bold text-slate-900 text-xs">
                        {formatMetricDisplay(gs.reinterventions, denom)}
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                          {gs.mortalityLabel || 'Mortality'}
                        </span>
                        <SelfValidationBadge issues={issuesForTarget(selfValidation, `step4.group.${gs.groupId || idx}.mortality`)} />
                      </div>
                      <div className="font-mono font-bold text-slate-900 text-xs">
                        {formatMetricDisplay(gs.mortality, denom)}
                      </div>
                      {gs.mortalityVerificationRequired && (
                        <div
                          className="mt-1.5 inline-flex items-start gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-1 text-[9px] font-semibold leading-tight text-amber-900"
                          title={[gs.mortalityEvidenceQuote, gs.mortalityEvidenceLocation].filter(Boolean).join(' · ') || undefined}
                        >
                          <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                          <span>{gs.mortalityVerificationNote || 'Stent/device-relatedness requires verification.'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <h5 className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-2">
                      Adverse Events / Complications
                    </h5>
                    {groupHierarchyRows.length > 0 ? (
                      <ul className="space-y-1.5">
                        {groupHierarchyRows.map(({ event, depth }) => (
                          <li
                            key={`${event.id}-${event.parentEvent || 'root'}`}
                            className="flex items-start gap-2 text-xs text-slate-800"
                            style={{ paddingLeft: `${depth * 16}px` }}
                          >
                            <span className={`mt-1 shrink-0 ${depth > 0 ? 'text-slate-400' : 'h-1.5 w-1.5 rounded-full bg-amber-500'}`}>
                              {depth > 0 ? '↳' : ''}
                            </span>
                            <span className="font-medium">{event.eventName}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400 italic">
                        No group-specific adverse events reported.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Events Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">
            Extracted Safety Events & Recurrence Causes
          </h3>
          <span className="text-xs text-slate-500">
            {displayedEvents.length} event item{displayedEvents.length === 1 ? '' : 's'}
          </span>
        </div>

        {displayedEvents.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium">No safety events reported.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/75 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-3 px-4 w-44">Study Group / Device</th>
                  <th className="py-3 px-4 w-52">Reported Event</th>
                  <th className="py-3 px-3 w-36">Event Type</th>
                  <th className="py-3 px-2.5 text-center w-20">n/N</th>
                  <th className="py-3 px-2.5 text-center w-28">%</th>
                  <th className="py-3 px-3 w-36">FMEA Cross-Check</th>
                  <th className="py-3 px-3 w-36">Risk Control</th>
                  <th className="py-3 px-3 w-40">Original Evidence & Location</th>
                  <th className="py-3 px-3 text-right w-20">Actions</th>
                </tr>
              </thead>
              {groupedEvents.map(({ groupName, events }, groupIndex) => (
                <tbody
                  key={`${groupName}-${groupIndex}`}
                  className="divide-y divide-slate-100 border-t-2 border-slate-200 first:border-t-0"
                >
                  {buildHierarchyRows(events).map(({ event: ev, depth }, eventIndex) => {
                    const eventTypeKey = ev.eventType || 'Adverse Event / Complication';
                    const typeStyle = EVENT_TYPE_COLORS[eventTypeKey] || EVENT_TYPE_COLORS['Adverse Event / Complication'];
                    const isReviewRequired = ev.classificationStatus === 'review_required';
                    const fmeaMatch = fmeaMatchByEventId.get(ev.id) || getFmeaMatchForEvent(ev);
                    const newCandidateCleared = isManuallyClearedNewCandidate(ev, fmeaMatch);
                    const showNewCandidate = fmeaMatch.status === 'new' && !newCandidateCleared;
                    const isAggregateEvent =
                      ev.isAggregate === true ||
                      ev.relationshipType === 'aggregate' ||
                      ev.hierarchyRole === 'Aggregate event' ||
                      ev.hierarchyRole === 'Subtotal/Summary' ||
                      ev.hierarchyClassification === 'Summary total' ||
                      hasLinkedChildEvents(ev) ||
                      Boolean(ev.breakdowns && ev.breakdowns.length > 0);
                    const showReviewHighlight = fmeaMatch.status === 'review' || isReviewRequired;
                    const fmeaRowClass =
                      showNewCandidate
                        ? 'bg-rose-100/90 hover:bg-rose-100 shadow-[inset_4px_0_0_0_rgb(244,63,94)]'
                        : showReviewHighlight
                          ? 'bg-amber-200/85 hover:bg-amber-200 shadow-[inset_4px_0_0_0_rgb(245,158,11)]'
                          : 'hover:bg-slate-50/75';

                    return (
                      <tr key={ev.id} className={`${fmeaRowClass} transition-colors`}>
                        {eventIndex === 0 && (
                          <td
                            rowSpan={events.length}
                            className="py-3 px-4 align-top bg-indigo-50/60 border-r border-indigo-100"
                          >
                            <span className="font-bold text-indigo-950 leading-snug">
                              {groupName}
                            </span>
                          </td>
                        )}

                        {/* Reported Event */}
                        <td className="py-3 px-4 font-semibold text-slate-900 align-top">
                          <div
                            className={depth > 0 ? 'border-l-2 border-slate-200' : ''}
                            style={{ paddingLeft: depth > 0 ? `${depth * 16}px` : undefined }}
                          >
                            <div className="font-bold leading-snug">
                              <span className={showNewCandidate ? 'text-rose-900' : 'text-slate-900'}>{ev.eventName}</span>
                              <SelfValidationBadge className="ml-1.5 align-middle" issues={issuesForTarget(selfValidation, `step4.event.${ev.id}`)} />
                            </div>
                            {(newCandidateCleared || isReviewRequired) && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {newCandidateCleared && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-700 font-bold text-[10px] rounded border border-sky-200">
                                    <CheckCircle2 className="w-3 h-3" /> Candidate cleared
                                  </span>
                                )}
                                {isReviewRequired && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-300 text-amber-950 font-extrabold text-[10px] rounded border border-amber-500">
                                    <AlertTriangle className="w-3 h-3" /> Review Required
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Event Type */}
                        <td className="py-3 px-3 align-top">
                          <span className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-md border ${typeStyle.bg} ${typeStyle.text} ${typeStyle.border}`}>
                            {eventTypeKey}
                          </span>
                        </td>

                        {/* n/N */}
                        <td className="py-3 px-2.5 text-center font-mono font-bold text-slate-900 align-top">
                          {ev.countN}
                        </td>

                        {/* Percentage: preserve paper-reported value, calculate from n/N only when safe */}
                        <td className="py-3 px-2.5 text-center font-medium text-slate-800 align-top">
                          {(() => {
                            const percent = getPercentagePresentation(ev);
                            return (
                              <div
                                className="flex flex-col items-center gap-1"
                                title={ev.percentageAssessmentNote || undefined}
                              >
                                <span className={`font-semibold ${percent.value === 'N/A' ? 'text-slate-400 italic' : 'text-slate-900'}`}>
                                  {percent.value}
                                </span>
                                {percent.badge && (
                                  <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-semibold rounded border ${percent.badgeClass}`}>
                                    {percent.badge}
                                  </span>
                                )}
                                {percent.secondary && (
                                  <span className="text-[9px] text-slate-500 leading-tight">
                                    {percent.secondary}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* FMEA Cross-Check */}
                        <td className="py-3 px-3 align-top">
                          <div className="flex flex-col items-start gap-1.5">
                            {fmeaMatch.status === 'existing' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3" /> Existing
                              </span>
                            )}
                            {fmeaMatch.status === 'review' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500 bg-amber-300 text-amber-950 text-[10px] font-extrabold">
                                <AlertTriangle className="w-3 h-3" /> Review
                              </span>
                            )}
                            {showNewCandidate && (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rose-400 bg-rose-200 text-rose-900 text-[10px] font-extrabold">
                                  <AlertTriangle className="w-3 h-3" /> New FMEA risk candidate
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleClearNewFmeaCandidate(ev.id)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 hover:text-sky-900 hover:underline"
                                  title="Manually review this candidate and remove the New highlight"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Mark as reviewed
                                </button>
                              </>
                            )}
                            {newCandidateCleared && (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700 text-[10px] font-bold">
                                  <CheckCircle2 className="w-3 h-3" /> Reviewed
                                </span>
                                {ev.fmeaManualMappedRiskLabel && (
                                  <span className="inline-flex px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                    Mapped: {ev.fmeaManualMappedRiskLabel}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRestoreNewFmeaCandidate(ev.id)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-rose-700 hover:underline"
                                  title="Restore the automatic New FMEA risk candidate status"
                                >
                                  <RefreshCw className="w-3 h-3" /> Restore New
                                </button>
                              </>
                            )}
                            {fmeaMatch.status === 'not_applicable' && !isAggregateEvent && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                N/A
                              </span>
                            )}
                            {fmeaMatch.status === 'unavailable' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500 text-[10px] font-bold">
                                Not checked
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Risk Control */}
                        <td className="py-3 px-3 align-top">
                          {(fmeaMatch.status === 'existing' || fmeaMatch.status === 'review') && fmeaMatch.matchedRows.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => openFmeaReview(ev, fmeaMatch)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold hover:bg-indigo-100 hover:text-indigo-900"
                            >
                              <Eye className="w-3.5 h-3.5" /> View Risk Control
                            </button>
                          ) : fmeaMatch.status === 'new' && ev.fmeaManualMappedRiskKey && getManualMappedRowsForEvent(ev).length > 0 ? (
                            <button
                              type="button"
                              onClick={() => openFmeaReview(ev, fmeaMatch)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold hover:bg-indigo-100 hover:text-indigo-900"
                            >
                              <Eye className="w-3.5 h-3.5" /> View Selected Risk Control
                            </button>
                          ) : fmeaMatch.status === 'new' ? (
                            <button
                              type="button"
                              onClick={() => openFmeaReview(ev, fmeaMatch)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-bold hover:bg-amber-100 hover:text-amber-950"
                            >
                              <Eye className="w-3.5 h-3.5" /> Review Similar Risks
                            </button>
                          ) : null}
                        </td>

                        {/* Original Evidence & Location */}
                        <td className="py-3 px-3 align-top">
                          <button
                            type="button"
                            onClick={() => setSelectedEvidenceEvent(ev)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-[10px] font-bold hover:bg-slate-50 hover:text-slate-950"
                          >
                            <Eye className="w-3.5 h-3.5" /> View Evidence
                          </button>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right align-top">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingEvent(ev);
                                setIsAddingNew(false);
                              }}
                              title="Edit Event"
                              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {ev.aiRecommended && (
                              <button
                                onClick={() => handleResetToAi(ev.id)}
                                title="Reset to AI Recommended"
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteEvent(ev.id)}
                              title="Delete Event"
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>

      {/* Original Evidence & Location Modal */}
      {selectedEvidenceEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-3xl max-h-[82vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Original Evidence & Location</h3>
                <p className="text-sm font-semibold text-slate-800 mt-1">
                  Reported event: {selectedEvidenceEvent.eventName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvidenceEvent(null)}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                aria-label="Close original evidence modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Original evidence</p>
                <blockquote className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 italic text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                  &ldquo;{selectedEvidenceEvent.evidenceQuote || 'Not reported'}&rdquo;
                </blockquote>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Location</p>
                <span className="inline-flex px-2.5 py-1.5 bg-slate-100 rounded-md text-xs font-semibold text-slate-700 border border-slate-200">
                  {selectedEvidenceEvent.evidenceLocation || 'Not reported'}
                </span>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedEvidenceEvent(null)}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FMEA Risk Control Modal */}
      {selectedFmeaReview && (() => {
        const selectedEvent = selectedFmeaReview.event;
        const selectedResult = selectedFmeaReview.result;
        const manualMappedRows = getManualMappedRowsForEvent(selectedEvent);
        const isManualMapped = Boolean(selectedEvent.fmeaManualMappedRiskKey && manualMappedRows.length > 0);
        const isNewCandidateReview = selectedResult.status === 'new' && !isManualMapped;
        const displayRows = isManualMapped ? manualMappedRows : selectedResult.matchedRows;
        const displayRiskGroups = groupFmeaRowsByRisk(displayRows);
        const similarRiskGroups = selectedResult.status === 'new'
          ? getSimilarRiskGroupsForEvent(selectedEvent)
          : [];
        const statusLabel = isManualMapped
          ? 'Selected Existing Risk'
          : selectedResult.status === 'existing'
            ? 'Existing'
            : selectedResult.status === 'review'
              ? 'Review'
              : 'New Candidate Review';
        const statusClass = isManualMapped || selectedResult.status === 'existing'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
            <div className="w-full max-w-4xl max-h-[86vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-slate-900">FMEA Risk Control</h3>
                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mt-1">
                    Reported event: {selectedEvent.eventName}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    FMEA scope: {getFmeaScopeLabel(selectedResult.checkedProducts)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFmeaReview(null);
                    setSelectedSimilarRiskKey('');
                  }}
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                  aria-label="Close FMEA risk control modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-6 py-5 space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {isManualMapped
                      ? `This event was manually mapped to the existing FMEA risk “${selectedEvent.fmeaManualMappedRiskLabel || 'Selected risk'}”.`
                      : selectedResult.reason}
                  </p>
                </div>

                {isNewCandidateReview ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Similar existing risks</h4>
                        <p className="text-xs text-slate-500 mt-1">
                          No direct FMEA match was found. Review the closest existing risks and select one only if it represents the same risk.
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        Top {similarRiskGroups.length} suggestion{similarRiskGroups.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {similarRiskGroups.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                        <p className="text-xs font-semibold text-slate-700">No similar existing FMEA risk was identified.</p>
                        <p className="text-[11px] text-slate-500 mt-1">Keep this item as a New FMEA risk candidate and review it manually.</p>
                      </div>
                    ) : (
                      similarRiskGroups.map((group, index) => (
                        <label
                          key={group.key}
                          className={`block rounded-xl border p-4 cursor-pointer transition-colors ${
                            selectedSimilarRiskKey === group.key
                              ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-300'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              name="similar-fmea-risk"
                              value={group.key}
                              checked={selectedSimilarRiskKey === group.key}
                              onChange={() => setSelectedSimilarRiskKey(group.key)}
                              className="mt-1 h-4 w-4 border-slate-300 text-indigo-700 focus:ring-indigo-600"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] font-bold text-slate-500">Candidate {index + 1}</span>
                                  <span className="text-sm font-bold text-slate-900">{group.label}</span>
                                </div>
                                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5">
                                  {group.products.length} DUE{group.products.length === 1 ? '' : 's'}
                                </span>
                              </div>

                              {group.hazardousSituations.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Hazardous situation</p>
                                  <p className="text-xs text-slate-800 mt-0.5 whitespace-pre-line">
                                    {group.hazardousSituations.join(' / ')}
                                  </p>
                                </div>
                              )}

                              {group.controls.length > 0 && (
                                <details className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2">
                                  <summary className="cursor-pointer text-[11px] font-bold text-emerald-800">
                                    View risk reduction control{group.controls.length === 1 ? '' : 's'} ({group.controls.length})
                                  </summary>
                                  <div className="mt-2 space-y-2">
                                    {group.controls.map((control, controlIndex) => (
                                      <div key={`${group.key}-control-${controlIndex}`} className="text-xs text-slate-800">
                                        <p className="whitespace-pre-line">{control.text}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                          Applies to {control.products.length} selected DUE{control.products.length === 1 ? '' : 's'}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}

                              {group.products.length > 1 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-[10px] font-semibold text-slate-500 hover:text-slate-800">
                                    Show applicable DUEs
                                  </summary>
                                  <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
                                    {group.products.join(', ')}
                                  </p>
                                </details>
                              )}
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                ) : displayRiskGroups.length > 0 ? (
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Matched FMEA risk controls</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Duplicate product rows are grouped by risk so category-wide DUE selections remain compact.
                      </p>
                    </div>

                    {displayRiskGroups.map((group) => (
                      <div key={group.key} className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-indigo-50/60 border-b border-indigo-100">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="text-sm font-bold text-indigo-950">{group.label}</span>
                              {group.docNos.length > 0 && (
                                <span className="ml-2 text-[10px] font-mono font-semibold text-indigo-700">
                                  {group.docNos.length === 1 ? group.docNos[0] : `${group.docNos.length} FMEA documents`}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-semibold text-indigo-700 bg-white/80 border border-indigo-200 rounded px-2 py-0.5">
                              Applies to {group.products.length} DUE{group.products.length === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                          <div className="p-4 border-b md:border-b-0 md:border-r border-slate-200">
                            {group.hazardousSituations.length > 0 && (
                              <div className="mb-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Hazardous situation</p>
                                <p className="text-sm text-slate-900 whitespace-pre-line">{group.hazardousSituations.join('\n• ')}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Harm</p>
                              <p className="text-sm font-semibold text-slate-900 whitespace-pre-line">
                                {group.harms.join('\n• ') || 'Not reported'}
                              </p>
                            </div>
                            {group.products.length > 1 && (
                              <details className="mt-3">
                                <summary className="cursor-pointer text-[10px] font-semibold text-slate-500 hover:text-slate-800">
                                  Show applicable DUEs
                                </summary>
                                <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{group.products.join(', ')}</p>
                              </details>
                            )}
                          </div>

                          <div className="p-4 bg-emerald-50/30">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-2">Risk reduction control(s)</p>
                            {group.controls.length > 0 ? (
                              <div className="space-y-3">
                                {group.controls.map((control, controlIndex) => (
                                  <div key={`${group.key}-matched-control-${controlIndex}`} className="border-b border-emerald-100 last:border-b-0 pb-2 last:pb-0">
                                    <p className="text-sm text-slate-900 whitespace-pre-line leading-relaxed">{control.text}</p>
                                    {control.products.length > 1 && (
                                      <p className="text-[10px] text-slate-500 mt-1">
                                        Used by {control.products.length} selected DUEs
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500 italic">Not reported</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                    <p className="text-xs font-semibold text-slate-700">No FMEA risk control rows are available for this item.</p>
                  </div>
                )}
              </div>

              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  Source: Live Google Sheet · {FMEA_SHEET_NAME}
                </span>
                <div className="flex items-center gap-2">
                  {isNewCandidateReview && similarRiskGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={handleApplySimilarRisk}
                      disabled={!selectedSimilarRiskKey}
                      className="px-4 py-2 bg-indigo-700 text-white text-xs font-bold rounded-lg hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Use Selected Risk
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFmeaReview(null);
                      setSelectedSimilarRiskKey('');
                    }}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-black"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Navigation Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
        <button
          id="btn-back-to-step3"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 shadow-xs transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Step 3: Article Appraisal
        </button>

        <div className="flex items-center gap-3">
          {onNewEvaluation && (
            <button
              onClick={onNewEvaluation}
              className="px-5 py-2.5 bg-white hover:bg-slate-900 hover:text-white text-slate-900 text-sm font-bold rounded-md border-2 border-slate-900 shadow-sm transition-colors"
            >
              Start New Evaluation
            </button>
          )}
        </div>
      </div>

      {/* Add / Edit Event Modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                {isAddingNew ? 'Add Observed Safety Event' : 'Edit Safety Event Item'}
              </h3>
              <button
                onClick={() => {
                  setEditingEvent(null);
                  setIsAddingNew(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="md:col-span-2 space-y-1">
                <label className="font-semibold text-slate-700">Event / Complication / Recurrence Name (Verbatim) *</label>
                <input
                  type="text"
                  value={editingEvent.eventName}
                  onChange={(e) => setEditingEvent({ ...editingEvent, eventName: e.target.value })}
                  placeholder="e.g. Stent migration, Tumour ingrowth, Stent fracture"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Event Type *</label>
                <select
                  value={editingEvent.eventType || 'Adverse Event / Complication'}
                  onChange={(e) =>
                    setEditingEvent({
                      ...editingEvent,
                      eventType: e.target.value as any,
                    })
                  }
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                >
                  <option value="Adverse Event / Complication">Adverse Event / Complication</option>
                  <option value="Cause of Recurrence">Cause of Recurrence</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Hierarchy Relationship</label>
                <select
                  value={editingEvent.relationshipType || 'none'}
                  onChange={(e) => {
                    const relationshipType = e.target.value as SafetyEventItem['relationshipType'];
                    setEditingEvent({
                      ...editingEvent,
                      relationshipType,
                      parentEvent:
                        relationshipType === 'component' || relationshipType === 'cause'
                          ? editingEvent.parentEvent
                          : undefined,
                      parentEventId:
                        relationshipType === 'component' || relationshipType === 'cause'
                          ? editingEvent.parentEventId
                          : undefined,
                    });
                  }}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                >
                  <option value="none">Independent event</option>
                  <option value="aggregate">Aggregate / total</option>
                  <option value="component">Component of parent event</option>
                  <option value="cause">Cause of parent event</option>
                  <option value="unclear">Unclear / needs review</option>
                </select>
              </div>

              {(editingEvent.relationshipType === 'component' || editingEvent.relationshipType === 'cause') && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Parent Event</label>
                  <select
                    value={editingEvent.parentEvent || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, parentEvent: e.target.value || undefined })}
                    className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                  >
                    <option value="">Select parent event</option>
                    {safety.events
                      .filter((event) => event.id !== editingEvent.id)
                      .map((event) => (
                        <option key={event.id} value={event.eventName}>
                          {event.eventName}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Timing</label>
                <input
                  type="text"
                  value={editingEvent.timing}
                  onChange={(e) => setEditingEvent({ ...editingEvent, timing: e.target.value })}
                  placeholder="e.g. N/A or 112 days after stent placement"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Study Group / Device</label>
                <select
                  value={editingEvent.studyGroupOrDevice}
                  onChange={(e) => setEditingEvent({ ...editingEvent, studyGroupOrDevice: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                >
                  {groupOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Count n/N</label>
                <input
                  type="text"
                  value={editingEvent.countN}
                  onChange={(e) => setEditingEvent({ ...editingEvent, countN: e.target.value })}
                  placeholder="e.g. 8/59"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Reported % in Paper</label>
                <input
                  type="text"
                  value={editingEvent.reportedRate}
                  onChange={(e) => setEditingEvent({ ...editingEvent, reportedRate: e.target.value })}
                  placeholder="e.g. 13.6% or Not reported"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-semibold text-slate-700">Exact Evidence Quote *</label>
                <textarea
                  rows={2}
                  value={editingEvent.evidenceQuote}
                  onChange={(e) => setEditingEvent({ ...editingEvent, evidenceQuote: e.target.value })}
                  placeholder="Verbatim sentence from publication results or table"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-semibold text-slate-700">Location in Article *</label>
                <input
                  type="text"
                  value={editingEvent.evidenceLocation}
                  onChange={(e) => setEditingEvent({ ...editingEvent, evidenceLocation: e.target.value })}
                  placeholder="e.g. Table 2, Results"
                  className="w-full p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setEditingEvent(null);
                  setIsAddingNew(false);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveEvent(editingEvent)}
                disabled={!editingEvent.eventName.trim()}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold transition-colors disabled:opacity-50"
              >
                Save Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
