// The worker route's live messages: stored when valid, refused when not,
// ignored once the scan has finished.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;
let POST: typeof import("@/app/api/worker/scans/[id]/route").POST;
const SECRET = "worker-secret-for-tests-0000";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.WORKER_SECRET = SECRET;
  data = await import("@/lib/data");
  ({ POST } = await import("@/app/api/worker/scans/[id]/route"));
});

const call = (id: string, body: unknown) =>
  POST(new Request(`http://site.test/api/worker/scans/${id}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) } as never);

async function running(host: string) {
  const s = await data.createScan({ url: `https://${host}/`, host, ipHash: null });
  await data.markScanProgress(s.id, 1, 6); // status becomes running
  return s;
}
const live = (over: Record<string, unknown> = {}) => ({ type: "live", step: 1, page: "https://a.test/", title: "Home", kind: "step", note: "Pressed Tab.", ...over });

describe("live messages", () => {
  it("stores the event and the frame", async () => {
    const s = await running("live-ok.test");
    expect((await call(s.id, live({ frame: JPEG }))).status).toBe(200);
    expect((await data.listLiveEvents(s.id)).map((e) => e.note)).toEqual(["Pressed Tab."]);
    expect(await data.getLiveFrame(s.id)).not.toBeNull();
  });

  it("rejects bad frames and bad notes", async () => {
    const s = await running("live-bad.test");
    expect((await call(s.id, live({ frame: Buffer.from("GIF89a").toString("base64") }))).status).toBe(400);
    expect((await call(s.id, live({ frame: Buffer.alloc(300_001, 0xff).toString("base64") }))).status).toBe(400);
    expect((await call(s.id, live({ note: "x".repeat(301) }))).status).toBe(400);
    expect((await call(s.id, live({ kind: "other" }))).status).toBe(400);
    expect(await data.listLiveEvents(s.id)).toEqual([]);
  });

  it("ignores events for a finished scan", async () => {
    const s = await running("live-done.test");
    await data.failScan(s.id, "unreachable");
    expect((await call(s.id, live())).status).toBe(200);
    expect(await data.listLiveEvents(s.id)).toEqual([]);
  });

  it("completing or failing a scan deletes its frame", async () => {
    const s = await running("live-clean.test");
    await call(s.id, live({ frame: JPEG }));
    await call(s.id, { type: "failed", error: "unreachable" });
    expect(await data.getLiveFrame(s.id)).toBeNull();
    expect(await data.listLiveEvents(s.id)).toHaveLength(1); // kept for the chat
  });
});
