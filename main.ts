// Launch Radar: what a pre-token protocol is worth if its record stays as it is, and what to do about it.
//
// The program reads the sealed snapshot, fits its value curve and its token-odds model on the protocols that
// already trade, ranks the pre-token ones by implied value, gives each a farm plan with a verdict, and writes
// what the bounty's gate reads:
//
//   /output/board.json     the ranked board (100 to 4,000 rows, ranks 1..N, farm steps on every row)
//   /output/data.js        the page's only data: `window.RADAR`, read with no network
//   /output/dashboard/     the page itself, copied from this repository
//   /output/screenshots/   the three screenshots, copied from this repository
//   /output/dossier.json   the evidence the judge reads, written by the house library last, from all of the above
//
// Two runs write the same bytes: nothing here reads a clock, a random number or a hash order.
//
//   node main.ts                                   (in the grader: /input and /output)
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, SnapshotError } from './lib/snapshot.ts';
import { buildBoard, boardIssue } from './lib/board.ts';
import { accountFor } from './lib/accounting.ts';
import { buildDocument, dataScript } from './lib/payload.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The scorer's caps (reference/gate.json): the text cap shapes the bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
/** A screenshot's name, as a dossier accepts it. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const here = fileURLToPath(new URL('.', import.meta.url));

/** `--name value` or `--name=value` out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  const message = err instanceof SnapshotError ? err.message : String(err);
  process.stderr.write(`launch radar: the snapshot is not one this model can score: ${message}\n`);
  process.exit(2);
}

// Fit and rank. The value curve tests its own terms before the board is built, so a term the evidence does not
// support is never in a number the page prints.
const { board, rows, comps, odds } = buildBoard(snapshot);
const ranked = new Set(board.map((r) => r.slug));
const accounting = accountFor(snapshot, ranked);
if (!accounting.reconciles) {
  process.stderr.write(`launch radar: the accounting does not reconcile: ${accounting.total} of ${snapshot.protocols.length}\n`);
  process.exit(1);
}
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: the board is not one the gate takes: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(buildDocument(snapshot, board, rows, comps, odds, accounting)));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `launch radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares the bytes.
try {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOTS, dashboard: DASHBOARD }),
  );
} catch (err) {
  process.stderr.write(`launch radar: the dossier could not be written: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const farm = rows.filter((r) => r.verdict === 'FARM').length;
const kept = comps.terms.filter((t) => t.kept).map((t) => t.label).join(', ');
process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${accounting.watchlist_ranked}/${accounting.watchlist_total} of the watchlist)\n` +
    `launch radar: value curve keeps ${kept || 'none'}; median miss ×${comps.loo_miss} leave-one-out, ×${comps.wf_miss ?? ''} walk-forward; odds Brier ${odds.brier}\n` +
    `launch radar: ${farm} of ${rows.length} rows are worth farming net of fees and the T-bill\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${readdirSync(join(here, 'dashboard')).length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
