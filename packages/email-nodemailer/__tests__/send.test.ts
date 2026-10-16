import type { EmailMessage } from "@enardo/email";
import { BaseError } from "@enardo/errors";
import { describe, expect, it } from "vitest";
import * as entryPoint from "~/index";
import {
  EmailRecipientsRefusedError,
  InvalidEmailMessageError,
  InvalidEmailSenderOptionsError,
  NodemailerEmailSender,
} from "~/index";
import { reasonOf, rejectionOf, thrownBy } from "./support/assertions";
import { headerValues, mailboxesOf } from "./support/headers";
import {
  onlyReceived,
  useIdleSmtpServers,
  useSmtpServers,
} from "./support/smtp-server";
import type { LocalSmtpServer } from "./support/smtp-server";

const RECIPIENT = { address: "anna@example.test" };
const SENDER = { address: "noreply@example.test", name: "Cambusa" };

const MESSAGE: EmailMessage = {
  to: RECIPIENT,
  from: SENDER,
  subject: "Welcome",
  text: "Hello",
};

function senderOn(server: LocalSmtpServer): NodemailerEmailSender {
  return new NodemailerEmailSender({ transport: server.transportOptions });
}

describe("send", () => {
  const startServer = useSmtpServers();
  // A server no sender may reach: checked once, after every test of the file.
  const idleServer = useIdleSmtpServers();

  it("18: rejects an empty to, and opens no connection to the SMTP server", async () => {
    const server = await idleServer();

    const error = await rejectionOf(
      senderOn(server).send({ ...MESSAGE, to: [] }),
      InvalidEmailMessageError,
    );

    expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
    expect(error.details).toStrictEqual({ field: "to", reason: "empty" });
  });

  it("19: rejects with no from and no defaultFrom, and opens no connection", async () => {
    const server = await idleServer();

    const error = await rejectionOf(
      senderOn(server).send({
        to: RECIPIENT,
        subject: "Welcome",
        text: "Hello",
      }),
      InvalidEmailMessageError,
    );

    expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
    expect(error.details).toStrictEqual({ field: "from", reason: "missing" });
  });

  it("20: sends from defaultFrom when the message has no from", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
      defaultFrom: SENDER,
    });

    await sender.send({ to: RECIPIENT, subject: "Welcome", text: "Hello" });

    const { envelope, raw } = onlyReceived(server);
    expect(envelope.from).toBe("noreply@example.test");
    expect(mailboxesOf(raw, "From")).toEqual([
      { name: "Cambusa", address: "noreply@example.test" },
    ]);
  });

  it("21: sends from the message's from over defaultFrom", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
      defaultFrom: SENDER,
    });

    await sender.send({
      ...MESSAGE,
      from: { address: "team@example.test", name: "Team" },
    });

    const { envelope, raw } = onlyReceived(server);
    expect(envelope.from).toBe("team@example.test");
    expect(mailboxesOf(raw, "From")).toEqual([
      { name: "Team", address: "team@example.test" },
    ]);
  });

  describe.each([
    ["22", "refused (550)", "refused.test"],
    ["23", "deferred (450)", "deferred.test"],
  ])("%s: one of two recipients %s", (number, outcome, domain) => {
    it(`${number}: rejects with EmailRecipientsRefusedError, once the message was sent to the other`, async () => {
      const server = await startServer();

      const error = await rejectionOf(
        senderOn(server).send({
          ...MESSAGE,
          to: [
            { address: "kept-one@example.test" },
            { address: `dropped-one@${domain}` },
          ],
        }),
        EmailRecipientsRefusedError,
      );

      expect(error.code).toBe("EMAIL_RECIPIENTS_REFUSED");
      expect(error.details).toStrictEqual({ refused: 1 });
      expect(server.commands).toContain("DATA");
      expect(server.messages).toHaveLength(1);
      const serialized = JSON.stringify(error.toJSON());
      expect(serialized).not.toContain("kept-one");
      expect(serialized).not.toContain("dropped-one");
    });
  });

  it("24: rejects with nodemailer's own error when the relay refuses every recipient", async () => {
    const server = await startServer();

    const error = await reasonOf(
      senderOn(server).send({
        ...MESSAGE,
        to: { address: "bob@refused.test" },
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "EENVELOPE", command: "RCPT TO" });
    for (const errorClass of [
      InvalidEmailSenderOptionsError,
      InvalidEmailMessageError,
      EmailRecipientsRefusedError,
    ]) {
      expect(error).not.toBeInstanceOf(errorClass);
    }
  });

  it("25: rejects with ECONNECTION when the connection closes after DATA", async () => {
    const server = await startServer({ closeAfterData: true });

    const error = await reasonOf(senderOn(server).send(MESSAGE));

    expect(error).toMatchObject({ code: "ECONNECTION" });
  });

  it("26: resolves with undefined when the relay accepts every recipient", async () => {
    const server = await startServer();

    await expect(
      senderOn(server).send({
        ...MESSAGE,
        to: [RECIPIENT, { address: "bruno@example.test" }],
      }),
    ).resolves.toBeUndefined();
    expect(server.messages).toHaveLength(1);
  });

  it("29: sends with tags, and drops them", async () => {
    const server = await startServer();

    await senderOn(server).send(MESSAGE, {
      tags: { campaign: "spring-marker" },
    });

    const { raw } = onlyReceived(server);
    expect(raw).not.toMatch(/campaign/i);
    expect(raw).not.toMatch(/spring-marker/i);
  });

  it.each([
    ["CRLF", "Welcome\r\nBcc: attacker@evil.test"],
    ["LF", "Welcome\nBcc: attacker@evil.test"],
  ])(
    "30: keeps a line break (%s) in the subject from starting a header",
    async (_label, subject) => {
      const server = await startServer();

      await senderOn(server).send({ ...MESSAGE, subject });

      const { envelope, raw } = onlyReceived(server);
      expect(headerValues(raw, "Subject")).toHaveLength(1);
      expect(headerValues(raw, "Bcc")).toEqual([]);
      expect(envelope.to).toEqual(["anna@example.test"]);
    },
  );

  describe("31: always a rejection", () => {
    it.each([
      ["an empty to", { ...MESSAGE, to: [] }],
      [
        "a refused address",
        { ...MESSAGE, to: { address: "a,b@example.test" } },
      ],
      ["no sender", { to: RECIPIENT, subject: "Welcome", text: "Hello" }],
    ])(
      "31: returns a promise that rejects for %s, and does not throw",
      async (_label, message) => {
        const sender = senderOn(await idleServer());
        let result: Promise<void> | undefined;

        expect(() => {
          result = sender.send(message);
        }).not.toThrow();

        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toBeInstanceOf(InvalidEmailMessageError);
      },
    );

    it("31: rejects with what a getter of the caller's throws, does not throw, and sends nothing", async () => {
      const sender = senderOn(await idleServer());
      const thrown = new Error("the read of to failed");
      const message = {
        get to(): never {
          throw thrown;
        },
        from: SENDER,
        subject: "Welcome",
        text: "Hello",
      };
      let result: Promise<void> | undefined;

      expect(() => {
        result = sender.send(message);
      }).not.toThrow();

      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toBe(thrown);
    });
  });

  describe("32: the error classes", () => {
    const ERRORS: readonly (readonly [
      string,
      abstract new (...args: never[]) => BaseError,
      string,
      () => Promise<unknown>,
    ])[] = [
      [
        "InvalidEmailSenderOptionsError",
        InvalidEmailSenderOptionsError,
        "INVALID_EMAIL_SENDER_OPTIONS",
        async () => {
          const server = await startServer();
          return thrownBy(
            () =>
              new NodemailerEmailSender({
                transport: server.transportOptions,
                defaultFrom: { address: "a,b@example.test" },
              }),
            InvalidEmailSenderOptionsError,
          );
        },
      ],
      [
        "InvalidEmailMessageError",
        InvalidEmailMessageError,
        "INVALID_EMAIL_MESSAGE",
        async () =>
          reasonOf(senderOn(await idleServer()).send({ ...MESSAGE, to: [] })),
      ],
      [
        "EmailRecipientsRefusedError",
        EmailRecipientsRefusedError,
        "EMAIL_RECIPIENTS_REFUSED",
        async () =>
          reasonOf(
            senderOn(await startServer()).send({
              ...MESSAGE,
              to: [RECIPIENT, { address: "bob@refused.test" }],
            }),
          ),
      ],
    ];

    it.each(ERRORS)(
      "32: %s is an instance of its class and of BaseError, with its name and code",
      async (name, errorClass, code, produce) => {
        const error = await produce();

        expect(error).toBeInstanceOf(errorClass);
        expect(error).toBeInstanceOf(BaseError);
        expect((error as BaseError).name).toBe(name);
        expect((error as BaseError).code).toBe(code);
      },
    );
  });

  it("33: the entry point exports exactly the sender and the three errors at run time", () => {
    expect(Object.keys(entryPoint).sort()).toEqual(
      [
        "NodemailerEmailSender",
        "InvalidEmailSenderOptionsError",
        "InvalidEmailMessageError",
        "EmailRecipientsRefusedError",
      ].sort(),
    );
  });
});
