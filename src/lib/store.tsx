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
import { LISTINGS, getListing, makeStarterListings, makeSubmittedListing, registerListing } from "./catalog";
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
import { hashString } from "./rng";
import type {
  ChatMessage,
  Grader,
  LedgerEntry,
  Listing,
  LostItem,
  LostReport,
  Negotiation,
  SlabToken,
  TradeBid,
  VaultItem,
  Withdrawal,
} from "./types";

const STORAGE_KEY = "pokechain.state.v3";

/** Demo credit every new wallet starts with. */
const WELCOME_CREDIT = 2500;

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
  owner?: string;
  soldTo?: string;
  delisted?: boolean;
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
  grader: Grader;
  certNumber: string;
  /** SlabVault custody, e.g. "Vaulted", "Shipped" */
  custody: string;
  /** minted to this wallet, or received from another collector */
  via: "Submission" | "Transfer";
  carrier?: string;
  trackingNumber?: string;
  redemptionRef?: string;
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
  listFromVault: (id: string, price: number) => void;
  delist: (id: string) => void;
  requestShipping: (id: string) => void;
  /* blockchain: account and slab onboarding / offboarding */
  /** mirrors an on-chain USDC deposit (+) or withdrawal (−) into the wallet history */
  recordChainCash: (amount: number, label: string, txHash: string) => void;
  /** a slab already in the vault has been minted on-chain */
  attachToken: (listingId: string, token: SlabToken) => void;
  /**
   * For tokenised slabs the chain is the source of truth: adds tokens this wallet received
   * (e.g. a transfer from another collector) and drops tokens it no longer owns.
   */
  syncChainSlabs: (owned: ChainSlab[], ownedByOthers: string[]) => void;
  /** the slab has left the vault: unlisted, its chats closed, moved to the Withdrawn tab */
  withdrawSlab: (listingId: string, withdrawal: Withdrawal) => void;
  updateWithdrawal: (listingId: string, patch: Partial<Withdrawal>) => void;
  /** the account was closed on-chain: sign out, keep the record */
  offboard: () => void;
  /* negotiations */
  /** sends an offer in the buyer's chat with the seller; returns the chat id */
  makeOffer: (listingId: string, bid: TradeBid) => string | null;
  sendMessage: (negotiationId: string, text: string) => void;
  /** seller side: accept or decline the buyer's pending offer */
  respondToOffer: (negotiationId: string, offerId: string, accept: boolean) => void;
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

