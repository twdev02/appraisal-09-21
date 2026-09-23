import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateDeviceCredit, isDeviceOutcomeExtractable } from './deviceOutcomeAttribution';
function device(type: string, complete: boolean, exclusive = false): any {
  return { deviceRelationship: { aiRecommended: type }, __groupDeviceCount: 2,
    __clinicalEndpointInventory: ['technical', 'clinical'].map(id => ({id,name:id,quote:'Reported endpoint',location:'Results'})),
    outcomeAttribution: { extractable: true, basis: exclusive ? 'exclusive_device_cohort' : 'device_specific',
      exclusiveCohortConfirmed: exclusive, attributionQuote:'The cohort used only this product.',attributionLocation:'Methods',
      endpoints: ['technical', 'clinical'].map(id => ({endpointId:id,attributable:complete || id === 'technical',pooledAcrossProducts:false,
        resultType:'proportion',value:'9/10',numerator:'9',denominator:'10',cohort:'Evaluated cohort',timepoint:'Index procedure',
        quote:'9/10 patients',location:'Results',attributionQuote:'Product-specific cohort',attributionLocation:'Methods'})) } };
}
test('all agreed DUE/Similar/Other combinations', () => {
  const D=(ok:boolean)=>device('DUE',ok), S=(ok:boolean)=>device('Similar Device',ok), O=(ok:boolean)=>device('Other',ok);
  const cases: [any[],number][] = [
    [[],0], [[D(true)],2], [[D(false)],0], [[S(true)],1], [[S(false)],0],
    [[S(true),S(true)],1], [[S(true),S(false)],0], [[O(true)],0],
    [[D(true),S(false)],2], [[D(false),S(true)],1], [[D(false),S(true),S(false)],0],
    [[D(true),O(false)],2], [[D(false),O(true)],0], [[S(true),O(false)],1],
    [[D(false),S(true),O(false)],1], [[D(true),D(false)],2],
  ];
  for (const [devices,score] of cases) assert.equal(evaluateDeviceCredit(devices).score,score,JSON.stringify(devices.map(d=>d.deviceRelationship)));
});
test('a fabricated/paraphrased quote fails verbatim verification against the source text', () => {
  const d = device('DUE', true, true);
  const genuinePaper = 'Methods: The cohort used only this product. Product-specific cohort results follow. Results: 9/10 patients achieved technical success.';
  assert.equal(isDeviceOutcomeExtractable(d), true, 'no paperText supplied: unchanged behavior');
  assert.equal(isDeviceOutcomeExtractable(d, genuinePaper), true, 'quotes genuinely appear in the source');
  const fabricated = device('DUE', true, true);
  fabricated.outcomeAttribution.endpoints[0].quote = '9/12 patients';
  assert.equal(isDeviceOutcomeExtractable(fabricated, genuinePaper), false, 'quote does not match the source text');
});
test('a multi-device group never bypasses evidence; source-backed exclusive cohort with all endpoints qualifies', () => {
  assert.equal(isDeviceOutcomeExtractable({}),false);
  assert.equal(isDeviceOutcomeExtractable({outcomeAttribution:{basis:'unclear'}}),false);
  assert.equal(isDeviceOutcomeExtractable(device('DUE',true,true)),true);
  const noProof=device('DUE',true,true); noProof.outcomeAttribution.exclusiveCohortConfirmed=false;
  assert.equal(isDeviceOutcomeExtractable(noProof),false);
  const missing=device('DUE',true); missing.outcomeAttribution.endpoints.pop();
  assert.equal(isDeviceOutcomeExtractable(missing),false);
  const countOnly=device('DUE',true); countOnly.outcomeAttribution.endpoints[0].denominator='';
  assert.equal(isDeviceOutcomeExtractable(countOnly),false);
});

