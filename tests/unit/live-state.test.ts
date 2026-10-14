// What the scanning page polls: the page list, the latest step and the frame.
import { describe, expect, it } from "vitest";
import { liveState } from "@/lib/live";

const scan = (over = {}) => ({ id: "s", status: "running", pages_done: 1, pages_total: 6, error: null, agent: "on", ...over }) as never;
const e = (step: number, page: string, title: string, kind: "page" | "step" | "done", note: string) => ({ step, page, title, kind, note, at: new Date(0) });

describe("liveState", () => {
  const events = [
    e(1, "https://a.test/", "Home", "page", "Opened the page."),
    e(2, "https://a.test/", "Home", "done", "Finished this page."),
    e(3, "https://a.test/menu", "Menu", "page", "Opened the page."),
    e(4, "https://a.test/menu", "Menu", "step", "Pressed Tab. Focus moved to “Visit us”."),
  ];

  it("lists pages done, the page now and the pages waiting", () => {
    const s = liveState(scan(), events, new Date(5000));
    expect(s.live!.pages).toEqual([
      { n: 1, url: "https://a.test/", title: "Home", state: "done" },
      { n: 2, url: "https://a.test/menu", title: "Menu", state: "now" },
      { n: 3, url: null, title: null, state: "waiting" },
      { n: 4, url: null, title: null, state: "waiting" },
      { n: 5, url: null, title: null, state: "waiting" },
      { n: 6, url: null, title: null, state: "waiting" },
    ]);
    expect(s.live!.latest).toEqual({ step: 4, note: "Pressed Tab. Focus moved to “Visit us”.", title: "Menu" });
    expect(s.live!.steps[0].step).toBe(4); // newest first
    expect(s.live!.frame).toBe("/api/scans/s/live/frame?v=5000");
  });

  it("has no live part when the agent is off", () => {
    expect(liveState(scan({ agent: "off" }), events, null).live).toBeNull();
  });

  it("shows no frame until one arrives", () => {
    expect(liveState(scan(), [], null).live!.frame).toBeNull();
  });
});
