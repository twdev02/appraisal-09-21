import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResearchGroup } from '../../types';
import { formatGenderDistribution } from './appraisalInterpretation';
import { parseRangeOfTimeData } from './extraction';
import { extractCohortTableRows, mapCohortColumns } from './cohortTableEvidence';

const group = (groupName: string, n: number) => ({ id: groupName, groupName, groupPatientNumber: String(n), devices: [] } as ResearchGroup);
const groups = [group('Simultaneous group', 62), group('Sequential group', 73)];
const matchedComparison = 'Stent patency and OS No significant difference in stent patency was observed between the LSMS and control groups in either the unmatched cohort or the matched cohort (275 vs 268 days [P Z .706]; 267 vs 268 days [P Z .923]).';

test('shared time units preserve both matching strata without duplicating control values', () => {
  const lsmsGroups = [group('LSMS group', 30), group('Control group', 30)];
  for (const order of [lsmsGroups, [...lsmsGroups].reverse()]) {
    const { rangeOfTimeDetails: time } = parseRangeOfTimeData(`RESULTS\n${matchedComparison}\nDISCUSSION`, order, {
      durationOfApplicationOrUse: 'LSMS group: Median stent patency: 268 days; Control group: Median stent patency: 268 days',
    });
    assert.match(time.durationOfApplicationOrUse, /LSMS group \[Unmatched cohort\]: Reported stent patency: 275 days/);
    assert.match(time.durationOfApplicationOrUse, /LSMS group \[Matched cohort\]: Reported stent patency: 267 days/);
    assert.match(time.durationOfApplicationOrUse, /Control group \[Unmatched cohort\]: Reported stent patency: 268 days/);
    assert.match(time.durationOfApplicationOrUse, /Control group \[Matched cohort\]: Reported stent patency: 268 days/);
    assert.doesNotMatch(time.durationOfApplicationOrUse, /Median/);
  }
});

test('single comparative pair uses source arm order and accepts explicit units on both values', () => {
  const { rangeOfTimeDetails: time } = parseRangeOfTimeData(
    'RESULTS\nMedian stent patency in the control and LSMS groups was 268 days versus 267 days.\nDISCUSSION',
    [group('LSMS group', 30), group('Control group', 30)]);
  assert.match(time.durationOfApplicationOrUse, /LSMS group: Median stent patency: 267 days/);
  assert.match(time.durationOfApplicationOrUse, /Control group: Median stent patency: 268 days/);
});

test('full-paper evidence supplies median, direct follow-up, and distinct revision counts', () => {
  const paper = `RESULTS\nThe mean follow-up duration was 23.6 months (95% CI, 20.3-27.0 months).\n${matchedComparison}\nStent patency, median (95% CI), d\t275 (236.8-313.2)\t268 (172.5-363.5)\t.706\t267 (226.6-307.4)\t268 (159.8-376.2)\t.923\nThe remaining 15 patients in the LSMS group and 18 in the control group underwent endoscopic re-interventions in our center.\nDISCUSSION`;
  const { rangeOfTimeDetails: time } = parseRangeOfTimeData(paper, [group('LSMS group', 50), group('Control group', 90)]);
  assert.match(time.durationOfApplicationOrUse, /LSMS group \[Matched cohort\]: Median stent patency: 267 days/);
  assert.match(time.durationOfFollowUp, /23.6 months/);
  assert.equal(time.isFollowUpProxySurvival, false);
  assert.match(time.numberOfRepeatExposures, /LSMS group: 15 patients/);
  assert.match(time.numberOfRepeatExposures, /Control group: 18 patients/);
});
// Minimal transcription of source Tables 1/3. Includes an abstract first,
// wrapped headers, nested cohorts, a P-value column and a flattened footnote.
const source = `RESULTS
Stent patency was shorter in the SIS group compared with the simultaneous group (103 days vs 144 days).
CONCLUSION
Example abstract conclusion.
RESULTS
Table 1 Patient characteristics at baseline
Characteristics Sequential group,
overall
Sequential group, side
by side
Sequential group, stent
in stent
Simultaneous
group
P
value
Number of patients 73 35 38 62
Male 41 (56) 21 (51) 20 (49) 35 (56) 0.82
Survival time, days, median (IQR) 61 (39-78) 69 (43-128) 43 (27-65) 67 (56-105) 0.24
Table 3 Patient outcomes
Patient outcomes Sequential group,
overall
Sequential group, side
by side
Sequential group, stent
in stent
Simultaneous
group
P value
Technical success 56 (77) 20 (57) 36 (95) 58 (94) 0.001
Time to RBO, days, mean 112 1821 103 144
Reintervention after RBO 9 (100) 1 (100) 8 (100) 11 (85) 0.49
1n = 1. Data are presented as n (%).
DISCUSSION
Historical follow-up was 999 days.`;

