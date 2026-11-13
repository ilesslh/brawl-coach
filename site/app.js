(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + ' %';
const num = n => (n || 0).toLocaleString('fr-FR');
const signed = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1).replace('.', ',');
const LS = { get(k, d) { try { const v = localStorage.getItem('bc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('bc.' + k, JSON.stringify(v)); } catch (e) {} } };
/* Icon ids: the official API gives a numeric modeId (game mode icon = 48000000 + modeId) and gear ids.
   The collector publishes both in meta.json; these tables are the fallback for older data. */
const MODE_ID = { gemGrab: 0, heist: 2, bounty: 3, brawlBall: 5, soloShowdown: 6, duoShowdown: 9, hotZone: 17, knockout: 20, deathmatch: 25,
  knockout5V5: 35, trioShowdown: 38, airHockey: 45, brawlArena: 48, loadedShowdown: 72, megaDuoShowdown: 86 };
const GEAR_ID = { SPEED: 62000000, HEALTH: 62000001, DAMAGE: 62000002, VISION: 62000003, SHIELD: 62000004, 'GADGET COOLDOWN': 62000005,
  'EXHAUSTING STORM': 62000012, 'PET POWER': 62000014 };
const CDN = 'https://cdn.brawlify.com';
const img = {
  brawler: id => `${CDN}/brawlers/borderless/${id}.png`,
  map: id => `${CDN}/maps/regular/${id}.png`,
  gadget: id => `${CDN}/gadgets/borderless/${id}.png`,
  sp: id => `${CDN}/star-powers/borderless/${id}.png`,
  mode: m => { const id = D.meta?.modes?.[m] ?? MODE_ID[m]; return id == null ? null : `${CDN}/game-modes/regular/${48000000 + id}.png`; },
  gear: g => { const id = D.meta?.gears?.[g] ?? GEAR_ID[g]; return id ? `${CDN}/gears/regular/${id}.png` : null; }
};
const icon = (src, cls = 'mico') => src ? `<img class="${cls}" src="${src}" alt="" loading="lazy" onerror="this.remove()">` : '';
const modeIcon = (m, cls) => icon(img.mode(m), cls);
const modePill = m => `<span class="mode-pill">${modeIcon(m)}${esc(modeName(m))}</span>`;
const MODES = {
  gemGrab: 'Razzia de gemmes', brawlBall: 'Brawl Ball', heist: 'Braquage', bounty: 'Prime', hotZone: 'Zone réservée', knockout: 'Hors-jeu',
  soloShowdown: 'Survivant solo', duoShowdown: 'Survivant duo', trioShowdown: 'Survivant trio', wipeout: 'Élimination', duels: 'Duels',
  basketBrawl: 'Basket Brawl', volleyBrawl: 'Volley Brawl', brawlHockey: 'Hockey Brawl', payload: 'Convoi', siege: 'Siège', paintBrawl: 'Paint Brawl',
  trophyThieves: 'Voleurs de trophées', holdTheTrophy: 'Garde le trophée', dodgebrawl: 'Dodgebrawl', brawlArena: 'Brawl Arena',
  airHockey: 'Air Hockey', knockout5V5: 'Hors-jeu 5c5', deathmatch: 'Combat à mort', bossFight: 'Combat de boss', roboRumble: 'Robo-ravage',
  loadedShowdown: 'Survivant chargé', megaDuoShowdown: 'Méga survivant duo'
};
const modeName = m => MODES[m] || String(m || '?').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const SD_WIN = { soloShowdown: 4, duoShowdown: 2, trioShowdown: 1 };
const isShowdown = m => m in SD_WIN;
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}
function av(id, cls = '') {
  const b = D.byId[id];
  return `<span class="av ${cls}"><img src="${img.brawler(id)}" alt="${esc(b?.name || '')}" loading="lazy" onerror="this.remove()">${esc((b?.name || '?').slice(0, 2))}</span>`;
}
function wrCls(x) { return x >= 0.53 ? 'hi' : x <= 0.47 ? 'lo' : 'mid'; }

/* Smoothed win rate: pulls small samples toward a prior (the brawler's overall rate) */
const smooth = (g, w, prior = 0.5, k = 20) => (w + k * prior) / (g + k);
const MIN_MAP = 8, MIN_MU = 20, MIN_TIER = 150;

/* ---------- data ---------- */
const D = { meta: null, stats: null, equip: null, players: {}, byId: {} };
const S = {
  q: LS.get('q', 'r'), view: LS.get('view', 'maps'), search: '', sort: 'win',
  mode: LS.get('mode', ''), bmode: LS.get('bmode', ''), bview: LS.get('bview', 'tiers'), mapScope: LS.get('mapScope', 'live'),
  mapSearch: '', mapSort: 'win', mpMode: '',
  draft: LS.get('draft', { map: null, allies: [], enemies: [], bans: [], owned: false }),
  tag: LS.get('tag', null)
};
const Q = () => D.stats[S.q];

function overall(id) { const b = Q().b[id]; return b ? b[1] / b[0] : 0.5; }
function games(id) { return Q().b[id]?.[0] || 0; }
function mapWr(id, e) { const x = Q().be[id]?.[e]; return x ? { g: x[0], w: x[1], s: smooth(x[0], x[1], overall(id), 15) } : null; }
function muWr(a, b) { const x = Q().mu[a]?.[b]; return x ? { g: x[0], w: x[1], s: smooth(x[0], x[1], overall(a), 25) } : null; }
function syWr(a, b) { const x = Q().sy[a]?.[b]; return x ? { g: x[0], w: x[1], s: smooth(x[0], x[1], overall(a), 25) } : null; }
function mapGames(e) { return Q().ev[e] || 0; }
function eventOf(e) { return D.meta.events[e] || {}; }

/* [games, wins] of a brawler, overall or restricted to one game mode */
function bStat(id, mode = '') { const v = mode ? Q().bm[id]?.[mode] : Q().b[id]; return v ? [v[0], v[1]] : [0, 0]; }
const minTier = mode => mode ? 40 : MIN_TIER;
function tiers(mode = '') {
  const list = Object.keys(Q().b).map(id => { const [g, w] = bStat(id, mode); return { id, g, s: smooth(g, w, 0.5, 60) }; })
    .filter(x => x.g >= minTier(mode)).sort((a, b) => b.s - a.s);
  const out = {}, n = list.length;
  list.forEach((x, i) => { const r = i / n; out[x.id] = r < 0.1 ? 'S' : r < 0.3 ? 'A' : r < 0.6 ? 'B' : r < 0.85 ? 'C' : 'D'; });
  return out;
}
/* Game modes with enough data in the current queue, most played first */
function playedModes() {
  const tot = {};
  for (const [e, g] of Object.entries(Q().ev)) { const m = eventOf(e).mode; if (m && g >= 40) tot[m] = (tot[m] || 0) + g; }
  return Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([m]) => m);
}
function modeChips(action, cur, modes) {
  return `<div class="chips hscroll" role="group" aria-label="Filtrer par mode"><button class="chip" data-action="${action}" data-k="" aria-pressed="${!cur}">Tous</button>${modes.map(m =>
    `<button class="chip ichip" data-action="${action}" data-k="${esc(m)}" aria-pressed="${cur === m}" title="${esc(modeName(m))}">${modeIcon(m)}<span>${esc(modeName(m))}</span></button>`).join('')}</div>`;
}

/* Maps to show: Trophies defaults to the live rotation, otherwise every map with enough games */
function mapList(scope = S.q === 't' ? S.mapScope : 'all') {
  if (scope === 'live') {
    const rot = D.meta.rotation.filter(r => !/^(duels)$/.test(r.mode));
    const seen = new Set();
    return rot.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => ({ id: String(r.id), mode: r.mode, map: r.map, end: r.end, live: true }));
  }
  return Object.entries(Q().ev).filter(([, g]) => g >= 40).sort((a, b) => b[1] - a[1])
    .map(([id]) => ({ id, ...eventOf(id) })).filter(x => x.map);
}
function topOnMap(e, n = 5) {
  return Object.keys(Q().be).map(id => ({ id, ...mapWr(id, e) })).filter(x => x.g >= MIN_MAP).sort((a, b) => b.s - a.s).slice(0, n);
}

/* ---------- player ---------- */
const queueOfType = t => (t === 'soloRanked' || t === 'teamRanked') ? 'r' : t === 'ranked' ? 't' : null;
function isWin(h) { return isShowdown(h.mode) ? (h.rank && h.rank <= SD_WIN[h.mode]) : h.result === 'victory'; }
function isDecided(h) { return isShowdown(h.mode) ? !!h.rank : (h.result === 'victory' || h.result === 'defeat'); }
async function loadPlayer(tag) {
  if (D.players[tag] !== undefined) return D.players[tag];
  try { const r = await fetch(`data/players/${tag}.json`, { cache: 'no-cache' }); D.players[tag] = r.ok ? await r.json() : null; } catch (e) { D.players[tag] = null; }
  return D.players[tag];
}
function owned(minPower = 9) {
  const p = D.players[S.tag]?.profile;
  if (!p) return null;
  return new Set(p.brawlers.filter(b => (b.power || 0) >= minPower).map(b => String(b.id)));
}

/* ---------- views ---------- */
function viewMaps() {
  const live = S.q === 't' && S.mapScope === 'live';
  const all = mapList();
  const modes = [...new Set(all.map(m => m.mode))];
  if (S.mode && !modes.includes(S.mode)) S.mode = '';
  const q = S.mapSearch.toLowerCase().trim();
  const maps = all.filter(m => (!S.mode || m.mode === S.mode) && (!q || m.map.toLowerCase().includes(q)));
  let html = `<div class="section-head"><h1>Maps</h1><span class="muted small">${live ? 'en rotation maintenant' : S.q === 'r' ? 'pool du Classé' : 'toutes les maps jouées'} · ${maps.length} maps</span></div>
    ${S.q === 't' ? `<div class="seg wide" role="group" aria-label="Maps affichées"><button data-action="scope" data-k="live" aria-pressed="${live}">En rotation</button><button data-action="scope" data-k="all" aria-pressed="${!live}">Toutes les maps</button></div>` : ''}
    <input class="search" id="mapFilter" placeholder="Rechercher une map" value="${esc(S.mapSearch)}" aria-label="Rechercher une map">
    ${modeChips('mode', S.mode, modes)}`;
  if (!maps.length) return html + `<div class="card empty">${all.length ? 'Aucune map ne correspond.' : 'Pas encore assez de parties pour cette file. Reviens après la prochaine collecte.'}</div>`;
  const groups = {};
  for (const m of maps) (groups[m.mode] ||= []).push(m);
  for (const [mode, list] of Object.entries(groups)) {
    html += `<section class="mode-group"><div class="mode-head">${modeIcon(mode, 'mico lg')}<h2>${esc(modeName(mode))}</h2><span class="muted small">${list.length} map${list.length > 1 ? 's' : ''}</span></div><div class="maps">`;
    for (const m of list) html += mapCard(m);
    html += '</div></section>';
  }
  return html;
}
function mapCard(m) {
  const top = topOnMap(m.id, 5), g = mapGames(m.id);
  return `<button class="mapcard" data-action="map" data-id="${esc(m.id)}">
    <span class="thumb"><img src="${img.map(m.id)}" alt="" loading="lazy" onerror="this.remove()">${modeIcon(m.mode, 'mico badge')}</span>
    <span class="info">
      <span class="name">${esc(m.map || 'Map ' + m.id)}</span>
      <span class="muted small">${num(g)} parties${m.end ? ' · finit ' + esc(endIn(m.end)) : ''}</span>
      <span class="picks">${top.length ? top.map(x => `<span class="pick">${av(x.id, 'sm')}<span class="wr ${wrCls(x.s)}">${Math.round(x.s * 100)}%</span></span>`).join('') : '<span class="muted small">Pas assez de données</span>'}</span>
    </span></button>`;
}
function endIn(s) {
  const t = new Date(s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*$/, '$1-$2-$3T$4:$5:$6Z'));
  const h = Math.round((t - Date.now()) / 3600000);
  return h <= 0 ? 'bientôt' : h < 24 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}

