import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { registerAnalyzePdfRoute } from './analyzePdfRoute';

test('HTTP upload returns a job and polling preserves pipeline errors', async () => {
  const keys = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GOOGLE_API_KEY', 'API_KEY'];
  const original = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  const app = express();
  registerAnalyzePdfRoute(app);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const form = new FormData();
    form.set('paperText', 'Test document');
    const upload = await fetch(`${base}/api/analyze-pdf`, {
      method: 'POST', headers: { Prefer: 'respond-async' }, body: form,
    });
    assert.equal(upload.status, 202);
    const { jobId } = await upload.json() as { jobId: string };
    assert.ok(jobId);
    let result = await fetch(`${base}/api/analyze-pdf/jobs/${jobId}`);
    for (let attempt = 0; result.status === 202 && attempt < 10; attempt++) {
      await result.text();
      await new Promise(resolve => setTimeout(resolve, 10));
      result = await fetch(`${base}/api/analyze-pdf/jobs/${jobId}`);
    }
    assert.equal(result.status, 500);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.match((await result.json() as { error: string }).error, /GEMINI_API_KEY is not configured/);
    const missing = await fetch(`${base}/api/analyze-pdf/jobs/unknown`);
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
});
