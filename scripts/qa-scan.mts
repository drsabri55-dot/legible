// `npm run qa -- yourbusiness.com another.com`
// Scans real sites with the production scanner and report builder and prints
// what a customer would see: pages chosen (and why others were not), score,
// counts and every issue. Use it to check the product against new kinds of
// site. Optional: QA_OUT=folder saves each raw scan as JSON.
import { writeFileSync } from "node:fs";
import { closeBrowser, scanSite, ScanError } from "../worker/src/scan";
import { buildReport } from "../src/lib/report/model";
import { reasonText } from "../src/lib/report/reasons";
import { normaliseSite } from "../src/lib/url";

const out = process.env.QA_OUT;
for (const input of process.argv.slice(2)) {
  const site = normaliseSite(input);
  if (!site.ok) {
    console.log(`\n### ${input}\n  refused by the form: ${site.error}`);
    continue;
  }
  const started = Date.now();
  try {
    const raw = await scanSite(site.url);
    if (out) writeFileSync(`${out}/${site.host}.json`, JSON.stringify(raw));
    const r = buildReport(raw);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`\n### ${input} (${secs}s)`);
    console.log(`  ${r.site}${r.redirectedTo ? ` (redirects to ${r.redirectedTo})` : ""}: score ${r.score}, ${r.totalIssues} failures in ${r.issues.length} kinds, ${r.pagesScanned} pages`);
    for (const p of r.pages) {
      const note = p.status === "scanned" ? `${p.issues} failures` : `not scanned: ${reasonText(p.reason)}`;
      console.log(`    ${p.url}  (${note})`);
    }
    for (const i of r.issues) console.log(`  - ${i.impact}: ${i.title} (${i.instances} on ${i.pages.length} pages)`);
    if (r.needsReview.length) console.log(`  needs a human check: ${r.needsReview.map((n) => `${n.title} (${n.instances})`).join("; ")}`);
  } catch (e) {
    console.log(`\n### ${input}\n  scan failed: ${e instanceof ScanError ? e.code : (e as Error).message}`);
  }
}
await closeBrowser();
