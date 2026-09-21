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

import { expandMedicalAcronyms } from './medicalText';

/**
 * Normalizes text for comparison (lowercasing, punctuation normalization, trademark removal, trimming)
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[™®©℠]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Technical descriptors and category words to separate from unique brand anchors.
 * Broad generic terms including device categories, delivery systems, anatomical organs,
 * covering types, materials, and clinical modifiers that must NOT be used alone to match DUEs.
 */
export const GENERIC_DEVICE_DESCRIPTORS = new Set([
  // Device categories and delivery system
  'stent',
  'stents',
  'stenting',
  'lams',
  'ec-lams',
  'eclams',
  'ec',
  'sems',
  'fcsems',
  'fc-sems',
  'pcsems',
  'pc-sems',
  'ucsems',
  'uc-sems',
  'lumen-apposing',
  'lumen',
  'apposing',
  'delivery',
  'system',
  'systems',
  'catheter',
  'catheters',
  'device',
  'devices',
  'mesh',
  'wire',
  'wires',
  'guidewire',
  'guidewires',
  'prosthesis',
  'prostheses',
  'prosthetic',
  'drainage',
  'drain',
  'drains',
  'tube',
  'tubes',
  'applicator',
  'applicators',
  'introducer',
  'introducers',
  'sheath',
  'sheaths',
  'kit',
  'set',

  // Anatomical locations & organs
  'biliary',
  'bile',
  'duct',
  'ducts',
  'gallbladder',
  'gb',
  'esophageal',
  'esophagus',
  'enteral',
  'duodenal',
  'duodenum',
  'colonic',
  'colon',
  'colorectal',
  'rectal',
  'rectum',
  'pancreatic',
  'pancreas',
  'gastric',
  'stomach',
  'gastrointestinal',
  'gi',
  'vascular',
  'blood',
  'vessel',
  'vessels',
  'arterial',
  'artery',
  'venous',
  'vein',
  'tracheobronchial',
  'bronchial',
  'bronchus',
  'tracheal',
  'trachea',
  'airway',
  'airways',
  'ureteral',
  'ureter',
  'urethral',
  'urethra',
  'hepatic',
  'hepaticogastrostomy',
  'choledochoduodenostomy',
  'gastroenterostomy',
  'gastrojejunostomy',
  'papilla',
  'papillary',
  'sphincter',
  'sphincterotomy',

  // Coverings, coatings, materials, shapes
  'covered',
  'uncovered',
  'partially',
  'fully',
  'bare',
  'uncoated',
  'coated',
  'silicone',
  'ptfe',
  'eptfe',
  'dual',
  'single',
  'double',
  'braided',
  'woven',
  'laser-cut',
  'cut',
  'metal',
  'metallic',
  'polymer',
  'polymeric',
  'plastic',
  'nitinol',
  'self-expanding',
  'self-expandable',
  'expandable',
  'balloon-expandable',
  'balloon',
  'flared',
  'flare',
  'flares',
  'straight',
  'angled',
  'tapered',
  'flange',
  'flanges',
  'antimigratory',
  'antimigration',
  'anti-migration',
  'migration',
  'valved',
  'valve',
  'anchor',
  'anchoring',
  'bellows',

  // Medical adjectives & technology
  'electrocautery',
  'electrocautery-enhanced',
  'cautery',
  'enhanced',
  'hot',
  'cold',
  'bipolar',
  'monopolar',
  'endoscopic',
  'transmural',
  'transgastric',
  'transduodenal',
  'eus-guided',
  'eus',
  'ercp',
  'radiofrequency',
  'rf',
  'tts',
  'through-the-scope',
  'over-the-wire',
  'otw',
  'short',
  'long',
  'large',
  'small',
  'standard',

  // Brand family prefixes, materials, and corporate markers
  'niti',
  'niti-s',
  'nitis',
  'taewoong',
  'boston',
  'cook',
  'olympus',
  'medtronic',
  'mitech',
  'm-i-tech',
  'plus',
  'pro',
  'ii',
  'iii',
  'iv',
  'type',
  'model',
  'series',
  'medical',
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'gmbh',
  'technologies',
  'technology',
  'healthcare',
  'international',
  'therapeutics',
  'group',
]);

/**
 * Extracts distinct brand anchors from a product name by removing generic descriptors.
 */
export function getBrandAnchors(str: string): { anchors: string[]; rawTokens: string[] } {
  if (!str) return { anchors: [], rawTokens: [] };
  const norm = normalizeText(str);
  const rawWords = norm.split(/[\s]+/).filter((w) => w.length > 0);
  const subWords = norm.split(/[\s-]+/).filter((w) => w.length > 0);
  
  const allCandidates = new Set<string>();

  for (const w of [...rawWords, ...subWords]) {
    const clean = w.replace(/[^a-z0-9]/g, '').trim();
    if (clean.length >= 2 && !GENERIC_DEVICE_DESCRIPTORS.has(clean) && !GENERIC_DEVICE_DESCRIPTORS.has(w)) {
      allCandidates.add(clean);
    }
  }

  return {
    anchors: Array.from(allCandidates),
    rawTokens: subWords,
  };
}

/**
 * Tokenizes text into meaningful semantic tokens
 */
export function getTokens(str: string): Set<string> {
  const norm = normalizeText(str);
  const stopWords = new Set(['of', 'the', 'in', 'for', 'with', 'and', 'or', 'a', 'an', 'to', 'by']);
  const tokens = norm
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w) && !GENERIC_DEVICE_DESCRIPTORS.has(w));
  return new Set(tokens);
}

export function normalizeAlphaNumeric(str: string): string {
  if (!str) return '';
  return normalizeText(str).replace(/[\s-]+/g, '');
}

export interface ParsedSimilarDevice {
  raw: string;
  fullName: string;
  manufacturer: string;
  brandAliases: string[];
}

/**
 * Extracts clear product-brand aliases directly contained in the full name.
 * e.g., 'WallFlex' for 'WallFlex Biliary Transhepatic Stent System'
 */
export function extractBrandAliasesFromFullName(fullName: string): string[] {
  if (!fullName || !fullName.trim()) return [];
  const words = fullName.trim().split(/\s+/);
  const aliasesSet = new Set<string>();

  // 1. Leading brand words before the first generic device descriptor
  const leadingWords: string[] = [];
  for (const w of words) {
    const cleanWord = normalizeText(w);
    if (!cleanWord) continue;
    if (GENERIC_DEVICE_DESCRIPTORS.has(cleanWord) || GENERIC_DEVICE_DESCRIPTORS.has(cleanWord.replace(/[^a-z0-9]/g, ''))) {
      break;
    }
    leadingWords.push(w);
  }

  if (leadingWords.length > 0) {
    const leadPhrase = leadingWords.join(' ').replace(/[™®©℠]/g, '').trim();
    if (leadPhrase.length >= 2) {
      aliasesSet.add(leadPhrase);
    }
  }

  // 2. Extract brand anchors from getBrandAnchors
  const brandAnchors = getBrandAnchors(fullName);
  for (const anchor of brandAnchors.anchors) {
    if (anchor.length >= 3 && !GENERIC_DEVICE_DESCRIPTORS.has(anchor)) {
      const origWord = words.find((w) => normalizeText(w).replace(/[^a-z0-9]/g, '') === anchor);
      aliasesSet.add(origWord ? origWord.replace(/[™®©℠]/g, '').trim() : anchor);
    }
  }

  // 3. Known brand combinations (e.g. "Niti-S Giobor" -> "Giobor", "Niti-S Spring stopper" -> "Spring stopper")
  const nitiMatch = fullName.match(/Niti-S\s+([A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+)?)/i);
  if (nitiMatch) {
    const brandPart = nitiMatch[1].replace(/stent|system|biliary|drainage/gi, '').trim();
    if (brandPart.length >= 2) {
      aliasesSet.add(brandPart);
    }
  }

  return Array.from(aliasesSet).filter((a) => a.length >= 2);
}

/**
 * Parses a Similar Device entry, separating the final parenthetical manufacturer
 * from the full product name and generating normalized clear product-brand aliases.
 */
