import { assertType, describe, expect, expectTypeOf, it } from "vitest";
import {
  HTTP_STATUS,
  getReasonPhrase,
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
import type {
  ClientErrorHttpStatus,
  HTTP_REASON_PHRASES,
  ErrorHttpStatus,
  HttpStatus,
  InformationalHttpStatus,
  RedirectionHttpStatus,
  ServerErrorHttpStatus,
  SuccessHttpStatus,
} from "~/index";

// These tests are enforced by `tsc --noEmit`; at runtime they only check
// that the narrowing branches are reached.

describe("status types", () => {
  it("should accept only registered codes of the class in each class type", () => {
    assertType<InformationalHttpStatus>(100);
    // @ts-expect-error a success code is not informational
    assertType<InformationalHttpStatus>(200);
    // @ts-expect-error 199 is in the class but not registered
    assertType<InformationalHttpStatus>(199);

    assertType<SuccessHttpStatus>(200);
    // @ts-expect-error a client error code is not a success
    assertType<SuccessHttpStatus>(404);
    // @ts-expect-error 299 is in the class but not registered
    assertType<SuccessHttpStatus>(299);

    assertType<RedirectionHttpStatus>(301);
    // @ts-expect-error a success code is not a redirection
    assertType<RedirectionHttpStatus>(200);
    // @ts-expect-error 306 is reserved and not registered
    assertType<RedirectionHttpStatus>(306);
    // @ts-expect-error 399 is in the class but not registered
    assertType<RedirectionHttpStatus>(399);

    assertType<ClientErrorHttpStatus>(404);
    // @ts-expect-error a success code is not a client error
    assertType<ClientErrorHttpStatus>(200);
    // @ts-expect-error 499 is in the class but not registered
    assertType<ClientErrorHttpStatus>(499);
    // @ts-expect-error 418 is reserved and not registered
    assertType<ClientErrorHttpStatus>(418);

    assertType<ServerErrorHttpStatus>(500);
    // @ts-expect-error a client error code is not a server error
    assertType<ServerErrorHttpStatus>(404);
    // @ts-expect-error 599 is in the class but not registered
    assertType<ServerErrorHttpStatus>(599);

    assertType<ErrorHttpStatus>(404);
    assertType<ErrorHttpStatus>(500);
    // @ts-expect-error a success code is not an error
    assertType<ErrorHttpStatus>(200);
    // @ts-expect-error 499 is in the class but not registered
    assertType<ErrorHttpStatus>(499);
  });

  it("should not widen any status type to number", () => {
    expectTypeOf<number>().not.toExtend<HttpStatus>();
    expectTypeOf<number>().not.toExtend<InformationalHttpStatus>();
    expectTypeOf<number>().not.toExtend<SuccessHttpStatus>();
    expectTypeOf<number>().not.toExtend<RedirectionHttpStatus>();
    expectTypeOf<number>().not.toExtend<ClientErrorHttpStatus>();
    expectTypeOf<number>().not.toExtend<ServerErrorHttpStatus>();
    expectTypeOf<number>().not.toExtend<ErrorHttpStatus>();
  });

  it("should keep the literal types of the frozen registry", () => {
    expectTypeOf(HTTP_STATUS.OK).toEqualTypeOf<200>();
    expectTypeOf(HTTP_STATUS.CONTENT_TOO_LARGE).toEqualTypeOf<413>();
    expectTypeOf(HTTP_STATUS.UNPROCESSABLE_CONTENT).toEqualTypeOf<422>();
    expectTypeOf<
      (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]
    >().toEqualTypeOf<HttpStatus>();
  });

  it("should key the reason phrases by exactly the registered codes", () => {
    expectTypeOf<
      keyof typeof HTTP_REASON_PHRASES
    >().toEqualTypeOf<HttpStatus>();
  });

  it("should make the five class types add up to HttpStatus", () => {
    expectTypeOf<
      | InformationalHttpStatus
      | SuccessHttpStatus
      | RedirectionHttpStatus
      | ClientErrorHttpStatus
      | ServerErrorHttpStatus
    >().toEqualTypeOf<HttpStatus>();
  });

  it("should define ErrorHttpStatus as client and server errors", () => {
    expectTypeOf<ErrorHttpStatus>().toEqualTypeOf<
      ClientErrorHttpStatus | ServerErrorHttpStatus
    >();
  });
});

describe("known guards narrowing", () => {
  it("should take unknown and guard the closed union", () => {
    expectTypeOf(isHttpStatus).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(isHttpStatus).guards.toEqualTypeOf<HttpStatus>();

    expectTypeOf(isKnownInformationalStatus)
      .parameter(0)
      .toEqualTypeOf<unknown>();
    expectTypeOf(
      isKnownInformationalStatus,
    ).guards.toEqualTypeOf<InformationalHttpStatus>();

    expectTypeOf(isKnownSuccessStatus).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(
      isKnownSuccessStatus,
    ).guards.toEqualTypeOf<SuccessHttpStatus>();

    expectTypeOf(isKnownRedirectionStatus)
      .parameter(0)
      .toEqualTypeOf<unknown>();
    expectTypeOf(
      isKnownRedirectionStatus,
    ).guards.toEqualTypeOf<RedirectionHttpStatus>();

    expectTypeOf(isKnownClientErrorStatus)
      .parameter(0)
      .toEqualTypeOf<unknown>();
    expectTypeOf(
      isKnownClientErrorStatus,
    ).guards.toEqualTypeOf<ClientErrorHttpStatus>();

    expectTypeOf(isKnownServerErrorStatus)
      .parameter(0)
      .toEqualTypeOf<unknown>();
    expectTypeOf(
      isKnownServerErrorStatus,
    ).guards.toEqualTypeOf<ServerErrorHttpStatus>();

    expectTypeOf(isKnownErrorStatus).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(isKnownErrorStatus).guards.toEqualTypeOf<ErrorHttpStatus>();
  });

  it("should narrow an unknown value to the guarded type", () => {
    const reached: string[] = [];

    const narrow = (value: unknown) => {
      if (isHttpStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<HttpStatus>();
        reached.push("isHttpStatus");
      }
      if (isKnownInformationalStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<InformationalHttpStatus>();
        reached.push("isKnownInformationalStatus");
      }
      if (isKnownSuccessStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<SuccessHttpStatus>();
        reached.push("isKnownSuccessStatus");
      }
      if (isKnownRedirectionStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<RedirectionHttpStatus>();
        reached.push("isKnownRedirectionStatus");
      }
      if (isKnownClientErrorStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<ClientErrorHttpStatus>();
        reached.push("isKnownClientErrorStatus");
      }
      if (isKnownServerErrorStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<ServerErrorHttpStatus>();
        reached.push("isKnownServerErrorStatus");
      }
      if (isKnownErrorStatus(value)) {
        expectTypeOf(value).toEqualTypeOf<ErrorHttpStatus>();
        reached.push("isKnownErrorStatus");
      }
    };

    for (const value of [100, 200, 301, 404, 500]) {
      narrow(value);
    }

    expect(new Set(reached)).toEqual(
      new Set([
        "isHttpStatus",
        "isKnownInformationalStatus",
        "isKnownSuccessStatus",
        "isKnownRedirectionStatus",
        "isKnownClientErrorStatus",
        "isKnownServerErrorStatus",
        "isKnownErrorStatus",
      ]),
    );
  });
});

describe("class guards typing", () => {
  it("should take a number", () => {
    for (const guard of [
      isInformationalStatus,
      isSuccessStatus,
      isRedirectionStatus,
      isClientErrorStatus,
      isServerErrorStatus,
      isErrorStatus,
    ]) {
      expectTypeOf(guard).parameter(0).toEqualTypeOf<number>();
    }
  });

  it("should leave a number as number after a class guard", () => {
    const reached: string[] = [];

    const check = (n: number) => {
      if (isInformationalStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isInformationalStatus");
      }
      if (isSuccessStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isSuccessStatus");
      }
      if (isRedirectionStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isRedirectionStatus");
      }
      if (isClientErrorStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isClientErrorStatus");
      }
      if (isServerErrorStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isServerErrorStatus");
      }
      if (isErrorStatus(n)) {
        expectTypeOf(n).toEqualTypeOf<number>();
        reached.push("isErrorStatus");
      }
    };

    for (const n of [199, 299, 399, 499, 599]) {
      check(n);
    }

    expect(new Set(reached)).toEqual(
      new Set([
        "isInformationalStatus",
        "isSuccessStatus",
        "isRedirectionStatus",
        "isClientErrorStatus",
        "isServerErrorStatus",
        "isErrorStatus",
      ]),
    );
  });
});

describe("getReasonPhrase typing", () => {
  it("should return string for a registered status", () => {
    expectTypeOf(getReasonPhrase(HTTP_STATUS.OK)).toEqualTypeOf<string>();

    // Widened on purpose: an annotation alone would narrow it back to 404.
    const status = HTTP_STATUS.NOT_FOUND as HttpStatus;
    expectTypeOf(getReasonPhrase(status)).toEqualTypeOf<string>();
  });

  it("should return string or undefined for any number", () => {
    const n = 404 as number;
    expectTypeOf(getReasonPhrase(n)).toEqualTypeOf<string | undefined>();
  });
});
