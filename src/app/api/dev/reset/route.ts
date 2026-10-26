/**
 * Local chain only: roll the whole demo back to "contracts just deployed".
 *
 *   POST /api/dev/reset            back to the seeded demo (accounts, slabs and listings from scripts/seed.mjs)
 *   POST /api/dev/reset?clean=1    back to the empty chain, as the smoke tests want it
 *
 * `npm run chain` takes an EVM snapshot right after deploying. This reverts the Hardhat node to
 * it (evm_revert: every account, deposit, slab and transfer since is gone; contract addresses stay
 * the same), takes a fresh snapshot for next time (a snapshot is used up by reverting to it), and
 * clears the mock Collector Crypt records, stored intake evidence and saved chats, which describe the
 * rolled-back chain.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IS_LOCAL, chain } from "@/lib/chain/config";

const DATA = join(process.cwd(), ".data");
const SNAPSHOT_FILE = join(DATA, "chain-snapshot.json");

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(chain.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export async function POST(request: Request) {
  const clean = new URL(request.url).searchParams.get("clean") === "1";
  if (!IS_LOCAL) return Response.json({ error: "Reset only exists for the local chain" }, { status: 400 });
  let snapshotId: string;
  try {
    ({ snapshotId } = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as { snapshotId: string });
  } catch {
    return Response.json(
      { error: "No snapshot of the fresh chain. Restart it once with npm run chain, which saves one." },
      { status: 409 },
    );
  }
  try {
    const reverted = await rpc<boolean>("evm_revert", [snapshotId]);
    if (!reverted) {
      return Response.json(
        { error: "The chain no longer has that snapshot (was it restarted another way?). Restart it with npm run chain." },
        { status: 409 },
      );
    }
    const next = await rpc<string>("evm_snapshot");
    // A new epoch tells every open tab that its saved copy belongs to the rolled-back chain.
    const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(SNAPSHOT_FILE, JSON.stringify({ snapshotId: next, epoch }));
    rmSync(join(DATA, "collector-crypt.json"), { force: true });
    rmSync(join(DATA, "evidence"), { recursive: true, force: true });
    rmSync(join(DATA, "pokechain-forward-records.json"), { force: true });
    rmSync(join(DATA, "pokechain-redemption-addresses.json"), { force: true });
    // Chats carry trade offers by their on-chain id, and those ids restart with the chain.
    rmSync(join(DATA, "negotiations.json"), { force: true });
    if (!clean) {
      const seed = spawnSync(process.execPath, [join(process.cwd(), "blockchain", "scripts", "seed.mjs")], { encoding: "utf8" });
      if (seed.status !== 0) return Response.json({ error: `Reset worked, but seeding the demo failed: ${seed.stderr || seed.stdout}` }, { status: 500 });
    }
    const block = await rpc<string>("eth_blockNumber");
    return Response.json({ reset: true, seeded: !clean, block: Number(block), snapshotId: next });
  } catch (e) {
    return Response.json({ error: `Can't reach the local chain: ${(e as Error).message}. Start it with npm run chain.` }, { status: 503 });
  }
}
