/** Bind counts to an explicit intervention action, never to the nearest number.
 * Keep counts only: baseline N may belong to a different matching stratum.
 */
export function extractReinterventionNarrative(text: string, groups: Array<{ groupName: string }>) {
  const source = text.replace(/([a-z])-\s*\r?\n\s*([a-z])/gi, '$1$2').replace(/\s+/g, ' ');
  const key = (value: string) => value.toLowerCase().replace(/\([^)]*\)/g, ' ')
    .replace(/\b(group|cohort|arm)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const metrics: Array<{ groupIndex: number; value: string; evidenceQuote: string }> = [];
  const pattern = /(?:The remaining\s+)?(\d+)\s+patients?\s+in\s+the\s+([A-Za-z][A-Za-z0-9 -]{0,60}?)\s+group\s+and\s+(\d+)\s+(?:patients?\s+)?in\s+the\s+([A-Za-z][A-Za-z0-9 -]{0,60}?)\s+group\s+underwent\s+(endoscopic\s+)?re[- ]?interventions?(\s+in\s+our\s+cent(?:er|re))?/gi;
  for (const match of source.matchAll(pattern)) {
    const indices = [match[2], match[4]].map(name => groups.flatMap((group, index) => key(group.groupName) === key(name) ? [index] : []));
    if (indices.some(list => list.length !== 1) || indices[0][0] === indices[1][0]) continue;
    const scope = `${match[5] ? 'Endoscopic reintervention' : 'Reintervention'}${match[6] ? ' at study center' : ''}`;
    for (const [side, count] of [match[1], match[3]].entries()) {
      metrics.push({ groupIndex: indices[side][0], value: `${scope}: ${count} patients (reported intervention cohort; denominator not established)`, evidenceQuote: match[0] });
    }
  }
  // Multiple conflicting statements require review rather than choosing one.
  return metrics.filter(metric => !metrics.some(other => other.groupIndex === metric.groupIndex && other.value !== metric.value));
}
