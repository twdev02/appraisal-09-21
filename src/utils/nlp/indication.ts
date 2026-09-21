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

import { normalizeText, type IndicationClassificationResult } from './deviceMatching';

import { expandMedicalAcronyms } from './medicalText';

/**
 * Helper to normalize and singularize medical terms
 */
export function normalizeMedicalWord(w: string): string {
  const s = w.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return s
    .replace(/strictures$/, 'stricture')
    .replace(/pseudocysts$/, 'pseudocyst')
    .replace(/obstructions$/, 'obstruction')
    .replace(/cancers$/, 'cancer')
    .replace(/carcinomas$/, 'carcinoma')
    .replace(/tumors$/, 'tumor')
    .replace(/fistulae$/, 'fistula')
    .replace(/fistulas$/, 'fistula')
    .replace(/lesions$/, 'lesion')
    .replace(/stents$/, 'stent')
    .replace(/tracts$/, 'tract')
    .replace(/ducts$/, 'duct')
    .replace(/collections$/, 'collection')
    .replace(/cholecystitis$/, 'gallbladder')
    .replace(/cholecysto?/, 'gallbladder');
}

/**
 * Generic grammatical and medical semantic parser for DUE indications.
 */
export function parseGenericDueIndications(rawText: string): string[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const text = rawText.trim();
  if (!text) return [];

  // 1. Check for explicit list delimiters
  if (text.includes('\n') || text.includes(';') || /^[•\-\*]\s+/m.test(text) || /\b\d+[\.\)]\s+/.test(text)) {
    const lines = text
      .split(/(?:\r?\n|[;]|(?<=\s|^)[•\-\*]\s+|(?<=\s|^)\d+[\.\)]\s+)/)
      .map((item) => cleanIndicationChip(item))
      .filter((item) => item.length > 1);
    if (lines.length > 1) {
      return Array.from(new Set(lines));
    }
  }

  // 2. Generic Medical Prefix + Coordinated Conjunction Parsing
  const prefixRegex = /^((?:(?:trans[a-z]+|percutaneous|endoscopic|laparoscopic|transmural|retrograde|antegrade|open|surgical)\s+(?:or|and)\s+(?:trans[a-z]+|percutaneous|endoscopic|laparoscopic|transmural|retrograde|antegrade|open|surgical)\s+)?.*?\b(?:drainage|decompression|stenting|placement|treatment|palliation|palliative\s+management|management|bypass|dilation|reconstruction|restoration|intervention|ablation|cannulation)\s+(?:of|for|in|in\s+patients\s+with)\s+)(.*)$/i;

  const match = text.match(prefixRegex);
  if (match) {
    const rawPrefix = match[1];
    const rawTargets = match[2].trim().replace(/\.$/, '');

    const targetParts = rawTargets
      .split(/\s+(?:or|and)\s+|\s*,\s*(?:or|and)?\s*/i)
      .map((t) => t.trim())
      .filter(Boolean);

    if (targetParts.length > 1) {
      const cleanPrefix = rawPrefix.trim();
      const prefixHasOf = /\bof$/i.test(cleanPrefix);
      const prefixWithoutOf = cleanPrefix.replace(/\s+of$/i, '').trim();

      const candidateChips: string[] = [];
      for (const part of targetParts) {
        const cleanTarget = part.replace(/^(?:a|an|the)\s+/i, '').trim();
        if (!cleanTarget) continue;

        const hasConditionWord = /(?:pseudocyst|necrosis|stricture|obstruction|fistula|leak|stenosis|cancer|carcinoma|tumor|malignan|benign|disease|syndrome|lesion|collection)/i.test(cleanTarget);
        let combined = '';

        if (!hasConditionWord && prefixHasOf && /\bdrainage\s+of$/i.test(cleanPrefix)) {
          const baseAccess = prefixWithoutOf.replace(/\s*drainage$/i, '').trim();
          combined = baseAccess ? `${baseAccess} ${cleanTarget} drainage` : `${cleanTarget} drainage`;
        } else {
          combined = `${cleanPrefix} ${cleanTarget}`;
        }

        candidateChips.push(cleanIndicationChip(combined));
      }

      if (candidateChips.length > 0) {
        return candidateChips;
      }
    }
  }

  // 3. Fallback: Split on top-level comma or semicolon if multiple distinct clauses
  const commaSeparated = text.split(/,\s+(?:and|or)\s+|;\s*/i);
  if (commaSeparated.length > 1) {
    const list = commaSeparated.map((c) => cleanIndicationChip(c)).filter((c) => c.length > 1);
    if (list.length > 1) return Array.from(new Set(list));
  }

  // Single indication
  return [cleanIndicationChip(text)];
}

