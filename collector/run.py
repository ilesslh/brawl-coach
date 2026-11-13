"""Brawl Coach collector.

1. Crawl battle logs of top players (global + countries), tracked players and a sample of their opponents.
2. Store deduplicated compact battles per day in store/battles/YYYY-MM-DD.jsonl.gz.
3. Keep the full history of tracked players in store/players/<TAG>.json.
4. Aggregate the last N days into site/data/*.json for the web app.

Usage: python collector/run.py [--seed] [--no-collect]
"""
import datetime as dt
import gzip
import hashlib
import json
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
from api import Api, load_token  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE = os.path.join(ROOT, "store")
SITE_DATA = os.path.join(ROOT, "site", "data")
CONFIG = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))

RANKED_TYPES = {"soloRanked", "teamRanked"}   # competitive Ranked
TROPHY_TYPES = {"ranked"}                       # the API calls trophy matches "ranked"
SHOWDOWN_WIN_RANK = {"soloShowdown": 4, "duoShowdown": 2, "trioShowdown": 1}


def log(*a):
    print(*a, flush=True)


def clean_tag(t):
    return (t or "").strip().upper().lstrip("#")


def parse_time(s):
    return dt.datetime.strptime(s[:15], "%Y%m%dT%H%M%S").replace(tzinfo=dt.timezone.utc)


def queue_of(battle):
    t = battle.get("type")
    if t in RANKED_TYPES:
        return "r"
    if t in TROPHY_TYPES:
        return "t"
    return None


# ---------------------------------------------------------------- normalisation
def normalise(item, owner):
    """Return (key, record) for the shared battle store, or None to skip."""
    ev, b = item.get("event") or {}, item.get("battle") or {}
    q = queue_of(b)
    if not q or not ev.get("id") or not ev.get("map"):
        return None
    t = item.get("battleTime", "")
    mode = ev.get("mode") or b.get("mode")
    base = {"t": t, "e": ev["id"], "q": q}
    teams = b.get("teams")
    if teams and len(teams) == 2 and len(teams[0]) == len(teams[1]) and len(teams[0]) >= 2:
        if b.get("result") not in ("victory", "defeat"):
            return None
        mine = 0 if any(clean_tag(p.get("tag")) == owner for p in teams[0]) else 1
        if not any(clean_tag(p.get("tag")) == owner for p in teams[mine]):
            return None
        win_i = mine if b["result"] == "victory" else 1 - mine
        ids = lambda team: sorted(p["brawler"]["id"] for p in team if p.get("brawler"))  # noqa: E731
        rec = dict(base, w=ids(teams[win_i]), l=ids(teams[1 - win_i]))
        sp = (b.get("starPlayer") or {}).get("brawler", {}).get("id")
        if sp:
            rec["sp"] = sp
        tags = sorted(clean_tag(p.get("tag")) for tm in teams for p in tm)
        key = hashlib.sha1(f"{t}|{ev['id']}|{','.join(tags)}".encode()).hexdigest()[:16]
        return key, rec
    if mode in SHOWDOWN_WIN_RANK and b.get("rank"):
        players = b.get("players") or [p for tm in (teams or []) for p in tm]
        me = next((p for p in players if clean_tag(p.get("tag")) == owner), None)
        if not me or not me.get("brawler"):
            return None
        rec = dict(base, b=me["brawler"]["id"], win=1 if b["rank"] <= SHOWDOWN_WIN_RANK[mode] else 0)
        key = hashlib.sha1(f"{t}|{ev['id']}|{owner}".encode()).hexdigest()[:16]
        return key, rec
    return None


def personal(item, owner):
    """Rich record kept for tracked players."""
    ev, b = item.get("event") or {}, item.get("battle") or {}
    rec = {"t": item.get("battleTime"), "e": ev.get("id"), "mode": ev.get("mode") or b.get("mode"), "map": ev.get("map"),
           "type": b.get("type"), "result": b.get("result"), "rank": b.get("rank"), "tc": b.get("trophyChange"),
           "dur": b.get("duration")}
    teams = b.get("teams")
    players = b.get("players")
    if teams:
        for tm in teams:
            for p in tm:
                if clean_tag(p.get("tag")) == owner:
                    rec["brawler"] = p["brawler"]["id"]
                    rec["allies"] = [x["brawler"]["id"] for x in tm if clean_tag(x.get("tag")) != owner]
            if not any(clean_tag(p.get("tag")) == owner for p in tm):
                rec.setdefault("enemies", []).extend(p["brawler"]["id"] for p in tm)
    elif players:
        for p in players:
            if clean_tag(p.get("tag")) == owner:
                rec["brawler"] = p["brawler"]["id"]
    sp = (b.get("starPlayer") or {}).get("tag")
    if sp:
        rec["star"] = clean_tag(sp) == owner
    return {k: v for k, v in rec.items() if v is not None}


