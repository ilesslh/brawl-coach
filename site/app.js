(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + ' %';
const num = n => (n || 0).toLocaleString('fr-FR');
const signed = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1).replace('.', ',');
const LS = { get(k, d) { try { const v = localStorage.getItem('bc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('bc.' + k, JSON.stringify(v)); } catch (e) {} } };
const img = { brawler: id => `https://cdn.brawlify.com/brawlers/borderless/${id}.png`, map: id => `https://cdn.brawlify.com/maps/regular/${id}.png` };
const MODES = {
  gemGrab: 'Razzia de gemmes', brawlBall: 'Brawl Ball', heist: 'Braquage', bounty: 'Prime', hotZone: 'Zone réservée', knockout: 'Hors-jeu',
  soloShowdown: 'Survivant solo', duoShowdown: 'Survivant duo', trioShowdown: 'Survivant trio', wipeout: 'Élimination', duels: 'Duels',
  basketBrawl: 'Basket Brawl', volleyBrawl: 'Volley Brawl', brawlHockey: 'Hockey Brawl', payload: 'Convoi', siege: 'Siège', paintBrawl: 'Paint Brawl',
  trophyThieves: 'Voleurs de trophées', holdTheTrophy: 'Garde le trophée', dodgebrawl: 'Dodgebrawl', brawlArena: 'Brawl Arena',
  airHockey: 'Air Hockey', knockout5V5: 'Hors-jeu 5c5', deathmatch: 'Combat à mort', bossFight: 'Combat de boss', roboRumble: 'Robo-ravage'
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
const D = { meta: null, stats: null, players: {}, byId: {} };
const S = {
  q: LS.get('q', 'r'), view: LS.get('view', 'maps'), search: '', sort: 'tier',
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

function tiers() {
  const list = Object.entries(Q().b).filter(([, v]) => v[0] >= MIN_TIER).map(([id, v]) => ({ id, s: smooth(v[0], v[1], 0.5, 60) })).sort((a, b) => b.s - a.s);
  const out = {}, n = list.length;
  list.forEach((x, i) => { const r = i / n; out[x.id] = r < 0.1 ? 'S' : r < 0.3 ? 'A' : r < 0.6 ? 'B' : r < 0.85 ? 'C' : 'D'; });
  return out;
}

/* Maps to show for the current queue: Ranked uses the most played maps, Trophies the live rotation */
function mapList() {
  if (S.q === 't') {
    const rot = D.meta.rotation.filter(r => !/^(duels)$/.test(r.mode));
    const seen = new Set();
    return rot.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => ({ id: String(r.id), mode: r.mode, map: r.map, end: r.end, live: true }));
  }
  return Object.entries(Q().ev).filter(([, g]) => g >= 40).sort((a, b) => b[1] - a[1]).slice(0, 24)
    .map(([id]) => ({ id, ...eventOf(id) }));
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
  const maps = mapList();
  let html = `<div class="section-head"><h1>${S.q === 'r' ? 'Maps classées' : 'Maps en rotation'}</h1><span class="muted small">${S.q === 'r' ? 'les plus jouées en Classé' : 'touche une map pour le classement complet'}</span></div>`;
  if (!maps.length) return html + `<div class="card empty">Pas encore assez de parties pour cette file. Reviens après la prochaine collecte.</div>`;
  html += '<div class="maps">';
  for (const m of maps) {
    const top = topOnMap(m.id, 5), g = mapGames(m.id);
    html += `<button class="mapcard" data-action="map" data-id="${esc(m.id)}">
      <span class="thumb"><img src="${img.map(m.id)}" alt="" loading="lazy" onerror="this.remove()"></span>
      <span class="info">
        <span class="name">${esc(m.map || 'Map ' + m.id)}</span>
        <span><span class="mode-pill">${esc(modeName(m.mode))}</span> <span class="muted small">${num(g)} parties${m.end ? ' · finit ' + esc(endIn(m.end)) : ''}</span></span>
        <span class="picks">${top.length ? top.map(x => `<span class="pick">${av(x.id, 'sm')}<span class="wr ${wrCls(x.s)}">${Math.round(x.s * 100)}%</span></span>`).join('') : '<span class="muted small">Pas assez de données</span>'}</span>
      </span></button>`;
  }
  return html + '</div>';
}
function endIn(s) {
  const t = new Date(s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*$/, '$1-$2-$3T$4:$5:$6Z'));
  const h = Math.round((t - Date.now()) / 3600000);
  return h <= 0 ? 'bientôt' : h < 24 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}

function mapSheet(e) {
  const ev = eventOf(e), g = mapGames(e);
  const per = isShowdown(ev.mode) ? 1 : 6;
  const rows = Object.keys(Q().be).map(id => ({ id, ...mapWr(id, e) })).filter(x => x.g >= 3).sort((a, b) => b.s - a.s);
  const own = owned();
  let html = `<div class="sheet-head"><div><h2>${esc(ev.map || e)}</h2><span class="mode-pill">${esc(modeName(ev.mode))}</span> <span class="muted small">${num(g)} parties · ${S.q === 'r' ? 'Classé' : 'Trophées'}</span></div><button class="x" data-close aria-label="Fermer">×</button></div>
    <img src="${img.map(e)}" alt="" style="border-radius:14px;max-height:220px;object-fit:cover;width:100%" onerror="this.remove()">
    <button class="btn" data-action="draft-map" data-id="${esc(e)}">Préparer un draft sur cette map</button>
    <div class="muted small">Win rate lissé : les brawlers peu joués sont ramenés vers leur moyenne. Grisé = moins de ${MIN_MAP * 3} parties.</div><div class="rows">`;
  rows.forEach((x, i) => {
    html += `<button class="row" data-action="brawler" data-id="${x.id}" style="${x.g < MIN_MAP * 3 ? 'opacity:.55' : ''}">
      <span style="display:flex;gap:10px;align-items:center"><span class="muted small" style="width:20px">${i + 1}</span>${av(x.id, 'sm')}</span>
      <span style="min-width:0"><div class="name">${esc(D.byId[x.id]?.name)}${own?.has(x.id) ? ' <span class="mode-pill">à toi</span>' : ''}</div><div class="sub">${num(x.g)} parties · brut ${pct(x.w / x.g)}${per > 1 && g ? ' · pick ' + pct(x.g / (g * per)) : ''}</div></span>
      <span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span></span></button>`;
  });
  return html + '</div>';
}

function viewBrawlers() {
  const T = tiers();
  const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  let list = D.meta.brawlers.map(b => ({ ...b, sid: String(b.id), g: games(b.id), o: overall(b.id) }))
    .filter(b => !S.search || b.name.toLowerCase().includes(S.search.toLowerCase()));
  list.sort(S.sort === 'tier' ? (a, b) => (order[T[a.sid]] ?? 9) - (order[T[b.sid]] ?? 9) || smooth(b.g, b.o * b.g) - smooth(a.g, a.o * a.g)
    : S.sort === 'pick' ? (a, b) => b.g - a.g : (a, b) => a.name.localeCompare(b.name));
  let html = `<div class="section-head"><h1>Brawlers</h1><span class="muted small">${S.q === 'r' ? 'Classé' : 'Trophées'} · ${D.meta.window_days} derniers jours</span></div>
    <input class="search" id="search" placeholder="Rechercher un brawler" value="${esc(S.search)}" aria-label="Rechercher un brawler">
    <div class="chips">${[['tier', 'Tier list'], ['pick', 'Plus joués'], ['az', 'A → Z']].map(([k, l]) => `<button class="chip" data-action="sort" data-k="${k}" aria-pressed="${S.sort === k}">${l}</button>`).join('')}</div>
    <div class="grid">`;
  for (const b of list) {
    const t = T[b.sid];
    html += `<button class="gcell" data-action="brawler" data-id="${b.sid}"><span class="av">${t ? `<span class="tier ${t}">${t}</span>` : ''}<img src="${img.brawler(b.id)}" alt="" loading="lazy" onerror="this.remove()">${esc(b.name.slice(0, 2))}</span>
      <span class="nm">${esc(b.name)}</span><span class="wr ${b.g >= 30 ? wrCls(b.o) : 'mid'}">${b.g >= 30 ? Math.round(b.o * 100) + '%' : '—'}</span></button>`;
  }
  return html + '</div>';
}

function brawlerSheet(id) {
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
    <div class="card"><h3>Par mode</h3><div class="rows">${modes.length ? modes.map(x => `<div class="row"><span class="mode-pill">${esc(modeName(x.m))}</span><span><div class="bar"><i style="width:${Math.max(4, (x.s - 0.3) / 0.4 * 100)}%"></i></div></span><span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span><span class="small muted">${num(x.g)}</span></span></div>`).join('') : '<div class="muted small">Pas assez de données.</div>'}</div></div>
    <div class="card"><h3>Meilleures maps</h3><div class="rows">${maps.slice(0, 6).map(x => `<button class="row" data-action="map" data-id="${x.e}"><span class="av sm"><img src="${img.map(x.e)}" alt="" loading="lazy" onerror="this.remove()"></span><span style="min-width:0"><div class="name">${esc(eventOf(x.e).map || x.e)}</div><div class="sub">${esc(modeName(eventOf(x.e).mode))} · ${num(x.g)} parties</div></span><span class="right"><span class="wr ${wrCls(x.s)}">${pct(x.s)}</span></span></button>`).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    <div class="two">
      <div class="card"><h3>Ses counters</h3><div class="muted small">Contre eux, ${esc(b?.name)} gagne le moins.</div><div class="rows">${counters.map(x => muRow(x, 'face à lui')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
      <div class="card"><h3>Il les contre</h3><div class="muted small">Ses matchups les plus favorables.</div><div class="rows">${beats.map(x => muRow(x, 'face à lui')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    </div>
    <div class="card"><h3>Meilleurs coéquipiers</h3><div class="rows">${mates.map(x => muRow(x, 'ensemble')).join('') || '<div class="muted small">Pas assez de données.</div>'}</div></div>
    <div class="card"><h3>Build</h3>
      <div><div class="small muted">Gadgets</div><div class="chips">${(b?.gadgets || []).map(g => `<span class="chip">${esc(g.name)}${mine && !mine.gadgets.includes(g.id) ? ' <span class="muted">(pas débloqué)</span>' : ''}</span>`).join('') || '—'}</div></div>
      <div><div class="small muted">Star powers</div><div class="chips">${(b?.starPowers || []).map(g => `<span class="chip">${esc(g.name)}${mine && !mine.starPowers.includes(g.id) ? ' <span class="muted">(pas débloqué)</span>' : ''}</span>`).join('') || '—'}</div></div>
      <a class="ext" href="https://www.noff.gg/brawl-stars/brawler/${slug(b?.name || '')}" target="_blank" rel="noopener">Voir les builds recommandés sur Noff.gg ↗</a>
    </div>`;
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
      <span><b>${ev ? esc(ev.map) : 'Choisir la map'}</b><div class="small muted">${ev ? esc(modeName(ev.mode)) + ' · ' + num(mapGames(d.map)) + ' parties' : 'Les suggestions tiennent compte de la map'}</div></span></button>
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
  const all = Object.entries(Q().ev).sort((a, b) => b[1] - a[1]).map(([id, g]) => ({ id, g, ...eventOf(id) })).filter(x => x.map);
  const rot = new Set(D.meta.rotation.map(r => String(r.id)));
  return `<div class="sheet-head"><h2>Choisir la map</h2><button class="x" data-close aria-label="Fermer">×</button></div>
    <input class="search" id="mapSearch" placeholder="Rechercher une map" aria-label="Rechercher une map">
    <div class="rows" id="mapRows">${all.map(x => `<button class="row" data-action="set-map" data-id="${x.id}" data-name="${esc((x.map + ' ' + modeName(x.mode)).toLowerCase())}"><span class="av sm"><img src="${img.map(x.id)}" alt="" loading="lazy" onerror="this.remove()"></span><span style="min-width:0"><div class="name">${esc(x.map)}${rot.has(x.id) ? ' <span class="mode-pill">en rotation</span>' : ''}</div><div class="sub">${esc(modeName(x.mode))}</div></span><span class="right small muted">${num(x.g)}</span></button>`).join('')}</div>`;
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
  html += `<div class="card"><h3>Par mode</h3><div class="rows">${Object.entries(byM).sort((a, b) => b[1].g - a[1].g).map(([m, x]) => `<div class="row"><span class="mode-pill">${esc(modeName(m))}</span><span><div class="bar"><i style="width:${x.w / x.g * 100}%"></i></div></span><span class="right"><span class="wr ${wrCls(x.w / x.g)}">${pct(x.w / x.g)}</span><span class="small muted">${x.g} parties</span></span></div>`).join('')}</div></div>`;
  html += `<div class="card"><h3>Tes brawlers</h3><div class="rows">${rowsB.slice(0, 15).map(cmp).join('')}</div></div>`;
  html += `<div class="card"><h3>Dernières parties</h3><div class="rows">${hist.slice(0, 20).map(h => `<div class="row"><span style="display:flex;gap:8px;align-items:center"><span class="res ${isWin(h) ? 'v' : 'd'}"></span>${av(h.brawler, 'sm')}</span>
    <span style="min-width:0"><div class="name">${esc(h.map || '')}</div><div class="sub">${esc(modeName(h.mode))}${h.rank ? ' · ' + h.rank + 'e' : ''}${h.star ? ' · ★ star player' : ''}${h.enemies?.length ? ' · contre ' + h.enemies.map(e => esc(D.byId[e]?.name || '')).join(', ') : ''}</div></span>
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
      <span style="min-width:0"><div class="name">${esc(m.map)}</div><div class="sub">${esc(modeName(m.mode))}</div></span>
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
  const focus = document.activeElement?.id === 'search' ? document.activeElement.selectionStart : null;
  $('#main').innerHTML = `<div style="display:grid;gap:14px">${v()}</div>`;
  if (focus !== null && $('#search')) { $('#search').focus(); $('#search').setSelectionRange(focus, focus); }
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
    case 'map': openSheet(() => mapSheet(id)); break;
    case 'brawler': openSheet(() => brawlerSheet(id)); break;
    case 'sort': S.sort = t.dataset.k; render(); break;
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
    if (S.tag) loadPlayer(S.tag).then(render);
    render();
  } catch (e) {
    $('#main').innerHTML = '<div class="card empty">Impossible de charger les stats. Vérifie ta connexion puis recharge la page.</div>';
  }
}
boot();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
