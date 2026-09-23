import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateDeviceCredit, isDeviceOutcomeExtractable } from './deviceOutcomeAttribution';
function device(type: string, complete: boolean, exclusive = false): any {
  return { deviceRelationship: { aiRecommended: type },
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
test('single record never bypasses evidence; source-backed exclusive cohort with all endpoints qualifies', () => {
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
