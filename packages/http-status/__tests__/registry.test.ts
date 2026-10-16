import { describe, expect, it } from "vitest";
import { HTTP_REASON_PHRASES, HTTP_STATUS } from "~/index";

const codes = Object.values(HTTP_STATUS);

describe("HTTP_STATUS", () => {
  it("should register exactly the IANA codes under their RFC names", () => {
    expect(HTTP_STATUS).toEqual({
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
      CONTENT_TOO_LARGE: 413,
      URI_TOO_LONG: 414,
      UNSUPPORTED_MEDIA_TYPE: 415,
      RANGE_NOT_SATISFIABLE: 416,
      EXPECTATION_FAILED: 417,
      MISDIRECTED_REQUEST: 421,
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
      NOT_EXTENDED: 510,
      NETWORK_AUTHENTICATION_REQUIRED: 511,
    });
  });

  it("should register 61 codes", () => {
    expect(new Set(codes).size).toBe(61);
  });

  it.each([
    "UNUSED",
    "IM_A_TEAPOT",
    "PAYLOAD_TOO_LARGE",
    "UNPROCESSABLE_ENTITY",
  ])("should not have the %s key", (name) => {
    expect(Object.keys(HTTP_STATUS)).not.toContain(name);
  });

  it.each([306, 418])("should not register the reserved code %i", (code) => {
    expect(codes).not.toContain(code);
  });

  it("should only contain integers from 100 to 599", () => {
    for (const code of codes) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThanOrEqual(100);
      expect(code).toBeLessThanOrEqual(599);
    }
  });

  it("should not register the same code twice", () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("should be frozen", () => {
    expect(HTTP_STATUS).toEqual(expect.any(Object));
    expect(Object.isFrozen(HTTP_STATUS)).toBe(true);
  });

  it("should throw when a property is assigned", () => {
    const registry = HTTP_STATUS as unknown as Record<string, unknown>;

    expect(() => {
      registry.OK = 299;
    }).toThrow(TypeError);
    expect(() => {
      registry.IM_A_TEAPOT = 418;
    }).toThrow(TypeError);
    expect(HTTP_STATUS.OK).toBe(200);
  });
});

describe("HTTP_REASON_PHRASES", () => {
  it("should be frozen", () => {
    expect(HTTP_REASON_PHRASES).toEqual(expect.any(Object));
    expect(Object.isFrozen(HTTP_REASON_PHRASES)).toBe(true);
  });

  it("should throw when a property is assigned", () => {
    const phrases = HTTP_REASON_PHRASES as unknown as Record<string, unknown>;

    expect(() => {
      phrases[200] = "Fine";
    }).toThrow(TypeError);
    expect(() => {
      phrases[418] = "I'm a teapot";
    }).toThrow(TypeError);
    expect(HTTP_REASON_PHRASES[200]).toBe("OK");
  });

  it("should have exactly the registered codes as keys", () => {
    const keys = Object.keys(HTTP_REASON_PHRASES)
      .map(Number)
      .sort((a, b) => a - b);
    const expected = [...new Set(codes)].sort((a, b) => a - b);

    expect(keys).toEqual(expected);
  });

  it("should have a non-empty phrase for every registered code", () => {
    for (const code of codes) {
      expect(typeof HTTP_REASON_PHRASES[code]).toBe("string");
      expect(HTTP_REASON_PHRASES[code].length).toBeGreaterThan(0);
    }
  });

  it.each([
    [200, "OK"],
    [404, "Not Found"],
    [413, "Content Too Large"],
    [422, "Unprocessable Content"],
  ] as const)("should use the RFC 9110 phrase for %i", (code, phrase) => {
    expect(HTTP_REASON_PHRASES[code]).toBe(phrase);
  });
});
