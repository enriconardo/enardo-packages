import { HTTP_STATUS } from "./registry";
import type {
  ClientErrorHttpStatus,
  ErrorHttpStatus,
  HttpStatus,
  InformationalHttpStatus,
  RedirectionHttpStatus,
  ServerErrorHttpStatus,
  SuccessHttpStatus,
} from "./registry";

// Built from the frozen registry, so it cannot drift from it.
const REGISTERED_STATUSES: ReadonlySet<number> = new Set(
  Object.values(HTTP_STATUS),
);

function isIntegerInRange(status: number, min: number, max: number): boolean {
  return Number.isInteger(status) && status >= min && status <= max;
}

/**
 * Whether `value` is a registered status code.
 *
 * Accepts `unknown`, so it can validate untrusted input such as parsed JSON.
 */
export function isHttpStatus(value: unknown): value is HttpStatus {
  return typeof value === "number" && REGISTERED_STATUSES.has(value);
}

// Class guards answer "which class is this code in?" for any integer code,
// registered or not: RFC 9110 §15 requires treating an unknown code as the x00
// of its class. They carry no type predicate, because a range check cannot
// prove membership in the closed unions.

/** Whether `status` is an integer in 100–199, registered or not. */
export function isInformationalStatus(status: number): boolean {
  return isIntegerInRange(status, 100, 199);
}

/** Whether `status` is an integer in 200–299, registered or not. */
export function isSuccessStatus(status: number): boolean {
  return isIntegerInRange(status, 200, 299);
}

/** Whether `status` is an integer in 300–399, registered or not. */
export function isRedirectionStatus(status: number): boolean {
  return isIntegerInRange(status, 300, 399);
}

/**
 * Whether `status` is an integer in 400–499, registered or not.
 *
 * Use {@link isKnownClientErrorStatus} to narrow to {@link ClientErrorHttpStatus}.
 */
export function isClientErrorStatus(status: number): boolean {
  return isIntegerInRange(status, 400, 499);
}

/**
 * Whether `status` is an integer in 500–599, registered or not.
 *
 * Use {@link isKnownServerErrorStatus} to narrow to {@link ServerErrorHttpStatus}.
 */
export function isServerErrorStatus(status: number): boolean {
  return isIntegerInRange(status, 500, 599);
}

/**
 * Whether `status` is an integer in 400–599, registered or not.
 *
 * Use {@link isKnownErrorStatus} to narrow to {@link ErrorHttpStatus}.
 */
export function isErrorStatus(status: number): boolean {
  return isIntegerInRange(status, 400, 599);
}

/** Whether `value` is a registered 1xx code. */
export function isKnownInformationalStatus(
  value: unknown,
): value is InformationalHttpStatus {
  return isHttpStatus(value) && isInformationalStatus(value);
}

/** Whether `value` is a registered 2xx code. */
export function isKnownSuccessStatus(
  value: unknown,
): value is SuccessHttpStatus {
  return isHttpStatus(value) && isSuccessStatus(value);
}

/** Whether `value` is a registered 3xx code. */
export function isKnownRedirectionStatus(
  value: unknown,
): value is RedirectionHttpStatus {
  return isHttpStatus(value) && isRedirectionStatus(value);
}

/** Whether `value` is a registered 4xx code: `false` for 499. */
export function isKnownClientErrorStatus(
  value: unknown,
): value is ClientErrorHttpStatus {
  return isHttpStatus(value) && isClientErrorStatus(value);
}

/** Whether `value` is a registered 5xx code: `false` for 599. */
export function isKnownServerErrorStatus(
  value: unknown,
): value is ServerErrorHttpStatus {
  return isHttpStatus(value) && isServerErrorStatus(value);
}

/** Whether `value` is a registered 4xx or 5xx code. */
export function isKnownErrorStatus(value: unknown): value is ErrorHttpStatus {
  return isHttpStatus(value) && isErrorStatus(value);
}
