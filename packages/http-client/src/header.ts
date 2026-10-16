/**
 * Headers as a record. A `string[]` value sets the header once per item; an
 * `undefined` value sets nothing.
 */
export type HeadersInputRecord = Record<string, string | string[] | undefined>;

/**
 * Headers as `[name, value]` pairs, such as a `Map`, with the same value
 * rules as {@link HeadersInputRecord}. Any other element throws a
 * `TypeError`.
 */
export type HeadersInputIterable = Iterable<
  [string, string | string[] | undefined]
>;

/**
 * The headers of a request. A native `Headers` is accepted too, so the
 * headers of a fetch response can be passed through directly; the client
 * copies it.
 */
export type HeadersInput =
  Headers | HeadersInputRecord | HeadersInputIterable | null | undefined;
