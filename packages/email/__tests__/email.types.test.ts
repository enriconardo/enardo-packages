import { assertType, describe, expectTypeOf, it } from "vitest";
import type { EmailMessage, EmailRecipient } from "~/index";

// These tests are enforced by `tsc --noEmit` (`pnpm typecheck`): `vitest run`
// erases the types. The lists are declared with their type, not inferred from
// a literal, so that a list of a fixed length could not pass for them.

const anna: EmailRecipient = { address: "anna@example.test", name: "Anna" };
const bruno: EmailRecipient = { address: "bruno@example.test" };

describe("EmailMessage", () => {
  describe("to", () => {
    it("accepts a readonly list of recipients", () => {
      const recipients: readonly EmailRecipient[] = [anna, bruno];

      assertType<EmailMessage>({
        to: recipients,
        subject: "Welcome",
        text: "Hello",
      });
    });

    it("accepts a mutable list of recipients", () => {
      const recipients: EmailRecipient[] = [anna, bruno];

      assertType<EmailMessage>({
        to: recipients,
        subject: "Welcome",
        text: "Hello",
      });
    });

    it("accepts one recipient", () => {
      assertType<EmailMessage>({
        to: anna,
        subject: "Welcome",
        text: "Hello",
      });
    });

    it("rejects a string", () => {
      assertType<EmailMessage>({
        // @ts-expect-error an address is not a recipient
        to: anna.address,
        subject: "Welcome",
        text: "Hello",
      });
    });

    it("rejects a readonly list of strings", () => {
      const addresses: readonly string[] = [anna.address, bruno.address];

      assertType<EmailMessage>({
        // @ts-expect-error a list of addresses is not a list of recipients
        to: addresses,
        subject: "Welcome",
        text: "Hello",
      });
    });

    it("is exactly one recipient or a readonly list of recipients", () => {
      // The cases above also pass for a wider `to`: an `Iterable` or an
      // `ArrayLike` of recipients, or an optional `to`. An optional property
      // reads as `| undefined`, so this rules it out too.
      expectTypeOf<EmailMessage["to"]>().toEqualTypeOf<
        EmailRecipient | readonly EmailRecipient[]
      >();
    });
  });
});