# ---------------------------------------------------------------- store helpers
def day_file(day):
    return os.path.join(STORE, "battles", f"{day}.jsonl.gz")


def read_day(day):
    path = day_file(day)
    if not os.path.exists(path):
        return []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_day(day, rows):
    os.makedirs(os.path.dirname(day_file(day)), exist_ok=True)
    with gzip.open(day_file(day), "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 1)


# ---------------------------------------------------------------- collect
def collect(api, seed=False):
    now = dt.datetime.now(dt.timezone.utc)
    events = load_json(os.path.join(STORE, "events.json"), {})
    seen = load_json(os.path.join(STORE, "seen.json"), {})
    cutoff = (now - dt.timedelta(days=4)).strftime("%Y%m%d")
    seen = {k: v for k, v in seen.items() if v >= cutoff}

    tracked = [clean_tag(t) for t in CONFIG["tracked"]]
    top = []
    for country in CONFIG["rankings"]:
        items = api.ranking(country, CONFIG["ranking_limit"])
        log(f"classement {country}: {len(items)} joueurs")
        top += [clean_tag(p["tag"]) for p in items]
    crawl = list(dict.fromkeys(tracked + top))

    new_rows, extra_pool = {}, set()
    personal_logs = {}

    def fetch(tag):
        return tag, api.battlelog(tag)

    def ingest(results):
        for tag, items in results:
            if tag in tracked:
                personal_logs[tag] = items
            for it in items or []:
                ev = it.get("event") or {}
                if ev.get("id") and ev.get("map"):
                    events[str(ev["id"])] = {"mode": ev.get("mode") or (it.get("battle") or {}).get("mode"), "map": ev["map"]}
                    if ev.get("modeId") is not None:
                        events[str(ev["id"])]["mid"] = ev["modeId"]
                for tm in (it.get("battle") or {}).get("teams") or []:
                    for p in tm:
                        extra_pool.add(clean_tag(p.get("tag")))
                n = normalise(it, tag)
                if not n:
                    continue
                key, rec = n
                if key in seen:
                    continue
                seen[key] = rec["t"][:8]
                new_rows.setdefault(rec["t"][:4] + "-" + rec["t"][4:6] + "-" + rec["t"][6:8], []).append(rec)

    with ThreadPoolExecutor(CONFIG["workers"]) as ex:
        ingest(ex.map(fetch, crawl))
        extra_pool -= set(crawl)
        extra_pool.discard("")
        n_extra = CONFIG["extra_players_seed" if seed else "extra_players_per_run"]
        extra = random.sample(sorted(extra_pool), min(n_extra, len(extra_pool)))
        log(f"top+suivis: {len(crawl)} joueurs, adversaires ajoutés: {len(extra)}")
        ingest(ex.map(fetch, extra))

    collect_equipment(api, sorted(extra_pool), seed)

    total = 0
    for day, rows in new_rows.items():
        write_day(day, read_day(day) + rows)
        total += len(rows)
    log(f"nouvelles parties: {total} (appels API: {api.calls}, erreurs: {api.errors})")

    # tracked players: profile + full history
    for tag in tracked:
        prof = api.player(tag)
        path = os.path.join(STORE, "players", f"{tag}.json")
        data = load_json(path, {"tag": tag, "history": []})
        known = {h["t"] for h in data["history"]}
        for it in personal_logs.get(tag) or []:
            rec = personal(it, tag)
            if rec.get("t") and rec["t"] not in known and rec.get("brawler"):
                data["history"].append(rec)
        data["history"].sort(key=lambda h: h["t"], reverse=True)
        if prof:
            data["profile"] = {
                "name": prof.get("name"), "trophies": prof.get("trophies"), "highest": prof.get("highestTrophies"),
                "icon": (prof.get("icon") or {}).get("id"), "club": (prof.get("club") or {}).get("name"),
                "wins3v3": prof.get("3vs3Victories"), "solo": prof.get("soloVictories"), "duo": prof.get("duoVictories"),
                "brawlers": [{"id": b["id"], "power": b.get("power"), "rank": b.get("rank"), "trophies": b.get("trophies"),
                              "gadgets": [g["id"] for g in b.get("gadgets", [])], "starPowers": [s["id"] for s in b.get("starPowers", [])],
                              "gears": [g.get("name") for g in b.get("gears", [])]} for b in prof.get("brawlers", [])],
            }
        save_json(path, data)
        log(f"joueur suivi {tag}: {len(data['history'])} parties en mémoire")

    save_json(os.path.join(STORE, "events.json"), events)
    save_json(os.path.join(STORE, "seen.json"), seen)

    meta_src = {"brawlers": api.brawlers(), "rotation": api.rotation()}
    save_json(os.path.join(STORE, "api_meta.json"), meta_src)


# ---------------------------------------------------------------- equipment
def collect_equipment(api, pool, seed=False):
    """Count what players choose to unlock: the only star power / gadget owned is their first pick,
    gears owned among players who reached power 8 (gear unlock level)."""
    path = os.path.join(STORE, "equip.json")
    eq = load_json(path, {"counted": {}, "b": {}})
    today = dt.datetime.now(dt.timezone.utc)
    cutoff = (today - dt.timedelta(days=CONFIG["equip_recount_days"])).strftime("%Y%m%d")
    eq["counted"] = {k: v for k, v in eq["counted"].items() if v >= cutoff}
    h = lambda t: hashlib.sha1(t.encode()).hexdigest()[:12]  # noqa: E731
    candidates = [t for t in pool if t and h(t) not in eq["counted"]]
    n = CONFIG["equip_profiles_seed" if seed else "equip_profiles_per_run"]
    sample = random.sample(candidates, min(n, len(candidates)))
    with ThreadPoolExecutor(CONFIG["workers"]) as ex:
        profiles = list(ex.map(api.player, sample))
    used = 0
    for tag, p in zip(sample, profiles):
        if not p:
            continue
        used += 1
        eq["counted"][h(tag)] = today.strftime("%Y%m%d")
        for b in p.get("brawlers", []):
            s = eq["b"].setdefault(str(b["id"]), {"n": 0, "n8": 0, "sp1": {}, "g1": {}, "gear": {}, "hc": 0})
            s["n"] += 1
            sps, gads = b.get("starPowers", []), b.get("gadgets", [])
            if len(sps) == 1:
                k = str(sps[0]["id"]); s["sp1"][k] = s["sp1"].get(k, 0) + 1
            if len(gads) == 1:
                k = str(gads[0]["id"]); s["g1"][k] = s["g1"].get(k, 0) + 1
            if (b.get("power") or 0) >= 8:
                s["n8"] += 1
                for g in b.get("gears", []):
                    k = g.get("name", "?")
                    s["gear"][k] = s["gear"].get(k, 0) + 1
                    if g.get("id"):
                        eq.setdefault("gearIds", {})[k] = g["id"]
            if b.get("hyperCharges"):
                s["hc"] += 1
    save_json(path, eq)
    log(f"équipement: {used} profils analysés ({len(eq['counted'])} joueurs comptés sur {CONFIG['equip_recount_days']} j)")


def aggregate_equipment():
    eq = load_json(os.path.join(STORE, "equip.json"), {"b": {}})
    out = {}
    for bid, s in eq["b"].items():
        def shares(d):
            tot = sum(d.values())
            return {"n": tot, "pick": sorted(([k, v / tot] for k, v in d.items()), key=lambda x: -x[1])} if tot else {"n": 0, "pick": []}
        out[bid] = {"owners": s["n"], "n8": s["n8"], "sp": shares(s["sp1"]), "gadget": shares(s["g1"]),
                    "gears": sorted(([k, v / s["n8"]] for k, v in s["gear"].items()), key=lambda x: -x[1]) if s["n8"] else []}
    save_json(os.path.join(SITE_DATA, "equip.json"), out)
    return len(out)


# ---------------------------------------------------------------- aggregate
def aggregate():
    now = dt.datetime.now(dt.timezone.utc)
    days = [(now - dt.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(CONFIG["window_days"])]
    events = load_json(os.path.join(STORE, "events.json"), {})
    src = load_json(os.path.join(STORE, "api_meta.json"), {"brawlers": [], "rotation": []})

    # stats[q] = {"games": n, "b": {id: [g, w, star]}, "bm": {id: {mode: [g, w]}}, "be": {id: {event: [g, w]}},
    #             "mu": {a: {b: [g, w]}}, "sy": {a: {b: [g, w]}}, "ev": {event: games}}
    stats = {q: {"games": 0, "b": {}, "bm": {}, "be": {}, "mu": {}, "sy": {}, "ev": {}} for q in ("r", "t")}

    def bump(d, k, w):
        x = d.setdefault(k, [0, 0])
        x[0] += 1
        x[1] += w

    for day in days:
        for r in read_day(day):
            S = stats[r["q"]]
            e = str(r["e"])
            mode = (events.get(e) or {}).get("mode", "?")
            S["games"] += 1
            S["ev"][e] = S["ev"].get(e, 0) + 1
            if "w" in r:
                for win, team, other in ((1, r["w"], r["l"]), (0, r["l"], r["w"])):
                    for a in team:
                        a = str(a)
                        bs = S["b"].setdefault(a, [0, 0, 0])
                        bs[0] += 1
                        bs[1] += win
                        if win and r.get("sp") == int(a):
                            bs[2] += 1
                        bump(S["bm"].setdefault(a, {}), mode, win)
                        bump(S["be"].setdefault(a, {}), e, win)
                        for o in other:
                            bump(S["mu"].setdefault(a, {}), str(o), win)
                        for m in team:
                            if m != int(a):
                                bump(S["sy"].setdefault(a, {}), str(m), win)
            else:
                a = str(r["b"])
                bs = S["b"].setdefault(a, [0, 0, 0])
                bs[0] += 1
                bs[1] += r["win"]
                bump(S["bm"].setdefault(a, {}), mode, r["win"])
                bump(S["be"].setdefault(a, {}), e, r["win"])

    brawlers = [{"id": b["id"], "name": b["name"].title(),
                 "gadgets": [{"id": g["id"], "name": g["name"].title()} for g in b.get("gadgets", [])],
                 "starPowers": [{"id": s["id"], "name": s["name"].title()} for s in b.get("starPowers", [])]}
                for b in src.get("brawlers", [])]
    rotation = [{"id": r["event"]["id"], "mode": r["event"].get("mode"), "map": r["event"].get("map"),
                 "start": r.get("startTime"), "end": r.get("endTime")} for r in src.get("rotation", []) if r.get("event")]
    used = set(stats["r"]["ev"]) | set(stats["t"]["ev"]) | {str(r["id"]) for r in rotation}
    # mode name -> numeric mode id, used by the app to build game mode icon URLs
    modes = {e["mode"]: e["mid"] for e in events.values() if e.get("mode") and e.get("mid") is not None}
    modes.update({r["event"]["mode"]: r["event"]["modeId"] for r in src.get("rotation", [])
                  if (r.get("event") or {}).get("mode") and r["event"].get("modeId") is not None})
    meta = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "window_days": CONFIG["window_days"],
        "games": {q: stats[q]["games"] for q in stats},
        "brawlers": brawlers, "rotation": rotation, "modes": modes,
        "gears": load_json(os.path.join(STORE, "equip.json"), {}).get("gearIds", {}),
        "tracked": [clean_tag(t) for t in CONFIG["tracked"]],
        "events": {e: events[e] for e in used if e in events},
    }
    save_json(os.path.join(SITE_DATA, "meta.json"), meta)
    save_json(os.path.join(SITE_DATA, "stats.json"), stats)

    os.makedirs(os.path.join(SITE_DATA, "players"), exist_ok=True)
    for tag in CONFIG["tracked"]:
        tag = clean_tag(tag)
        data = load_json(os.path.join(STORE, "players", f"{tag}.json"), None)
        if data:
            save_json(os.path.join(SITE_DATA, "players", f"{tag}.json"), data)
    n_eq = aggregate_equipment()
    log(f"agrégat: classé {stats['r']['games']} parties, trophées {stats['t']['games']} parties, {len(brawlers)} brawlers, équipement pour {n_eq} brawlers")


if __name__ == "__main__":
    args = set(sys.argv[1:])
    if "--no-collect" not in args:
        collect(Api(load_token()), seed="--seed" in args)
    aggregate()