export function parseSimilarDevice(sim: string | SimilarDevice): ParsedSimilarDevice {
  const rawStr = typeof sim === 'string' ? sim : sim.fullName || sim.productName || '';
  const trimmed = rawStr.trim();
  if (!trimmed) {
    return { raw: '', fullName: '', manufacturer: '', brandAliases: [] };
  }

  let fullName = trimmed;
  let manufacturer = typeof sim === 'object' && sim.manufacturer ? sim.manufacturer.trim() : '';

  // Separate final parenthetical manufacturer: e.g. "WallFlex Biliary Transhepatic Stent System (Boston Scientific)"
  const parenMatch = trimmed.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const productPart = parenMatch[1].trim();
    const parenContent = parenMatch[2].trim();

    const isCompanyOrMfg =
      /medical|scientific|biotech|tech|inc|corp|co\.|ltd|gmbh|healthcare|laboratories|therapeutics|systems|taewoong|boston|cook|olympus|medtronic|sewoon|s&g|m\.?i\.?|micro-?tech|merit|gore|bard|cordis|terumo/i.test(
        parenContent
      );

    if (isCompanyOrMfg || (!manufacturer && productPart.length > 0)) {
      fullName = productPart;
      if (!manufacturer) {
        manufacturer = parenContent;
      }
    } else {
      fullName = productPart || trimmed;
    }
  }

  const brandAliases = extractBrandAliasesFromFullName(fullName);

  if (parenMatch) {
    const parenContent = parenMatch[2].trim();
    const isCompany = /medical|scientific|biotech|inc|corp|co\.|ltd|gmbh|healthcare/i.test(parenContent);
    if (!isCompany) {
      if (!brandAliases.some((b) => normalizeText(b) === normalizeText(parenContent))) {
        brandAliases.push(parenContent);
      }
    }
  }

  if (typeof sim === 'object' && sim.aliases) {
    const extra = sim.aliases.split(/[,;\n]/).map((a) => a.trim()).filter(Boolean);
    for (const ea of extra) {
      if (!brandAliases.some((b) => normalizeText(b) === normalizeText(ea))) {
        brandAliases.push(ea);
      }
    }
  }

  return {
    raw: trimmed,
    fullName,
    manufacturer,
    brandAliases,
  };
}

export interface SimilarDeviceMatchCandidate {
  sim: ParsedSimilarDevice;
  due: DueItem;
  matchedText: string;
  basis: 'Exact name match' | 'Registered alias match' | 'Needs confirmation';
  score: number;
}

/**
 * Matches an extracted product name against a parsed Similar Device.
 * Strict rules:
 * - Does NOT use manufacturer name alone for matching.
 * - Matches full normalized product name or clear product-brand alias.
 */
export function matchExtractedProductToSimilarDevice(
  extractedProduct: string,
  sim: ParsedSimilarDevice,
  due: DueItem
): SimilarDeviceMatchCandidate | null {
  const normExt = normalizeText(extractedProduct);
  const normExtAlpha = normalizeAlphaNumeric(extractedProduct);
  if (!normExt || normExt.length < 2) return null;

  // RULE: Do not use manufacturer name alone for matching
  if (sim.manufacturer) {
    const normMfg = normalizeText(sim.manufacturer);
    const normMfgAlpha = normalizeAlphaNumeric(sim.manufacturer);
    if (
      normExt === normMfg ||
      normExtAlpha === normMfgAlpha ||
      (normExt.length <= normMfg.length + 5 && normMfg.includes(normExt))
    ) {
      // Check if product name or any alias is present in extractedProduct
      const hasProductToken =
        sim.brandAliases.some((a) => normExt.includes(normalizeText(a))) ||
        (normalizeText(sim.fullName).length >= 3 && normExt.includes(normalizeText(sim.fullName)));
      if (!hasProductToken) {
        return null;
      }
    }
  }

  // 1. Exact full normalized product match
  const normFull = normalizeText(sim.fullName);
  const normFullAlpha = normalizeAlphaNumeric(sim.fullName);
  if (normExt === normFull || normExtAlpha === normFullAlpha) {
    return { sim, due, matchedText: sim.fullName, basis: 'Exact name match', score: 100 };
  }

  if (normExt.length >= 4 && (normFull.includes(normExt) || normExt.includes(normFull))) {
    const nonGenericTokens = normExt.split(/\s+/).filter((w) => !GENERIC_DEVICE_DESCRIPTORS.has(w) && w.length >= 3);
    if (nonGenericTokens.length > 0) {
      return { sim, due, matchedText: sim.fullName, basis: 'Exact name match', score: 95 };
    }
  }

  // 2. Clear product-brand alias match
  for (const alias of sim.brandAliases) {
    const normAlias = normalizeText(alias);
    const normAliasAlpha = normalizeAlphaNumeric(alias);
    if (normAlias.length < 2) continue;
    if (GENERIC_DEVICE_DESCRIPTORS.has(normAlias) || GENERIC_DEVICE_DESCRIPTORS.has(normAliasAlpha)) continue;

    if (normExt === normAlias || normExtAlpha === normAliasAlpha) {
      return { sim, due, matchedText: alias, basis: 'Registered alias match', score: 90 };
    }

    const extTokens = normExt.split(/[\s-]+/);
    const aliasTokens = normAlias.split(/[\s-]+/);
    const hasAllAliasTokens = aliasTokens.every((at) => extTokens.includes(at) || normExtAlpha.includes(at));

    if (hasAllAliasTokens || normExt.includes(normAlias) || (normExt.length >= 4 && normAlias.includes(normExt))) {
      return { sim, due, matchedText: alias, basis: 'Registered alias match', score: 85 };
    }
  }

  // 3. Distinctive non-generic brand anchor match
  const simAnchors = getBrandAnchors(sim.fullName).anchors;
  const extAnchors = getBrandAnchors(extractedProduct).anchors;
  const matchedAnchors = simAnchors.filter((a) => extAnchors.includes(a));
  if (matchedAnchors.length > 0 && simAnchors.length > 0 && matchedAnchors.length >= Math.min(simAnchors.length, 1)) {
    return {
      sim,
      due,
      matchedText: matchedAnchors.join(' ').toUpperCase(),
      basis: 'Registered alias match',
      score: 80,
    };
  }

  return null;
}

export interface DeviceClassificationResult {
  type: DeviceRelationshipType;
  rationale: string;
  matchedDueId?: string;
  matchedDueName?: string;
  dueMatchStatus?: 'Exact DUE match' | 'Multiple DUE match – Review required' | 'Configuration conflict – Review required' | 'Similar Device Reference' | 'Multiple reference DUEs' | 'No DUE match' | 'Needs confirmation';
  matchingDueList?: DueItem[];
  mappedSimilarDeviceName?: string;
  mappedSimilarDeviceManufacturer?: string;
  matchBasis?: 'Exact name match' | 'Registered alias match' | 'Hierarchical context match' | 'Needs confirmation';
}

export interface IndicationClassificationResult {
  type: IndicationRelationshipType;
  rationale: string;
  comparedAgainstDueId?: string;
  comparedAgainstDueName?: string;
  matchedDueIndication?: string;
  dueMatchStatus?: 'Exact DUE match' | 'Multiple DUE match – Review required' | 'Configuration conflict – Review required' | 'Similar Device Reference' | 'Multiple reference DUEs' | 'No DUE match' | 'Needs confirmation';
}

/**
 * Classifies a device against a full DUE Inventory and user Similar Devices.
 * Mandatory Priority Order:
 * 1. DUE
 * 2. Similar Device full name or alias
 * 3. Other Device
 * 4. Not reported
 * 
 * Strict Matching Rules:
 * - Separate the final parenthetical manufacturer from the full product name.
 * - Normalize case, spaces, hyphens, and ™.
 * - Allow a clear product-brand alias directly contained in the full name (e.g. WallFlex for WallFlex Biliary Transhepatic Stent System).
 * - Match in this order within the current DUE card only: DUE → Similar Device full name or alias → Other Device.
 * - Do not use manufacturer name alone for matching.
 * - If an alias has multiple candidates or explicit device details conflict, show Needs confirmation.
 * - Keep Device Relationship and Indication Relationship separate.
 */

