"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PackageCheck, Upload } from "lucide-react";
import { useLostAndFound } from "@/lib/chain/useLostAndFound";
import type { Listing } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Fn } from "../chain/ui";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

/**
 * `onChain`: the slab is Lost on SlabVault, so the claim is filed on LostAndFound and followed in
 * Submissions. Otherwise (a demo report with no token) it stays the simulated recovery flow.
 */
export function FoundSlabModal({ listing, open, onClose, onChain = false }: { listing: Listing; open: boolean; onClose: () => void; onChain?: boolean }) {
  const { reportFoundSlab, requireAuth, pushToast } = useStore();
  const { fileClaim } = useLostAndFound();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState("");
  const [evidence, setEvidence] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");

  const submit = async () => {
    if (!requireAuth()) return;
    if (onChain) {
      setBusy(true);
      try {
        const claimId = await fileClaim({ tokenId: listing.tokenId, details, evidence, files, carrier, tracking });
        pushToast({ title: `Claim #${claimId} filed on-chain`, body: "Ship the slab to Pokechain. Follow the case in Submissions.", tone: "success" });
        onClose();
        router.push("/submissions?tab=found");
      } catch (error) {
        pushToast({ title: "Can't file this claim", body: (error as Error).message, tone: "error" });
      } finally {
        setBusy(false);
      }
      return;
    }
    const claim = reportFoundSlab(listing.id, {
      details,
      evidence,
      evidenceFiles: files,
      inboundCarrier: carrier,
      inboundTracking: tracking,
    });
    if (claim) onClose();
  };

  const valid = details.trim().length >= 10 && evidence.trim().length >= 10 && carrier.trim() && tracking.trim();

  return (
    <Modal open={open} onClose={onClose} title="Found this slab?" width="max-w-lg">
      <div className="space-y-4 p-5">
        <div className="rounded-xl border border-good/25 bg-good/5 p-3 text-[12px] leading-relaxed text-muted">
          <p className="font-bold text-white">{listing.grader} cert #{listing.certNumber}</p>
          <p className="mt-1">Submit evidence, then ship the slab to Pokechain Recovery Desk, 1 Vault Way, Singapore 018956. Pokechain/Collector Crypt will authenticate it before returning it to the latest owner.</p>
        </div>
        <Field label="Where and how did you find it?">
          <textarea className={`${inputClass} h-24 py-2.5`} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Location, date, seller or circumstances…" />
        </Field>
        <Field label="Card Condition Now" hint="Describe the slab label, current condition, tamper marks, and anything that can authenticate the find.">
          <textarea className={`${inputClass} h-24 py-2.5`} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Front/back label details, serial placement, condition…" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-hairline p-3 text-[12px] text-muted hover:border-accent/50 hover:text-white">
          <Upload size={15} />
          {files.length ? `${files.length} evidence file(s) selected` : "Attach evidence photos (file names are stored in this simulation)"}
          <input className="sr-only" type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((file) => file.name))} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Carrier to Pokechain"><input className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="DHL" /></Field>
          <Field label="Tracking number"><input className={inputClass} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Recovery shipment" /></Field>
        </div>
        {onChain ? (
          <p className="text-[11px] leading-relaxed text-dim">
            Calls <Fn>LostAndFound.fileClaim(tokenId, evidenceHash, carrier, tracking)</Fn>. Your evidence is hashed, not uploaded. The bounty is already escrowed in the contract and is paid to you once the slab is back in the owner&apos;s vault or they confirm delivery.
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-dim">Any advertised bounty is locked at submission. It is not paid when you file or when Pokechain verifies the slab—only after the owner confirms receiving the returned slab.</p>
        )}
        <Button className="w-full" disabled={!valid || busy} onClick={() => void submit()}><PackageCheck size={16} /> {busy ? "Filing on-chain…" : "Submit found-slab claim"}</Button>
      </div>
    </Modal>
  );
}
