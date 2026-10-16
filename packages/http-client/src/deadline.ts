import type { TimeoutError } from "./errors";

// The longest delay setTimeout keeps: Node fires a longer one, Infinity
// included, after 1 ms.
const MAX_TIMEOUT = 2_147_483_647;

/** Why a request ended before its outcome. */
export type EarlyEnd =
  | { readonly by: "timeout"; readonly error: TimeoutError }
  | { readonly by: "signal"; readonly reason: unknown };

/**
 * How a raced promise settled, or that the request ended first. A wrapper,
 * never the value itself: resolving a promise with the caller's reason would
 * read its `then`.
 */
export type Raced<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
  | { readonly status: "ended"; readonly end: EarlyEnd };

/**
 * Checks a timeout: an integer of milliseconds from 1 to 2147483647, or
 * `false` for none. The message holds no part of the URL.
 *
 * @throws {TypeError} For any other value.
 */
export function toTimeout(timeout: number | false): number | false {
  if (timeout === false) return false;
  if (Number.isInteger(timeout) && timeout >= 1 && timeout <= MAX_TIMEOUT) {
    return timeout;
  }
  throw new TypeError(
    "Expected a timeout in milliseconds, an integer from 1 to 2147483647, or false",
  );
}

/**
 * What can end a request before its outcome: the caller's signal, and the
 * client's timeout, which starts with the deadline. `end()` stops the
 * timeout; the caller's signal keeps reaching `signal`.
 */
export class Deadline {
  /**
   * What `fetchImpl` gets: it aborts when the caller's signal does, with its
   * reason, or when the timeout passes, with the `TimeoutError`. `undefined`
   * with neither.
   */
  readonly signal: AbortSignal | undefined;

  private readonly callerSignal: AbortSignal | undefined;
  private readonly timer: ReturnType<typeof setTimeout> | undefined;
  private timeoutError: TimeoutError | undefined;

  constructor(
    callerSignal: AbortSignal | undefined,
    timeout: number | false,
    createTimeoutError: (timeout: number) => TimeoutError,
  ) {
    this.callerSignal = callerSignal;

    // A caller's signal always goes through AbortSignal.any(), alone without
    // a timeout. It leaves no listener on the caller's signal, which may be
    // long-lived, and keeps following it while the body is read. And it
    // throws a TypeError for a value that is not an AbortSignal, before
    // anything is sent or the timer starts.
    if (timeout === false) {
      this.signal =
        callerSignal === undefined
          ? undefined
          : AbortSignal.any([callerSignal]);
      return;
    }

    const controller = new AbortController();
    this.signal =
      callerSignal === undefined
        ? controller.signal
        : AbortSignal.any([callerSignal, controller.signal]);
    this.timer = setTimeout(() => {
      this.timeoutError = createTimeoutError(timeout);
      controller.abort(this.timeoutError);
    }, timeout);
  }

  /** Stops the timeout. */
  end(): void {
    clearTimeout(this.timer);
  }

  /**
   * Settles as the promise that `start` returns does, unless the request
   * ends first: then at once, without waiting for that promise to honor the
   * signal. A value it resolves with later goes to `onLate`; a rejection, or
   * an error of `onLate`, is dropped.
   */
  race<T>(
    start: () => Promise<T>,
    onLate: (value: T) => void = ignore,
  ): Promise<Raced<T>> {
    let promise: Promise<T>;
    try {
      promise = Promise.resolve(start());
    } catch (reason) {
      return Promise.resolve({ status: "rejected", reason });
    }

    const signal = this.signal;

    return new Promise<Raced<T>>((resolve) => {
      let ended = false;
      const onAbort = (): void => {
        ended = true;
        resolve({ status: "ended", end: this.whyEnded() });
      };

      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener("abort", onAbort, { once: true });
      }

      promise.then(
        (value) => {
          signal?.removeEventListener("abort", onAbort);
          if (!ended) {
            resolve({ status: "fulfilled", value });
            return;
          }
          try {
            onLate(value);
          } catch {
            // Dropped: the request has settled already.
          }
        },
        (reason: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          if (!ended) resolve({ status: "rejected", reason });
        },
      );
    });
  }

  // The client's own state decides, never the reason of a combined signal:
  // with nothing listening to it, Node sets that reason lazily, to the first
  // aborted source in array order. The timer is checked first: once it has
  // fired, a caller's abort can only come after it.
  private whyEnded(): EarlyEnd {
    if (this.timeoutError !== undefined) {
      return { by: "timeout", error: this.timeoutError };
    }
    return { by: "signal", reason: this.callerSignal?.reason };
  }
}

function ignore(): void {
  // Nothing to do.
}
