import type { FullAppraisalData } from '../../src/types';
import { runSelfValidation } from '../../src/utils/selfValidation';
import { prepareAnalysisContext, type PreparedAnalysisContext } from './prepareAnalysisContext';
import { buildAppraisalScoring } from './buildAppraisalScoring';
import { buildSafetyResult } from './buildSafetyResult';

/**
 * Orchestrates the existing analysis stages. Clinical rules remain inside the
 * stage modules; this file only wires their outputs together.
 */
export async function handleAnalyzePdf(req: any, res: any): Promise<void> {
  try {
    const prepared = await prepareAnalysisContext(req, res);
    if (res.headersSent || !prepared || !prepared.parsedAi) return;

    const ctx = prepared as PreparedAnalysisContext;
    const scoring = buildAppraisalScoring(ctx);
    const safety = await buildSafetyResult(ctx);
    if (res.headersSent || !safety) return;

    const result: FullAppraisalData = {
      due: ctx.due,
      dueList: ctx.dueList,
      similarDevices: ctx.similarDevices,
      articleMetadata: ctx.articleMetadata,
      rawPaperText: ctx.paperText,
      evidenceValidation: {
        markdownAvailable: Boolean(ctx.markdownText.trim()),
        trustedMarkdownTables: ctx.markdownDemographics.trustedTableCount,
        uncertainMarkdownTables: ctx.markdownDemographics.uncertainTableCount,
        patientCount: ctx.patientCountValidation,
        gender: scoring.genderValidation,
        followUp: ctx.followUpValidation,
        statisticalMethod: scoring.statisticalValidation,
        clinicalOutcome: scoring.clinicalOutcomeValidation,
      },
      pdfFileName: ctx.fileName,
      researchGroups: ctx.researchGroups,
      suitability: scoring.suitability,
      relevance: scoring.relevance,
      methodological: scoring.methodological,
      contribution: scoring.contribution,
      safety,
    };

    result.selfValidation = runSelfValidation(result);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Extraction handler error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to extract clinical data from PDF.',
      failedField: 'Extraction Pipeline',
    });
  }
}