/**
 * Product-family aliases used in legacy clinical literature. These aliases are
 * intentionally restricted to explicit product/model wording (or an article-
 * specific abbreviation + manufacturer), so manufacturer alone can never make
 * a DUE match.
 */
function isExplicitlyCoveredForUncoveredSubtype(coverType: string = ''): boolean {
  const normalized = normalizeText(coverType);
  if (!normalized || /not reported|not assessable|unknown/.test(normalized)) return false;

  // "Uncovered" contains the word "covered", so exclude true uncovered wording first.
  if (/\buncovered\b|\bucsems\b|bare metal|uncoated/.test(normalized) && !/both bare|end bare/.test(normalized)) {
    return false;
  }

  return /fully? covered|full covered|fcsems|partially covered|pcsems|both bare|end bare|\bcovered\b/.test(normalized);
}

function isBiliaryUncoveredSdmDue(due: DueItem): boolean {
  const cand = normalizeText(due.productName);
  return /niti[- ]s biliary uncovered stent/.test(cand) && /\b[sdm][- ]type\b/.test(cand);
}

function matchLegacyConfiguredDueAlias(
  extractedProduct: string,
  extractedMfg: string,
  due: DueItem,
  extractedCoverType: string = ''
): { match: boolean; score: number; matchedAnchor: string } {
  const ext = normalizeText(extractedProduct);
  const mfg = normalizeText(extractedMfg);
  const cand = normalizeText(due.productName);

  if (!ext || !cand) return { match: false, score: 0, matchedAnchor: '' };

  const isBiliaryUncovered = /niti[- ]s biliary uncovered stent/.test(cand);
  if (!isBiliaryUncovered) return { match: false, score: 0, matchedAnchor: '' };

  // S/D/M biliary DUEs are uncovered-only. If the article explicitly identifies
  // the study device as covered, do not allow any legacy S/D/M alias match.
  if (isExplicitlyCoveredForUncoveredSubtype(extractedCoverType)) {
    return { match: false, score: 0, matchedAnchor: '' };
  }

  const isDType = /\bd[- ]type\b/.test(cand);
  const isMType = /\bm[- ]type\b/.test(cand);
  const isSType = /\bs[- ]type\b/.test(cand);

  // Historical naming used in biliary D-Type publications.
  if (isDType && /\bniti d\b|\bniti-d\b|\bnds\b/.test(extractedProduct.toLowerCase())) {
    return { match: true, score: 100, matchedAnchor: 'Niti-D / NDS' };
  }

  // "SBSt" = the Taewoong single-bare-stent arm in the D-Type randomized study.
  // Require the Taewoong manufacturer cue as well; the abbreviation alone is not enough.
  if (isDType && /\bsbst\b/i.test(extractedProduct) && /taewoong/.test(mfg)) {
    return { match: true, score: 97, matchedAnchor: 'SBSt + Taewoong Medical' };
  }

  // Multi-Purpose is the legacy/article wording for the biliary M-Type.
  if (isMType && /multi[\s-]*purpose|\bm[\s-]*type\b/i.test(extractedProduct)) {
    return { match: true, score: 100, matchedAnchor: 'Niti-S Multi-Purpose Type' };
  }

  // S-Type requires explicit S-Type wording. Plain "Niti-S" is the base
  // product-family name and must never be treated as an S-Type alias.
  if (isSType && /\bs[\s-]*type\b/i.test(extractedProduct)) {
    return { match: true, score: 100, matchedAnchor: 'S-Type' };
  }

  return { match: false, score: 0, matchedAnchor: '' };
}

export const checkBrandOrNameMatch = (
  extractedProduct: string,
  candidateName: string,
  candidateAnchors: string[]
): { match: boolean; score: number; matchedAnchor: string } => {
  if (!candidateName || !candidateName.trim() || !extractedProduct || !extractedProduct.trim()) {
    return { match: false, score: 0, matchedAnchor: '' };
  }
  const normExtProduct = normalizeText(extractedProduct);
  const normCand = normalizeText(candidateName);
  const extBrand = getBrandAnchors(extractedProduct);

  // Plain/generic "Niti-S" is the base product-family name, not a model alias.
  // Do not let generic family wording match a specific configured Niti-S DUE.
  // Explicit model/subtype wording (Bumpy, Giobor, S-Type, etc.) is handled
  // by distinctive anchors or the restricted legacy rules.
  const onlyNitiSFamilyAnchor =
    /\bniti[\s-]*s\b/i.test(extractedProduct) &&
    extBrand.anchors.filter((anchor) => anchor !== 'nitis').length === 0;
  if (onlyNitiSFamilyAnchor && /niti[- ]s/.test(normCand)) {
    return { match: false, score: 0, matchedAnchor: '' };
  }

  // 0. Family anchor matching (e.g. 'comvi', 'spaxus')
  if (normCand.includes('comvi') && normExtProduct.includes('comvi')) {
    return { match: true, score: 98, matchedAnchor: 'ComVi' };
  }
  if (normCand.includes('spaxus') && normExtProduct.includes('spaxus')) {
    return { match: true, score: 98, matchedAnchor: 'SPAXUS' };
  }

  // 1. Exact full normalized equality
  if (normExtProduct === normCand || normalizeAlphaNumeric(extractedProduct) === normalizeAlphaNumeric(candidateName)) {
    return { match: true, score: 100, matchedAnchor: candidateName };
  }

  // 2. Exact substring phrase match (e.g. 'spring stopper' in 'pcsems-af spring stopper', or 'wallflex' in 'wallflex biliary')
  if (normCand.length >= 3 && (normExtProduct.includes(normCand) || normCand.includes(normExtProduct))) {
    return { match: true, score: 95, matchedAnchor: candidateName };
  }

  // 3. Distinctive non-generic brand anchor match
  if (candidateAnchors.length > 0) {
    const commonAnchors = candidateAnchors.filter((a) => extBrand.anchors.includes(a));
    if (commonAnchors.length === candidateAnchors.length && commonAnchors.length > 0) {
      return { match: true, score: 85 + commonAnchors.length * 5, matchedAnchor: commonAnchors.join(' ').toUpperCase() };
    }
  }

  return { match: false, score: 0, matchedAnchor: '' };
};

export type CoverTypeNormalized = 'Full Covered' | 'Partially Covered' | 'Both-Bare' | 'End-Bare' | 'Uncovered' | 'Not assessable';
export type CoverDetermination = 'Directly reported' | 'Inferred from text' | 'Inferred from model/preset' | 'Inferred from figure' | 'Review required' | 'Not assessable';

export function normalizeCoverType(rawCover: string, paperText: string = ''): {
  coverType: CoverTypeNormalized;
  determination: CoverDetermination;
  evidence: string;
  location: string;
  rationale: string;
  confidence: 'High' | 'Medium' | 'Low';
} {
  const text = `${rawCover || ''} ${paperText}`.toLowerCase();
  const rawLower = (rawCover || '').toLowerCase();

  let coverType: CoverTypeNormalized = 'Not assessable';
  let determination: CoverDetermination = 'Not assessable';
  let confidence: 'High' | 'Medium' | 'Low' = 'Low';
  let rationale = 'Cover type not specified or assessable.';

  if (/fully?\s*covered|fcsems|full-covered|fully-covered|fully\s*membrane/i.test(rawLower)) {
    coverType = 'Full Covered';
    determination = 'Directly reported';
    confidence = 'High';
    rationale = `Explicitly reported as fully covered (${rawCover}).`;
  } else if (/partially\s*covered|pcsems|partially-covered/i.test(rawLower)) {
    coverType = 'Partially Covered';
    determination = 'Directly reported';
    confidence = 'High';
    rationale = `Explicitly reported as partially covered (${rawCover}).`;
  } else if (/both\s*ends?\s*bare|both\s*bare|uncovered\s+ends?\s+at\s+both/i.test(rawLower)) {
    coverType = 'Both-Bare';
    determination = 'Directly reported';
    confidence = 'High';
    rationale = `Explicitly reported as both ends bare (${rawCover}).`;
  } else if (/proximal\s*bare|distal\s*bare|end\s*bare|uncovered\s+(?:proximal|distal)|bare\s+(?:proximal|distal)/i.test(rawLower)) {
    coverType = 'End-Bare';
    determination = 'Directly reported';
    confidence = 'High';
    rationale = `Explicitly reported as end-bare (${rawCover}).`;
  } else if (/uncovered|bare\s*metal|ucsems|uncoated|bme|bare\s+stent/i.test(rawLower)) {
    coverType = 'Uncovered';
    determination = 'Directly reported';
    confidence = 'High';
    rationale = `Explicitly reported as uncovered / bare metal (${rawCover}).`;
  } else {
    if (/fully?\s*covered|fcsems/i.test(paperText)) {
      coverType = 'Full Covered';
      determination = 'Inferred from text';
      confidence = 'Medium';
      rationale = 'Inferred as Full Covered from paper text description.';
    } else if (/partially\s*covered|pcsems/i.test(paperText)) {
      coverType = 'Partially Covered';
      determination = 'Inferred from text';
      confidence = 'Medium';
      rationale = 'Inferred as Partially Covered from paper text description.';
    } else if (/uncovered|bare\s*metal|ucsems/i.test(paperText)) {
      coverType = 'Uncovered';
      determination = 'Inferred from text';
      confidence = 'Medium';
      rationale = 'Inferred as Uncovered from paper text description.';
    } else {
      coverType = 'Not assessable';
      determination = 'Not assessable';
      confidence = 'Low';
      rationale = 'Cover type could not be determined from raw input or paper text.';
    }
  }

  return {
    coverType,
    determination,
    evidence: rawCover || 'Not reported',
    location: 'Methods / Device Description',
    rationale,
    confidence,
  };
}

