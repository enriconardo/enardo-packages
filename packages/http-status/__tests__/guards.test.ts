import { describe, expect, it } from "vitest";
import {
  HTTP_STATUS,
  isClientErrorStatus,
  isErrorStatus,
  isHttpStatus,
  isInformationalStatus,
  isKnownClientErrorStatus,
  isKnownErrorStatus,
  isKnownInformationalStatus,
  isKnownRedirectionStatus,
  isKnownServerErrorStatus,
  isKnownSuccessStatus,
  isRedirectionStatus,
  isServerErrorStatus,
  isSuccessStatus,
} from "~/index";

const codes: number[] = Object.values(HTTP_STATUS);

const classOf = (code: number) => Math.floor(code / 100);

const CLASSES = [
  {
    digit: 1,
    classGuard: isInformationalStatus,
    knownGuard: isKnownInformationalStatus,
  },
  {
    digit: 2,
    classGuard: isSuccessStatus,
    knownGuard: isKnownSuccessStatus,
  },
  {
    digit: 3,
    classGuard: isRedirectionStatus,
    knownGuard: isKnownRedirectionStatus,
  },
  {
    digit: 4,
    classGuard: isClientErrorStatus,
    knownGuard: isKnownClientErrorStatus,
  },
  {
    digit: 5,
    classGuard: isServerErrorStatus,
    knownGuard: isKnownServerErrorStatus,
  },
].map((entry) => ({
  ...entry,
  first: entry.digit * 100,
  last: entry.digit * 100 + 99,
  registered: codes.filter((code) => classOf(code) === entry.digit),
  others: codes.filter((code) => classOf(code) !== entry.digit),
}));

const NON_INTEGERS = [200.5, NaN, Infinity, -Infinity];

describe("isHttpStatus", () => {
  it.each(codes)("should be true for the registered code %i", (code) => {
    expect(isHttpStatus(code)).toBe(true);
  });

  it.each([
    499,
    306,
    418,
    0,
    99,
    600,
    200.5,
    NaN,
    Infinity,
    "200",
    null,
    undefined,
    {},
  ])("should be false for %o", (value) => {
    expect(isHttpStatus(value)).toBe(false);
  });
});

describe("class guards", () => {
  describe.each(CLASSES)("$classGuard.name", (entry) => {
    const { classGuard, first, last } = entry;

    it(`should be true at the class boundaries ${first} and ${last}`, () => {
      expect(classGuard(first)).toBe(true);
      expect(classGuard(last)).toBe(true);
    });

    it(`should be false just outside the class, at ${first - 1} and ${last + 1}`, () => {
      expect(classGuard(first - 1)).toBe(false);
      expect(classGuard(last + 1)).toBe(false);
    });

    it(`should be true for the unregistered code ${last} inside the class`, () => {
      expect(codes).not.toContain(last);
      expect(classGuard(last)).toBe(true);
    });

    it.each([...NON_INTEGERS, first + 50.5])(
      "should be false for the non-integer %d",
      (value) => {
        expect(classGuard(value)).toBe(false);
      },
    );
  });

  describe("isErrorStatus", () => {
    it.each([400, 499, 500, 599])("should be true at %i", (status) => {
      expect(isErrorStatus(status)).toBe(true);
    });

    it.each([399, 600])("should be false at %i", (status) => {
      expect(isErrorStatus(status)).toBe(false);
    });

    it.each([...NON_INTEGERS, 404.5])(
      "should be false for the non-integer %d",
      (value) => {
        expect(isErrorStatus(value)).toBe(false);
      },
    );
  });

  it("should classify 499 as a client error without making it a known code", () => {
    expect(isClientErrorStatus(499)).toBe(true);
    expect(isKnownClientErrorStatus(499)).toBe(false);
    expect(isHttpStatus(499)).toBe(false);
  });
});

describe("known guards", () => {
  describe.each(CLASSES)("$knownGuard.name", (entry) => {
    const { knownGuard, last, registered, others } = entry;

    it("should have at least one registered code in the class", () => {
      expect(registered.length).toBeGreaterThan(0);
    });

    it("should be true for every registered code of the class", () => {
      for (const code of registered) {
        expect(knownGuard(code), `code ${code}`).toBe(true);
      }
    });

    it(`should be false for the unregistered code ${last} inside the class`, () => {
      expect(knownGuard(last)).toBe(false);
    });

    it("should be false for registered codes of other classes", () => {
      for (const code of others) {
        expect(knownGuard(code), `code ${code}`).toBe(false);
      }
    });

    it.each(["404", String(registered[0]), null, undefined])(
      "should be false for the non-number %o",
      (value) => {
        expect(knownGuard(value)).toBe(false);
      },
    );
  });

  it.each([199, 299, 399, 499, 599])(
    "should be false in every known guard for the unregistered code %i",
    (code) => {
      for (const { knownGuard } of CLASSES) {
        expect(knownGuard(code)).toBe(false);
      }
      expect(isKnownErrorStatus(code)).toBe(false);
    },
  );

  describe("isKnownErrorStatus", () => {
    it("should be true exactly for the registered 4xx and 5xx codes", () => {
      for (const code of codes) {
        const expected = classOf(code) === 4 || classOf(code) === 5;
        expect(isKnownErrorStatus(code), `code ${code}`).toBe(expected);
      }
    });

    it.each([499, 599, 404.5, NaN, "404", null, undefined])(
      "should be false for %o",
      (value) => {
        expect(isKnownErrorStatus(value)).toBe(false);
      },
    );
  });

  it("should put every registered code in exactly one class", () => {
    for (const code of codes) {
      const matches = CLASSES.filter(({ knownGuard }) => knownGuard(code));
      expect(matches, `code ${code}`).toHaveLength(1);
    }
  });
});
