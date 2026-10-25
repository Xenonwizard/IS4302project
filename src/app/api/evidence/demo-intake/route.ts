/**
 * Evidence fixture used only by the presentation simulator. It gives the first lifecycle
 * action a complete, hashable intake manifest without exposing the regular intake flow.
 */
import { storeEvidence, type PhotoSlot } from "@/lib/evidence/store";

const image = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="black"/></svg>',
);
const requiredSlots: PhotoSlot[] = ["front", "back", "label"];

export async function POST(request: Request) {
  try {
    const { certNumber, submittedBy = "demo" } = (await request.json()) as { certNumber?: string; submittedBy?: string };
    if (!certNumber || !/^\d{1,10}$/.test(certNumber)) {
      return Response.json({ error: "Enter a numeric PSA cert number" }, { status: 400 });
    }
    const result = storeEvidence(
      {
        grader: "PSA",
        certNumber,
        condition: { caseCracked: false, caseScratched: false, labelDamaged: false, notes: "Presentation simulator intake" },
        shipping: { method: "dropoff", carrier: "", tracking: "" },
        declarations: { owner: true, authentic: true, terms: true },
        submittedBy,
        source: "new",
      },
      requiredSlots.map((slot) => ({ slot, name: `${slot}.svg`, type: "image/svg+xml", data: image })),
    );
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ evidenceHash: result.evidenceHash });
  } catch {
    return Response.json({ error: "Could not prepare demo intake evidence" }, { status: 400 });
  }
}
