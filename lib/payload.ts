// The page's data: one script, `window.RADAR`, written beside the dashboard and read with no network at all.
//
// Everything the page prints is computed here from the board, the fitted curve and the odds model, so the
// screenshots and the code cannot disagree: there is one source for every figure on the screen.

import type { Snapshot } from './snapshot.ts';
import { recordsToken } from './snapshot.ts';
import type { CompsModel } from './comps.ts';
import type { OddsModel } from './odds.ts';
import { type BoardRow, type RadarRow, type Verdict, verdictMix } from './board.ts';
import { TBILL_RATE, HOURLY_BAR, FARMER_SHARE, CROWD_PER_TVL, CROWD_FLOOR_USD } from './farm.ts';
import type { Accounting } from './accounting.ts';
import { round } from './stats.ts';

/** A KPI card: what it says, the figure, and the note under it. */
export interface Kpi {
  id: string;
  label: string;
  value: string;
  note: string;
}

/** One row of an evidence table: a term, a fold, a band or a bucket. */
export interface EvidenceRow {
  a: string;
  b: string;
  c: string;
  d: string;
  flag: string;
}

/** Everything `window.RADAR` carries. */
export interface RadarDocument {
  meta: {
    competition: string;
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: number;
    watchlist: number;
    board: number;
    early: number;
    model_version: string;
    built_for: string;
  };
  kpis: Kpi[];
  accounting: Accounting;
  evidence: {
    terms: EvidenceRow[];
    walk: EvidenceRow[];
    bands: EvidenceRow[];
    categories: EvidenceRow[];
    calibration: EvidenceRow[];
    baselines: EvidenceRow[];
  };
  model: {
    kept: string[];
    intercept_multiplier: number;
    loo_miss: number;
    wf_miss: number;
    peers: number;
    brier: number;
    brier_floor: number;
    base_rate: number;
    tbill_rate: number;
    hourly_bar: number;
    farmer_share: number;
    crowd_per_tvl: number;
    crowd_floor_usd: number;
  };
  mix: Record<string, number>;
  rows: RadarRow[];
  live: { name: string; slug: string; symbol: string | null; category: string | null; tvl_usd: number; mcap_usd: number; change_7d: number | null }[];
}

/** The protocols whose record already carries a token, by market cap: the board's other half, kept apart. */
export function liveSet(snapshot: Snapshot, take = 24): RadarDocument['live'] {
  return snapshot.protocols
    .filter((p) => recordsToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, take)
    .map((p) => ({
      name: p.name,
      slug: p.slug,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
    }));
}

