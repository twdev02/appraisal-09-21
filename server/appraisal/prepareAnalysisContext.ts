import { PDFParse } from 'pdf-parse';
import type { DueItem, DueSetup, SimilarDevice } from '../../src/types';
import {
  evaluateIndicationWithInventory,
  classifyDeviceWithAnatomicalContext,
  cleanExtractedIndicationText,
} from '../../src/utils/nlpRules';
import { getGeminiClient, callGeminiWithRetry, isGeminiDailyQuotaError } from './geminiClient';
import { buildAppraisalPrompt } from './appraisalPrompt';
import {
  extractMarkdownDemographicEvidence,
  validatePatientCountEvidence,
  validateFollowUpEvidence,
} from './markdownEvidence';
import { extractMarkdownAppraisalEvidence } from './markdownAppraisalEvidence';

export interface PreparedAnalysisContext {
  res: any;
  paperText: string;
  markdownText: string;
  markdownDemographics: ReturnType<typeof extractMarkdownDemographicEvidence>;
  markdownAppraisalEvidence: ReturnType<typeof extractMarkdownAppraisalEvidence>;
  dueList: DueItem[];
  due: DueSetup;
  similarDevices: SimilarDevice[];
  fileName: string;
  documentContentParts: any[];
  ai: any;
  parsedAi: any;
  articleMetadata: any;
  patientCountValidation: any;
  followUpValidation: any;
  useMarkdownFollowUp: boolean;
  isMissingExtractedValue: (value: unknown) => boolean;
  researchGroups: any[];
  primaryResearchGroup: any;
}

/**
 * Stage 1-2: request/PDF/Gemini extraction plus research-group normalization.
 * This is a structural extraction from the former analyzePdfRoute.ts; appraisal
 * scoring and safety logic intentionally live in separate stages.
 */
export async function prepareAnalysisContext(req: any, res: any): Promise<PreparedAnalysisContext | any> {
  req.setTimeout(300000);
  res.setTimeout(300000);
  let paperText = req.body.paperText || '';
  const markdownText = typeof req.body.markdownText === 'string' ? req.body.markdownText : '';
  const markdownDemographics = extractMarkdownDemographicEvidence(markdownText);
  const markdownAppraisalEvidence = extractMarkdownAppraisalEvidence(markdownText);
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

  const promptInstructions = buildAppraisalPrompt(dueList);

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


  // Markdown is an auxiliary evidence layer, not a replacement for the existing
  // PDF/Gemini extraction. Only explicit current-study demographic evidence from
  // confident baseline tables (or direct current-study narrative) may correct the
  // study-wide patient count. Uncertain tables are ignored by the parser.
  const patientCountValidation = validatePatientCountEvidence(
    articleMetadata.totalPatientCount,
    markdownDemographics.patientCount
  );
  if (patientCountValidation.selectedValue !== 'Not reported') {
    articleMetadata.totalPatientCount = patientCountValidation.selectedValue;
  }

  // Follow-up is cross-checked only against explicit current-study follow-up evidence.
  // Survival, stent patency, TRBO/RBO, and other time-to-event endpoints are not
  // allowed to overwrite a true follow-up duration from Markdown.
  const followUpValidation = validateFollowUpEvidence(
    articleMetadata.followUpPeriod,
    markdownDemographics.followUp
  );
  const useMarkdownFollowUp = Boolean(
    markdownDemographics.followUp &&
    ['validated', 'md_only', 'conflict'].includes(followUpValidation.status)
  );
  if (useMarkdownFollowUp && followUpValidation.selectedValue !== 'Not reported') {
    articleMetadata.followUpPeriod = followUpValidation.selectedValue;
  }

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

  return {
    res,
    paperText,
    markdownText,
    markdownDemographics,
    markdownAppraisalEvidence,
    dueList,
    due,
    similarDevices,
    fileName,
    documentContentParts,
    ai,
    parsedAi,
    articleMetadata,
    patientCountValidation,
    followUpValidation,
    useMarkdownFollowUp,
    isMissingExtractedValue,
    researchGroups,
    primaryResearchGroup,
  };
}
