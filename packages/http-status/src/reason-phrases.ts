import { isHttpStatus } from "./guards";
import { HTTP_STATUS } from "./registry";
import type { HttpStatus } from "./registry";

/**
 * RFC 9110 reason phrase of every registered status code.
 *
 * The compiler rejects a registered code without a phrase and a phrase for
 * an unregistered code.
 */
export const HTTP_REASON_PHRASES = Object.freeze({
  [HTTP_STATUS.CONTINUE]: "Continue",
  [HTTP_STATUS.SWITCHING_PROTOCOLS]: "Switching Protocols",
  [HTTP_STATUS.PROCESSING]: "Processing",
  [HTTP_STATUS.EARLY_HINTS]: "Early Hints",

  [HTTP_STATUS.OK]: "OK",
  [HTTP_STATUS.CREATED]: "Created",
  [HTTP_STATUS.ACCEPTED]: "Accepted",
  [HTTP_STATUS.NON_AUTHORITATIVE_INFORMATION]: "Non-Authoritative Information",
  [HTTP_STATUS.NO_CONTENT]: "No Content",
  [HTTP_STATUS.RESET_CONTENT]: "Reset Content",
  [HTTP_STATUS.PARTIAL_CONTENT]: "Partial Content",
  [HTTP_STATUS.MULTI_STATUS]: "Multi-Status",
  [HTTP_STATUS.ALREADY_REPORTED]: "Already Reported",
  [HTTP_STATUS.IM_USED]: "IM Used",

  [HTTP_STATUS.MULTIPLE_CHOICES]: "Multiple Choices",
  [HTTP_STATUS.MOVED_PERMANENTLY]: "Moved Permanently",
  [HTTP_STATUS.FOUND]: "Found",
  [HTTP_STATUS.SEE_OTHER]: "See Other",
  [HTTP_STATUS.NOT_MODIFIED]: "Not Modified",
  [HTTP_STATUS.USE_PROXY]: "Use Proxy",
  [HTTP_STATUS.TEMPORARY_REDIRECT]: "Temporary Redirect",
  [HTTP_STATUS.PERMANENT_REDIRECT]: "Permanent Redirect",

  [HTTP_STATUS.BAD_REQUEST]: "Bad Request",
  [HTTP_STATUS.UNAUTHORIZED]: "Unauthorized",
  [HTTP_STATUS.PAYMENT_REQUIRED]: "Payment Required",
  [HTTP_STATUS.FORBIDDEN]: "Forbidden",
  [HTTP_STATUS.NOT_FOUND]: "Not Found",
  [HTTP_STATUS.METHOD_NOT_ALLOWED]: "Method Not Allowed",
  [HTTP_STATUS.NOT_ACCEPTABLE]: "Not Acceptable",
  [HTTP_STATUS.PROXY_AUTHENTICATION_REQUIRED]: "Proxy Authentication Required",
  [HTTP_STATUS.REQUEST_TIMEOUT]: "Request Timeout",
  [HTTP_STATUS.CONFLICT]: "Conflict",
  [HTTP_STATUS.GONE]: "Gone",
  [HTTP_STATUS.LENGTH_REQUIRED]: "Length Required",
  [HTTP_STATUS.PRECONDITION_FAILED]: "Precondition Failed",
  [HTTP_STATUS.CONTENT_TOO_LARGE]: "Content Too Large",
  [HTTP_STATUS.URI_TOO_LONG]: "URI Too Long",
  [HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE]: "Unsupported Media Type",
  [HTTP_STATUS.RANGE_NOT_SATISFIABLE]: "Range Not Satisfiable",
  [HTTP_STATUS.EXPECTATION_FAILED]: "Expectation Failed",
  [HTTP_STATUS.MISDIRECTED_REQUEST]: "Misdirected Request",
  [HTTP_STATUS.UNPROCESSABLE_CONTENT]: "Unprocessable Content",
  [HTTP_STATUS.LOCKED]: "Locked",
  [HTTP_STATUS.FAILED_DEPENDENCY]: "Failed Dependency",
  [HTTP_STATUS.TOO_EARLY]: "Too Early",
  [HTTP_STATUS.UPGRADE_REQUIRED]: "Upgrade Required",
  [HTTP_STATUS.PRECONDITION_REQUIRED]: "Precondition Required",
  [HTTP_STATUS.TOO_MANY_REQUESTS]: "Too Many Requests",
  [HTTP_STATUS.REQUEST_HEADER_FIELDS_TOO_LARGE]:
    "Request Header Fields Too Large",
  [HTTP_STATUS.UNAVAILABLE_FOR_LEGAL_REASONS]: "Unavailable For Legal Reasons",

  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: "Internal Server Error",
  [HTTP_STATUS.NOT_IMPLEMENTED]: "Not Implemented",
  [HTTP_STATUS.BAD_GATEWAY]: "Bad Gateway",
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: "Service Unavailable",
  [HTTP_STATUS.GATEWAY_TIMEOUT]: "Gateway Timeout",
  [HTTP_STATUS.HTTP_VERSION_NOT_SUPPORTED]: "HTTP Version Not Supported",
  [HTTP_STATUS.VARIANT_ALSO_NEGOTIATES]: "Variant Also Negotiates",
  [HTTP_STATUS.INSUFFICIENT_STORAGE]: "Insufficient Storage",
  [HTTP_STATUS.LOOP_DETECTED]: "Loop Detected",
  [HTTP_STATUS.NOT_EXTENDED]: "Not Extended",
  [HTTP_STATUS.NETWORK_AUTHENTICATION_REQUIRED]:
    "Network Authentication Required",
} as const satisfies Readonly<Record<HttpStatus, string>>);

/**
 * RFC 9110 reason phrase of a status code.
 *
 * Returns `string` for an {@link HttpStatus}, and `string | undefined` for any
 * other number, `undefined` meaning the code is not registered.
 *
 * @example
 * ```ts
 * getReasonPhrase(HTTP_STATUS.NOT_FOUND); // "Not Found"
 * getReasonPhrase(499); // undefined
 * ```
 */
export function getReasonPhrase(status: HttpStatus): string;
export function getReasonPhrase(status: number): string | undefined;
export function getReasonPhrase(status: number): string | undefined {
  return isHttpStatus(status) ? HTTP_REASON_PHRASES[status] : undefined;
}