function mapSheet(e) {
  const ev = eventOf(e), g = mapGames(e);
  const per = isShowdown(ev.mode) ? 1 : 6;
  const sorts = { win: (a, b) => b.s - a.s, pick: (a, b) => b.g - a.g, raw: (a, b) => b.w / b.g - a.w / a.g };
  const rows = Object.keys(Q().be).map(id => ({ id, ...mapWr(id, e) })).filter(x => x.g >= 3).sort(sorts[S.mapSort] || sorts.win);
  const own = owned(), TM = tiers(ev.mode);
  let html = `<div class="sheet-head"><div class="hero">${modeIcon(ev.mode, 'mico xl')}<div><h2>${esc(ev.map || e)}</h2>${modePill(ev.mode)} <span class="muted small">${num(g)} parties · ${S.q === 'r' ? 'Classé' : 'Trophées'}</span></div></div><button class="x" data-close aria-label="Fermer">×</button></div>
    <img src="${img.map(e)}" alt="" style="border-radius:14px;max-height:220px;object-fit:cover;width:100%" onerror="this.remove()">
    <button class="btn" data-action="draft-map" data-id="${esc(e)}">Préparer un draft sur cette map</button>
    <div class="chips">${[['win', 'Win rate'], ['pick', 'Plus joués'], ['raw', 'Win rate brut']].map(([k, l]) => `<button class="chip" data-action="msort" data-id="${esc(e)}" data-k="${k}" aria-pressed="${(S.mapSort || 'win') === k}">${l}</button>`).join('')}</div>
    <div class="muted small">Win rate lissé : les brawlers peu joués sont ramenés vers leur moyenne. Grisé = moins de ${MIN_MAP * 3} parties.</div><div class="rows">`;
  rows.forEach((x, i) => {
    html += `<button class="row" data-action="brawler" data-id="${x.id}" style="${x.g < MIN_MAP * 3 ? 'opacity:.55' : ''}">
      <span style="display:flex;gap:10px;align-items:center"><span class="muted small" style="width:20px">${i + 1}</span>${av(x.id, 'sm')}</span>
      <span style="min-width:0"><div class="name">${tierBadge(TM[x.id])}${esc(D.byId[x.id]?.name)}${own?.has(x.id) ? ' <span class="mode-pill">à toi</span>' : ''}</div><div class="sub">${num(x.g)} parties · brut ${pct(x.w / x.g)}${per > 1 && g ? ' · pick ' + pct(x.g / (g * per)) : ''}</div></span>
      <span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span></span></button>`;
  });
  return html + '</div>';
}

