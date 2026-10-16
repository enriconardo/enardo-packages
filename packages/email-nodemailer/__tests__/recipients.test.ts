import { setTimeout as delay } from "node:timers/promises";
import type { EmailMessage, EmailRecipient } from "@enardo/email";
import { describe, expect, it } from "vitest";
import {
  InvalidEmailMessageError,
  InvalidEmailSenderOptionsError,
  NodemailerEmailSender,
} from "~/index";
import { ADDRESS_MARKERS, rejectionOf, thrownBy } from "./support/assertions";
import {
  createRandom,
  generateAddress,
  mutateAddress,
  withLowercaseDomain,
} from "./support/addresses";
import { headerValues, mailboxesOf, parseMailboxes } from "./support/headers";
import {
  onlyReceived,
  useIdleSmtpServers,
  useSmtpServers,
} from "./support/smtp-server";
import type { LocalSmtpServer } from "./support/smtp-server";

const RECIPIENT = { address: "anna@example.test" };
const SENDER = { address: "noreply@example.test" };

function messageWith(fields: Partial<EmailMessage>): EmailMessage {
  return {
    to: RECIPIENT,
    from: SENDER,
    subject: "Welcome",
    text: "Hello",
    ...fields,
  };
}

function senderOn(server: LocalSmtpServer): NodemailerEmailSender {
  return new NodemailerEmailSender({ transport: server.transportOptions });
}

type Field = "to" | "from" | "replyTo";

const HEADER_OF: Record<Field, string> = {
  to: "To",
  from: "From",
  replyTo: "Reply-To",
};

/** A message with `recipient` in `field`, and the defaults elsewhere. */
function messageWithRecipientIn(
  field: Field,
  recipient: EmailRecipient,
): EmailMessage {
  switch (field) {
    case "to":
      return messageWith({ to: recipient });
    case "from":
      return messageWith({ from: recipient });
    case "replyTo":
      return messageWith({ replyTo: recipient });
  }
}

/**
 * The envelope of a message with `address` in `field`: the address itself
 * as the one recipient for `to`, as the sender for `from`, and the defaults
 * for `replyTo`, which is not in the envelope.
 */
function envelopeWith(field: Field, address: string): object {
  return {
    from: field === "from" ? address : SENDER.address,
    to: [field === "to" ? address : RECIPIENT.address],
  };
}