function cleanIndicationChip(str: string): string {
  let s = str.trim().replace(/^[\s•\-\*\d\.\)\(;]+/, '').replace(/[\s\.\);,]+$/, '').trim();
  s = s.replace(/^(?:a|an|the)\s+/i, '');
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Detects core target organ and intervention type from indication text
 */
function identifyCoreTargetAndAction(text: string): {
  organ: 'gallbladder' | 'pancreatic_pseudocyst' | 'walled_off_necrosis' | 'pancreatic_duct' | 'biliary_tract' | 'esophageal' | 'colonic' | 'gastrointestinal' | 'other';
  action: 'drainage' | 'bypass' | 'stenting' | 'dilation' | 'other';
  hasGallbladder: boolean;
  hasBiliary: boolean;
  hasPseudocyst: boolean;
  hasNecrosis: boolean;
  hasPancreaticDuct: boolean;
  hasEsophageal: boolean;
  hasColonic: boolean;
} {
  const expanded = expandMedicalAcronyms(text).toLowerCase();
  
  const hasGallbladder = /(?:gallbladder|cholecyst|gb|gbd|cholecystostomy|cholecystogastrostomy|cholecystoduodenostomy)/i.test(expanded);
  const hasPseudocyst = /(?:pseudocyst|pancreatic\s+cyst|cystogastrostomy|cystoduodenostomy|pancreatic\s+fluid\s+collection|pfc)/i.test(expanded);
  const hasNecrosis = /(?:walled[- ]off\s+necrosis|won|wopn|necrotizing\s+pancreatitis|necrosectomy|necrosis)/i.test(expanded);
  const hasPancreaticDuct = /(?:pancreatic\s+duct(?:al)?|main\s+pancreatic\s+duct|\bmpd\b)/i.test(expanded) && !hasPseudocyst && !hasNecrosis;
  const hasBiliary = /(?:biliary|bile\s+duct|cbd|choledoch|hepatic|hepaticogastrostomy|choledochoduodenostomy|biliary\s+tract)/i.test(expanded) && !hasGallbladder;
  const hasEsophageal = /(?:esophageal|esophagus|esophag|dysphagia|tracheoesophageal)/i.test(expanded);
  const hasColonic = /(?:colonic|colon|colorectal|rectal|rectum)/i.test(expanded);

  let organ: 'gallbladder' | 'pancreatic_pseudocyst' | 'walled_off_necrosis' | 'pancreatic_duct' | 'biliary_tract' | 'esophageal' | 'colonic' | 'gastrointestinal' | 'other' = 'other';
  if (hasGallbladder) organ = 'gallbladder';
  else if (hasNecrosis) organ = 'walled_off_necrosis';
  else if (hasPseudocyst) organ = 'pancreatic_pseudocyst';
  else if (hasPancreaticDuct) organ = 'pancreatic_duct';
  else if (hasBiliary) organ = 'biliary_tract';
  else if (hasEsophageal) organ = 'esophageal';
  else if (hasColonic) organ = 'colonic';
  else if (/(?:gastroenterostomy|gastrojejunostomy|gastric\s+outlet|duodenal)/i.test(expanded)) organ = 'gastrointestinal';

  let action: 'drainage' | 'bypass' | 'stenting' | 'dilation' | 'other' = 'drainage';
  if (/(?:bypass|gastroenterostomy|gastrojejunostomy)/i.test(expanded)) action = 'bypass';
  else if (/(?:dilation|dilatation)/i.test(expanded)) action = 'dilation';
  else if (/(?:drainage|decompression|evacuation|stenting|placement|palliation)/i.test(expanded)) action = 'drainage';

  return {
    organ,
    action,
    hasGallbladder,
    hasBiliary,
    hasPseudocyst,
    hasNecrosis,
    hasPancreaticDuct,
    hasEsophageal,
    hasColonic,
  };
}

