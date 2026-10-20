import {
  EmailRecipientsRefusedError,
  EmailSendFailedError,
  InvalidEmailMessageError,
} from "@enardo/email";
import type { EmailErrorCause, EmailMessage } from "@enardo/email";
import { BaseError } from "@enardo/errors";
import { describe, expect, it } from "vitest";
import * as entryPoint from "~/index";
import { InvalidEmailSenderOptionsError, NodemailerEmailSender } from "~/index";
import {
  ADDRESS_MARKERS,
  rejectionOf,
  thrownBy,
  unprintedRejectionOf,
} from "./support/assertions";
import { headerValues, mailboxesOf } from "./support/headers";
import { rejectingWith, withThrowingGetter } from "./support/rejections";
import {
  onlyReceived,
  startClosedSmtpServer,
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

  // [number, outcome, domain, the retryable of the refused recipient]
  const ONE_OF_TWO: readonly (readonly [string, string, string, boolean])[] = [
    ["22", "refused (550)", "refused.test", false],
    ["23", "deferred (450)", "deferred.test", true],
  ];

  describe.each(ONE_OF_TWO)(
    "%s: one of two recipients %s",
    (number, _outcome, domain, retryable) => {
      it(`${number}: rejects with EmailRecipientsRefusedError, naming index 1, once the message was sent to the other`, async () => {
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
        expect(error.details).toStrictEqual({
          refused: [{ index: 1, retryable }],
        });
        expect(server.commands).toContain("DATA");
        expect(server.messages).toHaveLength(1);
        const serialized = JSON.stringify(error.toJSON());
        expect(serialized).not.toContain("kept-one");
        expect(serialized).not.toContain("dropped-one");
      });
    },
  );

  it("24: rejects with EmailRecipientsRefusedError when the relay refuses every recipient, and sends no DATA", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        to: { address: "bob@refused.test" },
      }),
      EmailRecipientsRefusedError,
    );

    expect(error.code).toBe("EMAIL_RECIPIENTS_REFUSED");
    expect(error.details).toStrictEqual({
      refused: [{ index: 0, retryable: false }],
    });
    expect(server.commands).not.toContain("DATA");
  });

  it("25: rejects with EmailSendFailedError, retryable, when the connection closes after DATA", async () => {
    const server = await startServer({ closeAfterData: true });

    const error = await rejectionOf(
      senderOn(server).send(MESSAGE),
      EmailSendFailedError,
    );

    expect(error.code).toBe("EMAIL_SEND_FAILED");
    expect(error.details).toStrictEqual({ retryable: true });
    expect(error.cause).toStrictEqual({ code: "ECONNECTION", command: "CONN" });
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

  describe("32: the error class", () => {
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

  it("33: the entry point exports exactly the sender and its options error at run time", () => {
    expect(Object.keys(entryPoint).sort()).toEqual(
      ["NodemailerEmailSender", "InvalidEmailSenderOptionsError"].sort(),
    );
  });

  // The cases of feature/email/send-errors: the contract's errors, which
  // name the refused recipients by index and say whether a retry may
  // succeed, and a cause that keeps nodemailer's identifiers only.

  it("57: names a refused and a deferred recipient by index, in order, once the message was sent to the other", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        to: [
          { address: "anna@example.test" },
          { address: "bruno@refused.test" },
          { address: "carla@deferred.test" },
        ],
      }),
      EmailRecipientsRefusedError,
    );

    expect(error.details).toStrictEqual({
      refused: [
        { index: 1, retryable: false },
        { index: 2, retryable: true },
      ],
    });
    expect(server.messages).toHaveLength(1);
  });

  // nodemailer's own responseCode is the deferred recipient's 450: a
  // retryable read from it would give true to both.
  it("58: names every recipient, each with its own retryable, when the relay refuses one and defers the other, and sends no DATA", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        to: [
          { address: "bruno@refused.test" },
          { address: "carla@deferred.test" },
        ],
      }),
      EmailRecipientsRefusedError,
    );

    expect(error.details).toStrictEqual({
      refused: [
        { index: 0, retryable: false },
        { index: 1, retryable: true },
      ],
    });
    expect(server.commands).not.toContain("DATA");
  });

  // nodemailer lowercases the domain, and sends an exact duplicate once: the
  // envelope holds bob@refused.test once, and Bob@refused.test. A match on
  // the exact address misses index 1; one that stops at the first index
  // misses 2.
  it("60: matches each refused address to every index of to with its envelope form", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        to: [
          { address: "anna@example.test" },
          { address: "bob@Refused.TEST" },
          { address: "bob@refused.test" },
          { address: "Bob@refused.test" },
        ],
      }),
      EmailRecipientsRefusedError,
    );

    expect(error.details).toStrictEqual({
      refused: [
        { index: 1, retryable: false },
        { index: 2, retryable: false },
        { index: 3, retryable: false },
      ],
    });
  });

  it("61: rejects with EmailSendFailedError, not retryable, when the relay refuses the sender, and keeps its address out", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        from: { address: "victim@refused.test" },
      }),
      EmailSendFailedError,
    );

    expect(error.code).toBe("EMAIL_SEND_FAILED");
    expect(error.details).toStrictEqual({ retryable: false });
    expect(error.cause).toStrictEqual({
      code: "EENVELOPE",
      command: "MAIL FROM",
      responseCode: 550,
    });
    // The server's answer echoes the address.
    expect(JSON.stringify(error.toJSON())).not.toMatch(ADDRESS_MARKERS);
  });

  it("62: rejects with EmailSendFailedError, retryable, when the relay defers the sender (451)", async () => {
    const server = await startServer();

    const error = await rejectionOf(
      senderOn(server).send({
        ...MESSAGE,
        from: { address: "noreply@deferred.test" },
      }),
      EmailSendFailedError,
    );

    expect(error.details).toStrictEqual({ retryable: true });
    expect(error.cause).toStrictEqual({
      code: "EENVELOPE",
      command: "MAIL FROM",
      responseCode: 451,
    });
  });

  it("63: rejects with EmailSendFailedError, retryable, when nothing listens on the port", async () => {
    const closed = await startClosedSmtpServer();

    const error = await rejectionOf(
      senderOn(closed).send(MESSAGE),
      EmailSendFailedError,
    );

    expect(error.details).toStrictEqual({ retryable: true });
    expect(error.cause).toStrictEqual({
      code: "ESOCKET",
      command: "CONN",
      originalCode: "ECONNREFUSED",
    });
  });

  it("64: rejects with EmailSendFailedError, not retryable, over the transport's maxRecipients, and opens no connection", async () => {
    const server = await idleServer();
    const sender = new NodemailerEmailSender({
      transport: { ...server.transportOptions, maxRecipients: 1 },
    });

    const error = await rejectionOf(
      sender.send({
        ...MESSAGE,
        to: [RECIPIENT, { address: "bruno@example.test" }],
      }),
      EmailSendFailedError,
    );

    expect(error.details).toStrictEqual({ retryable: false });
    expect(error.cause).toStrictEqual({ code: "EMAXRECIPIENTS" });
  });

  describe("65: the rule of retryable", () => {
    // [the fields of the rejection, its retryable]: a 4xx reply is
    // retryable, a 5xx one is not, whatever the code; without either, a
    // connection that failed, timed out or was lost is, to the relay or to
    // what nodemailer reaches on the way (a proxy, an OAuth2 token endpoint),
    // by its `code` or its `originalCode`.
    const SYSTEM_CONNECTION_CODES = [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EPIPE",
    ];
    const RULES: readonly (readonly [EmailErrorCause, boolean])[] = [
      ...SYSTEM_CONNECTION_CODES.map((code) => [{ code }, true] as const),
      [
        { code: "EAUTH", command: "AUTH XOAUTH2", originalCode: "EFETCH" },
        true,
      ],
      [
        { code: "EAUTH", command: "AUTH PLAIN", originalCode: "ECONNRESET" },
        true,
      ],
      [
        {
          code: "EAUTH",
          command: "AUTH XOAUTH2",
          responseCode: 535,
          originalCode: "EFETCH",
        },
        false,
      ],
      [{ code: "EPROXY" }, false],
      [{ code: "ETLS", command: "CONN" }, false],
      [{ code: "EOAUTH2" }, false],
      [{ code: "ETIMEDOUT", command: "CONN" }, true],
      [{ code: "EDNS", command: "CONN", originalCode: "ENOTFOUND" }, true],
      [{ code: "ESOCKET", command: "CONN" }, true],
      [{ code: "EPROTOCOL", command: "CONN", responseCode: 421 }, true],
      [{ code: "EAUTH", command: "AUTH PLAIN", responseCode: 454 }, true],
      [{ code: "ECONNECTION", command: "CONN", responseCode: 221 }, true],
      [{ code: "ECONNECTION", command: "CONN", responseCode: 554 }, false],
      [{ code: "EMESSAGE", command: "DATA", responseCode: 554 }, false],
      [{ code: "EAUTH", command: "API" }, false],
      [{ code: "EPROTOCOL", command: "CONN" }, false],
    ];

    it.each(RULES)(
      "65: rejects an Error with %j as EmailSendFailedError, retryable %s, with those fields as cause",
      async (fields, retryable) => {
        const rejection = Object.assign(new Error("relay failed"), fields);
        const sender = new NodemailerEmailSender({
          transport: rejectingWith(await startServer(), rejection),
        });

        const error = await rejectionOf(
          sender.send(MESSAGE),
          EmailSendFailedError,
        );

        expect(error.details).toStrictEqual({ retryable });
        expect(error.cause).toStrictEqual(fields);
      },
    );
  });

  it("66: keeps nodemailer's identifiers only in the cause, and no address in the error", async () => {
    const rejection = Object.assign(
      new Error("Message failed: 554 refused for <victim@example.test>"),
      {
        code: "EMESSAGE",
        command: "DATA",
        responseCode: 554,
        originalCode: "EX",
        response: "554 5.7.1 <victim@example.test>: Message refused",
        rejected: ["victim@example.test"],
        hint: "victim",
      },
    );
    const sender = new NodemailerEmailSender({
      transport: rejectingWith(await startServer(), rejection),
    });

    const error = await rejectionOf(sender.send(MESSAGE), EmailSendFailedError);

    expect(error.cause).toStrictEqual({
      code: "EMESSAGE",
      command: "DATA",
      responseCode: 554,
      originalCode: "EX",
    });
    expect(JSON.stringify(error.toJSON())).not.toMatch(ADDRESS_MARKERS);
  });

  describe("67: a RCPT TO rejection, read", () => {
    // Each through getSocket, for a message to anna@example.test alone.

    /** Sets fields of the rejection, or makes one a getter that throws. */
    type Setup = (rejection: Error) => void;

    const set =
      (fields: Record<string, unknown>): Setup =>
      (rejection) => {
        Object.assign(rejection, fields);
      };
    const throwing =
      (key: string): Setup =>
      (rejection) => {
        withThrowingGetter(rejection, key);
      };
    const both =
      (...setups: readonly Setup[]): Setup =>
      (rejection) => {
        for (const setup of setups) {
          setup(rejection);
        }
      };

    /**
     * An Error like nodemailer's when the relay refuses every recipient:
     * `EENVELOPE`, `RCPT TO`, `550`, with `rejected` and `rejectedErrors`
     * as `setup` makes them.
     */
    function rcptToRejection(setup: Setup): Error {
      const rejection = Object.assign(
        new Error("Can't send mail - all recipients were rejected"),
        { code: "EENVELOPE", command: "RCPT TO", responseCode: 550 },
      );
      setup(rejection);
      return rejection;
    }

    /** Sends MESSAGE through a transport that rejects as `setup` says. */
    async function sendRejectedWith(setup: Setup): Promise<void> {
      const sender = new NodemailerEmailSender({
        transport: rejectingWith(await startServer(), rcptToRejection(setup)),
      });
      return sender.send(MESSAGE);
    }

    const ANNA_REJECTED = set({ rejected: ["anna@example.test"] });

    /** A Proxy on which every operation throws, `Array.isArray` included. */
    function revokedProxy(): unknown {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      return proxy;
    }

    it("67: names index 0, retryable, from the 450 of its entry in rejectedErrors over the rejection's 550", async () => {
      const error = await rejectionOf(
        sendRejectedWith(
          both(
            ANNA_REJECTED,
            set({
              rejectedErrors: [
                { recipient: "anna@example.test", responseCode: 450 },
              ],
            }),
          ),
        ),
        EmailRecipientsRefusedError,
      );

      expect(error.details).toStrictEqual({
        refused: [{ index: 0, retryable: true }],
      });
    });

    const NOT_RETRYABLE: readonly (readonly [string, Setup])[] = [
      [
        'a responseCode of "450"',
        set({
          rejectedErrors: [
            { recipient: "anna@example.test", responseCode: "450" },
          ],
        }),
      ],
      [
        "a 450 for another recipient",
        set({
          rejectedErrors: [
            { recipient: "other@example.test", responseCode: 450 },
          ],
        }),
      ],
      ["an empty list", set({ rejectedErrors: [] })],
      ["no rejectedErrors", () => undefined],
      ["a getter that throws", throwing("rejectedErrors")],
      ["a revoked Proxy", set({ rejectedErrors: revokedProxy() })],
    ];

    it.each(NOT_RETRYABLE)(
      "67: names index 0, not retryable, with rejectedErrors of %s",
      async (_label, setup) => {
        // Some rejections have a getter that throws: not to be printed.
        const error = await unprintedRejectionOf(
          sendRejectedWith(both(ANNA_REJECTED, setup)),
          EmailRecipientsRefusedError,
        );

        expect(error.details).toStrictEqual({
          refused: [{ index: 0, retryable: false }],
        });
      },
    );

    const UNREADABLE: readonly (readonly [string, Setup])[] = [
      [
        'rejected of ["stranger@example.test"]',
        set({ rejected: ["stranger@example.test"] }),
      ],
      ["rejected of [7]", set({ rejected: [7] })],
      ["rejected of []", set({ rejected: [] })],
      ['rejected of "x"', set({ rejected: "x" })],
      ["no rejected", () => undefined],
      ["a rejected getter that throws", throwing("rejected")],
      ["a rejected that is a revoked Proxy", set({ rejected: revokedProxy() })],
    ];

    it.each(UNREADABLE)(
      "67: rejects with EmailSendFailedError, not retryable, for %s",
      async (_label, setup) => {
        // Some rejections have a getter that throws: not to be printed.
        const error = await unprintedRejectionOf(
          sendRejectedWith(setup),
          EmailSendFailedError,
        );

        expect(error.details).toStrictEqual({ retryable: false });
        expect(error.cause).toStrictEqual({
          code: "EENVELOPE",
          command: "RCPT TO",
          responseCode: 550,
        });
      },
    );
  });

  it("68: rejects with EmailSendFailedError, retryable, when the proxy is down, and opens no connection to the SMTP server", async () => {
    const server = await idleServer();
    const proxy = await startClosedSmtpServer();
    const sender = new NodemailerEmailSender({
      transport: {
        ...server.transportOptions,
        proxy: `http://127.0.0.1:${proxy.port}`,
      },
    });

    const error = await rejectionOf(sender.send(MESSAGE), EmailSendFailedError);

    expect(error.details).toStrictEqual({ retryable: true });
    expect(error.cause).toStrictEqual({ code: "ECONNREFUSED" });
  });
});
