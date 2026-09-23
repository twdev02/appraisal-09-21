import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasExplicitProductName, elementaryAspectsAdequate } from './elementaryAspects';

test('requires an explicit product name in its evidence and rejects generic devices', () => {
  for (const name of ['', 'Not reported', 'Self-expandable metallic non-covered biliary stents', '8.5F pigtail drainage catheter']) {
    assert.equal(hasExplicitProductName({ deviceIdentificationReported: true, deviceIdentificationProductName: name, deviceIdentificationQuote: `We used ${name}.` }), false);
  }
  const item = { deviceIdentificationReported: true, deviceIdentificationProductName: 'Niti-S', deviceIdentificationQuote: 'A Niti-S stent was placed.' };
  assert.equal(hasExplicitProductName(item), true);
  assert.equal(hasExplicitProductName({ ...item, deviceIdentificationQuote: 'A metal stent was placed.' }), false);
  assert.equal(hasExplicitProductName({ ...item, deviceIdentificationReported: false }), false);
});

test('a bare model/registration number identifies the device, but a bare size number does not', () => {
  const item = { deviceIdentificationReported: true, deviceIdentificationProductName: '20183131815', deviceIdentificationQuote: "Based on the tumor's length, an appropriate stent (20183131815, M. I. Tech Co., Ltd., Pyeongtaek-si, Korea) was selected." };
  assert.equal(hasExplicitProductName(item), true);
  assert.equal(hasExplicitProductName({ deviceIdentificationReported: true, deviceIdentificationProductName: '22', deviceIdentificationQuote: 'A 22 mm stent was placed.' }), false);
});
test('only all three reported aspects qualify as adequate', () => {
  for (let mask = 0; mask < 8; mask++) {
    assert.equal(elementaryAspectsAdequate(Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)), mask === 7);
  }
});
