import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

type GradeStats = {
  count?: number;
  medianPrice?: number;
  averagePrice?: number;
  smartMarketPrice?: { price?: number; confidence?: string };
  lastSaleDate?: string;
};

type TrackerCard = {
  tcgPlayerId?: string | number;
  name?: string;
  setName?: string;
  cardNumber?: string;
  ebay?: { salesByGrade?: Record<string, GradeStats> };
};

type TrackerResponse = {
  data?: TrackerCard | TrackerCard[];
  error?: string;
  message?: string;
  resetsAt?: string;
};

/**
 * The free plan allows 100 credits a day and each lookup costs 2, so one answer per card (it
 * carries every grade) is kept on disk for a day. Restarts, reloads and every grade of the same
 * card then cost nothing. A card the provider doesn't know is remembered too.
 */
type Cache = { cards: Record<string, { at: number; card: TrackerCard | null }>; blockedUntil?: number };

const CACHE_FILE = join(process.cwd(), ".data", "pricing-cache.json");
const DAY_MS = 24 * 60 * 60 * 1000;

function loadCache(): Cache {
  try {
    return { cards: {}, ...(JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Partial<Cache>) };
  } catch {
    return { cards: {} };
  }
}

function saveCache(cache: Cache) {
  try {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* a cache that can't be written only costs extra credits */
  }
}

const clean = (value: string | null, maxLength: number) => value?.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength) ?? "";
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

// Slab titles use the short set name; the provider needs its own. Asked for "Base", it returns the
// Base Set 2 Charizard (#4/130) instead of the Base Set one (#4/102).
const PROVIDER_SET: Record<string, string> = { base: "Base Set", baseset: "Base Set" };
const providerSetName = (set: string) => PROVIDER_SET[normalized(set)] ?? set.replace(/\s*&\s*/g, " ").replace(/\s+/g, " ");

function normalizedSet(value: string) {
  let result = normalized(value).replace(/^(?:swsh|sv|sm|xy|bw|dp|ex)\d+[a-z]*/, "");
  if (result === "base") result = "baseset";
  return result;
}

function gradeLabel(key: string) {
  const match = key.match(/^([a-z]+)(\d+)(?:[_.](\d+))?$/i);
  if (!match) return key.toUpperCase();
  const [, grader, whole, decimal] = match;
  return `${grader.toUpperCase()} ${whole}${decimal ? `.${decimal}` : ""}`;
}

const resetTime = (at: number) =>
  new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit" }).format(new Date(at));

export async function GET(request: NextRequest) {
  const token = process.env.POKEMON_PRICE_TRACKER_API_KEY?.trim();
  // An optional key that isn't set is a setup state, not a server error: 200, so the asset page
  // shows the setup hint without a failed request in the console.
  if (!token) {
    return Response.json({
      error: "Add a free PokémonPriceTracker API key to .env.local to load graded-card sale prices.",
      setupRequired: true,
    });
  }

  const subject = clean(request.nextUrl.searchParams.get("subject"), 100);
  const set = clean(request.nextUrl.searchParams.get("set"), 100);
  const cardNumber = clean(request.nextUrl.searchParams.get("cardNumber"), 32);
  const grader = clean(request.nextUrl.searchParams.get("grader"), 8).toLowerCase();
  const grade = Number(request.nextUrl.searchParams.get("grade"));

  if (!subject || !set || !cardNumber || !["psa", "bgs", "cgc", "sgc"].includes(grader) || !Number.isFinite(grade)) {
    return Response.json({ error: "Complete card and slab details are required." }, { status: 400 });
  }

  const [rawNumber, rawTotal] = cardNumber.replace(/^#/, "").split("/");
  const number = rawNumber.replace(/^0+/, "") || "0";
  const total = rawTotal?.replace(/^0+/, "");
  const providerSet = providerSetName(set);
  const cacheKey = normalized(`${subject}|${providerSet}|${number}|${total ?? ""}`);

  const cache = loadCache();
  let entry = cache.cards[cacheKey];
  if (!entry || Date.now() - entry.at > DAY_MS) {
    // Out of credits: don't ask again until the provider's daily reset.
    if (cache.blockedUntil && Date.now() < cache.blockedUntil) {
      return Response.json({ error: `Free daily price lookups are used up. They reset at ${resetTime(cache.blockedUntil)}.`, rateLimited: true });
    }
    const url = new URL("https://www.pokemonpricetracker.com/api/v2/cards");
    url.searchParams.set("search", `${subject} ${number}`);
    url.searchParams.set("set", providerSet);
    url.searchParams.set("includeEbay", "true");
    url.searchParams.set("limit", "1");
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json() as TrackerResponse;
      if (response.status === 429) {
        const resetsAt = Date.parse(payload.resetsAt ?? "") || Date.now() + 60 * 60 * 1000;
        saveCache({ ...cache, blockedUntil: resetsAt });
        return Response.json({ error: `Free daily price lookups are used up. They reset at ${resetTime(resetsAt)}.`, rateLimited: true });
      }
      if (!response.ok) {
        return Response.json({ error: payload.error || payload.message || "The free graded-pricing provider could not complete this request." }, { status: response.status });
      }
      entry = { at: Date.now(), card: (Array.isArray(payload.data) ? payload.data[0] : payload.data) ?? null };
      cache.cards[cacheKey] = entry;
      saveCache(cache);
    } catch {
      return Response.json({ error: "The free graded-pricing provider is temporarily unavailable." }, { status: 502 });
    }
  }

  // No match is a normal answer for an obscure card, not a failed request: 200, so every marketplace
  // card can ask without filling the console with 404s.
  const card = entry.card;
  if (!card?.name || !card.ebay?.salesByGrade) {
    return Response.json({ error: "No graded sales were found for this card." });
  }

  const [returnedRaw, returnedRawTotal] = (card.cardNumber || "").split("/");
  const returnedNumber = returnedRaw.replace(/^0+/, "") || "0";
  const returnedTotal = returnedRawTotal?.replace(/^0+/, "");
  if ((card.cardNumber && returnedNumber !== number) || (total && returnedTotal && returnedTotal !== total)) {
    return Response.json({ error: "The provider did not return an exact card-number match." });
  }
  const expectedSet = normalizedSet(providerSet);
  const returnedSet = normalizedSet(card.setName || "");
  if (returnedSet && returnedSet !== expectedSet && !returnedSet.endsWith(expectedSet) && !expectedSet.endsWith(returnedSet)) {
    return Response.json({ error: "The provider did not return an exact set match." });
  }

  const requestedGradeKey = normalized(`${grader}${String(grade).replace(".", "_")}`);
  const prices = Object.entries(card.ebay.salesByGrade).flatMap(([key, stats]) => {
    const value = stats.smartMarketPrice?.price ?? stats.medianPrice ?? stats.averagePrice;
    return typeof value === "number" && value > 0
      ? [{
          label: gradeLabel(key),
          value,
          medianPrice: stats.medianPrice,
          averagePrice: stats.averagePrice,
          confidence: stats.smartMarketPrice?.confidence,
          count: stats.count ?? 0,
          lastSaleDate: stats.lastSaleDate,
          matchesSlab: normalized(key) === requestedGradeKey,
        }]
      : [];
  }).sort((left, right) => Number(right.matchesSlab) - Number(left.matchesSlab) || right.count - left.count);

  return Response.json({
    data: {
      productId: card.tcgPlayerId ? String(card.tcgPlayerId) : "",
      productName: card.name,
      category: card.setName || set,
      sourceUrl: "https://www.pokemonpricetracker.com/",
      prices,
    },
  });
}
