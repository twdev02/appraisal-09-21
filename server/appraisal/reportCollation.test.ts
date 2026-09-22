import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasReportedObservationDuration, scoreReportCollation } from './reportCollation';

test('requires a duration tied to observation, not just numbers or endpoint timepoints', () => {
  for (const text of [
    'Patients were followed up.',
    'Follow-up was performed in 112 patients.',
    '30-day mortality was 1.8%.',
    'Clinical success was bilirubin reduction within 7 days.',
    'Patients were enrolled from January 2019 to June 2024.',
    'Follow-up visits assessed 30-day mortality.',
    'Median overall survival was 6 months; follow-up was not reported.',
    'Stent patency was 30 days.',
    'Loss to follow-up was 5%.',
  ]) assert.equal(hasReportedObservationDuration(text), false, text);
  for (const text of [
    'Median follow-up was 6 months.',
    'Patients were followed up for 30 days.',
    'The observation period was 7 days.',
    'Follow-up ranged from 3–12 months.',
    'A 30-day follow-up was completed.',
    '| Median follow-up (months) | 6 (3–12) |',
  ]) assert.equal(hasReportedObservationDuration(text), true, text);
});

test('all missing-count boundaries use the stricter report grading', () => {
  for (let missing = 0; missing <= 9; missing++) {
    assert.deepEqual(scoreReportCollation(missing), missing === 0
      ? { selection: 'High quality', score: 3 }
      : missing <= 2
        ? { selection: 'Minor deficiencies', score: 2 }
        : { selection: 'Insufficient information', score: 1 });
  }
});
