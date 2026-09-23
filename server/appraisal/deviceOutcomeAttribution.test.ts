import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateDeviceCredit, isDeviceOutcomeExtractable } from './deviceOutcomeAttribution';
function device(type: string, complete: boolean, exclusive = false): any {
  return { deviceRelationship: { aiRecommended: type }, __groupDeviceCount: 1,
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
test('single record never bypasses evidence; source-backed exclusive cohort with all endpoints qualifies', () => {
  assert.equal(isDeviceOutcomeExtractable({__groupDeviceCount:1}),false);
  assert.equal(isDeviceOutcomeExtractable({__groupDeviceCount:1,outcomeAttribution:{basis:'unclear'}}),false);
  assert.equal(isDeviceOutcomeExtractable(device('DUE',true,true)),true);
  const noProof=device('DUE',true,true); noProof.outcomeAttribution.exclusiveCohortConfirmed=false;
  assert.equal(isDeviceOutcomeExtractable(noProof),false);
  const missing=device('DUE',true); missing.outcomeAttribution.endpoints.pop();
  assert.equal(isDeviceOutcomeExtractable(missing),false);
  const countOnly=device('DUE',true); countOnly.outcomeAttribution.endpoints[0].denominator='';
  assert.equal(isDeviceOutcomeExtractable(countOnly),false);
});
