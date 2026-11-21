// Every protocol in the snapshot, in exactly one bucket.
//
// The #1 entry's most convincing panel was not the board: it was the bar that said where all 758 protocols went.
// A board that ranks 200 of 758 and says nothing about the other 558 cannot be checked; one that accounts for all
// 758 can. The buckets are disjoint by construction and are asserted to sum to the snapshot's own count.

import { type Protocol, type Snapshot, productRule, recordsToken } from './snapshot.ts';

/** One bucket of the accounting: an id, the label the bar prints, and the protocols in it. */
export interface Bucket {
  id: 'ranked' | 'token' | 'rule' | 'cut';
  label: string;
  why: string;
  slugs: string[];
}

/** The whole accounting: the buckets, the total, and whether they add up. */
export interface Accounting {
  total: number;
  buckets: Bucket[];
  reconciles: boolean;
  watchlist_ranked: number;
  watchlist_total: number;
}

/**
 * Bucket every protocol, in this order: one whose record carries a token; one the board ranks; one the house's
 * own reading of the watchlist rule keeps out (a wrapped, staked or bridged product, an exchange's own, a
 * versioned pool); and one that is pre-token but below the board's cut. `ranked` is the set of slugs the board's
 * rows name.
 */
export function accountFor(snapshot: Snapshot, ranked: ReadonlySet<string>): Accounting {
  const token: string[] = [];
  const on: string[] = [];
  const rule: string[] = [];
  const cut: string[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) {
      token.push(p.slug);
      continue;
    }
    if (ranked.has(p.slug)) {
      on.push(p.slug);
      continue;
    }
    if (productRule(p) !== null) {
      rule.push(p.slug);
      continue;
    }
    cut.push(p.slug);
  }
  const buckets: Bucket[] = [
    {
      id: 'ranked',
      label: 'ranked on the board',
      why: 'records no token, is not a wrapped or staked product, and the board values it',
      slugs: on,
    },
    {
      id: 'token',
      label: 'the record already carries a token',
      why: 'a symbol or a CoinGecko id: the launch the radar looks for has happened, so the market prices it, not the model',
      slugs: token,
    },
    {
      id: 'rule',
      label: 'out by the house’s own rule',
      why: 'a bridge, liquid staking or CEX category, a versioned name, a wrapped or staked product, or an exchange’s own protocol',
      slugs: rule,
    },
    {
      id: 'cut',
      label: 'pre-token, below the board’s cut',
      why: 'records no token and passes the rule, but sits under the size the board carries: the radar names it, it does not rank it',
      slugs: cut,
    },
  ];
  const total = buckets.reduce((n, b) => n + b.slugs.length, 0);
  const watchlistRanked = snapshot.watchlist.filter((slug) => ranked.has(slug)).length;
  return {
    total,
    buckets,
    reconciles: total === snapshot.protocols.length,
    watchlist_ranked: watchlistRanked,
    watchlist_total: snapshot.watchlist.length,
  };
}

/** Why one protocol is not on the board, in the words the detail view prints; null when it is on it. */
export function whyNotRanked(p: Protocol, ranked: ReadonlySet<string>): string | null {
  if (ranked.has(p.slug)) return null;
  if (recordsToken(p)) return `its record already carries a token (${p.symbol ?? p.gecko_id ?? 'priced'}), so the market values it`;
  const rule = productRule(p);
  if (rule !== null) return `a product of a token that already trades: ${rule}`;
  return 'pre-token and covered by the radar, but under the size the board ranks';
}
