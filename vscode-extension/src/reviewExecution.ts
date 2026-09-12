import type { ProgressCb } from "./ai/reviewer.js";
import type { PreparedExecution } from "./reviewBackend.js";

export interface ExecutionCallbacks<T> {
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
}

/** Owns one result lane. Repeated requests join it; superseded runs lose every UI callback. */
export class ReviewExecutionOwner<T> {
  private active?: Execution;
  get isRunning(): boolean {
    return !!this.active;
  }
  start(
    job: PreparedExecution<T>,
    callbacks: ExecutionCallbacks<T>,
    timeoutMs = 0,
  ): Promise<void> {
    if (
      this.active?.key === job.key &&
      this.active.backendId === job.backendId &&
      !this.active.controller.signal.aborted
    )
      return this.active.promise;
    const previous = this.active;
    const current: Execution = {
      key: job.key,
      backendId: job.backendId,
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    this.active = current;
    if (previous?.timer) clearTimeout(previous.timer);
    previous?.controller.abort("superseded");
    const isCurrent = () => this.active === current;
    current.promise = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
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
        if (isCurrent()) {
          this.active = undefined;
          callbacks.finished?.();
        }
      }
    });
    return current.promise;
  }
  cancel(): void {
    this.active?.controller.abort("user");
  }
  /** Clear/dispose must prevent a late result from restoring findings the user removed. */
  invalidate(): void {
    const current = this.active;
    this.active = undefined;
    if (current?.timer) clearTimeout(current.timer);
    current?.controller.abort("cleared");
  }
}
