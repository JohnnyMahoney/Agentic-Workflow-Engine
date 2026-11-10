// One local queue for browser members and request_human. SDK custom tools may
// otherwise run concurrently with browser-toolset members in the same response.
export class DiscoveryQueue {
  private tail: Promise<unknown> = Promise.resolve();
  generation = 0;
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}

export class ActiveDiscoveryBudget {
  private remaining: number;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly controller: AbortController, milliseconds = 180_000) {
    this.remaining = milliseconds;
    this.resume();
  }
  pause(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining -= Date.now() - this.started;
  }
  resume(): void {
    if (this.timer || this.controller.signal.aborted) return;
    if (this.remaining <= 0) { this.controller.abort(); return; }
    this.started = Date.now();
    this.timer = setTimeout(() => this.controller.abort(), this.remaining);
  }
  close(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
