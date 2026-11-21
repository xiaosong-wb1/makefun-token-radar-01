// The token-odds model: how often a protocol's record ends up carrying a token.
//
// A pre-token protocol is not a promise of a launch. The snapshot does show, for every protocol that already has
// one, that its record carries a token, so the peers' own record is the only evidence the file holds: the share
// that carries one, by size band and by category, shrunk toward the overall base rate so a band with three
// protocols cannot claim a rate of its own.
//
// The wording the rules ask for is used everywhere: a protocol *records* no token, never that it has none, and a
// protocol on the watchlist may still carry a token its DefiLlama record does not show.

import { type Protocol, type Snapshot, recordsToken } from './snapshot.ts';
import { round } from './stats.ts';

/** A size band: the lower edge in dollars (inclusive) and the name the page prints. */
export interface Band {
  id: string;
  label: string;
  floor: number;
}

export const BANDS: Band[] = [
  { id: 'a', label: '$5M–$25M', floor: 5_000_000 },
  { id: 'b', label: '$25M–$100M', floor: 25_000_000 },
  { id: 'c', label: '$100M–$500M', floor: 100_000_000 },
  { id: 'd', label: '$500M–$2B', floor: 500_000_000 },
  { id: 'e', label: '$2B+', floor: 2_000_000_000 },
];

/** The band a TVL falls in; the smallest band below $5M, which the snapshot does not carry, would be `a`. */
export function bandOf(tvl: number): Band {
  let found = BANDS[0]!;
  for (const band of BANDS) if (tvl >= band.floor) found = band;
  return found;
}

/** The Beta prior's weight: a band's own record moves the rate only as far as its size earns it. */
const PRIOR = 4;

/** A count of protocols and how many of them carry a token. */
interface Counts {
  n: number;
  k: number;
}

const tally = (counts: Map<string, Counts>, key: string, token: boolean): void => {
  const at = counts.get(key) ?? { n: 0, k: 0 };
  at.n += 1;
  if (token) at.k += 1;
  counts.set(key, at);
};

/** A shrunk rate: this group's record, pulled toward `base` by the prior's weight. */
function shrink(group: Counts | undefined, base: number): number {
  const n = group?.n ?? 0;
  const k = group?.k ?? 0;
  return (k + base * PRIOR) / (n + PRIOR);
}

/** One row of the calibration table: a predicted-odds bucket and what the field's record actually did. */
export interface CalibrationRow {
  bucket: string;
  predicted: number;
  actual: number;
  n: number;
}

/** The whole odds model: its rates, its Brier score and what the page prints. */
export interface OddsModel {
  base_rate: number;
  brier: number;
  brier_floor: number;
  by_band: { id: string; label: string; n: number; k: number; rate: number }[];
  by_category: { category: string; n: number; k: number; rate: number }[];
  calibration: CalibrationRow[];
}

/** The odds one protocol's record carries a token, under the fitted rates. */
export function oddsOf(model: OddsModel, p: Protocol): number {
  const band = model.by_band.find((b) => b.id === bandOf(p.tvl_usd).id);
  const category = p.category === null ? null : model.by_category.find((c) => c.category === p.category);
  const bandRate = band === undefined ? model.base_rate : band.rate;
  const catRate = category === undefined || category === null ? model.base_rate : category.rate;
  return Math.min(0.97, Math.max(0.03, 0.5 * bandRate + 0.5 * catRate));
}

/**
 * Fit the odds and score them leave-one-out: each protocol is predicted from every other protocol's record, so
 * the Brier score is out of sample. `brier_floor` is the same score for the constant base rate, which is the
 * number a model has to beat to be worth printing at all.
 */
export function fitOdds(snapshot: Snapshot): OddsModel {
  const all = snapshot.protocols;
  const bandCounts = new Map<string, Counts>();
  const catCounts = new Map<string, Counts>();
  let token = 0;
  for (const p of all) {
    const has = recordsToken(p);
    if (has) token += 1;
    tally(bandCounts, bandOf(p.tvl_usd).id, has);
    if (p.category !== null) tally(catCounts, p.category, has);
  }
  const base = all.length === 0 ? 0 : token / all.length;

  const rateFor = (counts: Map<string, Counts>, key: string | null, base_: number): number =>
    key === null ? base_ : shrink(counts.get(key), base_);

  // Leave-one-out: subtract the protocol from its own two groups, then predict it and score the miss.
  let brier = 0;
  let floor = 0;
  const buckets = new Map<string, { n: number; sum: number; hits: number }>();
  for (const p of all) {
    const band = bandOf(p.tvl_usd).id;
    const b = { ...(bandCounts.get(band) ?? { n: 0, k: 0 }) };
    const has = recordsToken(p);
    b.n -= 1;
    if (has) b.k -= 1;
    const c = p.category === null ? null : { ...(catCounts.get(p.category) ?? { n: 0, k: 0 }) };
    if (c !== null) {
      c.n -= 1;
      if (has) c.k -= 1;
    }
    const baseWithout = (token - (has ? 1 : 0)) / Math.max(1, all.length - 1);
    const bandRate = shrink(b, baseWithout);
    const catRate = c === null ? baseWithout : shrink(c, baseWithout);
    const predicted = Math.min(0.97, Math.max(0.03, 0.5 * bandRate + 0.5 * catRate));
    const actual = has ? 1 : 0;
    brier += (predicted - actual) ** 2;
    floor += (baseWithout - actual) ** 2;
    const bucket = `${Math.min(9, Math.floor(predicted * 10) * 1) / 10}–${Math.min(10, Math.floor(predicted * 10) / 10 + 0.1)}`;
    const at = buckets.get(bucket) ?? { n: 0, sum: 0, hits: 0 };
    at.n += 1;
    at.sum += predicted;
    at.hits += actual;
    buckets.set(bucket, at);
  }

  return {
    base_rate: round(base, 4),
    brier: round(brier / Math.max(1, all.length), 4),
    brier_floor: round(floor / Math.max(1, all.length), 4),
    by_band: BANDS.map((band) => {
      const c = bandCounts.get(band.id) ?? { n: 0, k: 0 };
      return { id: band.id, label: band.label, n: c.n, k: c.k, rate: round(shrink(c, base), 4) };
    }),
    by_category: [...catCounts.entries()]
      .map(([category, c]) => ({ category, n: c.n, k: c.k, rate: round(shrink(c, base), 4) }))
      .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1))
      .slice(0, 12),
    calibration: [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([bucket, v]) => ({
        bucket,
        predicted: round(v.sum / v.n, 3),
        actual: round(v.hits / v.n, 3),
        n: v.n,
      })),
  };
}

/** The odds one protocol carried a token, without the clamp: what the calibration table sums. */
export const RAW = (rate: number): number => Math.min(0.97, Math.max(0.03, rate));
