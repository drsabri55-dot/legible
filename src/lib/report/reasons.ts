// Why a page was not scanned, in the customer's words. The worker stores a
// code, sometimes followed by ": detail" (for example "not_found: HTTP 404").

const REASONS: Record<string, string> = {
  robots: "the site's robots.txt asks tools like ours not to visit it",
  refused: "the site turned our scanner away",
  not_found: "the link is broken (page not found)",
  timeout: "the page took too long to load",
  not_html: "it is not a web page",
  blocked_target: "it points to an address we do not scan",
  unreachable: "it could not be loaded",
};

export function reasonCode(reason: string | null): string {
  return (reason || "").split(":")[0];
}

export function reasonText(reason: string | null): string {
  return REASONS[reasonCode(reason)] ?? "it could not be scanned";
}