test('parent and child columns map by full identity independent of UI order', () => {
  for (const order of [groups, [...groups].reverse()]) {
    const row = extractCohortTableRows(source, order).find(row => /^Survival/.test(row.label))!;
    assert.deepEqual(row.groupColumns, order[0].groupName.startsWith('Simultaneous') ? [3, 0] : [0, 3]);
    const { rangeOfTimeDetails: time } = parseRangeOfTimeData(source, order);
    assert.match(time.durationOfApplicationOrUse, /Simultaneous group: Mean TRBO \(stent patency\): 144 days/);
    assert.match(time.durationOfApplicationOrUse, /Sequential group \(overall; includes subgroups\): Mean TRBO \(stent patency\): 112 days/);
    assert.match(time.durationOfFollowUp, /Simultaneous group: .*67 days \(56-105\)/);
    assert.match(time.durationOfFollowUp, /Sequential group .*61 days \(39-78\)/);
    assert.match(time.numberOfRepeatExposures, /Simultaneous group: Reintervention after RBO: 11 \(85\)/);
    assert.equal(time.isFollowUpProxySurvival, true);
  }
});

test('gender totals are labelled as parent cohorts and derived counts are explicit', () => {
  const gender = formatGenderDistribution('', '', groups, source);
  assert.match(gender.formattedDistribution, /Simultaneous group — Male: n = 35, Female: n = 27 \[derived from group N=62\]/);
  assert.match(gender.formattedDistribution, /Sequential group \(overall; includes subgroups\) — Male: n = 41, Female: n = 32/);
});

test('subgroups are not merged into parent and merged footnotes are not numeric outcomes', () => {
  const order = [group('Sequential SIS group', 38), ...groups, group('Sequential SBS group', 35)];
  const { rangeOfTimeDetails: time } = parseRangeOfTimeData(source, order);
  assert.match(time.durationOfFollowUp, /Sequential SIS group: .*43 days/);
  assert.match(time.durationOfFollowUp, /Sequential SBS group: .*69 days/);
  assert.match(time.durationOfApplicationOrUse, /Sequential SBS group: Not reported \(possible merged footnote digit; review required\)/);
  assert.doesNotMatch(time.durationOfApplicationOrUse, /1821 days/);
});

test('explicit source table overrides a wrongly labelled AI extraction', () => {
  const { rangeOfTimeDetails: time } = parseRangeOfTimeData(source, groups, {
    durationOfApplicationOrUse: 'Simultaneous group: Median stent patency 103 days',
    durationOfFollowUp: 'Simultaneous group: Median survival 61 days',
    isFollowUpProxySurvival: true,
  });
  assert.match(time.durationOfApplicationOrUse, /144 days/);
  assert.match(time.durationOfFollowUp, /Simultaneous group: .*67 days/);
});

test('equal sample sizes and duplicated labels do not determine column identity', () => {
  const equal = [group('Treatment group', 20), group('Control group', 20)];
  assert.deepEqual(mapCohortColumns(['Control group', 'Treatment group'], equal), [1, 0]);
  assert.deepEqual(mapCohortColumns(['Treatment group', 'Treatment group'], equal), [undefined, undefined]);
  assert.deepEqual(mapCohortColumns(['Sequential overall', 'Sequential side by side', 'Sequential stent in stent'],
    [group('Sequential (SIS)', 38), group('Sequential (SBS)', 35)]), [2, 1]);
});

test('explicit follow-up outranks survival and is never marked as a proxy', () => {
  const withFollowUp = source.replace('Survival time,', 'Follow-up, days, median (IQR) 90 (80-100) 91 (80-100) 92 (80-100) 93 (80-100)\nSurvival time,');
  const { rangeOfTimeDetails: time } = parseRangeOfTimeData(withFollowUp, groups);
  assert.match(time.durationOfFollowUp, /Simultaneous group: Median follow-up: 93 days/);
  assert.equal(time.isFollowUpProxySurvival, false);
});

test('no source table is reconstructed from Discussion or ambiguous extra columns', () => {
  assert.deepEqual(extractCohortTableRows(`DISCUSSION\n${source}`, groups), []);
  const extra = source.replace('112 1821 103 144', '112 1821 103 144 222 333');
  assert.ok(!extractCohortTableRows(extra, groups).some(row => /Time to RBO/.test(row.label)));
});
