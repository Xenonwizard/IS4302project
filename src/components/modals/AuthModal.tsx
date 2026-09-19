"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

export function AuthModal() {
  const { authOpen, setAuthOpen, login } = useStore();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const handle = username.trim().replace(/\s+/g, "");
    if (handle.length < 3) {
      setError("Pick a handle with at least 3 characters.");
      return;
    }
    setError("");
    login(handle, email.trim() || undefined);
    setUsername("");
    setEmail("");
  };

  return (
    <Modal open={authOpen} onClose={() => setAuthOpen(false)} title={mode === "login" ? "Log in" : `Join ${BRAND.name}`}>
      <div className="p-5">
        <div className="mb-5 flex rounded-xl bg-surface p-1">
          {(["signup", "login"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`h-9 flex-1 rounded-lg text-[13px] font-semibold transition ${
                mode === m ? "bg-surface-3 text-white" : "text-muted hover:text-white"
              }`}
            >
              {m === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Handle">
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="vaultedcharizard"
              autoComplete="off"
            />
          </Field>
          {mode === "signup" ? (
            <Field label="Email" hint="Demo build — nothing is sent anywhere and no password is stored.">
              <input
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="off"
              />
            </Field>
          ) : null}
          {error ? <p className="text-[13px] font-medium text-bad">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg">
            {mode === "signup" ? "Create account" : "Log in"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-dim">
          <span className="h-px flex-1 bg-hairline" />
          or
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => login(`0x${Math.floor(Math.random() * 1e12).toString(16).padStart(6, "0").slice(0, 6)}...wallet`)}
        >
          <Wallet size={17} />
          Continue with a {BRAND.chain} wallet
        </Button>
        <p className="mt-4 text-center text-[12px] leading-relaxed text-dim">
          Slabs are custodied in the {BRAND.vaultCity} vault and mirrored as ERC-721 tokens on{" "}
          {BRAND.chain}. Ship the physical card to yourself at any time.
        </p>
      </div>
    </Modal>
  );
}
