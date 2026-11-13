import { PrinterConfig, SliceJob } from '../types';
import { bridgeFetch } from './bridge';

export async function getBridgePrinters(): Promise<PrinterConfig[]> {
  const data = await bridgeFetch<{ printers: PrinterConfig[] }>('/printers');
  return data.printers;
}

export async function addBridgePrinter(fields: {
  name: string;
  model: PrinterConfig['model'];
  ip: string;
  serialNumber: string;
  accessCode: string;
}): Promise<PrinterConfig> {
  const data = await bridgeFetch<{ printer: PrinterConfig }>('/printers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return data.printer;
}

export async function removeBridgePrinter(id: string): Promise<void> {
  await bridgeFetch<{ ok: boolean }>(`/printers/${id}`, { method: 'DELETE' });
}

export async function testBridgePrinter(id: string): Promise<void> {
  await bridgeFetch<{ ok: boolean }>(`/printers/${id}/test`, { method: 'POST' });
}

export async function sendPrint(printer: PrinterConfig, job: SliceJob): Promise<void> {
  if (!job.serverJobId) {
    throw new Error('This slice was not created on the bridge. Re-slice the model, then send it.');
  }

  await bridgeFetch<{ ok: boolean }>('/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      printerId: printer.id,
      jobId: job.serverJobId,
    }),
  });
}
