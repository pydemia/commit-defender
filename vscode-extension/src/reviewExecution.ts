import type { ProgressCb } from "./ai/reviewer.js";
import type { PreparedExecution } from "./reviewBackend.js";

export interface ExecutionCallbacks<T> {
  preparing?(): void;
  started?(): void;
  progress?: ProgressCb;
  result(value: T, isCurrent: () => boolean): void | Promise<void>;
  error(error: unknown): void;
  finished?(): void;
}
interface Execution {
  key: string;
  backendId: string;
  controller: AbortController;
  promise: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  job: PreparedExecution<unknown>;
}

interface Preparation {
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

/** Owns one result lane. Repeated requests join it; superseded runs lose every UI callback. */
export class ReviewExecutionOwner<T> {
  private active?: Execution;
  private preparation?: Preparation;
  private readonly pending = new Set<Promise<unknown>>();
  get isRunning(): boolean {
    return !!this.active || !!this.preparation;
  }
  get isPreparing(): boolean {
    return !!this.preparation;
  }
  private track<P>(promise: Promise<P>): Promise<P> {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }
  private release(job: PreparedExecution<unknown>): void {
    this.track(Promise.resolve().then(() => job.dispose?.())).catch(() => {});
  }
  /** Shutdown waits for worker-owned child process and encrypted-store cleanup. */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
  /** Capture outside the UI event loop, then deduplicate by the actual source/context identity.
   * The current run keeps ownership until preparation yields a replacement execution. */
  prepare(
    factory: (signal: AbortSignal) => Promise<PreparedExecution<T>>,
    callbacks: ExecutionCallbacks<T>,
    timeoutMs = 0,
  ): Promise<void> {
    this.preparation?.controller.abort("superseded");
    if (this.preparation?.timer) clearTimeout(this.preparation.timer);
    const current: Preparation = { controller: new AbortController() };
    this.preparation = current;
    if (timeoutMs > 0)
      current.timer = setTimeout(
        () => current.controller.abort("timeout"),
        timeoutMs,
      );
    return this.track(
      (async () => {
        try {
          callbacks.preparing?.();
          const job = await factory(current.controller.signal);
          if (
            this.preparation !== current ||
            current.controller.signal.aborted
          ) {
            await job.dispose?.();
            return;
          }
          this.preparation = undefined;
          if (current.timer) clearTimeout(current.timer);
          await this.start(job, callbacks, timeoutMs);
        } catch (error) {
          if (this.preparation === current) callbacks.error(error);
        } finally {
          if (current.timer) clearTimeout(current.timer);
          if (this.preparation === current) {
            this.preparation = undefined;
            if (!this.active) callbacks.finished?.();
          }
        }
      })(),
    );
  }
  start(
    job: PreparedExecution<T>,
    callbacks: ExecutionCallbacks<T>,
    timeoutMs = 0,
  ): Promise<void> {
    this.preparation?.controller.abort("superseded");
    if (this.preparation?.timer) clearTimeout(this.preparation.timer);
    this.preparation = undefined;
    if (
      this.active?.key === job.key &&
      this.active.backendId === job.backendId &&
      !this.active.controller.signal.aborted
    ) {
      if (this.active.job !== job) this.release(job);
      return this.active.promise;
    }
    const previous = this.active;
    const current: Execution = {
      key: job.key,
      backendId: job.backendId,
      controller: new AbortController(),
      promise: Promise.resolve(),
      job,
    };
    this.active = current;
    if (previous?.timer) clearTimeout(previous.timer);
    previous?.controller.abort("superseded");
    const isCurrent = () => this.active === current;
    current.promise = this.track(
      Promise.resolve().then(async () => {
        if (!isCurrent()) {
          await job.dispose?.();
          return;
        }
        if (timeoutMs > 0)
          current.timer = setTimeout(
            () => current.controller.abort("timeout"),
            timeoutMs,
          );
        try {
          callbacks.started?.();
          const value = await job.run(
            current.controller.signal,
            (index, count, file) => {
              if (isCurrent()) callbacks.progress?.(index, count, file);
            },
          );
          if (current.timer) clearTimeout(current.timer);
          if (isCurrent()) await callbacks.result(value, isCurrent);
        } catch (error) {
          if (isCurrent()) callbacks.error(error);
        } finally {
          if (current.timer) clearTimeout(current.timer);
          try {
            await job.dispose?.();
          } finally {
            if (isCurrent()) {
              this.active = undefined;
              callbacks.finished?.();
            }
          }
        }
      }),
    );
    return current.promise;
  }
  cancel(): void {
    this.preparation?.controller.abort("user");
    this.active?.controller.abort("user");
  }
  /** Clear/dispose must prevent a late result from restoring findings the user removed. */
  invalidate(): void {
    this.preparation?.controller.abort("cleared");
    if (this.preparation?.timer) clearTimeout(this.preparation.timer);
    this.preparation = undefined;
    const current = this.active;
    this.active = undefined;
    if (current?.timer) clearTimeout(current.timer);
    current?.controller.abort("cleared");
  }
}
