"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { usePublicClient } from "wagmi";
import { SUBMISSION_STATUS, contracts } from "@/lib/chain/config";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";

type Step = "receive" | "forward" | "vault";

const STEP_COPY: Record<Step, { title: string; expectedStatus: number; path: string; body: string }> = {
  receive: { title: "Received at Pokechain", expectedStatus: 1, path: "/api/chain/receive", body: "" },
  forward: { title: "Forwarded to Collector Crypt", expectedStatus: 2, path: "/api/chain/forward", body: "" },
  vault: { title: "Vaulted at Collector Crypt", expectedStatus: 3, path: "/api/chain/vault", body: "" },
};

/** Deliberately minimal lifecycle simulator. Customer screens only display the resulting custody state. */
export function IntakeSimulator() {
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const { pushToast, user, slabs, vault, vaultLosses, completeLossInvestigation } = useStore();
  const { submit } = useSlabChain();
  const [certNumber, setCertNumber] = useState("");
  const [busy, setBusy] = useState<Step | null>(null);
  const [copied, setCopied] = useState<Step | null>(null);
  const valid = /^\d{1,10}$/.test(certNumber);
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;

  const { data: submission, error, refetch } = useQuery({
    queryKey: ["intake-submission", certNumber],
    enabled: Boolean(client && valid),
    retry: false,
    // Live: a step run with curl from a terminal, or a request made on /submit, shows up here by itself.
    refetchInterval: 1_500,
    queryFn: async () => client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [BigInt(certNumber)] }),
  });

  const curlFor = (step: Step) => {
    const item = STEP_COPY[step];
    return `curl -X POST ${origin}${item.path} -H 'content-type: application/json' -d '{"submissionId":"${certNumber}"}'`;
  };

  const copy = async (step: Step) => {
    await navigator.clipboard?.writeText(curlFor(step));
    setCopied(step);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const run = async (step: Step) => {
    setBusy(step);
    try {
      let createdRequest = false;
      // A new cert has no stage yet. In the demo, the first action creates its evidence-backed
      // request with the connected collector, then immediately records Pokechain's receipt.
      // The NFT is still minted only by the receipt operation.
      if (step === "receive" && !activeSubmission) {
        if (!user?.address) throw new Error("Connect an active Pokechain account before receiving a card.");
        const evidenceResponse = await fetch("/api/evidence/demo-intake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ certNumber, submittedBy: user.username }),
        });
        const evidence = (await evidenceResponse.json()) as { evidenceHash?: `0x${string}`; error?: string };
        if (!evidenceResponse.ok || !evidence.evidenceHash) throw new Error(evidence.error ?? "Could not prepare intake evidence");
        await submit({
          grader: "PSA",
          certNumber,
          evidenceHash: evidence.evidenceHash,
          inboundCarrier: "",
          inboundTracking: "",
        });
        createdRequest = true;
      }
      const res = await fetch(STEP_COPY[step].path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: certNumber }),
      });
      const body = (await res.json()) as { error?: string; tokenId?: string; result?: string };
      if (!res.ok) throw new Error(body.error ?? "The status change failed");
      const toast = step === "receive"
        ? { title: "Received at Pokechain", body: `${createdRequest ? "Intake request created; " : ""}NFT #${body.tokenId} minted and awaiting vaulting.` }
        : step === "forward"
          ? { title: "Forwarded to Collector Crypt", body: "The NFT remains locked while the physical slab is in transit." }
          : { title: "Successfully listed", body: "The slab is now available in the owner’s vault." };
      pushToast({ ...toast, tone: "success" });
      await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["owned-slabs"] }), queryClient.invalidateQueries({ queryKey: ["pending-submissions"] })]);
    } catch (err) {
      pushToast({ title: `${STEP_COPY[step].title} failed`, body: (err as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const activeSubmission = submission && submission.status !== 0 ? submission : null;
  const lossTokenId = activeSubmission?.tokenId ? String(activeSubmission.tokenId) : null;
  const lossListing = lossTokenId ? slabs.find((slab) => slab.tokenId === lossTokenId) : undefined;
  const lossVaultItem = lossTokenId ? vault.find((item) => item.token?.tokenId === lossTokenId) : undefined;
  const reportedLossId = lossTokenId
    ? Object.keys(vaultLosses).find((id) => id === lossTokenId || id === `token-${lossTokenId}` || id === lossListing?.id || id === lossVaultItem?.listingId)
    : undefined;
  const simulateInvestigation = () => {
    if (!reportedLossId) {
      pushToast({ title: "Report required", body: "Submit a vaulting-delay report from your Vault before running the investigation simulation.", tone: "error" });
      return;
    }
    completeLossInvestigation(reportedLossId);
  };
  const unknown = !activeSubmission;
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[26px] font-bold">Card processing simulator</h1>
      <p className="mt-2 text-[14px] text-muted">Enter the PSA cert number. It is the submission request ID for every operation below.</p>

      <label className="mt-7 block text-[13px] font-bold">
        PSA cert number
        <input
          className={`${inputClass} mt-2`}
          value={certNumber}
          onChange={(event) => setCertNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="4324324"
          inputMode="numeric"
          autoFocus
        />
      </label>

      {valid ? (
        <div className="mt-3 text-[13px] text-muted">
          {error ? "Could not read this cert's intake status." : unknown ? "New cert: start with Received at Pokechain." : `Current status: ${SUBMISSION_STATUS[activeSubmission.status]}${activeSubmission.tokenId ? ` · NFT #${activeSubmission.tokenId}` : " · NFT not minted"}`}
        </div>
      ) : certNumber ? <p className="mt-3 text-[13px] text-bad">Enter a numeric PSA cert number.</p> : null}

      <div className="mt-7 space-y-4">
        {(Object.keys(STEP_COPY) as Step[]).map((step, index) => {
          const item = STEP_COPY[step];
          // Received works for a cert the collector already submitted (Pending), or a brand-new one.
          const allowed = step === "receive"
            ? valid && !error && (!activeSubmission || activeSubmission.status === item.expectedStatus)
            : activeSubmission?.status === item.expectedStatus;
          return (
            <section key={step} className="rounded-card border border-hairline bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[15px] font-bold">{index + 1}. {item.title}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    {step === "receive" ? "Mint the NFT once and lock it as awaiting vaulting." : step === "forward" ? "Keep the same NFT and record its transfer to Collector Crypt." : "Vault, verify and unlock the same NFT for normal vault use."}
                  </p>
                  {activeSubmission ? (
                    <p className={`mt-2 text-[11px] font-bold ${allowed ? "text-good" : "text-dim"}`}>
                      {allowed
                        ? "Ready for this card’s current stage"
                        : activeSubmission.status > item.expectedStatus && activeSubmission.status !== 5
                          ? "Done"
                          : `Available after ${SUBMISSION_STATUS[item.expectedStatus - 1]}`}
                    </p>
                  ) : step === "receive" && valid && !error ? <p className="mt-2 text-[11px] font-bold text-good">Ready to start this card’s intake</p> : null}
                </div>
                <Button size="sm" variant={allowed ? "primary" : "secondary"} disabled={!allowed || busy !== null} onClick={() => void run(step)}>
                  {busy === step ? <><Loader2 size={13} className="animate-spin" /> Working…</> : item.title}
                </Button>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-black/25 p-3">
                <code className="min-w-0 flex-1 break-all text-[11px] text-dim">{curlFor(step)}</code>
                <button onClick={() => void copy(step)} className="shrink-0 text-muted hover:text-white" title="Copy curl command">
                  {copied === step ? <Check size={15} className="text-good" /> : <Copy size={15} />}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {activeSubmission && reportedLossId ? (
        <section className="mt-6 rounded-card border border-warn/25 bg-warn/5 p-4">
          <p className="text-[15px] font-bold">Investigation simulator</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">A vaulting-delay report has been submitted. Simulate the vault team completing its investigation.</p>
          <Button className="mt-3" variant="secondary" onClick={simulateInvestigation}>Simulate investigation</Button>
        </section>
      ) : null}

    </div>
  );
}
