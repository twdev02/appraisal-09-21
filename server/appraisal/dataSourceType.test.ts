import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateDataSourceType } from './dataSourceType';
const evidence = { dataSourceQuote: 'A defined cohort of consecutive patients was followed for 12 months.', dataSourceLocation: 'Methods', dataSourceRationale: 'Defined population, endpoints and observation methods.' };

test('scores eligible clinical designs with evidence, including single-arm cohorts', () => {
  for (const design of ['randomized_trial', 'nonrandomized_interventional', 'cohort', 'case_control', 'cross_sectional']) {
    assert.equal(evaluateDataSourceType({ ...evidence, dataSourceStudyDesign: design }, '').score, 2);
  }
  assert.equal(evaluateDataSourceType({ ...evidence, dataSourceStudyDesign: 'cohort' }, 'Single-arm retrospective cohort').score, 2);
});
test('excluded, ambiguous and unsupported designs never receive automatic credit', () => {
  for (const design of ['case_report', 'case_series', 'review', 'editorial_opinion', 'nonclinical', 'unclear', '']) {
    assert.equal(evaluateDataSourceType({ ...evidence, dataSourceStudyDesign: design }, '').score, 1);
  }
  assert.equal(evaluateDataSourceType({}, 'Retrospective study').score, 1);
  assert.equal(evaluateDataSourceType({ dataSourceStudyDesign: 'cohort' }, 'cohort').score, 1);
  assert.equal(evaluateDataSourceType({ ...evidence, dataSourceStudyDesign: 'cohort' }, 'Retrospective case series').score, 1);
});
