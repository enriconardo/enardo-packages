import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo, Server as NetServer, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { inspect } from "node:util";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import {
  HttpClient,
  HttpResponseError,
  NetworkError,
  TimeoutError,
} from "~/index";
import type { FetchImpl, RequestOptions } from "~/index";
import {
  BASE_URL,
  createMockFetch,
  createReadableStream,
  createAsyncChunks,
  createMockLogger,
  logCallsOf,
  rejectionOf,
  thrownBy,
  MARKED_PATH,
  track,
  valueNow,
  reasonNow,
  rejectionNow,
  advanceTo,
} from "./support/http-client";
import type { MockLogger, Settlement } from "./support/http-client";

// The tests of HttpClient that need Node: its fetch and local servers,
// util.inspect, getEventListeners, and what only Node puts on an error
// (the code ERR_INVALID_URL, undici's messages). The others are in
// http-client.test.ts, which runs in browsers too.

/** Answers 200 with the method and the body it received, as JSON. */
function createEchoServer(): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          method: req.method,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });
}

/**
 * Answers a 302 to a URL with markers in its query and fragment, and there a
 * 302 to a `Location` that does not parse.
 */
function createRedirectServer(): Server {
  return createServer((req, res) => {
    const location = req.url?.startsWith("/bad")
      ? "http://exa mple.com/"
      : "/bad?hop-secret=1#hop-frag-secret";
    res.writeHead(302, { location });
    res.end();
  });
}

/** A raw response that does not parse, at `X-Note : a`. */
const MALFORMED_RESPONSE = [
  "HTTP/1.1 200 OK",
  "X-Note : a",
  "Set-Cookie: sid=header-secret",
  "Content-Length: 11",
  "",
  "body-secret",
].join("\r\n");

/**
 * Answers every request with `MALFORMED_RESPONSE`, then ends the connection.
 * Its open connections are in `sockets`.
 */
function createMalformedResponseServer(sockets: Set<Socket>): NetServer {
  return createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    // The client drops the connection when the response does not parse.
    socket.on("error", () => undefined);
    socket.once("data", () => {
      socket.end(MALFORMED_RESPONSE);
    });
  });
}

/** Listens on a free port of 127.0.0.1, and gives that port. */
async function listenOnLocalPort(server: NetServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

/** Stops `server`, once its connections have ended. */
async function closeServer(server: NetServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Fails when a marker is in `util.inspect` of `error`. */
function expectNoMarkerInspected(error: unknown, markers: string[]): void {
  const inspected = inspect(error, { depth: null });
  for (const marker of markers) {
    expect(inspected, marker).not.toContain(marker);
  }
}

/** How long a case with Node's fetch waits, in real time, for a call or a socket. */
const DEADLINE = 2_000;

/**
 * Tracks `promise` as `track` does, and waits until it settles, or for `ms`
 * of real time if it does not.
 */
async function trackUntilSettled(
  promise: Promise<unknown>,
  ms: number,
): Promise<() => Settlement> {
  const call = track(promise);
  await Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    delay(ms, undefined, { ref: false }),
  ]);
  return call;
}

interface LocalServer {
  /** `http://127.0.0.1:<port>`. */
  readonly baseUrl: string;
  /** One per connection the server accepted: resolves when its socket closes. */
  readonly socketsClosed: Promise<void>[];
  /** Stops the server, ending its connections. */
  readonly close: () => Promise<void>;
}

/** Starts a `node:http` server on a free port of 127.0.0.1. */
async function startServer(handler: RequestListener): Promise<LocalServer> {
  const server = createServer(handler);
  const socketsClosed: Promise<void>[] = [];
  server.on("connection", (socket: Socket) => {
    socketsClosed.push(
      new Promise((resolve) => {
        socket.once("close", () => {
          resolve();
        });
      }),
    );
  });
  const port = await listenOnLocalPort(server);
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    socketsClosed,
    close: async () => {
      const closing = closeServer(server);
      server.closeAllConnections();
      await closing;
    },
  };
}

/**
 * Fails unless the server accepted a connection, and every socket it
 * accepted closed within DEADLINE.
 */
async function expectSocketsClosed(server: LocalServer): Promise<void> {
  expect(server.socketsClosed.length, "connections").toBeGreaterThan(0);
  const closed = await trackUntilSettled(
    Promise.all(server.socketsClosed),
    DEADLINE,
  );
  expect(closed().state, "the close of the sockets").toBe("fulfilled");
}

