import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReinterventionNarrative } from './reinterventionNarrative';
import { buildSafetyResult } from './buildSafetyResult';

const groups = [
  { id: 'l', groupName: 'LSMS group', groupPatientNumber: '50', devices: [] },
  { id: 'c', groupName: 'Control group', groupPatientNumber: '90', devices: [] },
];
const statement = 'The remaining 15 patients in the LSMS group\nand 18 in the control group underwent endoscopic re-\ninterventions in our center.';
const text = `RESULTS\nIn the LSMS group, 7 patients received PTBD elsewhere. In the control group there were 90 patients. ${statement}\nBilateral revision succeeded in 15 versus 6 patients.\nDISCUSSION`;

test('binds explicit action counts across PDF line wrapping and reversed group order', () => {
  for (const order of [groups, [...groups].reverse()]) {
    const metrics = extractReinterventionNarrative(text, order);
    assert.equal(metrics.length, 2);
    for (const metric of metrics) {
      assert.match(metric.value, order[metric.groupIndex].id === 'l' ? /15 patients/ : /18 patients/);
      assert.match(metric.value, /at study center/);
      assert.doesNotMatch(metric.value, /7 patients|90 patients|100%|33.3%/);
    }
  }
});

test('does not infer intervention counts from population, PTBD, or revision success', () => {
  assert.deepEqual(extractReinterventionNarrative(text.replace(statement, ''), groups), []);
});

test('rejects ambiguous cohort identities and conflicting statements', () => {
  assert.deepEqual(extractReinterventionNarrative(text, [...groups, { groupName: 'LSMS group' }]), []);
  assert.equal(extractReinterventionNarrative(text + statement.replace('15 patients', '16 patients'), groups).some(m => m.groupIndex === 0), false);
});

test('Step 4 replaces erroneous AI values and their stale quotes with explicit evidence', async () => {
  const result = await buildSafetyResult({
    paperText: text, markdownText: '', articleMetadata: { totalPatientCount: '140' }, researchGroups: groups,
    parsedAi: { safetyEventsExtract: { groupSummaries: groups.map(group => ({ groupId: group.id, reinterventions: '90/90 (100%)', evidenceQuote: 'stale quote' })) } },
    isMissingExtractedValue: (value: unknown) => !value || value === 'Not reported',
  } as any);
  const summaries = result.summary.groupSummaries;
  assert.match(summaries[0].reinterventions, /15 patients/);
  assert.match(summaries[1].reinterventions, /18 patients/);
  assert.match(summaries[1].evidenceQuote, /underwent endoscopic/);
  assert.doesNotMatch(JSON.stringify(summaries), /90\/90/);
});

test('Step 4 does not assign an unrelated summary by array position and lists all devices', async () => {
  const result = await buildSafetyResult({
    paperText: 'No outcome data supplied.', markdownText: '', articleMetadata: {},
    researchGroups: [{...groups[0], devices: [{deviceProductName: 'Device A'}, {deviceProductName: 'Device B'}]}],
    parsedAi: { safetyEventsExtract: { groupSummaries: [{ groupName: 'Different arm', reinterventions: '90/90 (100%)' }] } },
    isMissingExtractedValue: (value: unknown) => !value || value === 'Not reported',
  } as any);
  assert.equal(result.summary.groupSummaries[0].reinterventions, 'Not reported');
  assert.equal(result.summary.groupSummaries[0].deviceName, 'Device A / Device B');
});
