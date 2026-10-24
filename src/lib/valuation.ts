/**
 * How a slab-for-slab trade is weighed. Each slab has two numbers: the market value (what comparable
 * graded sales say it is worth, the estimate the marketplace uses) and the stated value (what its owner
 * declared when they submitted it, recorded on-chain). The collector picks which one counts for each
 * slab, and the balance below says who comes out ahead. Plain numbers in, plain numbers out, so the
 * same maths runs in the offer builder, on the offer card and in the tests.
 */

export type ValueBasis = "market" | "stated";

export interface ValuedSlab {
  tokenId: string;
  market: number;
  stated: number;
  basis: ValueBasis;
}

/** One side of a trade: the slabs a collector puts up and the cash they add. */
export interface TradeSide {
  slabs: ValuedSlab[];
  cash: number;
}

export type Verdict = "fair" | "slight" | "uneven" | "lopsided";

export interface Balance {
  /** what the viewer gives and what they get, each in dollars */
  give: number;
  get: number;
  /** get − give: positive means the viewer comes out ahead */
  net: number;
  /** |net| as a share of the bigger side, 0 to 1 */
  gap: number;
  verdict: Verdict;
  /** the viewer is the one losing out */
  against: boolean;
  /** cash that would square it up */
  evenOut: number;
}

/** A gap up to these shares of the bigger side is called fair, slightly off, uneven, or lopsided. */
export const VERDICT_LIMITS = { fair: 0.05, slight: 0.15, uneven: 0.3 } as const;

export const cents = (n: number) => Math.round(n * 100) / 100;

export function slabWorth(s: ValuedSlab, only?: ValueBasis): number {
  return (only ?? s.basis) === "market" ? s.market : s.stated;
}

export function sideWorth(side: TradeSide, only?: ValueBasis): number {
  return cents(side.slabs.reduce((sum, s) => sum + slabWorth(s, only), 0) + side.cash);
}

/**
 * The balance from the viewer's chair. `only` values every slab one way (all at market, or all at
 * stated) so a collector can check the deal against a basis the sender didn't pick.
 */
export function balance(give: TradeSide, get: TradeSide, only?: ValueBasis): Balance {
  const g = sideWorth(give, only);
  const r = sideWorth(get, only);
  const net = cents(r - g);
  const biggest = Math.max(g, r);
  const gap = biggest > 0 ? Math.abs(net) / biggest : 0;
  const verdict: Verdict =
    gap <= VERDICT_LIMITS.fair ? "fair" : gap <= VERDICT_LIMITS.slight ? "slight" : gap <= VERDICT_LIMITS.uneven ? "uneven" : "lopsided";
  return { give: g, get: r, net, gap, verdict, against: net < 0, evenOut: cents(Math.abs(net)) };
}

/** How far a stated value sits from the market value, as a signed share of the market value. */
export function statedVsMarket(s: Pick<ValuedSlab, "market" | "stated">): number {
  return s.market > 0 ? (s.stated - s.market) / s.market : 0;
}

/** A stated value more than this far from market is worth a second look. */
export const STATED_FLAG = 0.2;

export function statedFlag(s: Pick<ValuedSlab, "market" | "stated">): "high" | "low" | null {
  const d = statedVsMarket(s);
  return d > STATED_FLAG ? "high" : d < -STATED_FLAG ? "low" : null;
}
