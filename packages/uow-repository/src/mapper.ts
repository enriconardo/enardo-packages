import type { RecordSet } from "./record-set";

/**
 * Converts between domain entities and the records that store them, and
 * between the identity the domain uses and the one the store holds.
 *
 * `toStoredId` can be left out only when the store keeps the identity as it
 * is: the compiler requires it as soon as `TStoredId` is another type, such as
 * an ObjectId for an identity the domain holds as a value object.
 */
export type Mapper<
  TDomain,
  TRecords extends RecordSet<TRecords>,
  TId,
  TStoredId = TId,
> = RecordMapping<TDomain, TRecords, TId> & StoredIdMapping<TId, TStoredId>;

interface RecordMapping<TDomain, TRecords extends RecordSet<TRecords>, TId> {
  toDomain(records: TRecords): TDomain;
  toRecords(entity: TDomain): TRecords;
  /**
   * Reads the identity the domain uses, which repositories receive and key
   * tracked entities by.
   */
  identity(entity: TDomain): TId;
}

/**
 * Keeping the conversion here, next to toRecords, puts everything that knows
 * both the domain and the stored forms in one place: a data store only ever
 * sees stored identities.
 */
type StoredIdMapping<TId, TStoredId> = [TId] extends [TStoredId]
  ? {
      /** Turns an identity into the form the data store holds. */
      toStoredId?(id: TId): TStoredId;
    }
  : {
      /** Turns an identity into the form the data store holds. */
      toStoredId(id: TId): TStoredId;
    };
