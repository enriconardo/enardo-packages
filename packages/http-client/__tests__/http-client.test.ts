import {
  describe,
  it,
  expect,
  expectTypeOf,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  HttpClient,
  HttpResponseError,
  NetworkError,
  TimeoutError,
} from "~/index";
import type {
  FetchImpl,
  FetchInit,
  HttpClientOptions,
  HttpMethod,
  RequestOptions,
} from "~/index";
import {
  BASE_URL,
  MARKED_URL,
  REDUCED_URL,
  createMockFetch,
  createResponseFetch,
  createRejectingFetch,
  createBindingSensitiveFetch,
  encoder,
  createReadableStream,
  createErroringStream,
  createAsyncChunks,
  createMockLogger,
  logCallsOf,
  reasonOf,
  rejectionOf,
  thrownBy,
  hrefSentTo,
  compileOnly,
  MARKED_PATH,
  timedOutLog,
  ABORTED_LOG,
  createPendingFetch,
  createEndlessStream,
  createAnswerWithReader,
  initSentTo,
  track,
  reasonNow,
  rejectionNow,
  advanceTo,
  flush,
  errorsReachingProcess,
  createTrapThrowingProxy,
} from "./support/http-client";

// These tests run on Node and in browsers. A test that needs Node (its fetch,
// a local server, util.inspect, what only Node puts on an error) goes in
// http-client.node.test.ts.

