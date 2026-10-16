import type { EmailMessage } from "@enardo/email";
import { describe, expect, it } from "vitest";
import { NodemailerEmailSender } from "~/index";
import type { NodemailerSmtpOptions } from "~/index";
import { reasonOf } from "./support/assertions";
import { createRecordingLogger } from "./support/logger";
import type { RecordingLogger } from "./support/logger";
import { useIdleSmtpServers, useSmtpServers } from "./support/smtp-server";
import type { LocalSmtpServer } from "./support/smtp-server";

const RECIPIENT = { address: "anna@example.test" };
const SENDER = { address: "noreply@example.test", name: "Cambusa" };

const MESSAGE: EmailMessage = {
  to: RECIPIENT,
  from: SENDER,
  subject: "Welcome",
  text: "Hello",
};

/** The message of case 35: two recipients, with html. */
function twoRecipientsWithHtml(addresses: {
  readonly first: string;
  readonly second: string;
}): EmailMessage {
  return {
    to: [
      { address: addresses.first, name: "Anna" },
      { address: addresses.second, name: "Bruno" },
    ],
    from: SENDER,
    subject: "Welcome",
    text: "Hello",
    html: "<p>Hello</p>",
  };
}

function senderOnServer(
  server: LocalSmtpServer,
  logger: RecordingLogger,
): NodemailerEmailSender {
  return new NodemailerEmailSender({
    transport: server.transportOptions,
    logger,
  });
}

