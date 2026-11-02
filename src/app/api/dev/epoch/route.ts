/**
 * Local chain only: which run of the chain this is.
 *
 *   GET /api/dev/epoch  →  { "epoch": "lq3x8k-4f9a2c", "buildHash": "dc49cf67de75e0f2" }
 *
 * It changes every time the chain is reset (POST /api/dev/reset) or restarted (npm run chain). The app
 * compares it with what each browser tab last saw, so slabs, requests and chats saved for a chain that
 * no longer exists are dropped, in every tab, not only the one that pressed Reset.
 * `buildHash` fingerprints the contracts deployed on that chain (null for a chain started before
 * fingerprints existed); the app compares it with the checkout's generated.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IS_LOCAL } from "@/lib/chain/config";

export const dynamic = "force-dynamic";

export function GET() {
  if (!IS_LOCAL) return Response.json({ epoch: null, buildHash: null });
  try {
    const { epoch, snapshotId, buildHash } = JSON.parse(readFileSync(join(process.cwd(), ".data", "chain-snapshot.json"), "utf8")) as {
      epoch?: string;
      snapshotId?: string;
      buildHash?: string;
    };
    return Response.json({ epoch: epoch ?? snapshotId ?? null, buildHash: buildHash ?? null });
  } catch {
    return Response.json({ epoch: null, buildHash: null });
  }
}
