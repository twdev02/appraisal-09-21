import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FullAppraisalData } from '../types';
import {
  DEFAULT_CONTRIBUTION_CRITERIA,
  DEFAULT_METHODOLOGICAL_CRITERIA,
  DEFAULT_RELEVANCE_ITEMS,
} from '../data/appraisalStandards';
import {
  applySourceConflictChoice,
  countUnresolvedSourceConflicts,
  unresolvedConflictExportWarning,
  type SourceConflictState,
} from './sourceConflicts';
import { runSelfValidation } from './selfValidation';

function conflict(pdfValue: string, markdownValue: string) {
  return {
    status: 'conflict' as const,
    pdfValue,
    markdownValue,
    selectedValue: markdownValue,
    evidenceQuote: `MD quote: ${markdownValue}`,
    evidenceLocation: 'Table 1',
    note: 'conflict',
  };
}

function state(overrides: Partial<SourceConflictState['evidenceValidation']> = {}): SourceConflictState {
  const methodological = {
    ...DEFAULT_METHODOLOGICAL_CRITERIA,
    patientsNumber: {
      ...DEFAULT_METHODOLOGICAL_CRITERIA.patientsNumber,
      aiRecommendedSelection: 'High(30-) (2)',
      aiRecommendedScore: 2,
      userFinalSelection: 'High(30-) (2)',
      userFinalScore: 2,
    },
  } as any;
  methodological.totalScoreUser = 2;
  return {
    articleMetadata: { title: '', journal: '', publicationYear: '', doi: '', authors: '', totalPatientCount: '50', followUpPeriod: '12 months' },
    relevance: DEFAULT_RELEVANCE_ITEMS,
    methodological,
    contribution: { ...DEFAULT_CONTRIBUTION_CRITERIA, totalScoreUser: 0 } as any,
    evidenceValidation: {
      markdownAvailable: true,
      trustedMarkdownTables: 1,
      uncertainMarkdownTables: 0,
      patientCount: conflict('25', '50'),
      gender: conflict('Male: n=10, Female: n=15', 'Male: n=30, Female: n=20'),
      followUp: conflict('6 months', '12 months'),
      ...overrides,
    } as any,
  };
}

function validate(s: SourceConflictState) {
  return runSelfValidation({
    due: { productName: 'Test device', indications: ['Test indication'] },
    ...s,
  } as unknown as FullAppraisalData);
}

test('choosing the PDF patient count rescored the criterion and the total', () => {
  const next = applySourceConflictChoice(state(), 'patientCount', 'pdf');
  assert.equal(next.articleMetadata.totalPatientCount, '25');
  assert.equal(next.methodological.patientsNumber.userFinalScore, 1);
  assert.equal(next.methodological.patientsNumber.userFinalSelection, 'Medium(11-29) (1)');
  assert.equal(next.evidenceValidation?.patientCount.resolution?.choice, 'pdf');
  assert.match(next.methodological.patientsNumber.comment, /PDF\/Gemini value selected over Markdown \(50\)/);
});

test('a resolved conflict leaves Review but stays visible so it can be changed', () => {
  const before = validate(state());
  assert.ok(before.issues.some((i) => i.field === 'markdown.patientCount' && i.status === 'review' && i.sourceConflict?.pdfValue === '25'));

  const after = validate(applySourceConflictChoice(state(), 'patientCount', 'markdown'));
  assert.ok(!after.issues.some((i) => i.field === 'markdown.patientCount' && i.status === 'review'));
  const resolved = after.issues.find((i) => i.field === 'markdown.patientCount');
  assert.equal(resolved?.status, 'resolved');
  assert.equal(resolved?.sourceConflict?.resolution?.choice, 'markdown');
});

test('overall status passes once every conflict has a reviewer choice', () => {
  let s = state();
  for (const field of ['patientCount', 'gender', 'followUp'] as const) {
    s = applySourceConflictChoice(s, field, 'markdown');
  }
  assert.ok(!validate(s).issues.some((i) => i.status === 'review' && i.field?.startsWith('markdown.')));
});

test('switching the choice replaces the earlier reviewer note instead of stacking', () => {
  const once = applySourceConflictChoice(state(), 'followUp', 'pdf');
  const twice = applySourceConflictChoice(once, 'followUp', 'markdown');
  assert.equal(twice.articleMetadata.followUpPeriod, '12 months');
  assert.equal(twice.relevance.itemJ_rangeOfTime.rangeOfTimeDetails?.durationOfFollowUp, '12 months');
  assert.equal((twice.contribution.followUp.comment.match(/Reviewer source selection/g) || []).length, 1);
  assert.match(twice.contribution.followUp.comment, /Markdown value selected/);
});

test('choosing the PDF gender distribution updates the displayed distribution', () => {
  const next = applySourceConflictChoice(state(), 'gender', 'pdf');
  assert.match(next.relevance.itemH_gender.comment, /^Male: n=10, Female: n=15/);
  assert.deepEqual([...next.relevance.itemH_gender.userSelectedOptions].sort(), ['Female', 'Male']);
});

test('non-conflict fields are left untouched', () => {
  const s = state({ patientCount: { ...conflict('50', '50'), status: 'validated' } as any });
  assert.equal(applySourceConflictChoice(s, 'patientCount', 'pdf'), s);
});

test('a reviewer-set patient score is kept when the source changes', () => {
  const s = state();
  s.methodological = {
    ...s.methodological,
    patientsNumber: { ...s.methodological.patientsNumber, userFinalSelection: 'Poor(1-10) (0)', userFinalScore: 0 },
  };
  const next = applySourceConflictChoice(s, 'patientCount', 'pdf');
  assert.equal(next.articleMetadata.totalPatientCount, '25');
  assert.equal(next.methodological.patientsNumber.userFinalScore, 0);
  assert.equal(next.methodological.patientsNumber.userFinalSelection, 'Poor(1-10) (0)');
  assert.equal(next.methodological.patientsNumber.aiRecommendedScore, 1);
  assert.match(next.methodological.patientsNumber.comment, /Reviewer-set score kept \(Poor\(1-10\) \(0\)\); recommended for this count: Medium\(11-29\) \(1\)/);
});

test('switching sources back and forth is not mistaken for a manual score', () => {
  const toPdf = applySourceConflictChoice(state(), 'patientCount', 'pdf');
  const back = applySourceConflictChoice(toPdf, 'patientCount', 'markdown');
  assert.equal(back.methodological.patientsNumber.userFinalScore, 2);
  assert.equal(back.methodological.patientsNumber.aiRecommendedScore, 2);
  assert.doesNotMatch(back.methodological.patientsNumber.comment, /Reviewer-set score kept/);
});

test('export warning lists only articles with unreviewed conflicts', () => {
  const s = state();
  assert.equal(countUnresolvedSourceConflicts(s.evidenceValidation), 3);
  const partly = applySourceConflictChoice(s, 'gender', 'pdf');
  assert.equal(countUnresolvedSourceConflicts(partly.evidenceValidation), 2);

  const warning = unresolvedConflictExportWarning([
    { name: 'a.pdf', count: 2 },
    { name: 'b.pdf', count: 0 },
  ]);
  assert.match(warning || '', /^2 PDF\/Markdown source conflict\(s\)/);
  assert.match(warning || '', /- a\.pdf: 2/);
  assert.doesNotMatch(warning || '', /b\.pdf/);
  assert.equal(unresolvedConflictExportWarning([{ name: 'b.pdf', count: 0 }]), null);
});
