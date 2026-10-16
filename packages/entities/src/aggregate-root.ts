import type { Event, MergeableEvent } from "@enardo/events";
import type { EntityCommonAttributes } from "./entity.js";
import { Entity } from "./entity.js";
import {
  EntityAlreadyMarkedForRemovalError,
  EntityNotMutableError,
} from "./errors/index.js";
import { deepFreeze } from "./utils";

export interface AggregateRootCommonAttributes extends EntityCommonAttributes {
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AggregateRootLifecycleContext {
  entityType: string;
  entityId: unknown;
}

/** Payload carried by a `<model>.created` lifecycle event. */
export type AggregateRootCreatedPayload = AggregateRootLifecycleContext;

/** Payload carried by a `<model>.deleted` lifecycle event. */
export interface AggregateRootDeletedPayload extends AggregateRootLifecycleContext {
  reason?: string;
}

/**
 * Payload carried by a `<model>.updated` lifecycle event.
 *
 * `changedKeys` is the set of attribute names that were mutated. Multiple
 * consecutive update events are automatically merged by
 * {@link AggregateRoot.addEvent}, so `changedKeys` accumulates across
 * mutations until the queue is drained.
 */
export interface AggregateRootUpdatedPayload extends AggregateRootLifecycleContext {
  changedKeys: string[];
}

/** Convenience type alias for the `<model>.created` domain event. */
export type AggregateRootCreatedEvent = Event<AggregateRootCreatedPayload>;

/** Convenience type alias for the `<model>.deleted` domain event. */
export type AggregateRootDeletedEvent = Event<AggregateRootDeletedPayload>;

/**
 * Convenience type alias for the `<model>.updated` domain event.
 *
 * The event is mergeable so that rapid successive mutations collapse into a
 * single queued event containing all changed keys.
 */
export type AggregateRootUpdatedEvent =
  MergeableEvent<AggregateRootUpdatedPayload>;

/**
 * Type guard for mergeable domain events.
 *
 * @param event Event candidate.
 * @returns `true` when the event exposes both `mergeKey` and `merge`.
 */
function isMergeableEvent(event: Event): event is MergeableEvent {
  return (
    "mergeKey" in event && typeof (event as MergeableEvent).merge === "function"
  );
}

/**
 * Abstract base class for aggregate roots.
 *
 * An aggregate root extends {@link Entity} with domain-event queuing,
 * immutable attribute mutation via {@link AggregateRoot.setAttribute} and
 * {@link AggregateRoot.setAttributes},
 * a soft-delete lifecycle via {@link AggregateRoot.markForRemoval}, and
 * optional timestamp tracking (`createdAt` / `updatedAt`).
 *
 * Subclasses must implement {@link AggregateRoot.modelName} to provide the
 * prefix used when building lifecycle event names such as `user.created`.
 *
 * @template Attributes Shape of the persisted/normalized aggregate
 *   attributes. Must extend {@link AggregateRootCommonAttributes}.
 */
export abstract class AggregateRoot<
  Attributes extends AggregateRootCommonAttributes,
> extends Entity<Attributes> {
  /**
   * Queue of events raised since the last {@link pullEvents} call.
   * @internal
   */
  _events: Event[] = [];

  /**
   * Whether this aggregate has been soft-deleted via {@link markForRemoval}.
   * @internal
   */
  _isMarkedForRemoval = false;

  /**
   * Model/entity type name used as the prefix for lifecycle event names.
   *
   * @example
   * // Produces event names like "user.created", "user.updated", "user.deleted".
   * protected get modelName(): string { return "user"; }
   */
  protected abstract get modelName(): string;

  /**
   * A defensive copy of the `createdAt` timestamp, or `undefined` when the
   * attribute has not been set.
   */
  get createdAt(): Date | undefined {
    if (this._attributes.createdAt === undefined) {
      return undefined;
    }

    return new Date(this._attributes.createdAt.getTime());
  }

  /**
   * A defensive copy of the `updatedAt` timestamp, or `undefined` when the
   * attribute has not been set.
   */
  get updatedAt(): Date | undefined {
    if (this._attributes.updatedAt === undefined) {
      return undefined;
    }

    return new Date(this._attributes.updatedAt.getTime());
  }

  /**
   * Immutably updates a single attribute on the aggregate.
   *
   * The method is a no-op when the new value is strictly equal (`Object.is`)
   * to the current value.  Otherwise it:
   * 1. Calls {@link onBeforeAttributeMutation} for pre-mutation hooks.
   * 2. Replaces `_attributes` with a frozen clone containing the new value.
   * 3. Updates the `updatedAt` timestamp when the attribute is present.
   * 4. Calls {@link onAttributeMutation} for post-mutation hooks.
   *
   * @param key   Attribute key to update.
   * @param value New value. The value is deeply frozen before storage.
   * @throws {EntityNotMutableError} When the aggregate is marked for removal.
   */
  protected setAttribute<K extends keyof Attributes>(
    key: K,
    value: Attributes[K],
  ): void {
    this.setAttributes({ [key]: value } as Pick<Attributes, K>);
  }

  /**
   * Immutably updates multiple attributes on the aggregate in a single pass.
   *
   * The method is a no-op when every provided value is strictly equal
   * (`Object.is`) to its current value. Otherwise it:
   * 1. Calls {@link onBeforeAttributeMutation} once for the whole batch.
   * 2. Replaces `_attributes` with a frozen clone containing changed values.
   * 3. Updates the `updatedAt` timestamp when the attribute is present.
   * 4. Calls {@link onAttributeMutation} once per changed key.
   *
   * @param values Partial attribute map to update.
   * @throws {EntityNotMutableError} When the aggregate is marked for removal.
   */
  protected setAttributes<K extends keyof Attributes>(
    values: Pick<Attributes, K>,
  ): void {
    // Ensure the entity is mutable before allowing any attribute mutation.
    this.assertMutable();

    // Run shared pre-mutation logic once for the full mutation batch.
    this.onBeforeAttributeMutation();

    const changedKeys: string[] = [];
    const newAttributes = { ...this._attributes };

    for (const key of Object.keys(values) as K[]) {
      const value = values[key];
      const previous = this._attributes[key];

      if (Object.is(previous, value)) {
        continue;
      }

      // Freeze each changed value to preserve nested immutability guarantees.
      newAttributes[key] = deepFreeze(value);
      changedKeys.push(String(key));
    }

    if (changedKeys.length === 0) {
      return;
    }

    // Automatically update the `updatedAt` timestamp when present in the attributes.
    if ("updatedAt" in this._attributes) {
      newAttributes.updatedAt = new Date();
    }

    // Replace the internal attributes with the new snapshot.
    this._attributes = Object.freeze(newAttributes);

    // Notify post-mutation once per changed key to preserve existing semantics.
    for (const changedKey of changedKeys) {
      this.onAttributeMutation(changedKey);
    }
  }

  /**
   * Builds a fully-qualified lifecycle event name for this aggregate type.
   *
   * @param kind The lifecycle phase (`"created"`, `"updated"`, or `"deleted"`).
   * @returns A dot-separated string such as `"user.created"`.
   */
  protected lifecycleEventName(
    kind: "created" | "updated" | "deleted",
  ): string {
    return `${this.modelName}.${kind}`;
  }

  /**
   * Builds the context object attached to lifecycle errors.
   *
   * @returns An object containing `entityType` and `entityId` for structured
   *   error logging or reporting.
   */
  protected buildLifecycleErrorContext(): {
    entityType: string;
    entityId: unknown;
  } {
    return {
      entityType: this.modelName,
      entityId: this.id,
    };
  }

  /**
   * Hook called by {@link setAttribute} **before** the attribute snapshot is
   * replaced.
   *
   * Override in subclasses to perform validation or pre-mutation side-effects.
   * The default implementation is a no-op.
   */
  protected onBeforeAttributeMutation(): void {
    // no-op by default
  }

  /**
   * Hook called by {@link setAttribute} **after** the attribute snapshot has
   * been replaced.
   *
   * Override in subclasses to queue domain events or perform other
   * post-mutation side-effects.  A common pattern is:
   *
   * ```ts
   * protected override onAttributeMutation(changedKey: string): void {
   *   if (this.hasCreatedEventQueued()) return;
   *   this.addEvent(this.createUpdatedEvent(changedKey));
   * }
   * ```
   *
   * The default implementation is a no-op.
   *
   * @param _changedKey Name of the attribute that was mutated.
   */
  protected onAttributeMutation(_changedKey: string): void {
    void _changedKey;
    // Remove the following comment if you want to automatically queue updated events on attribute mutation.
    // if (this.hasCreatedEventQueued()) return;
    // this.addEvent(this.createUpdatedEvent(changedKey));
    // no-op by default
  }

  /**
   * Asserts that the aggregate is still mutable.
   *
   * @throws {EntityNotMutableError} When the aggregate has been marked for
   *   removal.
   */
  protected assertMutable(): void {
    if (this._isMarkedForRemoval) {
      throw new EntityNotMutableError(this.buildLifecycleErrorContext());
    }
  }

  /**
   * Hook called by {@link markForRemoval} after `_isMarkedForRemoval` is set
   * to `true` and before the `deleted` event is queued.
   *
   * Override in subclasses to perform additional cleanup or to queue extra
   * domain events.  The default implementation is a no-op.
   *
   * @param _reason Optional human-readable reason forwarded from the caller.
   */
  protected onMarkedForRemoval(_reason?: string): void {
    void _reason;
    // no-op by default
  }

  /**
   * Factory method for **new** aggregates.
   *
   * Instantiates the aggregate and immediately queues a `<model>.created`
   * lifecycle event.  Use {@link rehydrate} instead when reconstructing an
   * aggregate from a persisted record.
   *
   * The `this` parameter is intentionally typed via `prototype` instead of a
   * public construct signature so subclasses can keep their constructor
   * `protected`/`private` and still use this shared static factory.
   *
   * @param props Initial normalized attribute values. Optional timestamp fields (`createdAt`,
   *   `updatedAt`) may be omitted.
   * @returns A new aggregate instance with one queued `created` event.
   */
  static create<
    Attributes extends AggregateRootCommonAttributes,
    AggregateRootType extends AggregateRoot<Attributes>,
  >(
    this: { prototype: AggregateRootType },
    props: Attributes,
  ): AggregateRootType {
    const Ctor = this as unknown as new (
      props: Attributes,
    ) => AggregateRootType;
    const entity = new Ctor(props);
    entity.addEvent(entity.createCreatedEvent());
    return entity;
  }

  /**
   * Factory method for **existing** aggregates loaded from persistence.
   *
   * Instantiates the aggregate without queuing any domain events, making it
   * suitable for reconstructing state from a database record or snapshot.
   * Use {@link create} instead for brand-new aggregates.
   *
   * The `this` parameter is intentionally typed via `prototype` instead of a
   * public construct signature so subclasses can keep their constructor
   * `protected`/`private` and still use this shared static factory.
   *
   * @param props Persisted normalized attribute values.
   * @returns A rehydrated aggregate instance with an empty event queue.
   */
  static rehydrate<
    Attributes extends AggregateRootCommonAttributes,
    AggregateRootType extends AggregateRoot<Attributes>,
  >(
    this: { prototype: AggregateRootType },
    props: Attributes,
  ): AggregateRootType {
    const Ctor = this as unknown as new (
      props: Attributes,
    ) => AggregateRootType;
    return new Ctor(props);
  }

  /**
   * Soft-deletes the aggregate by setting the `_isMarkedForRemoval` flag and
   * queuing a `<model>.deleted` lifecycle event.
   *
   * Once marked, the aggregate becomes immutable: any subsequent call to
   * {@link setAttribute} will throw {@link EntityNotMutableError}.
   *
   * @param reason Optional human-readable reason propagated into the event
   *   payload and the {@link onMarkedForRemoval} hook.
   * @throws {EntityAlreadyMarkedForRemovalError} When called more than once.
   */
  markForRemoval(reason?: string): void {
    if (this._isMarkedForRemoval) {
      throw new EntityAlreadyMarkedForRemovalError(
        this.buildLifecycleErrorContext(),
      );
    }

    this._isMarkedForRemoval = true;
    this.onMarkedForRemoval(reason);

    this.addEvent(this.createDeletedEvent(reason));
  }

  /** Returns `true` when this aggregate has been marked for removal. */
  isMarkedForRemoval(): boolean {
    return this._isMarkedForRemoval;
  }

  /**
   * Returns `true` when a `<model>.created` event is currently in the queue.
   *
   * Useful inside {@link onAttributeMutation} to skip queuing an `updated`
   * event for an aggregate that has not yet been persisted.
   */
  hasCreatedEventQueued(): boolean {
    return this._events.some(
      (event) => event.eventName === this.lifecycleEventName("created"),
    );
  }

  /**
   * Appends a domain event to the internal queue.
   *
   * When the event implements {@link MergeableEvent} and an event with
   * the same `mergeKey` is already queued, the two events are merged in-place
   * rather than appended as separate entries.
   *
   * @param event The event to enqueue.
   */
  addEvent(event: Event): void {
    if (isMergeableEvent(event)) {
      const index = this._events.findIndex(
        (queuedEvent) =>
          isMergeableEvent(queuedEvent) &&
          queuedEvent.mergeKey === event.mergeKey,
      );

      if (index !== -1) {
        this._events[index] = (this._events[index] as MergeableEvent).merge(
          event,
        );
        return;
      }
    }

    this._events.push(event);
  }

  /**
   * Builds a `<model>.created` lifecycle event for this aggregate.
   *
   * Called automatically by {@link create}.  Subclasses may call it directly
   * when a more specific factory is not available.
   *
   * @returns A plain {@link AggregateRootCreatedEvent} object.
   */
  createCreatedEvent(): AggregateRootCreatedEvent {
    return {
      eventName: this.lifecycleEventName("created"),
      occurredAt: new Date(),
      payload: {
        entityType: this.modelName,
        entityId: this.id,
      },
    };
  }

  /**
   * Builds a `<model>.deleted` lifecycle event for this aggregate.
   *
   * Called automatically by {@link markForRemoval}.  Subclasses may call it
   * directly when a more specific factory is not available.
   *
   * @param reason Optional human-readable deletion reason.
   * @returns A plain {@link AggregateRootDeletedEvent} object.
   */
  createDeletedEvent(reason?: string): AggregateRootDeletedEvent {
    return {
      eventName: this.lifecycleEventName("deleted"),
      occurredAt: new Date(),
      payload: {
        entityType: this.modelName,
        entityId: this.id,
        reason,
      },
    };
  }

  /**
   * Builds a mergeable `<model>.updated` lifecycle event for this aggregate.
   *
   * The returned event carries a `mergeKey` of the form
   * `<modelName>:<entityId>:updated`.  When multiple update events with the
   * same key are queued via {@link addEvent}, they are automatically
   * collapsed into a single event whose `changedKeys` is the union of all
   * merged events.
   *
   * @param changedKey Name of the attribute that was mutated.
   * @returns An {@link AggregateRootUpdatedEvent} with merge support.
   */
  createUpdatedEvent(changedKey: string): AggregateRootUpdatedEvent {
    const entityType = this.modelName;
    const entityId = this.id;

    return {
      eventName: this.lifecycleEventName("updated"),
      occurredAt: new Date(),
      mergeKey: `${entityType}:${String(entityId)}:updated`,
      payload: {
        entityType,
        entityId,
        changedKeys: [changedKey],
      },
      merge(other) {
        const changedKeys = new Set([
          ...this.payload.changedKeys,
          ...other.payload.changedKeys,
        ]);

        return {
          ...this,
          occurredAt: other.occurredAt,
          payload: {
            ...this.payload,
            changedKeys: [...changedKeys],
          },
        };
      },
    };
  }

  /**
   * Returns a snapshot of the current event queue and clears it.
   *
   * Callers (typically a repository's save method) should invoke this after
   * successfully persisting the aggregate to obtain the events to dispatch.
   *
   * @returns Ordered array of events raised since the last call.
   */
  pullEvents(): Event[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  /**
   * Discards all queued events without returning them.
   *
   * Use this when a persistence operation fails and the events should not be
   * dispatched.  For the normal success path, prefer {@link pullEvents}.
   */
  clearEvents(): void {
    this._events = [];
  }
}
