import { EnvMalformedError, EnvMissingError } from "./errors";
import type { EnvReader, EnvSource } from "./env.types";

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const TRUE = new Set(["true", "1", "yes"]);
const FALSE = new Set(["false", "0", "no"]);

/** The raw value, or `undefined` for a key that is unset. Reads the source at each call. */
function read(source: EnvSource, key: string): unknown {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  return value === "" ? undefined : value;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !DECIMAL.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if (TRUE.has(lower)) return true;
  if (FALSE.has(lower)) return false;
  return undefined;
}

/**
 * Binds strict readers to a source, which the caller always passes:
 * `process.env` on Node, `import.meta.env` in Vite. The source is read at
 * each call, never copied.
 *
 * An unset variable (not an own key, or `undefined` or `""`) reads as
 * `undefined`; a set one of the wrong type throws `EnvMalformedError`. The
 * `require*` readers throw `EnvMissingError` for an unset one.
 *
 * @example
 * ```ts
 * const env = createEnv(process.env);
 * const port = env.number("PORT") ?? 3000;
 * const databaseUrl = env.requireString("DATABASE_URL");
 * ```
 */
export function createEnv(source: EnvSource): EnvReader {
  function optional<T>(
    key: string,
    expected: "string" | "number" | "boolean",
    convert: (value: unknown) => T | undefined,
  ): T | undefined {
    const raw = read(source, key);
    if (raw === undefined) return undefined;
    const value = convert(raw);
    if (value === undefined) throw new EnvMalformedError(key, expected);
    return value;
  }

  function required<T>(
    key: string,
    expected: "string" | "number" | "boolean",
    convert: (value: unknown) => T | undefined,
  ): T {
    const value = optional(key, expected, convert);
    if (value === undefined) throw new EnvMissingError(key);
    return value;
  }

  const toString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  return {
    string: (key) => optional(key, "string", toString),
    number: (key) => optional(key, "number", toNumber),
    bool: (key) => optional(key, "boolean", toBool),
    requireString: (key) => required(key, "string", toString),
    requireNumber: (key) => required(key, "number", toNumber),
    requireBool: (key) => required(key, "boolean", toBool),
  };
}
