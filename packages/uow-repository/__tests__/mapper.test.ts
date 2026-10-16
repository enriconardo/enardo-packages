import { describe, expect, expectTypeOf, it } from "vitest";
import type { Mapper } from "~/mapper";

/** A domain identity that the store keeps in another form, as a string. */
class ProductId {
  constructor(readonly value: string) {}
}

interface Product {
  id: ProductId;
  name: string;
}

interface ProductRecords {
  products: [{ _id: string; name: string }];
}

const recordMapping = {
  toDomain: ({ products: [record] }: ProductRecords): Product => ({
    id: new ProductId(record._id),
    name: record.name,
  }),
  toRecords: (product: Product): ProductRecords => ({
    products: [{ _id: product.id.value, name: product.name }],
  }),
  identity: (product: Product): ProductId => product.id,
};

describe("Mapper", () => {
  it("leaves out toStoredId when the store keeps the identity as it is", () => {
    const mapper: Mapper<Product, ProductRecords, ProductId> = recordMapping;

    expectTypeOf(mapper.toStoredId).toEqualTypeOf<
      ((id: ProductId) => ProductId) | undefined
    >();
  });

  it("requires toStoredId when the store keeps the identity in another form", () => {
    // @ts-expect-error toStoredId is missing: the stored identity is a string.
    const incomplete: Mapper<Product, ProductRecords, ProductId, string> =
      recordMapping;
    const mapper: Mapper<Product, ProductRecords, ProductId, string> = {
      ...recordMapping,
      toStoredId: (id) => id.value,
    };

    expectTypeOf(mapper.toStoredId).toEqualTypeOf<(id: ProductId) => string>();
    expect(incomplete).not.toHaveProperty("toStoredId");
  });
});
