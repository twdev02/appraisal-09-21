import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRangeOfTimeData, formatGenderDistribution } from '../nlpRules';
import { buildSafetyResult } from '../../../server/appraisal/buildSafetyResult';
const groups = ['Initial ERCP group', 'Subsequent ERCP group'].map((groupName, i) => ({id:String(i), groupName, groupPatientNumber:String([13,54][i]), devices:[]}));
const header = 'SBS stenting at the initial\nERCP group (n = 13)\nSBS stenting at the subsequent\nERCP group (n = 54)\nP-value';
const paper = `RESULTS
The median overall survival was 73 days in the initial ERCP group and 212 days in the subsequent ERCP group.
Table I. Patient characteristics of the two groups
${header}
Age, year, median (IQR)\t65 (60-68)\t74 (67-80)\t0.0094
Gender, male, n (%)\t6 (46.2)\t36 (66.7)\t0.17

DISCUSSION
Table II. Clinical outcomes of the two groups
${header}
Procedure time, min, median (IQR)\t50 (30-54)\t40 (27-52)\t0.31
Functional success, n (%)\t9 (69.2)\t45 (83.3)\t0.25
Adverse events, n (%)\t4 (30.8)\t8 (14.8)\t0.18
Cholangitis\t2 (15.4)\t3 (5.6)\t0.23
Pneumonia\t0\t1 (1.9)\t0.62
Heart failure\t0\t1 (1.9)\t0.62
RBO, n (%)\t3 (23.1)\t21 (38.9)\t0.29
Cumulative TRBO in effective drainage cases, days, median (95% CI)\tNR\t252 (73-431)\t0.80
Re-intervention, n (%)\t3 (23.1)\t21 (38.9)\t0.29
Technical success rates of the first re-intervention, n (%)\t3 (100)\t19 (90.5)\t0.58
Overall survival, days, median (95% CI)\t73 (52-94)\t212 (109-315)\t0.12
NR: not reached.
`;
test('Roman tables after Discussion preserve groups, missing median, and endpoints even with reversed UI order', () => {
  for (const order of [groups, [...groups].reverse()]) {
    const time = parseRangeOfTimeData(paper, order as any).rangeOfTimeDetails;
    assert.match(time.durationOfApplicationOrUse, /Initial ERCP group:.*Not reached/);
    assert.match(time.durationOfApplicationOrUse, /Subsequent ERCP group:.*252/);
    assert.match(time.durationOfFollowUp, /Initial ERCP group:.*73 days/);
    assert.match(time.durationOfFollowUp, /Subsequent ERCP group:.*212 days/);
    assert.match(time.numberOfRepeatExposures, /Initial ERCP group:.*3 \(23.1\)/);
    assert.match(time.numberOfRepeatExposures, /Subsequent ERCP group:.*21 \(38.9\)/);
    const gender = formatGenderDistribution('', '', order as any, paper);
    assert.match(gender.formattedDistribution, /Initial ERCP group — Male: n = 6, Female: n = 7/);
  }
});
test('Step 4 recovers omitted events and uses named reintervention columns', async () => {
  const result = await buildSafetyResult({paperText:paper, markdownText:'', parsedAi:{}, articleMetadata:{totalPatientCount:'67'}, researchGroups:[...groups].reverse(),
    isMissingExtractedValue:(v:unknown)=>!v || v==='Not reported'} as any);
  assert.equal(result.summary.groupSummaries[0].reinterventions.numerator, '21');
  assert.equal(result.summary.groupSummaries[0].reinterventions.denominator, '54');
  assert.ok(result.events.some((e:any)=> /pneumonia/i.test(e.eventName)));
  assert.ok(result.events.some((e:any)=> /heart failure/i.test(e.eventName)));
});
