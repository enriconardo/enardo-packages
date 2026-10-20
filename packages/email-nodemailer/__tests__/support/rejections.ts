import type { NodemailerSmtpOptions } from "~/index";
import type { LocalSmtpServer } from "./smtp-server";

/**
 * The options of a transport to `server` whose `getSocket` calls back with
 * `rejection`: nodemailer then rejects the send with it, as it is. These are
 * the rejections the server cannot produce.
 */
export function rejectingWith(
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

/** Makes `key` of `target` a getter that throws, on every read. */
export function withThrowingGetter<T extends object>(
  target: T,
  key: string,
): T {
  Object.defineProperty(target, key, {
    get(): never {
      throw new Error(`the read of ${key} failed`);
    },
  });
  return target;
}
