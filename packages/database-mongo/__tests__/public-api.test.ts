import type { Database } from "@enardo/database";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type {
  MongoDatabase,
  MongoDatabaseOptions,
  MongoIndex,
  MongoSchema,
  MongoValidation,
} from "~/index";
// @ts-expect-error IMongoDatabase is removed: MongoDatabase is the type
import type { IMongoDatabase } from "~/index";
// @ts-expect-error renamed to MongoDatabaseOptions
import type { IMongoDatabaseOptions } from "~/index";
// @ts-expect-error renamed to MongoIndex
import type { IMongoIndex } from "~/index";
// @ts-expect-error renamed to MongoSchema
import type { IMongoSchema } from "~/index";
// @ts-expect-error renamed to MongoValidation
import type { IMongoValidation } from "~/index";

describe("entry point", () => {
  it("exports MongoDatabase at runtime, and nothing else", () => {
    expect(Object.keys(entryPoint)).toEqual(["MongoDatabase"]);
  });

  it("exports the types without the I prefix", () => {
    expectTypeOf<MongoDatabaseOptions>().toHaveProperty("dbUri");
    expectTypeOf<MongoIndex>().toHaveProperty("name");
    expectTypeOf<MongoSchema>().toHaveProperty("indexes");
    expectTypeOf<MongoValidation>().toBeObject();
  });

  it("makes MongoDatabase assignable to Database", () => {
    expectTypeOf<MongoDatabase>().toExtend<Database>();
  });

  it("takes a plain object as a Pick of the two sync methods", () => {
    const fake: Pick<MongoDatabase, "syncSchema" | "dropStaleIndexes"> = {
      syncSchema: () => Promise.resolve({ createdCollections: [] }),
      dropStaleIndexes: () => Promise.resolve({ droppedIndexes: [] }),
    };
    expect(Object.keys(fake)).toHaveLength(2);
  });

  it("does not export the old names", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the imports:
    // a name the module does not export resolves to `any`.
    expectTypeOf<IMongoDatabase>().toBeAny();
    expectTypeOf<IMongoDatabaseOptions>().toBeAny();
    expectTypeOf<IMongoIndex>().toBeAny();
    expectTypeOf<IMongoSchema>().toBeAny();
    expectTypeOf<IMongoValidation>().toBeAny();
  });
});
