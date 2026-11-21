// What to do about a protocol: the farm plan and its verdict, net of everything that costs money or time.
//
// The point of the verdict is that it says no. A board on which every row is worth farming is a board that has not
// done the arithmetic: a launch's value is shared among everyone who farms it, the deposit is locked for months,
// the fees are paid on the way in and on the way out, and the capital could have sat in a Treasury bill instead.
// So each row carries the expected value of farming it, minus its costs, minus the T-bill it forgoes, and a
// verdict — FARM only when the net beats both the T-bill benchmark and $25 an hour of hands-on time.

import { ageDays, type Protocol } from './snapshot.ts';
import { dollars, round } from './stats.ts';

/** The rate a deposit forgoes while it is locked: the one-year T-bill the page names. */
export const TBILL_RATE = 0.041;
/** What an hour of hands-on time has to be worth for a plan to be worth doing. */
export const HOURLY_BAR = 25;
/** The share of a launch's implied value that goes to the protocols' own farmers. */
export const FARMER_SHARE = 0.05;
/** The capital farming one protocol, as a share of its TVL: a bigger protocol draws a bigger crowd. */
export const CROWD_PER_TVL = 0.0004;
/** The smallest crowd a per-protocol farm is read against, in dollars: a small protocol still has farmers. */
export const CROWD_FLOOR_USD = 1_000_000;

export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** A farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One protocol's farm plan: what it expects to return, what it costs, and the verdict on both. */
export interface FarmPlan {
  deposit_usd: number;
  hold_days: number;
  weeks: number;
  hours: number;
  gas_usd: number;
  bridge_usd: number;
  slippage_usd: number;
  opportunity_usd: number;
  costs_usd: number;
  expected_usd: number;
  net_usd: number;
  usd_per_hour: number;
  benchmark_usd: number;
  verdict: Verdict;
  why: string;
  steps: FarmStep[];
  step_texts: string[];
}

/** The first chain a protocol counts its TVL on, or a neutral phrase when it names none. */
function chainOf(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The gas one opening and one closing transaction costs on that chain, in dollars. */
function gasFor(p: Protocol): number {
  const chain = chainOf(p).toLowerCase();
  if (chain.includes('ethereum')) return 55;
  if (chain.includes('solana')) return 2;
  if (chain.includes('base') || chain.includes('arbitrum') || chain.includes('optimism')) return 6;
  return 9;
}

/** The deposit a position needs to be counted: a larger protocol has more capital sharing the same launch. */
function depositFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 400;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 60;
}

/** How long a position has to stay open for the activity to be counted more than once, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: Protocol, deposit: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral') || c.includes('cdp')) {
    return `Supply $${deposit} of USDC to ${name} on ${chain} and borrow a stable against it`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('basis') || c.includes('farm')) {
    return `Provide $${deposit} of two-sided liquidity to ${name}'s deepest pool on ${chain}`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) {
    return `Deposit $${deposit} of USDC into a ${name} vault on ${chain} and keep the vault shares`;
  }
  if (c.includes('rwa')) {
    return `Mint $${deposit} of ${name}'s yield asset on ${chain} and hold it through the period`;
  }
  if (c.includes('restak') || c.includes('staking') || c.includes('chain')) {
    return `Stake $${deposit} of the chain's own asset through ${name} on ${chain} and keep the receipt`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${deposit} of the stable asset through ${name} on ${chain}`;
  }
  if (c.includes('insurance')) {
    return `Buy $${deposit} of cover from ${name} on ${chain} and keep the policy open`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${deposit} of USDC as margin on ${name} and keep one small position open`;
  }
  return `Deposit $${deposit} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's farm plan and verdict, from its own record: the deposit its size implies, the hold its age implies,
 * the launch's implied value, and the odds its record carries a token.
 */