/**
 * Evaluates Indication Relationship across all configured DUE indications.
 * Rules:
 * 1. Multi-indication comparison: Compares against ALL configured DUE indications and picks the best matching indication.
 * 2. Acronym expansion: EUS-GBD is expanded to EUS-guided gallbladder drainage.
 * 3. EUS-guided gallbladder drainage and transgastric or transduodenal gallbladder drainage are clinically equivalent (Same use / Same indication).
 * 4. Secondary clinical context (e.g. 'for jaundice palliation in malignant biliary obstruction') is recognized as underlying patient etiology and does not negate the primary target organ drainage match.
 * 5. Access route nuances (EUS/transmural/transgastric/transduodenal) do not cause Major deviation when target organ and drainage match.
 */
export function cleanExtractedIndicationText(raw: string): { cleaned: string; isRelationshipOnly: boolean } {
  if (!raw) return { cleaned: '', isRelationshipOnly: false };
  let s = raw.trim();
  const lower = s.toLowerCase();
  
  const pureRelationships = ['same indication', 'related indication', 'different indication', 'mixed indication', 'not reported', 'not assessable', 'review required'];
  if (pureRelationships.includes(lower)) {
    return { cleaned: '', isRelationshipOnly: true };
  }

  // Remove trailing parenthetical or hyphenated relationship e.g. " (Same indication)" or "- Same indication"
  s = s.replace(/\s*\((?:same|related|different|mixed|not reported|not assessable|review\s*required)\s*indication\)?\s*$/i, '');
  s = s.replace(/\s*\((?:same|related|different|mixed|not reported)\)\s*$/i, '');
  s = s.replace(/\s*-\s*(?:same|related|different|mixed|not reported)\s*indication\s*$/i, '');
  
  return { cleaned: s.trim(), isRelationshipOnly: false };
}

export function splitExtractedIndications(text: string): string[] {
  const { cleaned, isRelationshipOnly } = cleanExtractedIndicationText(text);
  if (isRelationshipOnly || !cleaned) return [];
  
  // Split on slash, comma, semicolon, or ' and ', ' or '
  const parts = cleaned.split(/\s*[\/\,\;]\s+|\s+(?:and|or)\s+/i);
  return parts.map(p => p.trim()).filter(Boolean);
}

/**
 * Evaluates Indication Relationship across all configured DUE indications.
 * Rules:
 * 1. Multi-indication comparison: Compares against ALL configured DUE indications and picks the best matching indication.
 * 2. Cleaning and Validation: Strips relationship labels and validates extracted indications.
 * 3. Gastric Outlet / Gastroduodenal umbrella match support.
 * 4. Strict Rationale Formatting.
 */
