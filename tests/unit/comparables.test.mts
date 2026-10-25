import assert from "node:assert/strict";
import { test } from "node:test";
import { cardFromTokenURI, cardGrade, matchesComparable, sameCard } from "../../src/lib/comparables.ts";

const card = { title: "1999 Pokémon Base #4/102 Charizard - Holo (PSA 10 GEM MT)", image: "https://images.pokemontcg.io/base1/4_hires.png", grader: "PSA" };

test("reads Unicode card details from on-chain ERC-721 metadata without fetching a URL", () => {
  const metadata = { name: card.title, image: card.image, attributes: [{ trait_type: "Grader", value: "PSA" }, { trait_type: "Cert number", value: "12345678" }] };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
  assert.deepEqual(cardFromTokenURI(uri), { ...card, certNumber: "12345678" });
  assert.throws(() => cardFromTokenURI("https://example.com/pricing.json"));
  assert.throws(() => cardFromTokenURI(`data:application/json;base64,${Buffer.from("{}").toString("base64")}`));
});

test("same raw card across grades, graders, and thumbnail sizes", () => {
  const other = { ...card, title: card.title.replace("PSA 10 GEM MT", "CGC 9 MINT"), image: "https://images.pokemontcg.io/base1/4.png", grader: "CGC" };
  assert.equal(sameCard(card, other), true);
  assert.equal(matchesComparable(card, other, "all", "nearby"), true);
  assert.equal(matchesComparable(card, other, "PSA"), false);
  assert.equal(matchesComparable(card, other, "all", "same"), false);
});

test("different printings of the same Pokemon are excluded", () => {
  assert.equal(sameCard(card, { ...card, image: "https://images.pokemontcg.io/ecard3/146_hires.png" }), false);
  assert.equal(sameCard({ ...card, image: "" }, { ...card, title: card.title.replace("Base #4/102", "Skyridge #146/144"), image: "" }), false);
});

test("custom images use full card identity rather than Pokemon name alone", () => {
  assert.equal(sameCard({ ...card, image: "https://example.com/a.png" }, { ...card, image: "https://example.com/b.png", title: card.title.replace("PSA 10 GEM MT", "BGS 9.5 MINT+") }), true);
  assert.equal(sameCard({ ...card, image: "", title: "Charizard" }, { ...card, image: "", title: "Charizard" }), false);
});

test("missing grades stay unknown", () => {
  const ungraded = { ...card, title: "1999 Pokémon Base #4/102 Charizard - Holo" };
  assert.equal(cardGrade(ungraded), null);
  assert.equal(matchesComparable(card, ungraded), true);
  assert.equal(matchesComparable(card, ungraded, "all", "nearby"), false);
});

test("nearby grades include fractional steps and respect the boundary", () => {
  assert.equal(matchesComparable(card, { ...card, title: card.title.replace("PSA 10", "PSA 9.5") }, "PSA", "nearby"), true);
  assert.equal(matchesComparable(card, { ...card, title: card.title.replace("PSA 10", "PSA 8.5") }, "PSA", "nearby"), false);
});
