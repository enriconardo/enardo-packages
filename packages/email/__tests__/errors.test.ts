import { describe, expect, expectTypeOf, it } from "vitest";
import { BaseError } from "@enardo/errors";
import * as entryPoint from "~/index";
import {
  EmailRecipientsRefusedError,
  EmailSendFailedError,
  InvalidEmailMessageError,
} from "~/index";
import type {
  EmailErrorCause,
  EmailRecipientsRefusedDetails,
  EmailSendFailedDetails,
  InvalidEmailMessageDetails,
  RefusedEmailRecipient,
} from "~/index";

// The type-level cases are enforced by `tsc --noEmit` (`pnpm typecheck`):
// `vitest run` erases the types.

/** Hands `construct` to the compiler without running it. */
const compileOnly = (construct: () => unknown): void => {
  expectTypeOf(construct).toBeFunction();
};

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

type ErrorClass =
  | typeof InvalidEmailMessageError
  | typeof EmailRecipientsRefusedError
  | typeof EmailSendFailedError;

/**
 * Each class, built with valid arguments: without options, and with the
 * options given.
 */
const CLASSES: {
  name: string;
  errorClass: ErrorClass;
  code: string;
  message: string;
  create: () => BaseError;
  createWith: (options: { cause?: EmailErrorCause }) => BaseError;
}[] = [
  {
    name: "InvalidEmailMessageError",
    errorClass: InvalidEmailMessageError,
    code: "INVALID_EMAIL_MESSAGE",
    message: "The email has no recipient: to is an empty list",
    create: () =>
      new InvalidEmailMessageError({ field: "to", reason: "empty" }),
    createWith: (options) =>
      new InvalidEmailMessageError({ field: "to", reason: "empty" }, options),
  },
  {
    name: "EmailRecipientsRefusedError",
    errorClass: EmailRecipientsRefusedError,
    code: "EMAIL_RECIPIENTS_REFUSED",
    message: "The relay refused the email for to[1], to[3]",
    create: () =>
      new EmailRecipientsRefusedError([
        { index: 3, retryable: true },
        { index: 1, retryable: false },
      ]),
    createWith: (options) =>
      new EmailRecipientsRefusedError(
        [
          { index: 3, retryable: true },
          { index: 1, retryable: false },
        ],
        options,
      ),
  },
  {
    name: "EmailSendFailedError",
    errorClass: EmailSendFailedError,
    code: "EMAIL_SEND_FAILED",
    message: "Sending the email failed",
    create: () => new EmailSendFailedError({ retryable: false }),
    createWith: (options) =>
      new EmailSendFailedError({ retryable: false }, options),
  },
];

describe("the errors of send", () => {
  describe.each(CLASSES)(
    "$name",
    ({ name, errorClass, code, message, create }) => {
      it("is an instance of its class and of BaseError", () => {
        const error = create();

        expect(error).toBeInstanceOf(errorClass);
        expect(error).toBeInstanceOf(BaseError);
      });

      it("is an instance of neither of the other two classes", () => {
        const error = create();

        for (const other of CLASSES) {
          if (other.errorClass !== errorClass) {
            expect(error, other.name).not.toBeInstanceOf(other.errorClass);
          }
        }
      });

      it(`is named "${name}"`, () => {
        expect(create().name).toBe(name);
      });

      it(`has the code ${code}`, () => {
        expect(create().code).toBe(code);
      });

      it("starts its stack with '<name>: <message>'", () => {
        expect(firstLineOf(create().stack)).toBe(`${name}: ${message}`);
      });
    },
  );

  describe("InvalidEmailMessageError", () => {
    it.each<{ details: InvalidEmailMessageDetails; message: string }>([
      {
        details: { field: "to", reason: "empty" },
        message: "The email has no recipient: to is an empty list",
      },
      {
        details: { field: "to", reason: "address", index: 1 },
        message: "The email sender refuses the address of to[1]",
      },
      {
        details: { field: "from", reason: "address" },
        message: "The email sender refuses the address of from",
      },
      {
        details: { field: "replyTo", reason: "address" },
        message: "The email sender refuses the address of replyTo",
      },
      {
        details: { field: "from", reason: "missing" },
        message: "The email has no sender: no from, and no default sender",
      },
      {
        details: { field: "subject", reason: "type" },
        message: "The email sender refuses subject: not a string",
      },
      {
        details: { field: "text", reason: "type" },
        message: "The email sender refuses text: not a string",
      },
      {
        details: { field: "html", reason: "type" },
        message: "The email sender refuses html: not a string",
      },
    ])(
      "has the details given, and the message $message, for $details",
      ({ details, message }) => {
        const error = new InvalidEmailMessageError(details);

        expect(error.details).toStrictEqual(details);
        expect(error.message).toBe(message);
      },
    );
  });

  describe("EmailRecipientsRefusedError", () => {
    /** Recipients 3 and 1, out of order. */
    const givenList = (): [
      RefusedEmailRecipient,
      ...RefusedEmailRecipient[],
    ] => [
      { index: 3, retryable: true },
      { index: 1, retryable: false },
    ];

    it("lists the refused recipients in details, sorted by index", () => {
      const error = new EmailRecipientsRefusedError(givenList());

      expect(error.details).toStrictEqual({
        refused: [
          { index: 1, retryable: false },
          { index: 3, retryable: true },
        ],
      });
    });

    it("names the refused recipients in its message, by index in to", () => {
      const error = new EmailRecipientsRefusedError(givenList());

      expect(error.message).toBe(
        "The relay refused the email for to[1], to[3]",
      );
    });

    it("leaves the list given as it was", () => {
      const given = givenList();

      new EmailRecipientsRefusedError(given);

      expect(given).toStrictEqual(givenList());
    });

    it("keeps in details none of the later changes to the list given", () => {
      const given = givenList();
      const error = new EmailRecipientsRefusedError(given);

      given.push({ index: 0, retryable: true });
      given[1] = { index: 2, retryable: true };

      expect(error.details).toStrictEqual({
        refused: [
          { index: 1, retryable: false },
          { index: 3, retryable: true },
        ],
      });
    });
  });

  describe("EmailSendFailedError", () => {
    it.each<{ details: EmailSendFailedDetails; message: string }>([
      { details: { retryable: false }, message: "Sending the email failed" },
      {
        details: { retryable: true },
        message: "Sending the email failed; a later retry may succeed",
      },
    ])(
      "has the details given, and the message $message, for $details",
      ({ details, message }) => {
        const error = new EmailSendFailedError(details);

        expect(error.details).toStrictEqual(details);
        expect(error.message).toBe(message);
      },
    );
  });

  describe.each(CLASSES)("the cause of $name", ({ create, createWith }) => {
    it("is the cause given, and toJSON() keeps it", () => {
      const cause: EmailErrorCause = { code: "ESOCKET", responseCode: 421 };

      const error = createWith({ cause });

      expect(error.cause).toBe(cause);
      expect(error.toJSON().cause).toStrictEqual({
        code: "ESOCKET",
        responseCode: 421,
      });
    });

    it("is not in toJSON() when the error is built without options", () => {
      expect(create().toJSON()).not.toHaveProperty("cause");
    });
  });
});

