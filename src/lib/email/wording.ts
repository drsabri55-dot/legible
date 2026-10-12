// Sentences in emails that depend on the numbers, so a template never says
// "1 failures" or offers a report that would have nothing in it.

export function countOf(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The free-result email's closing line.
export function freeResultNextStep(failures: number, price: string): string {
  return failures === 0
    ? "No failures were found, so there is no report to buy. Automated testing cannot check everything, so a manual review is still worth doing."
    : `Your free result has a fix for every problem we found. The full report tests your whole site, up to 50 pages, and comes as a PDF you can share. It costs ${price}, once.`;
}

// The report email's pointer to where to begin. `must` counts kinds of issue
// in the must-fix group.
export function reportStartWith(must: number): string {
  return must === 0
    ? "None are in the must-fix group, so start with the should-fix issues."
    : `Must-fix issues: ${must}. Start with those.`;
}

// The last sentence of the whole-site email, by how the run ended.
export function fullReportEnding(status: "done" | "limit" | "stopped"): string {
  if (status === "limit") return "Testing stopped there because this report reached its testing limit.";
  if (status === "stopped") return "Testing stopped there because of a problem on our side. The pages we tested are all in the report.";
  return "That is every page we could reach, up to 50.";
}

// The purchase email's PDF line. While the whole site is being tested, the
// PDF waits for the email at the end.
export function purchasePdfNote(testingWholeSite: boolean): string {
  return testingWholeSite
    ? "We are now testing the rest of your site, up to 50 pages. We will email you again when it is finished, with the PDF. The report link already shows the pages tested so far."
    : "The PDF is attached. You can also download it from the report page, or share the report link with whoever looks after your site.";
}
