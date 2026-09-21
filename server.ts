import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { registerAnalyzePdfRoute } from './server/appraisal/analyzePdfRoute';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  // Ensure JSON content-type header for all /api routes
  app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });

  // Health check API
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  registerAnalyzePdfRoute(app);

  // Explicit API error handling to always return JSON for API requests
  app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Middleware Error]:', err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal Server Error in API processing',
      failedField: 'API Middleware',
    });
  });

  // Catch-all 404 handler for unmatched /api routes to prevent Vite from returning index.html
  app.all(['/api', '/api/*'], (req, res) => {
    res.status(404).json({
      success: false,
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      failedField: 'Routing',
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Clinical Literature Appraisal Extractor running on port ${PORT}`);
  });

  // Long PDF/model requests can legitimately exceed Node's conservative defaults.
  // Keep the connection alive while Gemini is working instead of terminating the
  // browser request and surfacing only a generic "Failed to fetch" message.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;
  httpServer.keepAliveTimeout = 120_000;
}

startServer();
