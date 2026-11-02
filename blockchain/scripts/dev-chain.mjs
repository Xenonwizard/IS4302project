/**
 * `npm run chain`: one command for a fresh local blockchain with Pokechain on it.
 *   1. starts `hardhat node` (chain id 31337, 20 funded test accounts, http://127.0.0.1:8545)
 *   2. waits for it to answer, then deploys with Ignition and exports ABIs + addresses
 *   3. clears the mock Collector Crypt records, which belong to the old chain
 *   4. takes an EVM snapshot of the freshly deployed, still empty chain, so the app's "Reset demo data"
 *      can roll back to it (evm_revert) without a restart
 *   4b. seeds the demo accounts, slabs and listings (scripts/seed.mjs); Reset seeds them again, and
 *      the smoke tests reset to the empty chain instead
 *   5. keeps the node running in the foreground (Ctrl+C stops it), and redeploys onto a fresh chain
 *      whenever the contract sources change, e.g. after `git checkout` to a branch with other contracts
 * The node keeps state in memory only, so every run starts from block 0 with the same addresses.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_SOURCES, buildHash, hashFiles } from "./build-hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";
// Hardhat 3 loads TypeScript through tsx. In this Windows environment Node's
// native os.userInfo() call can fail before Hardhat starts, even though the
// username and home directory are available as environment variables. Preload
// a narrowly-scoped fallback for the child Node processes that run Hardhat.
const userInfoShim = join(root, "scripts", "node-user-info-shim.cjs");
const userInfoShimOptionPath = userInfoShim.replaceAll("\\", "/");
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require "${userInfoShimOptionPath}"`.trim();
// Keep this project's compiler cache out of the user-wide Hardhat cache. Another
// Hardhat process can otherwise hold its compiler-download mutex and prevent a
// local chain from deploying. Reuse any already-downloaded compiler binaries.
const originalLocalAppData = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? root, "AppData", "Local");
const projectLocalAppData = join(root, "cache", "hardhat-appdata");
const sharedCompilerCache = join(originalLocalAppData, "hardhat-nodejs", "Cache", "compilers-v3");
const projectCompilerCache = join(projectLocalAppData, "hardhat-nodejs", "Cache", "compilers-v3");
if (!existsSync(projectCompilerCache) && existsSync(sharedCompilerCache)) {
  mkdirSync(dirname(projectCompilerCache), { recursive: true });
  cpSync(sharedCompilerCache, projectCompilerCache, { recursive: true });
}
process.env.LOCALAPPDATA = projectLocalAppData;
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

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", script], { cwd: root, stdio: "inherit", shell });
    child.on("exit", (code) => resolve(code === 0));
  });
}

// What the deployed chain is built from. The app's ABIs and addresses (src/lib/chain/generated.ts)
// are committed per branch, so after `git checkout` the app would call contracts from the other
// branch. Hashing these lets the watcher below notice and redeploy.
const SOURCES = [...BUILD_SOURCES, join(root, "scripts", "seed.mjs")];
const sourcesHash = () => hashFiles(SOURCES);

// Block 0, before anything is deployed: a redeploy reverts here, so the contracts land on the same
// addresses and the same deploy block as on a fresh `npm run chain`.
let genesisSnapshot = await rpc("evm_snapshot");
let deployedHash = null;

async function deployAndSeed() {
  const hash = sourcesHash();
  // A fresh deployment has none of the old one, so Ignition's journal for it is stale, and so are
  // the mock Collector Crypt records, intake evidence and chats (they belong to the old chain).
  rmSync(join(root, "ignition", "deployments", "chain-31337"), { recursive: true, force: true });
  for (const file of ["collector-crypt.json", "negotiations.json", "evidence", "pokechain-forward-records.json", "pokechain-redemption-addresses.json"]) {
    rmSync(join(root, "..", ".data", file), { recursive: true, force: true });
  }
  if (!(await run("deploy:local:contracts"))) {
    console.error("Deploy failed; the node is still running. Fix the contracts and save to try again.");
    return;
  }
  deployedHash = hash;
  // Snapshot before seeding: Reset rolls back to the empty chain, then seeds again (or not, for the tests).
  const snapshotId = await rpc("evm_snapshot");
  mkdirSync(join(root, "..", ".data"), { recursive: true });
  // `epoch` names this run of the chain; open browser tabs drop their saved state when it changes.
  // `buildHash` says which contracts are deployed, so the app can warn when the checkout moved on.
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(join(root, "..", ".data", "chain-snapshot.json"), JSON.stringify({ snapshotId, epoch, buildHash: buildHash() }));
  if (!(await run("seed"))) console.error("Seeding the demo data failed; the contracts are deployed but empty.");
  console.log(`\nPokechain is deployed on the local chain (snapshot ${snapshotId} saved for "Reset demo data").`);
  console.log("Leave this running and start the app with `npm run dev`. Switching branches or editing a contract redeploys it.\n");
}

await deployAndSeed();

// Redeploy whenever the contract sources change (a branch switch, a pull, an edit), so the chain
// never serves contracts that don't match the checked-out ABIs. Events arrive in bursts during a
// checkout, hence the debounce; the hash check skips saves that change nothing.
let timer = null;
let busy = false;
async function redeployIfChanged() {
  if (busy) return void (timer = setTimeout(redeployIfChanged, 500));
  if (sourcesHash() === deployedHash) return;
  busy = true;
  try {
    console.log("\nContract sources changed (branch switch or edit): redeploying Pokechain on a fresh chain...\n");
    await rpc("evm_revert", [genesisSnapshot]);
    // A snapshot is used up by reverting to it.
    genesisSnapshot = await rpc("evm_snapshot");
    await deployAndSeed();
  } catch (e) {
    console.error(`Redeploy failed: ${e.message}`);
  } finally {
    busy = false;
  }
}
for (const path of SOURCES.filter(existsSync)) {
  watch(path, { recursive: statSync(path).isDirectory() }, () => {
    clearTimeout(timer);
    timer = setTimeout(redeployIfChanged, 1500);
  });
}
