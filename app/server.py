"""Serveur de « Ma semaine en vinyles ».

Le navigateur ne parle qu'à ce serveur. Lui seul parle à Last.fm :
- la clé API reste ici, lue dans une variable d'environnement ;
- les réponses de Last.fm sont gardées en mémoire quelques secondes (cache) ;
- les pochettes passent aussi par ici, pour que le navigateur n'appelle jamais Last.fm ;
- si Last.fm ne répond pas, on renvoie les dernières données connues, ou un message clair.
"""

import logging
import os
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from flask import Flask, Response, abort, jsonify, request

API_KEY = os.environ.get("LASTFM_API_KEY", "").strip()
USER = os.environ.get("LASTFM_USER", "paulsim7").strip()
CACHE_SECONDS = int(os.environ.get("CACHE_SECONDS", "45"))
TZ = ZoneInfo(os.environ.get("TIMEZONE", "Europe/Paris"))

# Modifiable pour simuler une panne (voir le README) : LASTFM_URL=http://127.0.0.1:9/
LASTFM_URL = os.environ.get("LASTFM_URL", "https://ws.audioscrobbler.com/2.0/")
COVER_URL = "https://lastfm.freetls.fastly.net/i/u/300x300/{}"
MAX_PAGES = 5            # 5 pages de 200 = 1000 écoutes max sur la semaine
RETRY_AFTER_FAIL = 15    # après un échec, on attend avant de réessayer
PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"  # l'étoile grise de Last.fm
COVER_RE = re.compile(r"^[0-9a-f]{32}\.(?:jpg|jpeg|png|gif|webp)$")
DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
BANDS = [("La nuit", 0, 8), ("La journée", 8, 16), ("Le soir", 16, 24)]   # 3 étages de 8 h

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("musique")

app = Flask(__name__, static_folder="static", static_url_path="")


# --------------------------------------------------------------------------
# Appels à Last.fm
# --------------------------------------------------------------------------

class LastfmError(Exception):
    pass


def call_lastfm(params):
    """Un appel à Last.fm. C'est la seule fonction qui contacte l'API."""
    log.info("→ Appel à Last.fm (%s, page %s)", params["method"], params.get("page", 1))
    query = {**params, "api_key": API_KEY, "format": "json"}
    try:
        reply = requests.get(LASTFM_URL, params=query, timeout=8)
        data = reply.json()
    except (requests.RequestException, ValueError) as exc:
        raise LastfmError("Last.fm ne répond pas") from exc
    if "error" in data:
        raise LastfmError(data.get("message", "Erreur Last.fm"))
    return data


def fetch_week_tracks():
    """Toutes les écoutes des 7 derniers jours (plusieurs pages si besoin)."""
    since = int(time.time()) - 7 * 86400
    tracks = []
    for page in range(1, MAX_PAGES + 1):
        data = call_lastfm({
            "method": "user.getrecenttracks",
            "user": USER,
            "from": since,
            "limit": 200,
            "extended": 1,
            "page": page,
        })
        block = data["recenttracks"]
        items = block.get("track", [])
        if isinstance(items, dict):   # Last.fm renvoie un objet seul s'il n'y a qu'une écoute
            items = [items]
        tracks.extend(items)
        if page >= int(block.get("@attr", {}).get("totalPages", 1)):
            break
    return tracks


# --------------------------------------------------------------------------
# Mise en forme des données pour la page
# --------------------------------------------------------------------------

def cover_path(images):
    """Transforme l'adresse Last.fm d'une pochette en adresse de notre serveur."""
    url = next((i.get("#text") for i in reversed(images or []) if i.get("#text")), "")
    name = url.rsplit("/", 1)[-1]
    if not COVER_RE.match(name) or name.startswith(PLACEHOLDER):
        return None
    return f"/cover/{name}"


def simplify(track):
    artist = track.get("artist") or {}
    album = (track.get("album") or {}).get("#text", "")
    return {
        "name": track.get("name", ""),
        "artist": artist.get("name") or artist.get("#text", ""),
        "album": album,
        "cover": cover_path(track.get("image")),
        "loved": track.get("loved") == "1",
        "ts": int(track["date"]["uts"]) if track.get("date") else None,
        "now": track.get("@attr", {}).get("nowplaying") == "true",
    }


