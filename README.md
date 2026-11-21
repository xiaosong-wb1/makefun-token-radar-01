# Launch Radar — token-radar-01

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/xiaosong-wb1/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/xiaosong-wb1/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

**A pre-token protocol radar:** a farming board that ranks protocols which have no token yet by their implied value,
with an evidence dashboard and a judge-readable dossier behind every number.

Entry for the make.fun bounty [token-radar-01](https://make.fun/bounty/token-radar-01).

---

## What it does

The program reads the sealed snapshot (758 protocols, 40 on the watchlist), fits its value curve and token-odds model
on the protocols that already trade, ranks the pre-token ones by implied value, and gives each row a farm plan with a
verdict (FARM / MARGINAL / SKIP) net of fees and a T-bill benchmark.

```
main.ts                     snapshot → board.json + data.js + dashboard/ + screenshots/ + dossier.json
lib/snapshot.ts             sealed snapshot reader + strict validation
lib/stats.ts                quantiles, OLS (ridge), Gaussian elimination
lib/comps.ts                comps/value model: fit, leave-one-out, walk-forward, term ablation
lib/odds.ts                 token-odds model: shrunk base rates, leave-one-out Brier
lib/farm.ts                 farm economics: deposit, fees, hours, T-bill benchmark, verdict, steps
lib/accounting.ts           758 protocols in exactly one bucket each
lib/board.ts                row selection, ranking, implied values, ranges
lib/payload.ts              everything the page renders (one data.js)
dashboard/                  the page (index.html, app.css, app.js — no network, no framework)
screenshots/                the three screens (1440×800)
vendor/makefun-board.ts     the house dossier library, a byte-identical copy
tools/gate.mjs              local re-implementation of the 7 gate rows + determinism
```

## Run

Needs Node 22+ and the competition kit unpacked next to this repo
(`../token-radar-01-kit/input/snapshot.json`). No dependencies, no network.

```sh
# build: writes exactly what the gate reads
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

In the grader the same program runs with no arguments — it reads `/input` and writes `/output`:

```sh
node main.ts
```

## Local gate

`tools/gate.mjs` re-implements the seven pass/fail rows from the rules, plus a second run to prove the two runs write
the same bytes:

```sh
node tools/gate.mjs --out out --repo .
```

Expected output — every row passes:

```
PASS  dashboard_files
PASS  board_file
PASS  sorted_by_value
PASS  coverage
PASS  farm_steps
PASS  screenshots
PASS  dossier_matches
PASS  deterministic

8 of 8 checks pass
```

## What a run writes

| File | What it is |
| --- | --- |
| `out/board.json` | the ranked board: rank, implied value in whole dollars, farm steps on every row |
| `out/data.js` | the page's only data (`window.RADAR`), read with no network |
| `out/dashboard/` | the page itself, copied from `dashboard/` |
| `out/screenshots/` | the three screens, copied from `screenshots/` |
| `out/dossier.json` | the evidence, written last by the house library from all of the above |

Two runs write the same bytes: nothing reads a clock, a random number or a hash order.

## How the number is made

For every protocol: `implied_usd = TVL × exp(curve) × growth`, where the curve is fitted on the protocols that already
trade (`ln(mcap/TVL)` against size and time-without-token), and growth is a bounded nudge whose weight is chosen by
held-out error. Every term faces leave-one-out and walk-forward tests; a term that fails both is reported as *tested,
not kept* rather than used. Ranges (P25–P75, P10–P90) come from the out-of-sample residuals, never a bare point
estimate. See `PLAN.md` for the full model and the reasoning.

## License

MIT — see [LICENSE](LICENSE).

---

Recommended: [make.fun](https://make.fun/r/d2ns9aah)