export function classifyIndicationRelationship(
  extractedIndication: string,
  dueIndications: string[]
): {
  type: IndicationRelationshipType;
  rationale: string;
  matchedDueIndication?: string;
} {
  const { cleaned, isRelationshipOnly } = cleanExtractedIndicationText(extractedIndication);
  if (isRelationshipOnly || !cleaned) {
    return {
      type: 'Not reported',
      rationale: 'Medical indication for this group/device is not reported or contains only relationship labels.',
    };
  }

  const validDueList = dueIndications.filter((d) => d && d.trim().length > 0);
  if (validDueList.length === 0) {
    return {
      type: 'Not assessable',
      rationale: 'No DUE indications are configured for comparison.',
    };
  }

  const extractedParts = splitExtractedIndications(cleaned);
  const itemsToCompare = extractedParts.length > 0 ? extractedParts : [cleaned];

  const dueLowerList = validDueList.map(d => ({ raw: d, lower: d.toLowerCase(), expanded: expandMedicalAcronyms(d).toLowerCase() }));
  
  const dueHasPyloric = dueLowerList.some(d => /pyloric|pylorus|gastric\s+outlet|goo|gastroduodenal/i.test(d.expanded));
  const dueHasDuodenal = dueLowerList.some(d => /duodenal|duodenum|gastroduodenal/i.test(d.expanded));
  const dueCoversPyloricAndDuodenal = (validDueList.length >= 2 || (dueHasPyloric && dueHasDuodenal)) || dueLowerList.some(d => /gastroduodenal|gastric\s+outlet\s+obstruction|goo/i.test(d.expanded));

  const expandedExt = expandMedicalAcronyms(cleaned).toLowerCase();

  // Malignant gastric-outlet disease is often described by enumerating the
  // obstructed sites instead of using the literal term "gastric outlet
  // obstruction". Keep the complete cohort phrase together and treat it as
  // the same clinical indication as malignant pyloric/duodenal obstruction.
  const dueHasMalignantPyloricDuodenalScope = dueLowerList.some(
    d =>
      /malignant|cancer|carcinoma|neoplasm|tumou?r/.test(d.expanded) &&
      /pyloric|pylorus|duodenal|duodenum|gastroduodenal|gastric\s+outlet|goo/.test(d.expanded)
  );
  const extractedIsMalignantObstruction =
    /malignant|unresectable|cancer|carcinoma|neoplasm|tumou?r/.test(expandedExt) &&
    /obstruction|stricture|stenosis/.test(expandedExt);
  const extractedHasGastricOutletSiteEnumeration =
    /(?:obstruction|stricture|stenosis)\s+of\s+(?:the\s+)?(?:stomach|duodenum)/.test(expandedExt) ||
    (/stomach/.test(expandedExt) && /duoden(?:um|al)/.test(expandedExt)) ||
    (/duoden(?:um|al)/.test(expandedExt) && /gastroenteric|gastrojejunostomy|gastroduodenostomy|anastomotic\s+site/.test(expandedExt));

  if (
    extractedIsMalignantObstruction &&
    extractedHasGastricOutletSiteEnumeration &&
    dueHasMalignantPyloricDuodenalScope
  ) {
    const matchedDueIndications = validDueList.filter(d =>
      /malignant|cancer|carcinoma|neoplasm|tumou?r/i.test(d) &&
      /pyloric|pylorus|duodenal|duodenum|gastroduodenal|gastric\s+outlet|goo/i.test(d)
    );
    const matchedDueStr = (matchedDueIndications.length > 0 ? matchedDueIndications : validDueList).join(' / ');
    return {
      type: 'Same indication',
      rationale: `Matched DUE Indication: "${matchedDueStr}". Extracted indication: "${cleaned}". The publication describes unresectable malignant obstruction across the stomach, duodenum, and/or gastroenteric anastomotic site, which is the malignant gastric-outlet scope covered by the configured pyloric/duodenal DUE indication.`,
      matchedDueIndication: matchedDueIndications[0] || validDueList[0],
    };
  }

  // Procedure-only without disease context check
  if (/^(?:eus[- ](?:cds|hgs|rds| drainage|stent)|.*?was\s+performed)$/i.test(expandedExt) && !/(?:obstruction|stricture|stone|cholecystitis|necrosis|pseudocyst|fistula|tumor|cancer|carcinoma|stenosis)/i.test(expandedExt)) {
    return {
      type: 'Not reported',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Procedure name provided without underlying disease or indication context.`,
      matchedDueIndication: validDueList[0],
    };
  }

  // Specific Etiology and Subsite Mismatch Rules
  const dueIsPostTransplant = dueLowerList.some(d => /post[- ]transplant|transplantation/.test(d.expanded));
  const extIsChronicPancreatitis = /chronic\s+pancreatitis/.test(expandedExt);
  if (dueIsPostTransplant && extIsChronicPancreatitis) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Chronic pancreatitis etiology differs from post-transplant anastomotic stricture DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }

  if (validDueList.length === 1 && /duodenal\s+obstruction/.test(dueLowerList[0].expanded) && expandedExt === 'malignant gastric outlet obstruction') {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList[0]}". Extracted indication: "${cleaned}". Broad gastric outlet obstruction term used without specific duodenal anatomical location confirmation.`,
      matchedDueIndication: validDueList[0],
    };
  }

  // Specific Subsite and Pathology Mismatch Rules
  const dueIsDistalBiliary = dueLowerList.some(d => /distal/.test(d.expanded) && /biliary/.test(d.expanded));
  const dueIsHilarBiliary = dueLowerList.some(d => /hilar/.test(d.expanded) && /biliary/.test(d.expanded));
  const extIsHilarBiliary = /hilar|klatskin/.test(expandedExt);
  const extIsDistalBiliary = /distal/.test(expandedExt);

  if (dueIsDistalBiliary && extIsHilarBiliary) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Hilar biliary obstruction differs from distal malignant biliary obstruction DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }
  if (dueIsHilarBiliary && extIsDistalBiliary) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Distal biliary obstruction differs from hilar malignant biliary obstruction DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }
  if (dueIsDistalBiliary && expandedExt === 'malignant biliary obstruction') {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Broad malignant biliary obstruction term used without explicit distal location confirmation.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const dueIsCervicalEsophageal = dueLowerList.some(d => /cervical/.test(d.expanded) && /esophag/.test(d.expanded));
  const extIsGejOrDistalEsophageal = /gastroesophageal|gej|distal/.test(expandedExt);
  if (dueIsCervicalEsophageal && extIsGejOrDistalEsophageal) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Gastroesophageal junction / distal esophageal obstruction differs from cervical esophageal DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }
  const dueIsDistalEsophageal = dueLowerList.some(d => /distal/.test(d.expanded) && /esophag/.test(d.expanded));
  if (dueIsDistalEsophageal && expandedExt === 'malignant dysphagia') {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Dysphagia symptom without specific distal esophageal location confirmation.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const dueIsColonic = dueLowerList.some(d => /colonic|colon|colorectal/.test(d.expanded));
  const extIsSmallBowel = /small\s+bowel/.test(expandedExt);
  if (dueIsColonic && extIsSmallBowel) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Small bowel obstruction differs from colonic obstruction DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }
  const dueRectumExcluded = dueLowerList.some(d => /rectum\s+excluded|excluding\s+rectum/.test(d.expanded));
  const extIsRectal = /rectal|rectum/.test(expandedExt);
  if (dueRectumExcluded && extIsRectal) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Rectal obstruction is excluded in the DUE scope.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const dueIsWon = dueLowerList.some(d => /walled[- ]off\s+necrosis|won/.test(d.expanded));
  const extIsPfc = expandedExt === 'pancreatic fluid collection' || expandedExt === 'pfc';
  if (dueIsWon && extIsPfc) {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Broad pancreatic fluid collection term without specific walled-off necrosis confirmation.`,
      matchedDueIndication: validDueList[0],
    };
  }
  const extIsAcuteNecrotizingPancreatitis = /acute\s+necrotizing\s+pancreatitis/.test(expandedExt);
  if (dueIsWon && extIsAcuteNecrotizingPancreatitis) {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Acute necrotizing pancreatitis without confirmed mature walled-off necrosis collection.`,
      matchedDueIndication: validDueList[0],
    };
  }
  const dueIsPfcOrWonDrainage = dueLowerList.some(d => /pseudocyst|walled[- ]off\s+necrosis|pfc|pancreatic\s+fluid\s+collection/.test(d.expanded));
  const extIsGallbladderDrainage = /gallbladder\s+drainage|cholecystitis/.test(expandedExt);
  if (dueIsPfcOrWonDrainage && extIsGallbladderDrainage) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Gallbladder drainage differs from pancreatic collection drainage DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const extHasNoMechanicalObstruction = /without\s+mechanical\s+obstruction/.test(expandedExt);
  const dueHasMechanicalObstruction = dueLowerList.some(d => /mechanical\s+obstruction/.test(d.expanded));
  if (dueHasMechanicalObstruction && extHasNoMechanicalObstruction) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Functional/non-mechanical condition differs from mechanical obstruction DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const dueIsBenignStricture = dueLowerList.some(d => /benign/.test(d.expanded) && /stricture/.test(d.expanded));
  const extIsMalignantTef = /malignant.*fistula|tracheoesophageal\s+fistula/.test(expandedExt) && !/stricture/.test(expandedExt);
  if (dueIsBenignStricture && extIsMalignantTef) {
    return {
      type: 'Different indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Malignant fistula differs from benign stricture DUE.`,
      matchedDueIndication: validDueList[0],
    };
  }

  const extHasMultipleMixed = /and|,\s*/.test(cleaned) && /(?:malignant|benign)/i.test(expandedExt) && extractedParts.length > 1;
  if (extHasMultipleMixed && dueLowerList.some(d => /pyloric\/duodenal/.test(d.expanded))) {
    return {
      type: 'Related indication',
      rationale: `Matched DUE Indication: "${validDueList.join(', ')}". Extracted indication: "${cleaned}". Contains mixed malignant and benign indications across anatomical sites.`,
      matchedDueIndication: validDueList[0],
    };
  }

  // Gastric Outlet / Gastroduodenal umbrella match rule
  if (/gastric\s+outlet\s+obstruction|gastroduodenal\s+obstruction|goo|malignant\s+gastric\s+outlet/i.test(expandedExt)) {
    if (dueCoversPyloricAndDuodenal || validDueList.some(d => /pyloric|duodenal|gastroduodenal|gastric\s+outlet/i.test(d.toLowerCase()))) {
      const matchedDueStr = validDueList.join(' / ');
      return {
        type: 'Same indication',
        rationale: `Matched DUE Indication: "${matchedDueStr}". Extracted indication: "${cleaned}". Malignant gastroduodenal / gastric outlet obstruction encompasses the malignant pyloric and/or duodenal obstructive indications entered for the DUE.`,
        matchedDueIndication: validDueList[0],
      };
    } else if (validDueList.length === 1 && /duodenal/i.test(validDueList[0])) {
      const hasExplicitDuodenalMention = /duodenal|duodenum/i.test(expandedExt);
      if (hasExplicitDuodenalMention) {
        return {
          type: 'Same indication',
          rationale: `Matched DUE Indication: "${validDueList[0]}". Extracted indication: "${cleaned}". Location confirmed as duodenal obstruction.`,
          matchedDueIndication: validDueList[0],
        };
      }
      return {
        type: 'Related indication',
        rationale: `Matched DUE Indication: "${validDueList[0]}". Extracted indication: "${cleaned}". Broad gastric outlet obstruction term used without specific anatomical location confirmation.`,
        matchedDueIndication: validDueList[0],
      };
    }
  }

  // Compare each extracted item against ALL DUE indications
  const itemResults: { extractedItem: string; type: IndicationRelationshipType; matchedDue: string; rationale: string; priority: number }[] = [];

  for (const extItem of itemsToCompare) {
    const normExt = normalizeText(extItem);
    const expandedExtItem = expandMedicalAcronyms(extItem);
    const extTarget = identifyCoreTargetAndAction(extItem);
    const extIsMalignant = /(?:malignant|cancer|carcinoma|palliative|palliation|oncolog|unresectable)/i.test(expandedExtItem);
    const extIsBenign = /(?:benign|non-malignant|post-operative|postoperative|iatrogenic|stone|calculi|chronic\s+pancreatitis)/i.test(expandedExtItem);

    let bestMatchForExt = {
      type: 'Different indication' as IndicationRelationshipType,
      priority: 1,
      matchedDue: validDueList[0],
      rationale: `Extracted indication "${extItem}" differs from DUE indication.`,
    };

    for (const dueObj of dueLowerList) {
      const dueInd = dueObj.raw;
      const expandedDue = dueObj.expanded;
      const normDue = normalizeText(dueInd);
      const dueTarget = identifyCoreTargetAndAction(dueInd);
      const dueIsMalignant = /(?:malignant|cancer|carcinoma|palliative|palliation|oncolog)/i.test(expandedDue);
      const dueIsBenign = /(?:benign|non-malignant|post-operative|postoperative|iatrogenic)/i.test(expandedDue);

      if (normExt === normDue || expandedExtItem.toLowerCase() === expandedDue) {
        bestMatchForExt = {
          type: 'Same indication',
          priority: 10,
          matchedDue: dueInd,
          rationale: `Matched DUE Indication: "${dueInd}". Extracted indication "${extItem}" is semantically identical to DUE indication "${dueInd}".`,
        };
        break;
      }

      if (extTarget.organ !== 'other' && extTarget.organ === dueTarget.organ) {
        if (extTarget.organ === 'gallbladder') {
          bestMatchForExt = {
            type: 'Same indication',
            priority: 10,
            matchedDue: dueInd,
            rationale: `Matched DUE Indication: "${dueInd}". Extracted indication matches gallbladder drainage.`,
          };
          break;
        }
        if (extTarget.organ === 'pancreatic_pseudocyst' || extTarget.organ === 'walled_off_necrosis') {
          bestMatchForExt = {
            type: 'Same indication',
            priority: 10,
            matchedDue: dueInd,
            rationale: `Matched DUE Indication: "${dueInd}". Extracted indication matches transmural pancreatic collection drainage.`,
          };
          break;
        }
        if (extTarget.organ === 'pancreatic_duct' || extTarget.organ === 'biliary_tract' || extTarget.organ === 'esophageal' || extTarget.organ === 'colonic' || extTarget.organ === 'gastrointestinal') {
          if ((extIsMalignant && dueIsBenign) || (extIsBenign && dueIsMalignant)) {
            if (bestMatchForExt.priority < 4) {
              bestMatchForExt = {
                type: 'Related indication',
                priority: 4,
                matchedDue: dueInd,
                rationale: `Matched DUE Indication: "${dueInd}". Pathology difference: extracted is ${extIsMalignant ? 'malignant' : 'benign'} while DUE is ${dueIsMalignant ? 'malignant' : 'benign'}.`,
              };
            }
          } else {
            bestMatchForExt = {
              type: 'Same indication',
              priority: 9,
              matchedDue: dueInd,
              rationale: `Matched DUE Indication: "${dueInd}". Extracted indication matches anatomical target and procedure.`,
            };
            break;
          }
        }
      }

      const extWords = expandedExtItem.split(/\s+/).map(normalizeMedicalWord).filter((w) => w.length > 1);
      const dueWords = expandedDue.split(/\s+/).map(normalizeMedicalWord).filter((w) => w.length > 1);
      const accessWords = new Set(['transgastric', 'transduodenal', 'percutaneous', 'endoscopic', 'laparoscopic', 'transmural', 'retrograde', 'antegrade', 'open', 'surgical', 'approach', 'access', 'via', 'guided', 'eus']);
      const stopWords = new Set(['of', 'the', 'in', 'for', 'with', 'and', 'or', 'a', 'an', 'to', 'by', 'patients', 'patient']);

      const coreExtTokens = new Set(extWords.filter((t) => !accessWords.has(t) && !stopWords.has(t)));
      const coreDueTokens = new Set(dueWords.filter((t) => !accessWords.has(t) && !stopWords.has(t)));
      const commonCoreTokens = [...coreExtTokens].filter((t) => coreDueTokens.has(t));

      const coreOverlapExt = coreExtTokens.size > 0 ? commonCoreTokens.length / coreExtTokens.size : 0;
      const coreOverlapDue = coreDueTokens.size > 0 ? commonCoreTokens.length / coreDueTokens.size : 0;

      if (coreOverlapExt >= 0.75 && coreOverlapDue >= 0.75) {
        bestMatchForExt = {
          type: 'Same indication',
          priority: 8,
          matchedDue: dueInd,
          rationale: `Matched DUE Indication: "${dueInd}". Extracted indication "${extItem}" matches target anatomy and procedure of "${dueInd}".`,
        };
        break;
      } else if (coreOverlapExt >= 0.35 || coreOverlapDue >= 0.35 || commonCoreTokens.length >= 1) {
        if (bestMatchForExt.priority < 5) {
          bestMatchForExt = {
            type: 'Related indication',
            priority: 5,
            matchedDue: dueInd,
            rationale: `Matched DUE Indication: "${dueInd}". Extracted indication "${extItem}" shares anatomical target or clinical procedure with "${dueInd}".`,
          };
        }
      }
    }

    itemResults.push({
      extractedItem: extItem,
      type: bestMatchForExt.type,
      matchedDue: bestMatchForExt.matchedDue,
      rationale: bestMatchForExt.rationale,
      priority: bestMatchForExt.priority,
    });
  }

  const allSame = itemResults.every(r => r.type === 'Same indication');
  const anySame = itemResults.some(r => r.type === 'Same indication');
  const anyRelated = itemResults.some(r => r.type === 'Related indication');
  const allDifferent = itemResults.every(r => r.type === 'Different indication');

  let overallType: IndicationRelationshipType = 'Different indication';
  if (allSame || (itemsToCompare.length > 1 && anySame && !anyRelated && allDifferent === false)) {
    overallType = 'Same indication';
  } else if (anySame || anyRelated) {
    overallType = 'Related indication';
  } else {
    overallType = 'Different indication';
  }

  const primaryMatch = itemResults.find(r => r.type === overallType) || itemResults[0];
  const matchedDueNames = Array.from(new Set(itemResults.map(r => r.matchedDue))).join(', ');

  return {
    type: overallType,
    rationale: `Matched DUE Indication: "${matchedDueNames || primaryMatch.matchedDue}". Extracted indication: "${cleaned}". ${primaryMatch.rationale}`,
    matchedDueIndication: primaryMatch.matchedDue,
  };
}