const tierBadge = t => t ? `<span class="tier ${t} inline">${t}</span>` : '';
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];
const TIER_HINT = { S: 'les plus forts', A: 'très bons', B: 'solides', C: 'en dessous', D: 'à éviter' };
function viewBrawlers() {
  const modes = playedModes();
  if (S.bmode && !modes.includes(S.bmode)) S.bmode = '';
  const mode = S.bmode, T = tiers(mode);
  let total = 0;
  const list = D.meta.brawlers.map(b => {
    const [g, w] = bStat(String(b.id), mode); total += g;
    return { ...b, sid: String(b.id), g, w, o: g ? w / g : 0, s: smooth(g, w, 0.5, 60) };
  }).filter(b => !S.search || b.name.toLowerCase().includes(S.search.toLowerCase()));
  let html = `<div class="section-head"><h1>Brawlers</h1><span class="muted small">${mode ? esc(modeName(mode)) + ' · ' : ''}${S.q === 'r' ? 'Classé' : 'Trophées'} · ${D.meta.window_days} derniers jours</span></div>
    ${modeChips('bmode', mode, modes)}
    <div class="section-head"><div class="seg" role="group" aria-label="Affichage"><button data-action="bview" data-k="tiers" aria-pressed="${S.bview === 'tiers'}">Tier list</button><button data-action="bview" data-k="table" aria-pressed="${S.bview === 'table'}">Tableau</button></div></div>
    <input class="search" id="search" placeholder="Rechercher un brawler" value="${esc(S.search)}" aria-label="Rechercher un brawler">`;
  return html + (S.bview === 'table' ? brawlerTable(list, T, total) : tierRows(list, T, mode));
}
function tierRows(list, T, mode) {
  let html = '';
  for (const t of TIER_ORDER) {
    const row = list.filter(b => T[b.sid] === t).sort((a, b) => b.s - a.s);
    if (!row.length) continue;
    html += `<div class="tierrow"><div class="tierlabel ${t}"><b>${t}</b><small>${TIER_HINT[t]}</small></div><div class="tiercells">${row.map(b => `<button class="tcell" data-action="brawler" data-id="${b.sid}" title="${esc(b.name)}">${av(b.sid)}<span class="wr ${wrCls(b.s)}">${Math.round(b.s * 100)}%</span></button>`).join('')}</div></div>`;
  }
  const rest = list.filter(b => !T[b.sid]);
  if (rest.length) html += `<details class="card"><summary class="small muted">${rest.length} brawlers avec moins de ${minTier(mode)} parties${mode ? ' dans ce mode' : ''}</summary><div class="grid">${rest.map(b => `<button class="gcell" data-action="brawler" data-id="${b.sid}">${av(b.sid)}<span class="nm">${esc(b.name)}</span><span class="muted small">${b.g} p.</span></button>`).join('')}</div></details>`;
  return html || '<div class="card empty">Pas encore assez de parties.</div>';
}
function brawlerTable(list, T, total) {
  const keyed = { win: b => b.g >= 30 ? b.s : -1, pick: b => b.g, raw: b => b.g >= 30 ? b.o : -1, az: null };
  const k = keyed[S.sort] !== undefined ? S.sort : 'win';
  list.sort(k === 'az' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => keyed[k](b) - keyed[k](a));
  const th = (key, label) => `<button class="th" data-action="sort" data-k="${key}" aria-pressed="${k === key}">${label}${k === key ? ' ▾' : ''}</button>`;
  return `<div class="card table"><div class="trow head">${th('az', 'Brawler')}${th('win', 'Win rate')}${th('pick', 'Picks')}</div>
    ${list.map((b, i) => `<button class="trow" data-action="brawler" data-id="${b.sid}"><span class="tb"><span class="muted small rank">${i + 1}</span>${av(b.sid, 'sm')}<span class="name">${esc(b.name)}</span>${tierBadge(T[b.sid])}</span>
      <span class="wr ${b.g >= 30 ? wrCls(b.s) : 'mid'}">${b.g >= 30 ? pct(b.s) : '—'}</span>
      <span class="pk"><span class="bar"><i style="width:${total ? Math.min(100, b.g / total * 100 * 12) : 0}%"></i></span><span class="small muted">${total ? pct(b.g / total) : '—'}</span></span></button>`).join('')}</div>
    <div class="muted small">Picks : part de toutes les apparitions de brawlers sur la période. Win rate lissé vers 50 % pour les petits échantillons.</div>`;
}

