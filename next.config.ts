import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the sidebar CTA in screenshots.
  devIndicators: false,
  images: {
    // Card scans come from the Pokémon TCG API image CDN.
    remotePatterns: [new URL("https://images.pokemontcg.io/**")],
  },
};

export default nextConfig;
