"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChainConsole } from "../chain/ChainConsole";
import { ChainDownBanner } from "../chain/ChainDownBanner";
import { ChainEpochGuard } from "../chain/ChainEpochGuard";
import { ChainMarketSync } from "../chain/ChainMarketSync";
import { ChainSessionSync } from "../chain/ChainSessionSync";
import { ChainVaultSync } from "../chain/ChainVaultSync";
import { FoundCaseSync } from "../chain/FoundCaseSync";
import { AuthModal } from "../modals/AuthModal";
import { MobileNav, Sidebar } from "./Sidebar";
import { Toasts } from "./Toasts";
import { PromoBanner, TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // The custody simulators are deliberately presentation-only: they should not look like or
  // expose the normal collector product during a demo.
  if (pathname === "/intake" || pathname === "/outtake") {
    return (
      <div className="min-h-screen bg-black">
        <header className="border-b border-white/10 py-3 text-center text-[11px] font-black tracking-[0.28em] text-warn">
          FOR DEMO
        </header>
        <main>{children}</main>
        <ChainConsole presentationOnly />
        <ChainEpochGuard />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <ChainDownBanner />
      <PromoBanner />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <main className="min-w-0 flex-1 border-t border-hairline bg-panel pb-20 lg:rounded-tl-2xl lg:border-l lg:pb-0">
          {children}
        </main>
      </div>
      <MobileNav />
      <AuthModal />
      <ChainSessionSync />
      <ChainVaultSync />
      <ChainMarketSync />
      <FoundCaseSync />
      <ChainConsole />
      <ChainEpochGuard />
      <Toasts />
    </div>
  );
}
