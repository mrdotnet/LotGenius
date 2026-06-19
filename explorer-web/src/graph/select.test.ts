import { describe, expect, it } from "vitest";
import type { GraphNode, Lot } from "../data/types";
import { lotsUnderNode, nodeMatches, pickFocusLot } from "./select";

function lot(
  lot_id: number,
  category: string,
  make: string,
  model: string,
  sale_date = "2020-06-01",
): Lot {
  return {
    lot_id,
    title: `${make} ${model}`,
    category,
    make,
    model,
    year: 2020,
    region: "Iowa",
    auction: "Spring",
    sale_date,
    hammer_price: 1000,
    features: [1, 0, 0],
  };
}

const LOTS: Lot[] = [
  lot(1, "Combine", "John Deere", "S680", "2021-01-01"),
  lot(2, "Combine", "John Deere", "S680", "2022-05-01"),
  lot(3, "Combine", "John Deere", "S780", "2020-01-01"),
  lot(4, "Combine", "Case IH", "8240", "2020-01-01"),
  lot(5, "Tractor", "John Deere", "8R", "2020-01-01"),
];

const categoryNode: GraphNode = {
  id: "category:Combine",
  kind: "category",
  label: "Combine",
  lot_count: 4,
  category: "Combine",
};
const makeNode: GraphNode = {
  id: "make:Combine|John Deere",
  kind: "make",
  label: "John Deere",
  lot_count: 3,
  category: "Combine",
  make: "John Deere",
};
const modelNode: GraphNode = {
  id: "model:Combine|John Deere|S680",
  kind: "model",
  label: "S680",
  lot_count: 2,
  category: "Combine",
  make: "John Deere",
  model: "S680",
};

describe("nodeMatches", () => {
  it("category node matches every lot in the category", () => {
    expect(LOTS.filter((l) => nodeMatches(l, categoryNode)).map((l) => l.lot_id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("make node narrows to category+make", () => {
    expect(LOTS.filter((l) => nodeMatches(l, makeNode)).map((l) => l.lot_id)).toEqual([
      1, 2, 3,
    ]);
  });

  it("model node narrows to category+make+model", () => {
    expect(LOTS.filter((l) => nodeMatches(l, modelNode)).map((l) => l.lot_id)).toEqual([
      1, 2,
    ]);
  });

  it("does not match a same-named make under a different category", () => {
    // Tractor/John Deere must NOT match the Combine/John Deere make node.
    expect(nodeMatches(LOTS[4], makeNode)).toBe(false);
  });
});

describe("lotsUnderNode", () => {
  it("returns members in lot_id-asc order", () => {
    expect(lotsUnderNode(LOTS, makeNode).map((l) => l.lot_id)).toEqual([1, 2, 3]);
  });

  it("returns [] when nothing matches", () => {
    const empty: GraphNode = { ...modelNode, model: "DOES_NOT_EXIST" };
    expect(lotsUnderNode(LOTS, empty)).toEqual([]);
  });
});

describe("pickFocusLot", () => {
  it("picks the most recent sale under the node", () => {
    // S680s sold 2021-01 and 2022-05 → newest is lot 2.
    expect(pickFocusLot(LOTS, modelNode)?.lot_id).toBe(2);
  });

  it("breaks sale_date ties by highest lot_id", () => {
    const tied = [
      lot(10, "Skid Steer", "Bobcat", "S650", "2020-01-01"),
      lot(11, "Skid Steer", "Bobcat", "S650", "2020-01-01"),
    ];
    const node: GraphNode = {
      id: "make:Skid Steer|Bobcat",
      kind: "make",
      label: "Bobcat",
      lot_count: 2,
      category: "Skid Steer",
      make: "Bobcat",
    };
    expect(pickFocusLot(tied, node)?.lot_id).toBe(11);
  });

  it("returns null for an empty node", () => {
    const empty: GraphNode = { ...modelNode, model: "DOES_NOT_EXIST" };
    expect(pickFocusLot(LOTS, empty)).toBeNull();
  });
});
