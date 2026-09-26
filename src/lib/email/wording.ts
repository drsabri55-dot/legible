// Sentences in emails that depend on the numbers, so a template never says
// "1 failures" or offers a report that would have nothing in it.

export function countOf(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The free-result email's closing line.
export function freeResultNextStep(failures: number, price: string): string {
  return failures === 0
    ? "No failures were found, so there is no report to buy. Automated testing cannot check everything, so a manual review is still worth doing."
    : `The full report lists every failure, who it affects and the corrected code, sorted into must fix, should fix and nice to have. It costs ${price}, once.`;
}

// The report email's pointer to where to begin. `must` counts kinds of issue
// in the must-fix group.
export function reportStartWith(must: number): string {
  return must === 0
    ? "None are in the must-fix group, so start with the should-fix issues."
    : `Must-fix issues: ${must}. Start with those.`;
}
