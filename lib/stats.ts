// Small numerical kit: quantiles, a ridge least-squares fit, and the scoring helpers the evidence tables use.
// No dependency, no randomness, no clock: two runs of the program compute the same bytes.

/** `values` sorted ascending, as a new array (the input is left alone). */
export function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** The quantile of `values` at `q` in [0,1] by linear interpolation between the neighbouring order statistics. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const xs = sorted(values);
  if (xs.length === 1) return xs[0]!;
  const at = Math.min(1, Math.max(0, q)) * (xs.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(xs.length - 1, lo + 1);
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (at - lo);
}

/** The median. */
export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** The arithmetic mean, NaN on an empty list. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** A least-squares fit: coefficients for `design` (rows of features, intercept included) against `y`. */
export interface Fit {
  beta: number[];
}

/**
 * Ridge least squares by the normal equations, solved with partial-pivoted elimination.
 *
 * `design` holds one row per observation, its first entry the constant 1. `ridge` is added to every diagonal
 * but the intercept's, which is what keeps a collinear pair of features (two chains counts that move together)
 * from making the system singular; it shrinks those coefficients toward zero instead of failing.
 */
export function ridgeFit(design: readonly (readonly number[])[], y: readonly number[], ridge: number): Fit {
  const rows = design.length;
  const cols = rows === 0 ? 0 : design[0]!.length;
  if (rows === 0 || y.length !== rows) throw new Error('ridgeFit: no observations');
  const xtx: number[][] = Array.from({ length: cols }, () => new Array<number>(cols).fill(0));
  const xty: number[] = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    const x = design[r]!;
    if (x.length !== cols) throw new Error('ridgeFit: a design row is the wrong length');
    for (let i = 0; i < cols; i++) {
      xty[i]! += x[i]! * y[r]!;
      for (let j = 0; j < cols; j++) xtx[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 1; i < cols; i++) xtx[i]![i]! += ridge;
  return { beta: solve(xtx, xty) };
}

/** The value of one fitted row: beta · x. */
export function applyFit(fit: Fit, x: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < fit.beta.length; i++) sum += fit.beta[i]! * (x[i] ?? 0);
  return sum;
}

/** Solve `A x = b` by elimination with partial pivoting; throws when the matrix is singular. */
function solve(A: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const m: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error('solve: the system is singular');
    if (pivot !== col) {
      const swap = m[pivot]!;
      m[pivot] = m[col]!;
      m[col] = swap;
    }
    const lead = m[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / lead;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= m[r]![c]! * x[c]!;
    x[r] = sum / m[r]![r]!;
  }
  return x;
}

/** A multiplicative miss: `exp(median |ln(predicted / actual)|)`, the factor by which the model is wrong. */
export function medianMiss(ratios: readonly number[]): number {
  return Math.exp(median(ratios.map((r) => Math.abs(Math.log(r)))));
}

/** The share of observations whose actual value fell inside [low, high], in per cent. */
export function insideShare(inside: readonly boolean[]): number {
  if (inside.length === 0) return Number.NaN;
  return (100 * inside.filter(Boolean).length) / inside.length;
}

/** Round to `places` decimals, for the numbers a page prints. */
export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** `n` as a whole number of dollars, never negative, never above the gate's ceiling. */
export function dollars(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(100_000_000_000_000, Math.round(n)));
}
