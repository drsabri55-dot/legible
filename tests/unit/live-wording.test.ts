// The live view's fixed lines, as approved in the design doc.
import { describe, expect, it } from "vitest";
import { LIVE, frameAlt, pageStateText, progressLabel } from "@/components/live/wording";

describe("live view wording", () => {
  it("names the page being tested", () => {
    expect(progressLabel({ status: "running", pagesDone: 1, pagesTotal: 6, title: "Menu" })).toBe("Testing page 2 of 6: Menu");
    expect(progressLabel({ status: "running", pagesDone: 1, pagesTotal: 6, title: null })).toBe("Testing page 2 of 6");
    expect(progressLabel({ status: "queued", pagesDone: 0, pagesTotal: null })).toBe("Waiting for a free scanner…");
  });
  it("describes each page's state", () => {
    expect(pageStateText({ n: 1, url: "u", title: "Home", state: "done" })).toBe("Done");
    expect(pageStateText({ n: 2, url: "u", title: "Menu", state: "now" })).toBe("Testing now");
    expect(pageStateText({ n: 3, url: null, title: null, state: "waiting" })).toBe("Waiting");
  });
  it("describes the picture for screen readers", () => {
    expect(frameAlt("Menu", 14, "Pressed Tab. Focus moved to “Book a table”.")).toBe(
      "The Menu page, as the agent sees it. Step 14: Pressed Tab. Focus moved to “Book a table”.",
    );
  });
  it("uses the approved lines", () => {
    expect(LIVE.heading).toBe("Live view");
    expect(LIVE.intro).toBe("What our testing agent sees as it uses your site with a keyboard. The picture changes every few seconds.");
    expect([LIVE.pause, LIVE.resume]).toEqual(["Pause live view", "Resume live view"]);
  });
});
