import { describe, expect, it } from "vitest";
import {
  diffRecordSets,
  isEmptyChangeSet,
  type RecordKeys,
} from "~/record-set";

interface GroupDoc {
  _id: string;
  name: string;
  nickname?: string;
  tags?: string[];
  settings?: { visibility: "public" | "private"; invitesOpen: boolean };
  createdAt?: Date;
}

interface MemberDoc {
  _id: string;
  groupId: string;
  userId: string;
  role: "owner" | "member";
}

/** A group stored across two collections: one record for the group, one per member. */
interface GroupRecords {
  groups: [GroupDoc];
  members: MemberDoc[];
}

/** A record whose field names come from data, so any name can occur. */
interface CarDoc {
  _id: string;
  [attribute: string]: string;
}

interface CarRecords {
  cars: CarDoc[];
}

describe("diffRecordSets", () => {
  describe("records", () => {
    it("reports no write when both sides hold the same records", () => {
      const changes = diffRecordSets(groupRecords(), groupRecords(), groupKeys);

      expect(changes).toEqual({
        groups: { inserted: [], updated: [], deleted: [] },
        members: { inserted: [], updated: [], deleted: [] },
      });
      expect(isEmptyChangeSet(changes)).toBe(true);
    });

    it("matches records by key, so reordering them is not a change", () => {
      const next = groupRecords();
      next.members.reverse();

      const changes = diffRecordSets(groupRecords(), next, groupKeys);

      expect(isEmptyChangeSet(changes)).toBe(true);
    });

    it("inserts a record whose key only next holds", () => {
      const next = groupRecords();
      next.members.push(member("u-3"));

      const changes = diffRecordSets(groupRecords(), next, groupKeys);

      expect(changes.members).toEqual({
        inserted: [member("u-3")],
        updated: [],
        deleted: [],
      });
      expect(isEmptyChangeSet(changes)).toBe(false);
    });

    it("deletes a record whose key only previous holds, handing over the whole record", () => {
      const next = groupRecords();
      next.members.pop();

      const changes = diffRecordSets(groupRecords(), next, groupKeys);

      // The store reads the identity to delete, and any foreign key, from the record.
      expect(changes.members).toEqual({
        inserted: [],
        updated: [],
        deleted: [member("u-2")],
      });
    });

    it("deletes and inserts a record whose key changed", () => {
      const next = groupRecords();
      next.members[1] = { ...member("u-2"), _id: "g-1:u-2:rejoined" };

      const changes = diffRecordSets(groupRecords(), next, groupKeys);

      expect(changes.members).toEqual({
        inserted: [next.members[1]],
        updated: [],
        deleted: [member("u-2")],
      });
    });

    it("keeps the changes of each collection apart", () => {
      const next = groupRecords();
      next.groups[0].name = "Boulderers";
      next.members.pop();

      const changes = diffRecordSets(groupRecords(), next, groupKeys);

      expect(changes).toEqual({
        groups: {
          inserted: [],
          updated: [
            { record: next.groups[0], set: { name: "Boulderers" }, unset: [] },
          ],
          deleted: [],
        },
        members: { inserted: [], updated: [], deleted: [member("u-2")] },
      });
    });

    it("lists inserted and updated records in next order, deleted ones in previous order", () => {
      const previous = groupRecords();
      previous.members.push(member("u-4"), member("u-3"));
      const next = groupRecords();
      next.members = [
        member("u-6"),
        member("u-2", "owner"),
        member("u-5"),
        member("u-1"),
      ];

      const { members } = diffRecordSets(previous, next, groupKeys);

      expect(members.inserted.map(({ userId }) => userId)).toEqual([
        "u-6",
        "u-5",
      ]);
      expect(members.updated.map(({ record }) => record.userId)).toEqual([
        "u-2",
        "u-1",
      ]);
      expect(members.deleted.map(({ userId }) => userId)).toEqual([
        "u-4",
        "u-3",
      ]);
    });

    it("inserts every record when nothing is stored yet", () => {
      const changes = diffRecordSets(undefined, groupRecords(), groupKeys);

      expect(changes).toEqual({
        groups: { inserted: groupRecords().groups, updated: [], deleted: [] },
        members: { inserted: groupRecords().members, updated: [], deleted: [] },
      });
    });

    it("ignores a top-level field that no key function describes", () => {
      // A store may pass through a field of its own, such as the _id of an aggregation.
      const previous = { ...groupRecords(), _id: "g-1" } as GroupRecords;

      const changes = diffRecordSets(previous, groupRecords(), groupKeys);

      expect(isEmptyChangeSet(changes)).toBe(true);
    });
  });

  describe("fields", () => {
    it("sets only the top-level fields whose value changed", () => {
      const next = groupRecords();
      next.members[1]!.role = "owner";

      const { members } = diffRecordSets(groupRecords(), next, groupKeys);

      expect(members.updated).toEqual([
        { record: next.members[1], set: { role: "owner" }, unset: [] },
      ]);
    });

    it("sets a field that gained a value and unsets one that lost it", () => {
      const previous = groupRecords();
      previous.groups[0].nickname = "The climbers";
      const next = groupRecords();
      next.groups[0].tags = ["outdoor"];

      const { groups } = diffRecordSets(previous, next, groupKeys);

      expect(groups.updated).toEqual([
        {
          record: next.groups[0],
          set: { tags: ["outdoor"] },
          unset: ["nickname"],
        },
      ]);
    });

    it("writes a nested value whole when any part of it changed", () => {
      const previous = groupRecords();
      previous.groups[0].settings = { visibility: "public", invitesOpen: true };
      previous.groups[0].tags = ["outdoor", "indoor"];
      const next = groupRecords();
      next.groups[0].settings = { visibility: "public", invitesOpen: false };
      next.groups[0].tags = ["indoor", "outdoor"];

      const { groups } = diffRecordSets(previous, next, groupKeys);

      // Array positions are not identities: reordering an array replaces it.
      expect(groups.updated).toEqual([
        {
          record: next.groups[0],
          set: {
            settings: { visibility: "public", invitesOpen: false },
            tags: ["indoor", "outdoor"],
          },
          unset: [],
        },
      ]);
    });

    it("compares nested values by structure, not by reference", () => {
      const previous = groupRecords();
      previous.groups[0].settings = { visibility: "public", invitesOpen: true };
      previous.groups[0].createdAt = new Date(0);
      const next = groupRecords();
      next.groups[0].settings = { visibility: "public", invitesOpen: true };
      next.groups[0].createdAt = new Date(0);

      expect(isEmptyChangeSet(diffRecordSets(previous, next, groupKeys))).toBe(
        true,
      );
    });

    it("unsets a removed field named like an Object.prototype member", () => {
      const previous: CarRecords = {
        cars: [{ _id: "c-1", constructor: "Ferrari" }],
      };
      const next: CarRecords = { cars: [{ _id: "c-1" }] };

      const { cars } = diffRecordSets(previous, next, carKeys);

      expect(cars.updated).toEqual([
        { record: next.cars[0], set: {}, unset: ["constructor"] },
      ]);
    });
  });

  describe("invalid record sets", () => {
    it("rejects two records sharing a key instead of keeping one of them", () => {
      const next = groupRecords();
      next.members.push(member("u-2"));

      expect(() => diffRecordSets(groupRecords(), next, groupKeys)).toThrow(
        expect.objectContaining({
          name: "DuplicateRecordKeyError",
          code: "DUPLICATE_RECORD_KEY",
          message:
            'Collection "members" of the next record set holds more than one record with key "g-1:u-2".',
          details: { collection: "members", key: "g-1:u-2", recordSet: "next" },
        }),
      );
    });

    it("rejects a missing collection, naming it and the side at fault", () => {
      // Only a cast gets past the types; a mapper written in plain JavaScript needs none.
      const next = { groups: groupRecords().groups } as unknown as GroupRecords;

      expect(() => diffRecordSets(groupRecords(), next, groupKeys)).toThrow(
        expect.objectContaining({
          name: "InvalidRecordSetError",
          code: "INVALID_RECORD_SET",
          message:
            'Collection "members" of the next record set is not an array of records.',
          details: { collection: "members", recordSet: "next" },
        }),
      );
    });
  });
});

/** Builds fresh records on every call: a group with its owner and one member. */
function groupRecords(): GroupRecords {
  return {
    groups: [{ _id: "g-1", name: "Climbers" }],
    members: [member("u-1", "owner"), member("u-2")],
  };
}

function member(userId: string, role: MemberDoc["role"] = "member"): MemberDoc {
  return { _id: `g-1:${userId}`, groupId: "g-1", userId, role };
}

const groupKeys: RecordKeys<GroupRecords> = {
  groups: (group) => group._id,
  members: (member) => member._id,
};

const carKeys: RecordKeys<CarRecords> = {
  cars: (car) => car._id,
};
