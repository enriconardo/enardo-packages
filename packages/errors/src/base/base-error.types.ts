/**
 * Structured data about an error, for logs and for code that handles it.
 *
 * A subclass can narrow it with `declare readonly details: MyDetails`. An
 * interface used as `MyDetails` must extend `Record<string, unknown>`: only
 * type aliases get an implicit index signature.
 */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Options for constructing a {@link BaseError}.
 *
 * Extends the native {@link ErrorOptions}, which brings `cause`. There is no
 * `name`: each concrete class declares its own.
 */
export interface BaseErrorOptions extends ErrorOptions {
  /** Machine-readable identity of the error (e.g. `"NOT_CONNECTED"`). */
  code: string;
  /** Structured data about this occurrence of the error. */
  details?: ErrorDetails;
}

/**
 * What {@link BaseError.toJSON} returns: the error's own enumerable fields,
 * plus `name`, `message`, `stack`, the serialized `errors` of an
 * `AggregateError` and a serialized `cause`.
 */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  /** A serialized error, `"[Circular]"`, or any other value as it was given. */
  readonly cause?: unknown;
  readonly [key: string]: unknown;
}

/**
 * What {@link isBaseErrorLike} proves about a value: the shape of a
 * {@link BaseError}, not its class.
 *
 * Named after `PromiseLike` and `ArrayLike`. A `BaseError` is assignable to
 * it; it is never narrowed to `BaseError` (ADR 0003).
 */
export interface BaseErrorLike {
  readonly name: string;
  readonly code: string;
  readonly details?: ErrorDetails | undefined;
}
