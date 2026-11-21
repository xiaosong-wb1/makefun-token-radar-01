// The sealed snapshot, read strictly.
//
// `/input/snapshot.json` carries exactly ten fields per protocol (input/README.md): slug, name, category,
// chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol. Nothing else is read from it and
// nothing is added here: the model's every input must be one of the snapshot's own figures.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The snapshot's document, refused unless it is the shape every model in this program scores. */
export function parseSnapshot(raw: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new SnapshotError('snapshot is not JSON');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new SnapshotError('snapshot is not an object');
  const o = doc as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !DATE.test(o.as_of)) throw new SnapshotError('snapshot has no as_of day');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot has no protocols');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot has no watchlist');
  }
  const protocols = o.protocols.map((entry, i): Protocol => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    const slug = text(p.slug);
    const name = text(p.name);
    const tvl = count(p.tvl_usd);
    if (slug === null || name === null || tvl === null || tvl < 0) {
      throw new SnapshotError(`protocol ${i} has no slug, name or TVL`);
    }
    const chains = Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
    const listed = text(p.listed_at);
    return {
      slug,
      name,
      category: text(p.category),
      chains,
      tvl_usd: tvl,
      change_7d: count(p.change_7d),
      mcap_usd: count(p.mcap_usd),
      listed_at: listed !== null && DATE.test(listed) ? listed : null,
      gecko_id: text(p.gecko_id),
      symbol: text(p.symbol),
    };
  });
  const slugs = new Set<string>();
  for (const p of protocols) {
    if (slugs.has(p.slug)) throw new SnapshotError(`protocol ${p.slug} appears twice`);
    slugs.add(p.slug);
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either day is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** Whether the record carries a token at all: its market cap, its CoinGecko id and its symbol are all absent. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the record carries a traded token: a symbol or a CoinGecko id, a market cap alone is not a launch. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** DefiLlama's version marker on a name: `… V2`, `… 2.0` and the like name a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole-word markers of a wrapped, staked or restaked product of a token that already trades. */
const PRODUCT_WORD = /(^|[^a-z])(wrapped|staked|staking|restaked|restaking)([^a-z]|$)/i;

/** The categories whose protocols are a product of a token that already trades, or an exchange's own book. */
const PRODUCT_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchanges whose name at the front of a protocol's name marks a product of theirs. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/**
 * Why a protocol is out of the radar's subject by the house's own rule, or null. This is the *reading* of the
 * watchlist rule applied to protocols the list leaves out, so the accounting can say why each is not ranked.
 */
export function productRule(p: Protocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORY.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'name carries a version marker';
  if (PRODUCT_WORD.test(p.name)) return 'name says wrapped or staked';
  if (EXCHANGE_PREFIX.test(p.name)) return 'name begins with an exchange';
  return null;
}