/** The listing as it stands in this state: price and owner after any changes. */
function current(prev: PersistShape, id: string): Listing | undefined {
  const base = getListing(id);
  if (!base) return undefined;
  const o = prev.overrides[id];
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

  if (n.buyer === me) {
    if (cash > ledgerBalance(prev.ledger)) {
      return { next: prev, error: `Your wallet cannot cover the ${usd(cash, { cents: true })} cash.` };
    }
    const vaulted = (id: string) => prev.vault.some((v) => v.listingId === id && v.status === "Vaulted");
    if (!slabIds.every(vaulted)) {
      return { next: prev, error: "A slab in this offer is no longer in your vault." };
    }
    vault = vault.filter((v) => !slabIds.includes(v.listingId));
    vault = [
      { listingId: listing.id, acquiredAt: now, via: slabIds.length ? "Trade" : "Purchase", status: "Vaulted" },
      ...vault,
    ];
    if (cash > 0) {
      ledger = [
        ledgerEntry(-cash, `Bought ${listing.shortName}${slabIds.length ? " (cash part of trade)" : ""}`, listing.id),
        ...ledger,
      ];
    }
  } else if (n.seller === me) {
    if (!prev.vault.some((v) => v.listingId === listing.id)) {
      return { next: prev, error: "You no longer own this slab." };
    }
    vault = vault.filter((v) => v.listingId !== listing.id);
    vault = [
      ...slabIds.map<VaultItem>((id) => ({ listingId: id, acquiredAt: now, via: "Trade", status: "Vaulted" })),
      ...vault,
    ];
    if (cash > 0) {
      ledger = [
        ledgerEntry(-sellerFee(cash), `Seller fee (${BRAND.sellerFee * 100}%) on ${listing.shortName}`, listing.id),
        ledgerEntry(cash, `Sold ${listing.shortName}${slabIds.length ? " (cash part of trade)" : ""}`, listing.id),
        ...ledger,
      ];
    }
  }

  const overrides = { ...prev.overrides };
  overrides[listing.id] = { ...overrides[listing.id], owner: n.buyer, soldTo: n.buyer, delisted: true };
  for (const id of slabIds) overrides[id] = { ...overrides[id], owner: n.seller, delisted: true };

  const negotiations = { ...prev.negotiations };
  for (const other of Object.values(prev.negotiations)) {
    if (other.listingId !== listing.id || other.status !== "open") continue;
    if (other.id === n.id) {
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
          marketValue: listing.fmv,
        },
        pendingOffer: pending?.offer
          ? `${pending.from === me ? "the user" : bot} offered ${usd(bidValue(pending.offer), { cents: true })} (${offerMix(pending.offer)})`
          : undefined,
        messages: chat.messages.map((m) => ({
          from: m.kind === "system" ? "system" : m.from === me ? "me" : "them",
          text:
            m.kind === "offer" && m.offer
              ? `[offer ${usd(bidValue(m.offer), { cents: true })}, ${offerMix(m.offer)}, ${m.status}]`
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

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const balance = useMemo(() => ledgerBalance(state.ledger), [state.ledger]);

  const login = useCallback(
    (username: string, email?: string, address?: string) => {
      setState((current) => {
        // A different user on this browser: put the last one's state aside and load theirs.
        let prev = current;
        if (current.owner && current.owner !== username) {
          stashUser(current);
          prev = loadUser(username);
          prev.slabs.forEach(registerListing);
        }
        const fresh = !prev.ledger.length && !prev.vault.length;
        const starters = fresh && username === DEMO_USER ? makeStarterListings(username, Date.now()) : [];
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
      return { ...listing, price: o.price ?? listing.price, owner: o.owner ?? listing.owner };
    },
    [state.overrides],
  );

  const isOwned = useCallback(
    (id: string) => state.vault.some((v) => v.listingId === id),
    [state.vault],
  );

  const isListed = useCallback(
    (id: string) => !state.overrides[id]?.delisted,
    [state.overrides],
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
      const listing =
        made && token
          ? {
              ...made,
              tokenId: token.tokenId,
              contract: token.contract,
              ownerAddress: token.owner,
              activity: made.activity.map((a) => (a.kind === "Mint" ? { ...a, txHash: token.mintTx } : a)),
            }
          : made;
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
    (id: string, price: number) => {
      setState((prev) => ({
        ...prev,
        overrides: { ...prev.overrides, [id]: { ...prev.overrides[id], price, delisted: false } },
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
      const known = new Set(snapshot.vault.flatMap((v) => (v.token ? [v.token.tokenId] : [])));
      const gone = snapshot.vault.filter((v) => v.token && others.has(v.token.tokenId));
      const arrived = owned.filter((o) => !known.has(o.token.tokenId));
      if (!gone.length && !arrived.length) return;

      const added: { listing: Listing; item: VaultItem }[] = [];
      for (const o of arrived) {
        const made = makeSubmittedListing({ grader: o.grader, certNumber: o.certNumber, owner: me.username, nowMs: Date.now() });
        if (!made) continue;
        const listing = { ...made, tokenId: o.token.tokenId, contract: o.token.contract, ownerAddress: o.token.owner };
        registerListing(listing);
        const withdrawn = o.custody !== "Vaulted";
        added.push({
          listing,
          item: {
            listingId: listing.id,
            acquiredAt: new Date().toISOString(),
            via: o.via,
            status: withdrawn ? "Withdrawn" : "Vaulted",
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
        const goneIds = new Set(gone.map((v) => v.listingId));
        const addIds = new Set(added.map((a) => a.listing.id));
        return {
          ...prev,
          slabs: [...added.map((a) => a.listing), ...prev.slabs.filter((l) => !addIds.has(l.id))],
          vault: [...added.map((a) => a.item), ...prev.vault.filter((v) => !goneIds.has(v.listingId) && !addIds.has(v.listingId))],
          overrides: {
            ...prev.overrides,
            ...Object.fromEntries([...goneIds, ...addIds].map((id) => [id, { ...prev.overrides[id], delisted: true }])),
          },
        };
      });
      for (const a of added) pushToast({ title: `Token #${a.item.token!.tokenId} arrived`, body: `${a.listing.shortName} is now in your Vault.`, tone: "success" });
      for (const v of gone) pushToast({ title: `Token #${v.token!.tokenId} left your wallet`, body: "Another collector owns it now." });
    },
    [pushToast],
  );

  const withdrawSlab = useCallback(
    (listingId: string, withdrawal: Withdrawal) => {
      setState((prev) => {
        const me = prev.user?.username;
        // Same as delisting: every open chat about the slab closes and pending offers are declined.
        const negotiations = { ...prev.negotiations };
        for (const n of Object.values(prev.negotiations)) {
          if (n.listingId !== listingId || n.seller !== me || n.status !== "open") continue;
          negotiations[n.id] = {
            ...n,
            status: "closed",
            messages: [
              ...n.messages.map((m) =>
                m.kind === "offer" && m.status === "pending" ? { ...m, status: "declined" as const } : m,
              ),
              systemMessage("The seller withdrew this slab from the vault."),
            ],
          };
        }
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

  const makeOffer = useCallback(
    (listingId: string, bid: TradeBid): string | null => {
      const user = state.user;
      const listing = current(state, listingId);
      if (!user || !listing) return null;
      if (bid.cash > balance) {
        pushToast({ title: "Not enough in your wallet", body: "Lower the cash part or top up first.", tone: "error" });
        return null;
      }
      const me = user.username;
      const id = negotiationId(listingId, me);
      const now = new Date().toISOString();
      const offer: ChatMessage = { id: messageId(), from: me, at: now, kind: "offer", offer: bid, status: "pending" };
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
        return { ...prev, negotiations: { ...prev.negotiations, [id]: n } };
      });
      pushToast({ title: "Offer sent", body: `${listing.owner} will reply in your chat.`, tone: "success" });
      return id;
    },
    [state, balance, pushToast],
  );

  const sendMessage = useCallback((negId: string, text: string) => {
    setState((prev) => {
      const me = prev.user?.username;
      if (!me || prev.negotiations[negId]?.status !== "open") return prev;
      return append(prev, negId, { id: messageId(), from: me, at: new Date().toISOString(), kind: "text", text });
    });
  }, []);

  const respondToOffer = useCallback(
    (negId: string, offerId: string, accept: boolean) => {
      const snapshot = latest.current;
      const me = snapshot.user?.username;
      if (!me) return;
      if (accept) {
        const { error } = settleDeal(snapshot, negId, offerId);
        if (error) {
          pushToast({ title: "Could not accept", body: error, tone: "error" });
          return;
        }
        setState((prev) => settleDeal(prev, negId, offerId).next);
        pushToast({ title: "Offer accepted", body: "See your Vault and Wallet for the update.", tone: "success" });
      } else {
        setState((prev) => markOffer(prev, negId, offerId, "declined", `${me} declined the offer.`, me));
      }
    },
    [pushToast],
  );

  const withdrawOffer = useCallback((negId: string, offerId: string) => {
    setState((prev) => {
      const me = prev.user?.username;
      if (!me) return prev;
      return markOffer(prev, negId, offerId, "withdrawn", `${me} cancelled the offer.`, me);
    });
  }, []);

  /* The simulated other party answers whatever the user last did in a chat. */
  const answered = useRef(new Set<string>());
  useEffect(() => {
    const me = state.user?.username;
    if (!ready || !me) return;
    for (const n of Object.values(state.negotiations)) {
      const last = n.messages.at(-1);
      if (n.status !== "open" || !last || answered.current.has(last.id)) continue;
      if (last.from !== me && last.by !== me) continue;
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
    requestShipping,
    recordChainCash,
    attachToken,
    syncChainSlabs,
    withdrawSlab,
    updateWithdrawal,
    offboard,
    makeOffer,
    sendMessage,
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
  const { overrides, resolve, slabs } = useStore();
  return useMemo(
    () => [...slabs, ...LISTINGS].filter((l) => !overrides[l.id]?.delisted).map(resolve),
    [slabs, overrides, resolve],
  );
}