describe("recipients", () => {
  const startServer = useSmtpServers();
  // A server no sender may reach: checked once, after every test of the file.
  const idleServer = useIdleSmtpServers();

  // Each name comes back exactly as given, once the header's encoded words
  // are decoded. That is what rules out a mailbox written as a string with
  // the name quoted and escaped: nodemailer turns a line break inside the
  // quotes into a space.
  describe("11: names", () => {
    const NAMES = [
      `x" <attacker@evil.test>, "y`,
      "Rossi, Mario",
      "Anna; Bcc: attacker@evil.test",
      "Anna\r\nBcc: attacker@evil.test",
      "Anna\nBcc: attacker@evil.test",
      "Zoë <z>",
      "日本語",
    ];
    const ADDRESS_IN: Record<Field, string> = {
      to: "victim@example.test",
      from: "noreply@example.test",
      replyTo: "support@example.test",
    };

    describe.each(["to", "from", "replyTo"] as const)("on %s", (field) => {
      it.each(NAMES)(
        `11: keeps the name %j on ${field} out of the envelope and the header syntax, and sends it as it is`,
        async (name) => {
          const server = await startServer();
          const address = ADDRESS_IN[field];

          await senderOn(server).send(
            messageWithRecipientIn(field, { address, name }),
          );

          const { envelope, raw } = onlyReceived(server);
          expect(envelope).toEqual(envelopeWith(field, address));
          expect(mailboxesOf(raw, HEADER_OF[field])).toEqual([
            { name, address },
          ]);
          expect(headerValues(raw, "Bcc")).toEqual([]);
        },
      );
    });
  });

  describe("12: trimming", () => {
    describe.each(["to", "from", "replyTo"] as const)("on %s", (field) => {
      it(`12: trims the name on ${field}`, async () => {
        const server = await startServer();
        const address = "mario@example.test";

        await senderOn(server).send(
          messageWithRecipientIn(field, { address, name: "  Mario Rossi  " }),
        );

        expect(mailboxesOf(onlyReceived(server).raw, HEADER_OF[field])).toEqual(
          [{ name: "Mario Rossi", address }],
        );
      });

      it(`12: writes a blank name on ${field} as the bare address`, async () => {
        const server = await startServer();
        const address = "mario@example.test";

        await senderOn(server).send(
          messageWithRecipientIn(field, { address, name: "   " }),
        );

        expect(
          headerValues(onlyReceived(server).raw, HEADER_OF[field]),
        ).toEqual([address]);
      });
    });

    it("12: trims the name of defaultFrom", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: server.transportOptions,
        defaultFrom: { address: "noreply@example.test", name: "  Cambusa  " },
      });

      await sender.send({ to: RECIPIENT, subject: "Welcome", text: "Hello" });

      expect(mailboxesOf(onlyReceived(server).raw, "From")).toEqual([
        { name: "Cambusa", address: "noreply@example.test" },
      ]);
    });

    it("12: writes a blank name of defaultFrom as the bare address", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: server.transportOptions,
        defaultFrom: { address: "noreply@example.test", name: "   " },
      });

      await sender.send({ to: RECIPIENT, subject: "Welcome", text: "Hello" });

      expect(headerValues(onlyReceived(server).raw, "From")).toEqual([
        "noreply@example.test",
      ]);
    });
  });

  describe("13: accepted addresses", () => {
    const ACCEPTED = [
      "anna@example.test",
      "Anna.Rossi@Example.TEST",
      "a!#$%&'*+/=?^_`{|}~-x@example.test",
      "a.b.c@example.test",
      "a@mail-1.example-2.test",
      "a@123.example.test",
      "a@xn--jgeva-dua.ee",
      "a@XN--JGEVA-DUA.EE",
      "a@localhost",
    ];

    describe.each(["to", "from", "replyTo"] as const)("on %s", (field) => {
      it.each(ACCEPTED)(
        `13: sends %j on ${field} as given, but for the case of the domain`,
        async (address) => {
          const server = await startServer();
          const expected = withLowercaseDomain(address);

          await senderOn(server).send(
            messageWithRecipientIn(field, { address }),
          );

          const { envelope, raw } = onlyReceived(server);
          expect(envelope).toEqual(envelopeWith(field, expected));
          expect(
            mailboxesOf(raw, HEADER_OF[field]).map(
              (mailbox) => mailbox.address,
            ),
          ).toEqual([expected]);
        },
      );
    });
  });

  describe("14: refused addresses", () => {
    const REFUSED = [
      "victim@example.test, attacker@evil.test",
      "a,attacker@evil.test",
      "x>attacker@evil.test",
      "x>,attacker@evil.test",
      "a@b@evil.test",
      '"a b"@example.test',
      "a..b@example.test",
      ".a@example.test",
      "a.@example.test",
      "a(comment)@example.test",
      "user@123",
      "user@1.2.3",
      "user@0x7f.1",
      "user@example.123",
      "a@-x.test",
      "a@x-.test",
      "a@x_y.test",
      "a@example.test.",
      "a@example..test",
      "a@ex ample.test",
      " a@example.test ",
      "a@example.test\r\nBcc: x@evil.test",
      "",
      "noat",
      "user@jõgeva.ee",
      "jõ@example.test",
      "a@ｅｘａｍｐｌｅ.test",
      "user@[127.0.0.1]",
    ];

    const PLACEMENTS: readonly (readonly [
      string,
      (address: string) => EmailMessage,
      object,
    ])[] = [
      [
        "alone in to",
        (address) => messageWith({ to: { address } }),
        { field: "to", reason: "address", index: 0 },
      ],
      [
        "at index 1 of to",
        (address) => messageWith({ to: [RECIPIENT, { address }] }),
        { field: "to", reason: "address", index: 1 },
      ],
      [
        "in from",
        (address) => messageWith({ from: { address } }),
        { field: "from", reason: "address" },
      ],
      [
        "in replyTo",
        (address) => messageWith({ replyTo: { address } }),
        { field: "replyTo", reason: "address" },
      ],
    ];

    describe.each(PLACEMENTS)("%s", (placement, build, details) => {
      it.each(REFUSED)(
        `14: refuses %j ${placement}, before sending, and keeps it out of the error`,
        async (address) => {
          const server = await idleServer();

          const error = await rejectionOf(
            senderOn(server).send(build(address)),
            InvalidEmailMessageError,
          );

          expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
          expect(error.details).toStrictEqual(details);
          expect(JSON.stringify(error.toJSON())).not.toMatch(ADDRESS_MARKERS);
        },
      );
    });
  });

  it("15: sends 500 generated addresses of the grammar as they are, but for the case of the domain", async () => {
    const random = createRandom(15);
    const server = await startServer();
    const sender = senderOn(server);
    const mismatches: unknown[] = [];

    for (let index = 0; index < 500; index++) {
      const address = generateAddress(random);
      const expected = withLowercaseDomain(address);
      const before = server.messages.length;

      await sender.send(messageWith({ to: { address } }));

      const received = server.messages.slice(before);
      const envelope = received[0]?.envelope.to;
      const header = received.map((message) =>
        headerValues(message.raw, "To").map((value) =>
          parseMailboxes(value).map((mailbox) => mailbox.address),
        ),
      );
      const got = { sends: received.length, envelope, header };
      const want = { sends: 1, envelope: [expected], header: [[[expected]]] };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push({ address, got, want });
      }
    }

    expect(mismatches).toEqual([]);
  }, 60_000);

  it("16: either refuses a mutated address, or sends it as it is, but for the case of the domain", async () => {
    const random = createRandom(16);
    const server = await startServer();
    const sender = senderOn(server);
    let refused = 0;
    let sent = 0;

    for (let index = 0; index < 2000; index++) {
      const address = mutateAddress(random, generateAddress(random));
      const before = server.messages.length;
      const connectionsBefore = server.connectionCount;

      const outcome = await sender.send(messageWith({ to: { address } })).then(
        () => ({ sent: true as const }),
        (error: unknown) => ({ sent: false as const, error }),
      );

      const label = `the address ${JSON.stringify(address)}`;
      if (outcome.sent) {
        sent++;
        expect(
          server.messages.slice(before).map((message) => message.envelope.to),
          label,
        ).toEqual([[withLowercaseDomain(address)]]);
      } else {
        refused++;
        expect(outcome.error, label).toBeInstanceOf(InvalidEmailMessageError);
        expect(
          (outcome.error as InvalidEmailMessageError).details,
          label,
        ).toStrictEqual({ field: "to", reason: "address", index: 0 });
        expect(server.connectionCount, label).toBe(connectionsBefore);
      }
    }

    expect(refused).toBeGreaterThanOrEqual(100);
    expect(sent).toBeGreaterThanOrEqual(100);
    // A refused address sent late would show here: one connection, and one
    // message, per address sent.
    await delay(200);
    expect(server.connectionCount).toBe(sent);
    expect(server.messages).toHaveLength(sent);
  }, 60_000);

  describe("17: nothing written into the caller's values", () => {
    it("17: sends a message frozen deep, with frozen options, to the right envelope", async () => {
      const server = await startServer();
      const message: EmailMessage = Object.freeze({
        to: Object.freeze([
          Object.freeze({ address: "anna@example.test", name: "Anna" }),
          Object.freeze({ address: "bruno@example.test" }),
        ]),
        from: Object.freeze({
          address: "noreply@example.test",
          name: "Cambusa",
        }),
        replyTo: Object.freeze({ address: "support@example.test" }),
        subject: "Welcome",
        text: "Hello",
        html: "<p>Hello</p>",
      });
      const options = Object.freeze({
        tags: Object.freeze({ campaign: "spring" }),
      });

      await senderOn(server).send(message, options);

      expect(onlyReceived(server).envelope).toEqual({
        from: "noreply@example.test",
        to: ["anna@example.test", "bruno@example.test"],
      });
    });

    it("17: leaves an unfrozen message and its options as they were", async () => {
      const server = await startServer();
      const message = {
        to: [
          { address: "anna@example.test", name: "  Anna  " },
          { address: "bruno@example.test" },
          { address: "carla@Example.TEST", name: "   " },
        ],
        from: { address: "noreply@example.test", name: "Cambusa" },
        replyTo: { address: "support@example.test" },
        subject: "Welcome",
        text: "Hello",
        html: "<p>Hello</p>",
      };
      const options = { tags: { campaign: "spring" } };
      const messageBefore = structuredClone(message);
      const optionsBefore = structuredClone(options);

      await senderOn(server).send(message, options);

      expect(server.messages).toHaveLength(1);
      expect(message).toStrictEqual(messageBefore);
      expect(options).toStrictEqual(optionsBefore);
    });
  });

  // The cases of the review follow-ups: values the types refuse, read more
  // than once, so that what was checked is not what is sent. Each goes
  // through a cast, and each case checks the behavior at run time only.

  describe("41: entries that are not mailboxes", () => {
    /** A list of `length` entries, with `entries` first and holes after. */
    function listWithHoles(
      length: number,
      entries: readonly EmailRecipient[],
    ): EmailRecipient[] {
      const list = new Array<EmailRecipient>(length);
      entries.forEach((entry, index) => {
        list[index] = entry;
      });
      return list;
    }

    const CASES: readonly (readonly [string, () => EmailMessage, object])[] = [
      [
        "to: new Array(1)",
        () => messageWith({ to: listWithHoles(1, []) }),
        { field: "to", reason: "address", index: 0 },
      ],
      [
        "to: [RECIPIENT, <hole>]",
        () => messageWith({ to: listWithHoles(2, [RECIPIENT]) }),
        { field: "to", reason: "address", index: 1 },
      ],
      [
        "to: [null]",
        () => messageWith({ to: [null as unknown as EmailRecipient] }),
        { field: "to", reason: "address", index: 0 },
      ],
      [
        'to: ["a@example.test"]',
        () =>
          messageWith({ to: ["a@example.test" as unknown as EmailRecipient] }),
        { field: "to", reason: "address", index: 0 },
      ],
      [
        'to: "a@example.test"',
        () => messageWith({ to: "a@example.test" as never }),
        { field: "to", reason: "address", index: 0 },
      ],
      [
        'from: "a@example.test"',
        () => messageWith({ from: "a@example.test" as never }),
        { field: "from", reason: "address" },
      ],
      [
        "replyTo: 42",
        () => messageWith({ replyTo: 42 as never }),
        { field: "replyTo", reason: "address" },
      ],
    ];

    it.each(CASES)(
      "41: refuses %s, before sending",
      async (_label, build, details) => {
        const server = await idleServer();

        const error = await rejectionOf(
          senderOn(server).send(build()),
          InvalidEmailMessageError,
        );

        expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
        expect(error.details).toStrictEqual(details);
      },
    );
  });

  it("42: refuses a to whose length answers 1, then 0, before sending", async () => {
    const server = await idleServer();
    let lengthReads = 0;
    const to = new Proxy<EmailRecipient[]>([], {
      get(target, key, receiver) {
        if (key === "length") {
          lengthReads++;
          return lengthReads === 1 ? 1 : 0;
        }
        const value: unknown = Reflect.get(target, key, receiver);
        return value;
      },
    });

    const error = await rejectionOf(
      senderOn(server).send(messageWith({ to })),
      InvalidEmailMessageError,
    );

    expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
    expect(error.details.field).toBe("to");
  });

  describe("43: a non-string address", () => {
    /**
     * An address whose `toString` answers an accepted address the first
     * time, and a list of two after.
     */
    function shiftingAddress(): string {
      let calls = 0;
      const address = {
        toString(): string {
          calls++;
          return calls === 1
            ? "ok@example.test"
            : "victim@example.test, attacker@evil.test";
        },
      };
      return address as unknown as string;
    }

    const DETAILS: Record<Field, object> = {
      to: { field: "to", reason: "address", index: 0 },
      from: { field: "from", reason: "address" },
      replyTo: { field: "replyTo", reason: "address" },
    };

    it.each(["to", "from", "replyTo"] as const)(
      "43: refuses an address whose toString changes, on %s, before sending",
      async (field) => {
        const server = await idleServer();

        const error = await rejectionOf(
          senderOn(server).send(
            messageWithRecipientIn(field, { address: shiftingAddress() }),
          ),
          InvalidEmailMessageError,
        );

        expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
        expect(error.details).toStrictEqual(DETAILS[field]);
        expect(JSON.stringify(error.toJSON())).not.toMatch(ADDRESS_MARKERS);
      },
    );

    it("43: refuses a defaultFrom whose address's toString changes", async () => {
      const server = await startServer();
      const defaultFrom = { address: shiftingAddress() };

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
    });

    it("43: refuses the address 42 in to, before sending", async () => {
      const server = await idleServer();

      const error = await rejectionOf(
        senderOn(server).send(
          messageWith({ to: { address: 42 as unknown as string } }),
        ),
        InvalidEmailMessageError,
      );

      expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
      expect(error.details).toStrictEqual({
        field: "to",
        reason: "address",
        index: 0,
      });
    });
  });

  describe("44: a non-string name", () => {
    /**
     * A name whose `toString` answers `Anna` the first time, and a list of
     * mailboxes after, with a `trim` that returns the name itself.
     */
    function shiftingName(): string {
      let calls = 0;
      const name = {
        toString(): string {
          calls++;
          return calls === 1 ? "Anna" : `x" <attacker@evil.test>, "y`;
        },
        trim(): unknown {
          return name;
        },
      };
      return name as unknown as string;
    }

    const NAMES: readonly (readonly [string, () => string])[] = [
      ["an object whose toString changes", shiftingName],
      ["the number 42", () => 42 as unknown as string],
    ];

    it.each(NAMES)(
      "44: sends to a recipient named with %s, as the bare address",
      async (_label, name) => {
        const server = await startServer();

        await senderOn(server).send(
          messageWith({ to: { address: RECIPIENT.address, name: name() } }),
        );

        const { envelope, raw } = onlyReceived(server);
        expect(envelope).toEqual(envelopeWith("to", RECIPIENT.address));
        expect(headerValues(raw, "To")).toEqual([RECIPIENT.address]);
        expect(headerValues(raw, "Bcc")).toEqual([]);
        expect(raw).not.toContain("attacker");
      },
    );
  });

  // The case of the third review: a from or replyTo is absent when it is
  // undefined only. Any other value, a falsy one included, is checked as a
  // mailbox, and refused when it is not one.
  describe("49: a falsy from or replyTo", () => {
    const DEFAULT_FROM = { address: "team@example.test", name: "Team" };

    // [label, value]: each value goes through a cast, since the types refuse it.
    const FALSY: readonly (readonly [string, unknown])[] = [
      ['""', ""],
      ["0", 0],
      ["false", false],
      ["null", null],
      ["NaN", NaN],
    ];

    it.each(FALSY)(
      "49: refuses from: %s, with a defaultFrom, before sending",
      async (_label, from) => {
        const server = await idleServer();
        const sender = new NodemailerEmailSender({
          transport: server.transportOptions,
          defaultFrom: DEFAULT_FROM,
        });

        const error = await rejectionOf(
          sender.send(messageWith({ from: from as never })),
          InvalidEmailMessageError,
        );

        expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
        expect(error.details).toStrictEqual({
          field: "from",
          reason: "address",
        });
      },
    );

    it.each(FALSY)(
      "49: refuses from: %s, without a defaultFrom, before sending",
      async (_label, from) => {
        const server = await idleServer();

        const error = await rejectionOf(
          senderOn(server).send(messageWith({ from: from as never })),
          InvalidEmailMessageError,
        );

        expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
        expect(error.details).toStrictEqual({
          field: "from",
          reason: "address",
        });
      },
    );

    it.each(FALSY)(
      "49: refuses replyTo: %s, before sending",
      async (_label, replyTo) => {
        const server = await idleServer();

        const error = await rejectionOf(
          senderOn(server).send(messageWith({ replyTo: replyTo as never })),
          InvalidEmailMessageError,
        );

        expect(error.code).toBe("INVALID_EMAIL_MESSAGE");
        expect(error.details).toStrictEqual({
          field: "replyTo",
          reason: "address",
        });
      },
    );

    it("49: sends from defaultFrom when from is undefined", async () => {
      const server = await startServer();
      const sender = new NodemailerEmailSender({
        transport: server.transportOptions,
        defaultFrom: DEFAULT_FROM,
      });

      await sender.send({
        to: RECIPIENT,
        from: undefined,
        subject: "Welcome",
        text: "Hello",
      });

      const { envelope, raw } = onlyReceived(server);
      expect(envelope.from).toBe("team@example.test");
      expect(mailboxesOf(raw, "From")).toEqual([
        { name: "Team", address: "team@example.test" },
      ]);
    });

    it("49: sends with no Reply-To header when replyTo is undefined", async () => {
      const server = await startServer();

      await senderOn(server).send({
        to: RECIPIENT,
        from: SENDER,
        replyTo: undefined,
        subject: "Welcome",
        text: "Hello",
      });

      expect(headerValues(onlyReceived(server).raw, "Reply-To")).toEqual([]);
    });
  });

  // The cases of the fourth review's follow-ups: each address and name is
  // read once, so a getter cannot answer the check one way and nodemailer
  // another; and defaultFrom reaches nodemailer as a copy, which it may
  // write into.

  describe("52: read once", () => {
    const ADDRESS = "ok@example.test";

    /**
     * A recipient whose `address` is a getter: `ok@example.test` on the
     * first read, a list of two on every later one.
     */
    function withShiftingAddress(): EmailRecipient {
      let reads = 0;
      return {
        get address(): string {
          reads++;
          return reads === 1
            ? ADDRESS
            : "victim@example.test, attacker@evil.test";
        },
      };
    }

    /**
     * A recipient of `ok@example.test` whose `name` is a getter: `Anna` on
     * the first read, a list of mailboxes on every later one.
     */
    function withShiftingName(): EmailRecipient {
      let reads = 0;
      return {
        address: ADDRESS,
        get name(): string {
          reads++;
          return reads === 1 ? "Anna" : `x" <attacker@evil.test>, "y`;
        },
      };
    }

    it.each(["to", "from", "replyTo"] as const)(
      "52: sends the first answer of an address getter on %s, and nothing of the later ones",
      async (field) => {
        const server = await startServer();

        await senderOn(server).send(
          messageWithRecipientIn(field, withShiftingAddress()),
        );

        const { envelope, raw } = onlyReceived(server);
        expect(envelope).toEqual(envelopeWith(field, ADDRESS));
        expect(
          mailboxesOf(raw, HEADER_OF[field]).map((mailbox) => mailbox.address),
        ).toEqual([ADDRESS]);
        expect(raw).not.toMatch(ADDRESS_MARKERS);
      },
    );

    it.each(["to", "from", "replyTo"] as const)(
      "52: writes the first answer of a name getter on %s, and nothing of the later ones",
      async (field) => {
        const server = await startServer();

        await senderOn(server).send(
          messageWithRecipientIn(field, withShiftingName()),
        );

        const { envelope, raw } = onlyReceived(server);
        expect(envelope).toEqual(envelopeWith(field, ADDRESS));
        expect(mailboxesOf(raw, HEADER_OF[field])).toEqual([
          { name: "Anna", address: ADDRESS },
        ]);
        expect(raw).not.toMatch(ADDRESS_MARKERS);
      },
    );
  });

  it("53: sends two messages without from, from a frozen defaultFrom", async () => {
    const server = await startServer();
    const sender = new NodemailerEmailSender({
      transport: server.transportOptions,
      defaultFrom: Object.freeze({
        address: "noreply@example.test",
        name: "Cambusa",
      }),
    });

    await sender.send({ to: RECIPIENT, subject: "Welcome", text: "Hello" });
    await sender.send({ to: RECIPIENT, subject: "Welcome", text: "Hello" });

    expect(server.messages).toHaveLength(2);
    for (const { envelope, raw } of server.messages) {
      expect(envelope.from).toBe("noreply@example.test");
      expect(mailboxesOf(raw, "From")).toEqual([
        { name: "Cambusa", address: "noreply@example.test" },
      ]);
    }
  });
});