function brawlerSheet(id, fam = S.fam || 'general') {
  const b = D.byId[id], v = Q().b[id] || [0, 0, 0], o = overall(id);
  const T = tiers()[id];
  const modes = Object.entries(Q().bm[id] || {}).filter(([, x]) => x[0] >= 10).map(([m, x]) => ({ m, g: x[0], s: smooth(x[0], x[1], o, 15) })).sort((a, b) => b.s - a.s);
  const maps = Object.keys(Q().be[id] || {}).map(e => ({ e, ...mapWr(id, e) })).filter(x => x.g >= MIN_MAP).sort((a, b) => b.s - a.s);
  const mus = Object.keys(Q().mu[id] || {}).map(e => ({ e, ...muWr(id, e) })).filter(x => x.g >= MIN_MU);
  const counters = mus.filter(x => x.s < o - 0.01).sort((a, b) => a.s - b.s).slice(0, 6);
  const beats = mus.filter(x => x.s > o + 0.01).sort((a, b) => b.s - a.s).slice(0, 6);
  const mates = Object.keys(Q().sy[id] || {}).map(e => ({ e, ...syWr(id, e) })).filter(x => x.g >= MIN_MU).sort((a, b) => b.s - a.s).slice(0, 6);
  const mine = D.players[S.tag]?.profile?.brawlers.find(x => String(x.id) === id);
  const muRow = (x, label) => `<button class="row" data-action="brawler" data-id="${x.e}">${av(x.e, 'sm')}<span style="min-width:0"><div class="name">${esc(D.byId[x.e]?.name)}</div><div class="sub">${num(x.g)} parties ${label}</div></span><span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span><span class="small muted">${signed(x.s - o)}</span></span></button>`;
  return `<div class="sheet-head"><div class="hero">${av(id, 'lg')}<div><h1>${esc(b?.name)}</h1>
      <div class="small muted">${T ? `Tier ${T} · ` : ''}${S.q === 'r' ? 'Classé' : 'Trophées'}${mine ? ` · ton niveau ${mine.power}` : ''}</div></div></div><button class="x" data-close aria-label="Fermer">×</button></div>
    <div class="kpis"><div class="kpi"><small>Win rate</small><b class="wr ${wrCls(o)}">${v[0] ? pct(o) : '—'}</b></div><div class="kpi"><small>Parties</small><b>${num(v[0])}</b></div><div class="kpi"><small>Star player</small><b>${v[1] ? pct(v[2] / v[1]) : '—'}</b><small>des victoires</small></div></div>
    ${v[0] < MIN_TIER ? '<div class="notice">Peu de parties pour ce brawler dans cette file : les chiffres sont encore indicatifs.</div>' : ''}
    <div class="card"><h3>Meilleurs modes</h3>${modes.length ? `<div class="modegrid">${modes.map(x => `<div class="modecell">${modeIcon(x.m, 'mico lg')}<span class="small">${esc(modeName(x.m))}</span><b class="wr ${wrCls(x.s)}">${pct(x.s)}</b><span class="small muted">${num(x.g)} parties</span></div>`).join('')}</div>` : '<div class="muted small">Pas assez de données.</div>'}</div>
    <div class="card"><h3>Meilleures maps</h3><div class="rows">${maps.slice(0, 6).map(x => `<button class="row" data-action="map" data-id="${x.e}"><span class="av sm"><img src="${img.map(x.e)}" alt="" loading="lazy" onerror="this.remove()"></span><span style="min-width:0"><div class="name">${esc(eventOf(x.e).map || x.e)}</div><div class="sub">${modeIcon(eventOf(x.e).mode)}${esc(modeName(eventOf(x.e).mode))} · ${num(x.g)} parties</div></span><span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span></span></button>`).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    <div class="two">
      <div class="card"><h3>Ses counters</h3><div class="muted small">Contre eux, ${esc(b?.name)} gagne le moins.</div><div class="rows">${counters.map(x => muRow(x, 'face à lui')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
      <div class="card"><h3>Il les contre</h3><div class="muted small">Ses matchups les plus favorables.</div><div class="rows">${beats.map(x => muRow(x, 'face à lui')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    </div>
    <div class="card"><h3>Meilleurs coéquipiers</h3><div class="rows">${mates.map(x => muRow(x, 'ensemble')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    ${stuffCard(id, fam)}`;
}

