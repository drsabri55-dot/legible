// The live view's step notes and the sender that keeps them from slowing a scan.
import { describe, expect, it } from "vitest";
import { liveSender, stepNote, type LiveEvent } from "../src/agent/live";

const link = { selector: "#book", tag: "a", role: "link", name: "Book a table", html: "<a id=book>" };

describe("stepNote", () => {
  it("says which key was pressed and where focus went", () => {
    expect(stepNote("press", { key: "Tab" }, link)).toBe("Pressed Tab. Focus moved to “Book a table”.");
  });
  it("says when nothing has focus", () => {
    expect(stepNote("press", { key: "Shift+Tab" }, null)).toBe("Pressed Shift+Tab. Nothing has focus.");
  });
  it("names the other actions in plain words", () => {
    expect(stepNote("type", { text: "Test name" }, link)).toBe("Typed “Test name” into “Book a table”.");
    expect(stepNote("zoom", { on: true }, null)).toBe("Viewed the page 320 pixels wide.");
    expect(stepNote("zoom", { on: false }, null)).toBe("Viewed the page at full width again.");
    expect(stepNote("spacing", { on: true }, null)).toBe("Turned on wider text spacing.");
    expect(stepNote("look", {}, null)).toBe("Looked at the page again.");
    expect(stepNote("claim", {}, null)).toBe("Measured a possible problem.");
    expect(stepNote("judge", {}, null)).toBe("Noted something for a second check.");
  });
  it("shortens long element names", () => {
    const long = { ...link, name: "x".repeat(200) };
    expect(stepNote("press", { key: "Tab" }, long).length).toBeLessThanOrEqual(140);
  });
});

const ev = (n: number, frame?: Buffer): LiveEvent => ({ step: n, page: "https://a.test/", title: "Home", kind: "step", note: `n${n}`, frame });

describe("liveSender", () => {
  it("sends in order and keeps a frame only every 3 seconds", async () => {
    const sent: Record<string, unknown>[] = [];
    let t = 0;
    const s = liveSender(async (m) => void sent.push(m as Record<string, unknown>), { now: () => t });
    s.push(ev(1, Buffer.from("a")));
    t = 1000;
    s.push(ev(2, Buffer.from("b")));
    t = 3500;
    s.push(ev(3, Buffer.from("c")));
    await s.idle();
    expect(sent.map((m) => m.step)).toEqual([1, 2, 3]);
    expect(sent.map((m) => typeof m.frame)).toEqual(["string", "undefined", "string"]);
    expect(sent[0].type).toBe("live");
  });

  it("drops events when the site is slow, and never throws", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: unknown[] = [];
    const s = liveSender(async (m) => { await gate; sent.push(m); }, { maxQueued: 2 });
    for (let i = 1; i <= 10; i++) s.push(ev(i));
    release();
    await s.idle();
    expect(sent.length).toBeLessThanOrEqual(3);
  });

  it("carries on after a failed send", async () => {
    const sent: unknown[] = [];
    let first = true;
    const s = liveSender(async (m) => {
      if (first) { first = false; throw new Error("down"); }
      sent.push(m);
    });
    s.push(ev(1));
    s.push(ev(2));
    await s.idle();
    expect(sent).toHaveLength(1);
  });
});
