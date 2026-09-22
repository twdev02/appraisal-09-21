import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAdequateControls } from './adequateControls';

const supported = {
  adequateControlsSelection: 'Adequate (2)',
  adequateControlsComparisonType: 'concurrent',
  adequateControlsComparatorAppropriate: true,
  adequateControlsConfoundingControlled: true,
  adequateControlsQuote: 'Patients were randomized to device A or standard treatment B.',
  adequateControlsLocation: 'Methods',
  adequateControlsConfoundingQuote: 'Allocation was concealed and outcome assessors were blinded.',
  adequateControlsConfoundingLocation: 'Methods',
  adequateControlsComment: 'Relevant comparator and reported measures address material bias.',
};

test('requires positive comparison and confounding evidence, not the AI selection alone', () => {
  assert.equal(evaluateAdequateControls({}).score, 1);
  assert.equal(evaluateAdequateControls({ adequateControlsSelection: 'Adequate (2)' }).score, 1);
  assert.equal(evaluateAdequateControls(supported).score, 2);
  for (const comparison of ['none', 'before_after_only', 'unclear']) {
    assert.equal(evaluateAdequateControls({ ...supported, adequateControlsComparisonType: comparison }).score, 1);
  }
  for (const field of ['adequateControlsComparatorAppropriate', 'adequateControlsConfoundingControlled']) {
    assert.equal(evaluateAdequateControls({ ...supported, [field]: false }).score, 1);
  }
  assert.equal(evaluateAdequateControls({ ...supported, adequateControlsConfoundingQuote: 'Not reported' }).score, 1);
  for (const comparison of ['external', 'performance_criterion']) {
    assert.equal(evaluateAdequateControls({ ...supported, adequateControlsComparisonType: comparison }).score, 2);
    assert.equal(evaluateAdequateControls({ ...supported, adequateControlsComparisonType: comparison, adequateControlsComparatorAppropriate: false }).score, 1);
  }
});
