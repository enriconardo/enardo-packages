import { EventEmitter } from "node:events";
import type { EmailMessage } from "@enardo/email";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { describe, expect, it } from "vitest";
import { InvalidEmailSenderOptionsError, NodemailerEmailSender } from "~/index";
import type { NodemailerSmtpOptions } from "~/index";
import { ADDRESS_MARKERS, thrownBy } from "./support/assertions";
import { useIdleSmtpServers, useSmtpServers } from "./support/smtp-server";
import type {
  LocalSmtpServer,
  SmtpTransportOptions,
} from "./support/smtp-server";

const MESSAGE: EmailMessage = {
  to: { address: "anna@example.test", name: "Anna" },
  from: { address: "noreply@example.test", name: "Cambusa" },
  subject: "Welcome",
  text: "Hello",
};

/** Checks that `server` got the one message of MESSAGE, in one connection. */
function expectMessageReached(server: LocalSmtpServer): void {
  expect(server.connectionCount).toBe(1);
  expect(server.commands).toContain("MAIL FROM:<noreply@example.test>");
  expect(server.commands).toContain("RCPT TO:<anna@example.test>");
  expect(server.messages).toHaveLength(1);
}

describe("NodemailerEmailSender's constructor", () => {
  const startServer = useSmtpServers();
  // A server no sender may reach: checked once, after every test of the file.
  const idleServer = useIdleSmtpServers();

  it("1: builds a sender from { transport }, and a send reaches the SMTP server", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
    });

    await sender.send(MESSAGE);

    expectMessageReached(server);
  });

  describe("3: no transport", () => {
    it("3: refuses {}, in the types and at run time", () => {
      const error = thrownBy(
        // @ts-expect-error a sender needs a transport
        () => new NodemailerEmailSender({}),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "no-transport" });
    });

    it("3: refuses { defaultFrom } alone, in the types and at run time", () => {
      const defaultFrom = { address: "noreply@example.test" };

      const error = thrownBy(
        // @ts-expect-error a sender needs a transport
        () => new NodemailerEmailSender({ defaultFrom }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "no-transport" });
    });

    it("3: counts a transport set to undefined as absent (present: truthy)", () => {
      const options = { transport: undefined };

      const error = thrownBy(
        // @ts-expect-error a sender needs a transport
        () => new NodemailerEmailSender(options),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "no-transport" });
    });
  });

  it("5: refuses transport: { pool: true }, in the types and at run time, and opens no connection", async () => {
    const server = await idleServer();
    const transport = { ...server.transportOptions, pool: true };

    const error = thrownBy(
      // @ts-expect-error the type of transport refuses a pool
      () => new NodemailerEmailSender({ transport }),
      InvalidEmailSenderOptionsError,
    );

    expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
    expect(error.details).toStrictEqual({ reason: "pool" });
  });

  describe("6: a url that turns a pool on", () => {
    it("6: refuses transport: { url: …?pool=true }", async () => {
      const server = await startServer();
      const url = `smtp://127.0.0.1:${server.port}/?pool=true`;

      const error = thrownBy(
        () => new NodemailerEmailSender({ transport: { url } }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "pool" });
    });

    it("6: refuses transport: { url: …?pool=true, pool: false }", async () => {
      const server = await startServer();
      const url = `smtp://127.0.0.1:${server.port}/?pool=true`;

      const error = thrownBy(
        () => new NodemailerEmailSender({ transport: { url, pool: false } }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "pool" });
    });
  });

  it("7: builds a sender from transport: { pool: false }, which sends", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: { ...server.transportOptions, pool: false },
    });

    await sender.send(MESSAGE);

    expectMessageReached(server);
  });

  it("8: refuses a defaultFrom whose address is refused, and keeps the address out of the error", async () => {
    const server = await startServer();
    const defaultFrom = { address: "victim@example.test, attacker@evil.test" };

    const error = thrownBy(
      () =>
        new NodemailerEmailSender({
          transport: server.transportOptions,
          defaultFrom,
        }),
      InvalidEmailSenderOptionsError,
    );

    expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
    expect(error.details).toStrictEqual({ reason: "default-from" });
    expect(error.message).not.toMatch(ADDRESS_MARKERS);
    expect(JSON.stringify(error.toJSON())).not.toMatch(ADDRESS_MARKERS);
  });

  it("9: a transporter the sender created closes its socket after a send", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
    });

    await sender.send(MESSAGE);

    await expect(server.waitForClientClose()).resolves.toBeUndefined();
  });

  // The cases of the review follow-ups. Each value the types refuse goes
  // through a cast: these cases check the behavior at run time only.

  describe("45: a pool getter on transport", () => {
    /**
     * The options of a transport to `server`, whose `pool` is a getter that
     * answers `first` the first time it is read, and the opposite after.
     */
    function withShiftingPool(
      server: LocalSmtpServer,
      first: boolean,
    ): NodemailerSmtpOptions {
      let reads = 0;
      const transport = {
        ...server.transportOptions,
        get pool(): boolean {
          reads++;
          return reads === 1 ? first : !first;
        },
      };
      return transport as unknown as NodemailerSmtpOptions;
    }

    it("45: refuses a pool getter that answers true, then false", async () => {
      const server = await startServer();
      const transport = withShiftingPool(server, true);

      const error = thrownBy(
        () => new NodemailerEmailSender({ transport }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "pool" });
    });

    it("45: builds a sender on a pool getter that answers false, then true, which sends and closes its socket", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: withShiftingPool(server, false),
      });

      await sender.send(MESSAGE);

      expectMessageReached(server);
      await expect(server.waitForClientClose()).resolves.toBeUndefined();
    });
  });

  describe("46: present: truthy", () => {
    it.each([false, 0, ""])(
      "46: refuses { transport: %j } as no transport",
      (transport) => {
        const error = thrownBy(
          () => new NodemailerEmailSender({ transport: transport as never }),
          InvalidEmailSenderOptionsError,
        );

        expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
        expect(error.details).toStrictEqual({ reason: "no-transport" });
      },
    );
  });

  // The cases of the second review's follow-ups: options that nodemailer
  // reads, and that a copy of the own properties of transport would lose.

  describe("47: a transport whose options live on its prototype", () => {
    /**
     * An instance of a class whose `url` is a getter on its prototype: the
     * instance has no own property at all.
     */
    function onPrototype(url: string) {
      class PrototypeTransport {
        get url(): string {
          return url;
        }
      }
      const transport = new PrototypeTransport();
      // The premise of the case, not a rule of the sender.
      expect(Reflect.ownKeys(transport)).toEqual([]);
      return transport;
    }

    it("47: builds a sender from a class instance whose url getter points at the SMTP server, and a send reaches it", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: onPrototype(`smtp://127.0.0.1:${server.port}/`),
      });

      await sender.send(MESSAGE);

      expectMessageReached(server);
    });

    it("47: refuses a class instance whose url getter has ?pool=true, and opens no connection", async () => {
      const server = await idleServer();
      const transport = onPrototype(
        `smtp://127.0.0.1:${server.port}/?pool=true`,
      );

      const error = thrownBy(
        () => new NodemailerEmailSender({ transport }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "pool" });
    });
  });

  describe("48: a URL string as transport", () => {
    it("48: builds a sender from smtp://127.0.0.1:<port>/, and a send reaches the SMTP server", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: `smtp://127.0.0.1:${server.port}/` as never,
      });

      await sender.send(MESSAGE);

      expectMessageReached(server);
    });

    it("48: refuses smtp://127.0.0.1:<port>/?pool=true, and opens no connection", async () => {
      const server = await idleServer();
      const url = `smtp://127.0.0.1:${server.port}/?pool=true`;

      const error = thrownBy(
        () => new NodemailerEmailSender({ transport: url as never }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "pool" });
    });
  });

  // The case of checkpoint 2: the sender takes SMTP only. nodemailer builds
  // another transport from the same options when they carry its flag, and
  // takes an object with name, version and send as a plugin.

  describe("50: another transport", () => {
    // Each built in a variable: the types let it through, as they let a
    // caller's variable through.
    const OTHER_TRANSPORTS: readonly (readonly [
      string,
      (smtp: SmtpTransportOptions) => NodemailerSmtpOptions,
    ])[] = [
      [
        "streamTransport: true",
        (smtp) => {
          const transport = { ...smtp, streamTransport: true };
          return transport;
        },
      ],
      [
        "jsonTransport: true",
        (smtp) => {
          const transport = { ...smtp, jsonTransport: true };
          return transport;
        },
      ],
      [
        "sendmail: true",
        (smtp) => {
          const transport = { ...smtp, sendmail: true };
          return transport;
        },
      ],
    ];

    it.each(OTHER_TRANSPORTS)(
      "50: refuses SMTP options plus %s",
      async (_label, build) => {
        const server = await startServer();
        const transport = build(server.transportOptions);

        const error = thrownBy(
          () => new NodemailerEmailSender({ transport }),
          InvalidEmailSenderOptionsError,
        );

        expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
        expect(error.details).toStrictEqual({ reason: "not-smtp" });
      },
    );

    it("50, 55: refuses an object with name, version and send, and writes no mailer into it", () => {
      // Typed as unknown, so the cast below holds whatever the options'
      // type makes of a plugin.
      const plugin: unknown = {
        name: "test-plugin",
        version: "1.0.0",
        send(
          _mail: unknown,
          callback: (error: Error | null, info?: unknown) => void,
        ): void {
          callback(new Error("The plugin was not to be used"));
        },
      };

      const error = thrownBy(
        () =>
          new NodemailerEmailSender({
            transport: plugin as NodemailerSmtpOptions,
          }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "not-smtp" });
      // 55: nodemailer's Mail writes itself into a plugin it takes.
      expect(Object.hasOwn(plugin as object, "mailer")).toBe(false);
    });
  });

  // The cases of the fourth review's follow-ups. nodemailer takes any object
  // with a send function as a transport of its own, and writes into it: the
  // sender refuses such a transport before nodemailer sees it. The types
  // refuse each of these values, so each goes through a cast.

  describe("50 (extended): transport objects", () => {
    /** A subclass that sends nothing, and answers that nobody was refused. */
    class SilentTransport extends SMTPTransport {
      override send(
        _mail: Parameters<SMTPTransport["send"]>[0],
        callback: Parameters<SMTPTransport["send"]>[1],
      ): void {
        callback(null, {
          rejected: [],
        } as unknown as SMTPTransport.SentMessageInfo);
      }
    }

    // Each points at the test's idle server, through the options it holds.
    const TRANSPORT_OBJECTS: readonly (readonly [
      string,
      (server: LocalSmtpServer) => SMTPTransport,
    ])[] = [
      [
        "an SMTPTransport instance",
        (server) => new SMTPTransport(server.transportOptions),
      ],
      [
        "an instance of a subclass whose send sends nothing",
        (server) => new SilentTransport(server.transportOptions),
      ],
      [
        "a plain object whose prototype is SMTPTransport.prototype",
        (server) =>
          Object.setPrototypeOf(
            { ...server.transportOptions },
            SMTPTransport.prototype,
          ) as SMTPTransport,
      ],
    ];

    it.each(TRANSPORT_OBJECTS)(
      "50: refuses %s, and leaves it as it was",
      async (_label, build) => {
        const server = await idleServer();
        const transport = build(server);
        // The premises of the case, not rules of the sender: the object
        // passes an instanceof check, and nothing has written into it yet.
        expect(transport).toBeInstanceOf(SMTPTransport);
        expect(Object.hasOwn(transport, "mailer")).toBe(false);
        expect(transport.listenerCount("error")).toBe(0);

        const error = thrownBy(
          () =>
            new NodemailerEmailSender({
              transport: transport as unknown as NodemailerSmtpOptions,
            }),
          InvalidEmailSenderOptionsError,
        );

        expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
        expect(error.details).toStrictEqual({ reason: "not-smtp" });
        // nodemailer's Mail writes itself into the transport it takes, and
        // listens to its errors: neither may have happened since.
        expect(Object.hasOwn(transport, "mailer")).toBe(false);
        expect(transport.listenerCount("error")).toBe(0);
      },
    );
  });

  describe("51: a transport that is not options", () => {
    const NOT_OPTIONS: readonly (readonly [string, unknown])[] = [
      ['"smtp.example.com"', "smtp.example.com"],
      ["1", 1],
      ["true", true],
      ["a function", () => undefined],
    ];

    it.each(NOT_OPTIONS)(
      "51: refuses %s as not-smtp, with the sender's error rather than a native one",
      (_label, transport) => {
        const error = thrownBy(
          () =>
            new NodemailerEmailSender({
              transport: transport as NodemailerSmtpOptions,
            }),
          InvalidEmailSenderOptionsError,
        );

        expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
        expect(error.details).toStrictEqual({ reason: "not-smtp" });
      },
    );

    it("51: refuses a function before nodemailer writes into it", () => {
      const transport = (): void => undefined;

      thrownBy(
        () =>
          new NodemailerEmailSender({
            transport: transport as unknown as NodemailerSmtpOptions,
          }),
        InvalidEmailSenderOptionsError,
      );

      expect(Object.hasOwn(transport, "mailer")).toBe(false);
    });
  });

  // The cases of the fifth review's follow-ups. The types refuse each of
  // these values, so each goes through a cast.

  it("54: refuses a subclass of SMTPTransport whose send getter answers undefined, then a function", async () => {
    const server = await idleServer();
    const sendNothing: SMTPTransport["send"] = (_mail, callback) => {
      callback(null, {
        rejected: [],
      } as unknown as SMTPTransport.SentMessageInfo);
    };
    let reads = 0;
    class ShiftingTransport extends SMTPTransport {}
    // On the subclass's prototype, through defineProperty: the types refuse
    // an accessor in place of SMTPTransport's send method.
    Object.defineProperty(ShiftingTransport.prototype, "send", {
      configurable: true,
      get(): SMTPTransport["send"] | undefined {
        reads++;
        return reads === 1 ? undefined : sendNothing;
      },
    });
    const transport = new ShiftingTransport(server.transportOptions);
    // The premise of the case, not a rule of the sender: nothing has read
    // send yet, so the sender's read is the first.
    expect(reads).toBe(0);

    const error = thrownBy(
      () =>
        new NodemailerEmailSender({
          transport: transport as unknown as NodemailerSmtpOptions,
        }),
      InvalidEmailSenderOptionsError,
    );

    expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
    expect(error.details).toStrictEqual({ reason: "not-smtp" });
  });

  describe("55: objects that are not SMTPTransport", () => {
    it("55: refuses an EventEmitter with a send method, and leaves it as it was", () => {
      const emitter = Object.assign(new EventEmitter(), {
        send(): void {
          // Never reached: nothing is sent through a refused transport.
        },
      });
      // The premise of the case, not a rule of the sender: nothing has
      // written into the emitter yet.
      expect(Object.hasOwn(emitter, "mailer")).toBe(false);
      expect(emitter.listenerCount("error")).toBe(0);

      const error = thrownBy(
        () =>
          new NodemailerEmailSender({
            transport: emitter as unknown as NodemailerSmtpOptions,
          }),
        InvalidEmailSenderOptionsError,
      );

      expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
      expect(error.details).toStrictEqual({ reason: "not-smtp" });
      // nodemailer's Mail writes itself into the transport it takes, and
      // listens to its errors: neither may have happened.
      expect(Object.hasOwn(emitter, "mailer")).toBe(false);
      expect(emitter.listenerCount("error")).toBe(0);
    });
  });

  describe("56: URL strings", () => {
    const ACCEPTED_URLS: readonly (readonly [
      string,
      (port: number) => string,
    ])[] = [
      ["SMTP://127.0.0.1:<port>/", (port) => `SMTP://127.0.0.1:${port}/`],
      ["SMTPS://127.0.0.1:<port>/", (port) => `SMTPS://127.0.0.1:${port}/`],
      ["smtps://127.0.0.1:<port>/", (port) => `smtps://127.0.0.1:${port}/`],
    ];

    it.each(ACCEPTED_URLS)(
      "56: builds a sender from %s, and opens no connection",
      async (_label, build) => {
        const server = await idleServer();

        const sender = new NodemailerEmailSender({
          transport: build(server.port) as never,
        });

        expect(sender).toBeInstanceOf(NodemailerEmailSender);
      },
    );

    it.each(["direct:?name=x", "DIRECT:?name=x"])(
      "56: refuses %s as not-smtp",
      (url) => {
        const error = thrownBy(
          () => new NodemailerEmailSender({ transport: url as never }),
          InvalidEmailSenderOptionsError,
        );

        expect(error.code).toBe("INVALID_EMAIL_SENDER_OPTIONS");
        expect(error.details).toStrictEqual({ reason: "not-smtp" });
      },
    );
  });
});