export function areCoverTypesCompatible(deviceCover: string, dueCover: string): boolean {
  const normDev = (deviceCover || '').toLowerCase();
  const normDue = (dueCover || '').toLowerCase();
  if (!normDev || normDev.includes('not assessable') || normDev.includes('not reported') || !normDue || normDue.includes('not assessable')) {
    return true;
  }
  const isDevFull = /fully?\s*covered|fcsems/i.test(normDev);
  const isDueFull = /fully?\s*covered|fcsems/i.test(normDue);
  const isDevUncovered = /uncovered|bare\s*metal|ucsems|uncoated/i.test(normDev);
  const isDueUncovered = /uncovered|bare\s*metal|ucsems|uncoated/i.test(normDue);

  if ((isDevFull && isDueUncovered) || (isDevUncovered && isDueFull)) {
    return false;
  }
  return true;
}

/**
 * Classifies a device for a SINGLE specific DUE card.
 * Priority Sequence:
 * 1. Matches this DUE product name or DUE alias -> DUE
 * 2. Matches this DUE card's stored similar device full name or clear alias -> Similar Device
 * 3. Neither -> Other Device
 */
export function classifyDeviceForSingleDue(
  extractedProduct: string,
  _extractedMfg: string,
  due: DueItem,
  coverType: string = ''
): DeviceClassificationResult {
  const normExtProduct = normalizeText(extractedProduct);
  if (!normExtProduct || normExtProduct.includes('not reported') || normExtProduct.includes('unknown') || normExtProduct === '') {
    return {
      type: 'Not reported',
      rationale: 'Device product name is not reported or unidentified in the paper text.',
      dueMatchStatus: 'No DUE match',
    };
  }

  // 1. Check if paper device matches this official DUE product name -> DUE
  const dueBrand = getBrandAnchors(due.productName);
  const legacyAlias = matchLegacyConfiguredDueAlias(extractedProduct, _extractedMfg, due, coverType);
  let standardDueMatch = checkBrandOrNameMatch(extractedProduct, due.productName, dueBrand.anchors);
  const normalizedDueName = normalizeText(due.productName);
  const subtypeConfiguredBiliary = /niti[- ]s biliary uncovered stent/.test(normalizedDueName) && /\b[sdm][- ]type\b/.test(normalizedDueName);
  if (subtypeConfiguredBiliary && isExplicitlyCoveredForUncoveredSubtype(coverType)) {
    standardDueMatch = { match: false, score: 0, matchedAnchor: '' };
  }
  const extractedHasSubtypeIdentity = /\bniti[ -]?d\b|\bnds\b|\bsbst\b|multi[\s-]*purpose|\b[sdm][\s-]*type\b/i.test(extractedProduct);
  if (subtypeConfiguredBiliary && !extractedHasSubtypeIdentity) {
    // Generic family wording must not standard-match every selected S/D/M DUE.
    standardDueMatch = { match: false, score: 0, matchedAnchor: '' };
  }
  const dueMatch = legacyAlias.match && legacyAlias.score >= standardDueMatch.score ? legacyAlias : standardDueMatch;

  // 2. Check if paper device matches THIS DUE card's stored similar device full name or alias -> Similar Device
  const rawSims = due.similarDevices || [];
  const parsedSims = rawSims.map(parseSimilarDevice).filter((s) => s.fullName.length > 0);
  const candidates: SimilarDeviceMatchCandidate[] = [];

  for (const sim of parsedSims) {
    const cand = matchExtractedProductToSimilarDevice(extractedProduct, sim, due);
    if (cand) {
      candidates.push(cand);
    }
  }

  // Conflict handling: Matches both DUE and Similar Device
  if (dueMatch.match && candidates.length > 0) {
    const isSameProduct = normalizeText(due.productName) === normalizeText(candidates[0].sim.fullName);
    if (!isSameProduct) {
      return {
        type: 'Similar Device',
        matchedDueId: due.id,
        matchedDueName: due.productName,
        dueMatchStatus: 'Needs confirmation',
        matchBasis: 'Needs confirmation',
        mappedSimilarDeviceName: candidates[0].sim.fullName,
        mappedSimilarDeviceManufacturer: candidates[0].sim.manufacturer,
        rationale: `Device "${extractedProduct}" matches both DUE "${due.productName}" and Similar Device "${candidates[0].sim.fullName}" — Needs confirmation.`,
      };
    }
  }

  if (dueMatch.match) {
    const anchorText = dueMatch.matchedAnchor ? ` (Matched: "${dueMatch.matchedAnchor}")` : '';
    return {
      type: 'DUE',
      matchedDueId: due.id,
      matchedDueName: due.productName,
      dueMatchStatus: 'Exact DUE match',
      matchingDueList: [due],
      rationale: `Device "${extractedProduct}" matches DUE ${due.id} ("${due.productName}")${anchorText}. Technical descriptors do not alter brand identity.`,
    };
  }

  if (candidates.length > 0) {
    // Check if alias has multiple distinct candidate similar devices in this DUE card
    const uniqueFullNames = Array.from(new Set(candidates.map((c) => c.sim.fullName)));
    if (uniqueFullNames.length > 1) {
      return {
        type: 'Similar Device',
        matchedDueId: due.id,
        matchedDueName: due.productName,
        dueMatchStatus: 'Needs confirmation',
        matchBasis: 'Needs confirmation',
        mappedSimilarDeviceName: uniqueFullNames.join(' / '),
        rationale: `Device "${extractedProduct}" has multiple Similar Device candidates (${uniqueFullNames.map((n) => `"${n}"`).join(', ')}) in DUE ${due.id} — Needs confirmation.`,
      };
    }

    const topCand = candidates[0];
    return {
      type: 'Similar Device',
      matchedDueId: due.id,
      matchedDueName: due.productName,
      dueMatchStatus: 'Similar Device Reference',
      matchBasis: topCand.basis,
      mappedSimilarDeviceName: topCand.sim.fullName,
      mappedSimilarDeviceManufacturer: topCand.sim.manufacturer,
      rationale: `Device "${extractedProduct}" matches Similar Device "${topCand.sim.fullName}"${topCand.sim.manufacturer ? ` (${topCand.sim.manufacturer})` : ''} configured for DUE ${due.id} ("${due.productName}") (matched: "${topCand.matchedText}").`,
    };
  }

  // 3. Otherwise -> Other Device
  return {
    type: 'Other Device',
    dueMatchStatus: 'No DUE match',
    rationale: `Device "${extractedProduct}" is neither the DUE (${due.id}: "${due.productName}") nor listed in this DUE's similar devices. Classified as Other Device.`,
  };
}

