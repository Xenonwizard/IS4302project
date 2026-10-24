import cards from "@/data/pokemon-cards.json";
import { BRAND } from "./brand";
import { hashString, hexId, makeRandom } from "./rng";
import {
  COMMENT_TEXT,
  DAY,
  GRADE_STEPS,
  HANDLES,
  NOTES,
  NOW_MS,
  gradeLabel,
  syntheticHandle,
} from "./pools";
import type {
  ActivityEvent,
  Comment,
  Confidence,
  Grader,
  Listing,
  Offer,
  Sale,
} from "./types";

/**
 * Real cards from the Pokémon TCG API (pokemontcg.io): set, number, rarity,
 * hi-res scan and the raw (ungraded) TCGplayer market price at build time.
 * Everything else about a listing — grade, owner, ask, history — is generated.
 */
interface CardRecord {
  id: string;
  name: string;
  number: string;
  printedTotal: number;
  rarity: string;
  set: string;
  series: string;
  year: number;
  image: string;
  thumb: string;
  types: string[];
  raw: number;
}

const CARDS = cards as CardRecord[];

/** Graded premium over the raw price. Vintage gem mints are scarce, so they carry more. */
const GRADE_MULT: Record<string, [vintage: number, modern: number]> = {
  "10": [12, 3.4],
  "9.5": [5.5, 2.2],
  "9": [2.8, 1.45],
  "8.5": [2, 1.2],
  "8": [1.6, 1.05],
  "7.5": [1.3, 0.95],
  "7": [1.1, 0.88],
  "6.5": [0.95, 0.8],
  "6": [0.85, 0.75],
};

const GRADER_MULT: Record<Grader, number> = { PSA: 1, BGS: 0.95, CGC: 0.84, SGC: 0.8 };

const TYPE_HUE: Record<string, number> = {
  Fire: 12,
  Water: 205,
  Grass: 112,
  Lightning: 48,
  Psychic: 285,
  Fighting: 24,
  Darkness: 255,
  Metal: 210,
  Dragon: 40,
  Fairy: 330,
  Colorless: 30,
};

function money(n: number): number {
  if (n >= 1000) return Math.round(n);
  return Math.round(n * 100) / 100;
}

/** Short variant label used in titles, e.g. "Rare Holo" -> "Holo". */
function variantLabel(rarity: string): string {
  if (rarity === "Rare Holo") return "Holo";
  if (rarity === "Rare") return "Rare";
  return rarity.replace(/^Rare /, "");
}

function buildSales(
  rnd: ReturnType<typeof makeRandom>,
  fmv: number,
): Sale[] {
  const count = rnd.int(3, 8);
  const sales: Sale[] = [];
  let cursor = NOW_MS - rnd.int(4, 40) * DAY;
  let value = fmv * rnd.float(0.93, 1.07);
  for (let i = 0; i < count; i++) {
    sales.push({
      date: new Date(cursor).toISOString(),
      price: money(value),
    });
    cursor -= rnd.int(12, 95) * DAY;
    value = value * rnd.float(0.82, 1.02);
  }
  return sales;
}

