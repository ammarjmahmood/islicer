// Pairing with the bridge. The phone knows one thing: the pairing code (scanned
// or typed once). From it, it derives where the bridge leaves its current address,
// the key to read that address, and the access token. Must match server/remote.js.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha2';

const RENDEZVOUS = 'https://ntfy.sh';
const KEYS = { code: 'islicer_pair_code', url: 'islicer_bridge_url' };

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromBase64(text: string): Uint8Array {
  return ascii(atob(text));
}

export function normalizeCode(code: string): string {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Accepts "ABCD-EFGH-JKLM", any spacing, or a scanned islicer://pair?c=... link. */
export function codeFromInput(input: string): string | null {
  const match = /[?&]c=([A-Za-z0-9-]+)/.exec(input || '');
  const clean = normalizeCode(match ? match[1] : input);
  return clean.length === 12 ? clean : null;
}

export function formatCode(code: string): string {
  const clean = normalizeCode(code);
  return [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)].filter(Boolean).join('-');
}

function derive(code: string) {
  const clean = normalizeCode(code);
  const hash = (label: string) => sha256(ascii(`islicer:${label}:${clean}`));
  return {
    topic: `islicer-${hex(hash('topic')).slice(0, 32)}`,
    key: hash('key'),
    token: hex(hash('token')),
  };
}

export async function getPairCode(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.code);
}

export async function getAccessToken(): Promise<string | null> {
  const code = await getPairCode();
  return code ? derive(code).token : null;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getCachedBridgeUrl(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.url);
}

export async function unpair(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.code);
  await AsyncStorage.removeItem(KEYS.url);
}

/** Reads the bridge's current address from the drop box and decrypts it. */
export async function discoverBridgeUrl(code?: string): Promise<string> {
  const pairCode = code || (await getPairCode());
  if (!pairCode) throw new Error('Not paired yet. Scan the pairing code on your bridge computer.');
  const keys = derive(pairCode);
  let text = '';
  try {
    const response = await fetch(`${RENDEZVOUS}/${keys.topic}/json?poll=1&since=latest`, {
      signal: AbortSignal.timeout(12000),
    });
    text = await response.text();
  } catch {
    throw new Error('No internet connection, or the pairing service is unreachable.');
  }
  const messages = text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.event === 'message' && entry.message);
  const latest = messages[messages.length - 1];
  if (!latest) {
    throw new Error('Your bridge computer looks offline. Check that it is on and iSlicer Bridge is running.');
  }
  try {
    const raw = fromBase64(latest.message);
    const plain = gcm(keys.key, raw.slice(0, 12)).decrypt(raw.slice(12)); // ciphertext | tag
    const { url } = JSON.parse(String.fromCharCode(...plain));
    await AsyncStorage.setItem(KEYS.url, url);
    return url;
  } catch {
    throw new Error('That pairing code does not match this bridge. Scan the code again.');
  }
}

/** Saves the code and proves it works by reaching the bridge once. */
export async function pair(input: string): Promise<{ url: string; health: any }> {
  const code = codeFromInput(input);
  if (!code) throw new Error('That does not look like a pairing code. It has 12 letters and numbers.');
  const url = await discoverBridgeUrl(code);
  const response = await fetch(`${url}/health`, {
    headers: { Authorization: `Bearer ${derive(code).token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Found your bridge, but it refused the code. Scan it again.');
  await AsyncStorage.setItem(KEYS.code, code);
  return { url, health: await response.json() };
}