/**
 * Classifies a device against a full DUE Inventory and each DUE's similar devices.
 * Evaluation Sequence:
 * 1. Checks if the paper device matches any DUE product name or DUE alias -> DUE
 * 2. Checks if the paper device matches any DUE card's stored similar device full name or clear alias -> Similar Device (with that DUE's reference)
 * 3. Otherwise -> Other Device
 */
type HierarchicalAnatomicalSite =
  | 'Biliary'
  | 'Esophageal'
  | 'Pyloric/Duodenal'
  | 'Colonic'
  | 'Pancreatic duct'
  | 'Pancreatic collection'
  | 'Gallbladder';

type HierarchicalCoverDetail =
  | 'Full Covered'
  | 'Partially Covered'
  | 'Both-Bare'
  | 'End-Bare'
  | 'Uncovered'
  | 'Covered'
  | 'Unknown';

function inferHierarchicalAnatomicalSites(text: string): Set<HierarchicalAnatomicalSite> {
  const expanded = expandMedicalAcronyms(text || '').toLowerCase();
  const sites = new Set<HierarchicalAnatomicalSite>();

  if (/\bbiliary\b|bile\s+duct|common\s+bile\s+duct|\bcbd\b|choledocho|cholangio|hepatic\s+duct|hepaticogastrostomy/.test(expanded)) {
    sites.add('Biliary');
  }
  if (/esophag|oesophag|malignant\s+dysphagia|tracheoesophageal/.test(expanded)) {
    sites.add('Esophageal');
  }
  if (/pylor|duoden|gastric\s+outlet|gastrojejun|gastroenterostom|gastroduoden/.test(expanded)) {
    sites.add('Pyloric/Duodenal');
  }
  if (/\bcolon\b|colonic|colorectal|rectal|rectum|large\s+bowel/.test(expanded)) {
    sites.add('Colonic');
  }
  if (/pancreatic\s+duct|main\s+pancreatic\s+duct|\bmpd\b|pancreatic\s+ductal|pancreatic\s+stricture/.test(expanded)) {
    sites.add('Pancreatic duct');
  }
  if (/pancreatic\s+pseudocyst|pseudocyst|walled[-\s]+off\s+(?:pancreatic\s+)?necrosis|pancreatic\s+fluid\s+collection|\bpfc\b|\bwon\b/.test(expanded)) {
    sites.add('Pancreatic collection');
  }
  if (/gallbladder|cholecyst/.test(expanded)) {
    sites.add('Gallbladder');
  }

  return sites;
}

function inferDueAnatomicalSites(due: DueItem): Set<HierarchicalAnatomicalSite> {
  return inferHierarchicalAnatomicalSites(
    `${due.deviceCategory || ''} ${due.productName || ''} ${(due.indications || []).join(' ')}`
  );
}

function sitesIntersect(a: Set<HierarchicalAnatomicalSite>, b: Set<HierarchicalAnatomicalSite>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function inferHierarchicalCoverDetail(text: string): HierarchicalCoverDetail {
  const raw = normalizeText(text || '');
  if (!raw || /not reported|not assessable|unknown/.test(raw)) return 'Unknown';
  if (/both\s*(?:ends?\s*)?bare|both[- ]bare/.test(raw)) return 'Both-Bare';
  if (/end\s*bare|end[- ]bare|proximal\s*bare|distal\s*bare/.test(raw)) return 'End-Bare';
  if (/full(?:y)?\s*covered|full[- ]covered|fcsems/.test(raw)) return 'Full Covered';
  if (/partial(?:ly)?\s*covered|partial[- ]covered|pcsems/.test(raw)) return 'Partially Covered';
  if (/\buncovered\b|ucsems|bare\s*metal|uncoated/.test(raw)) return 'Uncovered';
  if (/\bcovered\b|\bcomvi\b/.test(raw)) return 'Covered';
  return 'Unknown';
}

function inferDueCoverDetail(due: DueItem): HierarchicalCoverDetail {
  return inferHierarchicalCoverDetail(`${due.productName || ''} ${due.deviceCategory || ''}`);
}

function coverFamily(detail: HierarchicalCoverDetail): 'Covered' | 'Uncovered' | 'Unknown' {
  if (detail === 'Uncovered') return 'Uncovered';
  if (detail === 'Unknown') return 'Unknown';
  return 'Covered';
}

function isExplicitTaewoongManufacturer(manufacturer: string): boolean {
  return /taewoong/i.test(manufacturer || '');
}

function isExplicitOtherManufacturer(manufacturer: string): boolean {
  const norm = normalizeText(manufacturer || '');
  if (!norm || /not reported|not assessable|unknown|n\/a/.test(norm)) return false;
  return !isExplicitTaewoongManufacturer(manufacturer);
}

function exactConfiguredDueNameMatch(extractedProduct: string, due: DueItem): boolean {
  const ext = normalizeText(extractedProduct);
  const cand = normalizeText(due.productName || '');
  if (!ext || !cand) return false;
  // Step 0 is intentionally limited to the configured product name itself.
  // Aliases are evaluated only at the final alias stage after anatomy/cover filters.
  return ext === cand || normalizeAlphaNumeric(extractedProduct) === normalizeAlphaNumeric(due.productName || '');
}

function matchConfiguredDueAlias(
  extractedProduct: string,
  due: DueItem
): { match: boolean; matchedAnchor: string } {
  const ext = normalizeText(extractedProduct);
  const extAlpha = normalizeAlphaNumeric(extractedProduct);
  if (!ext) return { match: false, matchedAnchor: '' };

  const aliases = String(due.aliases || '')
    .split(/[,;|\n]/)
    .map((a) => a.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const n = normalizeText(alias);
    const a = normalizeAlphaNumeric(alias);
    if (!n || !a) continue;

    // Niti-S is the common product-family name, never a model-identifying alias.
    if (a === 'nitis') continue;

    if (ext === n || extAlpha === a) {
      return { match: true, matchedAnchor: alias };
    }
  }
  return { match: false, matchedAnchor: '' };
}

function getDirectSubtypeTokens(due: DueItem): string[] {
  const tokens = new Set<string>();
  const name = due.productName || '';
  const bracketMatches = [...name.matchAll(/\[([^\]]+)\]/g)];
  for (const match of bracketMatches) {
    const raw = normalizeText(match[1] || '');
    if (raw) tokens.add(raw);
  }

  // Distinct model/brand anchors from the configured DUE name. Generic Niti-S
  // family wording is excluded by getBrandAnchors().
  for (const anchor of getBrandAnchors(name).anchors) {
    if (anchor && anchor.length >= 3) tokens.add(normalizeText(anchor));
  }

  // Product families whose model name is highly distinctive even without brackets.
  for (const known of ['spaxus', 'nagi', 'giobor', 'bumpy', 'kaffes', 'comvi', 'conio', 'cervical', 'beta-2', 'beta2', 'lcd']) {
    if (normalizeText(name).includes(normalizeText(known))) tokens.add(normalizeText(known));
  }

  return Array.from(tokens).filter(Boolean);
}

function directSubtypeMatch(extractedProduct: string, due: DueItem): { match: boolean; anchor: string } {
  const ext = normalizeText(extractedProduct);
  const extAlpha = normalizeAlphaNumeric(extractedProduct);
  if (!ext) return { match: false, anchor: '' };

  for (const token of getDirectSubtypeTokens(due)) {
    const tokenAlpha = normalizeAlphaNumeric(token);
    if (!tokenAlpha || tokenAlpha.length < 2) continue;

    // S/D/M-Type must be explicit. Plain Niti-S is never an S-Type alias.
    if (/^[sdm]\s*type$/.test(token) || /^[sdm]type$/.test(tokenAlpha)) {
      const letter = tokenAlpha[0];
      if (new RegExp(`\\b${letter}[\\s-]*type\\b`, 'i').test(extractedProduct)) {
        return { match: true, anchor: token };
      }
      continue;
    }

    if (
      ext === token ||
      extAlpha === tokenAlpha ||
      ext.includes(token) ||
      (tokenAlpha.length >= 4 && extAlpha.includes(tokenAlpha))
    ) {
      return { match: true, anchor: token };
    }
  }

  return { match: false, anchor: '' };
}