def build_view(raw_tracks):
    tracks = [simplify(t) for t in raw_tracks]
    now_playing = next((t for t in tracks if t["now"]), None)
    played = sorted((t for t in tracks if t["ts"]), key=lambda t: t["ts"])

    # une pochette trouvée pour un morceau sert à tout l'album, sur toute la semaine
    def album_key(t):
        return f"{t['artist'].split(',')[0].strip().lower()}|{(t['album'] or t['name']).lower()}"
    covers_by_album = {}
    for t in tracks:
        if t["cover"]:
            covers_by_album.setdefault(album_key(t), t["cover"])
    for t in tracks:
        t["cover"] = t["cover"] or covers_by_album.get(album_key(t))

    # 3 étages, un par moment de la journée ; sur chaque étage, les disques suivent l'heure
    shelves = [{"label": label, "from": a, "to": b, "albums": OrderedDict()} for label, a, b in BANDS]
    last_seen = {}   # album -> dernière écoute (pour la poussière)

    for t in played:
        moment = datetime.fromtimestamp(t["ts"], TZ)
        shelf = shelves[moment.hour // 8]
        key = album_key(t)   # un album = son nom + l'artiste principal (« HOUDI, Ziak » = « Houdi »)
        albums = shelf["albums"]
        if key not in albums:
            albums[key] = {
                "id": f"{shelf['from']}|{key}",
                "key": key,
                "album": t["album"] or t["name"],
                "artist": t["artist"].split(",")[0].strip(),
                "cover": t["cover"],
                "minute": moment.hour * 60 + moment.minute,   # place sur l'étage : la 1re écoute
                "plays": 0,
                "loved": False,
                "tracks": [],
            }
        entry = albums[key]
        entry["minute"] = min(entry["minute"], moment.hour * 60 + moment.minute)
        entry["plays"] += 1
        entry["loved"] = entry["loved"] or t["loved"]
        entry["cover"] = entry["cover"] or t["cover"]
        entry["tracks"].append({
            "name": t["name"],
            "time": f"{DAY_SHORT[moment.weekday()]} {moment.strftime('%H:%M')}",
            "loved": t["loved"],
        })
        last_seen[key] = max(last_seen.get(key, 0), t["ts"])

    now_ts = time.time()
    shelf_list = []
    for shelf in shelves:
        albums = sorted(shelf["albums"].values(), key=lambda a: a["minute"])
        for a in albums:
            a["days_since"] = round((now_ts - last_seen[a["key"]]) / 86400, 2)
        shelf_list.append({**shelf, "albums": albums, "plays": sum(a["plays"] for a in albums)})

    last = played[-1] if played else None
    if last:
        last = {**last, "hour": datetime.fromtimestamp(last["ts"], TZ).hour}
    return {
        "user": USER,
        "now_playing": now_playing,
        "last_played": last,
        "shelves": shelf_list,
        "total_plays": len(played),
        "hour": datetime.now(TZ).hour,
    }


# --------------------------------------------------------------------------
# Le cache : une seule copie des données, partagée par tous les visiteurs
# --------------------------------------------------------------------------

cache = {"view": None, "at": 0.0, "failed_at": 0.0}
cache_lock = threading.Lock()


def get_view():
    """Renvoie (données, état du cache). Appelle Last.fm seulement si le cache est trop vieux."""
    with cache_lock:   # deux visiteurs en même temps ne déclenchent qu'un seul appel
        age = time.time() - cache["at"]
        if cache["view"] and age < CACHE_SECONDS:
            return {**cache["view"], "stale": False}, "HIT"

        recently_failed = time.time() - cache["failed_at"] < RETRY_AFTER_FAIL
        if not recently_failed:
            try:
                view = build_view(fetch_week_tracks())
                view["fetched_at"] = int(time.time())
                cache.update(view=view, at=time.time())
                return {**view, "stale": False}, "MISS"
            except LastfmError as exc:
                log.warning("Last.fm a échoué : %s", exc)
                cache["failed_at"] = time.time()

        if cache["view"]:   # Last.fm en panne : on montre les dernières données connues
            return {**cache["view"], "stale": True}, "STALE"
        raise LastfmError("Last.fm ne répond pas")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/music")
def music():
    if not API_KEY:
        return jsonify(error="missing_key",
                       message="La clé Last.fm manque sur le serveur. Copie .env.example en .env et remplis-la."), 503
    try:
        view, state = get_view()
    except LastfmError:
        return jsonify(error="lastfm_down",
                       message="Last.fm ne répond pas pour l'instant. Réessaie dans une minute."), 503
    reply = jsonify(view)
    reply.headers["X-Cache"] = state
    reply.headers["Cache-Control"] = "no-store"
    return reply


# --------------------------------------------------------------------------
# Infos en plus sur un morceau ou un album (genres, durée, nombre d'écoutes…)
# Ces réponses changent peu : on les garde 1 h, pour tous les visiteurs.
# --------------------------------------------------------------------------

INFO_SECONDS = 3600
infos = OrderedDict()
infos_lock = threading.Lock()
TAG_SKIP = {"seen live", "favorites", "favourite", "french"}


def clean_summary(text):
    text = re.sub(r"<a [^>]*>.*?</a>", "", text or "")   # Last.fm ajoute « Read more on Last.fm »
    text = re.sub(r"<[^>]+>", "", text).strip()
    return text[:320] + ("…" if len(text) > 320 else "")


def tags_of(block):
    items = (block or {}).get("tag", [])
    if isinstance(items, dict):
        items = [items]
    names = [t.get("name", "") for t in items]
    return [n for n in names if n and n.lower() not in TAG_SKIP][:4]


def cached_info(key, fetch):
    with infos_lock:
        hit = infos.get(key)
        if hit and time.time() - hit[0] < INFO_SECONDS:
            return hit[1]
    stamp = time.time()
    try:
        value = fetch()
    except (LastfmError, KeyError, TypeError, ValueError):
        value = {}                                  # pas d'infos en plus : la page s'en passe…
        stamp = time.time() - INFO_SECONDS + 120    # …et on ne réessaie pas avant 2 minutes
    with infos_lock:
        infos[key] = (stamp, value)
        while len(infos) > 400:
            infos.popitem(last=False)
    return value


def fetch_track_info(artist, track):
    t = call_lastfm({"method": "track.getInfo", "artist": artist, "track": track,
                     "username": USER, "autocorrect": 1})["track"]
    duration = int(t.get("duration") or 0) // 1000
    return {
        "duration": duration or None,
        "listeners": int(t.get("listeners") or 0),
        "user_plays": int(t.get("userplaycount") or 0),
        "tags": tags_of(t.get("toptags")),
        "summary": clean_summary((t.get("wiki") or {}).get("summary")),
    }


def fetch_album_info(artist, album):
    a = call_lastfm({"method": "album.getInfo", "artist": artist, "album": album,
                     "username": USER, "autocorrect": 1})["album"]
    tracks = (a.get("tracks") or {}).get("track", [])
    if isinstance(tracks, dict):
        tracks = [tracks]
    wiki = a.get("wiki") or {}
    return {
        "listeners": int(a.get("listeners") or 0),
        "user_plays": int(a.get("userplaycount") or 0),
        "track_count": len(tracks) or None,
        "released": (wiki.get("published") or "")[:11].strip() or None,
        "tags": tags_of(a.get("tags")),
        "summary": clean_summary(wiki.get("summary")),
    }


@app.get("/api/track")
def track_info():
    artist, track = request.args.get("artist", "")[:200], request.args.get("track", "")[:200]
    if not API_KEY or not artist or not track:
        return jsonify({})
    return jsonify(cached_info(("track", artist.lower(), track.lower()), lambda: fetch_track_info(artist, track)))


@app.get("/api/album")
def album_info():
    artist, album = request.args.get("artist", "")[:200], request.args.get("album", "")[:200]
    if not API_KEY or not artist or not album:
        return jsonify({})
    return jsonify(cached_info(("album", artist.lower(), album.lower()), lambda: fetch_album_info(artist, album)))


covers = OrderedDict()   # petites images gardées en mémoire (300 max)
covers_lock = threading.Lock()


@app.get("/cover/<name>")
def cover(name):
    if not COVER_RE.match(name):
        abort(404)
    with covers_lock:
        hit = covers.get(name)
    if hit is None:
        try:
            reply = requests.get(COVER_URL.format(name), timeout=8)
            reply.raise_for_status()
        except requests.RequestException:
            abort(404)
        hit = (reply.content, reply.headers.get("Content-Type", "image/jpeg"))
        with covers_lock:
            covers[name] = hit
            while len(covers) > 300:
                covers.popitem(last=False)
    body, mime = hit
    return Response(body, mimetype=mime, headers={"Cache-Control": "public, max-age=604800"})


@app.get("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
