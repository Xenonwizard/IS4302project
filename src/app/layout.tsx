import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Web3Providers } from "@/components/chain/Web3Providers";
import { AppShell } from "@/components/layout/AppShell";
import { BRAND } from "@/lib/brand";
import { StoreProvider } from "@/lib/store";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — graded card slabs, vaulted and insured`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <head>
        {/* Polyfill crypto.randomUUID for non-secure contexts (e.g. accessing over LAN IP like http://192.168.x.x) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                if (!window.crypto) window.crypto = {};
                if (!window.crypto.randomUUID) {
                  window.crypto.randomUUID = function() {
                    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function(c) {
                      var r = (window.crypto.getRandomValues ? window.crypto.getRandomValues(new Uint8Array(1))[0] : Math.floor(Math.random() * 256));
                      return (c ^ (r & (15 >> (c / 4)))).toString(16);
                    });
                  };
                }
              }
            `,
          }}
        />
      </head>
      <body className="min-h-full">
        <Web3Providers>
          <StoreProvider>
            <AppShell>{children}</AppShell>
          </StoreProvider>
        </Web3Providers>
      </body>
    </html>
  );
}
