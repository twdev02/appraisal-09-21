const eligible = new Set(['randomized_trial', 'nonrandomized_interventional', 'cohort', 'case_control', 'cross_sectional']);
const excluded = new Set(['case_report', 'case_series', 'review', 'editorial_opinion', 'nonclinical']);
const meaningful = (value: unknown) => Boolean(String(value || '').trim()) && !/^(not reported|unknown|unclear|n\/?a)$/i.test(String(value).trim());

export function evaluateDataSourceType(extract: any, studyDesign: unknown) {
  const category = String(extract?.dataSourceStudyDesign || 'unclear');
  const quote = String(extract?.dataSourceQuote || '').trim();
  const location = String(extract?.dataSourceLocation || '').trim();
  const rationale = String(extract?.dataSourceRationale || '').trim();
  // Do not promote an explicitly excluded design based on an inconsistent AI category.
  const contradictory = /\bcase[- ](?:report|series)\b|\b(?:systematic|scoping|narrative) review\b|\bmeta-analysis\b|\bin vitro\b|\banimal study\b/i.test(String(studyDesign || ''));
  const documented = meaningful(quote) && meaningful(location) && meaningful(rationale);
  const yes = eligible.has(category) && documented && !contradictory;
  return {
    selection: yes ? 'Yes (2)' : 'No (1)',
    score: yes ? 2 : 1,
    quote: meaningful(quote) ? quote : 'Not reported',
    location: meaningful(location) ? location : 'Not reported',
    status: documented && (eligible.has(category) || excluded.has(category)) ? 'Reported' : 'Not reported',
    comment: yes
      ? `Eligible clinical study design (${category}). ${rationale}`
      : contradictory || excluded.has(category)
        ? `Study design does not qualify under this application's data-source rule. ${rationale}`.trim()
        : 'No: insufficient evidence to establish an eligible clinical study design.',
  };
}