/**
 * Evaluates Indication Relationship against the DUE inventory
 */
export function evaluateIndicationWithInventory(
  extractedIndication: string,
  deviceRelationshipType: DeviceRelationshipType,
  matchedDueId: string | undefined,
  dueMatchStatus: 'Exact DUE match' | 'Multiple DUE match – Review required' | 'Configuration conflict – Review required' | 'Similar Device Reference' | 'Multiple reference DUEs' | 'No DUE match' | 'Needs confirmation' | undefined,
  dueInventory: DueItem[] | DueSetup
): IndicationClassificationResult {
  const dueList: DueItem[] = Array.isArray(dueInventory) ? dueInventory : [dueInventory];

  const cleanRes = cleanExtractedIndicationText(extractedIndication);
  if (cleanRes.isRelationshipOnly || !cleanRes.cleaned) {
    return {
      type: 'Not reported',
      rationale: 'Indication is not reported in the paper text.',
      dueMatchStatus,
    };
  }

  const validDues = dueList.filter((d) => d.productName && d.productName.trim() && d.indications && d.indications.length > 0);
  if (validDues.length === 0) {
    return {
      type: 'Not assessable',
      rationale: 'No valid DUE items with configured indications exist in the evaluation setup.',
      dueMatchStatus,
    };
  }

  // 1. Device is DUE and has an exact matched DUE ID
  if (deviceRelationshipType === 'DUE' && matchedDueId) {
    const targetDue = validDues.find((d) => d.id === matchedDueId) || validDues[0];
    const indRes = classifyIndicationRelationship(cleanRes.cleaned, targetDue.indications);
    
    return {
      type: indRes.type,
      rationale: indRes.rationale,
      comparedAgainstDueId: targetDue.id,
      comparedAgainstDueName: targetDue.productName,
      matchedDueIndication: indRes.matchedDueIndication,
      dueMatchStatus: dueMatchStatus || 'Exact DUE match',
    };
  }

  // 2. Evaluated against all configured DUE indications
  const allIndications = Array.from(new Set(validDues.flatMap((d) => d.indications)));
  const overallIndRes = classifyIndicationRelationship(cleanRes.cleaned, allIndications);

  const ownerDue = validDues.find((d) => d.indications.includes(overallIndRes.matchedDueIndication || '')) || validDues[0];

  return {
    type: overallIndRes.type,
    rationale: overallIndRes.rationale,
    comparedAgainstDueId: ownerDue?.id,
    comparedAgainstDueName: ownerDue?.productName,
    matchedDueIndication: overallIndRes.matchedDueIndication,
    dueMatchStatus: dueMatchStatus || 'Similar Device Reference',
  };
}

/**
 * Extracts Manufacturer and Product Name from parenthetical or semicolon patterns
 */