/* ---------- recommended equipment ---------- */
const FAMILIES = {
  general: { label: 'Général', modes: [] },
  control: { label: 'Contrôle', modes: ['gemGrab', 'hotZone'], why: 'il faut tenir la zone longtemps' },
  ball: { label: 'Ball', modes: ['brawlBall', 'basketBrawl', 'brawlHockey', 'volleyBrawl', 'airHockey'], why: 'la vitesse et la survie font marquer' },
  heist: { label: 'Braquage', modes: ['heist', 'siege', 'payload'], why: 'chaque point de dégâts sur le coffre compte' },
  elim: { label: 'Élimination', modes: ['bounty', 'knockout', 'knockout5V5', 'wipeout', 'deathmatch', 'duels'], why: 'on gagne en éliminant sans mourir' },
  showdown: { label: 'Survivant', modes: ['soloShowdown', 'duoShowdown', 'trioShowdown'], why: 'il faut durer et voir venir' }
};
const familyOf = mode => Object.keys(FAMILIES).find(k => FAMILIES[k].modes.includes(mode)) || 'general';
/* How much each gear matters per situation; brawler-specific gears keep weight 1 */
const GEAR_W = {
  general: { DAMAGE: 1, SHIELD: 1, 'GADGET COOLDOWN': .8, HEALTH: .8, SPEED: .8, VISION: .7 },
  control: { SHIELD: 1.25, DAMAGE: 1, 'GADGET COOLDOWN': 1, HEALTH: .9, SPEED: .6, VISION: .7 },
  ball: { SPEED: 1.3, SHIELD: 1.15, DAMAGE: .9, HEALTH: .8, 'GADGET COOLDOWN': .7, VISION: .5 },
  heist: { DAMAGE: 1.3, SPEED: 1.1, SHIELD: .85, HEALTH: .7, 'GADGET COOLDOWN': .7, VISION: .4 },
  elim: { DAMAGE: 1.15, VISION: 1.1, SHIELD: 1, HEALTH: .8, 'GADGET COOLDOWN': .8, SPEED: .6 },
  showdown: { HEALTH: 1.25, SHIELD: 1.1, VISION: 1.05, DAMAGE: .9, SPEED: .9, 'GADGET COOLDOWN': .7 }
};
const GEAR_FR = { DAMAGE: 'Dégâts', SHIELD: 'Bouclier', SPEED: 'Vitesse', VISION: 'Vision', HEALTH: 'Santé', 'GADGET COOLDOWN': 'Recharge gadget', 'SUPER CHARGE': 'Charge du super', 'RELOAD SPEED': 'Rechargement', 'PET POWER': 'Puissance du familier' };
const GEAR_WHY = { DAMAGE: '+dégâts quand tu es sous 50 % de vie', SHIELD: 'bouclier qui se recharge hors combat', SPEED: 'plus rapide dans les buissons', VISION: 'révèle les ennemis touchés dans les buissons', HEALTH: 'soin plus rapide hors combat', 'GADGET COOLDOWN': 'gadget plus souvent disponible' };
const gearName = g => GEAR_FR[g] || g.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
function stuffCard(id, fam) {
  const b = D.byId[id], e = D.equip?.[id], mine = D.players[S.tag]?.profile?.brawlers.find(x => String(x.id) === id);
  const noff = `<a class="ext" href="https://www.noff.gg/brawl-stars/brawler/${slug(b?.name || '')}" target="_blank" rel="noopener">Comparer avec les builds de Noff.gg ↗</a>`;
  const tabs = `<div class="chips">${Object.entries(FAMILIES).map(([k, f]) => `<button class="chip" data-action="fam" data-id="${id}" data-k="${k}" aria-pressed="${k === fam}">${f.label}</button>`).join('')}</div>`;
  const has = (kind, pid) => !mine ? null : (kind === 'sp' ? mine.starPowers : mine.gadgets).includes(Number(pid));
  /* Every gadget / star power of the brawler as an icon tile, the most chosen one flagged */
  const tiles = (kind, data, list) => {
    if (!list?.length) return '<div class="muted small">Aucun.</div>';
    const share = Object.fromEntries((data?.pick || []).map(([id, r]) => [String(id), r]));
    const best = data?.n ? String(data.pick[0][0]) : null;
    return `<div class="items">${list.map(x => {
      const id = String(x.id), r = share[id], h = has(kind, id);
      return `<div class="item ${id === best ? 'best' : ''}">${icon(kind === 'sp' ? img.sp(id) : img.gadget(id), 'iico')}
        <span class="iname">${esc(x.name)}</span>
        ${id === best ? '<span class="tag">conseillé</span>' : ''}
        <span class="small muted">${r != null ? pct(r) + ' des joueurs' : 'pas assez de données'}</span>
        ${h === false ? '<span class="small" style="color:var(--warn)">pas débloqué</span>' : h ? '<span class="small" style="color:var(--good)">tu l’as</span>' : ''}</div>`;
    }).join('')}</div>`;
  };
  const W = GEAR_W[fam];
  const gears = (e?.gears || []).map(([g, r]) => ({ g, r, s: r * (W[g] ?? 1) })).sort((a, b) => b.s - a.s).slice(0, 4);
  const famWhy = FAMILIES[fam].why;
  const thin = !e || (!e.sp.n && !e.gadget.n && !e.gears.length);
  return `<div class="card"><div class="section-head"><h3>Stuff recommandé</h3><span class="small muted">${thin ? 'données en cours de collecte' : num(e.owners) + ' profils analysés'}</span></div>${tabs}
    <div><div class="small muted">Gadgets</div>${tiles('gadget', e?.gadget, b?.gadgets)}</div>
    <div><div class="small muted">Star powers</div>${tiles('sp', e?.sp, b?.starPowers)}</div>
    <div><div class="small muted">Gears ${fam === 'general' ? '' : '· ' + esc(FAMILIES[fam].label.toLowerCase()) + ' : ' + esc(famWhy)}</div>
      ${gears.length ? `<div class="items">${gears.map((x, i) => `<div class="item ${i < 2 ? 'best' : ''}">${icon(img.gear(x.g), 'iico')}<span class="iname">${esc(gearName(x.g))}</span>
        <span class="tag ${i < 2 ? '' : 'alt'}">${i < 2 ? 'slot ' + (i + 1) : 'option'}</span><span class="small muted">${esc(GEAR_WHY[x.g] || 'gear propre à ce brawler')}</span><span class="small muted">${pct(x.r)} des niv. 8+</span></div>`).join('')}</div>` : '<div class="muted small">Pas assez de données.</div>'}</div>
    <div class="muted small">Gadget et star power : ce que les joueurs débloquent en premier quand ils n’en ont qu’un. Gears : ceux qu’ils achètent, pondérés selon la situation. Le jeu ne donne pas l’équipement utilisé en partie.</div>
    ${noff}</div>`;
}

