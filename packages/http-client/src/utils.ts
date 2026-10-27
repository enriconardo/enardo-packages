import type { HeadersInput, HeadersInputRecord } from "./header";
import type { HttpBody } from "./http-client.types";

type HeaderEntry = [name: string, value: HeadersInputRecord[string]];

// Credentials, the query string and the fragment can carry secrets: errors
// show the origin and the path only.
export function redactUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

// The join keeps the origin and the path of the base, and nothing else:
// credentials, a query string or a fragment would be lost without a word, so
// they are refused instead. Any scheme but http and https is refused too: the
// client makes HTTP requests, and the origin of most others is "null". The
// messages hold no part of the URL, which may hold credentials.
export function toBasePrefix(baseUrl: string | URL): string {
  // A baseUrl that does not parse throws the TypeError of new URL(), as a
  // request's URL does.
  const url = new URL(baseUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Expected an http or https baseUrl");
  }
  if (hasCredentials(url)) {
    throw new TypeError("Expected a baseUrl without credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new TypeError(
      "Expected a baseUrl without a query string or a fragment",
    );
  }

  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

export function hasCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

export function toHeaders(input?: HeadersInput): Headers {
  if (!input) return new Headers();
  if (input instanceof Headers) return new Headers(input);

  const headers = new Headers();

  // As in native Headers, anything iterable is a sequence of pairs, even an
  // object that compiles as a record: a string index signature does not see
  // its Symbol.iterator. So the elements are checked, not trusted.
  const entries: Iterable<HeaderEntry> = isIterable(input)
    ? Array.from(input, toHeaderEntry)
    : Object.entries(input);

  for (const [name, value] of entries) {
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(name, v));
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }

  return headers;
}

// Fetch reads such a body as a stream, and then requires `duplex`. Node's
// fetch streams any async iterable; `instanceof` also catches a
// ReadableStream that is not async-iterable.
export function isStreamBody(body: HttpBody): boolean {
  return (
    body instanceof ReadableStream ||
    (typeof body === "object" && Symbol.asyncIterator in body)
  );
}

function isIterable(input: object): input is Iterable<unknown> {
  return (
    typeof (input as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  );
}

function toHeaderEntry(element: unknown): HeaderEntry {
  if (isPair(element)) {
    const [name, value] = element;
    if (typeof name === "string" && isHeaderValue(value)) {
      return [name, value];
    }
  }

  throw new TypeError("Expected a [name, value] header pair");
}

function isPair(element: unknown): element is readonly [unknown, unknown] {
  return Array.isArray(element) && element.length === 2;
}

function isHeaderValue(value: unknown): value is HeadersInputRecord[string] {
  return (
    value === undefined ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}
