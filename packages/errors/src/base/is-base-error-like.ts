import type { BaseErrorLike } from "./base-error.types";

const BRAND = Symbol.for("@enardo/errors.BaseError");

/**
 * Whether `value` is an error of the `@enardo/*` ecosystem: it carries the
 * brand of `BaseError` and has its shape (`name` and `code` strings, `details`
 * an object or `undefined`).
 *
 * Unlike `instanceof BaseError`, it recognizes an error built by another copy
 * or another major (from 1.1.0) of this package, and one of another realm.
 * The brand proves a convention, not a provenance. `details` is read as
 * {@link ErrorDetails}, whose values are `unknown`: a class's typed `details`
 * need `instanceof` with that class.
 *
 * Returns `false` when a read throws, since it runs in error handlers.
 *
 * @example
 * ```ts
 * try {
 *   await run();
 * } catch (error) {
 *   if (isBaseErrorLike(error) && error.code === "USER_NOT_FOUND") {
 *     // ...
 *   }
 * }
 * ```
 */
export function isBaseErrorLike(value: unknown): value is BaseErrorLike {
  try {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as {
      [BRAND]?: unknown;
      name?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (candidate[BRAND] !== true) return false;
    if (typeof candidate.name !== "string") return false;
    if (typeof candidate.code !== "string") return false;
    const details = candidate.details;
    return (
      details === undefined || (typeof details === "object" && details !== null)
    );
  } catch {
    return false;
  }
}
