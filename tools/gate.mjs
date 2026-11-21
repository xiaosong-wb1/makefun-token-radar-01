// The gate, run here instead of on the server.
//
// token-radar-01 is a judge competition: its scorer stays on make.fun's server, so the kit carries no local grade
// ("There is no local grade of this competition", RULES.txt). This file is the next best thing — a faithful
// re-implementation of the seven rows the sealed gate checks, written from RULES.txt §The gate, plus the two
// things a local run can prove and the server only learns at grading time: that two runs write the same bytes,
// and that the dossier on disk is byte for byte what the house library writes from the same /output.
//
//   node tools/gate.mjs --out out                     # the seven rows and determinism
//   node tools/gate.mjs --out out --repo .            # and re-run main.ts to compare bytes
//
// Exit code 0 when every row passes, 1 otherwise. It never touches the network.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};

const out = argOf('out', 'out');
const kitInput = argOf('input', '../token-radar-01-kit/input/snapshot.json');
const results = [];

const pass = (check, reason) => results.push({ check, status: 'pass', reason });
const fail = (check, reason) => results.push({ check, status: 'fail', reason });

const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
const TEXT_MAX_BYTES = 65_536;
const URL_IN_TEXT = /https?:\/\//i;

/** The snapshot the gate reads its protocols and watchlist from. */
let snapshot = null;
try {
  snapshot = JSON.parse(readFileSync(kitInput, 'utf8'));
} catch (err) {
  fail('snapshot', `cannot read ${kitInput}: ${err.message}`);
}

// ---------------------------------------------------------------- 1. dashboard_files

/** Every regular file under `dir`, as paths relative to it, in path order; null when a name is refused. */
function walk(dir) {
  const files = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const here = rel === '' ? dir : join(dir, rel);
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) return { error: `dashboard/${path} is a dot-directory` };
        stack.push(path);
      } else if (entry.isFile()) {
        if (!NAME.test(entry.name)) return { error: `dashboard/${path}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -` };
        files.push(path);
      } else {
        return { error: `dashboard/${path} is neither a file nor a directory` };
      }
    }
  }
  return { files: files.sort() };
}

