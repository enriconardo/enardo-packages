import { expect, expectTypeOf, vi } from "vitest";
import type { Mock } from "vitest";
import type { FetchImpl, FetchInit } from "~/index";

// The helpers of the HttpClient tests, shared by http-client.test.ts and
// http-client.node.test.ts. A page loads this module: it imports nothing
// from node:*.

export const BASE_URL = "https://api.example.com";

// A marker in the query string and in the fragment, which must not come out
// of an error, and the URL reduced to its origin and path. No credentials:
// the client rejects a URL with credentials before any request, so these
// tests cannot pass one through the client.
// errors/http-response-error.test.ts covers the redaction of credentials in
// `details.url`.
export const MARKED_URL =
  "https://api.example.com/v1/users?token=q-secret#frag-secret";
export const REDUCED_URL = "https://api.example.com/v1/users";

export function createMockFetch(
  status: number,
  body?: unknown,
  statusText = "",
): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(body !== undefined ? JSON.stringify(body) : null, {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Resolves with `response` itself, so a test can inspect that very object. */
export function createResponseFetch(response: Response): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

export function createRejectingFetch(reason: unknown): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockRejectedValue(reason);
}

/** Throws like the browser's fetch when not called on globalThis. */
export function createBindingSensitiveFetch(
  response: Response,
): Mock<(this: typeof globalThis) => Promise<Response>> {
  return vi.fn(function (this: typeof globalThis) {
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }

    return Promise.resolve(response);
  });
}

export const encoder: TextEncoder = new TextEncoder();

export function createReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** A body stream that errors as soon as it is read. */
export function createErroringStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("connection reset"));
    },
  });
}

export async function* createAsyncChunks(
  ...parts: string[]
): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield encoder.encode(part);
  }
}

/** What `promise` rejects with. Fails when `promise` resolves. */
export async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the call to reject, but it resolved");
    },
    (error: unknown) => error,
  );
}

/**
 * What `promise` rejects with, checked to be an instance of `errorClass`.
 * Fails when `promise` resolves.
 */
export async function rejectionOf<E>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => E,
): Promise<E> {
  const reason = await reasonOf(promise);
  expect(reason).toBeInstanceOf(errorClass);
  return reason as E;
}

/**
 * What `run` throws, checked to be an instance of `errorClass`. Fails when
 * `run` returns.
 */
export function thrownBy<E>(
  run: () => unknown,
  errorClass: abstract new (...args: never[]) => E,
): E {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(errorClass);
    return error as E;
  }
  throw new Error("Expected the call to throw, but it returned");
}

/** The `href` of the URL of the one call to `fetchImpl`. */
export function hrefSentTo(fetchImpl: Mock<typeof fetch>): string {
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const url = fetchImpl.mock.calls[0]?.[0];
  expect(url).toBeInstanceOf(URL);
  return (url as URL).href;
}

/** Hands `run` to the compiler without running it. */
export const compileOnly = (run: () => unknown): void => {
  expectTypeOf(run).toBeFunction();
};

// The request of the timeout and signal cases: against BASE_URL, it is
// MARKED_URL.
export const MARKED_PATH = "/v1/users?token=q-secret#frag-secret";

/** A fetchImpl whose promise never settles, and that ignores init.signal. */
export function createPendingFetch(): Mock<FetchImpl> {
  return vi.fn<FetchImpl>(() => new Promise<Response>(() => undefined));
}

/**
 * A body stream that sends one chunk and never closes. `cancel`, when given,
 * is its source's cancel callback: a cancel of the stream calls it with its
 * reason.
 */
export function createEndlessStream(
  cancel?: (reason: unknown) => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("partial"));
    },
    cancel,
  });
}

/** What `createAnswerWithReader` gives: the answer, and its reader's `read`. */
export interface AnswerWithReader {
  answer: {
    status: number;
    headers: Headers;
    body: {
      getReader: () => {
        read: Mock<() => Promise<never>>;
        cancel: () => unknown;
      };
    };
  };
  read: Mock<() => Promise<never>>;
}

/**
 * A 500 that is not a Response, whose body is no stream: its `getReader()`
 * gives a reader whose `read()` never settles, and whose `cancel` is `cancel`.
 */
export function createAnswerWithReader(
  cancel: () => unknown,
): AnswerWithReader {
  const read = vi.fn(() => new Promise<never>(() => undefined));
  const answer = {
    status: 500,
    headers: new Headers(),
    body: { getReader: () => ({ read, cancel }) },
  };
  return { answer, read };
}

/** The init of the one call to `fetchImpl`. */
export function initSentTo(fetchImpl: Mock<FetchImpl>): FetchInit {
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const init = fetchImpl.mock.calls[0]?.[1];
  if (init === undefined) {
    throw new Error("Expected fetchImpl to be called with an init");
  }
  return init;
}

