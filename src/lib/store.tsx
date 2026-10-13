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
import { LISTINGS, getListing } from "./catalog";
import { hashString } from "./rng";
import { messageId, seedRoom } from "./trade";
import type {
  Listing,
  LostItem,
  LostReport,
  Offer,
  Order,
  TradeBid,
  TradeMessage,
  TradeRoom,
  VaultItem,
} from "./types";

const STORAGE_KEY = "pokechain.state.v1";

export interface SessionUser {
  username: string;
  email: string;
  hue: number;
  balance: number;
  joinedAt: string;
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
  extraOffers?: Offer[];
}

interface PersistShape {
  user: SessionUser | null;
  cart: string[];
  watchlist: string[];
  vault: VaultItem[];
  orders: Order[];
  overrides: Record<string, ListingOverride>;
  offersMade: Offer[];
  comments: Record<string, { id: string; user: string; text: string; at: string }[]>;
  trades: Record<string, TradeRoom>;
  lostReports: LostReport[];
}

const EMPTY: PersistShape = {
  user: null,
  cart: [],
  watchlist: [],
  vault: [],
  orders: [],
  overrides: {},
  offersMade: [],
  comments: {},
  trades: {},
  lostReports: [],
};

interface StoreValue extends PersistShape {
  ready: boolean;
  /* auth */
  login: (username: string, email?: string) => void;
  logout: () => void;
  requireAuth: (then?: () => void) => boolean;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  /* cart */
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  /* watchlist */
  toggleWatch: (id: string) => void;
  isWatched: (id: string) => boolean;
  /* commerce */
  checkout: (method: "card" | "usdc") => Order | null;
  buyNow: (id: string, method: "card" | "usdc") => Order | null;
  makeOffer: (id: string, amount: number, expiresInHours: number) => void;
  listFromVault: (id: string, price: number) => void;
  delist: (id: string) => void;
  requestShipping: (id: string) => void;
  /* live trade rooms */
  /** fresh replaces a settled room, e.g. when the new owner relists it */
  openTradeRoom: (listingId: string, fresh?: boolean) => void;
  postTradeMessage: (roomId: string, message: TradeMessage) => void;
  placeBid: (roomId: string, bid: TradeBid) => boolean;
  /** owner accepts a bid: the slab and the bid change hands */
  settleTrade: (roomId: string, bidId: string, note?: string) => void;
  acceptOffer: (listingId: string, offer: Offer) => void;
  fileLostReport: (roomId: string, item: LostItem, tracking: string, details: string) => LostReport;
  addComment: (listingId: string, text: string) => void;
  topUp: (amount: number) => void;
  resetDemo: () => void;
  /* derived */
  resolve: (listing: Listing) => Listing;
  isOwned: (id: string) => boolean;
  cartListings: Listing[];
  cartTotal: number;
  /* toasts */
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

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
  const [cartOpen, setCartOpen] = useState(false);
  const router = useRouter();
  const toastSeq = useRef(0);
  const pendingAction = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Hydration: localStorage does not exist during SSR, so the first client render starts
    // from EMPTY and adopts the stored state once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadState());
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

  const login = useCallback(
    (username: string, email?: string) => {
      setState((prev) => ({
        ...prev,
        user: {
          username,
          email: email ?? `${username}@example.com`,
          hue: hashString(username) % 360,
          balance: 2500,
          joinedAt: new Date().toISOString(),
        },
      }));
      setAuthOpen(false);
      pushToast({ title: `Welcome, ${username}`, tone: "success" });
      const next = pendingAction.current;
      pendingAction.current = null;
      if (next) window.setTimeout(next, 60);
    },
    [pushToast],
  );

  const logout = useCallback(() => {
    setState((prev) => ({ ...prev, user: null, cart: [] }));
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
      return {
        ...listing,
        price: o.price ?? listing.price,
        owner: o.owner ?? listing.owner,
        offers: o.extraOffers ? [...o.extraOffers, ...listing.offers].sort((a, b) => b.amount - a.amount) : listing.offers,
      };
    },
    [state.overrides],
  );

