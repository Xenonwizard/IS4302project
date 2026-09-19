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
import type { Listing, Offer, Order, VaultItem } from "./types";

const STORAGE_KEY = "cy.state.v3";

export interface SessionUser {
  username: string;
  email: string;
  hue: number;
  points: number;
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
  addPull: (listing: Listing, pack: string, cost: number) => void;
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
          points: 12_480,
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
                points: prev.user.points + Math.round(total * 10),
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

  const addPull = useCallback((listing: Listing, pack: string, cost: number) => {
    setState((prev) => {
      const username = prev.user?.username ?? "you";
      return {
        ...prev,
        overrides: {
          ...prev.overrides,
          [listing.id]: { ...prev.overrides[listing.id], owner: username, delisted: true },
        },
        vault: [
          { listingId: listing.id, acquiredAt: new Date().toISOString(), via: "Pack", status: "Vaulted" },
          ...prev.vault,
        ],
        user: prev.user
          ? {
              ...prev.user,
              balance: Math.max(0, prev.user.balance - cost),
              points: prev.user.points + Math.round(cost * 25),
            }
          : prev.user,
      };
    });
  }, []);

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
    addPull,
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
