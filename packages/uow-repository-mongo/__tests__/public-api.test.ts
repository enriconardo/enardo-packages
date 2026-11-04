import { describe, expect, it } from "vitest";
import * as entryPoint from "~/index";

describe("entry point", () => {
  it("exports exactly MongoDataStore at runtime", () => {
    expect(Object.keys(entryPoint)).toStrictEqual(["MongoDataStore"]);
  });
});
