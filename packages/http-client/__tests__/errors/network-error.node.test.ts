import { inspect } from "node:util";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BaseError } from "@enardo/errors";
import {
  SHAPES,
  buildError,
  buildErrorWithoutThrowing,
} from "../support/network-error";

// The tests of NetworkError that need Node: V8's stack, util.inspect and
// node:vm. The others are in network-error.test.ts, which runs in browsers
// too.

const REDUCED_URL = "https://api.example.com/v1/users";

/** The markers that the rejections of Node's fetch carry, in the shapes below. */
const CAUSE_MARKERS = [
  "alice",
  "hunter2",
  "q-secret",
  "hop-secret",
  "hop-frag-secret",
  "exa mple",
  "cookie-secret",
  "body-secret",
  "header-secret",
];

const firstLineOf = (stack: string | undefined): string | undefined =>
  stack?.split("\n")[0];

/** A caller's error wrapping a `NetworkError`, as the README shows for `HttpResponseError`. */
class UsersUnavailableError extends BaseError {
  override readonly name = "UsersUnavailableError";
}

// The refused shape carries no marker: it passes before and after the fix.
const MARKED_SHAPES = SHAPES.filter(({ shape }) => shape !== "refused");

describe("NetworkError", () => {
  it('is named "NetworkError", and its stack starts with the method and the reduced URL', () => {
    const error = buildError(new TypeError("Failed to fetch"));

    expect(error.name).toBe("NetworkError");
    expect(error.message).toBe(`No response to POST ${REDUCED_URL}`);
    expect(firstLineOf(error.stack)).toBe(
      `NetworkError: No response to POST ${REDUCED_URL}`,
    );
  });

  describe("the cause", () => {
    it.each(MARKED_SHAPES)(
      "lets no marker of a $shape rejection reach the JSON of the error, nor the JSON or util.inspect of an error wrapping it",
      ({ create }) => {
        const error = buildError(create());
        const wrapper = new UsersUnavailableError("Could not load the users", {
          code: "USERS_UNAVAILABLE",
          cause: error,
        });

        const outputs = {
          "the JSON of the error": JSON.stringify(error),
          "the JSON of the wrapping error": JSON.stringify(wrapper),
          "util.inspect of the wrapping error": inspect(wrapper, {
            depth: null,
          }),
        };
        for (const [output, text] of Object.entries(outputs)) {
          for (const marker of CAUSE_MARKERS) {
            expect(text, `${marker} in ${output}`).not.toContain(marker);
          }
        }
      },
    );

    it("gives an undefined cause for an Error from another realm", () => {
      const rejection: unknown = runInNewContext("new TypeError('x')");
      // The premise: it fails instanceof Error in this realm.
      expect(rejection).not.toBeInstanceOf(Error);

      const error = buildErrorWithoutThrowing(rejection);

      expect(error.cause).toBeUndefined();
    });
  });
});
