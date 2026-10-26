"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "./brand";
import { LISTINGS, buildOnChainListing, getListing, makeStarterListings, makeSubmittedListing, registerListing } from "./catalog";
import { IS_DEPLOYED, PENDING_CUSTODY, type CustodyName } from "./chain/config";
import { usd } from "./format";
import {
  botReply,
  bidValue,
  messageId,
  offerMix,
  pendingOffer,
  negotiationId,
  newBuyerChat,
  systemMessage,
  type BotAction,
} from "./negotiation";
import { hashString, hexId } from "./rng";
import { contracts } from "./chain/config";
import type {
  ActivityEvent,
  ChatMessage,
  ChatTrade,
  ChatLoan,
  Grader,
  LedgerEntry,
  Listing,
  LostItem,
  LostReport,
  Negotiation,
  Sale,
  SlabToken,
  TradeBid,
  VaultItem,
  Withdrawal,
} from "./types";

const STORAGE_KEY = "pokechain.state.v3";

/** Demo credit every new wallet starts with. */
const WELCOME_CREDIT = 50000;

/** The demo account, which starts with a few slabs already vaulted. */
const DEMO_USER = "demotester";

export interface SessionUser {
  username: string;
  email: string;
  hue: number;
  joinedAt: string;
  /** set when the account was opened on-chain (AccountRegistry) by this wallet */
  address?: string;
}

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "default" | "success" | "error";
}

/** Mutations layered over the static catalog. */
export interface ListingOverride {
  price?: number;
  acceptsLoan?: boolean;
  loanAsk?: number;
  owner?: string;
  ownerAddress?: string;
  listedAt?: string;
  soldTo?: string;
  delisted?: boolean;
  activity?: ActivityEvent[];
  sales?: Sale[];
}

interface PersistShape {
  user: SessionUser | null;
  /** whose data this is: kept after sign-out so a different user gets their own state */
  owner?: string;
  watchlist: string[];
  vault: VaultItem[];
  /** slabs the user submitted, which are not part of the catalog */
  slabs: Listing[];
  overrides: Record<string, ListingOverride>;
  comments: Record<string, { id: string; user: string; text: string; at: string }[]>;
  negotiations: Record<string, Negotiation>;
  /** wallet history, newest first; the balance is its sum */
  ledger: LedgerEntry[];
  lostReports: LostReport[];
}

const EMPTY: PersistShape = {
  user: null,
  watchlist: [],
  vault: [],
  slabs: [],
  overrides: {},
  comments: {},
  negotiations: {},
  ledger: [],
  lostReports: [],
};

/** A slab token the connected wallet owns, as SlabVault reports it. */
export interface ChainSlab {
  token: SlabToken;
  title?: string;
  image?: string;
  grader: Grader;
  certNumber: string;
  /** SlabVault custody, e.g. "Vaulted", "Shipped" */
  custody: string;
  /** minted to this wallet, or received from another collector */
  via: "Submission" | "Transfer";
  carrier?: string;
  trackingNumber?: string;
  redemptionRef?: string;
  isListed?: boolean;
  listedPrice?: number;
}

/** All in-progress inbound custody states belong in the Awaiting vaulting tab. */
function isAwaitingVaulting(custody: string): boolean {
  return PENDING_CUSTODY.has(custody as CustodyName);
}

export interface SlabSubmission {
  grader: Grader;
  certNumber: string;
}