export function farmPlan(p: Protocol, asOf: string, impliedUsd: number, tokenOdds: number): FarmPlan {
  const age = ageDays(asOf, p.listed_at);
  const deposit = depositFor(p.tvl_usd);
  const holdDays = holdDaysFor(age);
  const weeks = Math.max(2, Math.round(holdDays / 7));
  const chain = chainOf(p);
  const gas = gasFor(p);
  const bridge = p.chains.length > 1 ? 12 : 0;
  const slippage = round(deposit * 0.004, 2);
  const opportunity = round(((deposit * TBILL_RATE) / 365) * holdDays, 2);
  const costs = round(gas + bridge + slippage + opportunity, 2);

  const farmerPool = impliedUsd * FARMER_SHARE;
  const crowd = Math.max(deposit, CROWD_FLOOR_USD, p.tvl_usd * CROWD_PER_TVL);
  const share = Math.min(0.5, deposit / crowd);
  const expected = round(farmerPool * share * tokenOdds, 2);

  const hours = round(1.5 + 0.3 * weeks + 0.75, 2);
  const net = round(expected - costs, 2);
  const perHour = round(net / hours, 2);
  const benchmark = round(((deposit * TBILL_RATE) / 365) * holdDays, 2);

  let verdict: Verdict = 'SKIP';
  let why: string;
  if (net > benchmark && perHour >= HOURLY_BAR) {
    verdict = 'FARM';
    why = `$${net} net beats the $${benchmark} T-bill on the same deposit and clears $${HOURLY_BAR}/hour at $${perHour}/hour`;
  } else if (net > 0) {
    verdict = 'MARGINAL';
    why =
      net <= benchmark
        ? `$${net} net does not beat the $${benchmark} the deposit earns in a T-bill over ${holdDays} days`
        : `$${net} net is positive but $${perHour}/hour is under the $${HOURLY_BAR} hour bar`;
  } else {
    why = `the plan costs $${Math.abs(net)} more than the launch's ${Math.round(tokenOdds * 100)}% odds return on it`;
  }

  const steps: FarmStep[] = [
    {
      action: `Create a wallet used only for this farm, fund it with $${deposit} plus gas, and store the seed phrase offline.`,
      cost: `$${deposit} of capital, of which $${gas} is gas`,
      time: '20 minutes',
    },
    {
      action: `${actionFor(p, deposit, chain)}, then record the transaction and the position size in a farm log.`,
      cost: `$${slippage} of slippage on the entry${bridge > 0 ? ` and $${bridge} to bridge` : ''}`,
      time: '30 minutes to open',
    },
    {
      action: `Do one qualifying action every week on ${p.name}: a small deposit, a borrow, a swap or a governance vote.`,
      cost: `about $${gas / 4} of gas a week`,
      time: '15 minutes a week',
    },
    {
      action: `Keep the position open for ${holdDays} days so ${weeks} weekly snapshots count it, and never move the funds out early.`,
      cost: `$${opportunity} of T-bill interest given up over ${holdDays} days`,
      time: `${holdDays} days`,
    },
    {
      action: `Before claiming anything, open ${p.name}'s own page and check that the rewards page it links is the one the protocol publishes.`,
      cost: 'no fee: a claim that asks for a signature or a fee is not a real claim',
      time: '15 minutes',
    },
    {
      action: `Unwind the position after the launch, log the fees paid and compare the result with the $${benchmark} the deposit would have earned in a T-bill.`,
      cost: `$${gas} of gas to exit and $${slippage} of slippage`,
      time: '45 minutes',
    },
  ];

  return {
    deposit_usd: deposit,
    hold_days: holdDays,
    weeks,
    hours,
    gas_usd: gas,
    bridge_usd: bridge,
    slippage_usd: slippage,
    opportunity_usd: opportunity,
    costs_usd: costs,
    expected_usd: expected,
    net_usd: net,
    usd_per_hour: perHour,
    benchmark_usd: benchmark,
    verdict,
    why,
    steps,
    step_texts: steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`),
  };
}

/** One step as the board's string: its action, its cost and its time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let text = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Record it in the farm log.`;
  return text;
}

/** A verdict's colour role, so the page and the board agree on what each one means. */
export const VERDICT_ORDER: Record<Verdict, number> = { FARM: 0, MARGINAL: 1, SKIP: 2 };

/** The whole-dollar figure a row prints for its expected net, never a float. */
export const netDollars = (plan: FarmPlan): number => dollars(plan.net_usd);