describe("HttpClient", () => {
  describe("constructor", () => {
    it.each(["", "/api", "api.example.com"])(
      "should throw the TypeError of new URL() for the baseUrl %j, which is not an absolute URL",
      (baseUrl) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ baseUrl, fetchImpl }),
          TypeError,
        );

        expect(error).toHaveProperty("code", "ERR_INVALID_URL");
      },
    );

    it.each<{ shape: string; baseUrl: string | URL }>([
      {
        shape: "a string with a username and a password",
        baseUrl: "https://alice:hunter2@api.example.com/v2/",
      },
      {
        shape: "a string with a username",
        baseUrl: "https://alice@api.example.com/v2/",
      },
      {
        shape: "a string with a password",
        baseUrl: "https://:hunter2@api.example.com/v2/",
      },
      {
        shape: "a URL with a username and a password",
        baseUrl: new URL("https://alice:hunter2@api.example.com/v2/"),
      },
    ])(
      "should throw a TypeError holding no part of a baseUrl with credentials: $shape",
      ({ baseUrl }) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ baseUrl, fetchImpl }),
          TypeError,
        );

        expect(error.message).toBe("Expected a baseUrl without credentials");
        expectNoMarkerInspected(error, ["alice", "hunter2"]);
      },
    );

    it.each([
      "https://api.example.com/v2?key=q-secret",
      "https://api.example.com/v2#frag-secret",
    ])(
      "should throw a TypeError holding no part of the baseUrl %j, which has a query string or a fragment",
      (baseUrl) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ baseUrl, fetchImpl }),
          TypeError,
        );

        expect(error.message).toBe(
          "Expected a baseUrl without a query string or a fragment",
        );
        expectNoMarkerInspected(error, ["q-secret", "frag-secret"]);
      },
    );

    // The checks run in the order scheme, credentials, query string or
    // fragment: a baseUrl that fails several gets the error of the first.
    it.each([
      {
        shape: "an ftp URL with credentials and a query string",
        baseUrl: "ftp://alice:hunter2@api.example.com/?key=q-secret",
        message: "Expected an http or https baseUrl",
      },
      {
        shape: "an https URL with credentials and a query string",
        baseUrl: "https://alice:hunter2@api.example.com/?key=q-secret",
        message: "Expected a baseUrl without credentials",
      },
    ])(
      "should throw the TypeError of the first check that fails, holding no part of the URL: $shape",
      ({ baseUrl, message }) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ baseUrl, fetchImpl }),
          TypeError,
        );

        expect(error.message).toBe(message);
        expectNoMarkerInspected(error, ["alice", "hunter2", "q-secret"]);
      },
    );
  });

  // The URL, the headers and the init are built before the call: what they
  // throw comes out as it is, and no request goes out.
  describe("request() building the request", () => {
    it("should reject an invalid URL with the TypeError of new URL(), with no call and no log", async () => {
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ fetchImpl, logger });

      const error = await rejectionOf(client.get("not a url"), TypeError);

      expect(error).not.toBeInstanceOf(NetworkError);
      expect(error).toHaveProperty("code", "ERR_INVALID_URL");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toEqual([]);
    });

    it("should reject an invalid header name with a TypeError, with no call and no log", async () => {
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

      const error = await rejectionOf(
        client.get("/users", { headers: { "bad name": "v" } }),
        TypeError,
      );

      expect(error).not.toBeInstanceOf(NetworkError);
      // Node's wording: the tests run on Node only.
      expect(error.message).toMatch(/invalid header name/);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toEqual([]);
    });

    describe("a URL with credentials", () => {
      const CREDENTIALS_MARKERS = ["alice", "hunter2", "q-secret"];

      it.each<{ url: string; resource: string | URL; baseUrl?: string }>([
        {
          url: "a string with a username and a password, without a baseUrl",
          resource:
            "https://alice:hunter2@api.example.com/v1/users?token=q-secret",
        },
        {
          url: "a URL with a username and a password, with a baseUrl",
          resource: new URL(
            "https://alice:hunter2@api.example.com/v1/users?token=q-secret",
          ),
          baseUrl: "https://api.example.com/v2/",
        },
        {
          url: "a string with a username, without a baseUrl",
          resource: "https://alice@api.example.com/?token=q-secret",
        },
        {
          url: "a string with a password, without a baseUrl",
          resource: "https://:hunter2@api.example.com/?token=q-secret",
        },
      ])(
        "should reject $url with a TypeError holding no part of the URL, with no call and no log",
        async ({ resource, baseUrl }) => {
          const fetchImpl = createMockFetch(200);
          const logger = createMockLogger();
          const client = new HttpClient({ baseUrl, fetchImpl, logger });

          const error = await rejectionOf(client.get(resource), TypeError);

          expect(error.message).toBe(
            "Expected a request URL without credentials",
          );
          expect(fetchImpl).not.toHaveBeenCalled();
          expect(logCallsOf(logger)).toEqual([]);
          expectNoMarkerInspected(error, CREDENTIALS_MARKERS);
        },
      );
    });
  });

  describe("request() with no response", () => {
    // What a stubbed fetchImpl rejects with is the test's guess: these run
    // the real one, against local servers, and read what it rejects with.
    describe("with Node's fetch and local servers", () => {
      const MARKERS = [
        "alice",
        "hunter2",
        "q-secret",
        "hop-secret",
        "hop-frag-secret",
        "exa mple",
        "header-secret",
        "body-secret",
      ];

      let redirectServer: Server;
      let redirectBaseUrl: string;
      let malformedResponseServer: NetServer;
      const malformedResponseSockets = new Set<Socket>();
      let malformedResponseUrl: string;
      let closedPort: number;

      beforeAll(async () => {
        redirectServer = createRedirectServer();
        const redirectPort = await listenOnLocalPort(redirectServer);
        redirectBaseUrl = `http://127.0.0.1:${String(redirectPort)}`;

        malformedResponseServer = createMalformedResponseServer(
          malformedResponseSockets,
        );
        const malformedResponsePort = await listenOnLocalPort(
          malformedResponseServer,
        );
        malformedResponseUrl = `http://127.0.0.1:${String(malformedResponsePort)}/`;

        // A port that was listening and is closed: connecting is refused.
        const closedServer = createNetServer();
        closedPort = await listenOnLocalPort(closedServer);
        await closeServer(closedServer);
      });

      afterAll(async () => {
        const closing = Promise.all([
          closeServer(redirectServer),
          closeServer(malformedResponseServer),
        ]);
        // fetch keeps connections alive: without this, close() waits for
        // them to time out.
        redirectServer.closeAllConnections();
        for (const socket of malformedResponseSockets) {
          socket.destroy();
        }
        await closing;
      });

      /** Fails when a marker is in the JSON of a logged argument. */
      function expectNoMarkerLogged(logger: MockLogger): void {
        const calls = logCallsOf(logger);
        expect(calls).not.toEqual([]);

        // The logger's context goes into every log too.
        const loggedArguments = [
          ...calls.flatMap(([, ...args]) => args),
          ...logger.child.mock.calls.flat(),
        ];
        for (const argument of loggedArguments) {
          const json = JSON.stringify(argument);
          for (const marker of MARKERS) {
            expect(json, marker).not.toContain(marker);
          }
        }
      }

      it("should reject a refused connection with a NetworkError whose cause keeps the ECONNREFUSED code, and log no marker", async () => {
        const logger = createMockLogger();
        const client = new HttpClient({ logger });

        const error = await rejectionOf(
          client.get(`http://127.0.0.1:${String(closedPort)}/`),
          NetworkError,
        );

        expect(error.cause).toStrictEqual({
          name: "TypeError",
          cause: { name: "Error", code: "ECONNREFUSED" },
        });
        expectNoMarkerLogged(logger);
      });

      // The client rejects a URL with credentials before the call: only a
      // fetchImpl that builds its own URL gives one to Node's fetch.
      it("should reject a URL to which fetchImpl adds credentials with a NetworkError whose cause is a bare TypeError, and log no marker", async () => {
        const logger = createMockLogger();
        const client = new HttpClient({
          fetchImpl: (url, init) => {
            const marked = new URL(url);
            marked.username = "alice";
            marked.password = "hunter2";
            marked.search = "?token=q-secret";
            return fetch(marked, init);
          },
          logger,
        });

        const error = await rejectionOf(
          client.get(`${redirectBaseUrl}/`),
          NetworkError,
        );

        expect(error.cause).toStrictEqual({ name: "TypeError" });
        expectNoMarkerLogged(logger);
      });

      it("should reject a redirect to a Location that does not parse with a NetworkError whose cause keeps ERR_INVALID_URL, and log no marker", async () => {
        const logger = createMockLogger();
        const client = new HttpClient({ logger });

        const error = await rejectionOf(
          client.get(`${redirectBaseUrl}/redirect`),
          NetworkError,
        );

        expect(error.cause?.cause?.code).toBe("ERR_INVALID_URL");
        expectNoMarkerLogged(logger);
      });

      it("should reject a malformed response with a NetworkError whose cause keeps HTTPParserError, and log no marker", async () => {
        const logger = createMockLogger();
        const client = new HttpClient({ logger });

        const error = await rejectionOf(
          client.get(malformedResponseUrl),
          NetworkError,
        );

        expect(error.cause?.cause?.name).toBe("HTTPParserError");
        expectNoMarkerLogged(logger);
      });
    });
  });

  describe("the caller's signal", () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // The caller's errors come first: a signal checked before them would
    // reject with its reason.
    describe("already aborted, behind a caller's error", () => {
      const ABORTED = AbortSignal.abort(new Error("stop"));

      it("should reject an invalid URL with the TypeError of new URL(), with no call and no log", async () => {
        const fetchImpl = createMockFetch(200);
        const logger = createMockLogger();
        const client = new HttpClient({ fetchImpl, logger });

        const error = await rejectionOf(
          client.get("not a url", { signal: ABORTED }),
          TypeError,
        );

        expect(error).toHaveProperty("code", "ERR_INVALID_URL");
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(logCallsOf(logger)).toEqual([]);
      });

      it("should reject an invalid header name with a TypeError, with no call and no log", async () => {
        const fetchImpl = createMockFetch(200);
        const logger = createMockLogger();
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const error = await rejectionOf(
          client.get(MARKED_PATH, {
            headers: { "bad name": "v" },
            signal: ABORTED,
          }),
          TypeError,
        );

        // Node's wording: the tests run on Node only.
        expect(error.message).toMatch(/invalid header name/);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(logCallsOf(logger)).toEqual([]);
      });
    });

    // A long-lived signal, such as a server's shutdown signal passed to
    // every request, would otherwise collect one listener per request. So
    // would init.signal, the signal combined from it: Node keeps a combined
    // signal alive while it has an abort listener.
    it("should leave no listener on the caller's signal, nor on init.signal, after each of five requests, settled in turn", async () => {
      const { signal } = new AbortController();
      const fetchImpl = vi
        .fn<FetchImpl>()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response("body", { status: 500 }))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockImplementationOnce(() => new Promise<Response>(() => undefined))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl,
        timeout: false,
      });
      /**
       * Fails unless `count` requests have called fetchImpl, and neither the
       * caller's signal nor the init.signal of the last call has a listener.
       */
      const expectNoListenerAfter = (count: number, outcome: string): void => {
        expect(getEventListeners(signal, "abort"), outcome).toEqual([]);
        expect(fetchImpl, outcome).toHaveBeenCalledTimes(count);
        const sent = fetchImpl.mock.lastCall?.[1]?.signal;
        expect(sent, `init.signal ${outcome}`).toBeInstanceOf(AbortSignal);
        expect(
          getEventListeners(sent!, "abort"),
          `init.signal ${outcome}`,
        ).toEqual([]);
      };

      const returned = await client.get(MARKED_PATH, { signal });
      expect(returned.status).toBe(200);
      expectNoListenerAfter(1, "after a 200");

      await rejectionOf(
        client.get(MARKED_PATH, { signal, throwOnError: true }),
        HttpResponseError,
      );
      expectNoListenerAfter(2, "after an HttpResponseError");

      await rejectionOf(client.get(MARKED_PATH, { signal }), NetworkError);
      expectNoListenerAfter(3, "after a NetworkError");

      const timingOut = track(
        client.get(MARKED_PATH, { signal, timeout: 100 }),
      );
      await advanceTo(100);
      rejectionNow(timingOut, TimeoutError);
      expectNoListenerAfter(4, "after a TimeoutError");

      const returnedInTime = await client.get(MARKED_PATH, {
        signal,
        timeout: 100,
      });
      expect(returnedInTime.status).toBe(200);
      expectNoListenerAfter(5, "after a 200 with a timeout");
    });
  });

  // What a stubbed fetchImpl does with init.signal is the test's guess:
  // these run Node's fetch, against local servers, with real timers.
  describe("timeouts and aborts with Node's fetch and local servers", () => {
    const servers: LocalServer[] = [];

    async function serve(handler: RequestListener): Promise<LocalServer> {
      const server = await startServer(handler);
      servers.push(server);
      return server;
    }

    afterEach(async () => {
      await Promise.all(servers.splice(0).map((server) => server.close()));
    });

    /** Accepts the connection and the request, and never answers. */
    const neverAnswer: RequestListener = () => undefined;

    /** Answers a 500 whose body never ends. */
    const answerEndless500: RequestListener = (_request, response) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.write("partial");
    };

    /**
     * Sends a 200's headers at once, and its body at 1,000 ms: on a loaded
     * machine, local headers can take more than 100 ms, so the cases that
     * read it time out at 500 ms.
     */
    const answerBodyAt1000: RequestListener = (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.flushHeaders();
      const timer = setTimeout(() => {
        response.end("late body");
      }, 1_000);
      response.on("close", () => {
        clearTimeout(timer);
      });
    };

    // At 100 ms, a loaded machine could time out before the server had
    // accepted the connection, which leaves no socket to check.
    it("should reject with a TimeoutError a request to a server that never answers, and close its connection", async () => {
      const server = await serve(neverAnswer);
      const client = new HttpClient({ baseUrl: server.baseUrl });

      const call = await trackUntilSettled(
        client.get("/", { timeout: 500 }),
        DEADLINE,
      );

      rejectionNow(call, TimeoutError);
      await expectSocketsClosed(server);
    });

    // The abort waits for the request to reach the server: one at a fixed
    // delay could come, on a loaded machine, before any connection.
    it("should reject with the very reason when the caller aborts a request that a server received and never answers, and close its connection", async () => {
      let received = (): void => undefined;
      const requestReceived = new Promise<void>((resolve) => {
        received = resolve;
      });
      const server = await serve(() => {
        received();
      });
      const client = new HttpClient({ baseUrl: server.baseUrl });
      const reason = new Error("stop");
      const controller = new AbortController();

      const sent = client.get("/", { signal: controller.signal });
      const arrival = await trackUntilSettled(requestReceived, DEADLINE);
      expect(arrival().state, "the request's arrival").toBe("fulfilled");
      controller.abort(reason);
      const call = await trackUntilSettled(sent, DEADLINE);

      expect(reasonNow(call)).toBe(reason);
      await expectSocketsClosed(server);
    });

    it("should reject with a TimeoutError when the timeout passes during the read of an error body that never ends, and close its connection", async () => {
      const server = await serve(answerEndless500);
      const client = new HttpClient({ baseUrl: server.baseUrl });

      const call = await trackUntilSettled(
        client.get("/", { throwOnError: true, timeout: 100 }),
        DEADLINE,
      );

      rejectionNow(call, TimeoutError);
      await expectSocketsClosed(server);
    });

    it("should let the caller read a body that arrives after the timeout, once request() has returned", async () => {
      const server = await serve(answerBodyAt1000);
      const client = new HttpClient({ baseUrl: server.baseUrl });

      const call = await trackUntilSettled(
        client.get("/", { timeout: 500 }),
        DEADLINE,
      );
      const response = valueNow(call);
      expect(response).toBeInstanceOf(Response);
      const read = await trackUntilSettled(
        (response as Response).text(),
        DEADLINE,
      );

      expect(valueNow(read)).toBe("late body");
    });

    it("should reject the caller's read of the body with the very reason of its signal, once request() has returned", async () => {
      const server = await serve(answerBodyAt1000);
      const client = new HttpClient({ baseUrl: server.baseUrl });
      const reason = new Error("stop");
      const controller = new AbortController();

      const call = await trackUntilSettled(
        client.get("/", { signal: controller.signal, timeout: 500 }),
        DEADLINE,
      );
      const response = valueNow(call);
      expect(response).toBeInstanceOf(Response);
      const reading = (response as Response).text();
      controller.abort(reason);
      const read = await trackUntilSettled(reading, DEADLINE);

      expect(reasonNow(read)).toBe(reason);
    });
  });

  describe("stream bodies", () => {
    // Node's fetch rejects a stream body sent without `duplex`, a check a
    // stubbed fetchImpl cannot reproduce: these run the real one.
    describe("with Node's fetch", () => {
      let server: Server;
      let baseUrl: string;

      beforeAll(async () => {
        server = createEchoServer();
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${String(port)}`;
      });

      afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
          // fetch keeps connections alive: without this, close() waits for
          // them to time out.
          server.closeAllConnections();
        });
      });

      it("should send a ReadableStream body", async () => {
        const client = new HttpClient({ baseUrl });

        const response = await client.post("/", createReadableStream("hello"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          method: "POST",
          body: "hello",
        });
      });

      it("should send an async iterable body", async () => {
        const client = new HttpClient({ baseUrl });

        // The DOM lib, which this program has, does not accept an async
        // iterable as a body; the Node types do.
        const response = await client.request("/", {
          body: createAsyncChunks(
            "hel",
            "lo",
          ) as unknown as RequestOptions["body"],
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          method: "POST",
          body: "hello",
        });
      });
    });
  });
});
