import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidEmailMessageError } from "@enardo/email";
import type { EmailMessage } from "@enardo/email";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodemailerEmailSender } from "~/index";
import { ADDRESS_MARKERS, rejectionOf } from "./support/assertions";
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
   * Sends `message` to an idle server, and checks that it rejects with
   * `InvalidEmailMessageError` and `details`. The idle server checks that
   * nothing was sent.
   */
  async function expectRefused(
    message: EmailMessage,
    details: object,
  ): Promise<InvalidEmailMessageError> {
    const error = await rejectionOf(
      senderOn(await idleServer()).send(message),
      InvalidEmailMessageError,
    );

    expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
    expect(error.details).toStrictEqual(details);
    return error;
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
            await expectRefused(messageWith({ [field]: value() }), {
              field,
              reason: "type",
            });
          },
        );
      },
    );
  });

  it.each(["subject", "text"] as const)(
    "79: refuses %s: undefined, before sending",
    async (field) => {
      await expectRefused(messageWith({ [field]: undefined }), {
        field,
        reason: "type",
      });
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
    const error = await expectRefused(
      messageWith({
        subject: {
          prepared: true,
          value: "Hi\r\nBcc: attacker@evil.test",
        },
      }),
      { field: "subject", reason: "type" },
    );

    for (const text of [
      error.message,
      error.stack ?? "",
      JSON.stringify(error.toJSON()),
    ]) {
      expect(text).not.toContain("Bcc");
      expect(text).not.toMatch(ADDRESS_MARKERS);
    }
  });

  describe("83: order of the checks", () => {
    it.each<readonly [string, Record<string, unknown>, object]>([
      [
        "a refused replyTo and subject: 42",
        { replyTo: { address: "a,b@example.test" }, subject: 42 },
        { field: "replyTo", reason: "address" },
      ],
      [
        "subject: 42 and html: 42",
        { subject: 42, html: 42 },
        { field: "subject", reason: "type" },
      ],
      [
        "text: 42 and html: 42",
        { text: 42, html: 42 },
        { field: "text", reason: "type" },
      ],
    ])(
      "83: reports the first refused field of %s",
      async (_label, fields, details) => {
        await expectRefused(messageWith(fields), details);
      },
    );
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