function buildActivity(
  rnd: ReturnType<typeof makeRandom>,
  owner: string,
  price: number,
  sales: Sale[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const mintAt = NOW_MS - rnd.int(40, 420) * DAY;
  events.push({
    kind: "Mint",
    price: money(price * rnd.float(0.7, 1.05)),
    from: "0x0000...0000",
    to: owner,
    at: new Date(mintAt).toISOString(),
    txHash: `0x${hexId(hashString(owner + mintAt), 8)}`,
  });

  const flips = rnd.int(0, 2);
  let holder = owner;
  for (let i = 0; i < flips; i++) {
    const next = rnd.chance(0.5) ? rnd.pick(HANDLES) : syntheticHandle(rnd.next);
    const at = mintAt + (i + 1) * rnd.int(6, 60) * DAY;
    if (at > NOW_MS) break;
    events.push({
      kind: "Sale",
      price: sales[Math.min(i, sales.length - 1)]?.price ?? money(price),
      from: holder,
      to: next,
      at: new Date(at).toISOString(),
      txHash: `0x${hexId(hashString(next + at), 8)}`,
    });
    holder = next;
  }

  const listedAt = NOW_MS - rnd.int(1, 26) * DAY;
  events.push({
    kind: "Listed",
    price: money(price),
    from: holder,
    to: `${BRAND.name} Marketplace`,
    at: new Date(listedAt).toISOString(),
    txHash: `0x${hexId(hashString(holder + listedAt), 8)}`,
  });

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function buildOffers(
  rnd: ReturnType<typeof makeRandom>,
  listingId: string,
  price: number,
): Offer[] {
  if (!rnd.chance(0.55)) return [];
  const count = rnd.int(1, 3);
  const offers: Offer[] = [];
  for (let i = 0; i < count; i++) {
    const amount = money(price * rnd.float(0.45, 0.94));
    const createdAt = NOW_MS - rnd.int(1, 96) * 3_600_000;
    offers.push({
      id: `${listingId.slice(0, 8)}-o${i}`,
      listingId,
      amount,
      from: rnd.chance(0.4) ? rnd.pick(HANDLES) : syntheticHandle(rnd.next),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(NOW_MS + rnd.int(4, 120) * 3_600_000).toISOString(),
    });
  }
  return offers.sort((a, b) => b.amount - a.amount);
}

function buildComments(rnd: ReturnType<typeof makeRandom>, listingId: string): Comment[] {
  if (!rnd.chance(0.45)) return [];
  const count = rnd.int(1, 3);
  const used = rnd.shuffle(COMMENT_TEXT).slice(0, count);
  return used.map((text, i) => ({
    id: `${listingId.slice(0, 8)}-c${i}`,
    user: rnd.chance(0.5) ? rnd.pick(HANDLES) : syntheticHandle(rnd.next),
    text,
    at: new Date(NOW_MS - rnd.int(1, 700) * 3_600_000).toISOString(),
  }));
}

/** Graded market value: raw price times the grade and grader premiums, with some noise. */
function gradedValue(card: CardRecord, grader: Grader, grade: number, rnd: ReturnType<typeof makeRandom>): number {
  const [mv, mm] = GRADE_MULT[String(grade)] ?? [1, 1];
  const vintage = card.year < 2004;
  return money(Math.max(8, card.raw * (vintage ? mv : mm) * GRADER_MULT[grader] * rnd.float(0.92, 1.08)));
}

function titleFor(card: CardRecord, grader: Grader, grade: number, label: string): string {
  return `${card.year} Pokémon ${card.set} #${card.number}/${card.printedTotal} ${card.name} - ${variantLabel(card.rarity)} (${grader} ${grade} ${label})`;
}

function makeListing(card: CardRecord, index: number): Listing {
  const rnd = makeRandom(0x5ab1 + index * 7919);
  const vintage = card.year < 2004;

  const grader = rnd.pick(["PSA", "PSA", "PSA", "CGC", "CGC", "BGS", "SGC"] as Grader[]);
  // Modern pulls are usually submitted fresh, so they skew to the top grades.
  const grade = vintage
    ? rnd.pick(rnd.chance(0.35) ? [9, 9, 10] : GRADE_STEPS)
    : rnd.pick(rnd.chance(0.7) ? [9, 9.5, 10, 10] : [8, 8.5, 9]);
  const label = gradeLabel(grader, grade);

  const fmv = gradedValue(card, grader, grade, rnd);
  const skew = rnd.float(-0.3, 0.26);
  const price = money(Math.max(6, fmv * (1 - skew)));

  const id = hexId(0xc0de + index * 104729);
  const owner = rnd.chance(0.45) ? rnd.pick(HANDLES) : syntheticHandle(rnd.next);
  const sales = buildSales(rnd, fmv);
  const confidence: Confidence =
    sales.length >= 6 ? "High" : sales.length >= 4 ? "Medium" : "Low";

  const cardNumber = `${card.number}/${card.printedTotal}`;
  const variant = card.rarity;
  const title = titleFor(card, grader, grade, label);

  return {
    id,
    title,
    shortName: card.name,
    year: card.year,
    set: card.set,
    series: card.series,
    cardNumber,
    subject: card.name,
    grader,
    grade,
    gradeLabel: label,
    language: "English",
    variant,
    price,
    fmv,
    confidence,
    owner,
    certNumber: String(rnd.int(1_000_000, 9_999_999)) + String(rnd.int(10, 99)),
    listedAt: new Date(NOW_MS - rnd.int(1, 600) * 3_600_000).toISOString(),
    endsAt: new Date(NOW_MS + rnd.int(6, 26) * 6 * 3_600_000).toISOString(),
    likes: rnd.int(0, 84),
    offers: buildOffers(rnd, id, price),
    sales,
    activity: buildActivity(rnd, owner, price, sales),
    comments: buildComments(rnd, id),
    tokenId: String(rnd.int(100_000, 999_999)) + String(rnd.int(1000, 9999)),
    contract: `0x${hexId(0x251b, 20)}`,
    ownerAddress: `0x${hexId(hashString(owner), 20)}`,
    chain: "Polygon",
    note: rnd.pick(NOTES),
    image: card.image,
    thumb: card.thumb,
    holo: variant !== "Rare",
    hue: TYPE_HUE[card.types[0] ?? "Colorless"] ?? 30,
  };
}

export const LISTINGS: Listing[] = CARDS.slice(0, 15).map((card, i) => makeListing(card, i));

export const LISTING_BY_ID = new Map(LISTINGS.map((l) => [l.id, l]));

export function getListing(id: string): Listing | undefined {
  return LISTING_BY_ID.get(id);
}

/**
 * Slabs the user submitted live in browser storage, not the catalog. The store
 * registers them here on load so getListing finds them like any other slab.
 */
export function registerListing(listing: Listing): void {
  LISTING_BY_ID.set(listing.id, listing);
  if (listing.tokenId) {
    LISTING_BY_ID.set(`token-${listing.tokenId}`, listing);
    LISTING_BY_ID.set(listing.tokenId, listing);
  }
}

/**
 * Creates a clean, typed Listing structure directly from on-chain smart contract data
 * (SlabVault and SlabMarket), preserving authentic titles, images, and prices.
 */
export function buildOnChainListing(input: {
  tokenId: string;
  title: string;
  image: string;
  grader: Grader;
  certNumber: string;
  price?: number;
  declaredValueCents?: number;
  owner: string;
  ownerAddress?: string;
  listedAt?: string;
  contract?: string;
}): Listing {
  const id = `token-${input.tokenId}`;
  const fmv = input.declaredValueCents ? input.declaredValueCents / 100 : (input.price ?? 1000);
  const price = input.price ?? fmv;

  // Try to parse grade and grade label from title if present, e.g. "(PSA 10 GEM MT)" or "(PSA 9.5 MINT+)"
  const gradeMatch = input.title.match(/\((?:PSA|BGS|CGC|SGC)\s+([\d.]+)(?:\s+([^)]+))?\)/i);
  const grade = gradeMatch ? parseFloat(gradeMatch[1]) : 10;
  const gradeLabel = gradeMatch && gradeMatch[2] ? gradeMatch[2].trim() : "GEM MT";

  // Extract short name (e.g. "Alakazam ★" or "Charizard")
  let shortName = input.title;
  const titleParts = input.title.split("#");
  if (titleParts.length > 1) {
    const afterHash = titleParts[1].replace(/^\d+(\/\d+)?\s+/, "");
    const nameOnly = afterHash.split(" - ")[0].split(" (")[0];
    if (nameOnly) shortName = nameOnly.trim();
  }

  // Extract set and year if present: "2006 Pokémon Crystal Guardians ..."
  const yearMatch = input.title.match(/^(\d{4})\s+Pokémon\s+([^-#(]+)/i);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  const set = yearMatch ? yearMatch[2].trim() : "Pokéchain Vault";

  const numMatch = input.title.match(/#(\d+(?:\/\d+)?)/);
  const cardNumber = numMatch ? numMatch[1] : input.tokenId;

  return {
    id,
    tokenId: input.tokenId,
    title: input.title,
    shortName,
    year,
    set,
    series: "Authentic",
    cardNumber,
    subject: shortName,
    grader: input.grader,
    grade,
    gradeLabel,
    language: "English",
    variant: "Holo",
    price,
    fmv,
    confidence: "High",
    owner: input.owner,
    ownerAddress: input.ownerAddress || "",
    certNumber: input.certNumber,
    listedAt: input.listedAt || new Date().toISOString(),
    endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    likes: 0,
    offers: [],
    sales: [],
    activity: [
      {
        kind: "Mint",
        from: "0x0000...0000",
        to: input.owner,
        at: input.listedAt || new Date().toISOString(),
        txHash: `0x${hexId(hashString(input.tokenId + input.certNumber), 8)}`,
      },
    ],
    comments: [],
    contract: input.contract || "",
    chain: "Polygon",
    note: `Vaulted and insured on Pokéchain. Backed 1:1 by physical slab.`,
    image: input.image,
    thumb: input.image,
    holo: true,
    hue: 200,
  };
}

/**
 * Stand-in for the grader's cert registry: a cert number always resolves to the
 * same card and grade, the way PSA's lookup returns what is printed on the label.
 */
export function lookupCert(grader: Grader, certNumber: string): { card: CardRecord; grade: number } | null {
  const cert = certNumber.trim();
  if (!/^\d{6,10}$/.test(cert)) return null;
  const rnd = makeRandom(hashString(`${grader}cert${cert}`));
  return { card: rnd.pick(CARDS), grade: rnd.pick([10, 10, 9.5, 9, 9, 9, 8.5, 8, 7]) };
}

/** What the registry shows for a cert, for previewing before it is vaulted. */
export function certPreview(grader: Grader, certNumber: string) {
  const hit = lookupCert(grader, certNumber);
  if (!hit) return null;
  const { card, grade } = hit;
  return {
    title: titleFor(card, grader, grade, gradeLabel(grader, grade)),
    image: card.image,
    thumb: card.thumb,
    grade,
    gradeLabel: gradeLabel(grader, grade),
  };
}

/** A freshly graded slab the user sent in, vaulted in their name and not yet listed. */
export function makeSubmittedListing(input: {
  grader: Grader;
  certNumber: string;
  owner: string;
  nowMs: number;
}): Listing | null {
  const hit = lookupCert(input.grader, input.certNumber);
  if (!hit) return null;
  return makeOwnedListing({ ...input, card: hit.card, grade: hit.grade });
}

/** Slabs the demo account starts with, so there is something to list or trade. */
const STARTER_SLABS: { cardId: string; grader: Grader; grade: number; certNumber: string }[] = [
  { cardId: "swsh7-189", grader: "PSA", grade: 10, certNumber: "81240517" },
  { cardId: "sv3pt5-199", grader: "PSA", grade: 10, certNumber: "92031866" },
  { cardId: "dp3-14", grader: "CGC", grade: 9, certNumber: "4127730015" },
];

export function makeStarterListings(owner: string, nowMs: number): Listing[] {
  return STARTER_SLABS.flatMap((s, i) => {
    const card = CARDS.find((c) => c.id === s.cardId);
    return card ? [makeOwnedListing({ ...s, card, owner, nowMs: nowMs - (i + 1) * 9 * DAY })] : [];
  });
}

function makeOwnedListing(input: {
  card: CardRecord;
  grader: Grader;
  grade: number;
  certNumber: string;
  owner: string;
  nowMs: number;
}): Listing {
  const { card, grader, grade, owner, nowMs } = input;
  const rnd = makeRandom(hashString(`${card.id}${grader}${grade}${input.certNumber}`));
  const label = gradeLabel(grader, grade);
  const fmv = gradedValue(card, grader, grade, rnd);
  const sales = buildSales(rnd, fmv);
  const id = `sub-${hashString(`${grader}${input.certNumber}`).toString(36)}`;
  return {
    id,
    title: titleFor(card, grader, grade, label),
    shortName: card.name,
    year: card.year,
    set: card.set,
    series: card.series,
    cardNumber: `${card.number}/${card.printedTotal}`,
    subject: card.name,
    grader,
    grade,
    gradeLabel: label,
    language: "English",
    variant: card.rarity,
    price: fmv,
    fmv,
    confidence: sales.length >= 6 ? "High" : sales.length >= 4 ? "Medium" : "Low",
    owner,
    certNumber: input.certNumber.trim(),
    listedAt: new Date(nowMs).toISOString(),
    endsAt: new Date(nowMs + 7 * DAY).toISOString(),
    likes: 0,
    offers: [],
    sales,
    activity: [
      {
        kind: "Mint",
        from: "0x0000...0000",
        to: owner,
        at: new Date(nowMs).toISOString(),
        txHash: `0x${hexId(hashString(id), 8)}`,
      },
    ],
    comments: [],
    tokenId: String(rnd.int(100_000, 999_999)) + String(rnd.int(1000, 9999)),
    contract: `0x${hexId(0x251b, 20)}`,
    ownerAddress: `0x${hexId(hashString(owner), 20)}`,
    chain: "Polygon",
    note: `Submitted by ${owner}. ${grader} cert ${input.certNumber} was checked against the registry before the slab entered the ${BRAND.vaultCity} vault.`,
    image: card.image,
    thumb: card.thumb,
    holo: card.rarity !== "Rare",
    hue: TYPE_HUE[card.types[0] ?? "Colorless"] ?? 30,
  };
}

export function topOffer(listing: Listing): Offer | undefined {
  return listing.offers[0];
}

/* ---------------- filter facets ---------------- */

function facet(values: string[]): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export const FACETS = {
  series: facet(LISTINGS.map((l) => l.series)),
  grader: facet(LISTINGS.map((l) => l.grader)),
  grade: facet(LISTINGS.map((l) => String(l.grade))).sort(
    (a, b) => Number(b.value) - Number(a.value),
  ),
  variant: facet(LISTINGS.map((l) => l.variant)),
  set: facet(LISTINGS.map((l) => l.set)),
  year: facet(LISTINGS.map((l) => String(l.year))).sort(
    (a, b) => Number(b.value) - Number(a.value),
  ),
};

export const PRICE_BOUNDS = {
  min: 0,
  max: Math.ceil(Math.max(...LISTINGS.map((l) => Math.max(l.price, l.fmv))) / 100) * 100,
};

/** Slabs collectors are watching and bidding on the most. */
export const MOST_WATCHED = [...LISTINGS]
  .sort((a, b) => b.likes + b.offers.length * 10 - (a.likes + a.offers.length * 10))
  .slice(0, 18);

export const GRAILS = [...LISTINGS].sort((a, b) => b.fmv - a.fmv).slice(0, 12);

export const RECENT_SALES = LISTINGS.flatMap((l) =>
  l.activity
    .filter((a) => a.kind === "Sale")
    .map((a) => ({ listing: l, event: a })),
)
  .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at))
  .slice(0, 30);

/** Deterministic comparable-sales series for any grader/grade combination. */
export function salesFor(listing: Listing, grader: Grader, grade: number): Sale[] {
  if (grader === listing.grader && grade === listing.grade) return listing.sales;
  const rnd = makeRandom(hashString(`${listing.id}${grader}${grade}`));
  const gradeDelta = grade - listing.grade;
  const anchor = Math.max(
    3,
    listing.fmv * Math.pow(1.34, gradeDelta) * (grader === "PSA" ? 1.12 : grader === "BGS" ? 1.05 : 0.94),
  );
  const count = rnd.int(0, 7);
  const sales: Sale[] = [];
  let cursor = NOW_MS - rnd.int(5, 70) * DAY;
  let value = anchor * rnd.float(0.9, 1.1);
  for (let i = 0; i < count; i++) {
    sales.push({ date: new Date(cursor).toISOString(), price: Math.round(value * 100) / 100 });
    cursor -= rnd.int(10, 120) * DAY;
    value *= rnd.float(0.8, 1.04);
  }
  return sales;
}

/** Population report rows for the details panel. */
export function population(listing: Listing): { grade: string; count: number }[] {
  const rnd = makeRandom(hashString(`pop${listing.id}`));
  return GRADE_STEPS.slice()
    .reverse()
    .map((g) => ({
      grade: String(g),
      count: Math.round(rnd.int(4, 2400) * (g >= 9 ? 1 : 1.6)),
    }));
}
