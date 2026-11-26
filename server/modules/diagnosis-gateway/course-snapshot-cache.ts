// Refresh ahead of the existing ten-minute validity limit without blocking warm reads.
export class CourseSnapshotCache<T> {
  private cached?: { value: T; loadedAt: number };
  private pending?: Promise<T>;
  private retryAt = 0;
  constructor(private readonly load: () => Promise<T>, private readonly now = Date.now) {}

  async read(): Promise<T> {
    const age = this.cached ? this.now() - this.cached.loadedAt : Infinity;
    if (this.cached && age < 600000) {
      if (age >= 300000 && this.now() >= this.retryAt) {
        void this.refresh().catch(() => { /* Keep the last complete snapshot within its validity limit. */ });
      }
      return this.cached.value;
    }
    return this.refresh();
  }

  private refresh(): Promise<T> {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(this.load).then(value => {
      this.cached = { value, loadedAt: this.now() };
      this.retryAt = 0;
      return value;
    }).catch((error: unknown) => {
      this.retryAt = this.now() + 30000;
      throw error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
