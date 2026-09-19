export type Grader = "PSA" | "CGC" | "BGS" | "SGC";

export type Category =
  | "Pokémon"
  | "Baseball"
  | "Basketball"
  | "Football"
  | "Soccer"
  | "Hockey"
  | "One Piece"
  | "Magic: The Gathering";

export type Confidence = "High" | "Medium" | "Low";

export type ArtStyle = "pokemon" | "sports" | "anime" | "mtg";

export interface Sale {
  date: string; // ISO
  price: number;
}

export type ActivityKind =
  | "Mint"
  | "Sale"
  | "Listed"
  | "Offer"
  | "Transfer"
  | "Delisted";

export interface ActivityEvent {
  kind: ActivityKind;
  price?: number;
  from: string;
  to: string;
  at: string; // ISO
  txHash: string;
}

export interface Offer {
  id: string;
  listingId: string;
  amount: number;
  from: string;
  createdAt: string;
  expiresAt: string;
}

export interface Comment {
  id: string;
  user: string;
  text: string;
  at: string;
}

export interface Listing {
  id: string;
  title: string;
  shortName: string;
  category: Category;
  year: number;
  set: string;
  cardNumber: string;
  subject: string;
  grader: Grader;
  grade: number;
  gradeLabel: string;
  language: "English" | "Japanese" | "Korean" | "Chinese";
  variant: string;
  pulledFrom: string;
  price: number;
  fmv: number;
  confidence: Confidence;
  owner: string;
  certNumber: string;
  listedAt: string;
  endsAt: string;
  likes: number;
  offers: Offer[];
  sales: Sale[];
  activity: ActivityEvent[];
  comments: Comment[];
  tokenId: string;
  contract: string;
  ownerAddress: string;
  chain: "Polygon";
  note: string;
  art: {
    style: ArtStyle;
    hueA: number;
    hueB: number;
    holo: boolean;
    seed: number;
  };
}

export interface Pack {
  slug: string;
  name: string;
  price: number;
  group: string;
  tagline: string;
  hueA: number;
  hueB: number;
  odds: { label: string; chance: number }[];
  categories: Category[];
}

export interface LeaderboardEntry {
  rank: number;
  user: string;
  points: number;
  avatarHueA: number;
  avatarHueB: number;
}

export interface CartLine {
  listingId: string;
  addedAt: number;
}

export interface Order {
  id: string;
  createdAt: string;
  listingIds: string[];
  subtotal: number;
  fee: number;
  total: number;
  method: "card" | "usdc";
  txHash: string;
}

export interface VaultItem {
  listingId: string;
  acquiredAt: string;
  via: "Purchase" | "Pack" | "Trade";
  status: "Vaulted" | "Shipping requested" | "Listed";
  listedPrice?: number;
}

export interface Pull {
  id: string;
  listingId: string;
  user: string;
  pack: string;
  at: number;
}
