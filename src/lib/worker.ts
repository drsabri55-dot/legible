import "server-only";
import { env } from "./env";

// The site's side of the scan worker. The worker runs the browser; the site
// keeps all data. The worker reports back to /api/worker/scans/[id].

export class WorkerBusyError extends Error {}
export class WorkerUnavailableError extends Error {}

export async function dispatchScan(scan: { id: string; url: string }): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${env.workerUrl()}/jobs/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.workerSecret()}` },
      body: JSON.stringify({
        scanId: scan.id,
        url: scan.url,
        callbackUrl: `${env.appUrl()}/api/worker/scans/${scan.id}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new WorkerUnavailableError(`Worker unreachable: ${(e as Error).message}`);
  }
  if (res.status === 503) throw new WorkerBusyError("Worker queue is full");
  if (!res.ok) throw new WorkerUnavailableError(`Worker answered ${res.status}: ${await res.text().catch(() => "")}`);
}

export async function renderPdf(path: string): Promise<Buffer> {
  const res = await fetch(`${env.workerUrl()}/pdf`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.workerSecret()}` },
    body: JSON.stringify({ url: `${env.appUrl()}${path}` }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(`PDF render failed (${res.status}): ${await res.text().catch(() => "")}`);
  return Buffer.from(await res.arrayBuffer());
}
