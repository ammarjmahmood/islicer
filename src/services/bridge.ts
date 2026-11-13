import { getSliceServerUrl } from './storage';
import { authHeaders, discoverBridgeUrl, getCachedBridgeUrl, getPairCode } from './pairing';

async function healthy(url: string, headers: Record<string, string>, ms = 6000): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { headers, signal: AbortSignal.timeout(ms) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Where the bridge is right now.
 * Paired: try the last known address, and if it moved (the tunnel restarted),
 * look it up again. Otherwise fall back to a manually entered address.
 */
export async function resolveBridgeUrl(): Promise<string> {
  const headers = await authHeaders();

  if (await getPairCode()) {
    const cached = await getCachedBridgeUrl();
    if (cached && (await healthy(cached, headers))) return cached;
    const fresh = await discoverBridgeUrl();
    if (fresh === cached || (await healthy(fresh, headers, 12000))) return fresh;
    throw new Error('Your bridge computer is not answering. Check that it is on and online.');
  }

  const manual = (await getSliceServerUrl()).replace(/\/$/, '');
  if (manual) return manual;
  throw new Error('Not paired yet. Open Settings and scan the pairing code on your bridge computer.');
}

export async function bridgeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const bridgeUrl = await resolveBridgeUrl();
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...options,
    headers: { ...(options.headers as Record<string, string>), ...(await authHeaders()) },
  });
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(async () => ({ error: await response.text() }));
    throw new Error(body.error || `Bridge request failed: ${response.status}`);
  }
  return response.json();
}
