import type { FullAppraisalData } from '../../../types';

export class AnalysisRequestError extends Error {
  constructor(message: string, readonly transient = false, readonly backendUnavailable = false) { super(message); }
}

async function requestAnalysis(url: string, init: RequestInit = {}, timeoutMs = 60_000) {
  const phase = url === '/api/health' ? 'Backend readiness check' : init.method === 'POST' ? 'PDF upload / job submission' : 'Analysis result polling';
  const signal = AbortSignal.timeout(timeoutMs);
  const connectionError = (error: unknown) => {
    const timedOut = signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
    return new AnalysisRequestError(timedOut
      ? `${phase} timed out after ${timeoutMs / 1000} seconds. This does not confirm that the backend stopped. Check the preview server and retry.`
      : `${phase}: the connection was interrupted before a complete response arrived. Check the preview server connection and retry.`, true, true);
  };
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store', signal });
  } catch (error) {
    throw connectionError(error);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw connectionError(error);
  }
  let body: any;
  try { body = JSON.parse(text); } catch { /* Diagnose proxy/SPA responses below. */ }

  // Preserve pipeline errors, including provider quota/authentication errors.
  if (body?.error) throw new AnalysisRequestError(String(body.error));
  if ([502, 503, 504].includes(response.status)) {
    throw new AnalysisRequestError(`Analysis gateway is unavailable (HTTP ${response.status}). Please retry shortly.`, true, true);
  }
  if (!body || typeof body !== 'object') {
    throw new AnalysisRequestError(
      text.trim()
        ? `The analysis API returned an unexpected response (HTTP ${response.status}). Check the backend deployment and API routing; a static preview cannot analyze PDFs.`
        : `The analysis API returned an empty response (HTTP ${response.status}). Restart or update the backend; no analysis result was received.`,
      false, true
    );
  }
  if (!response.ok) throw new AnalysisRequestError(`Analysis request failed (HTTP ${response.status}).`);
  return { status: response.status, body };
}

export async function callAnalyzePdfApi(formData: FormData): Promise<FullAppraisalData> {
  // New Evaluation resets only browser state. A preview backend may still be
  // restarting; retry this read-only probe before sending another document.
  for (let attempt = 0; ; attempt++) {
    try {
      const health = await requestAnalysis('/api/health', {}, 10_000);
      if (health.body.status !== 'ok') {
        throw new AnalysisRequestError('The backend readiness check returned an unexpected response. Check the preview server.', false, true);
      }
      break;
    } catch (error) {
      if (!(error instanceof AnalysisRequestError) || !error.transient || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  // Carry the mode in the upload too: intermediaries may remove Prefer headers.
  formData.set('analysisMode', 'async');
  // Upload once; repeating a POST after losing its response could duplicate work.
  let { status, body } = await requestAnalysis('/api/analyze-pdf', {
    method: 'POST',
    headers: { Prefer: 'respond-async' },
    body: formData,
  });
  if (status === 202) {
    if (typeof body.jobId !== 'string' || !body.jobId) throw new Error('Analysis server did not return a job ID.');
    const url = `/api/analyze-pdf/jobs/${encodeURIComponent(body.jobId)}`;
    const deadline = Date.now() + 30 * 60_000;
    let failures = 0;
    while (status === 202) {
      if (Date.now() >= deadline) throw new Error('PDF analysis exceeded the 30-minute waiting limit. Please retry this article.');
      await new Promise(resolve => setTimeout(resolve, failures ? 5000 : 2000));
      try {
        ({ status, body } = await requestAnalysis(url));
        failures = 0;
      } catch (error) {
        // Recover short polling requests without repeating PDF/Gemini work.
        if (error instanceof AnalysisRequestError && error.transient && ++failures <= 5) continue;
        throw error;
      }
    }
  }
  if (!body.success || !body.data) throw new Error(body.error || 'Failed to extract clinical data from PDF.');
  return body.data;
}
