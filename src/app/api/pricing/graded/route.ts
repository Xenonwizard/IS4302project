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
};

const clean = (value: string | null, maxLength: number) => value?.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength) ?? "";
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

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

  const number = cardNumber.split("/")[0].replace(/^#/, "").replace(/^0+/, "") || "0";
  const providerSet = set.replace(/\s*&\s*/g, " ").replace(/\s+/g, " ");
  const url = new URL("https://www.pokemonpricetracker.com/api/v2/cards");
  url.searchParams.set("search", `${subject} ${number}`);
  url.searchParams.set("set", providerSet);
  url.searchParams.set("includeEbay", "true");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      next: { revalidate: 86_400 },
    });
    const payload = await response.json() as TrackerResponse;
    if (!response.ok) {
      return Response.json({ error: payload.error || payload.message || "The free graded-pricing provider could not complete this request." }, { status: response.status });
    }

    const card = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (!card?.name || !card.ebay?.salesByGrade) {
      return Response.json({ error: "No graded sales were found for this card." }, { status: 404 });
    }

    const returnedNumber = (card.cardNumber || "").split("/")[0].replace(/^0+/, "") || "0";
    if (card.cardNumber && returnedNumber !== number) {
      return Response.json({ error: "The provider did not return an exact card-number match." }, { status: 404 });
    }
    const expectedSet = normalizedSet(set);
    const returnedSet = normalizedSet(card.setName || "");
    if (returnedSet && returnedSet !== expectedSet && !returnedSet.endsWith(expectedSet) && !expectedSet.endsWith(returnedSet)) {
      return Response.json({ error: "The provider did not return an exact set match." }, { status: 404 });
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
    }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch {
    return Response.json({ error: "The free graded-pricing provider is temporarily unavailable." }, { status: 502 });
  }
}
