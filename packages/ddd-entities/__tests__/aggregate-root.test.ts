import { describe, expect, expectTypeOf, it } from "vitest";
import { AggregateRoot } from "~/aggregate-root";
import { Entity } from "~/entity";
import { Id } from "~/id.vo";

// The type cases are enforced by `tsc --noEmit` (`pnpm typecheck`): `vitest
// run` erases the types. Each `@ts-expect-error` sits on the line the error
// is reported on, so that another error elsewhere does not satisfy it.

type OrderId = Id<"Order">;

interface OrderAttributes {
  status: "open" | "placed";
  lines: number;
}

interface OrderLineAdded {
  type: "order.line-added";
  quantity: number;
}

interface OrderPlaced {
  type: "order.placed";
  orderId: string;
}

type OrderEvent = OrderLineAdded | OrderPlaced;

class Order extends AggregateRoot<OrderId, OrderAttributes, OrderEvent> {
  public constructor(id: OrderId, attributes: OrderAttributes) {
    super(id, attributes);
  }

  addLine(quantity: number): void {
    this.setAttribute("lines", this.attributes.lines + quantity);
    this.raise({ type: "order.line-added", quantity });
  }

  place(): void {
    this.setAttribute("status", "placed");
    this.raise({ type: "order.placed", orderId: this.id.value });
  }

  // Mutations that raise nothing of their own.
  setLines(lines: number): void {
    this.setAttribute("lines", lines);
  }

  reset(): void {
    this.setAttributes({ status: "open", lines: 0 });
  }

  raiseOther(): void {
    // @ts-expect-error TS2322: an event outside TEvent
    this.raise({ type: "other" });
  }
}

// An aggregate that raises nothing: TEvent stays never.
class Ledger extends AggregateRoot<OrderId, OrderAttributes> {
  public constructor(id: OrderId, attributes: OrderAttributes) {
    super(id, attributes);
  }

  tryRaise(): void {
    // @ts-expect-error TS2345: with TEvent = never, raise takes nothing
    this.raise({ type: "order.placed", orderId: "o1" });
  }
}

function newOrder(): Order {
  return new Order(Id.create<"Order">("o1"), { status: "open", lines: 0 });
}

describe("AggregateRoot events", () => {
  it("pulls the raised events in order, and empties the queue", () => {
    const order = newOrder();

    order.addLine(2);
    order.place();

    expect(order.pullEvents()).toStrictEqual([
      { type: "order.line-added", quantity: 2 },
      { type: "order.placed", orderId: "o1" },
    ]);
    expect(order.pullEvents()).toStrictEqual([]);
  });

  it("drops the queued events on clearEvents", () => {
    const order = newOrder();

    order.addLine(1);
    order.clearEvents();

    expect(order.pullEvents()).toStrictEqual([]);
  });

  it("raises nothing of its own, on construction or mutation", () => {
    const order = newOrder();

    expect(order).toBeInstanceOf(Entity);
    expect(order.pullEvents()).toStrictEqual([]);

    order.setLines(3);
    order.reset();

    expect(order.attributes).toStrictEqual({ status: "open", lines: 0 });
    expect(order.pullEvents()).toStrictEqual([]);
  });
});

describe("AggregateRoot types", () => {
  it("keeps raise protected, and types pullEvents as TEvent[]", () => {
    const order = newOrder();
    const misuse = (): void => {
      // @ts-expect-error TS2445: raise is protected
      order.raise({ type: "order.placed", orderId: "o1" });
    };

    const ledger = new Ledger(Id.create<"Order">("l1"), {
      status: "open",
      lines: 0,
    });

    expectTypeOf(order.pullEvents()).toEqualTypeOf<OrderEvent[]>();
    expectTypeOf(ledger.pullEvents()).toEqualTypeOf<never[]>();
    expect(misuse).toBeTypeOf("function");
  });

  it("has none of the 2.0.0 statics, lifecycle and timestamps", () => {
    const order = newOrder();
    const misuse = (): void => {
      // A read, not a call: the lint preset refuses a call of a member that
      // does not exist (no-unsafe-call). 2.0.0's create compiled with an
      // attribute missing; on 2.0.0 each line here fails with TS2578.
      // @ts-expect-error TS2339: no create
      void Order.create;
      // @ts-expect-error TS2339: no rehydrate
      void Order.rehydrate;
      // @ts-expect-error TS2339: no markForRemoval
      void order.markForRemoval;
      // @ts-expect-error TS2339: no addEvent
      void order.addEvent;
      // @ts-expect-error TS2339: no createdAt
      void order.createdAt;
    };

    expect(misuse).toBeTypeOf("function");
    for (const name of ["create", "rehydrate"]) {
      expect(Reflect.has(Order, name)).toBe(false);
    }
    for (const name of [
      "markForRemoval",
      "isMarkedForRemoval",
      "addEvent",
      "createdAt",
      "updatedAt",
      "modelName",
    ]) {
      expect(Reflect.has(order, name)).toBe(false);
    }
  });
});
