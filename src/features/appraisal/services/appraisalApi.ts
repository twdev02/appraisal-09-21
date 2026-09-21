import type { FullAppraisalData } from '../../../types';

export async function callAnalyzePdfApi(
  formData: FormData
): Promise<FullAppraisalData> {
    let response: Response;

    try {
      response = await fetch('/api/analyze-pdf', {
        method: 'POST',
        body: formData,
      });
    } catch (networkError: any) {
      // A browser-level TypeError here means no HTTP response was received at all
      // (server restart, preview tunnel interruption, or a long request being cut).
      // Distinguish it from a normal Gemini/API 4xx/5xx response so the user knows
      // that Retry is safe and the PDF itself is not necessarily invalid.
      let backendReachable = false;
      try {
        const health = await fetch('/api/health', { cache: 'no-store' });
        backendReachable = health.ok;
      } catch {
        backendReachable = false;
      }

      if (backendReachable) {
        throw new Error(
          'Analysis connection was interrupted before the result returned. The backend is available; click Retry to analyze this article again.'
        );
      }

      throw new Error(
        'Analysis backend connection was lost. Wait a few seconds for the preview server to reconnect, then click Retry.'
      );
    }

    const contentType = response.headers.get('content-type') || '';
    const isJsonResponse = contentType
      .toLowerCase()
      .includes('application/json');

    let responseBodyText = '';

    try {
      responseBodyText = await response.text();
    } catch {
      responseBodyText = '';
    }

    const normalizedResponse = responseBodyText.trim().toLowerCase();

    const isHtmlResponse =
      normalizedResponse.startsWith('<!doctype') ||
      normalizedResponse.startsWith('<html') ||
      responseBodyText.includes('<body') ||
      responseBodyText.includes('<!DOCTYPE');

    if (!response.ok || !isJsonResponse || isHtmlResponse) {
      if (
        isHtmlResponse ||
        normalizedResponse.startsWith('<!doctype')
      ) {
        throw new Error(
          `PDF analysis request took longer than expected or gateway timeout occurred. Please click Retry to analyze this article again.`
        );
      }

      if (isJsonResponse && responseBodyText) {
        let parsedError: any;

        try {
          parsedError = JSON.parse(responseBodyText);
        } catch {
          parsedError = null;
        }

        if (parsedError?.error) {
          throw new Error(parsedError.error);
        }
      }

      throw new Error(
        `Server error (HTTP ${response.status}): ` +
          `${responseBodyText.slice(0, 500) || response.statusText}`
      );
    }

    let responseJson: any;

    try {
      responseJson = JSON.parse(responseBodyText);
    } catch (jsonError: any) {
      if (
        normalizedResponse.startsWith('<!doctype') ||
        responseBodyText.includes('<html')
      ) {
        throw new Error(
          `PDF analysis request took longer than expected or gateway timeout occurred. Please click Retry to analyze this article again.`
        );
      }

      throw new Error(
        `Invalid JSON response from server ` +
          `(HTTP ${response.status}): ${jsonError.message}`
      );
    }

    if (
      !responseJson ||
      !responseJson.success ||
      !responseJson.data
    ) {
      throw new Error(
        responseJson?.error ||
          'Failed to extract clinical data from PDF.'
      );
    }

    return responseJson.data;
  }