/* ---------- draft ---------- */
function draftScores() {
  const d = S.draft, taken = new Set([...d.allies, ...d.enemies, ...d.bans].map(String));
  const own = d.owned ? owned() : null;
  const out = [];
  for (const b of D.meta.brawlers) {
    const id = String(b.id);
    if (taken.has(id) || games(id) < 30 || (own && !own.has(id))) continue;
    const o = overall(id), parts = [];
    let est = o;
    const m = d.map ? mapWr(id, d.map) : null;
    if (m && m.g >= 3) { est += m.s - o; parts.push(['Map', m.s - o]); }
    for (const e of d.enemies) { const x = muWr(id, e); if (x && x.g >= 5) { est += x.s - o; parts.push(['vs ' + (D.byId[e]?.name || e), x.s - o]); } }
    for (const a of d.allies) { const x = syWr(id, a); if (x && x.g >= 5) { est += (x.s - o) * 0.5; parts.push(['avec ' + (D.byId[a]?.name || a), (x.s - o) * 0.5]); } }
    out.push({ id, est, o, parts, conf: (m?.g || 0) });
  }
  return out.sort((a, b) => b.est - a.est);
}
function viewDraft() {
  const d = S.draft, ev = d.map ? eventOf(d.map) : null;
  const slot = (list, i, kind) => {
    const id = list[i];
    return `<button class="slot ${kind} ${id ? 'filled' : ''}" data-action="slot" data-kind="${kind}" data-i="${i}">${id ? av(id) + `<span>${esc(D.byId[id]?.name)}</span>` : `<span style="font-size:22px">+</span><span>${kind === 'ally' ? 'Allié' : 'Ennemi'}</span>`}</button>`;
  };
  const res = draftScores().slice(0, 12);
  const ownAvail = !!D.players[S.tag]?.profile;
  return `<div class="section-head"><h1>Draft</h1><button class="link" data-action="draft-reset">Tout effacer</button></div>
    <button class="card" data-action="pick-map" style="text-align:left;grid-template-columns:64px 1fr;align-items:center">
      <span class="av" style="width:64px;height:64px">${d.map ? `<img src="${img.map(d.map)}" alt="" onerror="this.remove()">` : '?'}</span>
      <span><b>${ev ? esc(ev.map) : 'Choisir la map'}</b><div class="small muted">${ev ? modeIcon(ev.mode) + esc(modeName(ev.mode)) + ' · ' + num(mapGames(d.map)) + ' parties' : 'Les suggestions tiennent compte de la map'}</div></span></button>
    <div class="card"><h3>Ton équipe</h3><div class="slots">${slot(d.allies, 0, 'ally')}${slot(d.allies, 1, 'ally')}<div class="slot filled" style="border-color:var(--accent)"><span style="font-size:22px">★</span><span>Toi</span></div></div>
      <h3>En face</h3><div class="slots">${slot(d.enemies, 0, 'enemy')}${slot(d.enemies, 1, 'enemy')}${slot(d.enemies, 2, 'enemy')}</div>
      <div class="section-head"><span class="small muted">Bans : ${d.bans.length ? d.bans.map(b => esc(D.byId[b]?.name)).join(', ') : 'aucun'}</span><button class="link" data-action="slot" data-kind="ban" data-i="${d.bans.length}">+ Ban</button></div>
      ${ownAvail ? `<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ownedOnly" ${d.owned ? 'checked' : ''}> Seulement mes brawlers niveau 9+</label>` : ''}
    </div>
    <div class="card"><div class="section-head"><h3>Meilleurs picks</h3><span class="small muted">win rate estimé</span></div><div class="rows">
    ${res.map((x, i) => `<button class="row" data-action="brawler" data-id="${x.id}"><span style="display:flex;gap:10px;align-items:center"><span class="muted small" style="width:18px">${i + 1}</span>${av(x.id, 'sm')}</span>
      <span style="min-width:0"><div class="name">${esc(D.byId[x.id]?.name)}</div><div class="reason">${x.parts.map(([l, v]) => `<span class="${v >= 0 ? 'p' : 'n'}">${esc(l)} ${signed(v)}</span>`).join('') || '<span>moyenne générale</span>'}</div></span>
      <span class="right"><span class="score wr ${wrCls(x.est)}">${Math.round(x.est * 100)}%</span></span></button>`).join('')}
    </div></div>`;
}
function pickerSheet(kind, i) {
  const title = kind === 'ally' ? 'Choisir un allié' : kind === 'enemy' ? 'Choisir un ennemi' : 'Bannir un brawler';
  const cur = kind === 'ally' ? S.draft.allies[i] : kind === 'enemy' ? S.draft.enemies[i] : null;
  const list = [...D.meta.brawlers].sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="sheet-head"><h2>${title}</h2><button class="x" data-close aria-label="Fermer">×</button></div>
    <input class="search" id="pickSearch" placeholder="Rechercher" aria-label="Rechercher un brawler">
    ${cur ? `<button class="btn ghost" data-action="pick" data-kind="${kind}" data-i="${i}" data-id="">Retirer ${esc(D.byId[cur]?.name)}</button>` : ''}
    <div class="grid" id="pickGrid">${list.map(b => `<button class="gcell" data-action="pick" data-kind="${kind}" data-i="${i}" data-id="${b.id}" data-name="${esc(b.name.toLowerCase())}">${av(b.id)}<span class="nm">${esc(b.name)}</span></button>`).join('')}</div>`;
}
function mapPickerSheet() {
  const every = Object.entries(Q().ev).sort((a, b) => b[1] - a[1]).map(([id, g]) => ({ id, g, ...eventOf(id) })).filter(x => x.map);
  const modes = [...new Set(every.map(x => x.mode))];
  const all = every.filter(x => !S.mpMode || x.mode === S.mpMode);
  const rot = new Set(D.meta.rotation.map(r => String(r.id)));
  return `<div class="sheet-head"><h2>Choisir la map</h2><button class="x" data-close aria-label="Fermer">×</button></div>
    <input class="search" id="mapSearch" placeholder="Rechercher une map" aria-label="Rechercher une map">
    ${modeChips('mpmode', S.mpMode, modes)}
    <div class="rows" id="mapRows">${all.map(x => `<button class="row" data-action="set-map" data-id="${x.id}" data-name="${esc((x.map + ' ' + modeName(x.mode)).toLowerCase())}"><span class="av sm"><img src="${img.map(x.id)}" alt="" loading="lazy" onerror="this.remove()"></span><span style="min-width:0"><div class="name">${esc(x.map)}${rot.has(x.id) ? ' <span class="mode-pill">en rotation</span>' : ''}</div><div class="sub">${modeIcon(x.mode)}${esc(modeName(x.mode))}</div></span><span class="right small muted">${num(x.g)}</span></button>`).join('')}</div>`;
}

