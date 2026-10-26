export type Grader = "PSA" | "CGC" | "BGS" | "SGC";

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
  isListed?: boolean;
  /** Seller opted this listing into slab-secured loan offers. */
  acceptsLoan?: boolean;
  /** Minimum principal the seller will consider, in PokeCredits. */
  loanAsk?: number;
  chain: "Polygon";
  note: string;
  /** hi-res card scan and a small one for thumbnails */
  image: string;
  thumb: string;
  holo: boolean;
  /** accent hue taken from the Pokémon's energy type */
  hue: number;
}

/** The slab's ERC-721 in SlabVault, once it has been tokenised on-chain. */
export interface SlabToken {
  chainId: number;
  contract: string;
  tokenId: string;
  owner: string;
  mintTx: string;
  /** Collector Crypt's Solana NFT (asset id) for the slab, held by Pokechain's escrow */
  custodianRef: string;
  evidenceHash?: string;
}

/** A slab that has left the vault. The token stays; SlabVault holds the live custody state. */
export interface Withdrawal {
  requestedAt: string;
  requestTx: string;
  /** keccak256 of the shipping address, as sent on-chain */
  shippingHash: string;
  /** the address itself, kept only in this browser */
  shipTo: string;
  /** Collector Crypt's redemption id */
  redemptionRef?: string;
  carrier?: string;
  trackingNumber?: string;
  shipTx?: string;
}

export interface VaultItem {
  listingId: string;
  acquiredAt: string;
  via: "Purchase" | "Trade" | "Submission" | "Transfer";
  /** A received NFT is visible immediately, but remains locked until Collector Crypt vaults it. */
  status: "Awaiting vaulting" | "Vaulted" | "Shipping requested" | "Listed" | "Withdrawn";
  listedPrice?: number;
  token?: SlabToken;
  withdrawal?: Withdrawal;
}

/* ---------------- negotiations ---------------- */

/** What a buyer puts up: full cash, or slabs from their vault plus a cash top-up. */
export interface TradeBid {
  cash: number;
  slabIds: string[];
}

export type OfferStatus = "pending" | "accepted" | "declined" | "withdrawn" | "replaced";

/** A slab in an on-chain trade, with an optional seller asking price for reference. */
export interface ChatTradeSlab {
  tokenId: string;
  /** Seller asking price at offer creation, for reference only. */
  stated: number | null;
  title: string;
  image: string;
  grader: string;
  certNumber: string;
}

export interface ChatTradeSide {
  slabs: ChatTradeSlab[];
  cash: number;
}

/**
 * A multi-slab trade offer sitting in the chat. The terms are locked in TradeEscrow on-chain (the chain
 * is the source of truth for whether it is open, accepted or withdrawn); this keeps what the chat needs
 * to show it, and the asking prices shown when the offer was sent. Written from the sender's chair.
 */
export interface ChatTrade {
  offerId: string;
  /** the sender's and the receiver's wallets */
  maker: string;
  taker: string;
  give: ChatTradeSide;
  get: ChatTradeSide;
  /** the earlier offer this one answers */
  counterOf?: string;
}

/** A funded slab-secured loan offer shown in the conversation. Live status comes from LoanEscrow. */
export interface ChatLoan {
  offerId: string;
  lender: string;
  borrower: string;
  tokenId: string;
  principal: number;
  interest: number;
  duration: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  at: string;
  kind: "text" | "offer" | "trade" | "loan" | "system";
  text?: string;
  offer?: TradeBid;
  /** trade offers only */
  trade?: ChatTrade;
  /** funded loan offers only */
  loan?: ChatLoan;
  /** offers only */
  status?: OfferStatus;
  /** system messages: who caused it, so the other side can react */
  by?: string;
}

/** A one-to-one chat between a buyer and the seller about one listing, like Carousell. */
export interface Negotiation {
  id: string;
  listingId: string;
  seller: string;
  buyer: string;
  status: "open" | "sold" | "closed";
  createdAt: string;
  messages: ChatMessage[];
}

/** One line in the wallet history. The balance is the sum of these. */
export interface LedgerEntry {
  id: string;
  at: string;
  /** signed: positive adds to the wallet */
  amount: number;
  label: string;
  listingId?: string;
}

export type LostItem = "slab-sent" | "slab-received" | "payment";

export interface LostReport {
  id: string;
  negotiationId: string;
  item: LostItem;
  tracking: string;
  details: string;
  filedAt: string;
  status: "Under investigation" | "Resolved";
}
