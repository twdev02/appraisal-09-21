import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnalysisJobs } from './analysisJobs';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('slow analysis runs independently and retains its result for repeated polls', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const jobs = new AnalysisJobs(async (req, res) => {
    req.setTimeout(1);
    res.setTimeout(1);
    await gate;
    res.json({ success: true, data: req.body });
  });
  const id = jobs.start({ body: { title: 'Paper' }, setTimeout() { throw new Error('Closed socket'); } })!;
  assert.equal(jobs.get(id)?.status, 'running');
  await tick();
  assert.equal(jobs.get(id)?.status, 'running');
  finish();
  await tick();
  assert.equal(jobs.get(id)?.status, 'completed');
  assert.deepEqual(jobs.get(id)?.body, { success: true, data: { title: 'Paper' } });
  assert.equal(jobs.get(id)?.statusCode, 200);
  assert.equal(jobs.get('unknown'), undefined);
});

test('provider errors and unexpected failures remain terminal results', async () => {
  const jobs = new AnalysisJobs(async (_req, res) => {
    res.status(429).json({ success: false, error: 'Quota exhausted' });
  });
  const id = jobs.start({ body: {} })!;
  await tick();
  assert.equal(jobs.get(id)?.statusCode, 429);
  assert.equal(jobs.get(id)?.body.error, 'Quota exhausted');
  const broken = new AnalysisJobs(async () => { throw new Error('Pipeline failed'); });
  const failedId = broken.start({ body: {} })!;
  await tick();
  assert.equal(broken.get(failedId)?.statusCode, 500);
  assert.equal(broken.get(failedId)?.body.error, 'Pipeline failed');
});

test('concurrency is bounded and completed work releases capacity', async () => {
  const jobs = new AnalysisJobs(async (_req, res) => { res.json({ success: true }); });
  for (let i = 0; i < 4; i++) assert.ok(jobs.start({ body: {} }));
  assert.equal(jobs.start({ body: {} }), null);
  await tick();
  assert.ok(jobs.start({ body: {} }));
  await tick();
});
