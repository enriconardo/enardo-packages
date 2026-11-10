import type { Transaction } from "@enardo/transaction-manager";
import { ChangeTracker, type TrackedEntity } from "./change-tracker";
import type { AggregateWrite, DataStore, VersionedRecords } from "./data-store";
import { identityKeyOf } from "./identity-key";
import type { Mapper } from "./mapper";
import {
  diffRecordSets,
  isEmptyChangeSet,
  restrictToMappedFields,
  type ChangeSet,
  type RecordSet,
} from "./record-set";
import { copyData, toSnapshot } from "./snapshot";
import type { FlushUnit, UnitOfWorkParticipant } from "./unit-of-work";

/** Repository contract consumed by application and domain services. */
export interface Repository<TDomain, TId> {
  /**
   * Returns the tracked in-memory instance without querying the store, or
   * `null` if it is tracked as removed. Otherwise queries the store and, when
   * a record set comes back, maps it and tracks it as clean.
   *
   * @param id - Identity of the entity to find.
   * @returns The entity, or `null` if none exists under that identity.
   */
  findById(id: TId): Promise<TDomain | null>;
  /**
   * Always queries the store, to learn which entities exist. Record sets
   * whose identity is already tracked resolve to the in-memory instance and
   * their fresh content is ignored; removed entities are left out; entities
   * added in memory but not yet written are appended.
   *
   * @returns Every entity currently in the store, merged with pending
   * in-memory adds and removals.
   */
  findAll(): Promise<readonly TDomain[]>;
  /**
   * Tracks `entity` as new, to be inserted on the next flush.
   *
   * @param entity - The entity to add. Its identity must not already be
   * tracked as new, clean or removed, or the returned promise rejects with an `Error`.
   */
  add(entity: TDomain): Promise<void>;
  /**
   * Tracks `entity` as removed, to be deleted on the next flush. Removing an
   * entity tracked as new instead drops it from tracking entirely, since it
   * was never persisted.
   *
   * @param entity - The entity to remove.
   */
  remove(entity: TDomain): Promise<void>;
}

/** Options of a {@link TrackingRepository}. */
export interface TrackingRepositoryOptions<TDomain, TId, TEvent = never> {
  /** Derives a stable change-tracker key for composite identities. */
  identityKey?: ((id: TId) => string) | undefined;
  /** Takes the domain events an aggregate raised, emptying its queue. */
  pullEvents?: ((aggregate: TDomain) => readonly TEvent[]) | undefined;
}

/**
 * Maps records to domain entities and tracks those entities within a unit of
 * work.
 *
 * Callers and the change tracker use the domain identity, `TId`. The data
 * store receives the stored identity, `TStoredId`, which the mapper converts
 * it to: the repository is the boundary between the two.
 */
export class TrackingRepository<
  TDomain,
  TRecords extends RecordSet<TRecords>,
  TId,
  TContext extends Transaction,
  TVersion extends NonNullable<unknown> = number,
  TStoredId = TId,
  TEvent = never,
