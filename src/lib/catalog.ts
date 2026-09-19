import { BRAND } from "./brand";
import { hashString, hexId, makeRandom } from "./rng";
import {
  COMMENT_TEXT,
  DAY,
  GRADE_STEPS,
  HANDLES,
  LANGUAGES,
  MTG_SETS,
  NOTES,
  NOW_MS,
  ONE_PIECE_SETS,
  ONE_PIECE_SUBJECTS,
  PACK_NAMES,
  PLAYERS,
  POKEMON_SETS,
  POKEMON_SET_TOTALS,
  POKEMON_SUBJECTS,
  POKEMON_VARIANTS,
  POKEMON_SUBJECTS_VINTAGE,
  POKEMON_VARIANTS_VINTAGE,
  SPORTS_BRANDS,
  SPORTS_VARIANTS,
  gradeLabel,
  syntheticHandle,
} from "./pools";
import type {
  ActivityEvent,
  ArtStyle,
  Category,
  Comment,
  Confidence,
  Grader,
  LeaderboardEntry,
  Listing,
  Offer,
  Pack,
  Sale,
} from "./types";

const CHASE = new Set([
  "Charizard",
  "Pikachu",
  "Mewtwo",
  "Lugia",
  "Umbreon",
  "Michael Jordan",
  "Kobe Bryant",
  "Mickey Mantle",
  "Lionel Messi",
  "Wayne Gretzky",
  "Black Lotus",
  "Monkey D. Luffy",
  "Shohei Ohtani",
  "Tom Brady",
]);

const GRADE_MULT: Record<string, number> = {
  "10": 2.4,
  "9.5": 1.7,
  "9": 1.25,
  "8.5": 1,
  "8": 0.84,
  "7.5": 0.7,
  "7": 0.6,
  "6.5": 0.5,
  "6": 0.42,
};

const CATEGORY_WEIGHTS: [Category, number][] = [
  ["Pokémon", 0.52],
  ["Baseball", 0.12],
  ["Basketball", 0.11],
  ["Football", 0.07],
  ["Soccer", 0.05],
  ["Hockey", 0.04],
  ["One Piece", 0.05],
  ["Magic: The Gathering", 0.04],
];

function pickCategory(roll: number): Category {
  let acc = 0;
  for (const [cat, w] of CATEGORY_WEIGHTS) {
    acc += w;
    if (roll <= acc) return cat;
  }
  return "Pokémon";
}

function money(n: number): number {
  if (n >= 1000) return Math.round(n);
  return Math.round(n * 100) / 100;
}

interface Blueprint {
  title: string;
  shortName: string;
  category: Category;
  year: number;
  set: string;
  cardNumber: string;
  subject: string;
  variant: string;
  style: ArtStyle;
  hype: number;
}

