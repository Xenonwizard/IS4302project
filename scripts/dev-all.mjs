import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

const chainPrefix = `${colors.cyan}${colors.bold}[chain]${colors.reset}`;
const frontendPrefix = `${colors.magenta}${colors.bold}[frontend]${colors.reset}`;

function pipeOutput(stream, prefix, isError = false) {
  if (!stream) return;
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    if (isError) {
      console.error(`${prefix} ${line}`);
    } else {
      console.log(`${prefix} ${line}`);
    }
  });
}

const chainScript = join(root, "blockchain", "scripts", "dev-chain.mjs");
const nextLocalBin = join(root, "node_modules", "next", "dist", "bin", "next");

console.log(`${colors.dim}[dev:all] Starting local chain and frontend...${colors.reset}\n`);

const chainProc = spawn(process.execPath, [chainScript], {
  cwd: root,
  env: { ...process.env, FORCE_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

pipeOutput(chainProc.stdout, chainPrefix);
pipeOutput(chainProc.stderr, chainPrefix, true);

const appArgs = existsSync(nextLocalBin)
  ? [nextLocalBin, "dev", ...process.argv.slice(2)]
  : ["next", "dev", ...process.argv.slice(2)];

const appProc = existsSync(nextLocalBin)
  ? spawn(process.execPath, appArgs, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
  : spawn("npx", appArgs, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

pipeOutput(appProc.stdout, frontendPrefix);
pipeOutput(appProc.stderr, frontendPrefix, true);

let shuttingDown = false;
let remaining = 2;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${colors.dim}[dev:all] Stopping chain and frontend...${colors.reset}`);

  try {
    if (!chainProc.killed) chainProc.kill("SIGINT");
  } catch {}

  try {
    if (!appProc.killed) appProc.kill("SIGINT");
  } catch {}

  const forceKillTimeout = setTimeout(() => {
    try {
      if (!chainProc.killed) chainProc.kill("SIGKILL");
    } catch {}
    try {
      if (!appProc.killed) appProc.kill("SIGKILL");
    } catch {}
    process.exit(exitCode);
  }, 3000);
  forceKillTimeout.unref();
}

function onChildExit(name, code) {
  remaining--;
  if (!shuttingDown) {
    console.log(`${colors.dim}[dev:all] ${name} exited with code ${code ?? 0}${colors.reset}`);
    shutdown(code ?? 0);
  } else if (remaining <= 0) {
    process.exit(code ?? 0);
  }
}

chainProc.on("exit", (code) => onChildExit("chain", code));
appProc.on("exit", (code) => onChildExit("frontend", code));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