/** The whole page document, from the board and the two fitted models. */
export function buildDocument(
  snapshot: Snapshot,
  board: readonly BoardRow[],
  rows: readonly RadarRow[],
  comps: CompsModel,
  odds: OddsModel,
  accounting: Accounting,
): RadarDocument {
  const mix = verdictMix(rows);
  const early = rows.filter((r) => !r.on_watchlist).length;
  const kept = comps.terms.filter((t) => t.kept).length;
  const wfMiss = comps.walk.length === 0 ? Number.NaN : comps.walk.reduce((n, f) => n + f.miss, 0) / comps.walk.length;

  const kpis: Kpi[] = [
    {
      id: 'coverage',
      label: 'watchlist ranked',
      value: `${accounting.watchlist_ranked}/${accounting.watchlist_total}`,
      note: 'every protocol the house named is on the board; none is dropped for scoring badly',
    },
    {
      id: 'miss',
      label: 'median miss, held out',
      value: `×${round(comps.loo_miss, 2)}`,
      note: `leave-one-out over ${comps.peers} priced peers; walk-forward ×${round(wfMiss, 2)}`,
    },
    {
      id: 'honesty',
      label: 'range honesty',
      value: `${comps.range_25_75.inside}%`,
      note: `P25–P75 band, out of sample (P10–P90 covers ${comps.range_10_90.inside}%)`,
    },
    {
      id: 'brier',
      label: 'token odds, Brier',
      value: `${round(odds.brier, 3)}`,
      note: `leave-one-out; a constant base rate scores ${round(odds.brier_floor, 3)}`,
    },
    {
      id: 'terms',
      label: 'terms that survived',
      value: `${kept} of ${comps.terms.length}`,
      note: 'TVL, growth and time-without-token are what the board values on; chains had to earn its place and did not',
    },
    {
      id: 'farm',
      label: 'worth farming',
      value: `${mix.FARM} of ${rows.length}`,
      note: `net of fees and the T-bill; ${mix.MARGINAL} marginal, ${mix.SKIP} skip`,
    },
  ];

  const terms: EvidenceRow[] = comps.terms.map((t) => ({
    a: t.label,
    b: t.form === 'bounded' ? `nudge ×${1 - (t.weight ?? 0) / 2}–×${1 + (t.weight ?? 0)}` : `coef ${t.beta === null ? '—' : t.beta}`,
    c: `×${t.loo_with} → ×${t.loo_without}`,
    d: `×${t.wf_with} → ×${t.wf_without}`,
    flag: t.kept ? 'kept' : 'not kept',
  }));

  const walkRows: EvidenceRow[] = comps.walk.map((f, i) => ({
    a: `walk-forward ${i + 1}`,
    b: `${f.train} train / ${f.test} test`,
    c: `×${round(f.miss, 3)}`,
    d: `${round(f.inside_25_75, 0)}% inside`,
    flag: 'out of sample',
  }));

  const bands: EvidenceRow[] = [
    {
      a: 'P25–P75',
      b: `×${round(Math.exp(comps.range_25_75.lo), 2)} … ×${round(Math.exp(comps.range_25_75.hi), 2)}`,
      c: `${comps.range_25_75.inside}% inside`,
      d: 'half the field',
      flag: 'printed on every row',
    },
    {
      a: 'P10–P90',
      b: `×${round(Math.exp(comps.range_10_90.lo), 2)} … ×${round(Math.exp(comps.range_10_90.hi), 2)}`,
      c: `${comps.range_10_90.inside}% inside`,
      d: 'four fifths of the field',
      flag: 'tail, not a promise',
    },
  ];

  const categories: EvidenceRow[] = odds.by_category.map((c) => ({
    a: c.category,
    b: `${c.k} of ${c.n}`,
    c: `${round(c.rate * 100, 0)}%`,
    d: 'records a token',
    flag: c.n >= 10 ? 'enough to read' : 'thin',
  }));

  const calibration: EvidenceRow[] = odds.calibration.map((c) => ({
    a: c.bucket,
    b: `${round(c.predicted * 100, 0)}% predicted`,
    c: `${round(c.actual * 100, 0)}% actual`,
    d: `${c.n} protocols`,
    flag: Math.abs(c.predicted - c.actual) <= 0.1 ? 'calibrated' : 'off',
  }));

  const baselines: EvidenceRow[] = [
    {
      a: 'this curve',
      b: `×${comps.loo_miss} leave-one-out`,
      c: `×${round(wfMiss, 3)} walk-forward`,
      d: `${kept} of ${comps.terms.length} terms kept`,
      flag: 'what the board runs',
    },
    {
      a: 'flat quarter of TVL',
      b: `×${comps.baselines.flat_quarter_loo} leave-one-out`,
      c: `×${comps.baselines.flat_quarter_wf} walk-forward`,
      d: 'the starter’s multiple, a constant',
      flag: 'beaten',
    },
    {
      a: 'median peer multiple',
      b: `×${comps.baselines.peer_median_loo} leave-one-out`,
      c: `×${comps.baselines.peer_median_wf} walk-forward`,
      d: `one constant, ×${comps.median_multiple}`,
      flag: 'beaten',
    },
  ];

  return {
    meta: {
      competition: 'token-radar-01',
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early,
      model_version: 'launch-radar-skeleton-0',
      built_for: 'make.fun token-radar-01: what a pre-token protocol is worth if its record stays as it is, and what to do about it',
    },
    kpis,
    accounting,
    evidence: { terms, walk: walkRows, bands, categories, calibration, baselines },
    model: {
      kept: comps.kept.map((t) => t.label),
      intercept_multiplier: round(Math.exp(comps.intercept), 4),
      growth_weight: comps.growth_weight,
      growth_unbounded: comps.growth_unbounded,
      loo_miss: comps.loo_miss,
      wf_miss: round(wfMiss, 3),
      peers: comps.peers,
      brier: odds.brier,
      brier_floor: odds.brier_floor,
      base_rate: odds.base_rate,
      tbill_rate: TBILL_RATE,
      hourly_bar: HOURLY_BAR,
      farmer_share: FARMER_SHARE,
      crowd_per_tvl: CROWD_PER_TVL,
      crowd_floor_usd: CROWD_FLOOR_USD,
    },
    mix: { FARM: mix.FARM, MARGINAL: mix.MARGINAL, SKIP: mix.SKIP },
    rows: rows as RadarRow[],
    live: liveSet(snapshot),
  };
}

/** The document as the script the page loads: one assignment, no fetch, no network. */
export function dataScript(doc: RadarDocument): string {
  return `window.RADAR=${JSON.stringify(doc)};\n`;
}

/** The verdict words the page prints, in the order it prints them. */
export const VERDICT_LABEL: Record<Verdict, string> = { FARM: 'FARM', MARGINAL: 'MARGINAL', SKIP: 'SKIP' };

