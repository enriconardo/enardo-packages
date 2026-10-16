import { describe, expect, it } from "vitest";
import { ObjectIdGenerator } from "~/object-id.id-generator";

describe("ObjectIdGenerator", () => {
  it("should generate a 24-char hex id", () => {
    const generator = new ObjectIdGenerator();
    const id = generator.generate();

    expect(id).toMatch(/^[a-f0-9]{24}$/);
  });
});
