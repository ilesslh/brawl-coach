"""Minimal client for the official Brawl Stars API (through the RoyaleAPI proxy by default)."""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("BS_API_BASE", "https://bsproxy.royaleapi.dev/v1")


def load_token():
    token = os.environ.get("BS_API_TOKEN", "").strip()
    if not token:
        env = os.path.join(os.path.dirname(__file__), "..", ".env")
        if os.path.exists(env):
            for line in open(env, encoding="utf-8"):
                if line.strip().startswith("BS_API_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not token:
        raise SystemExit("BS_API_TOKEN manquant (variable d'environnement ou fichier .env)")
    return token


class Api:
    def __init__(self, token):
        self.token = token
        self.calls = 0
        self.errors = 0

    def get(self, path, retries=4):
        url = BASE + path
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"})
        for attempt in range(retries):
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    time.sleep(2 ** attempt + 0.5)
                    continue
                self.errors += 1
                if e.code in (401, 403):
                    body = e.read().decode("utf-8", "replace")[:200]
                    raise SystemExit(f"Accès refusé par l'API ({e.code}) : vérifie le token et l'IP 45.79.218.79. {body}")
                return None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                self.errors += 1
                return None
        return None

    @staticmethod
    def tag(t):
        t = t.strip().upper().lstrip("#")
        return urllib.parse.quote("#" + t)

    def brawlers(self):
        return (self.get("/brawlers") or {}).get("items", [])

    def rotation(self):
        return self.get("/events/rotation") or []

    def ranking(self, country, limit):
        return (self.get(f"/rankings/{country}/players?limit={limit}") or {}).get("items", [])

    def player(self, tag):
        return self.get(f"/players/{self.tag(tag)}")

    def battlelog(self, tag):
        return (self.get(f"/players/{self.tag(tag)}/battlelog") or {}).get("items", [])
