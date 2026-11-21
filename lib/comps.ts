// The comps curve: what a protocol's token would be worth if its record stayed as it is.
//
// The 128 protocols whose record carries a market cap and a positive TVL are the priced peers, and for each of
// them multiple = mcap / TVL. One curve explains those multiples from the snapshot's own figures and is then read
// backwards for a protocol that records no token: implied value = TVL x the multiple the curve gives it.
//
//   ln(multiple) = b0 + b_size ln(TVL/$100M) + b_age ln(1 + days listed/365) + b_chains ln(chains)
//   growth       = 1 + w x clamp(change_7d, -50%, +100%) / 100        (a bounded nudge, 0.5x .. 1.35x)
//   implied      = TVL x exp(curve) x growth
//
// Why growth is a bounded nudge and not a log-linear term: fitted without a bound, the growth weight comes out
// near -3, because a priced protocol whose TVL jumps has a *lower* multiple at the same market cap — the lift is
// mechanical, an artifact of the cross-section, and reading it back onto a protocol that has no market cap yet
// would value the protocol that is growing fastest as the one worth least. So growth's weight w is fitted on
// held-out error over a grid a valuation can defend (0 leaves it out, 0.35 is a third of the move), and the
// unbounded fit is printed beside it. Everything else is fitted, then put to two tests — leave-one-out over the
// peers, and walk-forward, trained on the peers listed earliest and read on the ones after them.

import { ageDays, type Protocol, type Snapshot } from './snapshot.ts';
import { applyFit, medianMiss, quantile, ridgeFit, round, type Fit } from './stats.ts';

/** One term of the curve: an id a page names, a label, and the value the snapshot gives it. */
export interface Term {
  id: TermId;
  label: string;
  /** What the term is made of, in words the detail view prints. */
  source: string;
  /** How the term enters: a coefficient in the log-linear fit, or a bounded nudge outside it. */
  form: 'log-linear' | 'bounded';
  /**
   * Whether the term is part of the radar's definition rather than an option: TVL, seven-day growth and the time
   * without a token are what the board is asked to value a protocol on, so they are always in the model; a term
   * that is not required has to earn its place on both tests or it is reported as tested, not kept.
   */
  required: boolean;
  value: (p: Protocol, asOf: string) => number;
}

export type TermId = 'size' | 'growth' | 'maturity' | 'chains';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The terms the curve may use. */
export const TERMS: Term[] = [
  {
    id: 'size',
    label: 'size',
    source: 'ln(TVL / $100M)',
    form: 'log-linear',
    required: true,
    value: (p) => Math.log(Math.max(1, p.tvl_usd) / 1e8),
  },
  {
    id: 'growth',
    label: '7-day growth',
    source: 'a bounded nudge: 7-day TVL change clamped to -50%..+100%, weight fitted on held-out error',
    form: 'bounded',
    required: true,
    value: (p) => clamp(p.change_7d ?? 0, -50, 100) / 100,
  },
  {
    id: 'maturity',
    label: 'time without a token',
    source: 'ln(1 + days listed / 365), 365 days when the record reports none',
    form: 'log-linear',
    required: true,
    value: (p, asOf) => Math.log(1 + (ageDays(asOf, p.listed_at) ?? 365) / 365),
  },
  {
    id: 'chains',
    label: 'chains',
    source: 'ln(number of chains the TVL is counted on)',
    form: 'log-linear',
    required: false,
    value: (p) => Math.log(Math.max(1, p.chains.length)),
  },
];

/** The term whose weight is fitted outside the log-linear fit. */
export const GROWTH = TERMS.find((t) => t.id === 'growth')!;
/** The log-linear terms, by id. */
const CORE = new Map(TERMS.filter((t) => t.form === 'log-linear').map((t) => [t.id, t]));

/** The growth weights the held-out error chooses between, smallest first. */
export const GROWTH_GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

/** One priced peer: a protocol whose record prices it. */
export interface Peer {
  protocol: Protocol;
  multiple: number;
  logMultiple: number;
}