describe("HttpClient", () => {
  describe("constructor", () => {
    it("should throw Error when fetch is not available", () => {
      const original = globalThis.fetch;
      try {
        // @ts-expect-error — intentionally removing fetch
        globalThis.fetch = undefined;
        expect(() => new HttpClient()).toThrow(Error);
        expect(() => new HttpClient()).toThrow("Fetch API not available");
      } finally {
        globalThis.fetch = original;
      }
    });

    it("should accept a custom fetchImpl", () => {
      const mockFetch = createMockFetch(200);
      const client = new HttpClient({ fetchImpl: mockFetch });
      expect(client).toBeInstanceOf(HttpClient);
    });

    it("should accept a baseUrl", () => {
      const mockFetch = createMockFetch(200);
      const client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });
      expect(client).toBeInstanceOf(HttpClient);
    });

    it.each(["ftp://api.example.com/", "file:///srv/api/", "localhost:3010"])(
      "should throw a TypeError for the baseUrl %j, whose scheme is not http or https",
      (baseUrl) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ baseUrl, fetchImpl }),
          TypeError,
        );

        expect(error.message).toBe("Expected an http or https baseUrl");
      },
    );

    it("should keep its own copy of a URL baseUrl: changing it after the constructor does not change the requests", async () => {
      const baseUrl = new URL("https://api.example.com/v2/");
      const fetchImpl = createMockFetch(200);
      const client = new HttpClient({ baseUrl, fetchImpl });

      baseUrl.pathname = "/v3/";
      await client.get("/users");

      expect(hrefSentTo(fetchImpl)).toBe("https://api.example.com/v2/users");
    });
  });

  // The client calls fetchImpl with a URL and the init it builds, and with
  // nothing else: any function that accepts that much can be injected, not
  // only one that accepts everything fetch does.
  describe("the type of fetchImpl", () => {
    it("should be a FetchImpl: a URL and a FetchInit in, a Promise<Response> out", () => {
      expectTypeOf<HttpClientOptions["fetchImpl"]>().toEqualTypeOf<
        FetchImpl | undefined
      >();
      expectTypeOf<Parameters<FetchImpl>>().toEqualTypeOf<[URL, FetchInit]>();
      expectTypeOf<ReturnType<FetchImpl>>().toEqualTypeOf<Promise<Response>>();
    });

    it("should type FetchInit as what the client passes, and nothing else", () => {
      // HttpBody is internal: the body of RequestOptions, null aside, names it.
      expectTypeOf<FetchInit>().toEqualTypeOf<{
        method: HttpMethod;
        headers: Headers;
        body?: NonNullable<RequestOptions["body"]>;
        duplex?: "half";
        signal?: AbortSignal;
      }>();
    });

    // In the two functions below, `void` reads a parameter for lint without
    // changing the function's type, which is what is under test.
    it("should accept a function of the URL and the init", () => {
      compileOnly(
        () =>
          new HttpClient({
            fetchImpl: async (url: URL, init: FetchInit) => {
              void url;
              void init;
              return new Response();
            },
          }),
      );
    });

    it("should accept a function of the URL alone", () => {
      compileOnly(
        () =>
          new HttpClient({
            fetchImpl: async (url: URL) => {
              void url;
              return new Response();
            },
          }),
      );
    });

    it("should accept the global fetch", () => {
      compileOnly(() => new HttpClient({ fetchImpl: fetch }));
    });

    it("should accept a vi.fn typed as fetch", () => {
      compileOnly(() => new HttpClient({ fetchImpl: vi.fn<typeof fetch>() }));
    });
  });

  describe("the types of timeout and signal", () => {
    it("should type the timeout of the client and of a request as a number, false or undefined", () => {
      expectTypeOf<HttpClientOptions["timeout"]>().toEqualTypeOf<
        number | false | undefined
      >();
      expectTypeOf<RequestOptions["timeout"]>().toEqualTypeOf<
        number | false | undefined
      >();
    });

    it("should type the signal of a request as an AbortSignal or undefined", () => {
      expectTypeOf<RequestOptions["signal"]>().toEqualTypeOf<
        AbortSignal | undefined
      >();
    });

    it("should accept signal and timeout in the options of each shortcut", () => {
      const client = new HttpClient({ fetchImpl: createMockFetch(200) });
      const { signal } = new AbortController();

      compileOnly(() => {
        void client.get("/users", { signal, timeout: 100 });
        void client.post("/users", "{}", { signal, timeout: 100 });
        void client.put("/users/1", "{}", { signal, timeout: 100 });
        void client.patch("/users/1", "{}", { signal, timeout: 100 });
        void client.delete("/users/1", { signal, timeout: 100 });
        void client.head("/users", { signal, timeout: 100 });
        void client.options("/users", { signal, timeout: 100 });
      });
    });
  });

  describe("request()", () => {
    let mockFetch: ReturnType<typeof createMockFetch>;
    let client: HttpClient;

    beforeEach(() => {
      mockFetch = createMockFetch(200, { ok: true });
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });
    });

    it("should default to GET when no body is provided", async () => {
      await client.request("/users");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should default to POST when body is provided", async () => {
      await client.request("/users", {
        body: JSON.stringify({ name: "test" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should use the explicit method when provided", async () => {
      await client.request("/users", {
        method: "PUT",
        body: JSON.stringify({}),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "PUT" }),
      );
    });

    it("should call fetch with a browser-safe binding", async () => {
      const answer = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const bindingSensitiveFetch = createBindingSensitiveFetch(answer);
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: bindingSensitiveFetch,
      });

      const response = await client.request("/users");

      expect(response).toBe(answer);
      expect(bindingSensitiveFetch).toHaveBeenCalledTimes(1);
    });

    it("should resolve the URL with baseUrl", async () => {
      await client.request("/users");

      const calledUrl = mockFetch.mock.calls[0]![0] as URL;
      expect(calledUrl.toString()).toBe("https://api.example.com/users");
    });

    it("should apply query parameters", async () => {
      await client.request("/users", {
        query: { page: 1, limit: 10, tag: ["a", "b"] },
      });

      const calledUrl = mockFetch.mock.calls[0]![0] as URL;
      expect(calledUrl.searchParams.get("page")).toBe("1");
      expect(calledUrl.searchParams.get("limit")).toBe("10");
      expect(calledUrl.searchParams.getAll("tag")).toEqual(["a", "b"]);
    });

    it("should skip null and undefined query values", async () => {
      await client.request("/users", {
        query: { page: 1, filter: null, sort: undefined },
      });

      const calledUrl = mockFetch.mock.calls[0]![0] as URL;
      expect(calledUrl.searchParams.has("page")).toBe(true);
      expect(calledUrl.searchParams.has("filter")).toBe(false);
      expect(calledUrl.searchParams.has("sort")).toBe(false);
    });

    it("should pass custom headers", async () => {
      await client.request("/users", {
        headers: { authorization: "Bearer token123" },
      });

      const calledHeaders = mockFetch.mock.calls[0]![1]!.headers as Headers;
      expect(calledHeaders.get("authorization")).toBe("Bearer token123");
    });

    it("should pass a copy of a Headers instance", async () => {
      const headers = new Headers({
        "content-type": "application/json",
        authorization: "Bearer token123",
      });

      await client.request("/users", { headers });

      const calledHeaders = mockFetch.mock.calls[0]![1]!.headers as Headers;
      expect(calledHeaders).not.toBe(headers);
      expect([...calledHeaders.entries()]).toEqual([...headers.entries()]);
    });

    it("should return 4xx responses without throwing by default", async () => {
      mockFetch = createMockFetch(404, { error: "Not Found" });
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });

      const response = await client.request("/missing");
      expect(response.status).toBe(404);
    });

    it("should return 5xx responses without throwing by default", async () => {
      mockFetch = createMockFetch(500, { error: "Internal Server Error" });
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });

      const response = await client.request("/failing");
      expect(response.status).toBe(500);
    });
  });

  // With a baseUrl, a string resource is a path under it, whatever it looks
  // like: <origin of baseUrl><path of baseUrl>/<resource>, with one trailing
  // "/" of the base's path and one leading "/" of the resource dropped first.
  describe("the URL of a request", () => {
    // A row with two bases or two resources gives a case for each pair.
    const JOIN_ROWS: {
      baseUrls: string[];
      resources: string[];
      query?: RequestOptions["query"];
      sent: string;
    }[] = [
      {
        baseUrls: ["https://api.example.com", "https://api.example.com/"],
        resources: ["/users", "users"],
        sent: "https://api.example.com/users",
      },
      {
        baseUrls: ["https://api.example.com/v2", "https://api.example.com/v2/"],
        resources: ["/users", "users"],
        sent: "https://api.example.com/v2/users",
      },
      {
        baseUrls: ["http://localhost:3010/api"],
        resources: ["/auth/register"],
        sent: "http://localhost:3010/api/auth/register",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["", "/"],
        sent: "https://api.example.com/v2/",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["/users?page=2#top"],
        query: { tag: "a" },
        sent: "https://api.example.com/v2/users?page=2&tag=a#top",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["//evil.example.com/x"],
        sent: "https://api.example.com/v2//evil.example.com/x",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["https://other.example.com/x"],
        sent: "https://api.example.com/v2/https://other.example.com/x",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        // Two backslashes.
        resources: ["\\\\evil.example.com/x"],
        sent: "https://api.example.com/v2///evil.example.com/x",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["users:1"],
        sent: "https://api.example.com/v2/users:1",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["alice:hunter2@evil.example.com/x"],
        sent: "https://api.example.com/v2/alice:hunter2@evil.example.com/x",
      },
      {
        baseUrls: ["https://api.example.com/v2/"],
        resources: ["../admin", "%2e%2e/admin"],
        sent: "https://api.example.com/admin",
      },
    ];

    it.each(
      JOIN_ROWS.flatMap(({ baseUrls, resources, query, sent }) =>
        baseUrls.flatMap((baseUrl) =>
          resources.map((resource) => ({ baseUrl, resource, query, sent })),
        ),
      ),
    )(
      "should send the string $resource against the baseUrl $baseUrl to $sent",
      async ({ baseUrl, resource, query, sent }) => {
        const fetchImpl = createMockFetch(200);
        const client = new HttpClient({ baseUrl, fetchImpl });

        await client.get(resource, { query });

        expect(hrefSentTo(fetchImpl)).toBe(sent);
      },
    );

    it("should drop one trailing / of the base's path, and keep the others", async () => {
      const fetchImpl = createMockFetch(200);
      const client = new HttpClient({
        baseUrl: "https://api.example.com/v2//",
        fetchImpl,
      });

      await client.get("users");

      expect(hrefSentTo(fetchImpl)).toBe("https://api.example.com/v2//users");
    });

    // URL reports an empty query string or fragment as "", as if it were not
    // there: the constructor accepts it, and the join drops it.
    it.each(["https://api.example.com/v2?", "https://api.example.com/v2#"])(
      "should accept the baseUrl %j, whose query string or fragment is empty, and send /users under its path",
      async (baseUrl) => {
        const fetchImpl = createMockFetch(200);
        const client = new HttpClient({ baseUrl, fetchImpl });

        await client.get("/users");

        expect(hrefSentTo(fetchImpl)).toBe("https://api.example.com/v2/users");
      },
    );

    it("should send a URL resource as it is, with a baseUrl", async () => {
      const fetchImpl = createMockFetch(200);
      const client = new HttpClient({
        baseUrl: "https://api.example.com/v2/",
        fetchImpl,
      });

      await client.get(new URL("https://other.example.com/x"));

      expect(hrefSentTo(fetchImpl)).toBe("https://other.example.com/x");
    });

    it("should add the query of a URL resource to another object than the caller's, and leave the caller's unchanged", async () => {
      const fetchImpl = createMockFetch(200);
      const client = new HttpClient({
        baseUrl: "https://api.example.com/v2/",
        fetchImpl,
      });
      const resource = new URL("https://other.example.com/x");

      await client.get(resource, { query: { a: 1 } });

      expect(hrefSentTo(fetchImpl)).toBe("https://other.example.com/x?a=1");
      expect(fetchImpl.mock.calls[0]?.[0]).not.toBe(resource);
      expect(resource.href).toBe("https://other.example.com/x");
    });

    it("should send a string as it is, without a baseUrl", async () => {
      const fetchImpl = createMockFetch(200);
      const client = new HttpClient({ fetchImpl });

      await client.get("https://api.example.com/users");

      expect(hrefSentTo(fetchImpl)).toBe("https://api.example.com/users");
    });
  });

  // request() and the shortcuts resolve with the very object fetchImpl
  // resolved with: not wrapped, and with its body unread.
  describe("the returned response", () => {
    const CALLS: {
      call: string;
      send: (client: HttpClient) => Promise<Response>;
    }[] = [
      { call: "request()", send: (client) => client.request("/users") },
      { call: "get()", send: (client) => client.get("/users") },
      { call: "post()", send: (client) => client.post("/users", "{}") },
      { call: "put()", send: (client) => client.put("/users/1", "{}") },
      { call: "patch()", send: (client) => client.patch("/users/1", "{}") },
      { call: "delete()", send: (client) => client.delete("/users/1") },
      { call: "head()", send: (client) => client.head("/users") },
      { call: "options()", send: (client) => client.options("/users") },
    ];

    // Without throwOnError, an error status is returned like any other.
    const STATUSES = [200, 404, 500];

    it.each(
      CALLS.flatMap(({ call, send }) =>
        STATUSES.map((status) => ({ call, send, status })),
      ),
    )(
      "$call should resolve with the very Response of fetchImpl, unread, for a $status",
      async ({ send, status }) => {
        // A body to read: with none, bodyUsed would stay false whatever the
        // client did.
        const answer = new Response("body", { status });
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createResponseFetch(answer),
        });

        const response = await send(client);

        expect(response).toBe(answer);
        expect(answer.bodyUsed).toBe(false);
      },
    );

    it("request() should be typed as resolving with a Response", () => {
      expectTypeOf<ReturnType<HttpClient["request"]>>().toEqualTypeOf<
        Promise<Response>
      >();
    });
  });

  // The URL, the headers and the init are built before the call: what they
  // throw comes out as it is, and no request goes out.
  describe("request() building the request", () => {
    it("should reject a malformed header pair with a TypeError, with no call and no log", async () => {
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

      // The types reject it: only a cast or a JavaScript caller can pass it.
      const headers = [["x-only-name"]] as unknown as RequestOptions["headers"];
      const error = await rejectionOf(
        client.get("/users", { headers }),
        TypeError,
      );

      expect(error).not.toBeInstanceOf(NetworkError);
      expect(error.message).toBe("Expected a [name, value] header pair");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toEqual([]);
    });

    describe("a URL with credentials", () => {
      // fetchImpl rejects as Node's fetch does for such a URL: a request
      // that reached it would give a NetworkError.
      it("should reject it with an error that is not a NetworkError", async () => {
        const fetchImpl = createRejectingFetch(
          new TypeError(
            "Request cannot be constructed from a URL that includes credentials: https://alice:hunter2@api.example.com/v1/users?token=q-secret",
          ),
        );
        const client = new HttpClient({ fetchImpl });

        const error = await reasonOf(
          client.get(
            "https://alice:hunter2@api.example.com/v1/users?token=q-secret",
          ),
        );

        expect(error).not.toBeInstanceOf(NetworkError);
        expect(error).toBeInstanceOf(TypeError);
        expect(error).toHaveProperty(
          "message",
          "Expected a request URL without credentials",
        );
      });

      // The URL is checked before the headers are built: the other way
      // round, the bad header name would reject with the TypeError of
      // Headers.
      it("should reject it before building the headers, with no call", async () => {
        const fetchImpl = createMockFetch(200);
        const client = new HttpClient({ fetchImpl });

        const error = await rejectionOf(
          client.get("https://alice:hunter2@api.example.com/", {
            headers: { "bad name": "v" },
          }),
          TypeError,
        );

        expect(error.message).toBe(
          "Expected a request URL without credentials",
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      });
    });

    // Every fetch rejects a GET or a HEAD with a body before sending it, with
    // no code to tell why: the client refuses it first, as the caller's
    // error, whatever the fetchImpl. The mock below accepts any body, so a
    // request that reached it would resolve.
    describe("a body with GET or HEAD", () => {
      const NO_BODY_MESSAGE = "Expected no body with GET or HEAD";

      it.each<HttpMethod>(["GET", "HEAD"])(
        "should reject %s with a body with a TypeError, with no call and no log",
        async (method) => {
          const fetchImpl = createMockFetch(200);
          const logger = createMockLogger();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl,
            logger,
          });

          const error = await rejectionOf(
            client.request("/users", { method, body: "x" }),
            TypeError,
          );

          expect(error).not.toBeInstanceOf(NetworkError);
          expect(error.message).toBe(NO_BODY_MESSAGE);
          expect(fetchImpl).not.toHaveBeenCalled();
          expect(logCallsOf(logger)).toEqual([]);
        },
      );

      // Empty bodies count, as they do for fetch; a stream is not let
      // through by the branch that adds `duplex`. Each body is built per
      // test: a stream can be read once.
      it.each<[string, () => NonNullable<RequestOptions["body"]>]>([
        ["an empty string", () => ""],
        ["an empty Blob", () => new Blob([])],
        ["an empty Uint8Array", () => new Uint8Array(0)],
        ["a ReadableStream", () => createReadableStream("x")],
      ])(
        "should reject GET with %s body with the same TypeError, with no call",
        async (_, createBody) => {
          const fetchImpl = createMockFetch(200);
          const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

          const error = await rejectionOf(
            client.request("/users", { method: "GET", body: createBody() }),
            TypeError,
          );

          expect(error.message).toBe(NO_BODY_MESSAGE);
          expect(fetchImpl).not.toHaveBeenCalled();
        },
      );

      // Omit<RequestOptions, "method" | "body"> rejects a body only in an
      // object literal: options held in a RequestOptions variable carry it.
      it.each(["get", "head"] as const)(
        "should reject %s() with options of type RequestOptions holding a body with the same TypeError, with no call and no log",
        async (name) => {
          const fetchImpl = createMockFetch(200);
          const logger = createMockLogger();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl,
            logger,
          });
          const opts: RequestOptions = { body: "x" };

          const error = await rejectionOf(
            client[name]("/users", opts),
            TypeError,
          );

          expect(error.message).toBe(NO_BODY_MESSAGE);
          expect(fetchImpl).not.toHaveBeenCalled();
          expect(logCallsOf(logger)).toEqual([]);
        },
      );

      it.each([
        ["null", null],
        ["undefined", undefined],
      ])(
        "should send GET with body: %s, with no body in init",
        async (_, body) => {
          const fetchImpl = vi
            .fn<FetchImpl>()
            .mockResolvedValue(new Response(null, { status: 200 }));
          const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

          const response = await client.request("/users", {
            method: "GET",
            body,
          });

          expect(response.status).toBe(200);
          expect(initSentTo(fetchImpl).body).toBeUndefined();
        },
      );

      // The check is limited to GET and HEAD, and an empty body is passed on
      // as it is.
      it.each<HttpMethod>(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
        'should send %s with body: "" as it is',
        async (method) => {
          const fetchImpl = vi
            .fn<FetchImpl>()
            .mockResolvedValue(new Response(null, { status: 200 }));
          const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

          await client.request("/users", { method, body: "" });

          expect(initSentTo(fetchImpl).body).toBe("");
        },
      );

      // The caller's errors come first: a signal checked before them would
      // reject with its reason.
      it("should reject GET with a body and a signal already aborted with the TypeError, not the signal's reason, with no log", async () => {
        const reason = new Error("stop");
        const fetchImpl = createMockFetch(200);
        const logger = createMockLogger();
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const rejection = await reasonOf(
          client.request("/users", {
            method: "GET",
            body: "x",
            signal: AbortSignal.abort(reason),
          }),
        );

        expect(rejection).not.toBe(reason);
        expect(rejection).toBeInstanceOf(TypeError);
        expect(rejection).toHaveProperty("message", NO_BODY_MESSAGE);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(logCallsOf(logger)).toEqual([]);
      });

      it("should reject GET with a body with a message holding no part of the URL", async () => {
        const fetchImpl = createMockFetch(200);
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

        const error = await rejectionOf(
          client.request("/users?token=secret", { method: "GET", body: "x" }),
          TypeError,
        );

        expect(error.message).not.toContain("secret");
        expect(fetchImpl).not.toHaveBeenCalled();
      });
    });
  });

  describe("request() with no response", () => {
    it("should reject with a NetworkError whose cause is the reduced rejection of fetchImpl", async () => {
      const cause = new TypeError("Failed to fetch");
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createRejectingFetch(cause),
      });

      const error = await rejectionOf(client.get("/users"), NetworkError);

      expect(error.cause).toStrictEqual({ name: "TypeError" });
      expect(error.details).toEqual({
        method: "GET",
        url: "https://api.example.com/users",
      });
    });

    it("should reject with a NetworkError whose cause is the reduced error fetchImpl threw synchronously", async () => {
      const cause = new TypeError("Failed to fetch");
      const fetchImpl = vi.fn<typeof fetch>(() => {
        throw cause;
      });
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

      const error = await rejectionOf(client.get("/users"), NetworkError);

      expect(error.cause).toStrictEqual({ name: "TypeError" });
      expect(error.details).toEqual({
        method: "GET",
        url: "https://api.example.com/users",
      });
    });

    it("should reject with a NetworkError whose cause leaves out a code whose getter throws, and log once, at warn", async () => {
      const rejection = new TypeError("fetch failed");
      Object.defineProperty(rejection, "code", {
        get(): never {
          throw new Error("The getter of code threw");
        },
        configurable: true,
      });
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createRejectingFetch(rejection),
        logger,
      });

      const error = await rejectionOf(client.get("/users"), NetworkError);

      expect(error.cause).toStrictEqual({ name: "TypeError" });
      expect(logCallsOf(logger).map(([level]) => level)).toEqual(["warn"]);
    });
  });

  describe("request() with throwOnError", () => {
    function createClientAnswering(response: Response) {
      return new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createResponseFetch(response),
      });
    }

    it("should resolve with the Response of fetchImpl, unread, for a 2xx even with throwOnError", async () => {
      const answer = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = createClientAnswering(answer);

      const response = await client.request("/ok", { throwOnError: true });

      expect(response).toBe(answer);
      expect(response.status).toBe(200);
      expect(answer.bodyUsed).toBe(false);
    });

    it.each([400, 404, 418, 500, 503, 599])(
      "should reject a %i with an HttpResponseError holding the status, the method and the reduced URL",
      async (status) => {
        const client = new HttpClient({
          fetchImpl: createResponseFetch(new Response(null, { status })),
        });

        const error = await rejectionOf(
          client.request(MARKED_URL, { method: "DELETE", throwOnError: true }),
          HttpResponseError,
        );

        expect(error.details).toEqual({
          method: "DELETE",
          url: REDUCED_URL,
          status,
        });
      },
    );

    it("should resolve a 399", async () => {
      const client = createClientAnswering(new Response(null, { status: 399 }));

      const response = await client.get("/users", { throwOnError: true });

      expect(response.status).toBe(399);
    });

    it("should give the parsed value of a JSON body", async () => {
      const client = createClientAnswering(
        new Response('{"error":"X"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toEqual({ error: "X" });
    });

    it("should give the text of a text/plain body", async () => {
      const client = createClientAnswering(
        new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toBe("Not Found");
    });

    // The body is parsed by what it holds, not by its content-type: an error
    // body may come with a wrong type, or with none.
    it("should give the parsed value of a JSON body sent as text/plain", async () => {
      const client = createClientAnswering(
        new Response('{"error":"X"}', {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toEqual({ error: "X" });
    });

    it("should give the parsed value of a JSON body sent with no content-type", async () => {
      // A string body would get text/plain;charset=UTF-8: bytes get no type.
      const answer = new Response(encoder.encode('{"error":"X"}'), {
        status: 400,
      });
      expect(answer.headers.has("content-type")).toBe(false);
      const client = createClientAnswering(answer);

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toEqual({ error: "X" });
    });

    it("should give the text of a text body sent as application/json", async () => {
      const client = createClientAnswering(
        new Response("Not Found", {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toBe("Not Found");
    });

    it("should give an undefined body for an empty body", async () => {
      const client = createClientAnswering(new Response("", { status: 500 }));

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.details.status).toBe(500);
      expect(error.body).toBeUndefined();
    });

    it("should still reject with an HttpResponseError, with an undefined body, when the body stream errors", async () => {
      const client = createClientAnswering(
        new Response(createErroringStream(), { status: 502 }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.details.status).toBe(502);
      expect(error.body).toBeUndefined();
    });

    // The client reads the body through a reader of its own, so that a
    // timeout or an abort can cancel it, and decodes it as text() does:
    // UTF-8 across chunks, a leading BOM dropped.
    it("should decode a body sent in chunks that split a character, and drop its leading BOM, as text() does", async () => {
      const bytes = encoder.encode('\uFEFF{"msg":"café"}');
      // The premise: the BOM is sent.
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      // Split inside the two bytes of é, 0xc3 0xa9.
      const split = bytes.indexOf(0xc3) + 1;
      const chunks = [bytes.subarray(0, split), bytes.subarray(split)];
      // The premise: neither chunk alone decodes to é.
      for (const chunk of chunks) {
        expect(new TextDecoder().decode(chunk)).not.toContain("é");
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createResponseFetch(new Response(body, { status: 500 })),
        logger: createMockLogger(),
      });

      const error = await rejectionOf(
        client.get(MARKED_PATH, { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toEqual({ msg: "café" });
    });

    // A fetchImpl other than fetch may resolve with a body that is not a web
    // stream: with no reader to take, the client reads it with text().
    it("should read with text() a body with no getReader, of a value that is not a Response", async () => {
      const answer = {
        status: 500,
        headers: new Headers(),
        body: {},
        text: () => Promise.resolve('{"error":"x"}'),
      };
      expect(answer).not.toBeInstanceOf(Response);
      expect(answer.body).not.toHaveProperty("getReader");
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi
          .fn<FetchImpl>()
          .mockResolvedValue(answer as unknown as Response),
        logger: createMockLogger(),
      });

      const error = await rejectionOf(
        client.get(MARKED_PATH, { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.body).toEqual({ error: "x" });
    });

    it("should read the body of the response fetchImpl resolved with", async () => {
      const response = new Response('{"error":"X"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      });
      const client = createClientAnswering(response);

      await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(response.bodyUsed).toBe(true);
    });

    it("should carry the headers of the response", async () => {
      const client = createClientAnswering(
        new Response(null, {
          status: 503,
          headers: { "retry-after": "120" },
        }),
      );

      const error = await rejectionOf(
        client.get("/users", { throwOnError: true }),
        HttpResponseError,
      );

      expect(error.headers.get("retry-after")).toBe("120");
    });
  });

  // An integer from 1 to 2147483647, the longest delay setTimeout keeps, or
  // false for none. Anything else is the caller's error.
  describe("the timeout's value", () => {
    const TIMEOUT_MESSAGE =
      "Expected a timeout in milliseconds, an integer from 1 to 2147483647, or false";

    // The types reject the last three: only a cast or a JavaScript caller
    // can pass them.
    const INVALID_TIMEOUTS: { label: string; timeout: number | false }[] = [
      { label: "0", timeout: 0 },
      { label: "-1", timeout: -1 },
      { label: "1.5", timeout: 1.5 },
      { label: "NaN", timeout: NaN },
      { label: "Infinity", timeout: Infinity },
      { label: "2147483648", timeout: 2_147_483_648 },
      { label: '"100"', timeout: "100" as unknown as number },
      { label: "true", timeout: true as unknown as number },
      { label: "null", timeout: null as unknown as number },
    ];

    const VALID_TIMEOUTS: (number | false)[] = [1, 2_147_483_647, false];

    beforeEach(() => {
      vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each(INVALID_TIMEOUTS)(
      "the constructor should throw a TypeError for a timeout of $label",
      ({ timeout }) => {
        const fetchImpl = createMockFetch(200);

        const error = thrownBy(
          () => new HttpClient({ fetchImpl, timeout }),
          TypeError,
        );

        expect(error.message).toBe(TIMEOUT_MESSAGE);
      },
    );

    it.each(VALID_TIMEOUTS)(
      "the constructor should accept a timeout of %s",
      (timeout) => {
        const fetchImpl = createMockFetch(200);

        expect(() => new HttpClient({ fetchImpl, timeout })).not.toThrow();
      },
    );

    it.each(INVALID_TIMEOUTS)(
      "request() should reject a timeout of $label with the same TypeError, with no call and no log",
      async ({ timeout }) => {
        const fetchImpl = createMockFetch(200);
        const logger = createMockLogger();
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const error = await rejectionOf(
          client.request("/users", { timeout }),
          TypeError,
        );

        expect(error.message).toBe(TIMEOUT_MESSAGE);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(logCallsOf(logger)).toEqual([]);
      },
    );

    it.each(VALID_TIMEOUTS)(
      "request() should call fetchImpl with a timeout of %s",
      async (timeout) => {
        const fetchImpl = createMockFetch(200);
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

        await client.request("/users", { timeout });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
      },
    );

    // A request's own timeout wins, false included. Without one (absent or
    // undefined), the client's applies, and 30 s when the client has none.
    describe("which timeout applies", () => {
      const HOUR = 3_600_000;

      it.each<{
        setup: string;
        client: Pick<HttpClientOptions, "timeout">;
        request: Pick<RequestOptions, "timeout">;
        pendingAt?: number;
        timesOutAt: number;
      }>([
        {
          setup: "no timeout anywhere",
          client: {},
          request: {},
          pendingAt: 29_999,
          timesOutAt: 30_000,
        },
        {
          setup: "a client timeout of undefined",
          client: { timeout: undefined },
          request: {},
          pendingAt: 29_999,
          timesOutAt: 30_000,
        },
        {
          setup: "a client timeout of 1000 and a request timeout of 50",
          client: { timeout: 1000 },
          request: { timeout: 50 },
          timesOutAt: 50,
        },
        {
          setup: "a client timeout of 50 and a request timeout of 1000",
          client: { timeout: 50 },
          request: { timeout: 1000 },
          pendingAt: 50,
          timesOutAt: 1000,
        },
        {
          setup: "a client timeout of 50 and a request timeout of undefined",
          client: { timeout: 50 },
          request: { timeout: undefined },
          timesOutAt: 50,
        },
        {
          setup: "a client timeout of false and a request timeout of 50",
          client: { timeout: false },
          request: { timeout: 50 },
          timesOutAt: 50,
        },
      ])(
        "should reject with a TimeoutError at $timesOutAt ms, with $setup",
        async ({ client: clientOptions, request, pendingAt, timesOutAt }) => {
          const fetchImpl = createPendingFetch();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl,
            ...clientOptions,
          });

          const call = track(client.get("/users", request));
          if (pendingAt !== undefined) {
            await advanceTo(pendingAt);
            expect(call().state, `the state at ${String(pendingAt)} ms`).toBe(
              "pending",
            );
          }
          await advanceTo(timesOutAt);

          const error = rejectionNow(call, TimeoutError);
          expect(error.details.timeout).toBe(timesOutAt);
        },
      );

      // A signal adds to the timeout: it does not replace it.
      it("should reject with a TimeoutError at 30,000 ms a request with a signal that never aborts, with no timeout anywhere", async () => {
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createPendingFetch(),
          logger: createMockLogger(),
        });

        const call = track(
          client.get(MARKED_PATH, { signal: new AbortController().signal }),
        );
        await advanceTo(29_999);
        expect(call().state, "the state at 29,999 ms").toBe("pending");
        await advanceTo(30_000);

        const error = rejectionNow(call, TimeoutError);
        expect(error.details.timeout).toBe(30_000);
      });

      it.each<{
        setup: string;
        client: Pick<HttpClientOptions, "timeout">;
        request: Pick<RequestOptions, "timeout">;
      }>([
        {
          setup: "a client timeout of false",
          client: { timeout: false },
          request: {},
        },
        {
          setup: "a client timeout of 50 and a request timeout of false",
          client: { timeout: 50 },
          request: { timeout: false },
        },
      ])(
        "should still be pending after an hour, with $setup",
        async ({ client: clientOptions, request }) => {
          const fetchImpl = createPendingFetch();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl,
            ...clientOptions,
          });

          const call = track(client.get("/users", request));
          await advanceTo(HOUR);

          expect(call().state).toBe("pending");
        },
      );
    });
  });

  // The fetchImpl of these cases ignores init.signal, unless said otherwise:
  // request() settles from the client's own timer.
  describe("the timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should reject with a TimeoutError holding the method, the reduced URL and the timeout, when the timeout passes", async () => {
      const fetchImpl = createPendingFetch();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl,
        logger: createMockLogger(),
      });

      const call = track(client.get(MARKED_PATH, { timeout: 100 }));
      await advanceTo(99);
      expect(call().state, "the state at 99 ms").toBe("pending");
      await advanceTo(100);

      const error = rejectionNow(call, TimeoutError);
      expect(error).not.toBeInstanceOf(NetworkError);
      expect(error.details).toEqual({
        method: "GET",
        url: REDUCED_URL,
        timeout: 100,
      });
    });

    it("should pass an init.signal that aborts when the timeout passes, with the very TimeoutError of the rejection", async () => {
      const fetchImpl = createPendingFetch();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl,
        logger: createMockLogger(),
      });

      const call = track(client.get(MARKED_PATH, { timeout: 100 }));
      await advanceTo(99);
      const { signal } = initSentTo(fetchImpl);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted, "aborted at 99 ms").toBe(false);
      await advanceTo(100);

      const error = rejectionNow(call, TimeoutError);
      expect(signal?.aborted, "aborted at 100 ms").toBe(true);
      expect(signal?.reason).toBe(error);
    });

    it("should log a timeout once, at warn, with the method, the reduced URL, the timeout and the rejected error", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createPendingFetch(),
        logger,
      });

      const call = track(client.get(MARKED_PATH, { timeout: 100 }));
      await advanceTo(100);

      const error = reasonNow(call);
      expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
      expect(logger.warn.mock.calls[0]?.[1]?.error).toBe(error);
    });

    it("should reject with a TimeoutError, not an HttpResponseError, when the timeout passes during the read of an error body, and log once, at warn", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi
          .fn<FetchImpl>()
          .mockResolvedValue(
            new Response(createEndlessStream(), { status: 500 }),
          ),
        logger,
      });

      const call = track(
        client.get(MARKED_PATH, { timeout: 100, throwOnError: true }),
      );
      await advanceTo(100);

      const error = rejectionNow(call, TimeoutError);
      expect(error).not.toBeInstanceOf(HttpResponseError);
      expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
    });

    // One timeout for both phases: the read of the error body gets what the
    // call left of it, not a timeout of its own.
    it("should reject with a TimeoutError at 100 ms, not at 160 ms, when a 500 whose body never closes arrives at 60 ms", async () => {
      const answer = new Response(createEndlessStream(), { status: 500 });
      const fetchImpl = vi.fn<FetchImpl>(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(answer);
            }, 60);
          }),
      );
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl,
        logger: createMockLogger(),
      });

      const call = track(
        client.get(MARKED_PATH, { timeout: 100, throwOnError: true }),
      );
      await advanceTo(99);
      // The premise: the client is reading the body.
      expect(answer.bodyUsed, "the body read at 99 ms").toBe(true);
      expect(call().state, "the state at 99 ms").toBe("pending");
      await advanceTo(100);

      rejectionNow(call, TimeoutError);
    });

    // A read left running would keep the body flowing into memory, and its
    // connection open: the client cancels it, and passes no reason on.
    it("should cancel the read of an error body when the timeout passes, with no reason, for a fetchImpl that ignores the signal", async () => {
      const cancel = vi.fn<(reason: unknown) => void>();
      const answer = new Response(createEndlessStream(cancel), { status: 500 });
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi.fn<FetchImpl>().mockResolvedValue(answer),
        logger: createMockLogger(),
      });

      const call = track(
        client.get(MARKED_PATH, { timeout: 100, throwOnError: true }),
      );
      await flush();
      // The premise: the client is reading the body.
      expect(answer.bodyUsed, "the body read").toBe(true);
      await advanceTo(100);

      rejectionNow(call, TimeoutError);
      expect(cancel).toHaveBeenCalled();
      expect(cancel.mock.calls[0]?.[0], "the reason of the cancel").toBe(
        undefined,
      );
    });

    // The cancel runs in an abort listener, where Node rethrows an error as an
    // uncaughtException, which ends the process: a cancel that throws, or
    // returns something other than a promise, is dropped.
    it.each<{ misbehaves: string; cancel: () => unknown }>([
      {
        misbehaves: "throws",
        cancel: () => {
          throw new Error("The cancel threw");
        },
      },
      { misbehaves: "returns undefined", cancel: () => undefined },
    ])(
      "should reject with a TimeoutError at 100 ms, let nothing reach process, and log once, at warn, when the cancel of the reader of an error body $misbehaves",
      async ({ cancel: misbehave }) => {
        const cancel = vi.fn(misbehave);
        const { answer, read } = createAnswerWithReader(cancel);
        expect(answer).not.toBeInstanceOf(Response);
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: vi
            .fn<FetchImpl>()
            .mockResolvedValue(answer as unknown as Response),
          logger,
        });

        const call = track(
          client.get(MARKED_PATH, { timeout: 100, throwOnError: true }),
        );
        await flush();
        // The premise: the client is reading the body through the reader.
        expect(read, "the read of the body").toHaveBeenCalled();
        const reached = await errorsReachingProcess(async () => {
          await advanceTo(100);
        });

        const error = rejectionNow(call, TimeoutError);
        expect(cancel, "the cancel of the reader").toHaveBeenCalled();
        expect(reached).toEqual([]);
        expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
      },
    );

    // A timer left armed after request() settled would abort init.signal,
    // and could log a timeout on top of the outcome. A request with no
    // init.signal at all has nothing to abort: the cases above check that a
    // timeout gives it one.
    describe("once request() has settled", () => {
      it("should leave init.signal alone, and log nothing more, after returning a 200", async () => {
        const logger = createMockLogger();
        const answer = new Response(null, { status: 200 });
        const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(answer);
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const response = await client.get(MARKED_PATH, { timeout: 100 });
        await advanceTo(10_100);

        expect(response).toBe(answer);
        expect(initSentTo(fetchImpl).signal?.aborted ?? false).toBe(false);
        expect(logCallsOf(logger)).toStrictEqual([
          [
            "debug",
            "HTTP response received.",
            { method: "GET", url: REDUCED_URL, status: 200 },
          ],
        ]);
      });

      it("should leave init.signal alone, and log nothing more, after rejecting with an HttpResponseError", async () => {
        const logger = createMockLogger();
        const fetchImpl = vi
          .fn<FetchImpl>()
          .mockResolvedValue(new Response("body", { status: 500 }));
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const error = await rejectionOf(
          client.get(MARKED_PATH, { timeout: 100, throwOnError: true }),
          HttpResponseError,
        );
        await advanceTo(10_100);

        expect(initSentTo(fetchImpl).signal?.aborted ?? false).toBe(false);
        expect(logCallsOf(logger)).toStrictEqual([
          [
            "warn",
            "HTTP response with an error status.",
            { method: "GET", url: REDUCED_URL, status: 500, error },
          ],
        ]);
      });

      it("should leave init.signal alone, and log nothing more, after rejecting with a NetworkError", async () => {
        const logger = createMockLogger();
        const fetchImpl = vi
          .fn<FetchImpl>()
          .mockRejectedValue(new TypeError("fetch failed"));
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const error = await rejectionOf(
          client.get(MARKED_PATH, { timeout: 100 }),
          NetworkError,
        );
        await advanceTo(10_100);

        expect(initSentTo(fetchImpl).signal?.aborted ?? false).toBe(false);
        expect(logCallsOf(logger)).toStrictEqual([
          [
            "warn",
            "HTTP request got no response.",
            { method: "GET", url: REDUCED_URL, error },
          ],
        ]);
      });
    });

    // request() does not wait for fetchImpl past the timeout: what fetchImpl
    // does at 200 ms is dropped, and logged by nobody.
    describe("a fetchImpl that settles after the timeout", () => {
      /** Ignores init.signal, and settles at 200 ms as `settle` says. */
      function createLateFetch(
        settle: (
          resolve: (response: Response) => void,
          reject: (reason: unknown) => void,
        ) => void,
      ) {
        return vi.fn<FetchImpl>(
          () =>
            new Promise<Response>((resolve, reject) => {
              setTimeout(() => {
                settle(resolve, reject);
              }, 200);
            }),
        );
      }

      it("should get the TimeoutError at 100 ms, then cancel the body of the Response it resolves with at 200 ms, and log nothing more", async () => {
        const cancel = vi.fn();
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createLateFetch((resolve) => {
            resolve(new Response(new ReadableStream({ cancel })));
          }),
          logger,
        });

        const call = track(client.get(MARKED_PATH, { timeout: 100 }));
        await advanceTo(100);
        const error = rejectionNow(call, TimeoutError);
        const reached = await errorsReachingProcess(async () => {
          await advanceTo(200);
        });

        expect(cancel).toHaveBeenCalled();
        expect(reached).toEqual([]);
        expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
      });

      it.each<{
        late: string;
        settle: (
          resolve: (response: Response) => void,
          reject: (reason: unknown) => void,
        ) => void;
      }>([
        {
          late: "rejects",
          settle: (_resolve, reject) => {
            reject(new TypeError("fetch failed"));
          },
        },
        {
          late: "resolves with undefined",
          settle: (resolve) => {
            resolve(undefined as unknown as Response);
          },
        },
        {
          late: "resolves with a Response whose body is locked",
          settle: (resolve) => {
            const response = new Response(createReadableStream("late"));
            // The stub takes a reader: cancelling the body now rejects.
            response.body?.getReader();
            resolve(response);
          },
        },
      ])(
        "should get the TimeoutError at 100 ms, then let nothing reach process, and log nothing more, when it $late at 200 ms",
        async ({ settle }) => {
          const logger = createMockLogger();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl: createLateFetch(settle),
            logger,
          });

          const call = track(client.get(MARKED_PATH, { timeout: 100 }));
          await advanceTo(100);
          const error = rejectionNow(call, TimeoutError);
          const reached = await errorsReachingProcess(async () => {
            await advanceTo(200);
          });

          expect(reached).toEqual([]);
          expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
        },
      );

      // The body is cancelled by its shape, not by the class of the value:
      // the Response of npm undici is another class than the global one.
      it("should cancel the body of a plain object it resolves with at 200 ms, not a Response, whose body has a cancel callback, and log nothing more", async () => {
        const cancel = vi.fn();
        const late = { body: new ReadableStream({ cancel }) };
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createLateFetch((resolve) => {
            resolve(late as unknown as Response);
          }),
          logger,
        });

        const call = track(client.get(MARKED_PATH, { timeout: 100 }));
        await advanceTo(100);
        const error = rejectionNow(call, TimeoutError);
        const reached = await errorsReachingProcess(async () => {
          await advanceTo(200);
        });

        expect(late).not.toBeInstanceOf(Response);
        expect(cancel).toHaveBeenCalled();
        expect(reached).toEqual([]);
        expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
      });

      it.each<{ late: string; value: unknown }>([
        {
          late: "an object whose body getter throws",
          value: {
            get body(): never {
              throw new Error("The body getter threw");
            },
          },
        },
        {
          late: "an object whose body.cancel is not a function",
          value: { body: { cancel: "not a function" } },
        },
      ])(
        "should get the TimeoutError at 100 ms, then let nothing reach process, and log nothing more, when it resolves with $late at 200 ms",
        async ({ value }) => {
          const logger = createMockLogger();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl: createLateFetch((resolve) => {
              resolve(value as Response);
            }),
            logger,
          });

          const call = track(client.get(MARKED_PATH, { timeout: 100 }));
          await advanceTo(100);
          const error = rejectionNow(call, TimeoutError);
          const reached = await errorsReachingProcess(async () => {
            await advanceTo(200);
          });

          expect(reached).toEqual([]);
          expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
        },
      );
    });

    // The outcome comes from the client's own timer and the caller's signal,
    // never from the name of what fetchImpl rejected with: a fetchImpl with
    // a signal of its own rejects with these.
    it.each(["TimeoutError", "AbortError"])(
      "should reject a DOMException named %s with a NetworkError, and log once, at warn, while neither the timeout passed nor the signal aborted",
      async (name) => {
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: vi
            .fn<FetchImpl>()
            .mockRejectedValue(new DOMException("The operation failed.", name)),
          logger,
        });

        const error = await rejectionOf(
          client.get(MARKED_PATH, {
            timeout: 10_000,
            signal: new AbortController().signal,
          }),
          NetworkError,
        );

        expect(error.cause).toStrictEqual({ name });
        expect(logCallsOf(logger)).toStrictEqual([
          [
            "warn",
            "HTTP request got no response.",
            { method: "GET", url: REDUCED_URL, error },
          ],
        ]);
      },
    );
  });

  // The client reads the signal's `aborted` and `reason`, listens to its
  // abort event, and passes the reason on as it is, unlogged.
  describe("the caller's signal", () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each<{ call: string; abort: (controller: AbortController) => unknown }>([
      {
        call: 'abort(new Error("stop"))',
        abort: (controller) => {
          const reason = new Error("stop");
          controller.abort(reason);
          return reason;
        },
      },
      {
        call: 'abort("stop")',
        abort: (controller) => {
          controller.abort("stop");
          return "stop";
        },
      },
      {
        // Aborts with a DOMException named AbortError.
        call: "abort()",
        abort: (controller) => {
          controller.abort();
          const reason: unknown = controller.signal.reason;
          return reason;
        },
      },
    ])(
      "should reject with the very reason of $call during the call, neither a NetworkError nor a TimeoutError",
      async ({ abort }) => {
        const controller = new AbortController();
        const fetchImpl = createPendingFetch();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl,
          logger: createMockLogger(),
        });

        const call = track(
          client.get(MARKED_PATH, { signal: controller.signal }),
        );
        await flush();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const expected = abort(controller);
        await flush();

        const reason = reasonNow(call);
        expect(reason).toBe(expected);
        expect(reason).not.toBeInstanceOf(NetworkError);
        expect(reason).not.toBeInstanceOf(TimeoutError);
      },
    );

    it("should log an abort once, at debug, with the method and the reduced URL, and no reason", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createPendingFetch(),
        logger,
      });

      const call = track(
        client.get(MARKED_PATH, { signal: controller.signal }),
      );
      await flush();
      controller.abort(reason);
      await flush();

      expect(reasonNow(call)).toBe(reason);
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    // With no timer to race fetchImpl against, the client still races it
    // against the signal: left to a fetchImpl that ignores it, the call would
    // stay pending.
    it("should reject with the very reason, and log once, at debug, with timeout: false on the client and a fetchImpl that ignores the signal", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const fetchImpl = createPendingFetch();
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl,
        logger,
        timeout: false,
      });

      const call = track(
        client.get(MARKED_PATH, { signal: controller.signal }),
      );
      await flush();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      await flush();

      expect(reasonNow(call)).toBe(reason);
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    it("should reject with the very reason when every trap of it throws, and log once, at debug", async () => {
      const reason = createTrapThrowingProxy();
      // The premise: resolving a promise with it reads its `then`, and
      // throws.
      expect(() => {
        Reflect.get(reason, "then");
      }).toThrow("The get trap threw");
      const controller = new AbortController();
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createPendingFetch(),
        logger,
      });

      const sent = client.get(MARKED_PATH, { signal: controller.signal });
      const call = track(sent);
      await flush();
      controller.abort(reason);
      await flush();

      expect(call().state, "the state of the call").toBe("rejected");
      // Taken with try/await/catch, not with reasonOf: a `.then` handler that
      // returned it would resolve a promise with it, which calls its get
      // trap.
      let rejection: unknown;
      try {
        await sent;
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBe(reason);
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    it("should reject with the reason of a signal already aborted, with no call, and log once, at debug", async () => {
      const reason = new Error("stop");
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

      const rejection = await reasonOf(
        client.get(MARKED_PATH, { signal: AbortSignal.abort(reason) }),
      );

      expect(rejection).toBe(reason);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    it("should reject with the very reason of a signal already aborted when every trap of it throws, with no call, and log once, at debug", async () => {
      const reason = createTrapThrowingProxy();
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

      const sent = client.get(MARKED_PATH, {
        signal: AbortSignal.abort(reason),
      });
      const call = track(sent);
      await flush();

      expect(call().state, "the state of the call").toBe("rejected");
      // Taken with try/await/catch, not with reasonOf: a `.then` handler that
      // returned it would resolve a promise with it, which calls its get
      // trap.
      let rejection: unknown;
      try {
        await sent;
      } catch (error) {
        rejection = error;
      }
      // The same check as toBe, whose failure message would print the proxy,
      // and fail on its traps instead of showing the rejection.
      expect(rejection).toSatisfy(
        (value) => value === reason,
        "the very proxy",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    // The caller's errors come first: a signal checked before them would
    // reject with its reason.
    describe("already aborted, behind a caller's error", () => {
      const ABORTED = AbortSignal.abort(new Error("stop"));

      it("should reject a timeout of 0 with the TypeError of the timeout, with no call and no log", async () => {
        const fetchImpl = createMockFetch(200);
        const logger = createMockLogger();
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

        const error = await rejectionOf(
          client.get(MARKED_PATH, { timeout: 0, signal: ABORTED }),
          TypeError,
        );

        expect(error.message).toBe(
          "Expected a timeout in milliseconds, an integer from 1 to 2147483647, or false",
        );
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(logCallsOf(logger)).toEqual([]);
      });
    });

    // The types require an AbortSignal, and the client does not check it:
    // AbortSignal.any() throws on anything else. No timer may outlive that
    // throw: one left running for the whole timeout keeps the process alive.
    it("should reject a signal that is not an AbortSignal with a TypeError, with no call, no log and no timer left, with timeout: 100", async () => {
      const fetchImpl = createMockFetch(200);
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });
      expect(vi.getTimerCount(), "the timers before the call").toBe(0);

      await rejectionOf(
        client.get(MARKED_PATH, {
          signal: { aborted: false } as unknown as AbortSignal,
          timeout: 100,
        }),
        TypeError,
      );

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toEqual([]);
      expect(vi.getTimerCount(), "the timers left").toBe(0);
    });

    // Without a timeout too: the signal goes through AbortSignal.any() alone,
    // before fetchImpl is called. A fetchImpl called with it would reject,
    // and nothing would handle that rejection: it would reach process, which
    // ends a Node process by default.
    it("should reject a signal that is not an AbortSignal with a TypeError, with no call, no log and nothing reaching process, with timeout: false", async () => {
      // A plain function that records its calls, not a vi.fn: a vi.fn
      // handles the rejection of a promise it returns, to record how it
      // settled, so that rejection could never reach process.
      const called = vi.fn<(url: URL, init: FetchInit) => void>();
      const fetchImpl: FetchImpl = (url, init) => {
        called(url, init);
        return Promise.reject(new TypeError("fetch failed"));
      };
      const logger = createMockLogger();
      const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl, logger });

      const reached = await errorsReachingProcess(async () => {
        await rejectionOf(
          client.get(MARKED_PATH, {
            signal: { aborted: false } as unknown as AbortSignal,
            timeout: false,
          }),
          TypeError,
        );
      });

      expect(called, "the calls to fetchImpl").not.toHaveBeenCalled();
      expect(logCallsOf(logger)).toEqual([]);
      expect(reached).toEqual([]);
    });

    it("should reject with the very reason when the caller aborts during the read of an error body, and log once, at debug", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const logger = createMockLogger();
      const answer = new Response(createEndlessStream(), { status: 500 });
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi.fn<FetchImpl>().mockResolvedValue(answer),
        logger,
      });

      const call = track(
        client.get(MARKED_PATH, {
          signal: controller.signal,
          throwOnError: true,
        }),
      );
      await flush();
      // The premise: the client is reading the body.
      expect(answer.bodyUsed).toBe(true);
      controller.abort(reason);
      await flush();

      expect(reasonNow(call)).toBe(reason);
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    // The read that the abort ended is cancelled, as at the timeout. The
    // reason goes to the caller alone: the body's source never sees it.
    it("should cancel the read of an error body when the caller aborts, with no reason, not the caller's, with timeout: false on the client", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const cancel = vi.fn<(reason: unknown) => void>();
      const answer = new Response(createEndlessStream(cancel), { status: 500 });
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi.fn<FetchImpl>().mockResolvedValue(answer),
        logger: createMockLogger(),
        timeout: false,
      });

      const call = track(
        client.get(MARKED_PATH, {
          signal: controller.signal,
          throwOnError: true,
        }),
      );
      await flush();
      // The premise: the client is reading the body.
      expect(answer.bodyUsed).toBe(true);
      controller.abort(reason);
      await flush();

      expect(reasonNow(call)).toBe(reason);
      expect(cancel).toHaveBeenCalled();
      const cancelledWith = cancel.mock.calls[0]?.[0];
      expect(cancelledWith, "the reason of the cancel").not.toBe(reason);
      expect(cancelledWith, "the reason of the cancel").toBe(undefined);
    });

    // The cancel runs in a listener of the abort, as at the timeout: a cancel
    // that throws there is dropped, not rethrown as an uncaughtException.
    it("should reject with the very reason, let nothing reach process, and log once, at debug, when the caller aborts and the cancel of the reader of an error body throws, with timeout: false on the client", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const cancel = vi.fn(() => {
        throw new Error("The cancel threw");
      });
      const { answer, read } = createAnswerWithReader(cancel);
      expect(answer).not.toBeInstanceOf(Response);
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi
          .fn<FetchImpl>()
          .mockResolvedValue(answer as unknown as Response),
        logger,
        timeout: false,
      });

      const call = track(
        client.get(MARKED_PATH, {
          signal: controller.signal,
          throwOnError: true,
        }),
      );
      await flush();
      // The premise: the client is reading the body through the reader.
      expect(read, "the read of the body").toHaveBeenCalled();
      const reached = await errorsReachingProcess(async () => {
        controller.abort(reason);
        await flush();
      });

      expect(reasonNow(call)).toBe(reason);
      expect(cancel, "the cancel of the reader").toHaveBeenCalled();
      expect(reached).toEqual([]);
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    // An abort that came before the read of the error body fires no event
    // during it: the read checks the signal when it starts. The status getter
    // aborts once fetchImpl has resolved, before the client reads the body;
    // a read that only listened would wait for the endless body.
    it("should reject with the very reason, cancel the read with no reason, and log once, at debug, when the caller aborts between the response and the read of its error body", async () => {
      const reason = new Error("stop");
      const controller = new AbortController();
      const cancel = vi.fn<(reason: unknown) => void>();
      const answer = {
        get status() {
          controller.abort(reason);
          return 500;
        },
        headers: new Headers(),
        body: createEndlessStream(cancel),
      };
      expect(answer).not.toBeInstanceOf(Response);
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi
          .fn<FetchImpl>()
          .mockResolvedValue(answer as unknown as Response),
        logger,
        timeout: false,
      });

      const call = track(
        client.get(MARKED_PATH, {
          signal: controller.signal,
          throwOnError: true,
        }),
      );
      await flush();
      // The premise: the client read the status, which aborted.
      expect(controller.signal.aborted, "aborted by the status getter").toBe(
        true,
      );

      expect(reasonNow(call)).toBe(reason);
      expect(cancel).toHaveBeenCalled();
      expect(cancel.mock.calls[0]?.[0], "the reason of the cancel").toBe(
        undefined,
      );
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    it("should reject with the very reason when every trap of it throws, when the caller aborts during the read of an error body, and log once, at debug", async () => {
      const reason = createTrapThrowingProxy();
      const controller = new AbortController();
      const logger = createMockLogger();
      const answer = new Response(createEndlessStream(), { status: 500 });
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: vi.fn<FetchImpl>().mockResolvedValue(answer),
        logger,
      });

      const sent = client.get(MARKED_PATH, {
        signal: controller.signal,
        throwOnError: true,
      });
      const call = track(sent);
      await flush();
      // The premise: the client is reading the body.
      expect(answer.bodyUsed).toBe(true);
      controller.abort(reason);
      await flush();

      expect(call().state, "the state of the call").toBe("rejected");
      // Taken with try/await/catch, and checked with toSatisfy, as above.
      let rejection: unknown;
      try {
        await sent;
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toSatisfy(
        (value) => value === reason,
        "the very proxy",
      );
      expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
    });

    // init.signal keeps following the caller's signal, so that it covers the
    // body the caller reads from the returned Response.
    describe("after request() returned a 200", () => {
      it("should abort init.signal with the very reason when the caller aborts, with timeout: false", async () => {
        const reason = new Error("stop");
        const controller = new AbortController();
        const fetchImpl = vi
          .fn<FetchImpl>()
          .mockResolvedValue(new Response("body", { status: 200 }));
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

        await client.get(MARKED_PATH, {
          signal: controller.signal,
          timeout: false,
        });
        const { signal } = initSentTo(fetchImpl);
        expect(signal).toBeInstanceOf(AbortSignal);
        controller.abort(reason);

        expect(signal?.aborted).toBe(true);
        expect(signal?.reason).toBe(reason);
      });

      it("should leave init.signal alone at 10 s, then abort it with the very reason when the caller aborts, with timeout: 100", async () => {
        const reason = new Error("stop");
        const controller = new AbortController();
        const fetchImpl = vi
          .fn<FetchImpl>()
          .mockResolvedValue(new Response("body", { status: 200 }));
        const client = new HttpClient({ baseUrl: BASE_URL, fetchImpl });

        await client.get(MARKED_PATH, {
          signal: controller.signal,
          timeout: 100,
        });
        await advanceTo(10_000);
        const { signal } = initSentTo(fetchImpl);
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted, "aborted at 10 s").toBe(false);
        controller.abort(reason);

        expect(signal?.aborted).toBe(true);
        expect(signal?.reason).toBe(reason);
      });
    });

    it.each<{
      setup: string;
      client: Pick<HttpClientOptions, "timeout">;
      request: Pick<RequestOptions, "timeout">;
    }>([
      {
        setup: "timeout: false on the client",
        client: { timeout: false },
        request: {},
      },
      {
        setup: "timeout: false on the request alone",
        client: {},
        request: { timeout: false },
      },
    ])(
      "should pass no signal key in init, with no signal and $setup",
      async ({ client: clientOptions, request }) => {
        const fetchImpl = vi
          .fn<FetchImpl>()
          .mockResolvedValue(new Response(null, { status: 200 }));
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl,
          ...clientOptions,
        });

        await client.get(MARKED_PATH, request);

        expect(initSentTo(fetchImpl)).not.toHaveProperty("signal");
      },
    );

    // The first of the abort and the timeout decides: once request() has
    // settled, the other changes nothing.
    describe("with a signal and a timeout", () => {
      it("should reject with the reason when the caller aborts at 50 ms, and log only the abort, still at 10 s", async () => {
        const reason = new Error("stop");
        const controller = new AbortController();
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createPendingFetch(),
          logger,
        });

        const call = track(
          client.get(MARKED_PATH, { signal: controller.signal, timeout: 100 }),
        );
        await advanceTo(50);
        controller.abort(reason);
        await flush();

        expect(reasonNow(call)).toBe(reason);
        await advanceTo(10_000);
        expect(logCallsOf(logger)).toStrictEqual([ABORTED_LOG]);
      });

      it("should reject with a TimeoutError at 100 ms, and log only the timeout, after the caller aborts", async () => {
        const controller = new AbortController();
        const logger = createMockLogger();
        const client = new HttpClient({
          baseUrl: BASE_URL,
          fetchImpl: createPendingFetch(),
          logger,
        });

        const call = track(
          client.get(MARKED_PATH, { signal: controller.signal, timeout: 100 }),
        );
        await advanceTo(100);
        const error = rejectionNow(call, TimeoutError);
        controller.abort(new Error("stop"));
        await flush();

        expect(logCallsOf(logger)).toStrictEqual([timedOutLog(error)]);
      });
    });
  });

  // One log per outcome: a test counts the calls on the four log methods
  // together.
  describe("logs", () => {
    it("should log a returned 200 once, at debug", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createResponseFetch(new Response(null, { status: 200 })),
        logger,
      });

      await client.get("/users");

      expect(logCallsOf(logger)).toEqual([
        [
          "debug",
          "HTTP response received.",
          { method: "GET", url: "https://api.example.com/users", status: 200 },
        ],
      ]);
    });

    it("should log a returned 500 without throwOnError once, at debug", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createResponseFetch(new Response(null, { status: 500 })),
        logger,
      });

      await client.get("/users");

      expect(logCallsOf(logger)).toEqual([
        [
          "debug",
          "HTTP response received.",
          { method: "GET", url: "https://api.example.com/users", status: 500 },
        ],
      ]);
    });

    it("should log a 404 with throwOnError once, at warn, with the rejected error", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createResponseFetch(new Response(null, { status: 404 })),
        logger,
      });

      const error = await reasonOf(
        client.get("/users", { throwOnError: true }),
      );

      expect(logCallsOf(logger)).toEqual([
        [
          "warn",
          "HTTP response with an error status.",
          {
            method: "GET",
            url: "https://api.example.com/users",
            status: 404,
            error: expect.any(HttpResponseError),
          },
        ],
      ]);
      expect(logger.warn.mock.calls[0]?.[1]?.error).toBe(error);
    });

    it("should log a rejection of fetchImpl once, at warn, with the rejected error", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createRejectingFetch(new TypeError("Failed to fetch")),
        logger,
      });

      const error = await reasonOf(client.get("/users"));

      expect(logCallsOf(logger)).toEqual([
        [
          "warn",
          "HTTP request got no response.",
          {
            method: "GET",
            url: "https://api.example.com/users",
            error: expect.any(NetworkError),
          },
        ],
      ]);
      expect(logger.warn.mock.calls[0]?.[1]?.error).toBe(error);
    });

    describe("no marker reaches the logs", () => {
      const MARKERS = [
        "alice",
        "hunter2",
        "q-secret",
        "frag-secret",
        "query-secret",
        "body-secret",
        "header-secret",
      ];

      // A request with a timeout times out at 100 ms; the others settle at
      // once.
      beforeEach(() => {
        vi.useFakeTimers({ now: 0 });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each<{
        outcome: string;
        createFetch: () => FetchImpl;
        throwOnError: boolean;
        options?: Pick<RequestOptions, "timeout" | "signal">;
      }>([
        {
          outcome: "answered 200",
          createFetch: () =>
            createResponseFetch(new Response(null, { status: 200 })),
          throwOnError: false,
        },
        {
          outcome: "answered 404 with throwOnError",
          createFetch: () =>
            createResponseFetch(
              new Response("body-secret", {
                status: 404,
                headers: { "x-header": "header-secret" },
              }),
            ),
          throwOnError: true,
        },
        {
          // The markers are in a message, in own fields, and so in the
          // stacks, which start with the message.
          outcome: "rejected",
          createFetch: () =>
            createRejectingFetch(
              new TypeError(
                "Request cannot be constructed from a URL that includes credentials: https://alice:hunter2@api.example.com/v1/users?token=q-secret&q=query-secret#frag-secret",
                {
                  cause: Object.assign(new Error("Response Error"), {
                    name: "ResponseError",
                    code: "UND_ERR_RESPONSE",
                    headers: { "set-cookie": "sid=header-secret" },
                    body: { token: "body-secret" },
                  }),
                },
              ),
            ),
          throwOnError: false,
        },
        {
          outcome: "timed out",
          createFetch: createPendingFetch,
          throwOnError: false,
          options: { timeout: 100 },
        },
        {
          // An Error's message is not in its JSON, so the marker is also in
          // an own enumerable field: a logged reason would show it. The one
          // in the message shows a logged message or string of the reason.
          outcome: "aborted",
          createFetch: createPendingFetch,
          throwOnError: false,
          options: {
            signal: AbortSignal.abort(
              Object.assign(new Error("body-secret"), { token: "body-secret" }),
            ),
          },
        },
      ])(
        "should log the reduced URL and no marker of a request $outcome",
        async ({ createFetch, throwOnError, options }) => {
          const logger = createMockLogger();
          const client = new HttpClient({
            baseUrl: BASE_URL,
            fetchImpl: createFetch(),
            logger,
          });

          // Whether it resolves or rejects is for the cases above: this one
          // reads the logs, once the request has settled. Firefox reads a
          // body later than the other runtimes, after the clock has reached
          // 100 ms.
          const settled = client
            .get("/v1/users?token=q-secret#frag-secret", {
              query: { q: "query-secret" },
              throwOnError,
              ...options,
            })
            .catch(() => undefined);
          await advanceTo(100);
          await settled;

          const calls = logCallsOf(logger);
          expect(calls).not.toEqual([]);
          for (const [, , metadata] of calls) {
            expect(metadata).toHaveProperty("url", REDUCED_URL);
          }

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
        },
      );
    });

    it("should call the logger's child once, with the HttpClient context and no baseUrl", async () => {
      const logger = createMockLogger();
      const client = new HttpClient({
        baseUrl: BASE_URL,
        fetchImpl: createMockFetch(200),
        logger,
      });

      await client.get("/users");

      expect(logger.child).toHaveBeenCalledTimes(1);
      const options = logger.child.mock.calls[0]?.[0];
      expect(options).toHaveProperty("context", "HttpClient");
      expect(options?.metadata ?? {}).not.toHaveProperty("baseUrl");
    });
  });

  describe("convenience methods", () => {
    let mockFetch: ReturnType<typeof createMockFetch>;
    let client: HttpClient;

    beforeEach(() => {
      mockFetch = createMockFetch(200, { ok: true });
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });
    });

    it("get() should use GET method", async () => {
      await client.get("/users");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("post() should use POST method with body", async () => {
      const body = JSON.stringify({ name: "test" });
      await client.post("/users", body);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "POST", body }),
      );
    });

    it("put() should use PUT method with body", async () => {
      const body = JSON.stringify({ name: "updated" });
      await client.put("/users/1", body);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "PUT", body }),
      );
    });

    it("patch() should use PATCH method with body", async () => {
      const body = JSON.stringify({ name: "patched" });
      await client.patch("/users/1", body);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "PATCH", body }),
      );
    });

    it("delete() should use DELETE method", async () => {
      await client.delete("/users/1");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("head() should use HEAD method", async () => {
      await client.head("/users");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "HEAD" }),
      );
    });

    it("options() should use OPTIONS method", async () => {
      await client.options("/users");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: "OPTIONS" }),
      );
    });

    it("convenience methods should support query parameters", async () => {
      await client.get("/users", { query: { page: 1 } });
      const calledUrl = mockFetch.mock.calls[0]![0] as URL;
      expect(calledUrl.searchParams.get("page")).toBe("1");
    });

    it("convenience methods should support throwOnError", async () => {
      mockFetch = createMockFetch(404);
      client = new HttpClient({
        baseUrl: "https://api.example.com",
        fetchImpl: mockFetch,
      });

      await expect(
        client.get("/missing", { throwOnError: true }),
      ).rejects.toBeInstanceOf(HttpResponseError);
    });
  });

  describe("stream bodies", () => {
    describe("with a stubbed fetchImpl", () => {
      let mockFetch: ReturnType<typeof createMockFetch>;
      let client: HttpClient;

      beforeEach(() => {
        mockFetch = createMockFetch(200, { ok: true });
        client = new HttpClient({
          baseUrl: "https://api.example.com",
          fetchImpl: mockFetch,
        });
      });

      it('should pass duplex: "half" with a ReadableStream body', async () => {
        await client.post("/upload", createReadableStream("hello"));

        expect(mockFetch.mock.calls[0]?.[1]).toHaveProperty("duplex", "half");
      });

      it('should pass duplex: "half" with an async iterable body', async () => {
        await client.request("/upload", {
          body: createAsyncChunks(
            "hel",
            "lo",
          ) as unknown as RequestOptions["body"],
        });

        expect(mockFetch.mock.calls[0]?.[1]).toHaveProperty("duplex", "half");
      });

      it("should not pass duplex without a body", async () => {
        await client.get("/users");

        expect(mockFetch.mock.calls[0]?.[1]).not.toHaveProperty("duplex");
      });

      it.each<[string, NonNullable<RequestOptions["body"]>]>([
        ["a string", "hello"],
        ["a Uint8Array", encoder.encode("hello")],
        ["an ArrayBuffer", encoder.encode("hello").buffer],
        ["a Blob", new Blob(["hello"])],
        ["a FormData", new FormData()],
        ["a URLSearchParams", new URLSearchParams({ greeting: "hello" })],
      ])("should not pass duplex with %s body", async (_, body) => {
        await client.post("/upload", body);

        expect(mockFetch.mock.calls[0]?.[1]).not.toHaveProperty("duplex");
      });
    });
  });
});
