// Plain-assertion test for the trade balance (node --test tests/unit/valuation.test.mts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { balance, sideWorth, statedFlag, type TradeSide, type ValuedSlab } from "../../src/lib/valuation.ts";

const slab = (tokenId: string, market: number, stated: number, basis: ValuedSlab["basis"] = "market"): ValuedSlab => ({
  tokenId,
  market,
  stated,
  basis,
});
const side = (slabs: ValuedSlab[], cash = 0): TradeSide => ({ slabs, cash });

test("each slab counts at the basis its owner picked", () => {
  assert.equal(sideWorth(side([slab("1", 100, 150, "market"), slab("2", 200, 260, "stated")], 10)), 370);
});

test("a single basis can be forced over every slab", () => {
  const s = side([slab("1", 100, 150, "market"), slab("2", 200, 260, "stated")]);
  assert.equal(sideWorth(s, "market"), 300);
  assert.equal(sideWorth(s, "stated"), 410);
});

test("an even swap is fair and needs no cash", () => {
  const b = balance(side([slab("1", 100, 100)]), side([slab("2", 102, 102)]));
  assert.equal(b.verdict, "fair");
  assert.equal(b.evenOut, 2);
});

test("giving much more than you get is flagged against you, with the cash that squares it", () => {
  // 3 slabs at $100 for 1 slab at $150: you give $300, get $150.
  const b = balance(side([slab("1", 100, 100), slab("2", 100, 100), slab("3", 100, 100)]), side([slab("4", 150, 150)]));
  assert.equal(b.give, 300);
  assert.equal(b.get, 150);
  assert.equal(b.net, -150);
  assert.equal(b.against, true);
  assert.equal(b.verdict, "lopsided");
  assert.equal(b.evenOut, 150);
});

test("cash on either side moves the balance", () => {
  const b = balance(side([slab("1", 100, 100)], 50), side([slab("2", 150, 150)]));
  assert.equal(b.net, 0);
  assert.equal(b.verdict, "fair");
});

test("the same trade can look fair at stated values and bad at market values", () => {
  const give = side([slab("1", 100, 100)]);
  const get = side([slab("2", 60, 100)]);
  assert.equal(balance(give, get, "stated").verdict, "fair");
  const atMarket = balance(give, get, "market");
  assert.equal(atMarket.against, true);
  assert.equal(atMarket.verdict, "lopsided");
});

test("a stated value far from market gets flagged", () => {
  assert.equal(statedFlag({ market: 100, stated: 190 }), "high");
  assert.equal(statedFlag({ market: 100, stated: 60 }), "low");
  assert.equal(statedFlag({ market: 100, stated: 110 }), null);
});

test("a slab that isn't listed has no stated price, so it counts at market whatever is picked", () => {
  const unlisted: ValuedSlab = { tokenId: "9", market: 120, stated: null, basis: "stated" };
  assert.equal(sideWorth(side([unlisted])), 120);
  assert.equal(sideWorth(side([unlisted]), "stated"), 120);
  assert.equal(statedFlag(unlisted), null);
});

test("an empty trade does not divide by zero", () => {
  const b = balance(side([]), side([]));
  assert.equal(b.gap, 0);
  assert.equal(b.verdict, "fair");
});
