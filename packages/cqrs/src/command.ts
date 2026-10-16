export interface CommandMetadata {
  commandId?: string;
  occurredAt?: Date;
}

export abstract class Command {
  readonly commandId?: string;
  readonly occurredAt: Date;

  protected constructor(metadata?: CommandMetadata) {
    this.commandId = metadata?.commandId;
    this.occurredAt = metadata?.occurredAt ?? new Date();
  }
}
