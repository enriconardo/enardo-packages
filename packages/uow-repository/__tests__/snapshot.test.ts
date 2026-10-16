import { describe, expect, it } from "vitest";
import { toSnapshot } from "~/snapshot";

/** Stands for a driver value type, such as MongoDB's ObjectId. */
class Identifier {
  constructor(readonly hex: string) {}
}

describe("toSnapshot", () => {
  it("drops undefined-valued keys at every depth", () => {
    const snapshot = toSnapshot({
      id: "p-1",
      nickname: undefined,
      details: { colour: undefined, size: "L" },
    });

    expect(snapshot).toEqual({ id: "p-1", details: { size: "L" } });
    expect("nickname" in snapshot).toBe(false);
    expect("colour" in snapshot.details).toBe(false);
  });

  it("keeps null, which stores do round-trip", () => {
    expect(toSnapshot({ nickname: null })).toEqual({ nickname: null });
  });

  it("copies deeply, so a later mutation cannot reach it", () => {
    const data = { tags: ["a"] };

    const snapshot = toSnapshot(data);
    data.tags.push("b");

    expect(snapshot.tags).toEqual(["a"]);
  });

  it("preserves the built-ins a store hands back", () => {
    const data = {
      at: new Date(0),
      counts: new Map([["a", 1]]),
      labels: new Set(["x"]),
      blob: new Uint8Array([1, 2]),
    };

    const snapshot = toSnapshot(data);

    expect(snapshot.at).toBeInstanceOf(Date);
    expect(snapshot.counts).toBeInstanceOf(Map);
    expect(snapshot.labels).toBeInstanceOf(Set);
    expect(snapshot.blob).toBeInstanceOf(Uint8Array);
    expect(snapshot).toEqual(data);
  });

  it("keeps class instances, such as a driver's ObjectId, as they are", () => {
    const id = new Identifier("65f0a1b2c3d4e5f6a7b8c9d0");
    const data = { _id: id, owners: [id], byRole: new Map([["owner", id]]) };

    const snapshot = toSnapshot(data);

    // A copy would lose the prototype, and a driver would write a sub-document.
    expect(snapshot._id).toBe(id);
    expect(snapshot.owners[0]).toBe(id);
    expect(snapshot.byRole.get("owner")).toBe(id);
  });

  it("still copies the containers around class instances", () => {
    const data = { owners: [new Identifier("a")] };

    const snapshot = toSnapshot(data);
    data.owners.push(new Identifier("b"));

    expect(snapshot.owners).toHaveLength(1);
  });

  it("leaves array positions alone", () => {
    const snapshot = toSnapshot({ items: [1, undefined, 3] });

    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items[2]).toBe(3);
  });

  it("survives circular references", () => {
    const data: Record<string, unknown> = { id: "p-1", nickname: undefined };
    data.self = data;

    const snapshot = toSnapshot(data);

    expect(snapshot.self).toBe(snapshot);
    expect("nickname" in snapshot).toBe(false);
  });
});
