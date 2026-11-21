# PLAN — token-radar-01 ("Launch Radar")

Status: build plan + runnable skeleton (no submission, no keypair, no API key used).
Kit unpacked at `~/workspace/makefun/token-radar-01-kit/`, entry repo at `~/workspace/makefun/token-radar-bot/`.

---

## 0. The facts the plan is built on

| Item | Value | Source |
| --- | --- | --- |
| Competition | `token-radar-01`, opens 2026-11-14T10:00:00Z | `RULES.txt`, `competition.yaml` |
| Deadline | **2026-12-14T10:00:00Z** (18:00 CST); escrow entry list 2026-12-14T10:10:00Z | `RULES.txt` §Payout, §The escrow |
| Prize | 1st **$1,000**, 2nd–5th $50, 6th–10th $25 (total $1,325, USDC on Solana, escrowed) | `RULES.txt` §Rewards |
| Quota | 5 submissions/UTC-day, **10 per account in all**; last submission before the deadline is the entry (`Force_Last`) | `RULES.txt` §Submitting |
| Field (dev, 2026-11-21 pull) | 23,105 submissions, 15,384 ranked; #1 `kiencx` 966,767, #2 964,424, #10 960,454, #50 953,929, median 863,170; only 11 entries ≥960k | `winners-research.md` §6 |
| Runtime | Node 22 (grader 22.23.4), `main.ts` at repo root, stdlib only, **no network**, 1 CPU / 1024 MB / 120 s, read-only `/bot`, writable `/output` | `RULES.txt` §Submitting |
| Determinism | the program runs **twice**, both runs must write the same bytes | `RULES.txt` §Submitting |
| Input | `/input/snapshot.json`: 758 protocols ≥$5M TVL, 40 on the watchlist, floor $50M, `as_of` 2026-11-14 | `input/README.md` |

What the #1 entry showed (from the judged artifact, described in `winners-research.md` §6 — the images themselves
cannot be read in this session, only their description): a dark **terminal-style dashboard**, not a pretty table —
6 KPI cards of *out-of-sample* numbers (×2.53 median miss, 57%/76% range honesty, Brier 0.215, "2 of 6 · 4 of 5 terms
survived both tests", "14 of 198 worth farming", "40/40 watchlist ranked"); a **protocol-accounting bar** (758 in
exactly one bucket: 198 ranked / 416 already token / 144 out by house rules …); an **out-of-sample evidence** section
(leave-one-out + walk-forward tables, term by term: kept / tested-not-kept / must-not-help); a board carrying TVL, 7D,
no-token age, token odds, implied value with a P25–P75 range and a **verdict FARM / MARGINAL / SKIP with net-of-fees $
and $/hour**; a detail view showing *how the number is made* line by line, nearest priced peers, and a 10-step farm
plan with cost and time per step; and an integrity strip that recomputes `board.json` in the browser
(checksum, totals, "198 of 198 rows recomputed here").

Take-away: **the judge picks the dashboard that looks most trustworthy, and trust is shown as evidence, not as
ranking.** A board with no visible validation is the median (863k).

---

## 1. How the score is actually made (and what to optimise)

Entry → gate (7 pass/fail rows) → judge heat → Bradley–Terry win rate over the shortlist → place.

1. **Gate first (§The gate).** All seven rows must pass or the entry is 0 and takes nothing. They are mechanical;
   the skeleton already aims at all seven and `tools/gate.mjs` re-checks them locally.
2. **Judge rubric, in priority order (RULES §The judge).**
   1. *A working radar*: board covers every watchlist slug, ranks pre-token protocols by a stated implied value,
      screenshots and code agree. "A screen with no data or code behind it counts for nothing."
   2. *The value model*: implied value follows from **the snapshot's own figures — TVL, 7-day growth, time without a
      token — not a hardcoded list of names**; the board separates token-bearing protocols from pre-token ones.
   3. *Farm plans*: concrete steps **with cost and time**, not slogans.
   4. *The page*: sortable, filterable, readable at a glance, a detail view per protocol.
   5. *It looks made*: chosen palette, consistent spacing, readable type, no pasted framework.
