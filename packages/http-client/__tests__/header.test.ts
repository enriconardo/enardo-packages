import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "~/index";
import type {
  HeadersInput,
  HeadersInputIterable,
  HeadersInputRecord,
} from "~/index";

// The client turns a HeadersInput into the Headers it passes to fetchImpl:
// sending a request through a stub, and reading what the stub received, is
// the public path from one to the other.
async function headersOf(headers: HeadersInput): Promise<Headers> {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const client = new HttpClient({ fetchImpl });

  await client.request("https://api.example.com/users", { headers });

  const received = fetchImpl.mock.calls[0]?.[1]?.headers;
  expect(received).toBeInstanceOf(Headers);
  return received as Headers;
}

// Anchored: the message is exactly this, not a longer one that contains it.
const PAIR_ERROR = /^Expected a \[name, value\] header pair$/;

describe("HeadersInput", () => {
  it("should set no headers when input is undefined", async () => {
    expect([...(await headersOf(undefined)).entries()]).toEqual([]);
  });

  it("should set no headers when input is null", async () => {
    expect([...(await headersOf(null)).entries()]).toEqual([]);
  });

  it("should set the headers of a Record", async () => {
    const headers = await headersOf({
      "x-custom": "value",
      authorization: "Bearer token",
    });

    expect(headers.get("x-custom")).toBe("value");
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  // Headers joins the values of every other name, so only set-cookie shows
  // whether a string[] was set once per item or joined into one value.
  it("should set a string[] value of a Record once per item", async () => {
    const headers = await headersOf({ "set-cookie": ["a=1", "b=2"] });

    expect(headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("should skip undefined values in Record", async () => {
    const headers = await headersOf({ "x-keep": "value", "x-skip": undefined });

    expect(headers.get("x-keep")).toBe("value");
    expect(headers.has("x-skip")).toBe(false);
  });

  it("should set the headers of an iterable of entries", async () => {
    const entries: [string, string][] = [
      ["x-first", "one"],
      ["x-second", "two"],
    ];
    const headers = await headersOf(entries);

    expect(headers.get("x-first")).toBe("one");
    expect(headers.get("x-second")).toBe("two");
  });

  it("should set a string[] value of an iterable entry once per item", async () => {
    const entries: [string, string[]][] = [["set-cookie", ["a=1", "b=2"]]];
    const headers = await headersOf(entries);

    expect(headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("should skip undefined values in iterable entries", async () => {
    const entries: [string, string | undefined][] = [
      ["x-keep", "value"],
      ["x-skip", undefined],
    ];
    const headers = await headersOf(entries);

    expect(headers.get("x-keep")).toBe("value");
    expect(headers.has("x-skip")).toBe(false);
  });

  it("should set the entries of a Map", async () => {
    const headers = await headersOf(
      new Map([
        ["x-first", "one"],
        ["x-second", "two"],
      ]),
    );

    expect(headers.get("x-first")).toBe("one");
    expect(headers.get("x-second")).toBe("two");
  });

  it("should set only the own keys of a Record, not the inherited ones", async () => {
    const record: HeadersInputRecord = { "x-own": "own" };
    Object.setPrototypeOf(record, { "x-inherited": "inherited" });

    const headers = await headersOf(record);

    expect(headers.get("x-own")).toBe("own");
    expect(headers.has("x-inherited")).toBe(false);
  });

  // The types reject every one of these: only a cast or a JavaScript caller
  // can pass them.
  it.each<{ element: unknown }>([
    { element: ["x-only-name"] },
    { element: ["a", "b", "c"] },
    { element: "ab" },
    { element: [1, "v"] },
    { element: ["x-n", 1] },
    { element: ["x-a", ["a", 1]] },
  ])(
    "should reject with a TypeError for the malformed element $element",
    async ({ element }) => {
      const input = [element] as unknown as HeadersInputIterable;

      const result = headersOf(input);

      await expect(result).rejects.toThrow(TypeError);
      await expect(result).rejects.toThrow(PAIR_ERROR);
    },
  );

  it("should reject with a TypeError for a Record whose Symbol.iterator yields numbers", async () => {
    // A string index signature does not see symbol keys, so this compiles as
    // a HeadersInputRecord with no cast, and it is iterable, but not of pairs.
    const record: HeadersInputRecord = {
      *[Symbol.iterator]() {
        yield 1;
        yield 2;
      },
    };

    const result = headersOf(record);

    await expect(result).rejects.toThrow(TypeError);
    await expect(result).rejects.toThrow(PAIR_ERROR);
  });
});
