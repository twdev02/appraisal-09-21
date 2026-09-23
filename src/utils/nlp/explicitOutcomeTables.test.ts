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
test("'X of Y (Z%)' proportions are not misread as durations, and the numerator is used for repeat-exposure counts", () => {
  const groups4 = ["Covered stent group", "Uncovered stent group"].map((groupName, i) => ({id: String(i), groupName, groupPatientNumber: String([161, 166][i]), devices: []}));
  const paper4 = `RESULTS
Stent patency at 6 months in stented patients was 117 of 161 (72.7%, covered) and 136 of 166 (81.9%, uncovered) (adjusted HR 1.48, 97.5% confidence interval (c.i.): 0.86-2.54).
Endoscopic re-intervention up to 6 months after randomization was attempted in 13 of 161 (8.1%) covered stent patients and 6 of 166 (3.6%) uncovered stent patients.
Overall survival was 40 of 161 (24.8%) for covered stent patients versus 42 of 166 (25.3%) for uncovered stent patients. QoL at 3 months was assessed in 216 patients.
`;
  const time = parseRangeOfTimeData(paper4, groups4 as any).rangeOfTimeDetails;
  assert.equal(time.durationOfApplicationOrUse, 'Not reported');
  assert.equal(time.durationOfFollowUp, 'Not reported');
  assert.match(time.numberOfRepeatExposures, /13\/161 \(8\.1%\)/);
  assert.doesNotMatch(time.numberOfRepeatExposures, /^161 \(8\.1%\)/);
});
test("prose-only follow-up sentence with 'in the X group and ... in the Y group' maps values to the correct arm", () => {
  const groups3 = ["SBTS group", "ES group"].map((groupName, i) => ({id: String(i), groupName, groupPatientNumber: String([29, 77][i]), devices: []}));
  const paper3 = `RESULTS
Oncologic outcomes
The mean follow-up time was 30.9 \u00b1 23.21 months in the SBTS group and 39.51 \u00b1 26.54 months in the ES group.
The median time to surgery in the SBTS group was 19 days.
`;
  const time = parseRangeOfTimeData(paper3, groups3 as any).rangeOfTimeDetails;
  assert.match(time.durationOfFollowUp, /SBTS group:.*30\.9 months/);
  assert.match(time.durationOfFollowUp, /ES group:.*39\.51 months/);
});
test("'patients were followed for N years' in Methods is recognized, and 'followed by' / nearby imaging intervals are not", () => {
  const groups5 = ["Experimental group", "Control group"].map((groupName, i) => ({id: String(i), groupName, groupPatientNumber: String([31, 38][i]), devices: []}));
  const paper5 = `MATERIALS AND METHODS
The control group underwent emergency laparotomy with one-stage resection and stoma formation, followed by a postoperative second-stage stoma closure every 3 to 6 months.
OS and DFS were calculated from the date of resection surgery until recurrence, death, or the end of the follow-up period for all cases receiving subsequent resections. For the 2-3-year follow-up duration, CT, abdominal ultrasound, chest X-ray, and blood tests were performed every 6 months. Each patient was followed for 3 years or until death.

RESULTS
The experimental group had significantly lower rates of complications than the control group.
`;
  const time = parseRangeOfTimeData(paper5, groups5 as any).rangeOfTimeDetails;
  assert.match(time.durationOfFollowUp, /followed for 3 years/);
  assert.doesNotMatch(time.durationOfFollowUp, /every 6 months/);
  assert.doesNotMatch(time.durationOfFollowUp, /stoma closure/);
});
test("single-arm 'Sex (male/female): X/Y' combined pair is not misread as X for both sexes", () => {
  const groups6 = [{id: '0', groupName: 'Clinical success cohort', groupPatientNumber: '81', devices: []}];
  const paper6 = `RESULTS
Table 1: Patient characteristics (n = 81).
Sex (male/female)\t39/42
Age (years), median (IQR)\t79 (61-85)
`;
  const gender = formatGenderDistribution('', '', groups6 as any, paper6);
  assert.equal(gender.formattedDistribution, 'Male: n = 39, Female: n = 42');
});
test("Sex (male) row after a linearized Discussion heading is still recognized", () => {
  const groups2 = ["SBTS group", "ES group"].map((groupName, i) => ({id: String(i), groupName, groupPatientNumber: String([29, 77][i]), devices: []}));
  const paper2 = `RESULTS
The ASA classification, tumor location, and SBTS were not found to be significantly associated with poorer OS.
Discussion
In the current study, 27% of all acute MCO patients underwent SBTS.
Table 1 Baseline characteristics of the patients
Characteristics\tSBTS group (n = 29)\tES group (n = 77)\tP-value
Sex (male)\t13 (44.8)\t46 (59.7)\t0.168
`;
  const gender = formatGenderDistribution('', '', groups2 as any, paper2);
  assert.match(gender.formattedDistribution, /SBTS group — Male: n = 13 \(44\.8%\), Female: n = 16/);
  assert.match(gender.formattedDistribution, /ES group — Male: n = 46 \(59\.7%\), Female: n = 31/);
});
test('Step 4 recovers omitted events and uses named reintervention columns', async () => {
  const result = await buildSafetyResult({paperText:paper, markdownText:'', parsedAi:{}, articleMetadata:{totalPatientCount:'67'}, researchGroups:[...groups].reverse(),
    isMissingExtractedValue:(v:unknown)=>!v || v==='Not reported'} as any);
  assert.equal(result.summary.groupSummaries[0].reinterventions.numerator, '21');
  assert.equal(result.summary.groupSummaries[0].reinterventions.denominator, '54');
  assert.ok(result.events.some((e:any)=> /pneumonia/i.test(e.eventName)));
  assert.ok(result.events.some((e:any)=> /heart failure/i.test(e.eventName)));
});
