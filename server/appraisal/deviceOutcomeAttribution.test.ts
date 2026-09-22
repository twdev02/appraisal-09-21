import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeviceOutcomeExtractable } from './deviceOutcomeAttribution';
const evidence = {
  extractable: true, basis: 'device_specific', outcome: 'Technical success 94%',
  outcomeQuote: 'Technical success was 94%.', outcomeLocation: 'Table 3',
  attributionQuote: 'This arm used Niti-S M-Type only.', attributionLocation: 'Methods',
};
test('pooled simultaneous SBS results cannot earn DUE credit through device counts', () => {
  for (const count of ['30', '62', 'Not separately reported', 'Not reported']) {
    for (const inventorySize of [1, 2]) {
      const device = { deviceProductName: 'Niti-S M-Type', devicePatientNumber: count, __groupDeviceCount: inventorySize };
      assert.equal(isDeviceOutcomeExtractable(device), false);
      assert.equal(isDeviceOutcomeExtractable({ ...device, outcomeAttribution: { ...evidence, basis: 'pooled' } }), false);
    }
  }
});
test('requires product attribution and quantitative outcome evidence', () => {
  for (const basis of ['device_specific', 'exclusive_device_cohort']) {
    assert.equal(isDeviceOutcomeExtractable({ outcomeAttribution: { ...evidence, basis } }), true);
  }
  for (const field of ['outcome', 'outcomeQuote', 'outcomeLocation', 'attributionQuote', 'attributionLocation']) {
    assert.equal(isDeviceOutcomeExtractable({ outcomeAttribution: { ...evidence, [field]: 'Not reported' } }), false);
  }
  assert.equal(isDeviceOutcomeExtractable({ outcomeAttribution: { ...evidence, extractable: false } }), false);
});
