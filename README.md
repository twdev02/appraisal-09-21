# Clinical Literature Appraisal Extractor

Appraisal-only clinical literature evaluation application.

## Scope

- Clinical literature appraisal (Steps 1-4)
- Multi-PDF batch analysis and retry flow
- Optional pre-generated Markdown evidence paired to each PDF
- PDF ↔ Markdown cross-validation for demographic/appraisal/safety evidence
- DUE / Similar Device / indication logic
- FMEA safety matching and self-validation
- Word (.docx) export

## PDF + Markdown workflow

The app no longer converts PDFs to Markdown during appraisal.

```text
PDF upload (queued; no automatic analysis)
  -> optional MD attachment on each article card
  -> Start Analysis
  -> PDF/Gemini appraisal extraction
  -> uploaded MD deterministic evidence parsing
  -> PDF ↔ MD evidence reconciliation
  -> Steps 1-4
```

PDF is required. Markdown is optional. If no matching Markdown file is supplied, the article continues through the existing PDF-only appraisal path.

Use **Attach MD (optional)** on the corresponding PDF card. File names do not need to match; select the correct paper yourself. UTF-8 `.md` and `.markdown` files are supported. Empty files are rejected.

Use **Replace MD** or **Remove MD** to change the attachment. If results already exist, a reanalysis notice appears; click **Reanalyze** or **Start Analysis** to apply the change. Until then, existing results describe the previous input and the article is excluded from batch Word export. Attachments cannot be changed during analysis. Files and attachments remain in this browser session only.

## Architecture

```text
server.ts
  -> server/appraisal/analyzePdfRoute.ts
       -> prepareAnalysisContext.ts
       -> appraisalPrompt.ts
       -> markdownEvidence.ts
       -> markdownAppraisalEvidence.ts
       -> markdownSafetyEvidence.ts
       -> buildAppraisalScoring.ts
       -> buildSafetyResult.ts

src/App.tsx
  -> per-article MD attachments + batch orchestration
  -> Appraisal Steps 1-4
  -> features/appraisal/services/appraisalApi.ts
```

The runtime `/api/convert-to-md` route and the separate PDF → Markdown Lab were removed. Pre-generate Markdown externally, then upload it alongside the PDF when cross-validation is desired.

## Run locally

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` or configure AI Studio Secrets.
3. Set `GEMINI_API_KEY` (optional backup keys remain supported if already configured).
4. Run: `npm run dev`

PDF analysis uses a short upload request followed by polling, so model extraction
and repair calls do not keep a gateway connection open. Run the Express server
(`npm run dev`, or `npm run build` then `npm start`); `npm run preview` only serves
the frontend and cannot process analyses. Jobs live in one server process, with
up to four running at once and up to 32 retained jobs. Completed results expire
after 15 minutes. A server restart requires retrying unfinished articles; multiple
server replicas require a shared job store/worker before deployment.
