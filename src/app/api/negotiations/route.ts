import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Negotiation } from "@/lib/types";

interface Db {
  negotiations: Record<string, Negotiation>;
}

const FILE = join(process.cwd(), ".data", "negotiations.json");

function loadDb(): Db {
  try {
    return { negotiations: {}, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<Db>) };
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
        // Merge messages deduplicated by id
        const messageMap = new Map<string, (typeof incoming.messages)[0]>();
        for (const m of existing.messages || []) {
          messageMap.set(m.id, m);
        }
        for (const m of incoming.messages || []) {
          messageMap.set(m.id, m);
        }
        db.negotiations[incoming.id] = {
          ...existing,
          ...incoming,
          messages: Array.from(messageMap.values()).sort(
            (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0),
          ),
        };
      }
    }

    saveDb(db);
    return Response.json({ success: true, negotiations: db.negotiations });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
