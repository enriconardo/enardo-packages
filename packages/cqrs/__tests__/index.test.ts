import { describe, expect, it } from "vitest";
import * as cqrs from "~/index";

describe("index", () => {
  it("exports exactly Command, CommandHandler, Query and QueryHandler at run time", () => {
    expect(Object.keys(cqrs).sort()).toStrictEqual([
      "Command",
      "CommandHandler",
      "Query",
      "QueryHandler",
    ]);
  });
});