/**
 * Highly distinctive Taewoong model names that should identify the configured
 * DUE even when the paper does not reproduce the registered product name
 * verbatim (for example singular/plural "Stent/Stents", omitted Niti-S prefix,
 * trademark symbols, or extra descriptive words).
 *
 * Important: generic family wording such as plain "Niti-S" is intentionally
 * excluded. More specific variants are checked before their parent family
 * (Hot SPAXUS before SPAXUS).
 */
type DistinctiveModelKey = 'hot spaxus' | 'spaxus' | 'nagi' | 'bumpy' | 'hot giobor';

function getDistinctiveModelKey(text: string): DistinctiveModelKey | null {
  const norm = normalizeText(text || '');
  if (!norm) return null;

  if (/hot\s*[- ]?\s*spaxus/.test(norm)) return 'hot spaxus';
  if (/spaxus/.test(norm)) return 'spaxus';
  if (/nagi/.test(norm)) return 'nagi';
  if (/bumpy/.test(norm)) return 'bumpy';
  if (/hot\s*[- ]?\s*giobor/.test(norm)) return 'hot giobor';
  return null;
}

function getDistinctiveModelMatches(extractedProduct: string, dueList: DueItem[]): { key: DistinctiveModelKey | null; matches: DueItem[] } {
  const key = getDistinctiveModelKey(extractedProduct);
  if (!key) return { key: null, matches: [] };

  return {
    key,
    matches: dueList.filter((due) => getDistinctiveModelKey(due.productName || '') === key),
  };
}

function validateLockedDistinctiveDue(
  matched: DueItem,
  manufacturer: string,
  coverType: string,
  anatomicalContext: string
): string[] {
  const conflicts: string[] = [];

  if (isExplicitOtherManufacturer(manufacturer)) {
    conflicts.push(`manufacturer is reported as "${manufacturer}" rather than Taewoong Medical`);
  }

  const extractedSites = inferHierarchicalAnatomicalSites(anatomicalContext);
  const dueSites = inferDueAnatomicalSites(matched);
  if (extractedSites.size > 0 && dueSites.size > 0 && !sitesIntersect(extractedSites, dueSites)) {
    conflicts.push(`reported anatomical/use-site (${Array.from(extractedSites).join(', ')}) does not match the configured DUE context (${Array.from(dueSites).join(', ')})`);
  }

  const extractedCover = inferHierarchicalCoverDetail(coverType);
  const dueCover = inferDueCoverDetail(matched);
  const extractedFamily = coverFamily(extractedCover);
  const dueFamily = coverFamily(dueCover);
  if (extractedFamily !== 'Unknown' && dueFamily !== 'Unknown' && extractedFamily !== dueFamily) {
    conflicts.push(`reported cover family (${extractedFamily}) conflicts with the configured DUE cover family (${dueFamily})`);
  }

  return conflicts;
}

function collectSimilarDeviceCandidates(
  extractedProduct: string,
  dueList: DueItem[],
  legacySimilarDevices?: SimilarDevice[]
): SimilarDeviceMatchCandidate[] {
  const allCandidates: SimilarDeviceMatchCandidate[] = [];
  for (const due of dueList) {
    const rawSims = due.similarDevices || [];
    const parsedSims = rawSims.map(parseSimilarDevice).filter((s) => s.fullName.length > 0);
    for (const sim of parsedSims) {
      const cand = matchExtractedProductToSimilarDevice(extractedProduct, sim, due);
      if (cand) allCandidates.push(cand);
    }
  }

  if (allCandidates.length === 0 && legacySimilarDevices && legacySimilarDevices.length > 0) {
    const fallbackDues = dueList.length > 0
      ? dueList
      : [{ id: 'DUE-1', productName: 'Configured DUE', indications: [] } as DueItem];
    for (const legacySim of legacySimilarDevices) {
      const parsed = parseSimilarDevice(legacySim);
      if (!parsed.fullName) continue;
      for (const fallbackDue of fallbackDues) {
        const cand = matchExtractedProductToSimilarDevice(extractedProduct, parsed, fallbackDue);
        if (cand) allCandidates.push(cand);
      }
    }
  }
  return allCandidates;
}

function resultFromSimilarCandidates(
  extractedProduct: string,
  allCandidates: SimilarDeviceMatchCandidate[]
): DeviceClassificationResult | null {
  if (allCandidates.length === 0) return null;

  allCandidates.sort((a, b) => b.score - a.score);
  const uniqueFullNames = Array.from(new Set(allCandidates.map((c) => c.sim.fullName)));
  const uniqueDueIds = Array.from(new Set(allCandidates.map((c) => c.due.id)));

  if (uniqueFullNames.length > 1) {
    const first = allCandidates[0];
    return {
      type: 'Similar Device',
      matchedDueId: first.due.id,
      matchedDueName: first.due.productName,
      dueMatchStatus: 'Needs confirmation',
      matchBasis: 'Needs confirmation',
      mappedSimilarDeviceName: uniqueFullNames.join(' / '),
      mappedSimilarDeviceManufacturer: first.sim.manufacturer,
      rationale: `Device "${extractedProduct}" has multiple distinct Similar Device candidates (${uniqueFullNames.map((n) => `"${n}"`).join(', ')}) — Needs confirmation.`,
    };
  }

  // The same Similar Device may be registered under several selected DUE cards
  // (common in category-wide Step 1 selections). Its relationship is still
  // unambiguously Similar Device; only the reference DUE scope is multiple.
  if (uniqueFullNames.length === 1 && uniqueDueIds.length > 1) {
    const first = allCandidates[0];
    const referenceDues = Array.from(new Map(allCandidates.map((c) => [c.due.id, c.due])).values());
    return {
      type: 'Similar Device',
      matchedDueId: first.due.id,
      matchedDueName: referenceDues.map((d) => d.productName).join(' / '),
      dueMatchStatus: 'Multiple reference DUEs',
      matchBasis: first.basis,
      mappedSimilarDeviceName: uniqueFullNames[0],
      mappedSimilarDeviceManufacturer: first.sim.manufacturer,
      rationale: `Device "${extractedProduct}" matches configured Similar Device "${uniqueFullNames[0]}". The same Similar Device is registered under multiple selected DUEs (${referenceDues.map((d) => `${d.id}: ${d.productName}`).join(', ')}).`,
    };
  }

  const topCand = allCandidates[0];
  return {
    type: 'Similar Device',
    matchedDueId: topCand.due.id,
    matchedDueName: topCand.due.productName,
    dueMatchStatus: 'Similar Device Reference',
    matchBasis: topCand.basis,
    mappedSimilarDeviceName: topCand.sim.fullName,
    mappedSimilarDeviceManufacturer: topCand.sim.manufacturer,
    rationale: `Device "${extractedProduct}" matches Similar Device "${topCand.sim.fullName}"${topCand.sim.manufacturer ? ` (${topCand.sim.manufacturer})` : ''} configured for DUE ${topCand.due.id} ("${topCand.due.productName}").`,
  };
}

/**
 * Hierarchical DUE matching against the Step 1 DUE inventory.
 *
 * Decision order:
 * 0. Distinctive model name or exact configured product name -> lock DUE identity.
 *    Anatomy/cover/manufacturer then act as validation only; conflicts become Review Required.
 * 1. Manufacturer/company gate. Explicit non-Taewoong products skip DUE matching
 *    and are checked against Similar Devices.
 * 2. Anatomical/use-site filter (biliary, esophageal, pyloric/duodenal, colonic,
 *    pancreatic duct/collection, gallbladder). Missing site evidence does not exclude.
 * 3. Covered vs Uncovered family filter. Missing cover evidence does not exclude.
 * 4. Detailed cover configuration/model filter (Full/Partial/Both-Bare/End-Bare,
 *    Bumpy, Kaffes, SPAXUS, S-Type etc.).
 * 5. Configured/legacy aliases are LAST-RESORT only after the filters above. Niti-S
 *    itself is never an alias. Existing Niti-D/NDS and Multi-Purpose aliases remain supported.
 */
