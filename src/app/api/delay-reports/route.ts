import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DelayReport } from "@/lib/types";

/**
 * Vaulting-delay reports, shared between the collector who filed one and the vault team working on
 * it in /intake, which may be another browser. Both poll this list, like negotiations.
 */
interface Db {
  reports: Record<string, DelayReport>;
}

const FILE = join(process.cwd(), ".data", "delay-reports.json");

function loadDb(): Db {
  try {
    return { reports: {}, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<Db>) };
  } catch {
    return { reports: {} };
  }
}

function saveDb(db: Db) {
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner")?.toLowerCase();
  const { reports } = loadDb();
  const list = Object.values(reports).filter((r) => !owner || r.owner.toLowerCase() === owner);
  return Response.json({ reports: list });
}

/** `{ report }` files (or refiles) one; `{ id, status, resolution? }` moves it along. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as
      | { report: Omit<DelayReport, "status" | "updatedAt"> }
      | { id: string; status: DelayReport["status"]; resolution?: DelayReport["resolution"] };
    const db = loadDb();
    const now = new Date().toISOString();
    if ("report" in body) {
      const r = body.report;
      if (!r?.id || !r.owner) return Response.json({ error: "A report needs an id and an owner." }, { status: 400 });
      db.reports[r.id] = { ...r, status: "reported", updatedAt: now };
    } else {
      const existing = db.reports[body.id];
      if (!existing) return Response.json({ ok: false }); // nothing was filed from this browser
      db.reports[body.id] = { ...existing, status: body.status, resolution: body.resolution ?? existing.resolution, updatedAt: now };
    }
    saveDb(db);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