/* ---------- account ---------- */
function viewCompte() {
  const tracked = D.meta.tracked || [];
  if (!S.tag) S.tag = tracked[0];
  const p = D.players[S.tag];
  const head = `<div class="section-head"><h1>Mon compte</h1>${tracked.length > 1 ? `<select id="tagSel" class="chip">${tracked.map(t => `<option value="${t}" ${t === S.tag ? 'selected' : ''}>#${t}</option>`).join('')}</select>` : ''}</div>`;
  if (p === undefined) { loadPlayer(S.tag).then(render); return head + '<div class="loading">Chargement…</div>'; }
  if (!p) return head + `<div class="card empty">Aucune donnée pour #${esc(S.tag || '')}. Le compte doit être ajouté dans config.json du collecteur.</div>`;
  const pr = p.profile || {};
  const hist = p.history.filter(h => queueOfType(h.type) === S.q && isDecided(h));
  const wins = hist.filter(isWin).length;
  const first = p.history.length ? p.history[p.history.length - 1].t : null;
  let html = head + `<div class="card"><div class="hero">${pr.icon ? `<span class="av lg"><img src="https://cdn.brawlify.com/profile-icons/regular/${pr.icon}.png" alt="" onerror="this.remove()">${esc((pr.name || '?').slice(0, 2))}</span>` : ''}
      <div><h1>${esc(pr.name || '#' + S.tag)}</h1><div class="small muted">#${esc(S.tag)}${pr.club ? ' · ' + esc(pr.club) : ''}</div></div></div>
      <div class="kpis"><div class="kpi"><small>Trophées</small><b>${num(pr.trophies)}</b><small>record ${num(pr.highest)}</small></div>
      <div class="kpi"><small>Win rate ${S.q === 'r' ? 'Classé' : 'Trophées'}</small><b class="wr ${hist.length ? wrCls(wins / hist.length) : 'mid'}">${hist.length ? pct(wins / hist.length) : '—'}</b><small>${hist.length} parties suivies</small></div>
      <div class="kpi"><small>Brawlers</small><b>${pr.brawlers?.length || 0}</b><small>${pr.brawlers?.filter(b => b.power >= 11).length || 0} niveau 11</small></div></div>
      <div class="small muted">Historique gardé depuis le ${first ? esc(fmtDate(first)) : '—'} : le jeu n’en montre que 25, l’appli garde tout.</div></div>`;
  html += rotationRecos();
  if (!hist.length) return html + `<div class="card empty">Pas encore de parties ${S.q === 'r' ? 'classées' : 'en trophées'} enregistrées. Change de file en haut, ou joue quelques parties.</div>`;

  const byB = {};
  for (const h of hist) { const x = byB[h.brawler] ||= { g: 0, w: 0, maps: {} }; x.g++; x.w += isWin(h) ? 1 : 0; }
  const rowsB = Object.entries(byB).map(([id, x]) => ({ id, ...x, wr: x.w / x.g, meta: overall(id) })).sort((a, b) => b.g - a.g);
  const weak = rowsB.filter(x => x.g >= 4 && x.wr < x.meta - 0.1).sort((a, b) => (a.wr - a.meta) - (b.wr - b.meta)).slice(0, 4);
  const strong = rowsB.filter(x => x.g >= 4 && x.wr > x.meta + 0.05).sort((a, b) => (b.wr - b.meta) - (a.wr - a.meta)).slice(0, 4);
  const cmp = x => `<button class="row" data-action="brawler" data-id="${x.id}">${av(x.id, 'sm')}<span style="min-width:0"><div class="name">${esc(D.byId[x.id]?.name)}</div><div class="sub">${x.g} parties · méta ${pct(x.meta)}</div></span><span class="right"><span class="wr ${wrCls(x.wr)}">${pct(x.wr)}</span><span class="small muted">${signed(x.wr - x.meta)}</span></span></button>`;
  if (weak.length || strong.length) html += `<div class="two">
    <div class="card"><h3>Tes points forts</h3><div class="muted small">Tu fais mieux que la moyenne du top.</div><div class="rows">${strong.map(cmp).join('') || '<div class="muted small">Joue au moins 4 parties avec un brawler.</div>'}</div></div>
    <div class="card"><h3>À travailler</h3><div class="muted small">Nettement sous la moyenne du top.</div><div class="rows">${weak.map(cmp).join('') || '<div class="muted small">Rien d’alarmant.</div>'}</div></div></div>`;

  const byM = {};
  for (const h of hist) { const x = byM[h.mode] ||= { g: 0, w: 0 }; x.g++; x.w += isWin(h) ? 1 : 0; }
  html += `<div class="card"><h3>Par mode</h3><div class="rows">${Object.entries(byM).sort((a, b) => b[1].g - a[1].g).map(([m, x]) => `<div class="row">${modePill(m)}<span><div class="bar"><i style="width:${x.w / x.g * 100}%"></i></div></span><span class="right"><span class="wr ${wrCls(x.w / x.g)}">${pct(x.w / x.g)}</span><span class="small muted">${x.g} parties</span></span></div>`).join('')}</div></div>`;
  html += `<div class="card"><h3>Tes brawlers</h3><div class="rows">${rowsB.slice(0, 15).map(cmp).join('')}</div></div>`;
  html += `<div class="card"><h3>Dernières parties</h3><div class="rows">${hist.slice(0, 20).map(h => `<div class="row"><span style="display:flex;gap:8px;align-items:center"><span class="res ${isWin(h) ? 'v' : 'd'}"></span>${av(h.brawler, 'sm')}</span>
    <span style="min-width:0"><div class="name">${esc(h.map || '')}</div><div class="sub">${modeIcon(h.mode)}${esc(modeName(h.mode))}${h.rank ? ' · ' + h.rank + 'e' : ''}${h.star ? ' · ★ star player' : ''}${h.enemies?.length ? ' · contre ' + h.enemies.map(e => esc(D.byId[e]?.name || '')).join(', ') : ''}</div></span>
    <span class="right small">${h.tc ? `<span class="wr ${h.tc > 0 ? 'hi' : 'lo'}">${h.tc > 0 ? '+' : ''}${h.tc}</span>` : ''}<span class="muted">${esc(fmtDate(h.t))}</span></span></div>`).join('')}</div></div>`;
  return html;
}
function fmtDate(t) { const d = new Date(t.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*$/, '$1-$2-$3T$4:$5:$6Z')); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
function rotationRecos() {
  const own = owned();
  if (!own) return '';
  const maps = mapList().filter(m => !isShowdown(m.mode)).slice(0, 6);
  if (!maps.length) return '';
  let html = `<div class="card"><div class="section-head"><h3>Quoi jouer ${S.q === 'r' ? 'en Classé' : 'maintenant'}</h3><span class="small muted">parmi tes brawlers niveau 9+</span></div><div class="rows">`;
  for (const m of maps) {
    const picks = Object.keys(Q().be).filter(id => own.has(id)).map(id => ({ id, ...mapWr(id, m.id) })).filter(x => x.g >= MIN_MAP).sort((a, b) => b.s - a.s).slice(0, 3);
    html += `<button class="row" data-action="map" data-id="${esc(m.id)}"><span class="av sm"><img src="${img.map(m.id)}" alt="" loading="lazy" onerror="this.remove()"></span>
      <span style="min-width:0"><div class="name">${esc(m.map)}</div><div class="sub">${modeIcon(m.mode)}${esc(modeName(m.mode))}</div></span>
      <span class="picks">${picks.map(x => `<span class="pick">${av(x.id, 'sm')}<span class="wr ${wrCls(x.s)}">${Math.round(x.s * 100)}%</span></span>`).join('') || '<span class="small muted">—</span>'}</span></button>`;
  }
  return html + '</div></div>';
}

