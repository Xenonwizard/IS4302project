/**
 * `npm run chain`: one command for a fresh local blockchain with Pokechain on it.
 *   1. starts `hardhat node` (chain id 31337, 20 funded test accounts, http://127.0.0.1:8545)
 *   2. waits for it to answer, then deploys with Ignition and exports ABIs + addresses
 *   3. clears the mock Collector Crypt records, which belong to the old chain
 *   4. takes an EVM snapshot of the freshly deployed chain, so the app's "Reset demo data" can
 *      roll back to it (evm_revert) without a restart
 *   5. keeps the node running in the foreground (Ctrl+C stops it)
 * The node keeps state in memory only, so every run starts from block 0 with the same addresses.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";
// On Windows, npm and npx are .cmd scripts that only start through a shell.
const shell = process.platform === "win32";

// Hardhat 3 refuses to run on older Node; say so up front instead of failing halfway.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nPokechain's local chain needs Node.js 22.13 or newer (Hardhat 3); this is ${process.versions.node}.`);
  console.error("Install Node 22 LTS or newer (https://nodejs.org or nvm install 22), then run npm run chain again.\n");
  process.exit(1);
}

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

const node = spawn("npx", ["hardhat", "node"], { cwd: root, stdio: ["ignore", "pipe", "inherit"], shell });
node.stdout.on("data", (d) => process.stdout.write(d));
process.on("SIGINT", () => node.kill("SIGINT"));
node.on("exit", (code) => process.exit(code ?? 0));

for (let i = 0; i < 60 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));

// A fresh node has none of the old deployment, so Ignition's journal for it is stale, and so are
// the mock Collector Crypt records and intake evidence (they belong to the old chain).
rmSync(join(root, "ignition", "deployments", "chain-31337"), { recursive: true, force: true });
rmSync(join(root, "..", ".data", "collector-crypt.json"), { force: true });
rmSync(join(root, "..", ".data", "evidence"), { recursive: true, force: true });
const deploy = spawnSync("npm", ["run", "deploy:local"], { cwd: root, stdio: "inherit", shell });
if (deploy.status !== 0) {
  console.error("Deploy failed; the node is still running.");
} else {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_snapshot", params: [] }),
  });
  const { result: snapshotId } = await res.json();
  mkdirSync(join(root, "..", ".data"), { recursive: true });
  writeFileSync(join(root, "..", ".data", "chain-snapshot.json"), JSON.stringify({ snapshotId }));
  console.log(`\nPokechain is deployed on the local chain (snapshot ${snapshotId} saved for "Reset demo data").`);
  console.log("Leave this running and start the app with `npm run dev`.\n");
}