test('a single-device research group bypasses the exhaustive per-endpoint check, but still requires a real, non-pooled attribution quote', () => {
  // Real paper: Mangiavillano et al. 2023 (Digestive Endoscopy) - 37 consecutive
  // patients all treated with the Hot-Spaxus EC-LAMS, no comparator device. Table 2
  // reports 10 distinct outcome rows (technical/clinical success, two bilirubin
  // timepoints, an overall AE rate plus 3 named sub-events, hospital stay, median
  // OS) - a single missing/malformed field on any one of those rows must not zero
  // out an otherwise clean, fully attributable single-arm study.
  const paperText = 'Methods: consecutively treated with the Hot-Spaxus EC-LAMS. ' +
    'Results: Technical success 37 (100.0). Clinical success 37 (100.0). Adverse event rate 4 (10.8).';
  const singleDevice = {
    deviceRelationship: { aiRecommended: 'DUE' }, __groupDeviceCount: 1,
    __clinicalEndpointInventory: [{ id: 'ae', name: 'ae', quote: 'reported', location: 'Table 2' }],
    outcomeAttribution: {
      extractable: true, basis: 'exclusive_device_cohort', exclusiveCohortConfirmed: true,
      attributionQuote: 'consecutively treated with the Hot-Spaxus EC-LAMS', attributionLocation: 'Methods',
      // Deliberately incomplete: a real per-endpoint row is missing a cohort/timepoint value,
      // which would fail the strict per-endpoint check below if it were not bypassed.
      endpoints: [{ endpointId: 'ae', attributable: true, pooledAcrossProducts: false, resultType: 'proportion',
        value: '4 (10.8)', numerator: '4', denominator: '37', quote: 'Adverse event rate 4 (10.8)', location: 'Table 2',
        cohort: 'Not reported', timepoint: 'Not reported', attributionQuote: '', attributionLocation: '' }],
    },
  };
  assert.equal(isDeviceOutcomeExtractable(singleDevice), true, 'no paperText: bypass credits a genuine single-device cohort');
  assert.equal(isDeviceOutcomeExtractable(singleDevice, paperText), true, 'attribution quote verifies against the source text');

  const fabricatedQuote = { ...singleDevice, outcomeAttribution: { ...singleDevice.outcomeAttribution, attributionQuote: 'consecutively treated with the Hot-Plumber LAMS' } };
  assert.equal(isDeviceOutcomeExtractable(fabricatedQuote, paperText), false, 'a fabricated attribution quote is rejected even under the bypass');

  const noQuote = { ...singleDevice, outcomeAttribution: { ...singleDevice.outcomeAttribution, attributionQuote: '' } };
  assert.equal(isDeviceOutcomeExtractable(noQuote), false, 'an empty attribution quote is rejected even under the bypass');

  const noEvidenceAtAll = { deviceRelationship: { aiRecommended: 'DUE' }, __groupDeviceCount: 1 };
  assert.equal(isDeviceOutcomeExtractable(noEvidenceAtAll), false, 'a device with no outcomeAttribution object at all is never bypassed to true');

  const aiSaysPooled = { ...singleDevice, __groupDeviceCount: 1, outcomeAttribution: { ...singleDevice.outcomeAttribution, basis: 'pooled', exclusiveCohortConfirmed: false } };
  assert.equal(isDeviceOutcomeExtractable(aiSaysPooled), false, "the AI's own pooled judgment overrides the single-device-count bypass");

  const aiSaysUnextractable = { ...singleDevice, outcomeAttribution: { ...singleDevice.outcomeAttribution, extractable: false } };
  assert.equal(isDeviceOutcomeExtractable(aiSaysUnextractable), false, "the AI's own extractable=false judgment overrides the bypass");

  const aiSaysUnclear = { ...singleDevice, outcomeAttribution: { ...singleDevice.outcomeAttribution, basis: 'unclear', exclusiveCohortConfirmed: false } };
  assert.equal(isDeviceOutcomeExtractable(aiSaysUnclear), false, 'basis=unclear overrides the bypass');
});
