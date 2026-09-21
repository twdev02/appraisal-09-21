import type { Express } from 'express';
import { analyzePdfUpload } from './analyzePdfUpload';
import { handleAnalyzePdf } from './analyzePdfHandler';
import { AnalysisJobs } from './analysisJobs';

/** Route registration only. Analysis logic is split into stage modules. */
export function registerAnalyzePdfRoute(app: Express): void {
  const jobs = new AnalysisJobs(handleAnalyzePdf);
  app.get('/api/analyze-pdf/jobs/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Analysis job expired or the backend restarted. Please retry this article.' });
    }
    if (job.status === 'running') return res.status(202).json({ success: true, status: 'running' });
    return res.status(job.statusCode).json(job.body);
  });
  app.post(
    '/api/analyze-pdf',
    (req, res, next) => {
      analyzePdfUpload.single('file')(req as any, res as any, (err: any) => {
        if (err) {
          console.error('[Multer upload error]:', err);
          return res.status(400).json({
            success: false,
            error: `File upload error: ${err.message || String(err)}`,
            failedField: 'File Upload',
          });
        }
        next();
      });
    },
    (req, res) => {
      // Preserve the synchronous API for older clients.
      if (req.body.analysisMode !== 'async' && req.get('Prefer') !== 'respond-async') return handleAnalyzePdf(req, res);
      const jobId = jobs.start(req);
      res.setHeader('Cache-Control', 'no-store');
      if (!jobId) return res.status(503).json({ success: false, error: 'The analysis server is busy. Please retry shortly.' });
      return res.status(202).json({ success: true, jobId });
    },
  );
}
