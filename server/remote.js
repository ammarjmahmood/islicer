// "From anywhere" access with no accounts, VPN or router setup.
//
//   1. The bridge makes one pairing code (shown as a QR code and as text).
//   2. It opens an outbound tunnel (Cloudflare quick tunnel) and gets a public https address.
//   3. It leaves that address, encrypted with a key derived from the pairing code,
//      at a public drop box (an ntfy topic also derived from the code).
//   4. The phone, knowing only the code, reads the drop box, decrypts the address
//      and talks to the bridge with an access token derived from the same code.
//
// The drop box only ever holds ciphertext. The tunnel address changes when the
// tunnel restarts; the phone just reads the drop box again.
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RENDEZVOUS = (process.env.ISLICER_RENDEZVOUS || 'https://ntfy.sh').replace(/\/$/, '');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

function newCode() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

function normalize(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Everything both sides derive from the pairing code. Must match src/services/pairing.ts. */
function derive(code) {
  const clean = normalize(code);
  const hash = (label) => crypto.createHash('sha256').update(`islicer:${label}:${clean}`).digest();
  return {
    topic: `islicer-${hash('topic').toString('hex').slice(0, 32)}`,
    key: hash('key'),
    token: hash('token').toString('hex'),
  };
}

function seal(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64'); // iv | ciphertext | tag
}

function unseal(key, blob) {
  const raw = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
}

function findCloudflared() {
  const candidates = [process.env.CLOUDFLARED_PATH, '/usr/local/bin/cloudflared', '/usr/bin/cloudflared', '/opt/homebrew/bin/cloudflared'];
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate;
  try {
    return execFileSync('sh', ['-c', 'command -v cloudflared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Keeps the bridge reachable and the drop box current.
 * `state` is readable at any time: { url, status, note, publishedAt }.
 */
function start({ port, code, log = console.log }) {
  const keys = derive(code);
  const state = { url: null, status: 'starting', note: null, publishedAt: null, rendezvous: RENDEZVOUS };
  let child = null;
  let stopped = false;

  async function publish() {
    if (!state.url) return;
    try {
      const response = await fetch(`${RENDEZVOUS}/${keys.topic}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'x-cache': 'yes' },
        body: seal(keys.key, JSON.stringify({ url: state.url, at: Date.now() })),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`drop box answered ${response.status}`);
      state.publishedAt = Date.now();
      state.status = 'online';
      state.note = null;
    } catch (err) {
      state.status = 'unpublished';
      state.note = `Could not publish the bridge address: ${err.message}`;
      log(state.note);
    }
  }

  function setUrl(url) {
    if (state.url === url) return;
    state.url = url;
    log(`Remote address ready: ${url}`);
    publish();
  }

  function openTunnel() {
    if (stopped) return;
    const exe = findCloudflared();
    if (!exe) {
      state.status = 'no-tunnel';
      state.note = 'cloudflared is not installed, so the phone can only reach this bridge on the home network. Run the installer again.';
      log(state.note);
      return;
    }
    state.status = 'connecting';
    // An existing cloudflared config on this machine (for a personal domain, say) would
    // hijack the quick tunnel's routing, so point it at an empty one.
    const blank = path.join(os.tmpdir(), 'islicer-cloudflared.yml');
    fs.writeFileSync(blank, '');
    child = spawn(exe, ['tunnel', '--config', blank, '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (chunk) => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
      if (match) setUrl(match[0]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => {
      child = null;
      state.url = null;
      if (stopped) return;
      state.status = 'reconnecting';
      setTimeout(openTunnel, 5000);
    });
  }

  if (process.env.ISLICER_PUBLIC_URL) {
    // You run your own tunnel or reverse proxy with a fixed address.
    setUrl(process.env.ISLICER_PUBLIC_URL.replace(/\/$/, ''));
  } else {
    openTunnel();
  }
  // The drop box forgets after about 12 hours, so say it again regularly.
  const timer = setInterval(publish, 3 * 60 * 60 * 1000);
  timer.unref();

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (child) child.kill();
  };
  process.on('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });

  return { state, keys, publish, stop };
}

module.exports = { newCode, normalize, derive, seal, unseal, start, RENDEZVOUS };
