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

describe("the live poll and the frame", () => {
  it("returns the live state and serves the frame while the scan runs", async () => {
    const { GET } = await import("@/app/api/scans/[id]/live/route");
    const frameRoute = await import("@/app/api/scans/[id]/live/frame/route");
    const s = await data.createScan({ url: "https://poll.test/", host: "poll.test", ipHash: null, agent: "on" });
    await data.markScanProgress(s.id, 0, 6);
    await call(s.id, live({ frame: JPEG, kind: "page", note: "Opened the page." }));
    const res = await GET(new Request("http://site.test/"), { params: Promise.resolve({ id: s.id }) } as never);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.live.latest).toMatchObject({ step: 1, note: "Opened the page.", title: "Home" });
    expect(body.live.frame).toMatch(new RegExp(`^/api/scans/${s.id}/live/frame\\?v=\\d+$`));
    const img = await frameRoute.GET(new Request("http://site.test/"), { params: Promise.resolve({ id: s.id }) } as never);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await img.arrayBuffer()).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("answers 404 for an unknown scan and for a missing frame", async () => {
    const { GET } = await import("@/app/api/scans/[id]/live/route");
    const frameRoute = await import("@/app/api/scans/[id]/live/frame/route");
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await GET(new Request("http://site.test/"), { params: Promise.resolve({ id }) } as never)).status).toBe(404);
    expect((await frameRoute.GET(new Request("http://site.test/"), { params: Promise.resolve({ id: "not-a-uuid" }) } as never)).status).toBe(404);
  });
});

describe("frames live only while the scan runs (review fix)", () => {
  it("a frame that arrives after the scan ended is not stored", async () => {
    const s = await running("late-frame.test");
    await data.failScan(s.id, "unreachable");
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 0xff, 1]), "late");
    expect(await data.getLiveFrame(s.id)).toBeNull();
  });

  it("the frame route answers 404 once the scan has ended", async () => {
    const frameRoute = await import("@/app/api/scans/[id]/live/frame/route");
    const s = await running("ended-frame.test");
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 0xff, 1]), "kept");
    await data.failScan(s.id, "timeout"); // as the cron does, without the worker
    const res = await frameRoute.GET(new Request("http://site.test/"), { params: Promise.resolve({ id: s.id }) } as never);
    expect(res.status).toBe(404);
  });

  it("stale scans lose their frame when the cron fails them", async () => {
    const { db } = await import("@/lib/db");
    const s = await running("stale-frame.test");
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 0xff, 1]), "stale");
    await db()`update scans set created_at = now() - interval '3 hours' where id = ${s.id}`;
    await data.failStaleScans(90);
    expect(await data.getLiveFrame(s.id)).toBeNull();
  });

  it("the poll reads only the frame's time, not its bytes", async () => {
    const s = await running("stamp.test");
    expect(await data.getLiveFrameStamp(s.id)).toBeNull();
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 0xff, 1]), "x");
    const stamp = await data.getLiveFrameStamp(s.id);
    expect(stamp).toEqual({ updatedAt: expect.any(Date), note: "x" });
  });
});
