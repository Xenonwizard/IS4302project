/**
 * Pokechain submission service: stores a collector's intake evidence and returns the
 * evidenceHash that goes on-chain in SlabVault.requestSubmission.
 *
 *   POST /api/evidence   multipart/form-data:
 *     meta   JSON: grader, certNumber, condition, shipping, declarations,
 *            submittedBy, source ("new" | "already-vaulted")
 *     front, back, label (required for "new"), extra (optional): image files
 */
import { PHOTO_SLOTS, storeEvidence, type EvidenceInput, type PhotoSlot } from "@/lib/evidence/store";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send multipart/form-data" }, { status: 400 });
  }
  let meta: EvidenceInput;
  try {
    meta = JSON.parse(String(form.get("meta"))) as EvidenceInput;
  } catch {
    return Response.json({ error: "meta must be JSON" }, { status: 400 });
  }
  const files: { slot: PhotoSlot; name: string; type: string; data: Uint8Array }[] = [];
  for (const slot of PHOTO_SLOTS) {
    const f = form.get(slot);
    if (f instanceof File && f.size > 0) {
      files.push({ slot, name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
    }
  }
  const result = storeEvidence(meta, files);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json(result, { status: 201 });
}
