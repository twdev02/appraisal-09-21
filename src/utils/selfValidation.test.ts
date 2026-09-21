import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FullAppraisalData } from '../types';
import { runSelfValidation } from './selfValidation';
import { validateGenderEvidence, type MarkdownGenderEvidence } from '../../server/appraisal/markdownEvidence';

function fixture(overrides: Record<string, unknown> = {}): FullAppraisalData {
  return {
    due: { productName: 'Test device', indications: ['Test indication'] },
    articleMetadata: { totalPatientCount: '50' },
    methodological: { patientsNumber: { id: 'patients', aiRecommendedScore: 2 } },
    relevance: { itemH_gender: { id: 'gender', status: 'Reported', comment: 'Female: n=20, Male: n=30', evidence: { quote: 'Female: n=20, Male: n=30', location: 'Table 1' } } },
    ...overrides,
  } as unknown as FullAppraisalData;
}

test('PDF/MD disagreement remains Review even after selected count is consistent', () => {
  const result = runSelfValidation(fixture({ evidenceValidation: {
    patientCount: { status: 'conflict', pdfValue: '45', markdownValue: '50', selectedValue: '50' },
  } }));
  assert.equal(result.overallStatus, 'review');
  assert.ok(result.issues.some(issue => issue.targetId === 'step3.patients' && issue.field === 'markdown.patientCount'));
  assert.match(result.issues[0].message, /PDF: 45; Markdown: 50/);
});

test('absent, agreeing, or single-source MD does not create a source-conflict warning', () => {
  for (const status of ['validated', 'md_only', 'pdf_only', 'not_available']) {
    assert.equal(runSelfValidation(fixture({ evidenceValidation: { patientCount: { status } } })).overallStatus, 'pass');
  }
  assert.equal(runSelfValidation(fixture()).overallStatus, 'pass');
});

test('repeated female-first evidence does not conceal a gender total mismatch', () => {
  const result = runSelfValidation(fixture({ articleMetadata: { totalPatientCount: '55' } }));
  assert.ok(result.issues.some(issue => issue.field === 'gender' && /50.*55/.test(issue.message)));
});

test('gender source comparison handles female-first rows without confusing male counts', () => {
  const evidence: MarkdownGenderEvidence = {
    formattedDistribution: 'Male: n=30, Female: n=20',
    quote: 'Baseline table', location: 'Table 1', confidence: 'High', source: 'confident_baseline_table',
  };
  assert.equal(validateGenderEvidence('Female: n=20, Male: n=30', evidence).status, 'validated');
  evidence.formattedDistribution = 'Female: n=20, Male: n=35';
  assert.equal(validateGenderEvidence('Female: n=20, Male: n=30', evidence).status, 'conflict');
});
