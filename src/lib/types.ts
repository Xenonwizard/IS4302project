export type Grader = "PSA" | "CGC" | "BGS" | "SGC";

export type Confidence = "High" | "Medium" | "Low";

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
  year: number;
  set: string;
  /** era of the set, e.g. "Base", "Sword & Shield" */
  series: string;
  cardNumber: string;
  subject: string;
  grader: Grader;
  grade: number;
  gradeLabel: string;
  language: "English";
  /** printed rarity, e.g. "Rare Holo" */
  variant: string;
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
  /** hi-res card scan and a small one for thumbnails */
  image: string;
  thumb: string;
  holo: boolean;
  /** accent hue taken from the Pokémon's energy type */
  hue: number;
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
  via: "Purchase" | "Trade";
  status: "Vaulted" | "Shipping requested" | "Listed";
  listedPrice?: number;
}

/* ---------------- live trade rooms ---------------- */

export interface TradeBid {
  cash: number;
  /** slabs from the bidder's vault put into the bid */
  slabIds: string[];
}

export interface TradeMessage {
  id: string;
  from: string;
  at: string;
  kind: "text" | "bid" | "system";
  text?: string;
  bid?: TradeBid;
  /** set once the owner has accepted this bid */
  accepted?: boolean;
}

export type LostItem = "slab-sent" | "slab-received" | "payment";

export interface LostReport {
  id: string;
  roomId: string;
  item: LostItem;
  tracking: string;
  details: string;
  filedAt: string;
  status: "Under investigation" | "Resolved";
}

export interface TradeRoom {
  /** one room per listing, so the id is the listing id */
  id: string;
  listingId: string;
  /** owner at the time the room opened */
  seller: string;
  status: "live" | "settled";
  openedAt: string;
  closesAt: string;
  messages: TradeMessage[];
  settledBidId?: string;
  winner?: string;
}