/** The addresses an HTML file must not carry: an attribute value, or a `<style>` body. */
function htmlAddresses(text) {
  const found = [];
  const attributes = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  let match;
  while ((match = attributes.exec(text)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (URL_IN_TEXT.test(value) || value.trim().toLowerCase().startsWith('//')) found.push(`${match[1]}=${value.slice(0, 60)}`);
  }
  const style = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((match = style.exec(text)) !== null) {
    if (URL_IN_TEXT.test(match[1])) found.push('a <style> body names an address');
  }
  const script = /<script[^>]*\btype\s*=\s*["']?module["']?[^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = script.exec(text)) !== null) {
    if (/\bimport\s*\(?\s*["'][^"']*https?:\/\//i.test(match[1])) found.push('an inline module imports an address');
  }
  return found;
}

/** The addresses a CSS file must not carry. */
const cssAddresses = (text) => (URL_IN_TEXT.test(text) || /url\(\s*["']?\/\//i.test(text) ? ['the CSS file names an address'] : []);

/** The addresses a JavaScript file must not import: every import, export-from, require and dynamic import. */
function jsAddresses(text) {
  const found = [];
  const specifiers = [
    /\bimport\s+[^;'"]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^;'"]*?from\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of specifiers) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (URL_IN_TEXT.test(match[1]) || match[1].trim().startsWith('//')) found.push(`imports ${match[1].slice(0, 60)}`);
    }
  }
  return found;
}

const dashDir = join(out, 'dashboard');
let dashFiles = [];
if (!existsSync(dashDir)) {
  fail('dashboard_files', 'dashboard/ is missing');
} else {
  const walked = walk(dashDir);
  if (walked.error) {
    fail('dashboard_files', walked.error);
  } else {
    dashFiles = walked.files;
    let bytes = 0;
    const problems = [];
    for (const path of dashFiles) bytes += lstatSync(join(dashDir, path)).size;
    if (!dashFiles.includes('index.html')) problems.push('dashboard/index.html is missing');
    if (!dashFiles.some((f) => f.endsWith('.css'))) problems.push('dashboard/ holds no .css file');
    if (!dashFiles.some((f) => f.endsWith('.js'))) problems.push('dashboard/ holds no .js file');
    if (dashFiles.length > 400) problems.push(`${dashFiles.length} files, over the 400 the gate takes`);
    if (bytes > 4_194_304) problems.push(`${bytes} bytes, over the 4 MiB the gate takes`);
    for (const path of dashFiles) {
      const text = readFileSync(join(dashDir, path), 'utf8');
      const found = path.endsWith('.html') ? htmlAddresses(text) : path.endsWith('.css') ? cssAddresses(text) : path.endsWith('.js') ? jsAddresses(text) : [];
      if (found.length > 0) problems.push(`dashboard/${path}: ${found[0]}`);
    }
    if (problems.length > 0) fail('dashboard_files', problems.join('; '));
    else pass('dashboard_files', `${dashFiles.length} files, ${bytes} bytes, no network address in a file`);
  }
}

// ---------------------------------------------------------------- 2, 3, 4, 5: the board

const boardPath = join(out, 'board.json');
let board = null;
let boardRows = [];
if (!existsSync(boardPath)) {
  fail('board_file', 'board.json is missing');
} else {
  const size = statSync(boardPath).size;
  let doc = null;
  try {
    doc = JSON.parse(readFileSync(boardPath, 'utf8'));
  } catch (err) {
    fail('board_file', `board.json is not UTF-8 JSON: ${err.message}`);
  }
  if (doc !== null) {
    const rows = Array.isArray(doc) ? doc : Array.isArray(doc.rows) ? doc.rows : null;
    if (rows === null) {
      fail('board_file', 'board.json holds no rows array');
    } else {
      boardRows = rows;
      const problems = [];
      if (size > 8 * 1024 * 1024) problems.push(`${size} bytes, over the 8 MiB the gate takes`);
      if (rows.length < 100 || rows.length > 4_000) problems.push(`${rows.length} rows, not the 100 to 4,000 the gate takes`);
      const known = new Set((snapshot?.protocols ?? []).map((p) => p.slug));
      const slugs = new Set();
      const bad = [];
      for (const [i, row] of rows.entries()) {
        if (typeof row !== 'object' || row === null) {
          bad.push(`row ${i + 1} is not an object`);
          continue;
        }
        if (typeof row.slug !== 'string' || row.slug.length < 1 || row.slug.length > 128 || /\s/.test(row.slug) || !known.has(row.slug)) {
          bad.push(`row ${i + 1}: ${JSON.stringify(row.slug)} is not a protocol the snapshot lists`);
          continue;
        }
        if (slugs.has(row.slug)) bad.push(`row ${i + 1}: ${row.slug} appears twice`);
        slugs.add(row.slug);
        if (typeof row.name !== 'string' || row.name.length === 0) bad.push(`row ${i + 1}: no name`);
        if (!Number.isInteger(row.rank) || row.rank < 1) bad.push(`row ${i + 1}: rank ${row.rank} is not a positive whole number`);
        if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
          bad.push(`row ${i + 1}: implied value ${row.implied_value_usd} is not a positive whole dollar amount under $100T`);
        }
      }
      if (bad.length > 0) problems.push(`${bad.length} row problem(s): ${bad.slice(0, 3).join('; ')}`);
      if (problems.length > 0) fail('board_file', problems.join('; '));
      else pass('board_file', `${rows.length} rows, ${size} bytes, every slug a protocol the snapshot lists`);
    }
  }
}

if (boardRows.length > 0) {
  const problems = [];
  const ranks = boardRows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) {
    problems.push(`rank ${i + 1} is ${ranks[i]}`);
    break;
  }
  const byRank = [...boardRows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      problems.push(`rank ${byRank[i].rank} is worth more than rank ${byRank[i - 1].rank}`);
      break;
    }
  }
  if (boardRows.length >= 2 && boardRows.every((r) => r.implied_value_usd === boardRows[0].implied_value_usd)) {
    problems.push('every row carries the same implied value: a board that ranks nothing by value is not a ranking');
  }
  if (problems.length > 0) fail('sorted_by_value', problems.join('; '));
  else pass('sorted_by_value', `ranks 1..${boardRows.length} once each, implied value falling as the rank rises`);

  const have = new Set(boardRows.map((r) => r.slug));
  const missing = (snapshot?.watchlist ?? []).filter((slug) => !have.has(slug));
  if (missing.length > 0) fail('coverage', `${missing.length} watchlist slug(s) missing: ${missing.slice(0, 5).join(', ')}`);
  else pass('coverage', `all ${(snapshot?.watchlist ?? []).length} watchlist slugs are on the board`);

  const stepProblems = [];
  for (const row of boardRows) {
    const steps = row.farm_steps;
    if (!Array.isArray(steps)) {
      stepProblems.push(`${row.slug}: farm_steps is not an array`);
      continue;
    }
    if (steps.length < 3 || steps.length > 12) stepProblems.push(`${row.slug}: ${steps.length} steps`);
    for (const step of steps) {
      if (typeof step !== 'string') {
        stepProblems.push(`${row.slug}: a step is not a string`);
        break;
      }
      const n = step.trim().length;
      if (n < 20 || n > 600) {
        stepProblems.push(`${row.slug}: a step is ${n} characters`);
        break;
      }
    }
  }
  if (stepProblems.length > 0) fail('farm_steps', `${stepProblems.length} row(s): ${stepProblems.slice(0, 3).join('; ')}`);
  else pass('farm_steps', `every row carries 3 to 12 steps of 20 to 600 characters`);
}

// ---------------------------------------------------------------- 6. screenshots

/** A PNG's width and height from its IHDR, or null. */
function pngSize(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A JPEG's width and height from its first frame header, or null. */
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

const shotsDir = join(out, 'screenshots');
if (!existsSync(shotsDir)) {
  fail('screenshots', 'screenshots/ is missing');
} else {
  const names = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
  const problems = [];
  if (names.length < 3 || names.length > 4) problems.push(`${names.length} image(s), not the 3 or 4 the gate takes`);
  for (const name of names) {
    if (!NAME.test(name)) {
      problems.push(`${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
      continue;
    }
    const path = join(shotsDir, name);
    if (!lstatSync(path).isFile()) {
      problems.push(`${name} is not a regular file`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length > 524_288) problems.push(`${name}: ${bytes.length} bytes, over 512 KiB`);
    const png = pngSize(bytes);
    const jpg = png === null ? jpegSize(bytes) : null;
    const size = png ?? jpg;
    if (size === null) {
      problems.push(`${name} is neither a whole PNG nor a whole JPEG`);
      continue;
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440) problems.push(`${name}: long side ${long}, over 1440`);
    if (short < 800) problems.push(`${name}: short side ${short}, under 800`);
  }
  if (problems.length > 0) fail('screenshots', problems.join('; '));
  else pass('screenshots', `${names.length} images, each a whole PNG/JPEG within 512 KiB and 1440x800`);
}

// ---------------------------------------------------------------- 7. dossier_matches

const dossierPath = join(out, 'dossier.json');
if (!existsSync(dossierPath)) {
  fail('dossier_matches', 'dossier.json is missing');
} else {
  const onDisk = readFileSync(dossierPath);
  let expected = null;
  try {
    expected = Buffer.from(buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES }));
  } catch (err) {
    fail('dossier_matches', `buildDossier refuses this /output: ${err.message}`);
  }
  if (expected !== null) {
    const same = onDisk.length === expected.length && onDisk.equals(expected);
    const problems = [];
    if (!same) problems.push(`dossier.json is ${onDisk.length} bytes and the library writes ${expected.length}`);
    if (onDisk.length > 1_572_864) problems.push(`${onDisk.length} bytes, over the 1.5 MiB the gate takes`);
    if (problems.length > 0) fail('dossier_matches', problems.join('; '));
    else {
      const digest = createHash('sha256').update(onDisk).digest('hex').slice(0, 16);
      pass('dossier_matches', `${onDisk.length} bytes, sha256 ${digest}…, rebuilt from /output byte for byte`);
    }
  }
}

// ---------------------------------------------------------------- what the judge will read

/** The dossier's text: how much of the dashboard's source the judge is shown whole. */
function dossierText() {
  try {
    return JSON.parse(readFileSync(dossierPath, 'utf8')).text ?? '';
  } catch {
    return '';
  }
}

const text = dossierText();
const textFiles = dashFiles.filter((f) => TEXT_FILE.test(f));
const textBytes = textFiles.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
const sourceCut = /not shown|left out/i.test(text);

// ---------------------------------------------------------------- determinism

const repo = argOf('repo', null);
if (repo !== null) {
  const before = createHash('sha256');
  for (const name of ['board.json', 'data.js', 'dossier.json']) {
    const path = join(out, name);
    before.update(`${name}:`);
    before.update(existsSync(path) ? readFileSync(path) : Buffer.from('missing'));
  }
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync(process.execPath, [join(repo, 'main.ts'), '--input', kitInput], {
      cwd: repo,
      env: { ...process.env, MAKEFUN_OUTPUT_DIR: out },
      stdio: 'pipe',
    });
    const after = createHash('sha256');
    for (const name of ['board.json', 'data.js', 'dossier.json']) {
      const path = join(out, name);
      after.update(`${name}:`);
      after.update(existsSync(path) ? readFileSync(path) : Buffer.from('missing'));
    }
    const digest = after.digest('hex');
    if (before.digest('hex') === digest) pass('deterministic', `a second run wrote the same board.json, data.js and dossier.json (sha256 ${digest.slice(0, 16)}…)`);
    else fail('deterministic', 'a second run wrote different bytes: the grade runs the program twice and compares them');
  } catch (err) {
    fail('deterministic', `the second run failed: ${err.message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------- report

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) {
  process.stdout.write(`${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.check.padEnd(width)}  ${r.reason}\n`);
}
process.stdout.write(
  `\n${results.filter((r) => r.status === 'pass').length} of ${results.length} checks pass` +
    `\nthe judge reads ${textBytes} bytes of dashboard source in ${textFiles.length} files` +
    `${sourceCut ? ' (the text was cut: shorten the page or its source)' : ', every file whole'}` +
    `\ndossier text ${text.length} of ${TEXT_MAX_BYTES} bytes\n`,
);
process.exit(results.every((r) => r.status === 'pass') ? 0 : 1);
