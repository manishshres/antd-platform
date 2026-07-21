import { ProviderAuthenticationError } from '../errors/aggregator.errors';

const DEFAULT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `fetch` with exponential backoff (2s, 4s, 8s, ...) on 429/5xx and network errors. */
export async function fetchWithRetry(
  provider: string,
  url: string,
  init: RequestInit,
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
    }
  }
  throw new ProviderAuthenticationError(
    provider,
    `network error calling ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Best-effort JSON parse: empty or malformed bodies resolve to `{}` instead of throwing. */
export async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
