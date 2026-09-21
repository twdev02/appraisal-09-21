import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callAnalyzePdfApi, AnalysisRequestError } from './appraisalApi';

test('polling survives gateway interruption without submitting analysis twice', async (t) => {
  const replies = [
    new Response(JSON.stringify({ jobId: 'test-job' }), { status: 202 }),
    new Response('<html>Gateway timeout</html>', { status: 504 }),
    new Response(JSON.stringify({ status: 'running' }), { status: 202 }),
    new Response(JSON.stringify({ success: true, data: { pdfFileName: 'test.pdf' } })),
  ];
  const calls: { url: string; method?: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') assert.equal((init.body as FormData).get('analysisMode'), 'async');
    calls.push({ url, method: init.method });
    return replies.shift()!;
  });
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { queueMicrotask(callback); return 0; });
  const result = await callAnalyzePdfApi(new FormData());
  assert.equal(result.pdfFileName, 'test.pdf');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(calls.slice(1).every(call => call.url === '/api/analyze-pdf/jobs/test-job'));
});

test('empty HTTP 200 and network failures signal that the batch must pause', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('   '));
  await assert.rejects(callAnalyzePdfApi(new FormData()), (error: unknown) =>
    error instanceof AnalysisRequestError && error.backendUnavailable && /empty response/.test(error.message));
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(callAnalyzePdfApi(new FormData()), (error: unknown) =>
    error instanceof AnalysisRequestError && error.backendUnavailable);
});

test('static HTML is diagnosed as an API response problem, not a timeout', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<!doctype html><html>App</html>'));
  await assert.rejects(callAnalyzePdfApi(new FormData()), /static preview cannot analyze PDFs/);
});

test('provider errors remain visible and are not automatically resubmitted', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: 'Daily quota exhausted' }), { status: 429 }
  ));
  await assert.rejects(callAnalyzePdfApi(new FormData()), (error: unknown) =>
    error instanceof AnalysisRequestError && !error.backendUnavailable && /Daily quota exhausted/.test(error.message));
  assert.equal(fetch.mock.callCount(), 1);
});
