import { createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, expect } from "vitest";

// A minimal SMTP server on 127.0.0.1, which every test sends to: the sender
// takes configuration only, so what a relay gets is what a test observes.
//
// - It records each message it receives: the envelope, from MAIL FROM and
//   RCPT TO, and the raw message, from the data that follows DATA.
// - It answers 550 to a RCPT TO at refused.test, 450 at deferred.test, and
//   550 to a MAIL FROM at refused.test. Like a real relay, each refusal
//   echoes the address.
// - With `closeAfterData`, it closes the connection once the data of a
//   message has arrived, without answering it.
// - It never closes a connection otherwise, even after QUIT: a test sees
//   when the client closes its own.
// - It advertises no extension, so nodemailer sends each command alone,
//   with no parameter after the address.

export interface SmtpServerOptions {
  /** Closes the connection once the data of a message has arrived. */
  readonly closeAfterData?: boolean;
}

/** The options of an SMTP transport to the server: no TLS, no pool. */
export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: false;
  readonly ignoreTLS: true;
}

/** The envelope of a message, as the client gave it. */
export interface ReceivedEnvelope {
  /** The address of `MAIL FROM`, `""` for `MAIL FROM:<>`. */
  readonly from: string;
  /** The address of every `RCPT TO`, in order, refused ones included. */
  readonly to: readonly string[];
}

/** A message the server received in full. */
export interface ReceivedMessage {
  readonly envelope: ReceivedEnvelope;
  /**
   * The raw message: headers and body, as the lines that followed `DATA`,
   * joined with CRLF, with the SMTP dot-stuffing undone.
   */
  readonly raw: string;
}

export interface LocalSmtpServer {
  readonly port: number;
  /** `{ host: "127.0.0.1", port, secure: false, ignoreTLS: true }`. */
  readonly transportOptions: SmtpTransportOptions;
  /** How many connections the server has accepted. */
  readonly connectionCount: number;
  /** Every command received, in order, as it was sent. */
  readonly commands: readonly string[];
  /** Every message received in full, in order. */
  readonly messages: readonly ReceivedMessage[];
  /** How many connections are open now. */
  readonly openSocketCount: number;
  /** How many times a client has closed its side of a connection. */
  readonly clientCloseCount: number;
  /**
   * Resolves once a client has closed its side of a connection, now or
   * before. Rejects after `timeout` ms.
   */
  waitForClientClose(timeout?: number): Promise<void>;
  /** Destroys the open connections, and stops listening. */
  close(): Promise<void>;
}

/**
 * The address of a `MAIL FROM` or `RCPT TO` command: what lies between its
 * first `<` and its last `>`. With no extension advertised, nothing follows
 * the address.
 */
function addressOf(command: string): string {
  const start = command.indexOf("<");
  const end = command.lastIndexOf(">");
  return start === -1 || end <= start ? "" : command.slice(start + 1, end);
}

function domainIs(address: string, domain: string): boolean {
  return address.toLowerCase().endsWith(`@${domain}`);
}

