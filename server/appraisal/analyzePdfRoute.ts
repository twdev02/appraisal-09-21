import type { Express } from 'express';
import { analyzePdfUpload } from './analyzePdfUpload';
import { handleAnalyzePdf } from './analyzePdfHandler';

/** Route registration only. Analysis logic is split into stage modules. */
export function registerAnalyzePdfRoute(app: Express): void {
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
    handleAnalyzePdf,
  );
}
