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
test('a name split by a line-wrap artifact or minor reordering in the quote still counts', () => {
  const item = { deviceIdentificationReported: true, deviceIdentificationProductName: 'HANAROSTENT Hot-Plumber with Z-EUS IT', deviceIdentificationQuote: 'The novel LAMS, Hot-Plumber (HANAROSTENT\nHot-Plumber with Z-EUS IT; MI Tech Co.), is made of nitinol wire.' };
  assert.equal(hasExplicitProductName(item), true);
  const reordered = { ...item, deviceIdentificationQuote: 'MI Tech Co. supplies the HANAROSTENT Hot-Plumber together with its Z-EUS IT delivery system.' };
  assert.equal(hasExplicitProductName(reordered), true);
  const missingWord = { ...item, deviceIdentificationQuote: 'The novel LAMS, HANAROSTENT with Z-EUS IT, is made of nitinol wire.' };
  assert.equal(hasExplicitProductName(missingWord), false);
});
test('a quote that does not verify against the source text is rejected when paperText is supplied', () => {
  const item = { deviceIdentificationReported: true, deviceIdentificationProductName: 'Niti-S', deviceIdentificationQuote: 'A Niti-S stent was placed.' };
  const genuinePaper = 'Methods: A Niti-S stent was placed. Fluoroscopic guidance was used throughout.';
  assert.equal(hasExplicitProductName(item), true, 'no paperText: unchanged behavior');
  assert.equal(hasExplicitProductName(item, genuinePaper), true, 'quote genuinely appears in the source');
  const fabricated = { ...item, deviceIdentificationQuote: 'A Niti-S stent achieved 100% technical success.' };
  assert.equal(hasExplicitProductName(fabricated, genuinePaper), false, 'quote is not actually in the source text');
});
test('only all three reported aspects qualify as adequate', () => {
  for (let mask = 0; mask < 8; mask++) {
    assert.equal(elementaryAspectsAdequate(Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)), mask === 7);
  }
});