export function classifyDeviceWithInventory(
  extractedProduct: string,
  _extractedMfg: string,
  dueInventory: DueItem[] | DueSetup,
  legacySimilarDevices?: SimilarDevice[],
  coverType: string = '',
  anatomicalContext: string = ''
): DeviceClassificationResult {
  const dueList: DueItem[] = Array.isArray(dueInventory) ? dueInventory : [dueInventory];
  const normExtProduct = normalizeText(extractedProduct);

  if (!normExtProduct || normExtProduct.includes('not reported') || normExtProduct.includes('unknown')) {
    return {
      type: 'Not reported',
      rationale: 'Device product name is not reported or unidentified in the paper text.',
      dueMatchStatus: 'No DUE match',
    };
  }

  // 0a. Distinctive model names are strong product identity evidence. They are
  // evaluated before generic hierarchical filters because these names uniquely identify
  // a configured model even when the paper shortens or slightly varies the full name.
  // Downstream anatomy/cover/manufacturer evidence is validation-only: a conflict keeps
  // the DUE identity but marks it Review Required rather than downgrading it to Other Device.
  const distinctive = getDistinctiveModelMatches(extractedProduct, dueList);
  if (distinctive.key && distinctive.matches.length === 1) {
    const matched = distinctive.matches[0];
    const conflicts = validateLockedDistinctiveDue(matched, _extractedMfg, coverType, anatomicalContext);
    return {
      type: 'DUE',
      matchedDueId: matched.id,
      matchedDueName: matched.productName,
      dueMatchStatus: conflicts.length > 0 ? 'Configuration conflict – Review required' : 'Exact DUE match',
      matchingDueList: [matched],
      matchBasis: 'Registered alias match',
      rationale: conflicts.length > 0
        ? `Distinctive model name "${distinctive.key}" identifies DUE ${matched.id} ("${matched.productName}"). The DUE identity is retained, but review is required because ${conflicts.join('; ')}.`
        : `Distinctive model name "${distinctive.key}" identifies DUE ${matched.id} ("${matched.productName}") even though the full registered product name is not reproduced verbatim.`,
    };
  }
  if (distinctive.key && distinctive.matches.length > 1) {
    return {
      type: 'DUE',
      matchedDueId: distinctive.matches[0].id,
      matchedDueName: distinctive.matches[0].productName,
      dueMatchStatus: 'Multiple DUE match – Review required',
      matchingDueList: distinctive.matches,
      matchBasis: 'Registered alias match',
      rationale: `Distinctive model name "${distinctive.key}" matches multiple selected DUE entries (${distinctive.matches.map((d) => `${d.id}: ${d.productName}`).join(', ')}). Review required.`,
    };
  }

  // 0b. Exact configured DUE product name. Aliases are intentionally deferred to Step 5.
  const exactMatches = dueList.filter((due) => exactConfiguredDueNameMatch(extractedProduct, due));
  if (exactMatches.length === 1) {
    const matched = exactMatches[0];
    return {
      type: 'DUE',
      matchedDueId: matched.id,
      matchedDueName: matched.productName,
      dueMatchStatus: 'Exact DUE match',
      matchingDueList: [matched],
      matchBasis: 'Exact name match',
      rationale: `Exact configured DUE product name matched: "${matched.productName}". Used directly before hierarchical filtering.`,
    };
  }
  if (exactMatches.length > 1) {
    return {
      type: 'DUE',
      matchedDueId: exactMatches[0].id,
      matchedDueName: exactMatches[0].productName,
      dueMatchStatus: 'Multiple DUE match – Review required',
      matchingDueList: exactMatches,
      matchBasis: 'Needs confirmation',
      rationale: `Device "${extractedProduct}" exactly matches multiple configured DUE entries (${exactMatches.map((d) => `${d.id}: ${d.productName}`).join(', ')}). Review required.`,
    };
  }

  // Track explicit model/subtype wording before filtering. If that identity is
  // later excluded by anatomy/cover compatibility, do not silently remap the paper
  // to a different Taewoong model just because one candidate remains.
  const explicitDirectIdentityDues = dueList.filter((due) => directSubtypeMatch(extractedProduct, due).match);
  const hasLegacyIdentityWording = /\bniti[\s-]*d\b|\bnds\b|multi[\s-]*purpose/i.test(extractedProduct);
  const hasExplicitIdentityEvidence = explicitDirectIdentityDues.length > 0 || hasLegacyIdentityWording;

  // 1. Manufacturer/company gate. Explicit competitor manufacturer => Similar/Other.
  if (isExplicitOtherManufacturer(_extractedMfg)) {
    const similarResult = resultFromSimilarCandidates(
      extractedProduct,
      collectSimilarDeviceCandidates(extractedProduct, dueList, legacySimilarDevices)
    );
    if (similarResult) {
      return {
        ...similarResult,
        rationale: `Manufacturer "${_extractedMfg}" is not Taewoong Medical. ${similarResult.rationale}`,
      };
    }
    return {
      type: 'Other Device',
      dueMatchStatus: 'No DUE match',
      rationale: `Manufacturer "${_extractedMfg}" is not Taewoong Medical, and device "${extractedProduct}" is not present in the configured Similar Device lists. Classified as Other Device.`,
    };
  }

  let candidates = dueList.filter((d) => d.productName && d.productName.trim());
  const trace: string[] = [];
  let hierarchyEvidenceCount = 0;
  trace.push(isExplicitTaewoongManufacturer(_extractedMfg)
    ? 'Manufacturer: Taewoong Medical confirmed.'
    : 'Manufacturer: not explicitly reported; continuing conservatively using product/context evidence.');

  // 2. Anatomical/use-site first filter.
  const extractedSites = inferHierarchicalAnatomicalSites(anatomicalContext);
  if (extractedSites.size > 0) {
    hierarchyEvidenceCount += 1;
    const siteFiltered = candidates.filter((due) => sitesIntersect(extractedSites, inferDueAnatomicalSites(due)));
    if (siteFiltered.length > 0) {
      candidates = siteFiltered;
      trace.push(`Anatomical/use-site filter retained ${candidates.length} DUE candidate(s): ${Array.from(extractedSites).join(', ')}.`);
    } else {
      candidates = [];
      trace.push(`Anatomical/use-site filter found no compatible selected DUE for: ${Array.from(extractedSites).join(', ')}.`);
    }
  } else {
    trace.push('Anatomical/use-site: not clearly reported; no DUE excluded at this stage.');
  }

  // 3. Covered vs Uncovered family second filter.
  const extractedCover = inferHierarchicalCoverDetail(coverType);
  const extractedFamily = coverFamily(extractedCover);
  if (candidates.length > 0 && extractedFamily !== 'Unknown') {
    hierarchyEvidenceCount += 1;
    const coverFiltered = candidates.filter((due) => {
      const dueFamily = coverFamily(inferDueCoverDetail(due));
      return dueFamily === 'Unknown' || dueFamily === extractedFamily;
    });
    if (coverFiltered.length > 0) {
      candidates = coverFiltered;
      trace.push(`Cover-family filter (${extractedFamily}) retained ${candidates.length} DUE candidate(s).`);
    } else {
      candidates = [];
      trace.push(`Cover-family filter (${extractedFamily}) found no compatible selected DUE.`);
    }
  } else if (extractedFamily === 'Unknown') {
    trace.push('Cover family: not clearly reported; no DUE excluded at this stage.');
  }

  // 4a. If a detailed cover configuration is explicitly stated, apply it before model aliases.
  const detailedCover = ['Full Covered', 'Partially Covered', 'Both-Bare', 'End-Bare', 'Uncovered'].includes(extractedCover)
    ? extractedCover
    : 'Unknown';
  if (candidates.length > 0 && detailedCover !== 'Unknown' && detailedCover !== 'Uncovered') {
    hierarchyEvidenceCount += 1;
    const detailFiltered = candidates.filter((due) => {
      const dueDetail = inferDueCoverDetail(due);
      const explicitModel = directSubtypeMatch(extractedProduct, due).match;
      if (detailedCover === 'Full Covered') {
        // Prefer the explicit Full Covered-Type. A generic Covered model (e.g. Bumpy,
        // Cervical, Conio) remains only when its own model name is explicitly reported.
        return dueDetail === 'Full Covered' || (dueDetail === 'Covered' && explicitModel);
      }
      if (detailedCover === 'Partially Covered') {
        // Partial coverage can include Both-Bare / End-Bare configurations. Generic
        // Covered/ComVi candidates remain only when the model itself is named.
        return dueDetail === 'Partially Covered' || dueDetail === 'Both-Bare' || dueDetail === 'End-Bare' || (dueDetail === 'Covered' && explicitModel);
      }
      return dueDetail === detailedCover;
    });
    if (detailFiltered.length > 0) {
      candidates = detailFiltered;
      trace.push(`Detailed cover configuration (${detailedCover}) retained ${candidates.length} DUE candidate(s).`);
    } else {
      candidates = [];
      trace.push(`Detailed cover configuration (${detailedCover}) found no compatible selected DUE.`);
    }
  }

  // 4b. Directly reported model/subtype identity (Bumpy, SPAXUS, S-Type, etc.).
  if (candidates.length > 0) {
    const subtypeMatches = candidates
      .map((due) => ({ due, match: directSubtypeMatch(extractedProduct, due) }))
      .filter((x) => x.match.match);

    if (subtypeMatches.length === 1) {
      const matched = subtypeMatches[0];
      return {
        type: 'DUE',
        matchedDueId: matched.due.id,
        matchedDueName: matched.due.productName,
        dueMatchStatus: 'Exact DUE match',
        matchingDueList: [matched.due],
        matchBasis: 'Registered alias match',
        rationale: `${trace.join(' ')} Specific model/subtype "${matched.match.anchor}" identifies DUE ${matched.due.id} ("${matched.due.productName}").`,
      };
    }
    if (subtypeMatches.length > 1) {
      candidates = subtypeMatches.map((x) => x.due);
      trace.push(`Specific model/subtype wording still matches ${candidates.length} candidates; review may be required.`);
    }
  }

  // 5. Aliases are LAST. First check explicitly configured aliases among the
  // remaining candidates, then the restricted legacy aliases. Plain "Niti-S" is
  // intentionally NOT an alias at either stage.
  if (candidates.length > 0) {
    const configuredAliasMatches = candidates
      .map((due) => ({ due, alias: matchConfiguredDueAlias(extractedProduct, due) }))
      .filter((x) => x.alias.match);

    if (configuredAliasMatches.length === 1) {
      const matched = configuredAliasMatches[0];
      return {
        type: 'DUE',
        matchedDueId: matched.due.id,
        matchedDueName: matched.due.productName,
        dueMatchStatus: 'Exact DUE match',
        matchingDueList: [matched.due],
        matchBasis: 'Registered alias match',
        rationale: `${trace.join(' ')} Final-stage configured alias "${matched.alias.matchedAnchor}" identifies DUE ${matched.due.id} ("${matched.due.productName}").`,
      };
    }
    if (configuredAliasMatches.length > 1) {
      candidates = configuredAliasMatches.map((x) => x.due);
      trace.push(`Configured aliases match multiple remaining DUEs (${candidates.map((d) => d.productName).join(' / ')}).`);
    }
  }

  if (candidates.length > 0) {
    const legacyMatches = candidates
      .map((due) => ({
        due,
        alias: matchLegacyConfiguredDueAlias(extractedProduct, _extractedMfg, due, coverType),
      }))
      .filter((x) => x.alias.match);

    if (legacyMatches.length === 1) {
      const matched = legacyMatches[0];
      return {
        type: 'DUE',
        matchedDueId: matched.due.id,
        matchedDueName: matched.due.productName,
        dueMatchStatus: 'Exact DUE match',
        matchingDueList: [matched.due],
        matchBasis: 'Registered alias match',
        rationale: `${trace.join(' ')} Last-resort legacy alias "${matched.alias.matchedAnchor}" identifies DUE ${matched.due.id} ("${matched.due.productName}").`,
      };
    }
    if (legacyMatches.length > 1) {
      candidates = legacyMatches.map((x) => x.due);
      trace.push(`Legacy aliases match multiple remaining DUEs (${candidates.map((d) => d.productName).join(' / ')}).`);
    }
  }

  // If all hierarchical filters leave exactly one candidate, do NOT silently call it
  // a DUE unless there is product/model identity evidence. Filters narrow identity;
  // they do not create identity by themselves.
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const standard = checkBrandOrNameMatch(extractedProduct, candidate.productName, getBrandAnchors(candidate.productName).anchors);
    if (standard.match && standard.score >= 85) {
      return {
        type: 'DUE',
        matchedDueId: candidate.id,
        matchedDueName: candidate.productName,
        dueMatchStatus: 'Exact DUE match',
        matchingDueList: [candidate],
        matchBasis: standard.score >= 95 ? 'Exact name match' : 'Registered alias match',
        rationale: `${trace.join(' ')} Product/model evidence ("${standard.matchedAnchor}") confirms DUE ${candidate.id} ("${candidate.productName}").`,
      };
    }

    // A single candidate produced by explicit Taewoong + use-site/cover filters is
    // sufficient for hierarchical identification even when the paper uses only the
    // generic family name. This is the intended purpose of the ordered filters.
    if (isExplicitTaewoongManufacturer(_extractedMfg) && hierarchyEvidenceCount > 0 && !hasExplicitIdentityEvidence) {
      return {
        type: 'DUE',
        matchedDueId: candidate.id,
        matchedDueName: candidate.productName,
        dueMatchStatus: 'Exact DUE match',
        matchingDueList: [candidate],
        matchBasis: 'Hierarchical context match',
        rationale: `${trace.join(' ')} The ordered Step 1 filters leave one Taewoong DUE candidate: ${candidate.id} ("${candidate.productName}").`,
      };
    }
  }

  // An explicitly named model/subtype that was removed by the ordered filters is
  // a configuration conflict, not permission to reassign the device to another model.
  if (hasExplicitIdentityEvidence) {
    const namedIdentity = explicitDirectIdentityDues.map((d) => d.productName).join(' / ')
      || (hasLegacyIdentityWording ? 'legacy D/M subtype wording' : extractedProduct);
    return {
      type: 'Other Device',
      dueMatchStatus: 'Configuration conflict – Review required',
      matchingDueList: candidates.length > 0 ? candidates : undefined,
      matchBasis: 'Needs confirmation',
      rationale: `${trace.join(' ')} Explicit product/subtype identity (${namedIdentity}) conflicts with the remaining anatomical/cover configuration. The device is not reassigned to another DUE; review is required.`,
    };
  }

  // DUE not confirmed: check Similar Device registry next, then Other Device.
  const similarResult = resultFromSimilarCandidates(
    extractedProduct,
    collectSimilarDeviceCandidates(extractedProduct, dueList, legacySimilarDevices)
  );
  if (similarResult) {
    return {
      ...similarResult,
      rationale: `${trace.join(' ')} DUE identity was not confirmed. ${similarResult.rationale}`,
    };
  }

  if (candidates.length > 1) {
    return {
      type: 'Other Device',
      dueMatchStatus: 'Needs confirmation',
      matchingDueList: candidates,
      matchBasis: 'Needs confirmation',
      rationale: `${trace.join(' ')} Multiple selected DUE candidates remain, but no exact product/model/approved alias identifies one of them. Device "${extractedProduct}" is not auto-assigned; manual confirmation is required.`,
    };
  }

  return {
    type: 'Other Device',
    dueMatchStatus: candidates.length === 0 ? 'No DUE match' : 'Needs confirmation',
    matchingDueList: candidates.length > 0 ? candidates : undefined,
    matchBasis: candidates.length > 0 ? 'Needs confirmation' : undefined,
    rationale: `${trace.join(' ')} Device "${extractedProduct}" could not be confirmed as any selected DUE and was not found in the Similar Device registry. Classified as Other Device${candidates.length > 0 ? ' with manual confirmation recommended' : ''}.`,
  };
}

export function classifyDeviceRelationship(
  extractedProduct: string,
  extractedMfg: string,
  due: DueSetup | DueItem[],
  legacySimilarDevices?: SimilarDevice[]
): {
  type: DeviceRelationshipType;
  rationale: string;
} {
  const res = classifyDeviceWithInventory(extractedProduct, extractedMfg, due, legacySimilarDevices);
  return {
    type: res.type,
    rationale: res.rationale,
  };
}

/**
 * Expands medical clinical acronyms and standardizes clinical procedures
 */