3. **The heat (§Heats/Ranking).** Each game = 2 judge calls (both slot orders); a call gives 0.5 + margin/10; a game's
   score is the mean of both calls; the entry with >0.5 wins the game. Rates are fitted over the shortlist plus four
   fixed house anchors, whose calibrated strengths are **1-weak 0.014, 2-plain 0.593 (= the starter's own dashboard),
   3-mid 0.782, 4-strong 1.081**, and dev rungs r1 1.565 / r2 2.310 / r3 3.253 (`competition.yaml` calibration).
   So: the starter sits at 0.593; the money is above 4-strong (1.081) — every visible piece of evidence is aimed at
   beating the anchors on rubric items 1–3, because those are what the pair-wise judge reads first.
4. **Screen (§Heats).** At the deadline the dev rating screens the field at place 40
   (`max(4 × last paid place, 32)` = 40) on interval lows. A dev rating must exist and be good enough; this is why
   iterating *with submissions* early matters, not only a good final artifact.
5. **Grade cost model.** Dev grade ≈ 2 runs + gate + 12 games (24 judge calls). 5 submissions/day → budget them: one
   "structure" submission early, then evidence/model iterations, final one at the end.

**What that means for effort allocation:** rubric 1 and 2 are most of the variance and they are exactly where the #1
beat the field (out-of-sample tables, term survival, odds with Brier, ranges). So the build order below is
evidence-model first, page second — but the page must look like a terminal report, not a table.

---

## 2. Deliverables (what "done" means)

Repo (`token-radar-bot/`) = an entry repo:

```
main.ts                     program: snapshot → board.json + data.js + dashboard/ + screenshots/ + dossier.json
lib/snapshot.ts             sealed snapshot reader + strict validation
lib/stats.ts                quantiles, OLS (ridge), Gaussian elimination
lib/comps.ts                comps/value model: fit, leave-one-out, walk-forward, term ablation
lib/odds.ts                 token-odds model: shrunk base rates, leave-one-out Brier
lib/farm.ts                 farm economics: deposit, fees, hours, T-bill benchmark, verdict, steps
lib/accounting.ts           758 protocols in exactly one bucket each
lib/board.ts                row selection, ranking, implied values, ranges
lib/payload.ts              everything the page renders (one data.js)
dashboard/index.html|app.css|app.js   the page (no network, no framework)
screenshots/1-board.png|2-detail.png|3-filtered.png   1440×800, 300–350 KB each
vendor/makefun-board.ts     the house dossier library, byte-identical copy
tools/gate.mjs              local re-implementation of the 7 gate rows + determinism + size checks
LICENSE                     MIT (needed at submit; add before entering)
```

`/output` written by a run: `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`.
Run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json`.

---

## 3. The value model (rubric item 2 — the main differentiator)

Fit on the **128 priced peers** (protocols whose record carries a market cap over a positive TVL):
`multiple = mcap / TVL`, so the same function that values a pre-token protocol also explains every protocol that
already trades.

```
ln(multiple) = b0 + b_size·ln(TVL/$100M) + b_age·ln(1 + days listed/365) [+ b_chains·ln(chains), optional]
growth       = 1 + w·clamp(change_7d, -50%, +100%)/100        # a bounded nudge, w fitted 0…0.35
implied_usd  = TVL × exp(curve) × growth                      # whole dollars, $1 … $1e14
```

- **Not** a name list: every input is one of the snapshot's ten fields; one code path scores every row.
- **Growth is a bounded nudge, and that is a decision with a reason.** Fitted free, the growth coefficient comes out
  near **−3.8**: a priced protocol whose TVL just jumped has a *lower* multiple at the same market cap, which is
  mechanical (the lift is in the denominator), and reading that back would value the fastest-growing pre-token
  protocol as the one worth least. So growth's weight `w` is chosen by **held-out error** over a grid a valuation
  can defend (0 leaves it out, 0.35 is a third of the move; it picked **0.20** → ×0.90…×1.20), and the unbounded
  coefficient is printed beside it in the evidence table. That is "fit, don't assert" with the work shown.
- **Every term goes to two tests**: leave-one-out over the peers, and walk-forward (train on the peers listed
  earliest, read on the ones listed after: 60% and 80% cuts). TVL, growth and time-without-token are the board's
  definition and always stay; the optional term (chains) has to earn its place on both tests or it is reported as
  *tested, not kept*. Today: **3 of 4 kept**, chains dropped.
- **Ranges, never a point estimate**: the leave-one-out residual quantiles give every row a P25–P75 and P10–P90 band,
  and the page prints both with what they actually covered out of sample.
- **Token odds** (`lib/odds.ts`): the rate a protocol's *record carries* a token, by TVL band and category, shrunk
  to the base rate with a Beta(2,2)-weight prior, scored leave-one-out by **Brier**. Wording per the rules: a
  protocol *records* no token, never that it has none.
- **Baselines on the same peers**: flat 0.25×TVL and the median peer multiple, both scored the same way — the page
  prints its own curve against them so the fit has to justify itself.

Measured on the shipped snapshot (2026-11-14, 758 protocols, 128 priced peers):

| figure | value |
| --- | --- |
| median miss, leave-one-out | **×3.51** (walk-forward ×3.10 / ×2.83, ×3.40 by fold) |
| range honesty, P25–P75 (out of sample) | **50%** (P10–P90: 80%) |
| token-odds Brier (leave-one-out) | **0.231** vs 0.248 for a constant base rate |
| baselines | flat 0.25×TVL ×4.89 loo / ×4.03 wf; median multiple ×4.86 loo / ×4.69 wf |

## 4. Farm verdicts (rubric item 3)

Per row, net of everything, and honest about how few qualify:

```
farmer_pool   = implied_value_usd × 5%                    (the share of a launch that goes to its farmers)
crowd         = max($1M, TVL × 0.04%)                     (the capital farming the same launch)
our_share     = deposit / (deposit + crowd)               capped at 50%
expected_usd  = farmer_pool × our_share × token_odds
costs_usd     = gas (chain-dependent) + bridge + 2×0.4% slippage + opportunity cost at the 4.1% T-bill
net_usd       = expected_usd − costs_usd
hours         = 1.5 + 0.3×weeks + 0.75
verdict       = FARM      if net_usd > the T-bill on the same deposit and net_usd/hours ≥ $25
                MARGINAL  if net_usd > 0 but below either bar
                SKIP      otherwise
```

`farm_steps` is generated from the protocol's own record (category → the action, chains → where, TVL tier → deposit,
age → hold length): 6 steps, each carrying its **cost and time**, each 20–600 characters. Today the mix is
**6 FARM / 67 MARGINAL / 104 SKIP** of 177 rows — "everything is a great farm" reads as naive, and this board does
not say it.

## 5. The page (rubric items 4–5)

One dark terminal-style report, three screens:

1. **Board** — 6 KPI cards (watchlist ranked 40/40, median miss ×N, range honesty, Brier, terms kept, how many worth
   farming), the **accounting bar** (758 protocols in exactly one bucket, counts summing visibly to 758), then the
   table: rank, protocol, TVL, 7D, no-token age, odds, implied value + P25–P75, verdict, net $, $/hour.
2. **Detail** (click a row) — the arithmetic line by line (TVL × multiple × terms), the nearest priced peers, and the
   full farm plan with per-step cost and time.
3. **Filtered** — chain/category/verdict/search filters and sort, with the filter state visible in the shot.

Constraints baked in: no `http(s)` in any attribute value, CSS or JS import; whole dashboard source **< 64 KB** so the
dossier shows every file whole; data in `../data.js` (`window.RADAR`) so the source text stays small.

---

## 6. Build steps (each ends with a command and an exit test)

| # | Step | Exit test |
| --- | --- | --- |
| 0 | Kit unpacked, rules read, winners' pattern extracted | this file |
| 1 | `lib/snapshot.ts` + `lib/stats.ts` | `node -e` load of the real snapshot parses; stats unit spot-checks |
| 2 | `lib/comps.ts` fit + LOO + walk-forward + ablation | prints median miss and range honesty on the 144 peers; a "starter" (TVL×0.25) scores worse |
| 3 | `lib/odds.ts` | Brier printed; odds monotone in TVL band |
| 4 | `lib/accounting.ts` | buckets sum to exactly 758, watchlist ⊆ ranked |
| 5 | `lib/farm.ts` | verdict mix is mostly SKIP/MARGINAL; a few FARM |
| 6 | `lib/board.ts` + `main.ts` | writes `out/board.json`, `out/data.js`, copies dashboard + screenshots, writes `dossier.json` |
| 7 | `dashboard/` page | renders offline from `data.js`; the three screens exist |
| 8 | screenshots | `tools/gate.mjs` rows `screenshots` + `dossier_matches` pass |
| 9 | local gate | `node tools/gate.mjs --out out` → 7/7 pass, twice-run byte-identical |
| 10 | iterate on the judge rubric (evidence tables, plan quality, page polish) | judged submissions improve; 5/day budget |

Skeleton status: steps 1–9 are implemented in this repo and pass (`node tools/gate.mjs --out out --repo .` →
**8 of 8**, including determinism); step 10 is the remaining work.

---

## 7. Local acceptance (why there is no `grade-local` here)

`makefun grade-local` for a judge competition needs the **house's competition directory** (its sealed scorer,
`reference/gate.json` and the judge prompt/anchors) — the public kit ships only `harness/harness-src.tar.gz`, which
holds `grader/`, `sim/`, `contracts/` and not `scorer/score.ts`. `RULES.txt` says it plainly: "There is no local grade
of this competition: the server grades every entry."

So the skeleton ships **`tools/gate.mjs`**, a faithful re-implementation of the seven gate rows from `RULES.txt`
(dashboard files + no-network scan, board rows, sorted_by_value, watchlist coverage, farm steps, screenshot
PNG/JPEG dimension and size checks, and `dossier_matches` by rebuilding the dossier with the vendored library and
comparing bytes), plus a double run to prove determinism:

```
node tools/gate.mjs --out out --repo .   ->   8 of 8 pass, dossier bytes equal, second run identical
```

It was checked against broken outputs too (a dropped watchlist row fails `coverage` and `sorted_by_value`; one
byte appended to `dossier.json` fails `dossier_matches`; an `https://` in `app.css` fails `dashboard_files`), so the
checks are not vacuous. The screenshots are taken from the page itself — the MCP browser refuses `file://` and
cannot reach this machine's loopback, so the kit's own recipe is used instead: the Playwright Chromium binary at
`~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome` renders the page over a throwaway local static server,
at 1440×800, once per screen (`/`, `#detail/yuzu-money`, `?chain=Solana`).

---

## 8. Compliance checklist before submitting (not done yet)

- [ ] New public GitHub repo **created after 2026-11-14T10:00:00Z**, MIT `LICENSE`, `.makefun/owner.json`
      `{"wallet": "..."}` if the repo owner is not the GitHub login on the account.
- [ ] Built **in a recorded agent session that started after the competition opened** (this session qualifies:
      its work is the code in this repo, and no code was pasted in from anywhere).
- [ ] Transcripts: `node cli/makefun.mjs bundle --repo . --out transcripts.tar.gz …` — every session that worked on
      the entry, plus system prompt, instruction files, MCP list (`playwright`), run record; then
      `check --kit token-radar-01-kit --repo . --transcripts transcripts.tar.gz`.
- [ ] README badges (`/badge/token-radar-01.svg`, `…/<owner>/<repo>/rank.svg`, `…/reward.svg`), GitHub About with a
      make.fun website + topic `makefun`.
- [ ] Entry signed with a wallet linked to the account; **≤10 submissions total** — so submissions are budgeted.
- [ ] No secrets in the repo or transcripts; no network access from `main.ts`.

---

## 9. Risks / red lines

- **Determinism**: no `Date.now()`, no randomness, no map-order dependence in `main.ts` output (runs are compared byte
  for byte). Clock-free by construction here.
- **Coverage is a gate row**: all 40 watchlist slugs must appear even if the model dislikes them; rank is the model's
  claim, so they can sit low.
- **All-equal implied values is refused** — the model must genuinely separate rows.
- **Dossier text cap**: dashboard source must stay < 64 KB or the judge reads a cut source (pages past it lose).
- **Screenshots**: 3–4, 300–350 KB each, 1440 long side / ≥800 short side, whole PNG/JPEG.
- **Do not** special-case protocol names, do not copy another entry's files (tier-1 `thinking_own_work` failure), do
  not touch the network, do not touch keypairs/API keys in this phase.

---

## 10. What is missing to finish (next step)

1. **Model work.** Sharpen the comps curve (category-level multiples, the "went live" back-test: did the board rank
   a protocol before its token appeared?), and tighten the odds model beyond one Brier point over the base rate.
2. **Page work.** The three screens render and agree with the data, but the visual design is a first pass: the KPI
   strip, the accounting bar and the evidence tables are the trust surface and deserve another iteration.
3. **Submission plumbing, none of it done here on purpose.** MIT `LICENSE`; `.makefun/owner.json` if the GitHub
   owner is not the account's login; a new public repository created after 2026-11-14T10:00:00Z; README badges and
   the GitHub About; the transcript bundle (`makefun bundle`) with the run record, instruction files and the MCP
   server list; then `makefun check` and `submit`. **No keypair, no API key and no submission was used in this
   phase**, by instruction.
4. **Budget the 10 submissions**: first one once the page is right, then model iterations, last one near
   2026-12-14T10:00:00Z (the last submission before the deadline is the entry).