describe("logs", () => {
  const startServer = useSmtpServers();
  // A server no sender may reach: checked once, after every test of the file.
  const idleServer = useIdleSmtpServers();

  it("34: calls child once, with the context NodemailerEmailSender", async () => {
    const logger = createRecordingLogger();
    const sender = senderOnServer(await startServer(), logger);

    expect(logger.child).toHaveBeenCalledTimes(1);
    expect(logger.child).toHaveBeenCalledWith({
      context: "NodemailerEmailSender",
    });

    await sender.send(MESSAGE);

    expect(logger.child).toHaveBeenCalledTimes(1);
  });

  it("35: logs debug before sending, then info once sent, and nothing else", async () => {
    const logger = createRecordingLogger();

    await senderOnServer(await startServer(), logger).send(
      twoRecipientsWithHtml({
        first: "anna@example.test",
        second: "bruno@example.test",
      }),
    );

    expect(logger.calls).toStrictEqual([
      [
        "debug",
        "Sending email.",
        { recipientsCount: 2, hasHtmlBody: true, hasTextBody: true },
      ],
      ["info", "Email sent.", { recipientsCount: 2 }],
    ]);
  });

  it("36: logs warn with nodemailer's identifiers when the relay refuses every recipient", async () => {
    const server = await startServer();
    const logger = createRecordingLogger();

    await reasonOf(
      senderOnServer(server, logger).send({
        ...MESSAGE,
        to: { address: "bob@refused.test" },
      }),
    );

    expect(logger.calls).toStrictEqual([
      [
        "debug",
        "Sending email.",
        { recipientsCount: 1, hasHtmlBody: false, hasTextBody: true },
      ],
      [
        "warn",
        "Email send failed.",
        {
          recipientsCount: 1,
          code: "EENVELOPE",
          command: "RCPT TO",
          responseCode: 550,
        },
      ],
    ]);
  });

  it("37: logs warn with the count when the relay refuses one of two recipients", async () => {
    const server = await startServer();
    const logger = createRecordingLogger();

    await reasonOf(
      senderOnServer(server, logger).send({
        ...MESSAGE,
        to: [RECIPIENT, { address: "bob@refused.test" }],
      }),
    );

    expect(logger.calls).toStrictEqual([
      [
        "debug",
        "Sending email.",
        { recipientsCount: 2, hasHtmlBody: false, hasTextBody: true },
      ],
      [
        "warn",
        "Email refused for some recipients.",
        { recipientsCount: 2, refused: 1 },
      ],
    ]);
  });

  it.each([
    ["an empty to", { ...MESSAGE, to: [] }],
    ["a refused address", { ...MESSAGE, to: { address: "a,b@example.test" } }],
    ["no sender", { to: RECIPIENT, subject: "Welcome", text: "Hello" }],
  ])(
    "38: logs nothing for the caller's error, and sends nothing: %s",
    async (_label, message) => {
      const logger = createRecordingLogger();
      const sender = senderOnServer(await idleServer(), logger);

      await reasonOf(sender.send(message));

      expect(logger.calls).toEqual([]);
    },
  );

  it("39: no log of 35 to 37 holds a name, an address, the subject or a body", async () => {
    const logger = createRecordingLogger();
    const marked = (to: EmailMessage["to"]): EmailMessage => ({
      to,
      from: { address: "sender-marker@example.test", name: "Sender Marker" },
      replyTo: { address: "reply-marker@example.test", name: "Reply Marker" },
      subject: "Subject marker",
      text: "Text marker",
      html: "<p>Html marker</p>",
    });
    const server = await startServer();

    await senderOnServer(server, logger).send(
      marked([
        { address: "first-marker@example.test", name: "First Marker" },
        { address: "second-marker@example.test", name: "Second Marker" },
      ]),
    );
    await reasonOf(
      senderOnServer(server, logger).send(
        marked({
          address: "refused-marker@refused.test",
          name: "Refused Marker",
        }),
      ),
    );
    await reasonOf(
      senderOnServer(server, logger).send(
        marked([
          { address: "kept-marker@example.test", name: "Kept Marker" },
          { address: "dropped-marker@refused.test", name: "Dropped Marker" },
        ]),
      ),
    );

    // The three outcomes were logged: a log missing would hold no marker.
    expect(logger.calls.map(([level, message]) => [level, message])).toEqual([
      ["debug", "Sending email."],
      ["info", "Email sent."],
      ["debug", "Sending email."],
      ["warn", "Email send failed."],
      ["debug", "Sending email."],
      ["warn", "Email refused for some recipients."],
    ]);
    for (const call of [...logger.calls, ...logger.child.mock.calls]) {
      expect(JSON.stringify(call)).not.toMatch(
        /marker|example\.test|refused\.test/i,
      );
    }
  });

  describe("40: reading the rejection", () => {
    /**
     * The options of a transport to `server` whose `getSocket` calls back
     * with `rejection`: nodemailer then rejects the send with it, as it is.
     */
    function rejectingWith(
      server: LocalSmtpServer,
      rejection: unknown,
    ): NodemailerSmtpOptions {
      return {
        ...server.transportOptions,
        getSocket: (_options, callback) => {
          callback(rejection as Error);
        },
      };
    }

    it("40: rejects with an Error whose code getter throws, and logs it without code", async () => {
      const logger = createRecordingLogger();
      const error = Object.assign(new Error("relay down"), {
        command: "RCPT TO",
        responseCode: 550,
      });
      Object.defineProperty(error, "code", {
        get(): never {
          throw new Error("the read of code failed");
        },
      });
      const sender = new NodemailerEmailSender({
        transport: rejectingWith(await startServer(), error),
        logger,
      });

      await expect(reasonOf(sender.send(MESSAGE))).resolves.toBe(error);

      expect(logger.calls).toStrictEqual([
        [
          "debug",
          "Sending email.",
          { recipientsCount: 1, hasHtmlBody: false, hasTextBody: true },
        ],
        [
          "warn",
          "Email send failed.",
          { recipientsCount: 1, command: "RCPT TO", responseCode: 550 },
        ],
      ]);
    });

    it.each([
      ["a string", "relay down"],
      [
        "fields of other types",
        { code: 5, command: ["RCPT TO"], responseCode: "550" },
      ],
    ])(
      "40: rejects with %s as it is, and logs recipientsCount only",
      async (_label, rejection) => {
        const logger = createRecordingLogger();
        const sender = new NodemailerEmailSender({
          transport: rejectingWith(await startServer(), rejection),
          logger,
        });

        await expect(reasonOf(sender.send(MESSAGE))).resolves.toBe(rejection);

        expect(logger.calls).toStrictEqual([
          [
            "debug",
            "Sending email.",
            { recipientsCount: 1, hasHtmlBody: false, hasTextBody: true },
          ],
          ["warn", "Email send failed.", { recipientsCount: 1 }],
        ]);
      },
    );
  });
});
