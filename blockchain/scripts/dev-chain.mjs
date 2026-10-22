/**
 * `npm run chain`: one command for a fresh local blockchain with Pokechain on it.
 *   1. starts `hardhat node` (chain id 31337, 20 funded test accounts, http://127.0.0.1:8545)
 *   2. waits for it to answer, then deploys with Ignition and exports ABIs + addresses
 *   3. clears the mock Collector Crypt records, which belong to the old chain
 *   4. keeps the node running in the foreground (Ctrl+C stops it)
 * The node keeps state in memory only, so every run starts from block 0 with the same addresses.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";

async function alive() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (await alive()) {
  console.error("Something is already listening on 8545. Stop it first (or run `npm run deploy:local` to redeploy onto it).");
  process.exit(1);
}

const node = spawn("npx", ["hardhat", "node"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
node.stdout.on("data", (d) => process.stdout.write(d));
process.on("SIGINT", () => node.kill("SIGINT"));
node.on("exit", (code) => process.exit(code ?? 0));

for (let i = 0; i < 60 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));

// A fresh node has none of the old deployment, so Ignition's journal for it is stale, and so are
// the mock Collector Crypt records (they point at NFTs and submissions from the old chain).
rmSync(join(root, "ignition", "deployments", "chain-31337"), { recursive: true, force: true });
rmSync(join(root, "..", ".data", "collector-crypt.json"), { force: true });
const deploy = spawnSync("npm", ["run", "deploy:local"], { cwd: root, stdio: "inherit" });
if (deploy.status !== 0) console.error("Deploy failed; the node is still running.");
else console.log("\nPokechain is deployed on the local chain. Leave this running and start the app with `npm run dev`.\n");
