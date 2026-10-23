/**
 * Where the readers read: `process.env`, `import.meta.env`, or any record.
 * It needs an index signature, which both of those have.
 */
export type EnvSource = Readonly<Record<string, unknown>>;

/**
 * The readers of one source. `string`, `number` and `bool` return the value
 * or `undefined` when the variable is unset; the `require*` ones throw
 * instead. A value of the wrong type always throws.
 */
export interface EnvReader {
  /** The value as it is, or `undefined` if unset. Throws `EnvMalformedError` on a non-string. */
  string(key: string): string | undefined;
  /** A decimal number (a finite number value as it is), or `undefined` if unset. Throws `EnvMalformedError` on anything else. */
  number(key: string): number | undefined;
  /** `true`/`1`/`yes` or `false`/`0`/`no` (any case; a boolean value as it is), or `undefined` if unset. Throws `EnvMalformedError` on anything else. */
  bool(key: string): boolean | undefined;
  /** As `string`, but throws `EnvMissingError` if unset. */
  requireString(key: string): string;
  /** As `number`, but throws `EnvMissingError` if unset. */
  requireNumber(key: string): number;
  /** As `bool`, but throws `EnvMissingError` if unset. */
  requireBool(key: string): boolean;
}
