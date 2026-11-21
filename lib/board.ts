// The board: which protocols the radar ranks, what each is worth, and what to do about it.
//
// The watchlist is the floor, never the ceiling. Every slug on it is ranked, whatever the model thinks of it,
// because coverage is a gate row and a radar that drops the protocols the house named is not the radar asked
// for. Below it the board adds the early rows — pre-token protocols under the watchlist's floor, by TVL — which
// is the part of the job the owner actually asked for: finding a launch before it is obvious.

import { ageDays, type Protocol, type Snapshot, productRule, recordsNoToken } from './snapshot.ts';
import {
  GROWTH,
  fitComps,
  growthMultiplier,
  nearestPeers,
  pricedPeers,
  valueOf,
  type CompsModel,
  type Peer,
} from './comps.ts';
import { fitOdds, oddsOf, type OddsModel } from './odds.ts';
import { farmPlan, stepText, type FarmPlan, type Verdict } from './farm.ts';
import { round } from './stats.ts';

/** How many pre-token protocols below the watchlist's floor the early radar carries, by TVL. */
export const EARLY_ROWS = 170;

/** The smallest board the gate takes, and the largest. */
export const MIN_ROWS = 100;
export const MAX_ROWS = 4_000;

/** One term's share of a row's multiple, for the detail view's line-by-line arithmetic. */
export interface TermShare {
  id: string;
  label: string;
  source: string;
  beta: number;
  x: number;
  multiplier: number;
}

/** A priced peer beside the row: its name, its multiple and its TVL. */
export interface PeerLine {
  name: string;
  slug: string;
  multiple: number;
  tvl_usd: number;
  category: string | null;
}

/** One ranked protocol, everything the page prints about it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  odds_pct: number;
  implied_usd: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  multiple: number;
  intercept_multiplier: number;
  terms: TermShare[];
  verdict: Verdict;
  net_usd: number;
  usd_per_hour: number;
  deposit_usd: number;
  hold_days: number;
  hours: number;
  why: string;
  steps: string[];
  peers: PeerLine[];
  on_watchlist: boolean;
}

/** One row of board.json: the gate's required fields, then the evidence for them. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  token_odds: number;
  implied_range_usd: { p10: number; p25: number; p75: number; p90: number };
  verdict: Verdict;
  net_usd: number;
  usd_per_hour: number;
  deposit_usd: number;
  on_watchlist: boolean;
}

/** The protocols the board ranks: the whole watchlist, then the early pre-token ones under the floor. */
export function selectProtocols(snapshot: Snapshot): Protocol[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter(
      (p) =>
        !chosen.has(p.slug) &&
        recordsNoToken(p) &&
        productRule(p) === null &&
        p.tvl_usd < snapshot.floor_usd,
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  // The gate takes no board under 100 rows: past the early rows, keep filling from the next largest pre-token
  // protocols the rule allows, so the board never depends on the watchlist's size alone.
  if (chosen.size < MIN_ROWS) {
    for (const p of snapshot.protocols) {
      if (chosen.size >= MIN_ROWS) break;
      if (chosen.has(p.slug) || !recordsNoToken(p) || productRule(p) !== null) continue;
      chosen.set(p.slug, p);
    }
  }
  return [...chosen.values()];
}

/** The whole board, ranked by implied value, with each row's plan and evidence. */
export function buildBoard(
  snapshot: Snapshot,
  comps: CompsModel = fitComps(snapshot),
  odds: OddsModel = fitOdds(snapshot),
): { board: BoardRow[]; rows: RadarRow[]; comps: CompsModel; odds: OddsModel } {
  const asOf = snapshot.as_of;
  const peers = pricedPeers(snapshot);
  const selected = selectProtocols(snapshot);

  interface Scored {
    p: Protocol;
    valuation: ReturnType<typeof valueOf>;
    odds: number;
    plan: FarmPlan;
  }

  const scored: Scored[] = selected.map((p) => {
    const valuation = valueOf(comps, p, asOf);
    const tokenOdds = oddsOf(odds, p);
    return { p, valuation, odds: tokenOdds, plan: farmPlan(p, asOf, valuation.implied_usd, tokenOdds) };
  });

  scored.sort(
    (a, b) =>
      b.valuation.implied_usd - a.valuation.implied_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const watchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = scored.map((s, i) => {
    const terms: TermShare[] = comps.core.map((term, at) => {
      const beta = comps.beta[at + 1] ?? 0;
      const x = term.value(s.p, asOf);
      return {
        id: term.id,
        label: term.label,
        source: term.source,
        beta: round(beta, 6),
        x: round(x, 6),
        multiplier: round(Math.exp(beta * x), 4),
      };
    });
    // The growth nudge is applied outside the log-linear curve, so its multiplier is the whole of its effect.
    terms.push({
      id: 'growth',
      label: GROWTH.label,
      source: GROWTH.source,
      beta: comps.growth_weight,
      x: round(GROWTH.value(s.p, asOf), 6),
      multiplier: round(growthMultiplier(s.p, comps.growth_weight), 4),
    });
    const inline = (peer: Peer): PeerLine => ({
      name: peer.protocol.name,
      slug: peer.protocol.slug,
      multiple: round(peer.multiple, 3),
      tvl_usd: peer.protocol.tvl_usd,
      category: peer.protocol.category,
    });
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: ageDays(asOf, s.p.listed_at),
      listed_at: s.p.listed_at,
      odds_pct: round(s.odds * 100, 1),
      implied_usd: s.valuation.implied_usd,
      p25_usd: s.valuation.p25_usd,
      p75_usd: s.valuation.p75_usd,
      p10_usd: s.valuation.p10_usd,
      p90_usd: s.valuation.p90_usd,
      multiple: round(s.valuation.multiple, 3),
      intercept_multiplier: round(Math.exp(comps.intercept), 4),
      terms,
      verdict: s.plan.verdict,
      net_usd: round(s.plan.net_usd, 0),
      usd_per_hour: round(s.plan.usd_per_hour, 0),
      deposit_usd: s.plan.deposit_usd,
      hold_days: s.plan.hold_days,
      hours: s.plan.hours,
      why: s.plan.why,
      steps: s.plan.step_texts,
      peers: nearestPeers(peers, s.p, 5).map(inline),
      on_watchlist: watchlist.has(s.p.slug),
    };
  });

  const board: BoardRow[] = rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    implied_value_usd: r.implied_usd,
    farm_steps: r.steps,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    listed_at: r.listed_at,
    token_odds: r.odds_pct / 100,
    implied_range_usd: { p10: r.p10_usd, p25: r.p25_usd, p75: r.p75_usd, p90: r.p90_usd },
    verdict: r.verdict,
    net_usd: r.net_usd,
    usd_per_hour: r.usd_per_hour,
    deposit_usd: r.deposit_usd,
    on_watchlist: r.on_watchlist,
  }));

  return { board, rows, comps, odds };
}

/** The gate's own conditions on a board, as text the program prints before it writes anything. */
export function boardIssue(board: readonly BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < MIN_ROWS || board.length > MAX_ROWS) return `the board holds ${board.length} rows, not 100 to 4,000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} while being worth more`;
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
  }
  return null;
}

/** The board's mix of verdicts: how many of how many are worth farming. */
export function verdictMix(rows: readonly RadarRow[]): Record<Verdict, number> {
  const mix: Record<Verdict, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of rows) mix[r.verdict] += 1;
  return mix;
}

/** Every step string the page and the board share, trimmed and held to the gate's 20..600 characters. */
export const stepsOf = (plan: FarmPlan): string[] => plan.steps.map(stepText);
