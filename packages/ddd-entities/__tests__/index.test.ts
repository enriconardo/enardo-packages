import { describe, expect, it } from "vitest";
import * as entities from "~/index";

describe("index", () => {
  it("exports exactly AggregateRoot, Entity, Id and InvalidEntityIdError at run time", () => {
    expect(Object.keys(entities).sort()).toStrictEqual([
      "AggregateRoot",
      "Entity",
      "Id",
      "InvalidEntityIdError",
    ]);
  });
});