/* ---------- shell ---------- */
function render() {
  if (!D.stats) return;
  document.querySelectorAll('#queueSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.q === S.q));
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.view === S.view ? 'page' : 'false'));
  $('#fresh').textContent = `${num(D.meta.games[S.q])} parties ${S.q === 'r' ? 'classées' : 'en trophées'} · top mondial et France · ${D.meta.window_days} derniers jours · mis à jour ${ago(D.meta.generated)}`;
  const v = { maps: viewMaps, brawlers: viewBrawlers, draft: viewDraft, compte: viewCompte }[S.view] || viewMaps;
  const fid = ['search', 'mapFilter'].includes(document.activeElement?.id) ? document.activeElement.id : null;
  const focus = fid ? document.activeElement.selectionStart : null;
  $('#main').innerHTML = `<div style="display:grid;gap:14px">${v()}</div>`;
  if (fid && $('#' + fid)) { $('#' + fid).focus(); $('#' + fid).setSelectionRange(focus, focus); }
}
let sheetFn = null;
function openSheet(fn) { sheetFn = fn; $('#sheet').innerHTML = fn(); $('#sheetWrap').hidden = false; $('#sheet').scrollTop = 0; }
function closeSheet() { $('#sheetWrap').hidden = true; sheetFn = null; }
function saveDraft() { LS.set('draft', S.draft); }

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-close]');
  if (!t) return;
  if (t.hasAttribute('data-close')) return closeSheet();
  if (t.dataset.q) { S.q = t.dataset.q; LS.set('q', S.q); render(); if (sheetFn) openSheet(sheetFn); return; }
  if (t.dataset.view && t.closest('#tabs')) { S.view = t.dataset.view; LS.set('view', S.view); render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.action, id = t.dataset.id;
  switch (a) {
    case 'map': S.fam = familyOf(eventOf(id).mode); openSheet(() => mapSheet(id)); break;
    case 'brawler': { const f = t.closest('#sheet') ? S.fam : t.closest('#main') && S.view === 'draft' && S.draft.map ? familyOf(eventOf(S.draft.map).mode) : 'general'; S.fam = f; openSheet(() => brawlerSheet(id, f)); break; }
    case 'fam': S.fam = t.dataset.k; { const top = $('#sheet').scrollTop; openSheet(() => brawlerSheet(id, S.fam)); $('#sheet').scrollTop = top; } break;
    case 'sort': S.sort = t.dataset.k; render(); break;
    case 'mode': S.mode = t.dataset.k; LS.set('mode', S.mode); render(); break;
    case 'bmode': S.bmode = t.dataset.k; LS.set('bmode', S.bmode); render(); break;
    case 'bview': S.bview = t.dataset.k; LS.set('bview', S.bview); render(); break;
    case 'scope': S.mapScope = t.dataset.k; LS.set('mapScope', S.mapScope); render(); break;
    case 'msort': { S.mapSort = t.dataset.k; const top = $('#sheet').scrollTop; openSheet(() => mapSheet(id)); $('#sheet').scrollTop = top; break; }
    case 'mpmode': S.mpMode = t.dataset.k; openSheet(mapPickerSheet); break;
    case 'draft-map': S.draft.map = id; saveDraft(); closeSheet(); S.view = 'draft'; LS.set('view', 'draft'); render(); window.scrollTo(0, 0); break;
    case 'pick-map': openSheet(mapPickerSheet); break;
    case 'set-map': S.draft.map = id; saveDraft(); closeSheet(); render(); break;
    case 'slot': { const k = t.dataset.kind, i = Number(t.dataset.i); openSheet(() => pickerSheet(k, i)); break; }
    case 'pick': {
      const k = t.dataset.kind, i = Number(t.dataset.i), list = k === 'ally' ? S.draft.allies : k === 'enemy' ? S.draft.enemies : S.draft.bans;
      if (id) list[i] = id; else list.splice(i, 1);
      for (let j = list.length - 1; j >= 0; j--) if (!list[j]) list.splice(j, 1);
      saveDraft(); closeSheet(); render(); break;
    }
    case 'draft-reset': S.draft = { map: null, allies: [], enemies: [], bans: [], owned: S.draft.owned }; saveDraft(); render(); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'search') { S.search = e.target.value; render(); }
  if (e.target.id === 'mapFilter') { S.mapSearch = e.target.value; render(); }
  if (e.target.id === 'pickSearch' || e.target.id === 'mapSearch') {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll(e.target.id === 'pickSearch' ? '#pickGrid [data-name]' : '#mapRows [data-name]').forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'ownedOnly') { S.draft.owned = e.target.checked; saveDraft(); render(); }
  if (e.target.id === 'tagSel') { S.tag = e.target.value; LS.set('tag', S.tag); render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetFn) closeSheet(); });

async function boot() {
  try {
    const [meta, stats] = await Promise.all(['meta', 'stats'].map(n => fetch(`data/${n}.json`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
    D.meta = meta; D.stats = stats;
    for (const b of meta.brawlers) D.byId[b.id] = b;
    if (!S.tag || !(meta.tracked || []).includes(S.tag)) S.tag = (meta.tracked || [])[0] || null;
    if (S.q === 'r' && meta.games.r < 500 && meta.games.t > meta.games.r) S.q = 't';
    fetch('data/equip.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(x => { D.equip = x; }).catch(() => {});
    if (S.tag) loadPlayer(S.tag).then(render);
    render();
  } catch (e) {
    $('#main').innerHTML = '<div class="card empty">Impossible de charger les stats. Vérifie ta connexion puis recharge la page.</div>';
  }
}
boot();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