function blueprint(rnd: ReturnType<typeof makeRandom>, category: Category): Blueprint {
  if (category === "Pokémon") {
    const set = rnd.pick(POKEMON_SETS);
    const year = rnd.int(set.year[0], set.year[1]);
    const vintage = year < 2004;
    const subject = vintage
      ? rnd.pick(POKEMON_SUBJECTS_VINTAGE)
      : rnd.pick(POKEMON_SUBJECTS);
    const variant = vintage
      ? rnd.pick(POKEMON_VARIANTS_VINTAGE)
      : rnd.pick(POKEMON_VARIANTS.filter((v) => v.from <= year)).name;
    const modern = year >= 2019;
    const total = POKEMON_SET_TOTALS[set.name] ?? 102;
    // Secret rares sit above the printed set total.
    const secret = !vintage && rnd.chance(0.22);
    const number = secret ? total + rnd.int(1, 30) : rnd.int(1, total);
    const cardNumber = modern
      ? `${String(number).padStart(3, "0")}/${String(total).padStart(3, "0")}`
      : `${number}/${total}`;
    const setLabel = modern ? `${set.name} - ${set.code} EN` : set.name;
    return {
      title: `${year} ${setLabel} #${cardNumber} ${subject} - ${variant} (@GRADE@)`,
      shortName: subject,
      category,
      year,
      set: set.name,
      cardNumber,
      subject,
      variant,
      style: "pokemon",
      hype: CHASE.has(subject) ? 3 : year < 2001 ? 1.9 : 1,
    };
  }

  if (category === "One Piece") {
    const set = rnd.pick(ONE_PIECE_SETS);
    const year = rnd.int(set.year[0], set.year[1]);
    const subject = rnd.pick(ONE_PIECE_SUBJECTS);
    const variant = rnd.pick(["Alternate Art", "Manga Art", "Parallel Holo", "Standard", "Leader Parallel"]);
    const cardNumber = `${set.code}-${String(rnd.int(1, 120)).padStart(3, "0")}`;
    return {
      title: `${year} One Piece ${set.name} #${cardNumber} ${subject} - ${variant} (@GRADE@)`,
      shortName: subject,
      category,
      year,
      set: set.name,
      cardNumber,
      subject,
      variant,
      style: "anime",
      hype: CHASE.has(subject) ? 2.4 : 1.1,
    };
  }

  if (category === "Magic: The Gathering") {
    const set = rnd.pick(MTG_SETS);
    const year = rnd.int(set.year[0], set.year[1]);
    const subject = rnd.pick(set.subjects);
    // Foil treatments only exist on post-1996 printings.
    const variant =
      year < 1997
        ? "Standard"
        : rnd.pick(["Standard", "Foil", "Borderless Foil", "Retro Frame"]);
    return {
      title: `${year} Magic The Gathering ${set.name} ${subject} - ${variant} (@GRADE@)`,
      shortName: subject,
      category,
      year,
      set: set.name,
      cardNumber: set.code,
      subject,
      variant,
      style: "mtg",
      hype: subject === "Black Lotus" ? 14 : year < 1995 ? 4 : 1.2,
    };
  }

  const roster = PLAYERS[category] ?? PLAYERS.Baseball;
  const player = rnd.pick(roster);
  // Only brands that overlap the player's printing window.
  const brands = SPORTS_BRANDS.filter(
    (b) => b.from <= player.to && b.to >= player.from,
  );
  const brand = rnd.pick(brands.length ? brands : SPORTS_BRANDS);
  const lo = Math.max(brand.from, player.from);
  const hi = Math.min(brand.to, player.to);
  const year = rnd.int(lo, Math.max(lo, hi));
  const subject = player.name;
  const vintage = year < 1995;
  const variants = SPORTS_VARIANTS.filter(
    (v) =>
      v.from <= year &&
      (!v.brands || v.brands.includes(brand.name)) &&
      // a rookie card only exists in a player's first couple of years
      (v.name !== "Rookie Card" || year <= player.from + 1),
  );
  const variant = rnd.pick(variants.length ? variants : SPORTS_VARIANTS).name;
  const cardNumber = rnd.chance(0.5)
    ? String(rnd.int(1, 400))
    : `${rnd.pick(["BP", "USA", "RC", "AU"])}${rnd.int(1, 99)}`;
  return {
    title: `${year} ${brand.name} #${cardNumber} ${subject}${variant === "Standard" ? "" : ` - ${variant}`} (@GRADE@)`,
    shortName: subject,
    category,
    year,
    set: brand.name,
    cardNumber,
    subject,
    variant,
    style: "sports",
    hype: CHASE.has(subject) ? 3.4 : vintage ? 1.8 : 1,
  };
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

function makeListing(index: number): Listing {
  const rnd = makeRandom(0x5ab1 + index * 7919);
  const category = pickCategory(rnd.next());
  const bp = blueprint(rnd, category);

  const grader: Grader =
    category === "Pokémon"
      ? rnd.pick(["CGC", "PSA", "PSA", "CGC", "BGS", "SGC"] as Grader[])
      : rnd.pick(["PSA", "PSA", "SGC", "BGS", "CGC"] as Grader[]);
  const grade = rnd.pick(
    rnd.chance(0.55) ? [9, 9.5, 10, 10] : GRADE_STEPS,
  );
  const label = gradeLabel(grader, grade);

  const base = Math.exp(rnd.float(Math.log(7), Math.log(230)));
  const multiplier = (GRADE_MULT[String(grade)] ?? 1) * bp.hype;
  const fmv = money(Math.min(base * multiplier, 19_800));
  const skew = rnd.float(-0.34, 0.32);
  const price = money(Math.max(4.5, fmv * (1 - skew)));

  const id = hexId(0xc0de + index * 104729);
  const owner = rnd.chance(0.45) ? rnd.pick(HANDLES) : syntheticHandle(rnd.next);
  const sales = buildSales(rnd, fmv);
  const confidence: Confidence =
    sales.length >= 6 ? "High" : sales.length >= 4 ? "Medium" : "Low";

  const hueA = hashString(bp.subject) % 360;
  const hueB = (hueA + rnd.int(25, 150)) % 360;

  const title = bp.title.replace("@GRADE@", `${grader} ${grade} ${label}`);

  return {
    id,
    title,
    shortName: bp.shortName,
    category: bp.category,
    year: bp.year,
    set: bp.set,
    cardNumber: bp.cardNumber,
    subject: bp.subject,
    grader,
    grade,
    gradeLabel: label,
    language:
      bp.category === "Pokémon" && rnd.chance(0.18)
        ? "Japanese"
        : bp.category === "One Piece" && rnd.chance(0.3)
          ? "Japanese"
          : rnd.chance(0.04)
            ? rnd.pick(LANGUAGES)
            : "English",
    variant: bp.variant,
    pulledFrom: rnd.pick(PACK_NAMES),
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
    art: {
      style: bp.style,
      hueA,
      hueB,
      holo: /holo|foil|refractor|prizm|shimmer|art/i.test(bp.variant) || rnd.chance(0.25),
      seed: hashString(id),
    },
  };
}

export const LISTINGS: Listing[] = Array.from({ length: 168 }, (_, i) => makeListing(i));

export const LISTING_BY_ID = new Map(LISTINGS.map((l) => [l.id, l]));

export function getListing(id: string): Listing | undefined {
  return LISTING_BY_ID.get(id);
}

export function discountPct(listing: Listing): number {
  if (listing.fmv <= 0) return 0;
  return Math.round(((listing.fmv - listing.price) / listing.fmv) * 100);
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
  category: facet(LISTINGS.map((l) => l.category)),
  grader: facet(LISTINGS.map((l) => l.grader)),
  grade: facet(LISTINGS.map((l) => String(l.grade))).sort(
    (a, b) => Number(b.value) - Number(a.value),
  ),
  language: facet(LISTINGS.map((l) => l.language)),
  variant: facet(LISTINGS.map((l) => l.variant)),
  pulledFrom: facet(LISTINGS.map((l) => l.pulledFrom)),
  set: facet(LISTINGS.map((l) => l.set)),
  year: facet(LISTINGS.map((l) => String(l.year))).sort(
    (a, b) => Number(b.value) - Number(a.value),
  ),
};

export const PRICE_BOUNDS = {
  min: 0,
  max: Math.ceil(Math.max(...LISTINGS.map((l) => Math.max(l.price, l.fmv))) / 100) * 100,
};

/* ---------------- packs ---------------- */

export const PACKS: Pack[] = [
  {
    slug: "30th-red",
    name: "30th Anniversary: Red",
    price: 19,
    group: "Limited",
    tagline: "Daily anniversary bounties. Every pack is a graded slab.",
    hueA: 352,
    hueB: 18,
    odds: [
      { label: "Under $25", chance: 62 },
      { label: "$25 – $100", chance: 28 },
      { label: "$100 – $1,000", chance: 9 },
      { label: "Grail $1,000+", chance: 1 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "30th-blue",
    name: "30th Anniversary: Blue",
    price: 39,
    group: "Limited",
    tagline: "Bigger floor, same grail odds.",
    hueA: 215,
    hueB: 260,
    odds: [
      { label: "Under $45", chance: 58 },
      { label: "$45 – $200", chance: 31 },
      { label: "$200 – $1,500", chance: 9.5 },
      { label: "Grail $1,500+", chance: 1.5 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "30th-crystal",
    name: "30th Anniversary: Crystal",
    price: 59,
    group: "Limited",
    tagline: "Crystal-tier pulls from the vintage vault.",
    hueA: 185,
    hueB: 205,
    odds: [
      { label: "Under $70", chance: 54 },
      { label: "$70 – $300", chance: 33 },
      { label: "$300 – $2,500", chance: 11 },
      { label: "Grail $2,500+", chance: 2 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "30th-gold",
    name: "30th Anniversary: Gold",
    price: 79,
    group: "Limited",
    tagline: "Gold tier. Heavier hitters, thinner population.",
    hueA: 42,
    hueB: 28,
    odds: [
      { label: "Under $90", chance: 50 },
      { label: "$90 – $400", chance: 35 },
      { label: "$400 – $4,000", chance: 12.5 },
      { label: "Grail $4,000+", chance: 2.5 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "30th-emerald",
    name: "30th Anniversary: Emerald",
    price: 99,
    group: "Limited",
    tagline: "The top of the anniversary ladder.",
    hueA: 142,
    hueB: 165,
    odds: [
      { label: "Under $120", chance: 46 },
      { label: "$120 – $600", chance: 36 },
      { label: "$600 – $6,000", chance: 15 },
      { label: "Grail $6,000+", chance: 3 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "pokemon-starter",
    name: "Pokémon Starter Pack",
    price: 12,
    group: "Pokémon",
    tagline: "The cheapest way into a vaulted slab.",
    hueA: 8,
    hueB: 45,
    odds: [
      { label: "Under $18", chance: 74 },
      { label: "$18 – $60", chance: 22 },
      { label: "$60 – $500", chance: 3.6 },
      { label: "Grail $500+", chance: 0.4 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "pokemon-pro",
    name: "Pokémon Pro Pack",
    price: 149,
    group: "Pokémon",
    tagline: "Modern chase cards and vintage holos only.",
    hueA: 268,
    hueB: 300,
    odds: [
      { label: "Under $175", chance: 44 },
      { label: "$175 – $800", chance: 37 },
      { label: "$800 – $8,000", chance: 15.5 },
      { label: "Grail $8,000+", chance: 3.5 },
    ],
    categories: ["Pokémon"],
  },
  {
    slug: "sports-hits",
    name: "Sports Just the Hits!",
    price: 499,
    group: "Sports",
    tagline: "Spicy. Grails up to $16K+.",
    hueA: 20,
    hueB: 350,
    odds: [
      { label: "Under $550", chance: 41 },
      { label: "$550 – $2,000", chance: 38 },
      { label: "$2,000 – $16,000", chance: 17 },
      { label: "Grail $16,000+", chance: 4 },
    ],
    categories: ["Baseball", "Basketball", "Football", "Soccer", "Hockey"],
  },
  {
    slug: "basketball-starter",
    name: "Basketball Starter Pack",
    price: 24,
    group: "Sports",
    tagline: "Hardwood rookies and vintage stars.",
    hueA: 28,
    hueB: 8,
    odds: [
      { label: "Under $30", chance: 70 },
      { label: "$30 – $120", chance: 24 },
      { label: "$120 – $900", chance: 5.4 },
      { label: "Grail $900+", chance: 0.6 },
    ],
    categories: ["Basketball"],
  },
  {
    slug: "baseball-starter",
    name: "Baseball Starter Pack",
    price: 22,
    group: "Sports",
    tagline: "Diamond legends, graded and vaulted.",
    hueA: 210,
    hueB: 350,
    odds: [
      { label: "Under $28", chance: 71 },
      { label: "$28 – $110", chance: 23 },
      { label: "$110 – $900", chance: 5.5 },
      { label: "Grail $900+", chance: 0.5 },
    ],
    categories: ["Baseball"],
  },
  {
    slug: "one-piece-starter",
    name: "One Piece Starter Pack",
    price: 18,
    group: "One Piece",
    tagline: "Set sail for alternate arts.",
    hueA: 0,
    hueB: 35,
    odds: [
      { label: "Under $24", chance: 69 },
      { label: "$24 – $90", chance: 25 },
      { label: "$90 – $700", chance: 5.5 },
      { label: "Grail $700+", chance: 0.5 },
    ],
    categories: ["One Piece"],
  },
  {
    slug: "wildcard",
    name: "Wildcard Starter Pack",
    price: 29,
    group: "Wildcard",
    tagline: "Anything in the vault. Truly anything.",
    hueA: 300,
    hueB: 190,
    odds: [
      { label: "Under $35", chance: 66 },
      { label: "$35 – $150", chance: 27 },
      { label: "$150 – $1,200", chance: 6.3 },
      { label: "Grail $1,200+", chance: 0.7 },
    ],
    categories: [
      "Pokémon",
      "Baseball",
      "Basketball",
      "Football",
      "Soccer",
      "Hockey",
      "One Piece",
      "Magic: The Gathering",
    ],
  },
];

export const PACK_GROUPS = ["Limited", "Pokémon", "Sports", "One Piece", "Wildcard"];

export function getPack(slug: string): Pack | undefined {
  return PACKS.find((p) => p.slug === slug);
}

/* ---------------- leaderboard ---------------- */

function buildLeaderboard(seed: number, topPoints: number): LeaderboardEntry[] {
  const rnd = makeRandom(seed);
  const handles = rnd.shuffle(HANDLES);
  const entries: LeaderboardEntry[] = [];
  let points = topPoints;
  for (let i = 0; i < 60; i++) {
    const user = handles[i] ?? syntheticHandle(rnd.next);
    entries.push({
      rank: i + 1,
      user,
      points: Math.round(points / 1000) * 1000 + rnd.int(0, 999),
      avatarHueA: hashString(user) % 360,
      avatarHueB: (hashString(user) * 7) % 360,
    });
    points *= rnd.float(0.87, 0.97);
  }
  return entries;
}

export const LEADERBOARD_CURRENT = buildLeaderboard(0xbeef, 1_612_000);
export const LEADERBOARD_PREVIOUS = buildLeaderboard(0xcafe, 2_040_000);

/* ---------------- live "just pulled" feed ---------------- */

export const JUST_PULLED = LISTINGS.slice(0, 24).map((l, i) => ({
  id: `pull-${i}`,
  listingId: l.id,
  user: HANDLES[i % HANDLES.length],
  pack: l.pulledFrom,
  at: NOW_MS - (i + 1) * 31_000,
}));

export const TRENDING = [...LISTINGS]
  .sort((a, b) => discountPct(b) - discountPct(a))
  .slice(0, 18);

export const GRAILS = [...LISTINGS].sort((a, b) => b.fmv - a.fmv).slice(0, 12);

export const RECENT_SALES = LISTINGS.flatMap((l) =>
  l.activity
    .filter((a) => a.kind === "Sale")
    .map((a) => ({ listing: l, event: a })),
)
  .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at))
  .slice(0, 30);

/* ---------------- events ---------------- */

export interface MarketEvent {
  slug: string;
  name: string;
  blurb: string;
  detail: string;
  hueA: number;
  hueB: number;
  packSlug: string;
  endsAt: string;
  rewards: { place: string; prize: string }[];
}

export const EVENTS: MarketEvent[] = [
  {
    slug: "shotime",
    name: "Shotime",
    blurb: "Every Ohtani pull doubles your points for the weekend.",
    detail:
      "Rip any Sports pack while Shotime is live. Pull a Shohei Ohtani slab and the pull is scored at 2x points, on top of the standard pack multiplier.",
    hueA: 210,
    hueB: 350,
    packSlug: "sports-hits",
    endsAt: new Date(NOW_MS + 4 * DAY).toISOString(),
    rewards: [
      { place: "1st", prize: "2018 Ohtani RC PSA 10" },
      { place: "2nd", prize: "$500 vault credit" },
      { place: "3rd", prize: "Sports Just the Hits! pack" },
    ],
  },
  {
    slug: "press-start-emerald",
    name: "Press Start: Emerald",
    blurb: "Top tier of the anniversary ladder. Grails up to $16K.",
    detail:
      "Emerald is the deepest anniversary pool. Every rip enters the monthly leaderboard at a 3x point rate, and the bounty board refreshes daily at 08:00.",
    hueA: 142,
    hueB: 165,
    packSlug: "30th-emerald",
    endsAt: new Date(NOW_MS + 9 * DAY).toISOString(),
    rewards: [
      { place: "1st", prize: "1999 Charizard Holo PSA 9" },
      { place: "2nd", prize: "$1,000 vault credit" },
      { place: "3rd", prize: "Emerald pack x3" },
    ],
  },
  {
    slug: "press-start-gold",
    name: "Press Start: Gold",
    blurb: "Gold tier bounties, refreshed every morning.",
    detail:
      "Gold sits in the middle of the anniversary ladder: heavier hitters than Crystal without the Emerald entry price. Pulls score at 2x points.",
    hueA: 42,
    hueB: 28,
    packSlug: "30th-gold",
    endsAt: new Date(NOW_MS + 9 * DAY).toISOString(),
    rewards: [
      { place: "1st", prize: "2016 Pikachu EX PSA 10" },
      { place: "2nd", prize: "$400 vault credit" },
      { place: "3rd", prize: "Gold pack x3" },
    ],
  },
  {
    slug: "press-start-crystal",
    name: "Press Start: Crystal",
    blurb: "Vintage vault pool. Shadowless and 1st Edition weighted.",
    detail:
      "Crystal weights the pool toward pre-2001 cardboard. Shadowless and 1st Edition pulls are scored at 2.5x points for the duration of the event.",
    hueA: 185,
    hueB: 205,
    packSlug: "30th-crystal",
    endsAt: new Date(NOW_MS + 9 * DAY).toISOString(),
    rewards: [
      { place: "1st", prize: "1999 Base Set Blastoise CGC 9" },
      { place: "2nd", prize: "$250 vault credit" },
      { place: "3rd", prize: "Crystal pack x3" },
    ],
  },
  {
    slug: "modern-age-bounty",
    name: "Modern Age Bounty",
    blurb: "One hidden grail is seeded into the pool each day.",
    detail:
      "A single bounty slab is seeded into the Wildcard pool every day at 08:00. First rip to hit it keeps the slab and the headline points.",
    hueA: 268,
    hueB: 300,
    packSlug: "wildcard",
    endsAt: new Date(NOW_MS + 2 * DAY).toISOString(),
    rewards: [
      { place: "Bounty", prize: "Hidden grail slab" },
      { place: "Runner up", prize: "$150 vault credit" },
      { place: "Daily", prize: "Wildcard pack" },
    ],
  },
];

export function getEvent(slug: string): MarketEvent | undefined {
  return EVENTS.find((e) => e.slug === slug);
}

/** Deterministic pool preview for an event page. */
export function eventPool(slug: string): Listing[] {
  const event = getEvent(slug);
  if (!event) return [];
  const pack = getPack(event.packSlug);
  if (!pack) return LISTINGS.slice(0, 12);
  return LISTINGS.filter((l) => pack.categories.includes(l.category))
    .sort((a, b) => b.fmv - a.fmv)
    .slice(0, 12);
}

/** Weighted pull used by the pack-rip flow. */
export function rollPack(packSlug: string, roll: number, tier: number): Listing {
  const pack = getPack(packSlug);
  const pool = LISTINGS.filter((l) => !pack || pack.categories.includes(l.category));
  const sorted = [...pool].sort((a, b) => a.fmv - b.fmv);
  const bands: [number, number][] = [
    [0, 0.6],
    [0.6, 0.88],
    [0.88, 0.985],
    [0.985, 1],
  ];
  const band = bands[Math.min(tier, bands.length - 1)];
  const lo = Math.floor(band[0] * (sorted.length - 1));
  const hi = Math.floor(band[1] * (sorted.length - 1));
  const span = Math.max(1, hi - lo);
  return sorted[lo + Math.floor(roll * span)] ?? sorted[0];
}

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
