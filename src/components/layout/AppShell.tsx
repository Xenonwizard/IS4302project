"use client";

import { useState } from "react";
import { ChainConsole } from "../chain/ChainConsole";
import { ChainDownBanner } from "../chain/ChainDownBanner";
import { ChainSessionSync } from "../chain/ChainSessionSync";
import { ChainVaultSync } from "../chain/ChainVaultSync";
import { AuthModal } from "../modals/AuthModal";
import { MobileNav, Sidebar } from "./Sidebar";
import { Toasts } from "./Toasts";
import { PromoBanner, TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

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
      <ChainConsole />
      <Toasts />
    </div>
  );
}
