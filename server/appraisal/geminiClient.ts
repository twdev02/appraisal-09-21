import { GoogleGenAI } from '@google/genai';

// Shared Gemini client with lazy/conditional key handling.
// Multiple keys are supported so the app can keep using the SAME model when
// one Google AI project reaches its per-project daily quota. A backup key
// should come from a different Google AI project; another key from the same
// project normally shares the same quota.
const getGeminiApiKeys = (): string[] => {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
  ];

  return Array.from(
    new Set(
      candidates
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
};

const getGeminiErrorText = (error: any): string => {
  const pieces = [
    error?.message,
    error?.status,
    error?.code,
    error?.error?.message,
    error?.error?.status,
    error?.error?.code,
    error?.details ? JSON.stringify(error.details) : '',
  ]
    .filter(Boolean)
    .map(String);
  return pieces.join(' ');
};

export const isGeminiDailyQuotaError = (error: any): boolean => {
  const text = getGeminiErrorText(error);
  return (
    /GenerateRequestsPerDayPerProjectPerModel/i.test(text) ||
    /RequestsPerDayPerProjectPerModel/i.test(text) ||
    (/RESOURCE_EXHAUSTED/i.test(text) && /quota/i.test(text) && /per.?day|daily/i.test(text)) ||
    (/quota exceeded/i.test(text) && /per.?day|daily/i.test(text))
  );
};

const getSuggestedRetryDelayMs = (error: any): number | null => {
  const text = getGeminiErrorText(error);
  const match = text.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i)
    || text.match(/retry(?:\s+in|\s+after)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.ceil(seconds * 1000), 60_000);
};

export const getGeminiClient = (): GoogleGenAI | null => {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return null;

  const clients = keys.map(
    (key) =>
      new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          timeout: 120_000,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
  );

  // Keep the rest of the extraction pipeline unchanged: it can continue to
  // call ai.models.generateContent(...). Only quota failover is handled here.
  const pooledClient = {
    models: {
      generateContent: async (args: any) => {
        let lastQuotaError: any = null;

        for (let index = 0; index < clients.length; index++) {
          try {
            if (index > 0) {
              console.warn(
                `[Gemini API] Trying backup API project ${index + 1}/${clients.length} with the same model...`
              );
            }
            return await clients[index].models.generateContent(args);
          } catch (error: any) {
            if (!isGeminiDailyQuotaError(error)) {
              throw error;
            }

            lastQuotaError = error;
            console.warn(
              `[Gemini API] API project ${index + 1}/${clients.length} reached its daily quota.`
            );

            if (index < clients.length - 1) {
              continue;
            }
          }
        }

        const quotaError: any = new Error(
          clients.length > 1
            ? 'Gemini daily free-tier quota is exhausted for all configured API projects. Add another backup key from a different Google AI project or retry after the quota resets.'
            : 'Gemini daily free-tier quota is exhausted for gemini-3.8-flash. Add GEMINI_API_KEY_2 from a different Google AI project or retry after the quota resets.'
        );
        quotaError.status = 429;
        quotaError.code = 'GEMINI_DAILY_QUOTA_EXCEEDED';
        quotaError.retryable = false;
        quotaError.cause = lastQuotaError;
        throw quotaError;
      },
    },
  };

  return pooledClient as unknown as GoogleGenAI;
};


// Robust Gemini caller using gemini-3.8-flash. It retries transient provider
// failures, but it DOES NOT waste retries on the daily per-project quota.
export async function callGeminiWithRetry(
  genAi: GoogleGenAI,
  contents: any,
  config: any,
  maxRetries = 2
): Promise<string> {
  const model = 'gemini-3.8-flash';
  // Main extraction may retry transient provider failures. Focused repair calls
  // pass maxRetries=0 so one difficult paper cannot keep a single HTTP request
  // open through several full retry cycles and trigger a browser "Failed to fetch".
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Gemini API] Requesting extraction with model "${model}" (attempt ${attempt + 1}/${maxRetries + 1})...`);

      const response = await genAi.models.generateContent({
        model,
        contents,
        config,
      });

      const text = response.text;
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Received empty response from Gemini API.');
      }

      // Log safe preview of response body (first 200 characters)
      const safePreview = text.trim().slice(0, 200).replace(/\n/g, ' ');
      console.log(`[Gemini API] Response body preview: ${safePreview}...`);

      // Detect HTML or non-JSON response (e.g., error pages or gateways returning HTML)
      const trimmed = text.trim();
      if (
        trimmed.startsWith('<!DOCTYPE') ||
        trimmed.startsWith('<html') ||
        trimmed.startsWith('<HTML') ||
        trimmed.includes('<body') ||
        trimmed.includes('<HEAD>')
      ) {
        throw new Error(`Received HTML / non-JSON response from Gemini API (Preview: ${safePreview})`);
      }

      // Enforce structured JSON output with schema validation (JSON.parse)
      try {
        JSON.parse(text);
      } catch (jsonErr: any) {
        throw new Error(`Invalid JSON response from Gemini API: ${jsonErr.message} (Preview: ${safePreview})`);
      }

      console.log(`[Gemini API] Extraction succeeded with model "${model}"`);
      return text;
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      const status = err?.status || err?.code || err?.error?.code || '';
      console.log(`[Gemini API] Attempt ${attempt + 1} failed: ${errMsg}`);

      // Daily quota is not a short-lived transient error. Retrying the same
      // project after 1-2 seconds only burns time and produces the huge 429
      // message the UI was showing. Backup-project failover has already been
      // attempted inside getGeminiClient().
      if (isGeminiDailyQuotaError(err) || err?.code === 'GEMINI_DAILY_QUOTA_EXCEEDED') {
        break;
      }

      const isTransient =
        status === 503 ||
        status === 'UNAVAILABLE' ||
        status === 429 ||
        status === 'RESOURCE_EXHAUSTED' ||
        errMsg.includes('503') ||
        errMsg.includes('429') ||
        errMsg.includes('high demand') ||
        errMsg.includes('temporarily overloaded') ||
        errMsg.includes('overloaded') ||
        errMsg.includes('temporary') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('empty response') ||
        errMsg.includes('Invalid JSON') ||
        errMsg.includes('HTML');

      if (isTransient && attempt < maxRetries) {
        const providerDelay = getSuggestedRetryDelayMs(err);
        const fallbackDelay = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
        const delayMs = providerDelay ?? fallbackDelay;
        console.log(`[Gemini API] Transient failure encountered. Retrying in ${delayMs}ms (attempt ${attempt + 2}/${maxRetries + 1})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        break;
      }
    }
  }

  throw lastError || new Error('Gemini API extraction failed with gemini-3.8-flash after maximum retries.');
}

