// Live view events and frames, and chat messages with their per-scan limit.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  data = await import("@/lib/data");
});

const scan = (host: string) => data.createScan({ url: `https://${host}/`, host, ipHash: null });

describe("live events", () => {
  it("keeps the newest 200 events, oldest first", async () => {
    const s = await scan("events.test");
    for (let i = 1; i <= 205; i++) {
      await data.addLiveEvent(s.id, { step: i, page: "https://events.test/", title: null, kind: "step", note: `Step ${i}` });
    }
    const events = await data.listLiveEvents(s.id);
    expect(events).toHaveLength(200);
    expect(events[0].step).toBe(6);
    expect(events.at(-1)!.step).toBe(205);
  });

  it("keeps one frame per scan and deletes it", async () => {
    const s = await scan("frame.test");
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 1]), "first");
    await data.saveLiveFrame(s.id, Buffer.from([0xff, 0xd8, 2]), "second");
    const f = await data.getLiveFrame(s.id);
    expect([...f!.jpeg]).toEqual([0xff, 0xd8, 2]);
    await data.deleteLiveFrame(s.id);
    expect(await data.getLiveFrame(s.id)).toBeNull();
  });
});

describe("chat", () => {
  it("reserves questions up to the limit, then refuses", async () => {
    const s = await scan("limit.test");
    for (let i = 0; i < 5; i++) expect(await data.reserveQuestion(s.id, `q${i}`, 5)).not.toBeNull();
    expect(await data.reserveQuestion(s.id, "one more", 5)).toBeNull();
    expect(await data.countQuestions(s.id)).toBe(5);
  });

  it("parallel reservations never pass the limit", async () => {
    const s = await scan("parallel.test");
    const got = await Promise.all(Array.from({ length: 8 }, (_, i) => data.reserveQuestion(s.id, `q${i}`, 5)));
    expect(got.filter((id) => id !== null)).toHaveLength(5);
  });

  it("a released question gives its slot back and leaves no trace", async () => {
    const s = await scan("release.test");
    const id = await data.reserveQuestion(s.id, "will fail", 1);
    await data.releaseQuestion(id!);
    expect(await data.countQuestions(s.id)).toBe(0);
    expect(await data.listChat(s.id)).toEqual([]);
    expect(await data.reserveQuestion(s.id, "again", 1)).not.toBeNull();
  });

  it("lists the conversation in order", async () => {
    const s = await scan("history.test");
    await data.reserveQuestion(s.id, "What should I fix first?", 5);
    await data.saveAnswer(s.id, "Start with the labels.");
    const rows = await data.listChat(s.id);
    expect(rows.map((r) => [r.role, r.body])).toEqual([
      ["user", "What should I fix first?"],
      ["assistant", "Start with the labels."],
    ]);
  });
});