interface StoreValue extends PersistShape {
  ready: boolean;
  /** wallet balance, derived from the ledger */
  balance: number;
  /* auth */
  /** `address` marks a wallet account opened on-chain: no demo credit, funds come from USDC deposits */
  login: (username: string, email?: string, address?: string) => void;
  logout: () => void;
  requireAuth: (then?: () => void) => boolean;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  /* watchlist */
  toggleWatch: (id: string) => void;
  isWatched: (id: string) => boolean;
  /* slabs */
  submitSlab: (input: SlabSubmission, token?: SlabToken) => Listing | null;
  listFromVault: (id: string, price: number, acceptsLoan?: boolean, loanAsk?: number) => void;
  delist: (id: string) => void;
  buyNow: (listingId: string, txHash?: string) => boolean;
  requestShipping: (id: string) => void;
  /* blockchain: account and slab onboarding / offboarding */
  /** syncs connected on-chain USDC balance */
  syncChainBalance: (balance: number) => void;
  /** mirrors an on-chain USDC deposit (+) or withdrawal (−) into the wallet history */
  recordChainCash: (amount: number, label: string, txHash: string) => void;
  /** a slab already in the vault has been minted on-chain */
  attachToken: (listingId: string, token: SlabToken) => void;
  /**
   * For tokenised slabs the chain is the source of truth: adds tokens this wallet received
   * (e.g. a transfer from another collector) and drops tokens it no longer owns.
   */
  syncChainSlabs: (owned: ChainSlab[], ownedByOthers: string[]) => void;
  syncMarketListings: (listings: { listing: Listing; price: number; seller: string }[]) => void;
  /** the transfer to another collector confirmed: the slab leaves this vault and its chats close */
  handOver: (listingId: string, toHandle: string, txHash?: string) => void;
  /** the slab has left the vault: unlisted, its chats closed, moved to the Withdrawn tab */
  withdrawSlab: (listingId: string, withdrawal: Withdrawal) => void;
  updateWithdrawal: (listingId: string, patch: Partial<Withdrawal>) => void;
  /** the account was closed on-chain: sign out, keep the record */
  offboard: () => void;
  /* negotiations */
  /** sends an offer in the buyer's chat with the seller; returns the chat id */
  makeOffer: (listingId: string, bid: TradeBid, availableFunds?: number) => string | null;
  sendMessage: (negotiationId: string, text: string) => void;
  /**
   * Opens (or reopens) my chat with the owner of `anchor`, with no offer yet. The slab only anchors the
   * chat; a trade in it can ask for any of their slabs. Returns the chat id.
   */
  openChat: (anchor: Listing) => string | null;
  /** puts an on-chain trade offer into the chat as a message from me */
  postTrade: (negotiationId: string, trade: ChatTrade) => void;
  /** puts an on-chain loan offer into the chat as a message from me */
  postLoan: (negotiationId: string, loan: ChatLoan) => void;
  /** a short note in the chat saying what just happened (accepted, withdrawn…) */
  chatNote: (negotiationId: string, text: string) => void;
  /** seller side: accept or decline the buyer's pending offer */
  respondToOffer: (negotiationId: string, offerId: string, accept: boolean, txHash?: string) => void;
  /** buyer side: take back a pending offer */
  withdrawOffer: (negotiationId: string, offerId: string) => void;
  fileLostReport: (negotiationId: string, item: LostItem, tracking: string, details: string) => LostReport;
  addComment: (listingId: string, text: string) => void;
  topUp: (amount: number) => void;
  resetDemo: () => void;
  /* derived */
  resolve: (listing: Listing) => Listing;
  isOwned: (id: string) => boolean;
  /** listed on the marketplace, so buyers can make offers */
  isListed: (id: string) => boolean;
  /* toasts */
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const cents = (n: number) => Math.round(n * 100) / 100;

/** Seller fee on the cash part of a sale. Slabs in a trade are not charged. */
export function sellerFee(cash: number): number {
  return cents(cash * BRAND.sellerFee);
}

export function ledgerBalance(ledger: LedgerEntry[]): number {
  return cents(ledger.reduce((sum, e) => sum + e.amount, 0));
}

let ledgerSeq = 0;
function ledgerEntry(amount: number, label: string, listingId?: string): LedgerEntry {
  ledgerSeq += 1;
  return {
    id: `L${Date.now().toString(36)}${ledgerSeq}`,
    at: new Date().toISOString(),
    amount: cents(amount),
    label,
    listingId,
  };
}

/**
 * Closes every open chat where the signed-in user is selling this slab (pending offers are
 * declined), for when the slab can no longer be sold by them: withdrawn or handed to someone else.
 */
function closeSellerChats(prev: PersistShape, listingId: string, note: string): Record<string, Negotiation> {
  const me = prev.user?.username;
  const negotiations = { ...prev.negotiations };
  for (const n of Object.values(prev.negotiations)) {
    if (n.listingId !== listingId || n.seller !== me || n.status !== "open") continue;
    negotiations[n.id] = {
      ...n,
      status: "closed",
      messages: [
        ...n.messages.map((m) => (m.kind === "offer" && m.status === "pending" ? { ...m, status: "declined" as const } : m)),
        systemMessage(note),
      ],
    };
  }
  return negotiations;
}

/**
 * A tokenised slab's listing takes its facts from the chain: token id, contract, owner wallet and
 * mint tx. Its value stays the catalogue's market estimate.
 */
function withToken(listing: Listing, token: SlabToken): Listing {
  return {
    ...listing,
    tokenId: token.tokenId,
    contract: token.contract,
    ownerAddress: token.owner,
    activity: token.mintTx
      ? listing.activity.map((a) => (a.kind === "Mint" ? { ...a, txHash: token.mintTx } : a))
      : listing.activity,
  };
}

/** The listing as it stands in this state: price and owner after any changes. */
function current(prev: PersistShape, id: string): Listing | undefined {
  const base =
    getListing(id) ||
    prev.slabs.find(
      (s) => s.id === id || s.tokenId === id || (s.tokenId && `token-${s.tokenId}` === id),
    );
  if (!base) return undefined;
  const o = prev.overrides[base.id] || prev.overrides[id];
  return o ? { ...base, price: o.price ?? base.price, owner: o.owner ?? base.owner } : base;
}

/**
 * Settles an accepted offer: the slab goes to the buyer, the cash and any offered
 * slabs to the seller, and every other chat about the slab closes. Works whichever
 * side the signed-in user is on. Returns an error instead when the deal cannot go through.
 */
function settleDeal(
  prev: PersistShape,
  negId: string,
  offerId: string,
  availableFunds?: number,
  txHash?: string,
): { next: PersistShape; error?: string } {
  const me = prev.user?.username;
  const n = prev.negotiations[negId];
  const offerMsg = n?.messages.find((m) => m.id === offerId);
  const listing = n ? current(prev, n.listingId) : undefined;
  if (!me || !n || !listing || n.status !== "open" || !offerMsg?.offer || offerMsg.status !== "pending") {
    return { next: prev, error: "This offer is no longer open." };
  }
  const { cash, slabIds } = offerMsg.offer;
  const now = new Date().toISOString();
  let vault = prev.vault;
  let ledger = prev.ledger;

  const sellerVaultItem = prev.vault.find(
    (v) =>
      v.listingId === listing.id ||
      v.listingId === n.listingId ||
      (listing.tokenId && (v.token?.tokenId === listing.tokenId || v.listingId === `token-${listing.tokenId}`)),
  );
  const token: SlabToken | undefined =
    sellerVaultItem?.token ||
    (listing.tokenId
      ? {
          chainId: 31337,
          contract: listing.contract || contracts.slabVault.address,
          tokenId: listing.tokenId,
          owner: n.buyer,
          mintTx: txHash || "",
          custodianRef: "",
        }
      : undefined);

  if (n.buyer === me) {
    const effectiveFunds = prev.user?.address
      ? Math.max(availableFunds ?? 0, ledgerBalance(prev.ledger))
      : ledgerBalance(prev.ledger);
    if (cash > effectiveFunds && !txHash) {
      return { next: prev, error: `Your wallet cannot cover the ${usd(cash, { cents: true })} cash.` };
    }
    const vaulted = (id: string) => prev.vault.some((v) => v.listingId === id && v.status === "Vaulted");
    if (!slabIds.every(vaulted) && !txHash) {
      return { next: prev, error: "A slab in this offer is no longer in your vault." };
    }
    vault = vault.filter((v) => !slabIds.includes(v.listingId));
    vault = [
      {
        listingId: listing.id,
        acquiredAt: now,
        via: slabIds.length ? "Trade" : "Purchase",
        status: "Vaulted",
        token,
      },
      ...vault,
    ];
    if (cash > 0 && !prev.user?.address) {
      ledger = [
        ledgerEntry(-cash, `Bought ${listing.shortName}${slabIds.length ? " (cash part of trade)" : ""}`, listing.id),
        ...ledger,
      ];
    }
  } else if (n.seller === me) {
    const ownsSlab =
      Boolean(txHash) ||
      Boolean(listing.tokenId) ||
      prev.vault.some(
        (v) =>
          v.listingId === listing.id ||
          v.listingId === n.listingId ||
          (listing.tokenId && (v.token?.tokenId === listing.tokenId || v.listingId === `token-${listing.tokenId}`)),
      );
    if (!ownsSlab) {
      return { next: prev, error: "You no longer own this slab." };
    }
    vault = vault.filter(
      (v) =>
        v.listingId !== listing.id &&
        v.listingId !== n.listingId &&
        (!listing.tokenId || (v.token?.tokenId !== listing.tokenId && v.listingId !== `token-${listing.tokenId}`)),
    );
    vault = [
      ...slabIds.map<VaultItem>((id) => ({ listingId: id, acquiredAt: now, via: "Trade", status: "Vaulted" })),
      ...vault,
    ];
    if (cash > 0 && !prev.user?.address) {
      ledger = [
        ledgerEntry(-sellerFee(cash), `Seller fee (${BRAND.sellerFee * 100}%) on ${listing.shortName}`, listing.id),
        ledgerEntry(cash, `Sold ${listing.shortName}${slabIds.length ? " (cash part of trade)" : ""}`, listing.id),
        ...ledger,
      ];
    }
  }

  const overrides = { ...prev.overrides };
  const newActivity: ActivityEvent = {
    kind: cash > 0 ? "Sale" : "Transfer",
    from: n.seller,
    to: n.buyer,
    price: cash > 0 ? cash : undefined,
    at: now,
    txHash: txHash || `0x${hexId(hashString(now + n.id), 8)}`,
  };
  const existingActivity = overrides[listing.id]?.activity || listing.activity || [];
  const overrideUpdate = {
    owner: n.buyer,
    soldTo: n.buyer,
    delisted: true,
    activity: [newActivity, ...existingActivity],
  };
  overrides[listing.id] = { ...overrides[listing.id], ...overrideUpdate };
  overrides[n.listingId] = { ...overrides[n.listingId], ...overrideUpdate };
  if (listing.tokenId) {
    overrides[`token-${listing.tokenId}`] = { ...overrides[`token-${listing.tokenId}`], ...overrideUpdate };
    overrides[listing.tokenId] = { ...overrides[listing.tokenId], ...overrideUpdate };
  }
  for (const id of slabIds) overrides[id] = { ...overrides[id], owner: n.seller, delisted: true };

  const negotiations = { ...prev.negotiations };
  for (const other of Object.values(prev.negotiations)) {
    if (other.status !== "open") continue;
    const isSameRoom = other.id === n.id;
    const isSameListing =
      other.listingId === listing.id ||
      other.listingId === n.listingId ||
      (listing.tokenId &&
        (other.listingId === `token-${listing.tokenId}` || other.listingId === listing.tokenId));

    if (!isSameRoom && !isSameListing) continue;

    if (isSameRoom) {
      negotiations[other.id] = {
        ...other,
        status: "sold",
        messages: [
          ...other.messages.map((m) => (m.id === offerId ? { ...m, status: "accepted" as const } : m)),
          systemMessage(
            `${n.seller} accepted ${n.buyer}'s offer. The token transferred on-chain and the vault updated custody.`,
          ),
        ],
      };
    } else {
      negotiations[other.id] = {
        ...other,
        status: "closed",
        messages: [
          ...other.messages.map((m) =>
            m.kind === "offer" && m.status === "pending" ? { ...m, status: "declined" as const } : m,
          ),
          systemMessage("This slab was sold to another buyer."),
        ],
      };
    }
  }

  return { next: { ...prev, overrides, vault, ledger, negotiations } };
}

/** Sets an offer's status and adds a note saying who did it. */
function markOffer(
  prev: PersistShape,
  negId: string,
  offerId: string,
  status: "declined" | "withdrawn",
  note: string,
  by?: string,
): PersistShape {
  const n = prev.negotiations[negId];
  if (!n) return prev;
  return {
    ...prev,
    negotiations: {
      ...prev.negotiations,
      [negId]: {
        ...n,
        messages: [
          ...n.messages.map((m) => (m.id === offerId ? { ...m, status } : m)),
          systemMessage(note, by),
        ],
      },
    },
  };
}

function append(prev: PersistShape, negId: string, ...messages: ChatMessage[]): PersistShape {
  const n = prev.negotiations[negId];
  if (!n) return prev;
  return {
    ...prev,
    negotiations: { ...prev.negotiations, [negId]: { ...n, messages: [...n.messages, ...messages] } },
  };
}

/** Asks the server for an in-character reply from the simulated party; null on any failure. */
async function writeReply(chat: Negotiation, me: string, listing: Listing): Promise<string | null> {
  const bot = chat.buyer === me ? chat.seller : chat.buyer;
  const pending = pendingOffer(chat);
  try {
    const res = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: chat.buyer === me ? "seller" : "buyer",
        name: bot,
        slab: {
          title: listing.title,
          grader: listing.grader,
          grade: listing.grade,
          gradeLabel: listing.gradeLabel,
          certNumber: listing.certNumber,
          asking: listing.price,
        },
        pendingOffer: pending?.offer
          ? `${pending.from === me ? "the user" : bot} offered ${usd(bidValue(pending.offer), { cents: true })} (${offerMix(pending.offer)})`
          : undefined,
        messages: chat.messages.map((m) => ({
          from: m.kind === "system" ? "system" : m.from === me ? "me" : "them",
          text:
            m.kind === "offer" && m.offer
              ? `[offer ${usd(bidValue(m.offer), { cents: true })}, ${offerMix(m.offer)}, ${m.status}]`
              : m.kind === "loan" && m.loan
                ? `[funded loan offer ${usd(m.loan.principal, { cents: true })} principal + ${usd(m.loan.interest, { cents: true })} interest, ${Math.round(m.loan.duration / 86400)} days]`
              : (m.text ?? ""),
        })),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}

/** Each user's state is stashed under its own key when someone else signs in on this browser. */
const userKey = (username: string) => `${STORAGE_KEY}:${username}`;

function stashUser(state: PersistShape) {
  if (!state.owner) return;
  try {
    window.localStorage.setItem(userKey(state.owner), JSON.stringify({ ...state, user: null }));
  } catch {
    /* storage unavailable */
  }
}

function loadUser(username: string): PersistShape {
  try {
    const raw = window.localStorage.getItem(userKey(username));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as PersistShape) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function loadState(): PersistShape {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as PersistShape) };
  } catch {
    return EMPTY;
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistShape>(EMPTY);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const router = useRouter();
  const toastSeq = useRef(0);
  const pendingAction = useRef<(() => void) | null>(null);
  /** latest state for timers, which outlive the render that scheduled them */
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  useEffect(() => {
    // Hydration: localStorage does not exist during SSR, so the first client render starts
    // from EMPTY and adopts the stored state once mounted.
    const loaded = loadState();
    loaded.slabs.forEach(registerListing);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loaded);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage can be unavailable (private mode) — the app still works */
    }
  }, [state, ready]);

  const recentToasts = useRef<Map<string, number>>(new Map());

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const key = `${t.title}::${t.body || ""}`;
    const now = Date.now();
    const last = recentToasts.current.get(key) || 0;
    if (now - last < 6000) return; // Deduplicate identical toasts within 6s
    recentToasts.current.set(key, now);

    const id = ++toastSeq.current;
    setToasts((prev) => {
      if (prev.some((p) => p.title === t.title && p.body === t.body)) return prev;
      const filtered = prev.filter((p) => p.title !== t.title || p.body !== t.body);
      return [...filtered.slice(-2), { ...t, id }];
    });
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const [chainBalance, setChainBalance] = useState<number>(0);
  const syncChainBalance = useCallback((bal: number) => {
    setChainBalance(bal);
  }, []);

  const balance = useMemo(() => {
    if (state.user?.address) {
      return cents(Math.max(chainBalance, ledgerBalance(state.ledger)));
    }
    return ledgerBalance(state.ledger);
  }, [state.user?.address, chainBalance, state.ledger]);

  const login = useCallback(
    (username: string, email?: string, address?: string) => {
      setState((current) => {
        // A different user on this browser: put the last one's state aside and load theirs.
        let prev = current;
        if (current.owner && current.owner !== username) {
          stashUser(current);
          const next = loadUser(username);
          // Preserve marketplace listings & overrides so cards listed by other users remain visible
          const mergedSlabsMap = new Map([...next.slabs, ...current.slabs].map((s) => [s.id, s]));
          const mergedOverrides = { ...next.overrides, ...current.overrides };
          const mergedNegotiations = { ...next.negotiations, ...current.negotiations };
          prev = {
            ...next,
            slabs: Array.from(mergedSlabsMap.values()),
            overrides: mergedOverrides,
            negotiations: mergedNegotiations,
          };
          // If switching to an on-chain account, filter out vault items that belong to other addresses or lack tokens
          if (address) {
            prev.vault = next.vault.filter(
              (v) => v.token && v.token.owner.toLowerCase() === address.toLowerCase(),
            );
          }
          prev.slabs.forEach(registerListing);
        }
        const fresh = !prev.ledger.length && !prev.vault.length;
        const starters = fresh && !address && username === DEMO_USER ? makeStarterListings(username, Date.now()) : [];
        starters.forEach(registerListing);
        return {
          ...prev,
          owner: username,
          user: {
            username,
            email: email ?? `${username}@example.com`,
            hue: hashString(username) % 360,
            joinedAt: prev.user?.username === username ? prev.user.joinedAt : new Date().toISOString(),
            address,
          },
          ledger: fresh && !address ? [ledgerEntry(WELCOME_CREDIT, "Welcome credit (demo money)")] : prev.ledger,
          slabs: [...starters, ...prev.slabs],
          vault: [
            ...starters.map<VaultItem>((l) => ({
              listingId: l.id,
              acquiredAt: l.listedAt,
              via: "Submission",
              status: "Vaulted",
            })),
            ...prev.vault,
          ],
          overrides: {
            ...prev.overrides,
            ...Object.fromEntries(starters.map((l) => [l.id, { delisted: true }])),
          },
        };
      });
      setAuthOpen(false);
      pushToast({ title: `Welcome, ${username}`, tone: "success" });
      const next = pendingAction.current;
      pendingAction.current = null;
      if (next) window.setTimeout(next, 60);
    },
    [pushToast],
  );

  const logout = useCallback(() => {
    setState((prev) => ({ ...prev, user: null }));
    pushToast({ title: "Signed out" });
  }, [pushToast]);

  const requireAuth = useCallback(
    (then?: () => void) => {
      if (state.user) return true;
      pendingAction.current = then ?? null;
      setAuthOpen(true);
      return false;
    },
    [state.user],
  );

  const resolve = useCallback(
    (listing: Listing): Listing => {
      const o = state.overrides[listing.id];
      if (!o) return listing;
      const combinedActivity = o.activity
        ? [...o.activity, ...(listing.activity ?? []).filter((a) => !o.activity!.some((oa) => oa.txHash === a.txHash))]
        : listing.activity;
      const combinedSales = o.sales
        ? [...o.sales, ...(listing.sales ?? []).filter((s) => !o.sales!.some((os) => os.date === s.date))]
        : listing.sales;
      return {
        ...listing,
        price: o.price ?? listing.price,
        acceptsLoan: o.acceptsLoan ?? listing.acceptsLoan,
        loanAsk: o.loanAsk ?? listing.loanAsk,
        owner: o.owner ?? listing.owner,
        ownerAddress: o.ownerAddress ?? listing.ownerAddress,
        listedAt: o.listedAt ?? listing.listedAt,
        activity: combinedActivity,
        sales: combinedSales,
      };
    },
    [state.overrides],
  );

  const isOwned = useCallback(
    (id: string) => state.vault.some((v) => v.listingId === id),
    [state.vault],
  );

  const isListed = useCallback(
    (id: string) => {
      // 1. Find all slab representations matching this id or tokenId
      const matchingSlabs = state.slabs.filter(
        (s) => s.id === id || s.tokenId === id || (s.tokenId && `token-${s.tokenId}` === id),
      );

      // 2. If any matching slab is explicitly listed on-chain (isListed: true from SlabMarket), it is listed!
      if (matchingSlabs.some((s) => s.isListed === true)) {
        return true;
      }

      // 3. Check for positive overrides: if explicitly listed via override, it is listed
      const o = state.overrides[id];
      if (o?.delisted === false) return true;

      // 4. Check tokenId-based positive overrides
      const tokenSlab = matchingSlabs.find((s) => s.tokenId);
      const tokenId = tokenSlab?.tokenId || (id.startsWith("token-") ? id.slice(6) : undefined);
      if (tokenId) {
        if (
          state.overrides[`token-${tokenId}`]?.delisted === false ||
          state.overrides[tokenId]?.delisted === false
        ) {
          return true;
        }
      }

      // 5. If any matching slab is explicitly unlisted on-chain (isListed: false), it is unlisted
      if (matchingSlabs.length > 0 && matchingSlabs.every((s) => s.isListed === false)) {
        return false;
      }

      // 6. Check negative overrides
      if (o?.delisted === true) return false;
      if (tokenId) {
        if (
          state.overrides[`token-${tokenId}`]?.delisted === true ||
          state.overrides[tokenId]?.delisted === true
        ) {
          return false;
        }
      }

      // 7. Fallback to slab.isListed if specified
      const anyListedFlag = matchingSlabs.find((s) => s.isListed !== undefined)?.isListed;
      if (anyListedFlag !== undefined) return anyListedFlag;

      // When deployed on-chain, catalog demo cards should NOT be listed
      if (IS_DEPLOYED) return false;
      // Submitted and tokenized slabs are unlisted by default unless explicitly listed
      if (id.startsWith("sub-") || id.startsWith("token-")) return false;
      // Catalog demo cards are listed by default when offline
      return true;
    },
    [state.overrides, state.slabs],
  );

  const toggleWatch = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      watchlist: prev.watchlist.includes(id)
        ? prev.watchlist.filter((w) => w !== id)
        : [...prev.watchlist, id],
    }));
  }, []);

  const isWatched = useCallback(
    (id: string) => state.watchlist.includes(id),
    [state.watchlist],
  );

  /* ---------------- slabs ---------------- */

  const submitSlab = useCallback(
    (input: SlabSubmission, token?: SlabToken): Listing | null => {
      const user = state.user;
      if (!user) return null;
      const cert = input.certNumber.trim();
      const duplicate = state.vault.find((v) => {
        const l = getListing(v.listingId);
        return l?.grader === input.grader && l.certNumber === cert;
      });
      // The chain sync may already have added this freshly minted token: that's the same slab, not an error.
      if (duplicate && token && duplicate.token?.tokenId === token.tokenId) return getListing(duplicate.listingId) ?? null;
      if (duplicate) {
        pushToast({ title: "Already in your slabs", body: `${input.grader} cert ${cert} is already vaulted.`, tone: "error" });
        return null;
      }
      const made = makeSubmittedListing({ ...input, owner: user.username, nowMs: Date.now() });
      // A minted slab shows its real token id, contract, owner wallet and mint transaction.
      const listing = made && token ? withToken(made, token) : made;
      if (!listing) {
        pushToast({ title: "Cert not found", body: `${input.grader} has no record of cert ${cert}.`, tone: "error" });
        return null;
      }
      registerListing(listing);
      setState((prev) => ({
        ...prev,
        slabs: [listing, ...prev.slabs],
        vault: [
          { listingId: listing.id, acquiredAt: listing.listedAt, via: "Submission", status: "Vaulted", token },
          ...prev.vault,
        ],
        overrides: { ...prev.overrides, [listing.id]: { delisted: true } },
      }));
      pushToast({ title: "Slab vaulted", body: `${listing.shortName} is now in your Vault.`, tone: "success" });
      return listing;
    },
    [state.user, state.vault, pushToast],
  );

  const listFromVault = useCallback(
    (id: string, price: number, acceptsLoan = false, loanAsk = 0) => {
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        overrides: {
          ...prev.overrides,
          [id]: {
            ...prev.overrides[id],
            price,
            acceptsLoan,
            loanAsk: acceptsLoan ? loanAsk : 0,
            delisted: false,
            listedAt: now,
          },
        },
        vault: prev.vault.map((v) =>
          v.listingId === id ? { ...v, status: "Listed", listedPrice: price } : v,
        ),
      }));
      pushToast({ title: "Listed on the marketplace", body: "Buyers can now send you offers.", tone: "success" });
    },
    [pushToast],
  );

  const delist = useCallback(
    (id: string) => {
      setState((prev) => {
        const me = prev.user?.username;
        const negotiations = { ...prev.negotiations };
        for (const n of Object.values(prev.negotiations)) {
          if (n.listingId !== id || n.seller !== me || n.status !== "open") continue;
          negotiations[n.id] = {
            ...n,
            status: "closed",
            messages: [
              ...n.messages.map((m) =>
                m.kind === "offer" && m.status === "pending" ? { ...m, status: "declined" as const } : m,
              ),
              systemMessage("The seller removed this listing."),
            ],
          };
        }
        return {
          ...prev,
          negotiations,
          overrides: { ...prev.overrides, [id]: { ...prev.overrides[id], delisted: true } },
          vault: prev.vault.map((v) =>
            v.listingId === id ? { ...v, status: "Vaulted", listedPrice: undefined } : v,
          ),
        };
      });
      pushToast({ title: "Listing removed", body: "Open offers on it were declined." });
    },
    [pushToast],
  );

  const buyNow = useCallback(
    (listingId: string, txHash?: string): boolean => {
      const snapshot = latest.current;
      const user = snapshot.user;
      if (!user) {
        pushToast({ title: "Please sign in", body: "Sign in to buy slabs.", tone: "error" });
        return false;
      }
      const listing = current(snapshot, listingId);
      if (!listing) return false;
      if (listing.owner === user.username) {
        pushToast({ title: "Cannot purchase your own slab", tone: "error" });
        return false;
      }
      const price = listing.price;
      const me = user.username;
      const now = new Date().toISOString();

      if (!user.address && price > ledgerBalance(snapshot.ledger)) {
        pushToast({ title: "Insufficient funds", body: "Top up your wallet balance first.", tone: "error" });
        return false;
      }

      setState((prev) => {
        const vault = prev.vault;
        let ledger = prev.ledger;

        if (!user.address) {
          ledger = [
            ledgerEntry(-price, `Bought ${listing.shortName} from @${listing.owner}`, listing.id),
            ...ledger,
          ];
        }

        const newVaultItem: VaultItem = {
          listingId: listing.id,
          acquiredAt: now,
          via: "Purchase",
          status: "Vaulted",
          token: listing.tokenId && listing.contract
            ? {
                chainId: 31337,
                contract: listing.contract,
                tokenId: listing.tokenId,
                owner: user.address ?? user.username,
                mintTx: txHash ?? "",
                custodianRef: "",
              }
            : undefined,
        };

        const overrides = { ...prev.overrides };
        const saleTx = txHash || `0x${hexId(hashString(now + listing.id), 20)}`;
        const saleEvent: ActivityEvent = {
          kind: "Sale",
          price,
          from: listing.owner,
          to: me,
          at: now,
          txHash: saleTx,
        };
        const prevActivity = overrides[listing.id]?.activity ?? listing.activity ?? [];
        const saleItem: Sale = { date: now, price };
        const prevSales = (overrides[listing.id]?.sales ?? listing.sales ?? []).filter((s) => s.date !== now);

        overrides[listing.id] = {
          ...overrides[listing.id],
          owner: me,
          soldTo: me,
          delisted: true,
          activity: [saleEvent, ...prevActivity.filter((e) => e.txHash !== saleTx)],
          sales: [saleItem, ...prevSales],
        };

        const updatedSlabs = prev.slabs.map((s) => {
          if (s.id !== listing.id) return s;
          const slabSales = (s.sales ?? []).filter((sl) => sl.date !== now);
          return {
            ...s,
            owner: me,
            ownerAddress: user.address ?? s.ownerAddress,
            activity: [saleEvent, ...(s.activity ?? []).filter((e) => e.txHash !== saleTx)],
            sales: [saleItem, ...slabSales],
          };
        });

        const negotiations = closeSellerChats(
          { ...prev, negotiations: prev.negotiations },
          listing.id,
          `Sold to @${me} for ${usd(price)}.`,
        );

        return {
          ...prev,
          negotiations,
          vault: [newVaultItem, ...vault.filter((v) => v.listingId !== listing.id)],
          ledger,
          slabs: updatedSlabs,
          overrides,
        };
      });

      pushToast({
        title: "Purchase successful!",
        body: `${listing.shortName} is now in your Vault.`,
        tone: "success",
      });
      return true;
    },
    [pushToast],
  );

  const requestShipping = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        vault: prev.vault.map((v) =>
          v.listingId === id ? { ...v, status: "Shipping requested" } : v,
        ),
      }));
      pushToast({
        title: "Shipping requested",
        body: "We will email a tracking number once the slab leaves the vault.",
        tone: "success",
      });
    },
    [pushToast],
  );

  /* ---------------- blockchain: onboarding / offboarding ---------------- */

  const recordChainCash = useCallback((amount: number, label: string, txHash: string) => {
    setState((prev) => ({ ...prev, ledger: [ledgerEntry(amount, `${label} · tx ${txHash.slice(0, 10)}…`), ...prev.ledger] }));
  }, []);

  const attachToken = useCallback((listingId: string, token: SlabToken) => {
    setState((prev) => ({
      ...prev,
      vault: prev.vault.map((v) => (v.listingId === listingId ? { ...v, token } : v)),
    }));
  }, []);

  const syncChainSlabs = useCallback(
    (owned: ChainSlab[], ownedByOthers: string[]) => {
      const snapshot = latest.current;
      const me = snapshot.user;
      if (!me?.address) return;
      // Only drop a token when ownerOf positively names someone else, so a read that started
      // before a fresh mint can never make that slab vanish.
      const others = new Set(ownedByOthers);
      const ownedMap = new Map(owned.map((o) => [o.token.tokenId, o]));
      const known = new Set(snapshot.vault.flatMap((v) => (v.token ? [v.token.tokenId] : [])));
      const gone = snapshot.vault.filter((v) => v.token && others.has(v.token.tokenId));
      // Saved from an earlier chain (restarted since): the token id now belongs to a different cert.
      const stale = snapshot.vault.filter((v) => {
        const o = v.token && ownedMap.get(v.token.tokenId);
        const l = o && getListing(v.listingId);
        return Boolean(o) && (!l || l.grader !== o!.grader || l.certNumber !== o!.certNumber);
      });
      const staleTokens = new Set(stale.map((v) => v.token!.tokenId));
      const arrived = owned.filter((o) => !known.has(o.token.tokenId) || staleTokens.has(o.token.tokenId));

      let updatedExisting = false;
      for (const v of snapshot.vault) {
        if (!v.token) continue;
        const o = ownedMap.get(v.token.tokenId);
        if (!o) continue;
        const newStatus: VaultItem["status"] = o.custody === "Vaulted" ? (o.isListed ? "Listed" : "Vaulted") : isAwaitingVaulting(o.custody) ? "Awaiting vaulting" : "Withdrawn";
        const listing = getListing(v.listingId);
        const title = o.title || `Vaulted Slab #${o.token.tokenId}`;
        const image = o.image || "";
        if (v.status !== newStatus || v.listedPrice !== o.listedPrice || listing?.title !== title || listing?.image !== image) {
          updatedExisting = true;
          break;
        }
      }

      if (!gone.length && !arrived.length && !stale.length && !updatedExisting) return;

      const added: { listing: Listing; item: VaultItem }[] = [];
      for (const o of arrived) {
        const listing = buildOnChainListing({
          tokenId: o.token.tokenId,
          title: o.title || `Vaulted Slab #${o.token.tokenId}`,
          image: o.image || "",
          grader: o.grader,
          certNumber: o.certNumber,
          price: o.isListed && o.listedPrice ? o.listedPrice : undefined,
          owner: me.username,
          ownerAddress: me.address,
          contract: o.token.contract,
        });
        registerListing(listing);
        const awaitingVaulting = isAwaitingVaulting(o.custody);
        const withdrawn = o.custody !== "Vaulted" && !awaitingVaulting;
        const status: VaultItem["status"] = awaitingVaulting ? "Awaiting vaulting" : withdrawn ? "Withdrawn" : o.isListed ? "Listed" : "Vaulted";
        added.push({
          listing,
          item: {
            listingId: listing.id,
            acquiredAt: new Date().toISOString(),
            via: o.via,
            status,
            listedPrice: o.listedPrice,
            token: o.token,
            withdrawal: withdrawn
              ? {
                  requestedAt: new Date().toISOString(),
                  requestTx: "",
                  shippingHash: "",
                  shipTo: "",
                  redemptionRef: o.redemptionRef,
                  carrier: o.carrier,
                  trackingNumber: o.trackingNumber,
                }
              : undefined,
          },
        });
      }

      setState((prev) => {
        const goneIds = new Set([...gone, ...stale].map((v) => v.listingId));
        const addIds = new Set(added.map((a) => a.listing.id));
        let negotiations = prev.negotiations;
        for (const id of goneIds) {
          negotiations = closeSellerChats({ ...prev, negotiations }, id, "The seller no longer owns this slab.");
        }

        const updatedVault = prev.vault
          .filter((v) => !goneIds.has(v.listingId) && !addIds.has(v.listingId))
          .map((v) => {
            if (!v.token) return v;
            const o = ownedMap.get(v.token.tokenId);
            if (!o) return v;
            const status: VaultItem["status"] = o.custody === "Vaulted" ? (o.isListed ? "Listed" : "Vaulted") : isAwaitingVaulting(o.custody) ? "Awaiting vaulting" : "Withdrawn";
            return { ...v, status, listedPrice: o.listedPrice };
          });

        // Older browser state can contain a received slab before it had a cert-derived
        // preview. Refresh it in-place as well as handling newly received tokens above.
        const refreshed = updatedVault.flatMap((v) => {
          if (!v.token) return [];
          const o = ownedMap.get(v.token.tokenId);
          if (!o) return [];
          const currentListing = getListing(v.listingId);
          const title = o.title || `Vaulted Slab #${o.token.tokenId}`;
          const image = o.image || "";
          if (currentListing?.title === title && currentListing.image === image) return [];
          const listing = buildOnChainListing({
            tokenId: o.token.tokenId,
            title,
            image,
            grader: o.grader,
            certNumber: o.certNumber,
            price: o.isListed && o.listedPrice ? o.listedPrice : undefined,
            owner: me.username,
            ownerAddress: me.address,
            contract: o.token.contract,
          });
          registerListing(listing);
          return [listing];
        });
        const refreshedIds = new Set(refreshed.map((listing) => listing.id));

        const newOverrides = { ...prev.overrides };
        // Update listing price and listing state only for items owned by this user
        for (const a of added) {
          if (a.item.status === "Listed") {
            newOverrides[a.listing.id] = { ...newOverrides[a.listing.id], price: a.item.listedPrice, delisted: false };
          }
        }
        for (const v of updatedVault) {
          if (v.token && ownedMap.has(v.token.tokenId)) {
            const o = ownedMap.get(v.token.tokenId)!;
            if (o.isListed) {
              newOverrides[v.listingId] = { ...newOverrides[v.listingId], price: o.listedPrice, delisted: false };
            }
          }
        }

        return {
          ...prev,
          negotiations,
          slabs: [
            ...added.map((a) => a.listing),
            ...refreshed,
            ...prev.slabs.filter((l) => !addIds.has(l.id) && !refreshedIds.has(l.id)),
          ],
          vault: [...added.map((a) => a.item), ...updatedVault],
          overrides: newOverrides,
        };
      });
      // Only show arrival toasts if this is not the initial hydration of pre-existing vault slabs
      if (known.size > 0) {
        for (const a of added) {
          if (staleTokens.has(a.item.token!.tokenId)) continue; // just corrected, not new
          pushToast({ title: `Token #${a.item.token!.tokenId} arrived`, body: `${a.listing.shortName} is now in your Vault.`, tone: "success" });
        }
      }
      for (const v of gone) pushToast({ title: `Token #${v.token!.tokenId} left your wallet`, body: "Another collector owns it now." });
    },
    [pushToast],
  );

  const syncMarketListings = useCallback(
    (activeListings: { listing: Listing; price: number; seller: string }[]) => {
      setState((prev) => {
        for (const a of activeListings) {
          registerListing(a.listing);
        }

        const newOverrides = { ...prev.overrides };
        const activeIds = new Set(activeListings.map((a) => a.listing.id));
        const activeTokenIds = new Set(
          activeListings.flatMap((a) => (a.listing.tokenId ? [a.listing.tokenId] : []))
        );

        for (const a of activeListings) {
          newOverrides[a.listing.id] = {
            ...newOverrides[a.listing.id],
            price: a.price,
            acceptsLoan: a.listing.acceptsLoan,
            loanAsk: a.listing.loanAsk,
            owner: a.seller || newOverrides[a.listing.id]?.owner,
            delisted: false,
          };
          if (a.listing.tokenId) {
            newOverrides[`token-${a.listing.tokenId}`] = {
              ...newOverrides[`token-${a.listing.tokenId}`],
              price: a.price,
              acceptsLoan: a.listing.acceptsLoan,
              loanAsk: a.listing.loanAsk,
              owner: a.seller || newOverrides[`token-${a.listing.tokenId}`]?.owner,
              delisted: false,
            };
            newOverrides[a.listing.tokenId] = {
              ...newOverrides[a.listing.tokenId],
              price: a.price,
              acceptsLoan: a.listing.acceptsLoan,
              loanAsk: a.listing.loanAsk,
              owner: a.seller || newOverrides[a.listing.tokenId]?.owner,
              delisted: false,
            };
            for (const s of prev.slabs) {
              if (s.tokenId === a.listing.tokenId) {
                newOverrides[s.id] = {
                  ...newOverrides[s.id],
                  price: a.price,
                  acceptsLoan: a.listing.acceptsLoan,
                  loanAsk: a.listing.loanAsk,
                  owner: a.seller || newOverrides[s.id]?.owner,
                  delisted: false,
                };
              }
            }
          }
        }

        // Delist any on-chain tokens that were previously listed but are no longer active
        if (activeListings.length > 0) {
          for (const s of prev.slabs) {
            if (s.tokenId && !activeTokenIds.has(s.tokenId) && !activeIds.has(s.id)) {
              newOverrides[s.id] = {
                ...newOverrides[s.id],
                delisted: true,
              };
              newOverrides[`token-${s.tokenId}`] = {
                ...newOverrides[`token-${s.tokenId}`],
                delisted: true,
              };
            }
          }
        }

        const newSlabsMap = new Map<string, Listing>();
        for (const a of activeListings) {
          const l = { ...a.listing, isListed: true };
          newSlabsMap.set(a.listing.id, l);
          if (a.listing.tokenId) {
            newSlabsMap.set(`token-${a.listing.tokenId}`, { ...l, id: `token-${a.listing.tokenId}` });
          }
        }
        for (const s of prev.slabs) {
          if (!newSlabsMap.has(s.id)) {
            const isStillActive = s.tokenId ? activeTokenIds.has(s.tokenId) : false;
            newSlabsMap.set(s.id, { ...s, isListed: isStillActive });
          }
        }

        return {
          ...prev,
          slabs: Array.from(newSlabsMap.values()),
          overrides: newOverrides,
        };
      });
    },
    [],
  );

  const handOver = useCallback(
    (listingId: string, toHandle: string, txHash?: string) => {
      setState((prev) => {
        const fromHandle = prev.user?.username ?? "you";
        const now = new Date().toISOString();
        const transferTx = txHash || `0x${hexId(Date.now(), 20)}`;
        const transferEvent: ActivityEvent = {
          kind: "Transfer",
          from: fromHandle,
          to: toHandle,
          at: now,
          txHash: transferTx,
        };

        const existingOverrides = prev.overrides[listingId];
        const prevActivity = existingOverrides?.activity ?? [];

        return {
          ...prev,
          negotiations: closeSellerChats(prev, listingId, `The slab was transferred to @${toHandle}.`),
          overrides: {
            ...prev.overrides,
            [listingId]: {
              ...existingOverrides,
              delisted: true,
              owner: toHandle,
              activity: [transferEvent, ...prevActivity.filter((e) => e.txHash !== transferTx)],
            },
          },
          vault: prev.vault.filter((v) => v.listingId !== listingId),
        };
      });
    },
    [],
  );

  const withdrawSlab = useCallback(
    (listingId: string, withdrawal: Withdrawal) => {
      setState((prev) => {
        // Same as delisting: every open chat about the slab closes and pending offers are declined.
        const negotiations = closeSellerChats(prev, listingId, "The seller withdrew this slab from the vault.");
        return {
          ...prev,
          negotiations,
          overrides: { ...prev.overrides, [listingId]: { ...prev.overrides[listingId], delisted: true } },
          vault: prev.vault.map((v) =>
            v.listingId === listingId ? { ...v, status: "Withdrawn", listedPrice: undefined, withdrawal } : v,
          ),
        };
      });
    },
    [],
  );

  const updateWithdrawal = useCallback((listingId: string, patch: Partial<Withdrawal>) => {
    setState((prev) => ({
      ...prev,
      vault: prev.vault.map((v) =>
        v.listingId === listingId && v.withdrawal ? { ...v, withdrawal: { ...v.withdrawal, ...patch } } : v,
      ),
    }));
  }, []);

  const offboard = useCallback(() => {
    setState((prev) => ({ ...prev, user: null }));
    pushToast({ title: "Account closed", body: "Your record stays on-chain. Your slabs' tokens are still yours." });
  }, [pushToast]);

  /* ---------------- negotiations ---------------- */

  const syncNegotiationToServer = (n: Negotiation) => {
    void fetch("/api/negotiations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ negotiation: n }),
    }).catch(() => null);
  };

  const makeOffer = useCallback(
    (listingId: string, bid: TradeBid, availableFunds?: number): string | null => {
      const user = state.user;
      const listing = current(state, listingId);
      if (!user || !listing) return null;
      const effective = availableFunds !== undefined ? availableFunds : balance;
      if (bid.cash > effective) {
        pushToast({ title: "Not enough in your wallet", body: "Lower the cash part or top up first.", tone: "error" });
        return null;
      }
      const me = user.username;
      const id = negotiationId(listingId, me);
      const now = new Date().toISOString();
      const offer: ChatMessage = { id: messageId(), from: me, at: now, kind: "offer", offer: bid, status: "pending" };
      let updatedNegotiation: Negotiation | null = null;
      setState((prev) => {
        const existing = prev.negotiations[id];
        const n: Negotiation =
          existing && existing.status === "open"
            ? {
                ...existing,
                messages: [
                  ...existing.messages.map((m) =>
                    m.kind === "offer" && m.status === "pending" && m.from === me
                      ? { ...m, status: "replaced" as const }
                      : m,
                  ),
                  offer,
                ],
              }
            : { id, listingId, seller: listing.owner, buyer: me, status: "open", createdAt: now, messages: [offer] };
        updatedNegotiation = n;
        return { ...prev, negotiations: { ...prev.negotiations, [id]: n } };
      });
      if (updatedNegotiation) syncNegotiationToServer(updatedNegotiation);
      pushToast({ title: "Offer sent", body: `${listing.owner} will reply in your chat.`, tone: "success" });
      return id;
    },
    [state, balance, pushToast],
  );

  const sendMessage = useCallback((negId: string, text: string) => {
    const me = latest.current.user?.username;
    if (!me) return;
    const chat = latest.current.negotiations[negId];
    if (!chat || chat.status !== "open") return;

    // Guard against duplicate send
    const last = chat.messages.at(-1);
    if (last && last.from === me && last.text === text && Date.now() - Date.parse(last.at) < 2000) {
      return;
    }

    const newMsg: ChatMessage = {
      id: messageId(),
      from: me,
      at: new Date().toISOString(),
      kind: "text",
      text,
    };

    let updatedNegotiation: Negotiation | null = null;
    setState((prev) => {
      const currentChat = prev.negotiations[negId];
      if (!currentChat || currentChat.status !== "open") return prev;
      if (currentChat.messages.some((m) => m.id === newMsg.id)) return prev;
      const updated = {
        ...currentChat,
        messages: [...currentChat.messages, newMsg],
      };
      updatedNegotiation = updated;
      return {
        ...prev,
        negotiations: { ...prev.negotiations, [negId]: updated },
      };
    });

    if (updatedNegotiation) {
      syncNegotiationToServer(updatedNegotiation);
    }
  }, []);

  const openChat = useCallback((anchor: Listing): string | null => {
    const me = latest.current.user?.username;
    if (!me || anchor.owner === me) return null;
    const id = negotiationId(anchor.id, me);
    registerListing(anchor);
    let updated: Negotiation | null = null;
    setState((prev) => {
      const existing = prev.negotiations[id];
      const n: Negotiation =
        existing && existing.status === "open"
          ? existing
          : {
              id,
              listingId: anchor.id,
              seller: anchor.owner,
              buyer: me,
              status: "open",
              createdAt: new Date().toISOString(),
              messages: [
                ...(existing?.messages ?? []),
                systemMessage(existing ? `${me} reopened the chat.` : `${me} opened a chat with ${anchor.owner}.`, me),
              ],
            };
      updated = n;
      return {
        ...prev,
        // Kept so the chat's slab can be found again after a reload, but never shown as for sale.
        slabs: prev.slabs.some((s) => s.id === anchor.id) ? prev.slabs : [anchor, ...prev.slabs],
        overrides: prev.overrides[anchor.id] ? prev.overrides : { ...prev.overrides, [anchor.id]: { delisted: true } },
        negotiations: { ...prev.negotiations, [id]: n },
      };
    });
    if (updated) syncNegotiationToServer(updated);
    return id;
  }, []);

  /** Adds one message from the signed-in user to an open chat and shares it with the other side. */
  const appendMessage = useCallback((negId: string, build: (me: string) => ChatMessage, allowClosed = false) => {
    const me = latest.current.user?.username;
    if (!me) return;
    let updated: Negotiation | null = null;
    setState((prev) => {
      const chat = prev.negotiations[negId];
      if (!chat || (chat.status !== "open" && !allowClosed)) return prev;
      updated = { ...chat, messages: [...chat.messages, build(me)] };
      return { ...prev, negotiations: { ...prev.negotiations, [negId]: updated } };
    });
    if (updated) syncNegotiationToServer(updated);
  }, []);

  const postTrade = useCallback(
    (negId: string, trade: ChatTrade) =>
      appendMessage(negId, (me) => ({ id: messageId(), from: me, at: new Date().toISOString(), kind: "trade", trade })),
    [appendMessage],
  );

  const postLoan = useCallback(
    (negId: string, loan: ChatLoan) =>
      appendMessage(negId, (me) => ({ id: messageId(), from: me, at: new Date().toISOString(), kind: "loan", loan })),
    [appendMessage],
  );

  const chatNote = useCallback(
    // A note about what just happened on-chain is kept even if the chat has closed in the meantime.
    (negId: string, text: string) => appendMessage(negId, (me) => systemMessage(text, me), true),
    [appendMessage],
  );

  const respondToOffer = useCallback(
    (negId: string, offerId: string, accept: boolean, txHash?: string) => {
      const snapshot = latest.current;
      const me = snapshot.user?.username;
      if (!me) return;
      if (accept) {
        const { error } = settleDeal(snapshot, negId, offerId, balance, txHash);
        if (error) {
          pushToast({ title: "Could not accept", body: error, tone: "error" });
          return;
        }
        setState((prev) => {
          const res = settleDeal(prev, negId, offerId, balance, txHash).next;
          const updated = res.negotiations[negId];
          if (updated) syncNegotiationToServer(updated);
          return res;
        });
        pushToast({ title: "Offer accepted", body: "See your Vault and Wallet for the update.", tone: "success" });
      } else {
        setState((prev) => {
          const res = markOffer(prev, negId, offerId, "declined", `${me} declined the offer.`, me);
          const updated = res.negotiations[negId];
          if (updated) syncNegotiationToServer(updated);
          return res;
        });
      }
    },
    [pushToast, balance],
  );

  const withdrawOffer = useCallback((negId: string, offerId: string) => {
    setState((prev) => {
      const me = prev.user?.username;
      if (!me) return prev;
      const res = markOffer(prev, negId, offerId, "withdrawn", `${me} cancelled the offer.`, me);
      const updated = res.negotiations[negId];
      if (updated) syncNegotiationToServer(updated);
      return res;
    });
  }, []);

  /* Periodic poll to sync negotiations across accounts/sessions */
  useEffect(() => {
    if (!ready) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/negotiations");
        if (!res.ok) return;
        const data = (await res.json()) as { negotiations?: Record<string, Negotiation> };
        if (!data?.negotiations || !active) return;

        setState((prev) => {
          let changed = false;
          const merged = { ...prev.negotiations };
          let newVault = prev.vault;
          const newOverrides = { ...prev.overrides };

          for (const [id, incoming] of Object.entries(data.negotiations!)) {
            const existing = merged[id];
            if (!existing) {
              merged[id] = incoming;
              changed = true;
              if (prev.user && incoming.seller === prev.user.username && incoming.status === "open") {
                const pending = incoming.messages.find((m) => m.kind === "offer" && m.status === "pending");
                if (pending && pending.from !== prev.user.username) {
                  pushToast({ title: `New offer from @${incoming.buyer}`, body: "Check Negotiation rooms." });
                }
              }
            } else {
              const existingMsgs = existing.messages?.length || 0;
              const incomingMsgs = incoming.messages?.length || 0;
              const hasDiff =
                existing.status !== incoming.status ||
                incomingMsgs !== existingMsgs ||
                JSON.stringify(existing.messages) !== JSON.stringify(incoming.messages);
              if (hasDiff) {
                merged[id] = {
                  ...existing,
                  ...incoming,
                  messages: incoming.messages,
                };
                changed = true;
              }
            }

            if (incoming.status === "sold") {
              const lastMsg = incoming.messages.at(-1);
              const acceptedOffer = incoming.messages.find(
                (m) => m.kind === "offer" && m.status === "accepted"
              );
              const offerAmount = acceptedOffer?.offer?.cash ?? 0;
              const soldAt = lastMsg?.at || new Date().toISOString();
              const existingOverrides = newOverrides[incoming.listingId] || {};
              // Only apply when ownership hasn't transferred to the buyer yet.
              // Once the buyer owns the slab and may have listed it, do not force delisting.
              if (existingOverrides.owner !== incoming.buyer) {
                const baseListing = getListing(incoming.listingId) || prev.slabs.find((s) => s.id === incoming.listingId);
                const existingActivity = existingOverrides.activity || baseListing?.activity || [];
                const alreadyHasSale = existingActivity.some(
                  (a) => a.kind === "Sale" && a.to === incoming.buyer && a.from === incoming.seller
                );
                const saleActivity: ActivityEvent = {
                  kind: "Sale",
                  from: incoming.seller,
                  to: incoming.buyer,
                  price: offerAmount > 0 ? offerAmount : undefined,
                  at: soldAt,
                  txHash: `0x${hexId(hashString(soldAt + incoming.id), 8)}`,
                };
                const updatedActivity = alreadyHasSale ? existingActivity : [saleActivity, ...existingActivity];
                newOverrides[incoming.listingId] = {
                  ...existingOverrides,
                  owner: incoming.buyer,
                  soldTo: incoming.buyer,
                  delisted: true,
                  activity: updatedActivity,
                };
                changed = true;
              }
            }

            if (prev.user && incoming.buyer === prev.user.username && incoming.status === "sold") {
              const existingItem = newVault.find((v) => v.listingId === incoming.listingId);
              const baseListing = getListing(incoming.listingId) || prev.slabs.find((s) => s.id === incoming.listingId);
              const tokenId = baseListing?.tokenId;
              const token: SlabToken | undefined = tokenId
                ? {
                    chainId: 31337,
                    contract: baseListing?.contract || contracts.slabVault.address,
                    tokenId,
                    owner: prev.user.address || "",
                    mintTx: "",
                    custodianRef: "",
                  }
                : undefined;

              // Only manage newVault here for off-chain users (without a connected wallet).
              // For on-chain users, ChainVaultSync is the single source of truth for token ownership.
              if (!prev.user.address && !tokenId) {
                if (!existingItem) {
                  newVault = [
                    {
                      listingId: incoming.listingId,
                      acquiredAt: incoming.messages.at(-1)?.at || new Date().toISOString(),
                      via: "Trade",
                      status: "Vaulted",
                      token,
                    },
                    ...newVault,
                  ];
                  changed = true;
                } else if (!existingItem.token && token) {
                  newVault = newVault.map((item) =>
                    item.listingId === incoming.listingId ? { ...item, token } : item,
                  );
                  changed = true;
                }
              }
            }

            if (prev.user && incoming.seller === prev.user.username && incoming.status === "sold") {
              const item = newVault.find((v) => v.listingId === incoming.listingId);
              // Only remove here if user is not on-chain or item has no token.
              // For on-chain users, ChainVaultSync is the authoritative source for token ownership.
              if (item && !prev.user.address && !item.token) {
                newVault = newVault.filter((v) => v.listingId !== incoming.listingId);
                changed = true;
              }
            }
          }

          if (!changed) return prev;
          return {
            ...prev,
            negotiations: merged,
            vault: newVault,
            overrides: newOverrides,
          };
        });
      } catch {
        /* ignore polling errors */
      }
    };

    void poll();
    const interval = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [ready, pushToast]);

  /* The simulated other party answers whatever the user last did in a chat (dummy catalog handles only) */
  const answered = useRef(new Set<string>());
  useEffect(() => {
    const me = state.user?.username;
    if (!ready || !me) return;
    for (const n of Object.values(state.negotiations)) {
      const last = n.messages.at(-1);
      if (n.status !== "open" || !last || answered.current.has(last.id)) continue;
      if (last.from !== me && last.by !== me) continue;

      const other = n.buyer === me ? n.seller : n.buyer;
      const isRealAccount =
        other === "test1" ||
        other === "test2" ||
        other.toLowerCase().startsWith("test") ||
        other === "ash" ||
        other === "misty" ||
        other === "brock";
      if (isRealAccount) continue;

      answered.current.add(last.id);
      window.setTimeout(() => {
        const snapshot = latest.current;
        const chat = snapshot.negotiations[n.id];
        const listing = chat ? current(snapshot, chat.listingId) : undefined;
        if (!chat || !listing || chat.messages.at(-1)?.id !== last.id) return;
        const action = botReply(chat, listing, me);
        if (action) applyBot(chat, listing, action);
      }, 1500 + Math.random() * 2000);
    }

    function applyBot(chat: Negotiation, listing: Listing, action: BotAction) {
      const bot = chat.buyer === me ? chat.seller : chat.buyer;
      const say = (text: string): ChatMessage => ({
        id: messageId(),
        from: bot,
        at: new Date().toISOString(),
        kind: "text",
        text,
      });
      if (action.type === "text" && action.chat) {
        // Let the LLM answer the actual question; keep the canned line as a fallback.
        void writeReply(chat, me!, listing).then((text) =>
          setState((prev) => append(prev, chat.id, say(text ?? action.text))),
        );
      } else if (action.type === "text") {
        setState((prev) => append(prev, chat.id, say(action.text)));
      } else if (action.type === "decline") {
        setState((prev) =>
          append(markOffer(prev, chat.id, action.offerId, "declined", `${bot} declined the offer.`), chat.id, say(action.text)),
        );
      } else if (action.type === "offer") {
        setState((prev) =>
          append(prev, chat.id, ...(action.text ? [say(action.text)] : []), {
            id: messageId(),
            from: bot,
            at: new Date().toISOString(),
            kind: "offer",
            offer: action.offer,
            status: "pending",
          }),
        );
        pushToast({ title: `New offer from ${bot}` });
      } else {
        const { error } = settleDeal(latest.current, chat.id, action.offerId);
        if (error) {
          setState((prev) =>
            append(
              markOffer(prev, chat.id, action.offerId, "declined", `The deal could not go through. ${error}`),
              chat.id,
            ),
          );
          pushToast({ title: "Deal failed", body: error, tone: "error" });
          return;
        }
        setState((prev) => {
          const withNote = append(prev, chat.id, say(action.text));
          return settleDeal(withNote, chat.id, action.offerId).next;
        });
        pushToast({ title: `${bot} accepted your offer`, body: "The slab is now in your Vault.", tone: "success" });
      }
    }
  }, [ready, state.user?.username, state.negotiations, pushToast]);

  /* Simulated collectors send offers on the user's listings now and then. */
  const signedIn = Boolean(state.user);
  useEffect(() => {
    if (!ready || !signedIn) return;
    const timer = window.setInterval(() => {
      if (document.hidden || Math.random() > 0.35) return;
      const snapshot = latest.current;
      const me = snapshot.user?.username;
      const listed = snapshot.vault.filter((v) => v.status === "Listed");
      if (!me || !listed.length) return;
      const pick = listed[Math.floor(Math.random() * listed.length)];
      const listing = current(snapshot, pick.listingId);
      if (!listing) return;
      const chats = Object.values(snapshot.negotiations).filter(
        (n) => n.listingId === listing.id && n.seller === me,
      );
      if (chats.filter((c) => c.status === "open").length >= 3) return;
      const chat = newBuyerChat(listing, me, chats.map((c) => c.buyer));
      if (!chat) return;
      setState((prev) => ({ ...prev, negotiations: { ...prev.negotiations, [chat.id]: chat } }));
      pushToast({ title: `New offer from ${chat.buyer}`, body: listing.shortName });
    }, 9000);
    return () => window.clearInterval(timer);
  }, [ready, signedIn, pushToast]);

  const fileLostReport = useCallback(
    (negId: string, item: LostItem, tracking: string, details: string): LostReport => {
      const report: LostReport = {
        id: `LR-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        negotiationId: negId,
        item,
        tracking,
        details,
        filedAt: new Date().toISOString(),
        status: "Under investigation",
      };
      setState((prev) =>
        append(
          { ...prev, lostReports: [report, ...prev.lostReports] },
          negId,
          systemMessage(`Lost item report ${report.id} filed. The vault team is checking the custody log for this deal.`),
        ),
      );
      pushToast({ title: `Report ${report.id} filed`, body: "We will email you within 48 hours.", tone: "success" });
      return report;
    },
    [pushToast],
  );

  const addComment = useCallback((listingId: string, text: string) => {
    setState((prev) => {
      const entry = {
        id: `local-${Date.now()}`,
        user: prev.user?.username ?? "you",
        text,
        at: new Date().toISOString(),
      };
      return {
        ...prev,
        comments: {
          ...prev.comments,
          [listingId]: [entry, ...(prev.comments[listingId] ?? [])],
        },
      };
    });
  }, []);

  const topUp = useCallback(
    (amount: number) => {
      setState((prev) => ({ ...prev, ledger: [ledgerEntry(amount, "Wallet top-up (demo money)"), ...prev.ledger] }));
      pushToast({ title: `Added ${usd(amount, { cents: true })} to your wallet`, tone: "success" });
    },
    [pushToast],
  );

  const resetDemo = useCallback(() => {
    try {
      // The live state and every user's stashed state.
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith(STORAGE_KEY))
        .forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    setState(EMPTY);
    router.push("/");
  }, [router]);

  const value: StoreValue = {
    ...state,
    ready,
    balance,
    syncChainBalance,
    login,
    logout,
    requireAuth,
    authOpen,
    setAuthOpen,
    toggleWatch,
    isWatched,
    submitSlab,
    listFromVault,
    delist,
    buyNow,
    requestShipping,
    recordChainCash,
    attachToken,
    syncChainSlabs,
    syncMarketListings,
    handOver,
    withdrawSlab,
    updateWithdrawal,
    offboard,
    makeOffer,
    sendMessage,
    openChat,
    postTrade,
    postLoan,
    chatNote,
    respondToOffer,
    withdrawOffer,
    fileLostReport,
    addComment,
    topUp,
    resetDemo,
    resolve,
    isOwned,
    isListed,
    toasts,
    pushToast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

/** Marketplace inventory = catalog plus submitted slabs, minus anything off the market. */
export function useMarketInventory(): Listing[] {
  const { isListed, resolve, slabs } = useStore();
  return useMemo(() => {
    const map = new Map<string, Listing>();
    const pool = IS_DEPLOYED ? slabs : slabs.length > 0 ? slabs : LISTINGS;
    for (const l of pool) {
      if (isListed(l.id)) {
        const item = resolve(l);
        const key = item.tokenId ? `token-${item.tokenId}` : item.id;
        // Prefer canonical token-${tokenId} listing over legacy sub-xxx representation
        if (!map.has(key) || (item.id.startsWith("token-") && !map.get(key)!.id.startsWith("token-"))) {
          map.set(key, item);
        }
      }
    }
    return Array.from(map.values());
  }, [slabs, isListed, resolve]);
}

/** All known slabs — listed or not — for the browse-all catalog. */
export function useAllSlabs(): Listing[] {
  const { slabs, resolve } = useStore();
  return useMemo(() => {
    // In demo mode slabs is empty until a user logs in; fall back to the full catalog.
    const pool = IS_DEPLOYED ? slabs : slabs.length > 0 ? slabs : LISTINGS;
    const map = new Map<string, Listing>();
    for (const l of pool) {
      const item = resolve(l);
      const key = item.tokenId ? `token-${item.tokenId}` : item.id;
      if (!map.has(key) || (item.id.startsWith("token-") && !map.get(key)!.id.startsWith("token-"))) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }, [slabs, resolve]);
}
