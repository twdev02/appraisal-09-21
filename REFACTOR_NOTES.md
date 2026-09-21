# Refactor Notes

## Removed: Screening-only code

- `server/screeningService.ts`
- `server/screeningExamples.ts`
- Screening training JSON/JSONL and training-source files
- `scripts/buildProductScreeningData.mjs`
- `src/components/screening/*`
- `src/types/screening.ts`
- `src/data/screeningPresets.ts`
- `src/data/productCatalog.ts`
- `src/utils/risParser.ts`
- `src/utils/screeningExcel.ts`
- `src/utils/screeningSessionDb.ts`
- Screening-only stent product image assets under `public/stents/`
- Screening REST endpoints in `server.ts`
- `xlsx` direct dependency from `package.json`

## Preserved: Appraisal functionality

- Step 1 setup / PDF upload / multi-PDF article list / remove / retry
- Multi-DUE configuration and Similar Device data
- Step 2 research group inventory
- Step 3 suitability, relevance, methodology, contribution
- Step 4 safety event extraction, hierarchy, FMEA matching, candidate review
- Self-validation
- Single and batch DOCX export
- Gemini API quota failover/retry behavior

## Markdown evidence workflow

The standalone runtime PDF -> Markdown converter and Markdown Lab were removed.
Appraisal accepts optional pre-generated Markdown files uploaded together with PDFs.
The browser pairs PDF/MD files by normalized filename and sends the matched Markdown text
to the existing deterministic evidence parsers during `/api/analyze-pdf`. No additional
Gemini Markdown-conversion call is made during appraisal.

## NLP refactor

The former ~4,600-line `nlpRules.ts` is now a compatibility barrel. Logic is divided by responsibility:

- `medicalText.ts`: shared medical acronym expansion
- `deviceMatching.ts`: DUE / Similar / Other classification and device normalization
- `indication.ts`: indication parsing and relationship classification
- `extraction.ts`: deterministic extraction helpers, verification suite, time-range parsing
- `appraisalInterpretation.ts`: appraisal-specific interpretation helpers (aspects, gender)
- `safetyExtraction.ts`: deterministic safety table extraction and completeness checks

Existing imports from `src/utils/nlpRules.ts` remain valid through re-exports.

## Server refactor

`server.ts` now contains only app/bootstrap/middleware wiring. Appraisal server responsibilities are separated into:

- `server/appraisal/analyzePdfRoute.ts`: `/api/analyze-pdf` pipeline
- `server/appraisal/appraisalPrompt.ts`: stable Gemini extraction prompt
- `server/appraisal/geminiClient.ts`: API-key pooling, retry, quota handling
- `server/appraisal/safetyProcessing.ts`: safety percentages and hierarchy post-processing

## 2026-09-18: Uploaded PDF + MD pairing mode

- Removed runtime PDF -> Markdown conversion route and Markdown Lab UI.
- Appraisal now accepts PDF files together with optional pre-generated `.md` / `.markdown` files.
- PDF and MD files are paired automatically by normalized filename.
- Common suffixes such as `_converted`, `_markdown`, `_md`, and browser download copy suffixes `(1)`, `(2)`, etc. are tolerated only when the match is unique.
- Matched MD text is sent only as supporting evidence to the existing deterministic Markdown evidence parsers.
- No additional Gemini call is made for Markdown conversion.
- PDF-only appraisal remains supported when no matching MD is supplied.
- The full Markdown text is not returned in the appraisal response, reducing retained batch payload size.