>
  implements Repository<TDomain, TId>, UnitOfWorkParticipant<TContext, TEvent>
{
  readonly changeTracker = new ChangeTracker<
    TId,
    TDomain,
    TRecords,
    TVersion
  >();

  constructor(
    private readonly dataStore: DataStore<
      TRecords,
      TStoredId,
      TContext,
      TVersion
    >,
    private readonly mapper: Mapper<TDomain, TRecords, TId, TStoredId>,
    private readonly options: TrackingRepositoryOptions<
      TDomain,
      TId,
      TEvent
    > = {},
  ) {}

  async findById(id: TId): Promise<TDomain | null> {
    const tracked = this.changeTracker.get(this.#getIdentityKey(id));

    if (tracked?.state === "removed") {
      return null;
    }

    if (tracked !== undefined) {
      return tracked.entity;
    }

    const stored = await this.dataStore.findById(this.#storedId(id));

    if (stored === null) {
      return null;
    }

    return this.#track(stored);
  }

  async findAll(): Promise<readonly TDomain[]> {
    const aggregates = await this.dataStore.findAll();

    const entities = new Map<string, TDomain>();

    for (const stored of aggregates) {
      // Track each record set as a domain entity. An identity already tracked
      // keeps the instance, snapshot and version of its first read.
      const entity = this.#track(stored);
      const key = this.#getIdentityKey(this.mapper.identity(entity));

      // Skip entities that have been removed in the change tracker.
      if (this.changeTracker.get(key)?.state === "removed") {
        continue;
      }

      entities.set(key, entity);
    }

    // Include newly tracked entities in the final result.
    for (const [key, tracked] of this.changeTracker.entries()) {
      if (tracked.state === "new") {
        entities.set(key, tracked.entity);
      }
    }

    return [...entities.values()];
  }

  /**
   * Loads one aggregate with a query of the subclass's own, such as a lookup
   * by a unique field, and tracks it as findById does. An identity already
   * tracked resolves to the in-memory instance, with its edits, and one
   * tracked as removed to `null`.
   *
   * An entity added in this unit of work but not yet written is never found:
   * the query runs against the store, and its criteria can't be checked
   * against entities in memory.
   *
   * @param load - Reads one record set, with its version, from the store.
   * @returns The entity, or `null` if the query found nothing.
   */
  protected async findOneBy(
    load: () => Promise<VersionedRecords<TRecords, TVersion> | null>,
  ): Promise<TDomain | null> {
    const stored = await load();

    if (stored === null) {
      return null;
    }

    const entity = this.#track(stored);
    const key = this.#getIdentityKey(this.mapper.identity(entity));

    return this.changeTracker.get(key)?.state === "removed" ? null : entity;
  }

  async add(entity: TDomain): Promise<void> {
    const id = this.mapper.identity(entity);
    const key = this.#getIdentityKey(id);
    this.changeTracker.add(key, id, entity);
  }

  async remove(entity: TDomain): Promise<void> {
    const id = this.mapper.identity(entity);
    this.changeTracker.remove(this.#getIdentityKey(id), id, entity);
  }

  planFlush(): readonly FlushUnit<TContext>[] {
    const units: FlushUnit<TContext>[] = [];

    for (const [, tracked] of this.changeTracker.entries()) {
      switch (tracked.state) {
        case "removed": {
          units.push(this.#createDeleteUnit(tracked.id, tracked.version));
          break;
        }
        case "new": {
          units.push(this.#createInsertUnit(tracked.id, tracked.entity));
          break;
        }
        case "clean": {
          const changes = this.#findUnsavedChanges(tracked);
          if (changes !== undefined) {
            units.push(
              this.#createUpdateUnit(tracked.id, tracked.version, changes),
            );
          }
          break;
        }
      }
    }

    return units;
  }

  /**
   * Reports whether a flush would write anything, without building the units.
   *
   * A tracked entity is not a change in itself: one that was loaded and left
   * alone stays clean, so its edits still have to be looked for, with the same
   * diff planFlush uses so that the two always agree.
   */
  hasPendingChanges(): boolean {
    for (const [, tracked] of this.changeTracker.entries()) {
      if (
        tracked.state !== "clean" ||
        this.#findUnsavedChanges(tracked) !== undefined
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Takes the events of every tracked aggregate, in tracking order and queue
   * order.
   * An aggregate added and removed gives none: it never reached the store.
   */
  pullEvents(): readonly TEvent[] {
    const pullEvents = this.options.pullEvents;
    if (pullEvents === undefined) return [];

    const events: TEvent[] = [];

    for (const [, tracked] of this.changeTracker.entries()) {
      events.push(...pullEvents(tracked.entity));
    }

    return events;
  }

  clear(): void {
    this.changeTracker.clear();
  }

  /**
   * Diffs a clean entity against its snapshot, returning undefined when nothing
   * changed. The snapshot holds the stored values of the fields the mapper
   * returns, so only those are compared (see #snapshotOf).
   */
  #findUnsavedChanges(
    tracked: TrackedEntity<TId, TDomain, TRecords, TVersion>,
  ): ChangeSet<TRecords> | undefined {
    if (tracked.snapshot === undefined) return undefined;

    const changes = diffRecordSets(
      tracked.snapshot,
      this.#recordsOf(tracked.entity),
      this.dataStore.recordKeys,
    );

    return isEmptyChangeSet(changes) ? undefined : changes;
  }

  /**
   * Maps an entity to records normalized like every snapshot: diffing a raw
   * toRecords() result against a snapshot would flag the undefined-vs-absent
   * keys toSnapshot drops as spurious changes.
   */
  #recordsOf(entity: TDomain): TRecords {
    return toSnapshot(this.mapper.toRecords(entity));
  }

  #track({ records, version }: VersionedRecords<TRecords, TVersion>): TDomain {
    const entity = this.mapper.toDomain(records);
    const id = this.mapper.identity(entity);
    const identityKey = this.#getIdentityKey(id);
    // The tracker keeps the first snapshot of an identity: map back only the
    // records of an identity tracked for the first time.
    const snapshot =
      this.changeTracker.get(identityKey) !== undefined
        ? toSnapshot(records)
        : this.#snapshotOf(records, entity);
    const tracked = this.changeTracker.track(
      identityKey,
      id,
      entity,
      snapshot,
      version,
    );
    return tracked.entity;
  }

  /**
   * The stored records restricted to the fields the mapper returns for the
   * entity just built, before any edit: a field the mapper never returns is
   * never compared, hence never written. Taken at load, since an optional field
   * the domain clears later would otherwise leave the snapshot and never be
   * unset.
   *
   * When toRecords or a key function throws, the snapshot is the stored records whole and the
   * error comes back on the commit that maps the entity, if any: a load must
   * not fail where it did not.
   */
  #snapshotOf(records: TRecords, entity: TDomain): TRecords {
    const stored = toSnapshot(records);

    try {
      return restrictToMappedFields(
        stored,
        this.#recordsOf(entity),
        this.dataStore.recordKeys,
      );
    } catch {
      // toRecords, or a key function on a stored record that breaks its type.
      return stored;
    }
  }

  /** Inserts every record, with no version to check: nothing was read. */
  #createInsertUnit(id: TId, entity: TDomain): FlushUnit<TContext> {
    const write: AggregateWrite<TRecords, TStoredId, TVersion> = {
      id: this.#storedId(id),
      expectedVersion: undefined,
      changes: diffRecordSets(
        undefined,
        this.#recordsOf(entity),
        this.dataStore.recordKeys,
      ),
    };
    return {
      kind: "insert",
      run: async (ctx) => this.#apply(write, ctx),
    };
  }

  /** Writes the changes against the version read when the entity was loaded. */
  #createUpdateUnit(
    id: TId,
    expectedVersion: TVersion | undefined,
    changes: ChangeSet<TRecords>,
  ): FlushUnit<TContext> {
    const write: AggregateWrite<TRecords, TStoredId, TVersion> = {
      id: this.#storedId(id),
      expectedVersion,
      changes,
    };
    return {
      kind: "update",
      run: async (ctx) => this.#apply(write, ctx),
    };
  }

  #createDeleteUnit(
    id: TId,
    expectedVersion: TVersion | undefined,
  ): FlushUnit<TContext> {
    const storedId = this.#storedId(id);
    return {
      kind: "delete",
      run: async (ctx) => this.dataStore.delete(storedId, expectedVersion, ctx),
    };
  }

  /**
   * Hands the store its own copy of the changes on every run: some drivers
   * write into the documents they are given, for example to add a generated
   * _id, and a transaction manager may run the same units again after a
   * transient error.
   */
  async #apply(
    { changes, ...write }: AggregateWrite<TRecords, TStoredId, TVersion>,
    context: TContext,
  ): Promise<void> {
    // Only the changes are copied: the id and version pass through as they are.
    // The copy keeps class instances, such as an ObjectId, with their prototype.
    await this.dataStore.apply(
      { ...write, changes: copyData(changes) },
      context,
    );
  }

  /**
   * Converts an identity for the store. Units call it while they are planned,
   * not when they run, so that an identity that can't be converted fails the
   * commit before its transaction opens.
   */
  #storedId(id: TId): TStoredId {
    if (this.mapper.toStoredId !== undefined) {
      return this.mapper.toStoredId(id);
    }

    // Without a conversion, Mapper only type-checks when TId is a TStoredId.
    return id as unknown as TStoredId;
  }

  #getIdentityKey(id: TId): string {
    return this.options.identityKey?.(id) ?? identityKeyOf(id);
  }
}