  const isOwned = useCallback(
    (id: string) => state.vault.some((v) => v.listingId === id),
    [state.vault],
  );

  const addToCart = useCallback(
    (id: string) => {
      setState((prev) =>
        prev.cart.includes(id) ? prev : { ...prev, cart: [...prev.cart, id] },
      );
      pushToast({ title: "Added to cart", tone: "success" });
      setCartOpen(true);
    },
    [pushToast],
  );

  const removeFromCart = useCallback((id: string) => {
    setState((prev) => ({ ...prev, cart: prev.cart.filter((c) => c !== id) }));
  }, []);

  const clearCart = useCallback(() => {
    setState((prev) => ({ ...prev, cart: [] }));
  }, []);

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

  const settle = useCallback(
    (ids: string[], method: "card" | "usdc"): Order | null => {
      const listings = ids
        .map((id) => getListing(id))
        .filter((l): l is Listing => Boolean(l))
        .map(resolve);
      if (!listings.length) return null;
      const subtotal = listings.reduce((sum, l) => sum + l.price, 0);
      const fee = Math.round(subtotal * 0.02 * 100) / 100;
      const total = Math.round((subtotal + fee) * 100) / 100;
      const order: Order = {
        id: `CY-${Date.now().toString(36).toUpperCase()}`,
        createdAt: new Date().toISOString(),
        listingIds: listings.map((l) => l.id),
        subtotal,
        fee,
        total,
        method,
        txHash: `0x${hashString(ids.join() + Date.now()).toString(16).padStart(8, "0").repeat(8).slice(0, 64)}`,
      };
      setState((prev) => {
        const username = prev.user?.username ?? "you";
        const overrides = { ...prev.overrides };
        for (const l of listings) {
          overrides[l.id] = {
            ...overrides[l.id],
            owner: username,
            soldTo: username,
            delisted: true,
          };
        }
        return {
          ...prev,
          overrides,
          cart: prev.cart.filter((c) => !ids.includes(c)),
          orders: [order, ...prev.orders],
          vault: [
            ...listings.map<VaultItem>((l) => ({
              listingId: l.id,
              acquiredAt: order.createdAt,
              via: "Purchase",
              status: "Vaulted",
            })),
            ...prev.vault,
          ],
          user: prev.user
            ? {
                ...prev.user,
                balance: Math.max(0, prev.user.balance - total),
              }
            : prev.user,
        };
      });
      return order;
    },
    [resolve],
  );

  const checkout = useCallback(
    (method: "card" | "usdc") => settle(state.cart, method),
    [settle, state.cart],
  );

  const buyNow = useCallback(
    (id: string, method: "card" | "usdc") => settle([id], method),
    [settle],
  );

