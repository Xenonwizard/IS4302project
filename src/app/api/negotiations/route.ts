import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Negotiation } from "@/lib/types";

interface Db {
  negotiations: Record<string, Negotiation>;
}

const FILE = join(process.cwd(), ".data", "negotiations.json");

function dedupeMessages(messages: Negotiation["messages"]): Negotiation["messages"] {
  const sorted = [...(messages || [])].sort(
    (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0),
  );
  const result: Negotiation["messages"] = [];
  const seenIds = new Set<string>();

  for (const m of sorted) {
    if (seenIds.has(m.id)) continue;
    // Discard identical duplicate sent by same sender within 3 seconds
    const isDup = result.some(
      (r) =>
        r.from === m.from &&
        r.kind === m.kind &&
        r.text === m.text &&
        r.trade?.offerId === m.trade?.offerId &&
        Math.abs((Date.parse(r.at) || 0) - (Date.parse(m.at) || 0)) < 3000,
    );
    if (isDup) continue;
    seenIds.add(m.id);
    result.push(m);
  }
  return result;
}

function loadDb(): Db {
  try {
    const raw = { negotiations: {}, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<Db>) };
    for (const [id, n] of Object.entries(raw.negotiations)) {
      raw.negotiations[id] = {
        ...n,
        messages: dedupeMessages(n.messages),
      };
    }
    return raw;
  } catch {
    return { negotiations: {} };
  }
}

function saveDb(db: Db) {
  try {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch {
    /* ignore write error */
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user = searchParams.get("user")?.toLowerCase();
  const db = loadDb();

  if (!user) {
    return Response.json({ negotiations: db.negotiations });
  }

  const filtered: Record<string, Negotiation> = {};
  for (const [id, n] of Object.entries(db.negotiations)) {
    if (n.buyer?.toLowerCase() === user || n.seller?.toLowerCase() === user) {
      filtered[id] = n;
    }
  }

  return Response.json({ negotiations: filtered });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      negotiation?: Negotiation;
      negotiations?: Record<string, Negotiation>;
    };

    const db = loadDb();
    const toMerge: Negotiation[] = [];

    if (body.negotiation) {
      toMerge.push(body.negotiation);
    }
    if (body.negotiations) {
      toMerge.push(...Object.values(body.negotiations));
    }

    for (const incoming of toMerge) {
      if (!incoming || !incoming.id) continue;
      const existing = db.negotiations[incoming.id];
      if (!existing) {
        db.negotiations[incoming.id] = incoming;
      } else {
        db.negotiations[incoming.id] = {
          ...existing,
          ...incoming,
          messages: dedupeMessages([...(existing.messages || []), ...(incoming.messages || [])]),
        };
      }
    }

    saveDb(db);
    return Response.json({ success: true, negotiations: db.negotiations });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}

