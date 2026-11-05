import { describe, expect, it } from "vitest";
import * as entities from "~/index";

describe("index", () => {
  it("exports exactly AggregateRoot, Entity, EntityId and InvalidEntityIdError at run time", () => {
    expect(Object.keys(entities).sort()).toStrictEqual([
      "AggregateRoot",
      "Entity",
      "EntityId",
      "InvalidEntityIdError",
    ]);
  });
});