  const makeOffer = useCallback(
    (id: string, amount: number, expiresInHours: number) => {
      const now = new Date();
      setState((prev) => {
        const offer: Offer = {
          id: `own-${id.slice(0, 6)}-${prev.offersMade.length}`,
          listingId: id,
          amount,
          from: prev.user?.username ?? "you",
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + expiresInHours * 3_600_000).toISOString(),
        };
        const prior = prev.overrides[id] ?? {};
        return {
          ...prev,
          offersMade: [offer, ...prev.offersMade],
          overrides: {
            ...prev.overrides,
            [id]: { ...prior, extraOffers: [offer, ...(prior.extraOffers ?? [])] },
          },
        };
      });
      pushToast({ title: "Offer submitted", body: "The owner has 48 hours to respond.", tone: "success" });
    },
    [pushToast],
  );

  const listFromVault = useCallback(
    (id: string, price: number) => {
      setState((prev) => ({
        ...prev,
        overrides: {
          ...prev.overrides,
          [id]: { ...prev.overrides[id], price, delisted: false },
        },
        vault: prev.vault.map((v) =>
          v.listingId === id ? { ...v, status: "Listed", listedPrice: price } : v,
        ),
      }));
      pushToast({ title: "Listed on the marketplace", tone: "success" });
    },
    [pushToast],
  );

  const delist = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        overrides: { ...prev.overrides, [id]: { ...prev.overrides[id], delisted: true } },
        vault: prev.vault.map((v) =>
          v.listingId === id ? { ...v, status: "Vaulted", listedPrice: undefined } : v,
        ),
      }));
      pushToast({ title: "Listing removed" });
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

  /* ---------------- live trade rooms ---------------- */

  const openTradeRoom = useCallback((listingId: string, fresh = false) => {
    setState((prev) => {
      if (prev.trades[listingId] && !fresh) return prev;
      const base = getListing(listingId);
      if (!base) return prev;
      const owner = prev.overrides[listingId]?.owner ?? base.owner;
      const listing = { ...base, price: prev.overrides[listingId]?.price ?? base.price };
      return {
        ...prev,
        trades: {
          ...prev.trades,
          [listingId]: seedRoom(listing, owner, Date.now(), owner === prev.user?.username),
        },
      };
    });
  }, []);

  const postTradeMessage = useCallback((roomId: string, message: TradeMessage) => {
    setState((prev) => {
      const room = prev.trades[roomId];
      if (!room || room.status !== "live") return prev;
      return {
        ...prev,
        trades: { ...prev.trades, [roomId]: { ...room, messages: [...room.messages, message] } },
      };
    });
  }, []);

  const placeBid = useCallback(
    (roomId: string, bid: TradeBid): boolean => {
      const user = state.user;
      if (!user) return false;
      if (bid.cash > user.balance) {
        pushToast({ title: "Not enough balance", body: "Lower the cash part of your bid.", tone: "error" });
        return false;
      }
      postTradeMessage(roomId, {
        id: messageId(),
        from: user.username,
        at: new Date().toISOString(),
        kind: "bid",
        bid,
      });
      return true;
    },
    [state.user, postTradeMessage, pushToast],
  );

  /**
   * Moves the slab from seller to buyer, the cash the other way, and any slabs in
   * the bid from buyer to seller. Works whichever side the signed-in user is on.
   */
  const transfer = useCallback(
    (prev: PersistShape, listingId: string, seller: string, buyer: string, bid: TradeBid): PersistShape => {
      const me = prev.user?.username ?? "you";
      const now = new Date().toISOString();
      const overrides = { ...prev.overrides };
      overrides[listingId] = { ...overrides[listingId], owner: buyer, soldTo: buyer, delisted: true };
      for (const id of bid.slabIds) {
        overrides[id] = { ...overrides[id], owner: seller, delisted: true };
      }
      let vault = prev.vault;
      let balance = prev.user?.balance ?? 0;
      if (seller === me) {
        vault = vault.filter((v) => v.listingId !== listingId);
        vault = [
          ...bid.slabIds.map<VaultItem>((id) => ({ listingId: id, acquiredAt: now, via: "Trade", status: "Vaulted" })),
          ...vault,
        ];
        balance += bid.cash;
      } else if (buyer === me) {
        vault = vault.filter((v) => !bid.slabIds.includes(v.listingId));
        vault = [{ listingId, acquiredAt: now, via: "Trade", status: "Vaulted" }, ...vault];
        balance = Math.max(0, balance - bid.cash);
      }
      return {
        ...prev,
        overrides,
        vault,
        cart: prev.cart.filter((c) => c !== listingId),
        user: prev.user ? { ...prev.user, balance: Math.round(balance * 100) / 100 } : prev.user,
      };
    },
    [],
  );

  const settleTrade = useCallback(
    (roomId: string, bidId: string, note?: string) => {
      setState((prev) => {
        const room = prev.trades[roomId];
        const bidMsg = room?.messages.find((m) => m.id === bidId);
        if (!room || room.status !== "live" || !bidMsg?.bid) return prev;
        const next = transfer(prev, room.listingId, room.seller, bidMsg.from, bidMsg.bid);
        const at = new Date().toISOString();
        const messages: TradeMessage[] = [
          ...room.messages.map((m) => (m.id === bidId ? { ...m, accepted: true } : m)),
          ...(note ? [{ id: messageId(), from: room.seller, at, kind: "text" as const, text: note }] : []),
          {
            id: messageId(),
            from: "system",
            at,
            kind: "system",
            text: `${room.seller} accepted ${bidMsg.from}'s bid. The token transferred on-chain and custody moved in the vault.`,
          },
        ];
        return {
          ...next,
          trades: {
            ...next.trades,
            [roomId]: { ...room, status: "settled", settledBidId: bidId, winner: bidMsg.from, messages },
          },
        };
      });
      pushToast({ title: "Trade settled", body: "Check your vault for the updated collection.", tone: "success" });
    },
    [transfer, pushToast],
  );

  const acceptOffer = useCallback(
    (listingId: string, offer: Offer) => {
      setState((prev) => {
        const me = prev.user?.username ?? "you";
        const next = transfer(prev, listingId, me, offer.from, { cash: offer.amount, slabIds: [] });
        const prior = next.overrides[listingId] ?? {};
        return {
          ...next,
          overrides: {
            ...next.overrides,
            [listingId]: { ...prior, extraOffers: [] },
          },
        };
      });
      pushToast({
        title: "Offer accepted",
        body: `$${offer.amount.toLocaleString()} from ${offer.from} added to your balance.`,
        tone: "success",
      });
    },
    [transfer, pushToast],
  );

  const fileLostReport = useCallback(
    (roomId: string, item: LostItem, tracking: string, details: string): LostReport => {
      const report: LostReport = {
        id: `LR-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        roomId,
        item,
        tracking,
        details,
        filedAt: new Date().toISOString(),
        status: "Under investigation",
      };
      setState((prev) => {
        const room = prev.trades[roomId];
        const note: TradeMessage = {
          id: messageId(),
          from: "system",
          at: report.filedAt,
          kind: "system",
          text: `Lost item report ${report.id} filed. The vault team is checking the custody log for this trade.`,
        };
        return {
          ...prev,
          lostReports: [report, ...prev.lostReports],
          trades: room
            ? { ...prev.trades, [roomId]: { ...room, messages: [...room.messages, note] } }
            : prev.trades,
        };
      });
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
      setState((prev) =>
        prev.user
          ? { ...prev, user: { ...prev.user, balance: prev.user.balance + amount } }
          : prev,
      );
      pushToast({ title: `Added $${amount.toLocaleString()} to balance`, tone: "success" });
    },
    [pushToast],
  );

  const resetDemo = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setState(EMPTY);
    router.push("/");
  }, [router]);

  const cartListings = useMemo(
    () =>
      state.cart
        .map((id) => getListing(id))
        .filter((l): l is Listing => Boolean(l))
        .map(resolve),
    [state.cart, resolve],
  );

  const cartTotal = useMemo(
    () => cartListings.reduce((sum, l) => sum + l.price, 0),
    [cartListings],
  );

  const value: StoreValue = {
    ...state,
    ready,
    login,
    logout,
    requireAuth,
    authOpen,
    setAuthOpen,
    addToCart,
    removeFromCart,
    clearCart,
    cartOpen,
    setCartOpen,
    toggleWatch,
    isWatched,
    checkout,
    buyNow,
    makeOffer,
    listFromVault,
    delist,
    requestShipping,
    openTradeRoom,
    postTradeMessage,
    placeBid,
    settleTrade,
    acceptOffer,
    fileLostReport,
    addComment,
    topUp,
    resetDemo,
    resolve,
    isOwned,
    cartListings,
    cartTotal,
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

/** Marketplace inventory = catalog minus anything the user took off the market. */
export function useMarketInventory(): Listing[] {
  const { overrides, resolve } = useStore();
  return useMemo(
    () => LISTINGS.filter((l) => !overrides[l.id]?.delisted).map(resolve),
    [overrides, resolve],
  );
}
