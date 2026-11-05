import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidEmailMessageError } from "@enardo/email";
import type { EmailMessage } from "@enardo/email";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodemailerEmailSender } from "~/index";
import {
  ADDRESS_MARKERS,
  expectNativeError,
  expectOnlyMessageAndStack,
  reasonOf,
  SEND_MESSAGES,
} from "./support/assertions";
import { headerValues } from "./support/headers";
import {
  onlyReceived,
  useIdleSmtpServers,
  useSmtpServers,
} from "./support/smtp-server";
import type { LocalSmtpServer } from "./support/smtp-server";

const RECIPIENT = { address: "anna@example.test" };
const SENDER = { address: "noreply@example.test" };

const MESSAGE: EmailMessage = {
  to: RECIPIENT,
  from: SENDER,
  subject: "s",
  text: "t",
};

/** The default message with `fields` over it, typed or not. */
function messageWith(fields: Record<string, unknown>): EmailMessage {
  // A spread of a record keeps the type of MESSAGE: no cast needed.
  return { ...MESSAGE, ...fields };
}

function senderOn(server: LocalSmtpServer): NodemailerEmailSender {
  return new NodemailerEmailSender({ transport: server.transportOptions });
}

type ContentField = "subject" | "text" | "html";

describe("content", () => {
  const startServer = useSmtpServers();
  // A server no sender may reach: checked once, after every test of the file.
  const idleServer = useIdleSmtpServers();

  /**
   * Sends `message` to an idle server, through a sender with `options`
   * besides its transport, and returns what it rejects with. The idle server
   * checks that nothing was sent.
   */
  async function refusalOf(
    message: EmailMessage,
    options: { readonly defaultFrom?: { address: string } } = {},
  ): Promise<unknown> {
    const server = await idleServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
      ...options,
    });
    return reasonOf(sender.send(message));
  }

  /** Asserts that `reason` is the native `TypeError` of `field`, not a string. */
  function expectNotString(reason: unknown, field: ContentField): void {
    expectNativeError(reason, TypeError, SEND_MESSAGES.notString(field));
    expectOnlyMessageAndStack(reason);
  }

  /** Asserts that `reason` is the native `Error` of a message with no sender. */
  function expectNoSender(reason: unknown): void {
    expectNativeError(reason, Error, SEND_MESSAGES.noSender);
    expectOnlyMessageAndStack(reason);
  }

  /** Asserts that `reason` is `InvalidEmailMessageError`, with `details`. */
  function expectInvalid(reason: unknown, details: object): void {
    expect(reason).toBeInstanceOf(InvalidEmailMessageError);
    const error = reason as InvalidEmailMessageError;
    expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
    expect(error.details).toStrictEqual(details);
  }

  describe("78: values that are not strings", () => {
    let directory = "";
    let file = "";

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "email-nodemailer-content-"));
      file = join(directory, "secret.txt");
      await writeFile(file, "the content of a local file");
    });

    afterAll(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    // Built inside the test, so that the path of the file is known.
    const VALUES: readonly (readonly [string, () => unknown])[] = [
      ["null", () => null],
      ["42", () => 42],
      ["true", () => true],
      ['new String("hi")', () => new String("hi")],
      ['Buffer.from("hi")', () => Buffer.from("hi")],
      ["{ path: <a temporary file> }", () => ({ path: file })],
      [
        '{ href: "http://127.0.0.1:1/" }',
        () => ({ href: "http://127.0.0.1:1/" }),
      ],
      [
        '{ prepared: true, value: "x" }',
        () => ({ prepared: true, value: "x" }),
      ],
      ['["hi"]', () => ["hi"]],
    ];

    describe.each(["subject", "text", "html"] as const)(
      "on %s",
      (field: ContentField) => {
        it.each(VALUES)(
          `78: refuses %s as ${field}, before sending`,
          async (_label, value) => {
            expectNotString(
              await refusalOf(messageWith({ [field]: value() })),
              field,
            );
          },
        );
      },
    );
  });

  it.each(["subject", "text"] as const)(
    "79: refuses %s: undefined, before sending",
    async (field) => {
      expectNotString(
        await refusalOf(messageWith({ [field]: undefined })),
        field,
      );
    },
  );

  it.each<readonly [string, EmailMessage]>([
    ["html: undefined", { ...MESSAGE, html: undefined }],
    ["no html", MESSAGE],
  ])(
    "80: sends a message with %s, with a single text part",
    async (_label, message) => {
      const server = await startServer();

      await senderOn(server).send(message);

      const { raw } = onlyReceived(server);
      const contentTypes = headerValues(raw, "Content-Type");
      expect(contentTypes).toHaveLength(1);
      expect(contentTypes[0]).toMatch(/^text\/plain/i);
      expect(raw).not.toMatch(/multipart|text\/html/i);
    },
  );

  it.each(["subject", "text", "html"] as const)(
    '81: sends %s: ""',
    async (field) => {
      const server = await startServer();

      await senderOn(server).send(messageWith({ [field]: "" }));

      onlyReceived(server);
    },
  );

  it("82: refuses a prepared subject, and the error holds neither the header nor the address", async () => {
    const reason = await refusalOf(
      messageWith({
        subject: {
          prepared: true,
          value: "Hi\r\nBcc: attacker@evil.test",
        },
      }),
    );

    // The own properties are message and stack alone: nothing else to check.
    expectNotString(reason, "subject");
    const error = reason as TypeError;
    for (const text of [error.message, error.stack ?? ""]) {
      expect(text).not.toContain("Bcc");
      expect(text).not.toMatch(ADDRESS_MARKERS);
    }
  });

  describe("83: order of the checks", () => {
    it("83: reports the first refused field of a refused replyTo and subject: 42", async () => {
      expectInvalid(
        await refusalOf(
          messageWith({
            replyTo: { address: "a,b@example.test" },
            subject: 42,
          }),
        ),
        { field: "replyTo", reason: "address" },
      );
    });

    it.each<readonly [string, Record<string, unknown>, ContentField]>([
      ["subject: 42 and html: 42", { subject: 42, html: 42 }, "subject"],
      ["text: 42 and html: 42", { text: 42, html: 42 }, "text"],
    ])(
      "83: reports the first refused field of %s",
      async (_label, fields, field) => {
        expectNotString(await refusalOf(messageWith(fields)), field);
      },
    );
  });

  describe("87 to 90: the order of the sender's check", () => {
    // A message without from, for a sender without defaultFrom unless the
    // case says otherwise.
    const NO_FROM: EmailMessage = { to: RECIPIENT, subject: "s", text: "t" };

    /** NO_FROM with `fields` over it, typed or not. */
    function noFromWith(fields: Record<string, unknown>): EmailMessage {
      return { ...NO_FROM, ...fields };
    }

    it("87: reports an empty to before no sender and subject: 42", async () => {
      expectInvalid(await refusalOf(noFromWith({ to: [], subject: 42 })), {
        field: "to",
        reason: "empty",
      });
    });

    it("88: reports a refused to address before no sender and subject: 42", async () => {
      expectInvalid(
        await refusalOf(
          noFromWith({ to: { address: "a,b@example.test" }, subject: 42 }),
        ),
        { field: "to", reason: "address", index: 0 },
      );
    });

    it("89: reports no sender before a refused replyTo and subject: 42", async () => {
      expectNoSender(
        await refusalOf(
          noFromWith({ replyTo: { address: "a,b@example.test" }, subject: 42 }),
        ),
      );
    });

    it("90: reports a refused from, with defaultFrom, before subject: 42", async () => {
      expectInvalid(
        await refusalOf(
          noFromWith({ from: { address: "a,b@example.test" }, subject: 42 }),
          { defaultFrom: SENDER },
        ),
        { field: "from", reason: "address" },
      );
    });
  });

  it("84: sends the first answer of a subject getter, and reads it once", async () => {
    const server = await startServer();
    let reads = 0;
    const message = messageWith({});
    Object.defineProperty(message, "subject", {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        return reads === 1
          ? "s"
          : { prepared: true, value: "Hi\r\nBcc: attacker@evil.test" };
      },
    });

    await senderOn(server).send(message);

    const { raw } = onlyReceived(server);
    expect(headerValues(raw, "Subject")).toEqual(["s"]);
    expect(headerValues(raw, "Bcc")).toEqual([]);
    expect(reads).toBe(1);
  });
});
