// A small in-memory queue: at most `concurrency` jobs run at once and at most
// `maxWaiting` wait. Restarting the worker drops waiting jobs; the site marks
// scans that never report back as failed after ten minutes.

export class JobQueue {
  private running = 0;
  private waiting: (() => Promise<void>)[] = [];

  constructor(
    private concurrency: number,
    private maxWaiting: number,
  ) {}

  get stats() {
    return { running: this.running, waiting: this.waiting.length, concurrency: this.concurrency };
  }

  // Returns false when the queue is full.
  push(job: () => Promise<void>): boolean {
    if (this.waiting.length >= this.maxWaiting) return false;
    this.waiting.push(job);
    this.next();
    return true;
  }

  private next(): void {
    while (this.running < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.running++;
      job()
        .catch((e) => console.error("[queue] job failed", e))
        .finally(() => {
          this.running--;
          this.next();
        });
    }
  }
}
