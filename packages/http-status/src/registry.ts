// The literal, so that isolatedDeclarations can write out its type for the
// frozen export below.
const REGISTRY = {
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,
  PROCESSING: 102,
  EARLY_HINTS: 103,

  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  MULTI_STATUS: 207,
  ALREADY_REPORTED: 208,
  IM_USED: 226,

  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  /** @deprecated RFC 9110 §15.4.6: deprecated for security reasons. */
  USE_PROXY: 305,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  /** RFC 9110 §15.5.14, formerly "Payload Too Large". */
  CONTENT_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  MISDIRECTED_REQUEST: 421,
  /** RFC 9110 §15.5.21, formerly "Unprocessable Entity". */
  UNPROCESSABLE_CONTENT: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,

  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  /** @deprecated IANA: obsoleted, RFC 2774 moved to Historic. */
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
} as const;

/**
 * Registered HTTP status codes, keyed by their reason phrase in
 * SCREAMING_SNAKE_CASE: RFC 9110 where it defines the code, otherwise the IANA
 * registry.
 *
 * Frozen at runtime and literal-typed at compile time. Codes that RFC 9110
 * reserves as "(Unused)" (306, 418) are deliberately absent.
 *
 * @example
 * ```ts
 * res.status(HTTP_STATUS.NOT_FOUND);
 * ```
 */
export const HTTP_STATUS: Readonly<typeof REGISTRY> = Object.freeze(REGISTRY);

/** Any registered status code: the closed union of the values of {@link HTTP_STATUS}. */
export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

// Derived from the first digit, so a code added to HTTP_STATUS joins its class
// type without a second list to keep in sync.
type StatusOfClass<
  C extends 1 | 2 | 3 | 4 | 5,
  S extends HttpStatus = HttpStatus,
> = S extends unknown ? (`${S}` extends `${C}${string}` ? S : never) : never;

/** Registered 1xx codes. */
export type InformationalHttpStatus = StatusOfClass<1>;
/** Registered 2xx codes. */
export type SuccessHttpStatus = StatusOfClass<2>;
/** Registered 3xx codes. */
export type RedirectionHttpStatus = StatusOfClass<3>;
/** Registered 4xx codes. */
export type ClientErrorHttpStatus = StatusOfClass<4>;
/** Registered 5xx codes. */
export type ServerErrorHttpStatus = StatusOfClass<5>;
/** Registered 4xx and 5xx codes. */
export type ErrorHttpStatus = ClientErrorHttpStatus | ServerErrorHttpStatus;
