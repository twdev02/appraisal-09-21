import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDeviceWithInventory } from './deviceMatching';

test('a shared brand-line prefix (HANAROSTENT) alone does not make two unrelated M.I. Tech products "Similar"', () => {
  const dueList = [{
    id: 'DUE-1',
    productName: 'Niti-S Hot Giobor Stent',
    indications: ['Pancreatic pseudocyst', 'Walled-off necrosis'],
    similarDevices: [
      'BPD HANAROSTENT Biliary stent (M.I. Tech)',
      'BPE HANAROSTENT Biliary stent (M.I. Tech)',
    ],
  }] as any;

  const result = classifyDeviceWithInventory(
    'HANAROSTENT Hot-Plumber with Z-EUS IT',
    'MI Tech Co., Seoul, Korea',
    dueList,
    undefined,
    'Fully covered with a silicone membrane',
    'Postoperative pancreatic fluid collections (POPFC) and peripancreatic fluid collections (PFC)'
  );

  assert.equal(result.type, 'Other Device');
});

test('an abbreviated distinctive model name (Hot-Spaxus, Nagi, Bumpy, Hot Giobor) locks in its DUE', () => {
  const dueList = [
    { id: 'DUE-1', productName: 'Niti-S SPAXUS\u2122 Stent', indications: ['Pancreatic pseudocyst', 'Walled-off necrosis'] },
    { id: 'DUE-2', productName: 'Niti-S Hot SPAXUS\u2122 Stent', indications: ['Gallbladder', 'Choledochoduodenostomy', 'Hepaticogastrostomy', 'EUS-HGS'] },
    { id: 'DUE-3', productName: 'Niti-S Nagi\u2122 Stent', indications: ['Pancreatic pseudocyst'] },
    { id: 'DUE-4', productName: 'Niti-S Hot Giobor Stent', indications: ['Pancreatic pseudocyst', 'Walled-off necrosis'] },
  ] as any;

  const cases: [string, string][] = [
    ['Hot-Spaxus', 'DUE-2'],
    ['Nagi', 'DUE-3'],
    ['Hot Giobor', 'DUE-4'],
  ];
  for (const [extracted, expectedId] of cases) {
    const result = classifyDeviceWithInventory(
      extracted,
      'Taewoong Medical, Goyang-si, Korea',
      dueList,
      undefined,
      'Fully covered with silicone',
      'Gallbladder drainage (GBD) and pancreatic pseudocysts'
    );
    assert.equal(result.type, 'DUE', `${extracted} should lock in a DUE`);
    assert.equal(result.matchedDueId, expectedId, `${extracted} should match ${expectedId}`);
  }
});
test('a genuine registered Similar Device alias still matches (regression guard)', () => {
  const dueList = [{
    id: 'DUE-1',
    productName: 'Niti-S Hot SPAXUS Stent',
    indications: ['Pancreatic pseudocyst'],
    similarDevices: [
      'Hot-AXIOS Stent (Boston Scientific)',
    ],
  }] as any;

  const result = classifyDeviceWithInventory(
    'Hot-AXIOS',
    'Boston Scientific Medical Co.',
    dueList,
    undefined,
    '',
    'Pancreatic fluid collection drainage'
  );

  assert.equal(result.type, 'Similar Device');
});
