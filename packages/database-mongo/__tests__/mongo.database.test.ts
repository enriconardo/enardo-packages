import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseError } from "@enardo/database";
import MongoDatabase from "~/mongo.database";
import type {
  IMongoDatabaseOptions,
  IMongoSchema,
} from "~/mongo.database.types";
import type { Logger } from "~/logger";

// ─── Mocks ───────────────────────────────────────────────────────────

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockDbCommand = vi.fn().mockResolvedValue(undefined);
const mockCreateCollection = vi.fn().mockResolvedValue(undefined);
const mockListCollectionsToArray = vi.fn().mockResolvedValue([]);
const mockCreateIndexes = vi.fn().mockResolvedValue(undefined);
const mockListIndexesToArray = vi.fn().mockResolvedValue([]);
const mockDropIndex = vi.fn().mockResolvedValue(undefined);

const mockCollection = vi.fn().mockReturnValue({
  createIndexes: mockCreateIndexes,
  listIndexes: () => ({ toArray: mockListIndexesToArray }),
  dropIndex: mockDropIndex,
});

const mockDb = vi.fn().mockReturnValue({
  listCollections: () => ({ toArray: mockListCollectionsToArray }),
  createCollection: mockCreateCollection,
  command: mockDbCommand,
  collection: mockCollection,
});

const mockConnect = vi.fn().mockResolvedValue(undefined);
const {
  mockLogger,
  mockLoggerDebug,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockLoggerChild,
} = vi.hoisted(() => {
  const loggerDebug = vi.fn();
  const loggerInfo = vi.fn();
  const loggerWarn = vi.fn();
  const loggerError = vi.fn();
  const loggerChild = vi.fn();

  const logger = {
    debug: loggerDebug,
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    child: loggerChild,
  } as unknown as Logger;

  loggerChild.mockReturnValue(logger);

  return {
    mockLogger: logger,
    mockLoggerDebug: loggerDebug,
    mockLoggerInfo: loggerInfo,
    mockLoggerWarn: loggerWarn,
    mockLoggerError: loggerError,
    mockLoggerChild: loggerChild,
  };
});

vi.mock("mongodb", () => {
  const MockMongoClient = vi.fn(function (this: Record<string, unknown>) {
    this.connect = mockConnect;
    this.close = mockClose;
    this.db = mockDb;
  });

  return {
    MongoClient: MockMongoClient,
    Db: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────

const baseOptions: IMongoDatabaseOptions = {
  dbUri: "mongodb://localhost:27017",
  dbName: "test-db",
};

function createDatabase(
  overrides?: Partial<IMongoDatabaseOptions>,
): MongoDatabase {
  return new MongoDatabase({
    ...baseOptions,
    logger: mockLogger,
    ...overrides,
  });
}

const testSchema: IMongoSchema = {
  collectionName: "users",
  validation: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "email"],
      properties: {
        _id: { bsonType: "string" },
        email: { bsonType: "string" },
      },
    },
  },
  indexes: [
    { name: "email_unique", key: { email: 1 }, unique: true },
    { name: "createdAt_idx", key: { createdAt: -1 } },
  ],
};

/** The log methods: `child` is left out, since the constructor calls it. */
const logMethods = {
  debug: mockLoggerDebug,
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
};

