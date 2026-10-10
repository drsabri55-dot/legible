// The worker sends screenshots before it completes a scan; anyone with a
// screenshot's id (only shown on the private result and report) can view it.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;
let workerRoute: typeof import("@/app/api/worker/scans/[id]/route");
let shotRoute: typeof import("@/app/api/shots/[id]/route");
const SECRET = "worker-secret-for-tests-0000";

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.WORKER_SECRET = SECRET;
  data = await import("@/lib/data");
  workerRoute = await import("@/app/api/worker/scans/[id]/route");
  shotRoute = await import("@/app/api/shots/[id]/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("screenshot routes", () => {
  it("accepts shots from the worker and serves them as JPEG", async () => {
    const scan = await data.createScan({ url: "https://r.example/", host: "r.example", ipHash: "ip-r" });
    const id = "55555555-5555-4555-8555-555555555555";
    const body = { type: "shots", shots: [{ id, data: Buffer.from([0xff, 0xd8, 0xff, 0x09]).toString("base64") }, { id: "not-a-uuid", data: "AAAA" }] };
    const res = await workerRoute.POST(
      new Request("http://x/api/worker/scans/" + scan.id, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
      ctx(scan.id),
    );
    expect(res.status).toBe(200);
    const img = await shotRoute.GET(new Request("http://x/api/shots/" + id), ctx(id));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("x-robots-tag")).toBe("noindex");
    expect(Buffer.from(await img.arrayBuffer()).equals(Buffer.from([0xff, 0xd8, 0xff, 0x09]))).toBe(true);
    expect((await shotRoute.GET(new Request("http://x/api/shots/not-a-uuid"), ctx("not-a-uuid"))).status).toBe(404);
  });

  it("refuses shots without the worker's secret", async () => {
    const scan = await data.createScan({ url: "https://s.example/", host: "s.example", ipHash: "ip-s" });
    const res = await workerRoute.POST(
      new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "shots", shots: [] }) }),
      ctx(scan.id),
    );
    expect(res.status).toBe(401);
  });
});