/** Starts a server on a free port of 127.0.0.1. */
export async function startSmtpServer(
  options: SmtpServerOptions = {},
): Promise<LocalSmtpServer> {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const messages: ReceivedMessage[] = [];
  const closeWaiters: (() => void)[] = [];
  let connectionCount = 0;
  let clientCloseCount = 0;

  const server = createServer((socket) => {
    connectionCount++;
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("end", () => {
      clientCloseCount++;
      for (const resolve of closeWaiters.splice(0)) {
        resolve();
      }
      socket.end();
    });

    let buffer = "";
    // The envelope of the message under way, from its MAIL FROM.
    let envelope: { from: string; to: string[] } | undefined;
    // The lines of a message's data, while it arrives.
    let data: string[] | undefined;

    const reply = (line: string): void => {
      if (socket.writable) {
        socket.write(`${line}\r\n`);
      }
    };

    const answer = (command: string): void => {
      const verb = command.toUpperCase();
      if (verb.startsWith("EHLO") || verb.startsWith("HELO")) {
        reply("250 localhost");
      } else if (verb.startsWith("MAIL FROM:")) {
        const address = addressOf(command);
        envelope = { from: address, to: [] };
        reply(
          domainIs(address, "refused.test")
            ? `550 5.7.1 <${address}>: Sender address rejected`
            : "250 2.1.0 Ok",
        );
      } else if (verb.startsWith("RCPT TO:")) {
        const address = addressOf(command);
        envelope?.to.push(address);
        if (domainIs(address, "refused.test")) {
          reply(`550 5.1.1 <${address}>: Recipient address rejected`);
        } else if (domainIs(address, "deferred.test")) {
          reply(`450 4.2.0 <${address}>: Recipient address deferred`);
        } else {
          reply("250 2.1.5 Ok");
        }
      } else if (verb === "DATA") {
        data = [];
        reply("354 End data with <CR><LF>.<CR><LF>");
      } else if (verb === "RSET") {
        envelope = undefined;
        reply("250 2.0.0 Ok");
      } else if (verb === "NOOP") {
        reply("250 2.0.0 Ok");
      } else if (verb === "QUIT") {
        reply("221 2.0.0 Bye");
      } else {
        reply("502 5.5.2 Command not recognized");
      }
    };

    reply("220 localhost ESMTP test server");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf("\r\n");
      while (end !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
        if (data === undefined) {
          commands.push(line);
          answer(line);
        } else if (line === ".") {
          messages.push({
            envelope: {
              from: envelope?.from ?? "",
              to: [...(envelope?.to ?? [])],
            },
            raw: data.join("\r\n"),
          });
          envelope = undefined;
          data = undefined;
          if (options.closeAfterData) {
            socket.end();
            return;
          }
          reply("250 2.0.0 Ok: queued");
        } else {
          // Dot-stuffing (RFC 5321, 4.5.2): the client doubles the dot that
          // starts a line, so `..` stands for a line that starts with `.`.
          data.push(line.startsWith(".") ? line.slice(1) : line);
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    port,
    transportOptions: {
      host: "127.0.0.1",
      port,
      secure: false,
      ignoreTLS: true,
    },
    get connectionCount() {
      return connectionCount;
    },
    commands,
    messages,
    get openSocketCount() {
      return sockets.size;
    },
    get clientCloseCount() {
      return clientCloseCount;
    },
    waitForClientClose(timeout = 2000) {
      if (clientCloseCount > 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`No client closed its socket within ${timeout} ms`));
        }, timeout);
        closeWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

/**
 * The one message `server` received. Fails unless it received exactly one.
 */
export function onlyReceived(server: LocalSmtpServer): ReceivedMessage {
  expect(server.messages, "the messages the server received").toHaveLength(1);
  const [message] = server.messages;
  if (message === undefined) {
    throw new Error("Expected the server to receive one message");
  }
  return message;
}

/**
 * Gives a function that starts a server, and closes every server it started
 * after each test of the calling `describe` (or file).
 */
export function useSmtpServers(): (
  options?: SmtpServerOptions,
) => Promise<LocalSmtpServer> {
  const started: LocalSmtpServer[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.close()));
  });
  return async (options) => {
    const server = await startSmtpServer(options);
    started.push(server);
    return server;
  };
}

/**
 * How long the check of the idle servers waits, once, for a connection that
 * a sender would open late: one that rejected while a send went on.
 */
const LATE_CONNECTION_WAIT = 200;

/**
 * Gives a function that starts a server that no sender may reach, for the
 * cases where nothing is sent. Each test gets its own server, kept open
 * until the calling `describe` (or file) is done. Then the check waits once
 * for late connections, and fails, naming each test whose server saw a
 * connection.
 */
export function useIdleSmtpServers(): () => Promise<LocalSmtpServer> {
  const started: { readonly test: string; readonly server: LocalSmtpServer }[] =
    [];
  afterAll(async () => {
    await delay(LATE_CONNECTION_WAIT);
    const reached = started
      .filter(({ server }) => server.connectionCount > 0)
      .map(
        ({ test, server }) =>
          `${test}: ${server.connectionCount} connection(s)`,
      );
    await Promise.all(started.splice(0).map(({ server }) => server.close()));
    expect(reached, "the tests whose sender reached the server").toEqual([]);
  });
  return async () => {
    const server = await startSmtpServer();
    started.push({
      test: expect.getState().currentTestName ?? "(outside a test)",
      server,
    });
    return server;
  };
}