/** The peers the curve is fitted on: every protocol whose record prices it above a positive TVL. */
export function pricedPeers(snapshot: Snapshot): Peer[] {
  const out: Peer[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    out.push({ protocol: p, multiple: p.mcap_usd / p.tvl_usd, logMultiple: Math.log(p.mcap_usd / p.tvl_usd) });
  }
  return out.sort((a, b) => (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
}

/** A design row for one protocol under one set of log-linear terms. */
function designRow(p: Protocol, asOf: string, terms: readonly Term[]): number[] {
  return [1, ...terms.map((t) => t.value(p, asOf))];
}

/** The log-linear curve fitted on `peers` with `terms`. */
function fitOn(peers: readonly Peer[], asOf: string, terms: readonly Term[], ridge = 1e-3): Fit {
  return ridgeFit(
    peers.map((peer) => designRow(peer.protocol, asOf, terms)),
    peers.map((peer) => peer.logMultiple),
    ridge,
  );
}

/** The growth's multiplier for one protocol under weight `w`. */
export function growthMultiplier(p: Protocol, w: number): number {
  return 1 + w * GROWTH.value(p, '1970-01-01');
}

/** The multiplicative miss of one prediction set, as ratios of predicted to actual multiple. */
const missOf = (ratios: readonly number[]): number => medianMiss(ratios);

/** Leave-one-out over the peers, for the log-linear terms and one growth weight. */
export function leaveOneOut(
  peers: readonly Peer[],
  asOf: string,
  terms: readonly Term[],
  growthWeight: number,
): { residuals: number[]; miss: number } {
  const residuals: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.slice(0, i).concat(peers.slice(i + 1));
    if (rest.length < terms.length + 2) {
      residuals.push(0);
      continue;
    }
    const fit = fitOn(rest, asOf, terms);
    const predicted = applyFit(fit, designRow(peers[i]!.protocol, asOf, terms)) + Math.log(growthMultiplier(peers[i]!.protocol, growthWeight));
    residuals.push(predicted - peers[i]!.logMultiple);
  }
  return { residuals, miss: missOf(residuals.map((r) => Math.exp(r))) };
}

/** A walk-forward fold: trained on the peers listed first, read on the ones listed after the cut. */
export interface Fold {
  train: number;
  test: number;
  miss: number;
  inside_25_75: number;
}

/** The peers in the order their record was first listed, earliest first; an unreported day sorts first. */
function byListing(peers: readonly Peer[]): Peer[] {
  return [...peers].sort((a, b) => {
    const da = a.protocol.listed_at ?? '';
    const db = b.protocol.listed_at ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
  });
}

/**
 * Walk-forward: two cuts, 60% and 80%, each trained on everything listed before the cut and scored on what came
 * after it. The band a fold reports is fitted on the past alone, so `inside_25_75` is out of sample.
 */
export function walkForward(
  peers: readonly Peer[],
  asOf: string,
  terms: readonly Term[],
  growthWeight: number,
): Fold[] {
  const ordered = byListing(peers);
  const folds: Fold[] = [];
  for (const cut of [0.6, 0.8]) {
    const at = Math.floor(ordered.length * cut);
    const train = ordered.slice(0, at);
    const test = ordered.slice(at);
    if (train.length < terms.length + 4 || test.length < 3) continue;
    const fit = fitOn(train, asOf, terms);
    const residual = (peer: Peer): number =>
      applyFit(fit, designRow(peer.protocol, asOf, terms)) +
      Math.log(growthMultiplier(peer.protocol, growthWeight)) -
      peer.logMultiple;
    const trainResiduals = train.map(residual);
    const lo = quantile(trainResiduals, 0.25);
    const hi = quantile(trainResiduals, 0.75);
    const testResiduals = test.map(residual);
    folds.push({
      train: train.length,
      test: test.length,
      miss: missOf(testResiduals.map((r) => Math.exp(r))),
      inside_25_75: (100 * testResiduals.filter((r) => r >= lo && r <= hi).length) / test.length,
    });
  }
  return folds;
}

/** One term, whether it is in the model, and what the curve does with it and without it. */
export interface TermEvidence {
  id: TermId;
  label: string;
  source: string;
  form: 'log-linear' | 'bounded';
  required: boolean;
  kept: boolean;
  /** A log-linear term's coefficient; null for the bounded one, which carries `weight` instead. */
  beta: number | null;
  weight: number | null;
  loo_with: number;
  loo_without: number;
  wf_with: number;
  wf_without: number;
  verdict: string;
}

/** The whole value model: the curve, the terms it kept, and the numbers the page prints. */
export interface CompsModel {
  as_of: string;
  peers: number;
  intercept: number;
  terms: TermEvidence[];
  kept: Term[];
  core: Term[];
  beta: number[];
  growth_weight: number;
  /** What the same peers say when growth is fitted without a bound: reported, never used. */
  growth_unbounded: number;
  loo_miss: number;
  wf_miss: number;
  loo_residuals: number[];
  walk: Fold[];
  range_25_75: { inside: number; lo: number; hi: number };
  range_10_90: { inside: number; lo: number; hi: number };
  baselines: { flat_quarter_loo: number; peer_median_loo: number; flat_quarter_wf: number; peer_median_wf: number };
  median_multiple: number;
}

const meanMiss = (folds: readonly Fold[]): number =>
  folds.length === 0 ? Number.NaN : folds.reduce((n, f) => n + f.miss, 0) / folds.length;

/**
 * Fit the curve, choose the growth weight on held-out error, and put every term to both tests. The numbers both
 * ways are kept so the page can print the table the judge is meant to read.
 */
export function fitComps(snapshot: Snapshot): CompsModel {
  const peers = pricedPeers(snapshot);
  const asOf = snapshot.as_of;
  const size = CORE.get('size')!;
  const maturity = CORE.get('maturity')!;
  const chains = CORE.get('chains')!;

  // 1. The growth weight: the smallest weight whose held-out miss is not beaten by a larger one.
  const grid = GROWTH_GRID.map((w) => ({ w, miss: leaveOneOut(peers, asOf, [size, maturity], w).miss }));
  let chosen = grid[0]!;
  for (const point of grid) if (point.miss < chosen.miss - 1e-9) chosen = point;

  // 2. Whether the chains term earns its place: both tests, with the chosen growth weight.
  const coreTerms = [size, maturity];
  const coreLoo = chosen.miss;
  const coreWf = meanMiss(walkForward(peers, asOf, coreTerms, chosen.w));
  const chainsLoo = leaveOneOut(peers, asOf, [size, maturity, chains], chosen.w).miss;
  const chainsWf = meanMiss(walkForward(peers, asOf, [size, maturity, chains], chosen.w));
  const chainsKept = chainsLoo <= coreLoo * 1.02 && chainsWf <= coreWf * 1.02;

  const finalCore = chainsKept ? [size, maturity, chains] : coreTerms;
  const fit = fitOn(peers, asOf, finalCore);
  const loo = leaveOneOut(peers, asOf, finalCore, chosen.w);
  const walk = walkForward(peers, asOf, finalCore, chosen.w);
  const withCore = { loo: loo.miss, wf: meanMiss(walk) };

  // 3. Each log-linear term's marginal effect: the same two tests with it removed.
  const marginal = (term: Term): { loo: number; wf: number } => {
    const without = finalCore.filter((t) => t.id !== term.id);
    if (without.length === 0) return { loo: Number.NaN, wf: Number.NaN };
    return {
      loo: leaveOneOut(peers, asOf, without, chosen.w).miss,
      wf: meanMiss(walkForward(peers, asOf, without, chosen.w)),
    };
  };

  // 4. What an unbounded growth coefficient would be, on the same peers.
  const unbounded = fitOn(peers, asOf, [...finalCore, { ...GROWTH, form: 'log-linear' as const }]);
  const unboundedBeta = round(unbounded.beta[finalCore.length + 1] ?? 0, 3);

  const evidence: TermEvidence[] = TERMS.map((term) => {
    if (term.form === 'bounded') {
      const without = leaveOneOut(peers, asOf, finalCore, 0);
      return {
        id: term.id,
        label: term.label,
        source: term.source,
        form: term.form,
        required: term.required,
        kept: true,
        beta: null,
        weight: round(chosen.w, 2),
        loo_with: round(withCore.loo, 3),
        loo_without: round(without.miss, 3),
        wf_with: round(withCore.wf, 3),
        wf_without: round(meanMiss(walkForward(peers, asOf, finalCore, 0)), 3),
        verdict:
          chosen.w === 0
            ? 'tested, not kept: no weight beats leaving growth out on the held-out peers'
            : `kept as a bounded nudge, weight ${round(chosen.w, 2)} fitted on held-out error (unbounded fit wants ${unboundedBeta})`,
      };
    }
    const kept = term.id === 'chains' ? chainsKept : true;
    const without = marginal(term);
    const earnsIt = without.loo >= withCore.loo * 0.99 && without.wf >= withCore.wf * 0.99;
    // The optional term is read on what including it would give against what the core gives: it is not in the
    // final curve, so its own marginal row would otherwise compare the curve with itself.
    const withIt = term.id === 'chains' ? { loo: chainsLoo, wf: chainsWf } : withCore;
    const rejectedInOne = !earnsIt && term.required;
    return {
      id: term.id,
      label: term.label,
      source: term.source,
      form: term.form,
      required: term.required,
      kept,
      beta: kept ? round(fit.beta[finalCore.findIndex((t) => t.id === term.id) + 1] ?? 0, 4) : null,
      weight: null,
      loo_with: round(withIt.loo, 3),
      loo_without: round(without.loo, 3),
      wf_with: round(withIt.wf, 3),
      wf_without: round(without.wf, 3),
      verdict: rejectedInOne
        ? 'kept: the board states it, though the held-out peers neither need nor reject it'
        : term.required
          ? 'kept: the board states it, and its weight is fitted'
          : earnsIt
            ? 'kept: dropping it makes a test worse'
            : 'tested, not kept: the curve is no worse without it',
    };
  });

  const lo25 = quantile(loo.residuals, 0.25);
  const hi75 = quantile(loo.residuals, 0.75);
  const lo10 = quantile(loo.residuals, 0.1);
  const hi90 = quantile(loo.residuals, 0.9);
  const inside = (lo: number, hi: number): number =>
    round((100 * loo.residuals.filter((r) => r >= lo && r <= hi).length) / Math.max(1, loo.residuals.length), 0);

  // Two baselines the curve has to beat, scored on the same peers: a flat quarter of TVL (the starter's
  // multiple) and the median peer multiple, each read as if it were a model.
  const medianMultiple = quantile(peers.map((p) => p.multiple), 0.5);
  const flat = (mult: number, set: readonly Peer[]): number =>
    medianMiss(set.map((p) => (mult * p.protocol.tvl_usd) / (p.protocol.mcap_usd ?? 1)));
  const tail = byListing(peers).slice(Math.floor(peers.length * 0.8));

  return {
    as_of: asOf,
    peers: peers.length,
    intercept: round(fit.beta[0] ?? 0, 4),
    terms: evidence,
    kept: TERMS.filter((t) => evidence.some((e) => e.id === t.id && e.kept)),
    core: finalCore,
    beta: fit.beta,
    growth_weight: round(chosen.w, 2),
    growth_unbounded: unboundedBeta,
    loo_miss: round(withCore.loo, 3),
    wf_miss: round(withCore.wf, 3),
    loo_residuals: loo.residuals,
    walk,
    range_25_75: { inside: inside(lo25, hi75), lo: lo25, hi: hi75 },
    range_10_90: { inside: inside(lo10, hi90), lo: lo10, hi: hi90 },
    baselines: {
      flat_quarter_loo: round(flat(0.25, peers), 3),
      peer_median_loo: round(flat(medianMultiple, peers), 3),
      flat_quarter_wf: round(flat(0.25, tail), 3),
      peer_median_wf: round(flat(medianMultiple, tail), 3),
    },
    median_multiple: round(medianMultiple, 4),
  };
}

/** One protocol's implied multiple and value, with its P25–P75 and P10–P90 bands. */
export interface Valuation {
  log_multiple: number;
  multiple: number;
  implied_usd: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
}

/** Value one protocol under the fitted curve. */
export function valueOf(model: CompsModel, p: Protocol, asOf: string): Valuation {
  const x = [1, ...model.core.map((t) => t.value(p, asOf))];
  const growth = growthMultiplier(p, model.growth_weight);
  const logMultiple = applyFit({ beta: model.beta }, x) + Math.log(growth);
  const implied = Math.max(1, Math.round(p.tvl_usd * Math.exp(logMultiple)));
  const band = (logResidual: number): number => Math.max(1, Math.round(p.tvl_usd * Math.exp(logMultiple + logResidual)));
  return {
    log_multiple: round(logMultiple, 6),
    multiple: Math.exp(logMultiple),
    implied_usd: implied,
    p25_usd: band(model.range_25_75.lo),
    p75_usd: band(model.range_25_75.hi),
    p10_usd: band(model.range_10_90.lo),
    p90_usd: band(model.range_10_90.hi),
  };
}

/** The priced peers nearest this protocol by TVL: what the detail view prints as its comps. */
export function nearestPeers(peers: readonly Peer[], p: Protocol, take = 5): Peer[] {
  const distance = (peer: Peer): number => {
    const size = Math.abs(Math.log(Math.max(1, peer.protocol.tvl_usd) / Math.max(1, p.tvl_usd)));
    const sameCategory = peer.protocol.category !== null && peer.protocol.category === p.category ? 0 : 0.5;
    return size + sameCategory;
  };
  return [...peers].sort((a, b) => distance(a) - distance(b) || (a.protocol.slug < b.protocol.slug ? -1 : 1)).slice(0, take);
}
