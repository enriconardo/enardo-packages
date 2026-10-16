import { describe, expect, it } from "vitest";
import { HTTP_REASON_PHRASES, HTTP_STATUS, getReasonPhrase } from "~/index";

describe("getReasonPhrase", () => {
  it.each(Object.values(HTTP_STATUS))(
    "should return the phrase of the registered code %i",
    (code) => {
      expect(getReasonPhrase(code)).toBe(HTTP_REASON_PHRASES[code]);
      expect(getReasonPhrase(code)).toEqual(expect.any(String));
    },
  );

  it.each([
    [200, "OK"],
    [404, "Not Found"],
    [413, "Content Too Large"],
    [422, "Unprocessable Content"],
  ] as const)("should return the RFC 9110 phrase for %i", (code, phrase) => {
    expect(getReasonPhrase(code)).toBe(phrase);
  });

  it.each([499, 306, 418, 999, 0, 200.5])(
    "should return undefined for the unregistered code %d",
    (code) => {
      expect(getReasonPhrase(code)).toBeUndefined();
    },
  );
});
