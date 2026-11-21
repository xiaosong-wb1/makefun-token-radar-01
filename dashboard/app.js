/* Launch Radar: the page. Reads window.RADAR (written beside this file by main.ts) and renders the board,
   the detail view of a protocol, and the filter. No network, no framework, one render path: every figure on
   screen comes from the document, and the footer recomputes each row's implied value from its own terms. */
(function () {
  'use strict';

  var R = window.RADAR;
  var root = document.getElementById('root');
  if (!R) {
    root.innerHTML = '<p class="loading">No radar data: data.js did not load.</p>';
    return;
  }

  // ------------------------------------------------------------ formatting

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return n.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function days(n) {
    if (n === null || n === undefined) return 'unreported';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return n + 'd';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function cell(tag, cls, text) {
    return el(tag, cls, text);
  }

  // ------------------------------------------------------------ state

  var chains = {};
  R.rows.forEach(function (r) {
    (r.chains || []).forEach(function (c) {
      chains[c] = (chains[c] || 0) + 1;
    });
  });
  var chainList = Object.keys(chains).sort(function (a, b) {
    return chains[b] - chains[a] || (a < b ? -1 : 1);
  });

  var state = { q: '', verdict: 'all', chain: 'all', sort: 'value', selected: R.rows.length ? R.rows[0].slug : null };

  function matches(r) {
    if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function sorted(rows) {
    var copy = rows.slice();
    if (state.sort === 'net') copy.sort(function (a, b) { return b.net_usd - a.net_usd || a.rank - b.rank; });
    else if (state.sort === 'odds') copy.sort(function (a, b) { return b.odds_pct - a.odds_pct || a.rank - b.rank; });
    else if (state.sort === 'tvl') copy.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; });
    else if (state.sort === 'age') copy.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0) || a.rank - b.rank; });
    else copy.sort(function (a, b) { return a.rank - b.rank; });
    return copy;
  }

  // ------------------------------------------------------------ masthead

  function masthead() {
    var m = el('header', 'mast');
    var brand = el('div', 'brand');
    brand.appendChild(el('span', 'mark', '◈'));
    var titles = el('div');
    titles.appendChild(el('h1', null, 'Launch Radar'));
    titles.appendChild(
      el('div', 'sub', 'pre-token protocols ranked by what their token would be worth if the record stayed as it is'),
    );
    brand.appendChild(titles);

    var facts = el('dl');
    [
      ['as of', R.meta.as_of],
      ['protocols', R.meta.protocols + ' tracked'],
      ['watchlist', R.meta.watchlist + ' named'],
      ['board', R.meta.board + ' ranked'],
      ['model', R.meta.model_version],
    ].forEach(function (pair) {
      var wrap = el('div');
      wrap.appendChild(el('dt', null, pair[0]));
      wrap.appendChild(el('dd', null, pair[1]));
      facts.appendChild(wrap);
    });
    m.appendChild(brand);
    m.appendChild(facts);
    return m;
  }

  // ------------------------------------------------------------ kpis

  function kpis() {
    var strip = el('section', 'kpis');
    R.kpis.forEach(function (k, i) {
      var card = el('div', 'kpi' + (i === 0 || i === 3 ? ' good' : i === 5 ? ' warn' : ''));
      card.appendChild(el('div', 'label', k.label));
      card.appendChild(el('div', 'value', k.value));
      card.appendChild(el('div', 'note', k.note));
      strip.appendChild(card);
    });
    return strip;
  }

  // ------------------------------------------------------------ accounting

  function accounting() {
    var panel = el('section', 'panel wide');
    var head = el('h2', null, 'Where all ' + R.accounting.total + ' protocols went');
    head.appendChild(el('span', null, R.accounting.reconciles ? 'reconciles: ' + R.accounting.total + ' of ' + R.meta.protocols : 'does not reconcile'));
    panel.appendChild(head);

    var bar = el('div', 'bar');
    R.accounting.buckets.forEach(function (b) {
      var seg = el('i', 'b-' + b.id);
      seg.style.width = (100 * b.slugs.length) / R.accounting.total + '%';
      seg.title = b.label + ': ' + b.slugs.length;
      bar.appendChild(seg);
    });
    panel.appendChild(bar);

    var list = el('div', 'acct');
    R.accounting.buckets.forEach(function (b) {
      var row = el('div');
      var dot = el('span', 'dot b-' + b.id);
      dot.style.background = b.id === 'ranked' ? 'var(--teal)' : b.id === 'token' ? '#23454a' : b.id === 'rule' ? '#1b3034' : '#142326';
      row.appendChild(dot);
      row.appendChild(el('span', 'n', b.slugs.length + ' · ' + b.label));
      row.appendChild(el('span', 'n', ((100 * b.slugs.length) / R.accounting.total).toFixed(1) + '%'));
      row.appendChild(el('span', 'why', b.why));
      list.appendChild(row);
    });
    panel.appendChild(list);
    return panel;
  }

  // ------------------------------------------------------------ evidence

  function evidenceTable(rows, columns) {
    var table = el('table');
    var thead = el('thead');
    var tr = el('tr');
    columns.forEach(function (c) {
      tr.appendChild(cell('th', c.right ? null : 'left', c.label));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      row.appendChild(cell('td', 'left', r.a));
      row.appendChild(cell('td', null, r.b));
      row.appendChild(cell('td', null, r.c));
      row.appendChild(cell('td', null, r.d));
      var flag = cell('td', 'flag ' + (r.flag === 'kept' || r.flag === 'calibrated' ? 'good' : /not kept|off/.test(r.flag) ? 'not' : 'thin'), r.flag);
      row.appendChild(flag);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  var COLUMNS = [
    { label: 'what', right: false },
    { label: 'with', right: true },
    { label: 'test', right: true },
    { label: 'held out', right: true },
    { label: 'verdict', right: true },
  ];

  function evidence() {
    var wrap = el('section', 'grid evidence');

    var terms = el('div', 'panel wide');
    var tHead = el('h2', null, 'The value model, term by term');
    tHead.appendChild(el('span', null, 'each fitted, then dropped and refitted: a term stays only if the curve needs it both ways'));
    terms.appendChild(tHead);
    terms.appendChild(evidenceTable(R.evidence.terms, COLUMNS));
    wrap.appendChild(terms);

    var base = el('div', 'panel');
    var bHead = el('h2', null, 'Against the baselines');
    bHead.appendChild(el('span', null, 'same peers, same tests'));
    base.appendChild(bHead);
    base.appendChild(evidenceTable(R.evidence.baselines, COLUMNS));
    wrap.appendChild(base);

    var walk = el('div', 'panel');
    var wHead = el('h2', null, 'Walk-forward');
    wHead.appendChild(el('span', null, 'trained on the protocols listed first, read on the ones after'));
    walk.appendChild(wHead);
    walk.appendChild(evidenceTable(R.evidence.walk, COLUMNS));
    wrap.appendChild(walk);

    var bands = el('div', 'panel');
    var bandHead = el('h2', null, 'The bands, out of sample');
    bandHead.appendChild(el('span', null, 'what the P25–P75 on every row actually covered'));
    bands.appendChild(bandHead);
    bands.appendChild(evidenceTable(R.evidence.bands, COLUMNS));
    wrap.appendChild(bands);

    var cal = el('div', 'panel');
    var cHead = el('h2', null, 'Token odds, calibrated');
    cHead.appendChild(el('span', null, 'leave-one-out over all ' + R.meta.protocols + ' protocols'));
    cal.appendChild(cHead);
    cal.appendChild(evidenceTable(R.evidence.calibration, COLUMNS));
    wrap.appendChild(cal);

    var cats = el('div', 'panel');
    var catHead = el('h2', null, 'Which categories carry a token');
    catHead.appendChild(el('span', null, 'the record, not proof of a launch'));
    cats.appendChild(catHead);
    cats.appendChild(evidenceTable(R.evidence.categories, COLUMNS));
    wrap.appendChild(cats);

    return wrap;
  }

  // ------------------------------------------------------------ board

  function controls(onChange) {
    var bar = el('div', 'controls');

    var search = el('input');
    search.type = 'search';
    search.placeholder = 'filter by name, slug, category or chain';
    search.value = state.q;
    search.setAttribute('aria-label', 'filter the board');
    search.addEventListener('input', function () {
      state.q = search.value;
      onChange();
    });
    bar.appendChild(search);

    var verdict = el('select');
    verdict.setAttribute('aria-label', 'verdict');
    [['all', 'every verdict'], ['FARM', 'FARM only'], ['MARGINAL', 'MARGINAL only'], ['SKIP', 'SKIP only']].forEach(function (pair) {
      var option = el('option', null, pair[1]);
      option.value = pair[0];
      if (state.verdict === pair[0]) option.selected = true;
      verdict.appendChild(option);
    });
    verdict.addEventListener('change', function () {
      state.verdict = verdict.value;
      onChange();
    });
    bar.appendChild(verdict);

    var chain = el('select');
    chain.setAttribute('aria-label', 'chain');
    var all = el('option', null, 'every chain');
    all.value = 'all';
    if (state.chain === 'all') all.selected = true;
    chain.appendChild(all);
    chainList.slice(0, 24).forEach(function (c) {
      var option = el('option', null, c + ' (' + chains[c] + ')');
      option.value = c;
      if (state.chain === c) option.selected = true;
      chain.appendChild(option);
    });
    chain.addEventListener('change', function () {
      state.chain = chain.value;
      onChange();
    });
    bar.appendChild(chain);

    var sort = el('select');
    sort.setAttribute('aria-label', 'sort');
    [['value', 'sort: implied value'], ['net', 'sort: net of fees'], ['odds', 'sort: token odds'], ['tvl', 'sort: TVL'], ['age', 'sort: time without a token']].forEach(function (pair) {
      var option = el('option', null, pair[1]);
      option.value = pair[0];
      if (state.sort === pair[0]) option.selected = true;
      sort.appendChild(option);
    });
    sort.addEventListener('change', function () {
      state.sort = sort.value;
      onChange();
    });
    bar.appendChild(sort);

    var shown = sorted(R.rows.filter(matches));
    bar.appendChild(el('span', 'count', shown.length + ' of ' + R.rows.length + ' rows shown'));
    return bar;
  }

  function boardTable(rows, onPick) {
    var wrap = el('div', 'board-wrap');
    var table = el('table', 'board');
    var thead = el('thead');
    var tr = el('tr');
    ['#', 'protocol', 'TVL', '7d', 'no token', 'odds', 'implied value', 'P25–P75', 'verdict', 'net', '$/hour'].forEach(function (label, i) {
      tr.appendChild(cell('th', i <= 1 ? 'left' : null, label));
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      if (r.slug === state.selected) row.className = 'selected';
      row.dataset.slug = r.slug;
      row.appendChild(cell('td', 'left rank', r.rank));
      var name = cell('td', 'left');
      name.appendChild(el('span', 'name', r.name));
      if (r.category) name.appendChild(el('span', 'cat', r.category));
      if (!r.on_watchlist) name.appendChild(el('span', 'cat', '· early'));
      row.appendChild(name);
      row.appendChild(cell('td', null, usd(r.tvl_usd)));
      var change = cell('td', (r.change_7d || 0) >= 0 ? 'up' : 'down', r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + pct(r.change_7d));
      row.appendChild(change);
      row.appendChild(cell('td', null, days(r.age_days)));
      row.appendChild(cell('td', null, pct(r.odds_pct, 0)));
      row.appendChild(cell('td', 'val', usd(r.implied_usd)));
      row.appendChild(cell('td', 'range', usd(r.p25_usd) + '–' + usd(r.p75_usd)));
      row.appendChild(cell('td', 'v-' + r.verdict, r.verdict));
      row.appendChild(cell('td', r.net_usd > 0 ? 'up' : 'down', usd(r.net_usd)));
      row.appendChild(cell('td', null, '$' + r.usd_per_hour));
      row.addEventListener('click', function () {
        onPick(r.slug);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // ------------------------------------------------------------ detail

  function detailRow(label, value, note) {
    var line = el('div', 'line');
    var left = el('span');
    left.appendChild(el('span', null, label + ' '));
    if (note) left.appendChild(el('b', null, note));
    line.appendChild(left);
    line.appendChild(el('span', null, value));
    return line;
  }

  function detail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (!r) r = R.rows[0];
    var panel = el('section', 'panel wide detail');

    var left = el('div');
    var head = el('h3');
    head.appendChild(el('span', null, '#' + r.rank + ' ' + r.name));
    head.appendChild(el('span', 'slug', r.slug + (r.category ? ' · ' + r.category : '')));
    head.appendChild(el('span', 'verdict v-' + r.verdict, r.verdict));
    left.appendChild(head);

    var math = el('div', 'math');
    var product = r.intercept_multiplier;
    math.appendChild(detailRow('TVL', usd(r.tvl_usd) + ' (' + usd(r.tvl_usd) + ')'));
    math.appendChild(detailRow('curve intercept', '×' + r.intercept_multiplier));
    r.terms.forEach(function (t) {
      product *= t.multiplier;
      math.appendChild(detailRow('× ' + t.label, '×' + t.multiplier + ' (' + t.source + ')'));
    });
    math.appendChild(detailRow('implied multiple', '×' + r.multiple));
    math.appendChild(detailRow('implied value', usd(r.implied_usd), 'the row\'s own claim'));
    math.appendChild(detailRow('P10–P90', usd(r.p10_usd) + ' – ' + usd(r.p90_usd)));
    math.appendChild(detailRow('token odds', pct(r.odds_pct), 'the record carries a token, not proof it exists'));
    math.appendChild(detailRow('recomputed here', usd(r.tvl_usd * product)));
    left.appendChild(math);

    var peersHead = el('h3', null, 'nearest priced peers');
    left.appendChild(peersHead);
    var peersTable = el('table');
    var pThead = el('thead');
    var pTr = el('tr');
    ['peer', 'TVL', 'multiple', 'category'].forEach(function (label, i) {
      pTr.appendChild(cell('th', i === 0 || i === 3 ? 'left' : null, label));
    });
    pThead.appendChild(pTr);
    peersTable.appendChild(pThead);
    var pBody = el('tbody');
    r.peers.forEach(function (p) {
      var row = el('tr');
      row.appendChild(cell('td', 'left', p.name));
      row.appendChild(cell('td', null, usd(p.tvl_usd)));
      row.appendChild(cell('td', null, '×' + p.multiple));
      row.appendChild(cell('td', 'left cat', p.category || '—'));
      pBody.appendChild(row);
    });
    peersTable.appendChild(pBody);
    left.appendChild(peersTable);
    panel.appendChild(left);

    var right = el('div');
    var planHead = el('h3', null, 'farm plan, cost and time');
    planHead.appendChild(el('span', 'slug', usd(r.deposit_usd) + ' deposit · ' + r.hold_days + ' days · ' + r.hours + ' h'));
    right.appendChild(planHead);
    var steps = el('ol', 'steps');
    r.steps.forEach(function (s) {
      var item = el('li');
      var text = s.replace(/\s*Cost:.*$/, '');
      var tail = s.slice(text.length);
      item.appendChild(el('b', null, text));
      item.appendChild(el('span', null, tail));
      steps.appendChild(item);
    });
    right.appendChild(steps);
    right.appendChild(el('div', 'why', 'verdict: ' + r.verdict + '. ' + r.why + '.'));
    panel.appendChild(right);
    return panel;
  }

  // ------------------------------------------------------------ footer

  function footer() {
    var foot = el('footer', 'foot');

    // The integrity strip: recompute every row's implied value from its own terms, in this page.
    var ok = 0;
    R.rows.forEach(function (r) {
      var v = r.tvl_usd * r.intercept_multiplier;
      r.terms.forEach(function (t) {
        v *= t.multiplier;
      });
      var recomputed = Math.round(v);
      if (Math.abs(recomputed - r.implied_usd) <= Math.max(2, r.implied_usd * 0.01)) ok += 1;
    });
    var strip = el('span', 'integrity');
    strip.appendChild(el('b', null, ok + ' of ' + R.rows.length));
    strip.appendChild(el('span', null, ' rows recomputed here from TVL × the curve'));
    foot.appendChild(strip);

    foot.appendChild(
      el(
        'span',
        null,
        'implied value is this entry\'s claim, never make.fun\'s · ' +
          R.meta.protocols +
          ' protocols, ' +
          R.meta.watchlist +
          ' on the watchlist, floor ' +
          usd(R.meta.floor_usd) +
          ' · ' +
          R.meta.source,
      ),
    );
    return foot;
  }

  // ------------------------------------------------------------ render

  function renderBoard() {
    var holder = document.getElementById('board-holder');
    if (!holder) return;
    holder.innerHTML = '';
    var rows = sorted(R.rows.filter(matches));
    holder.appendChild(boardTable(rows, function (slug) {
      state.selected = slug;
      renderBoard();
      var old = document.getElementById('detail-holder');
      if (old) {
        old.innerHTML = '';
        old.appendChild(detail(state.selected));
      }
    }));
    var count = document.querySelector('.controls .count');
    if (count) count.textContent = rows.length + ' of ' + R.rows.length + ' rows shown';
  }

  // ------------------------------------------------------------ screens
  //
  // Two screens, one page: the board (with its filters) and a protocol's own page. The detail is a route, not a
  // panel hidden under a scroll, so each screen is a whole view a reader can link to and a screenshot can show.

  var query = {};
  (location.search || '')
    .replace(/^\?/, '')
    .split('&')
    .forEach(function (pair) {
      if (!pair) return;
      var at = pair.indexOf('=');
      query[decodeURIComponent(at < 0 ? pair : pair.slice(0, at))] = at < 0 ? '' : decodeURIComponent(pair.slice(at + 1));
    });
  if (query.q) state.q = query.q;
  if (query.verdict) state.verdict = query.verdict;
  if (query.chain) state.chain = query.chain;
  if (query.sort) state.sort = query.sort;

  function route() {
    var hash = (location.hash || '').replace(/^#/, '');
    var at = /^detail\/(.+)$/.exec(hash);
    return at ? { screen: 'detail', slug: decodeURIComponent(at[1]) } : { screen: 'board' };
  }

  function go(hash) {
    if ((location.hash || '').replace(/^#/, '') === hash) render();
    else location.hash = hash;
  }

  function boot() {
    root.innerHTML = '';
    root.removeAttribute('aria-busy');
    var where = route();
    if (where.screen === 'detail') renderDetailScreen(where.slug);
    else renderBoardScreen();
  }

  function renderBoardScreen() {
    var app = el('div');
    app.appendChild(masthead());
    app.appendChild(kpis());
    app.appendChild(accounting());

    var boardPanel = el('section', 'panel wide');
    var boardHead = el('h2', null, 'The board: ' + R.rows.length + ' pre-token protocols by implied value');
    boardHead.appendChild(el('span', null, 'click a row for its arithmetic, its comps and its farm plan'));
    boardPanel.appendChild(boardHead);
    var controlsHost = el('div');
    boardPanel.appendChild(controlsHost);
    var holder = el('div');
    holder.id = 'board-holder';
    boardPanel.appendChild(holder);
    app.appendChild(boardPanel);

    app.appendChild(evidence());
    app.appendChild(livePanel());
    app.appendChild(footer());
    root.appendChild(app);

    controlsHost.appendChild(
      controls(function () {
        renderBoardRows(holder);
      }),
    );
    renderBoardRows(holder);
  }

  function renderBoardRows(holder) {
    holder.innerHTML = '';
    var rows = sorted(R.rows.filter(matches));
    holder.appendChild(
      boardTable(rows, function (slug) {
        go('detail/' + slug);
      }),
    );
    var count = document.querySelector('.controls .count');
    if (count) count.textContent = rows.length + ' of ' + R.rows.length + ' rows shown';
  }

  function renderDetailScreen(slug) {
    var app = el('div');
    var bar = el('div', 'controls');
    var back = el('button', 'back', '← the board');
    back.type = 'button';
    back.addEventListener('click', function () {
      go('');
    });
    bar.appendChild(back);
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (r) {
      bar.appendChild(el('span', 'count', 'rank ' + r.rank + ' of ' + R.rows.length + ' · ' + r.name + ' · ' + r.verdict));
    }
    app.appendChild(bar);
    app.appendChild(
      el(
        'p',
        'lede',
        'What ' + (r ? r.name : 'this protocol') + ' would be worth if its record stayed as it is: the curve read off ' +
          R.model.peers + ' priced peers, its own terms, then what farming it costs and returns.',
      ),
    );
    app.appendChild(detail(slug));
    app.appendChild(footer());
    root.appendChild(app);
  }

  function livePanel() {
    var livePanel = el('section', 'panel wide');
    var liveHead = el('h2', null, 'The other half: protocols whose record already carries a token');
    liveHead.appendChild(el('span', null, 'the market prices these, the model does not'));
    livePanel.appendChild(liveHead);
    var liveTable = el('table');
    var lThead = el('thead');
    var lTr = el('tr');
    ['protocol', 'symbol', 'category', 'TVL', 'market cap', '7d'].forEach(function (label, i) {
      lTr.appendChild(cell('th', i <= 2 ? 'left' : null, label));
    });
    lThead.appendChild(lTr);
    liveTable.appendChild(lThead);
    var lBody = el('tbody');
    R.live.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(cell('td', 'left', p.name));
      tr.appendChild(cell('td', 'left cat', p.symbol || '—'));
      tr.appendChild(cell('td', 'left cat', p.category || '—'));
      tr.appendChild(cell('td', null, usd(p.tvl_usd)));
      tr.appendChild(cell('td', null, usd(p.mcap_usd)));
      tr.appendChild(cell('td', (p.change_7d || 0) >= 0 ? 'up' : 'down', p.change_7d === null ? '—' : pct(p.change_7d)));
      lBody.appendChild(tr);
    });
    liveTable.appendChild(lBody);
    livePanel.appendChild(liveTable);
    return livePanel;
  }

  window.addEventListener('hashchange', boot);
  boot();
})();
