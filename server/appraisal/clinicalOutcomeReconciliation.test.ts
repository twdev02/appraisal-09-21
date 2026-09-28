import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reconcileClinicalOutcomeEvidence,
  type MarkdownClinicalOutcomeEntry,
  type MarkdownClinicalOutcomeEvidence,
} from './markdownAppraisalEvidence';
import { runSelfValidation } from '../../src/utils/selfValidation';
import type { FullAppraisalData } from '../../src/types';

function md(entries: Array<Pick<MarkdownClinicalOutcomeEntry, 'key' | 'label' | 'value'>>): MarkdownClinicalOutcomeEvidence {
  const full = entries.map((entry) => ({
    ...entry,
    group: 'Overall',
    quote: `${entry.label} | ${entry.value}`,
    location: 'Table 2',
    source: 'confident_current_study_table' as const,
  }));
  return {
    entries: full,
    formattedSummary: full.map((entry) => `${entry.label}: ${entry.value}`).join('\n'),
    quote: full[0]?.quote || '',
    location: 'Table 2',
    confidence: 'High',
  };
}

test('same endpoint with irreconcilable values is a conflict, not supplementation', () => {
  const result = reconcileClinicalOutcomeEvidence(
    ['Technical success was achieved in 95% of patients.'],
    md([{ key: 'technical_success', label: 'Technical success', value: '44/50 (88.0%)' }]),
    true
  );
  assert.equal(result.status, 'conflict');
  assert.match(result.note, /Technical success/);
  assert.equal(result.selectedValue, 'Technical success: 44/50 (88.0%)');
});

test('ratio, percentage and rounding forms of the same value still validate', () => {
  for (const mdValue of ['48/50 (96.0%)', '96%', '95.8%', '48 (96)']) {
    const result = reconcileClinicalOutcomeEvidence(
      ['Technical success was 48/50 (96%).'],
      md([{ key: 'technical_success', label: 'Technical success', value: mdValue }]),
      true
    );
    assert.notEqual(result.status, 'conflict', mdValue);
  }
});

test('different endpoints remain supplementation', () => {
  const result = reconcileClinicalOutcomeEvidence(
    ['Technical success was 100%.'],
    md([{ key: 'stent_patency', label: 'Stent patency', value: '6.2 months' }]),
    true
  );
  assert.equal(result.status, 'supplemented');
});

test('one conflicting endpoint is flagged even when another endpoint agrees', () => {
  const result = reconcileClinicalOutcomeEvidence(
    ['Technical success was 100% (50/50); clinical success was 90%.'],
    md([
      { key: 'technical_success', label: 'Technical success', value: '50/50 (100%)' },
      { key: 'clinical_success', label: 'Clinical success', value: '40/50 (80.0%)' },
    ]),
    true
  );
  assert.equal(result.status, 'conflict');
  assert.match(result.note, /Clinical success/);
  assert.doesNotMatch(result.note, /Technical success/);
});

test('an endpoint mentioned without numbers in the PDF is not treated as a conflict', () => {
  const result = reconcileClinicalOutcomeEvidence(
    ['Technical success was achieved in all patients. Clinical success was 90%.'],
    md([
      { key: 'technical_success', label: 'Technical success', value: '48/50 (96.0%)' },
      { key: 'clinical_success', label: 'Clinical success', value: '90%' },
    ]),
    true
  );
  assert.equal(result.status, 'validated');
});

test('clinical outcome conflict reaches self-validation as Review', () => {
  const clinicalOutcome = reconcileClinicalOutcomeEvidence(
    ['Technical success was achieved in 95% of patients.'],
    md([{ key: 'technical_success', label: 'Technical success', value: '44/50 (88.0%)' }]),
    true
  );
  const data = {
    due: { productName: 'Test device', indications: ['Test indication'] },
    articleMetadata: { totalPatientCount: '50' },
    contribution: { clinicalSignificance: { id: 'clinical' } },
    evidenceValidation: { clinicalOutcome },
  } as unknown as FullAppraisalData;
  const result = runSelfValidation(data);
  assert.equal(result.overallStatus, 'review');
  assert.ok(result.issues.some((issue) => issue.targetId === 'step3.clinical' && issue.field === 'markdown.clinicalOutcome'));
});