function expectNoLogsBut(...allowed: (keyof typeof logMethods)[]): void {
  for (const [name, spy] of Object.entries(logMethods)) {
    if (!allowed.includes(name as keyof typeof logMethods)) {
      expect(spy, `logger.${name}`).not.toHaveBeenCalled();
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListCollectionsToArray.mockResolvedValue([]);
  mockListIndexesToArray.mockResolvedValue([{ name: "_id_" }]);
  mockLoggerChild.mockReturnValue(mockLogger);
});

describe("MongoDatabase", () => {
  describe("constructor", () => {
    it("should accept options and set defaults", () => {
      const db = createDatabase();
      expect(db.isConnected()).toBe(false);
    });

    it("should default schemas to empty array", async () => {
      const db = createDatabase();
      await db.connect();
      // No collection init should be called
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });
  });

  describe("connect", () => {
    it("should establish a connection", async () => {
      const db = createDatabase();
      await db.connect();
      expect(db.isConnected()).toBe(true);
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it("should initialize collections from schemas", async () => {
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockCreateCollection).toHaveBeenCalledWith("users", {
        validator: testSchema.validation,
      });
    });

    it("should update existing collections with new validator", async () => {
      mockListCollectionsToArray.mockResolvedValueOnce([{ name: "users" }]);
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockDbCommand).toHaveBeenCalledWith({
        collMod: "users",
        validator: testSchema.validation,
      });
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it("should create indexes for new collections", async () => {
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockCreateIndexes).toHaveBeenCalledWith(testSchema.indexes);
    });

    it("should drop stale indexes", async () => {
      mockListIndexesToArray.mockResolvedValueOnce([
        { name: "_id_" },
        { name: "email_unique" },
        { name: "stale_index" },
      ]);

      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockDropIndex).toHaveBeenCalledWith("stale_index");
      expect(mockDropIndex).toHaveBeenCalledTimes(1);
    });

    it("should not drop the default _id_ index", async () => {
      mockListIndexesToArray.mockResolvedValueOnce([{ name: "_id_" }]);

      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockDropIndex).not.toHaveBeenCalled();
    });

    it("should clean up on connection failure", async () => {
      mockConnect.mockRejectedValueOnce(new Error("Connection refused"));
      const db = createDatabase();

      await expect(db.connect()).rejects.toThrow("Connection refused");
      expect(db.isConnected()).toBe(false);
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });

  describe("disconnect", () => {
    it("should close the connection", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();

      expect(db.isConnected()).toBe(false);
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it("should be a no-op when not connected", async () => {
      const db = createDatabase();
      await db.disconnect();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    it("should return false before connect", () => {
      const db = createDatabase();
      expect(db.isConnected()).toBe(false);
    });

    it("should return true after connect", async () => {
      const db = createDatabase();
      await db.connect();
      expect(db.isConnected()).toBe(true);
    });

    it("should return false after disconnect", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();
      expect(db.isConnected()).toBe(false);
    });
  });

  describe("getDb", () => {
    it("should return the Db instance when connected", async () => {
      const db = createDatabase();
      await db.connect();
      const conn = db.getDb();
      expect(conn).toBeDefined();
    });

    it("should throw DatabaseError when not connected", () => {
      const db = createDatabase();
      expect(() => db.getDb()).toThrow(DatabaseError);
      expect(() => db.getDb()).toThrow("Database not connected");
    });

    it("should throw with code NOT_CONNECTED", () => {
      const db = createDatabase();
      try {
        db.getDb();
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe("NOT_CONNECTED");
      }
    });
  });

  describe("getClient", () => {
    it("should return the MongoClient when connected", async () => {
      const db = createDatabase();
      await db.connect();
      const client = db.getClient();
      expect(client).toBeDefined();
    });

    it("should throw DatabaseError when not connected", () => {
      const db = createDatabase();
      expect(() => db.getClient()).toThrow(DatabaseError);
      expect(() => db.getClient()).toThrow("Database not connected");
    });

    it("should throw with code NOT_CONNECTED", () => {
      const db = createDatabase();
      try {
        db.getClient();
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe("NOT_CONNECTED");
      }
    });
  });

  describe("schema without indexes", () => {
    it("should handle schemas with no indexes defined", async () => {
      const schemaNoIndexes: IMongoSchema = {
        collectionName: "logs",
        validation: {
          $jsonSchema: {
            bsonType: "object",
            properties: { message: { bsonType: "string" } },
          },
        },
      };

      const db = createDatabase({ schemas: [schemaNoIndexes] });
      await db.connect();

      expect(mockCreateCollection).toHaveBeenCalledWith("logs", {
        validator: schemaNoIndexes.validation,
      });
      expect(mockCreateIndexes).not.toHaveBeenCalled();
    });
  });

  describe("logging", () => {
    it("should log a created collection at debug, and nothing else", async () => {
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockLoggerDebug).toHaveBeenCalledOnce();
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "Collection 'users' created.",
      );
      expectNoLogsBut("debug");
    });

    it("should log a dropped index at warn with its definition, and nothing else", async () => {
      const oldIndex = { name: "old_idx", key: { legacy: 1 }, unique: true };
      mockListCollectionsToArray.mockResolvedValueOnce([{ name: "users" }]);
      mockListIndexesToArray.mockResolvedValueOnce([
        { name: "_id_" },
        { name: "email_unique", key: { email: 1 }, unique: true },
        oldIndex,
      ]);
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(mockDbCommand).toHaveBeenCalledWith({
        collMod: "users",
        validator: testSchema.validation,
      });
      expect(mockCreateIndexes).toHaveBeenCalledWith(testSchema.indexes);
      expect(mockDropIndex).toHaveBeenCalledWith("old_idx");
      expect(mockLoggerWarn).toHaveBeenCalledOnce();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "Index 'old_idx' dropped from collection 'users'.",
        { index: { name: "old_idx", key: { legacy: 1 }, unique: true } },
      );
      expectNoLogsBut("warn");
    });

    it("should not log a drop that failed", async () => {
      const error = new Error("drop failed");
      mockListCollectionsToArray.mockResolvedValueOnce([{ name: "users" }]);
      mockListIndexesToArray.mockResolvedValueOnce([
        { name: "old_idx", key: { legacy: 1 }, unique: true },
      ]);
      mockDropIndex.mockRejectedValueOnce(error);
      const db = createDatabase({ schemas: [testSchema] });

      await expect(db.connect()).rejects.toBe(error);

      expectNoLogsBut();
    });

    it("should log nothing on connect without schemas and disconnect", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();

      expectNoLogsBut();
    });

    it("should rethrow a failed connection without logging it", async () => {
      const error = new Error("Connection refused");
      mockConnect.mockRejectedValueOnce(error);
      const db = createDatabase();

      await expect(db.connect()).rejects.toBe(error);
      expect(mockClose).toHaveBeenCalledOnce();
      expectNoLogsBut();
    });

    it("should create a child logger with a fixed context and the dbName", () => {
      createDatabase();

      expect(mockLoggerChild).toHaveBeenCalledOnce();
      expect(mockLoggerChild).toHaveBeenCalledWith({
        context: "MongoDatabase",
        metadata: { dbName: "test-db" },
      });
    });

    it("should connect without a logger option", async () => {
      const db = new MongoDatabase({ ...baseOptions, schemas: [testSchema] });

      await expect(db.connect()).resolves.toBeUndefined();
    });
  });
});
