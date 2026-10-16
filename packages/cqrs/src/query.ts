export interface QueryMetadata {
  queryId?: string;
  occurredAt?: Date;
}

export abstract class Query {
  readonly queryId?: string;
  readonly occurredAt: Date;

  protected constructor(metadata?: QueryMetadata) {
    this.queryId = metadata?.queryId;
    this.occurredAt = metadata?.occurredAt ?? new Date();
  }
}
