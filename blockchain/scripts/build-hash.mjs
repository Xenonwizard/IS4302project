/**
 * A fingerprint of what the Pokechain contracts are built from: the Solidity sources, the Ignition
 * module and the local deploy parameters. export-frontend.mjs writes it into generated.ts (so it is
 * committed with each branch) and dev-chain.mjs saves it next to the chain's snapshot (what is
 * deployed right now); the app warns when the two differ.
 * Paths are relative and line endings normalised, so every checkout of the same commit agrees.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD_SOURCES = [join(root, "contracts"), join(root, "ignition", "modules"), join(root, "ignition", "parameters", "local.json")];

export function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
}

export function hashFiles(paths) {
  const hash = createHash("sha256");
  for (const file of paths.flatMap(filesUnder)) {
    hash.update(relative(root, file).replaceAll("\\", "/")).update("\0");
    hash.update(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export const buildHash = () => hashFiles(BUILD_SOURCES);