describe("entry point", () => {
  it("exports exactly InvalidEmailMessageError, EmailRecipientsRefusedError and EmailSendFailedError at runtime", () => {
    expect(Object.keys(entryPoint).sort()).toEqual(
      [
        "InvalidEmailMessageError",
        "EmailRecipientsRefusedError",
        "EmailSendFailedError",
      ].sort(),
    );
  });
});

describe("the types of the errors", () => {
  // Read in type position: `expectTypeOf(error.code)` would widen a literal.

  it("types each code as its literal", () => {
    expectTypeOf<
      InvalidEmailMessageError["code"]
    >().toEqualTypeOf<"INVALID_EMAIL_MESSAGE">();
    expectTypeOf<
      EmailRecipientsRefusedError["code"]
    >().toEqualTypeOf<"EMAIL_RECIPIENTS_REFUSED">();
    expectTypeOf<
      EmailSendFailedError["code"]
    >().toEqualTypeOf<"EMAIL_SEND_FAILED">();
  });

  it("types each details as the exported type of its class", () => {
    expectTypeOf<
      InvalidEmailMessageError["details"]
    >().toEqualTypeOf<InvalidEmailMessageDetails>();
    expectTypeOf<
      EmailRecipientsRefusedError["details"]
    >().toEqualTypeOf<EmailRecipientsRefusedDetails>();
    expectTypeOf<
      EmailSendFailedError["details"]
    >().toEqualTypeOf<EmailSendFailedDetails>();
  });

  it("makes the fields of RefusedEmailRecipient and EmailSendFailedDetails readonly", () => {
    const recipient: RefusedEmailRecipient = { index: 1, retryable: false };
    const other: RefusedEmailRecipient = { index: 2, retryable: true };
    const details: EmailSendFailedDetails = { retryable: false };

    // Each assignment takes a value of the same type, so that readonly is
    // the only error the compiler can report.
    compileOnly(() => {
      // @ts-expect-error index is readonly
      recipient.index = other.index;
      // @ts-expect-error retryable is readonly
      recipient.retryable = other.retryable;
      // @ts-expect-error retryable is readonly
      details.retryable = other.retryable;
    });
  });

  it("refuses an empty list of refused recipients", () => {
    // @ts-expect-error the relay refused at least one recipient
    compileOnly(() => new EmailRecipientsRefusedError([]));
  });

  describe("the cause", () => {
    // Either can hold an address: the cause takes identifiers only.
    const errorCause: Error = new Error(
      "550 no such user: <victim@example.test>",
    );
    const unknownCause: unknown = errorCause;

    it("refuses an Error and an unknown for InvalidEmailMessageError", () => {
      compileOnly(
        () =>
          new InvalidEmailMessageError(
            { field: "to", reason: "empty" },
            // @ts-expect-error an Error is not an EmailErrorCause
            { cause: errorCause },
          ),
      );
      compileOnly(
        () =>
          new InvalidEmailMessageError(
            { field: "to", reason: "empty" },
            // @ts-expect-error an unknown is not an EmailErrorCause
            { cause: unknownCause },
          ),
      );
    });

    it("refuses an Error and an unknown for EmailRecipientsRefusedError", () => {
      compileOnly(
        () =>
          new EmailRecipientsRefusedError(
            [{ index: 0, retryable: false }],
            // @ts-expect-error an Error is not an EmailErrorCause
            { cause: errorCause },
          ),
      );
      compileOnly(
        () =>
          new EmailRecipientsRefusedError(
            [{ index: 0, retryable: false }],
            // @ts-expect-error an unknown is not an EmailErrorCause
            { cause: unknownCause },
          ),
      );
    });

    it("refuses an Error and an unknown for EmailSendFailedError", () => {
      compileOnly(
        () =>
          new EmailSendFailedError(
            { retryable: false },
            // @ts-expect-error an Error is not an EmailErrorCause
            { cause: errorCause },
          ),
      );
      compileOnly(
        () =>
          new EmailSendFailedError(
            { retryable: false },
            // @ts-expect-error an unknown is not an EmailErrorCause
            { cause: unknownCause },
          ),
      );
    });
  });
});
