import { Paths, File } from 'expo-file-system';
import { PrinterConfig } from '../types';

/**
 * Bambu Lab P1S printer communication.
 *
 * The P1S uses MQTT over TLS for control and FTP for file transfer.
 * Since React Native doesn't have native MQTT/FTP, we communicate
 * through the printer's local network endpoints or Bambu Cloud API.
 */

const BAMBU_CLOUD_API = 'https://api.bambulab.com/v1';

interface BambuAuthToken {
  token: string;
  expiresAt: number;
}

let authToken: BambuAuthToken | null = null;

export async function loginBambuCloud(
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${BAMBU_CLOUD_API}/user-service/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: email, password }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Login failed: ${err}`);
  }

  const data = await response.json();
  authToken = {
    token: data.accessToken,
    expiresAt: Date.now() + 3600000,
  };
  return data.accessToken;
}

export async function getCloudPrinters(): Promise<any[]> {
  if (!authToken) throw new Error('Not logged in to Bambu Cloud');

  const response = await fetch(`${BAMBU_CLOUD_API}/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${authToken.token}` },
  });

  if (!response.ok) throw new Error('Failed to fetch printers');

  const data = await response.json();
  return data.devices || [];
}

export async function sendPrintDirect(
  printer: PrinterConfig,
  gcodeUri: string,
  filename: string,
): Promise<void> {
  // Send G-code to Bambu P1S over local network
  const formData = new FormData();
  formData.append('file', {
    uri: gcodeUri,
    name: filename.replace(/\.[^.]+$/, '.gcode'),
    type: 'application/octet-stream',
  } as any);

  const response = await fetch(`https://${printer.ip}/upload`, {
    method: 'POST',
    headers: {
      'X-Access-Code': printer.accessCode,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
}

/**
 * Send G-code to a printer via Bambu Cloud API.
 * Works from anywhere — TTC, work, cellular data.
 * Requires prior loginBambuCloud() call.
 */
export async function sendPrintCloud(
  printer: PrinterConfig,
  gcodeUri: string,
  filename: string,
): Promise<void> {
  if (!authToken) throw new Error('Not logged in to Bambu Cloud. Go to Settings to connect your account.');

  // Step 1: Upload G-code to Bambu Cloud
  const formData = new FormData();
  formData.append('file', {
    uri: gcodeUri,
    name: filename.replace(/\.[^.]+$/, '.gcode'),
    type: 'application/octet-stream',
  } as any);

  const uploadRes = await fetch(`${BAMBU_CLOUD_API}/iot-service/api/user/task`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken.token}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Cloud upload failed: ${err}`);
  }

  const uploadData = await uploadRes.json();
  const taskId = uploadData.id || uploadData.taskId;

  // Step 2: Send print command to printer via cloud
  const printRes = await fetch(`${BAMBU_CLOUD_API}/iot-service/api/user/device/${printer.serialNumber}/print`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId,
      deviceId: printer.serialNumber,
    }),
  });

  if (!printRes.ok) {
    const err = await printRes.text();
    throw new Error(`Print command failed: ${err}`);
  }
}

/**
 * Smart send: tries cloud first (works anywhere), falls back to local.
 */
export async function sendPrint(
  printer: PrinterConfig,
  gcodeUri: string,
  filename: string,
): Promise<void> {
  // If we have a cloud token, use cloud (works from anywhere)
  if (authToken) {
    try {
      await sendPrintCloud(printer, gcodeUri, filename);
      return;
    } catch (cloudErr) {
      console.warn('Cloud print failed, trying local:', cloudErr);
    }
  }

  // Fall back to local network
  if (printer.ip) {
    await sendPrintDirect(printer, gcodeUri, filename);
    return;
  }

  throw new Error('Cannot reach printer. Log in to Bambu Cloud or connect to the same network.');
}

export async function getPrinterStatus(printer: PrinterConfig): Promise<{
  online: boolean;
  printing: boolean;
  progress: number;
  temperature: { nozzle: number; bed: number };
} | null> {
  try {
    const response = await fetch(`https://${printer.ip}/status`, {
      headers: { 'X-Access-Code': printer.accessCode },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
