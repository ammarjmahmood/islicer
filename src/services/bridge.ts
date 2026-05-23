import { getSliceServerUrl } from './storage';

const LOCAL_URL = 'http://localhost:8005';

export async function resolveBridgeUrl(): Promise<string> {
  const configured = await getSliceServerUrl();
  const candidates = configured ? [configured] : [LOCAL_URL];

  for (const candidate of candidates) {
    const url = candidate.replace(/\/$/, '');
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return url;
    } catch {}
  }

  if (configured) return configured.replace(/\/$/, '');

  throw new Error('Bridge not configured. Open Settings and enter your Mac or Ubuntu bridge URL.');
}

export async function bridgeFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const bridgeUrl = await resolveBridgeUrl();
  const response = await fetch(`${bridgeUrl}${path}`, options);
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(async () => ({ error: await response.text() }));
    throw new Error(body.error || `Bridge request failed: ${response.status}`);
  }
  return response.json();
}