export type Settlement =
  | { readonly state: "pending" }
  | { readonly state: "fulfilled"; readonly value: unknown }
  | { readonly state: "rejected"; readonly reason: unknown };

/**
 * Follows `promise` without awaiting it, and gives a function that reads its
 * state: a call that never settles fails an assertion, not the test's
 * timeout. The handlers keep the value or the reason, and return nothing: a
 * handler that returned it would resolve a promise with it, which reads its
 * `then`.
 */
export function track(promise: Promise<unknown>): () => Settlement {
  let settlement: Settlement = { state: "pending" };
  promise.then(
    (value) => {
      settlement = { state: "fulfilled", value };
    },
    (reason: unknown) => {
      settlement = { state: "rejected", reason };
    },
  );
  return () => settlement;
}

/** What the tracked call has resolved with by now. Fails otherwise. */
export function valueNow(call: () => Settlement): unknown {
  const settlement = call();
  expect(settlement.state, "the state of the call").toBe("fulfilled");
  return settlement.state === "fulfilled" ? settlement.value : undefined;
}

/** What the tracked call has rejected with by now. Fails otherwise. */
export function reasonNow(call: () => Settlement): unknown {
  const settlement = call();
  expect(settlement.state, "the state of the call").toBe("rejected");
  return settlement.state === "rejected" ? settlement.reason : undefined;
}

/**
 * What the tracked call has rejected with by now, checked to be an instance
 * of `errorClass`. Fails otherwise.
 */
export function rejectionNow<E>(
  call: () => Settlement,
  errorClass: abstract new (...args: never[]) => E,
): E {
  const reason = reasonNow(call);
  expect(reason).toBeInstanceOf(errorClass);
  return reason as E;
}

/**
 * Moves the fake clock to `ms`, running the timers due by then and the
 * microtasks they queue. A test that uses it starts the clock at 0, with
 * `vi.useFakeTimers({ now: 0 })`.
 */
export async function advanceTo(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms - Date.now());
}

/** Runs the microtasks queued by now, without moving the fake clock. */
export async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

// Captured when the module loads, before a test installs fake timers.
const realSetImmediate = globalThis.setImmediate;
const realSetTimeout = globalThis.setTimeout;

/** Whether the tests run on Node, which has a `process`, or in a browser. */
const onNode = typeof process !== "undefined";

/** Waits for one real macrotask: a `setImmediate` on Node, a `setTimeout` in a browser. */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    if (onNode) realSetImmediate(resolve);
    else realSetTimeout(resolve, 0);
  });
}

/**
 * What reaches `process` as an unhandled rejection or an uncaught exception
 * while `run` runs, and for a few real macrotasks after it: Node reports an
 * unhandled rejection once the microtasks of a macrotask have run. In a
 * browser, where there is no `process`, it is what reaches the page:
 * `unhandledrejection` and `error` events on `globalThis`. The macrotasks
 * it waits for are real ones, captured before any fake timers.
 */
export async function errorsReachingProcess(
  run: () => Promise<void>,
): Promise<unknown[]> {
  const reached: unknown[] = [];
  const collect = (error: unknown): void => {
    reached.push(error);
  };
  const collectRejection = (event: PromiseRejectionEvent): void => {
    collect(event.reason);
  };
  const collectError = (event: ErrorEvent): void => {
    collect(event.error);
  };
  if (onNode) {
    process.on("unhandledRejection", collect);
    process.on("uncaughtException", collect);
  } else {
    globalThis.addEventListener("unhandledrejection", collectRejection);
    globalThis.addEventListener("error", collectError);
  }
  try {
    await run();
    for (let tick = 0; tick < 3; tick++) {
      await nextMacrotask();
    }
  } finally {
    if (onNode) {
      process.off("unhandledRejection", collect);
      process.off("uncaughtException", collect);
    } else {
      globalThis.removeEventListener("unhandledrejection", collectRejection);
      globalThis.removeEventListener("error", collectError);
    }
  }
  return reached;
}

/**
 * An Error behind a Proxy whose every trap that reads it throws: a field,
 * `in`, `instanceof`, its keys.
 */
export function createTrapThrowingProxy(): Error {
  const trap = (name: string) => (): never => {
    throw new Error(`The ${name} trap threw`);
  };
  return new Proxy(new Error("stop"), {
    get: trap("get"),
    has: trap("has"),
    getPrototypeOf: trap("getPrototypeOf"),
    ownKeys: trap("ownKeys"),
    getOwnPropertyDescriptor: trap("getOwnPropertyDescriptor"),
  });
}
