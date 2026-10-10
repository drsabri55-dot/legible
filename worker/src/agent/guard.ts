// While the agent uses a page, nothing it does may change the customer's
// site: no form posts, logins or purchases, and no leaving the site.
// Submissions and off-site links are stopped inside the page first, so the
// page stays where it is; the network rules below are the backstop.
import type { Dialog, Page, Request, Route } from "playwright";

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

// Installed once per document; release() only switches it off.
function inPageGuard(home: string): string {
  return `(function (home) {
    if (window.__legibleGuard !== undefined) { window.__legibleGuard = true; return; }
    window.__legibleGuard = true;
    var same = function (h) { return h.replace(/^www\\./, '') === home.replace(/^www\\./, ''); };
    document.addEventListener('submit', function (e) {
      if (window.__legibleGuard) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    var submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () { if (!window.__legibleGuard) return submit.call(this); };
    document.addEventListener('click', function (e) {
      if (!window.__legibleGuard) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      try {
        var u = new URL(a.href, location.href);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && !same(u.hostname)) e.preventDefault();
        if (u.protocol !== 'http:' && u.protocol !== 'https:') e.preventDefault();
      } catch (x) { e.preventDefault(); }
    }, true);
  })(${JSON.stringify(home)})`;
}

export async function guardPage(page: Page): Promise<() => Promise<void>> {
  const home = new URL(page.url()).hostname;
  const handler = async (route: Route, request: Request) => {
    const method = request.method();
    if (method !== "GET" && method !== "HEAD") return route.abort("blockedbyclient");
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      let host = "";
      try {
        host = new URL(request.url()).hostname;
      } catch {
        return route.abort("blockedbyclient");
      }
      if (!sameSite(host, home)) return route.abort("blockedbyclient");
    }
    // Hand over to the context's own rules (private addresses, media).
    return route.fallback();
  };
  const onDialog = (d: Dialog) => void d.dismiss().catch(() => {});
  const onPopup = (p: Page) => void p.close().catch(() => {});
  const script = inPageGuard(home);
  // Also for any same-site page the agent lands on before it is brought back.
  await page.addInitScript(script);
  await page.evaluate(script);
  await page.route("**/*", handler);
  page.on("dialog", onDialog);
  page.on("popup", onPopup);
  return async () => {
    page.off("dialog", onDialog);
    page.off("popup", onPopup);
    await page.evaluate("window.__legibleGuard = false").catch(() => {});
    await page.unroute("**/*", handler).catch(() => {});
  };
}
