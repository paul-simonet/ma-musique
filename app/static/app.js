// Live Studio : la page ne parle qu'à notre serveur (/api/music et /cover/...).
const REFRESH_MS = 30_000;
const PALETTE = ["#b8572a", "#c99a2e", "#6f6e2c", "#8f3b24", "#a8743a", "#56623a", "#7a4a26", "#9c5a2f"];

const $ = (id) => document.getElementById(id);
const state = { data: null, selected: null, sleeves: [] };

// ---------------------------------------------------------------- chargement
async function load() {
  try {
    const reply = await fetch("/api/music", { cache: "no-store" });
    const body = await reply.json();
    if (!reply.ok) throw new Error(body.message || "Le serveur n'a pas pu lire Last.fm.");
    state.data = body;
    render();
    showBanner(body.stale ? `Last.fm ne répond pas : j'affiche les disques de ${clock(body.fetched_at)}.` : "");
  } catch (err) {
    // jamais de message technique à l'écran : une phrase claire selon le cas
    const message = err instanceof TypeError ? "Le serveur ne répond pas."
                  : err instanceof SyntaxError ? "Le serveur a renvoyé une réponse illisible."
                  : err.message;
    if (state.data) showBanner(`${message} J'affiche les derniers disques connus.`);
    else renderEmpty(message);
  }
}

function showBanner(text) {
  $("banner").hidden = !text;
  $("banner").textContent = text;
}

// ---------------------------------------------------------------- rendu
function render() {
  const d = state.data;
  renderShelves(d);
  renderDeck();
  renderStats(d);
}

function renderStats(d) {
  // tout est calculé à partir des données déjà reçues : aucun appel en plus
  const perHour = Array(24).fill(0);
  for (const shelf of d.shelves) for (const a of shelf.albums) {
    for (const t of a.tracks) {
      perHour[parseInt(t.time.split(" ")[1], 10)]++;
    }
  }
  const peak = perHour.indexOf(Math.max(...perHour));
  const albums = d.shelves.reduce((n, s) => n + s.albums.length, 0);
  const max = Math.max(1, ...perHour);

  $("clock").replaceChildren(...perHour.map((n, h) => {
    const bar = el("span", h === d.hour ? "bar now" : "bar");
    bar.style.setProperty("--h", n / max);
    bar.title = `${h}h : ${n} écoute${n > 1 ? "s" : ""}`;
    return bar;
  }));
  const tiles = [
    [d.total_plays, "écoutes"],
    [albums, "albums"],
    [d.total_plays ? `${peak}h` : "—", "heure de pointe"],
  ];
  $("tiles").replaceChildren(...tiles.map(([big, small]) => {
    const li = el("li");
    li.append(el("strong", "", String(big)), el("span", "", small));
    return li;
  }));
}

// La bibliothèque se lit comme un livre : casier de gauche puis de droite, étage par étage.
// Les disques s'y suivent dans l'ordre choisi, séparés par des intercalaires.
const COMPARTMENTS = [["a", 1], ["b", 1], ["a", 2], ["b", 2], ["a", 3], ["b", 3]];

// Les 4 façons de ranger la bibliothèque : l'ordre des disques + le texte des intercalaires
const SORTS = {
  time:  { legend: "Se lit comme un livre, dans l'ordre de la journée",
           order: (x, y) => x.minute - y.minute,
           tab: (a) => `${Math.floor(a.minute / 60)}h` },
  genre: { legend: "Rangé par genre (selon Deezer), puis dans l'ordre de la journée",
           order: (x, y) => genreOf(x).localeCompare(genreOf(y), "fr") || x.minute - y.minute,
           tab: (a) => genreOf(a) },
  alpha: { legend: "Rangé par ordre alphabétique des albums",
           order: (x, y) => x.album.localeCompare(y.album, "fr", { sensitivity: "base" }),
           tab: (a) => { const c = a.album.normalize("NFD")[0]?.toUpperCase() || "#"; return /[A-Z]/.test(c) ? c : "#"; } },
  plays: { legend: "Rangé du plus écouté au moins écouté",
           order: (x, y) => y.plays - x.plays || x.album.localeCompare(y.album, "fr"),
           tab: (a) => a.plays >= 10 ? "10+ fois" : a.plays >= 5 ? "5–9 fois" : a.plays >= 2 ? "2–4 fois" : "1 fois" },
};
let sortMode = "time";
try { sortMode = SORTS[localStorage.getItem("sort")] ? localStorage.getItem("sort") : "time"; } catch {}

function genreOf(album) {
  const info = infoCache.get(`album|${album.artist}|${album.album}`);
  return (info && info.genre) || (info ? "Autres" : "…");
}

function albumsFor(d) {
  // par heure : un album écouté le matin et le soir apparaît aux deux moments.
  // pour les autres rangements : un seul exemplaire par album, avec le total des écoutes.
  const all = d.shelves.flatMap((shelf) => shelf.albums.map((a) => ({ ...a, shelfLabel: shelf.label })));
  if (sortMode === "time") return all;
  const merged = new Map();
  for (const a of all) {
    const m = merged.get(a.key);
    if (!m) merged.set(a.key, { ...a, id: a.key });
    else { m.plays += a.plays; m.loved = m.loved || a.loved; m.minute = Math.min(m.minute, a.minute); m.cover = m.cover || a.cover; }
  }
  return [...merged.values()];
}

function renderShelves(d) {
  document.querySelectorAll(".shelf").forEach((n) => n.remove());
  document.body.classList.remove("closed");
  state.sleeves = [];
  const sort = SORTS[sortMode];
  document.querySelectorAll(".sort button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === sortMode));

  // 1. une seule file : intercalaire, puis ses albums, intercalaire suivant…
  const albums = albumsFor(d).sort(sort.order);
  const items = [];
  const groups = new Map();                     // intercalaire -> ses albums (pour la bulle d'info)
  let last = null;
  for (const album of albums) {
    const tab = sort.tab(album);
    if (tab !== last) { items.push({ divider: tab }); last = tab; groups.set(tab, []); }
    groups.get(tab).push(album);
    items.push({ album });
  }

  // 2. on répartit la file sur les 6 casiers, à parts égales, pour remplir toute la bibliothèque
  const chunks = COMPARTMENTS.map(() => []);
  items.forEach((item, k) => chunks[Math.min(5, Math.floor(k * 6 / Math.max(items.length, 1)))].push(item));
  for (let c = 0; c < 5; c++) {                   // un intercalaire ne reste jamais seul en fin de casier
    while (chunks[c].length && chunks[c][chunks[c].length - 1].divider !== undefined) chunks[c + 1].unshift(chunks[c].pop());
  }

  // 3. on dessine chaque casier
  const row = el("div", "shelf");
  COMPARTMENTS.forEach(([side, r], c) => {
    const wing = makeWing(side, r, c);
    const track = wing.querySelector(".track");
    const chunk = chunks[c];
    chunk.forEach((item, k) => {
      const node = item.divider !== undefined ? makeDivider(item.divider, groups.get(item.divider)) : makeSlot(item.album);
      node.style.setProperty("--f", chunk.length > 1 ? k / (chunk.length - 1) : 0.5);    // toute la largeur
      node.style.zIndex = k + 1;                      // les disques de devant cachent le bas de l'intercalaire
      track.append(node);
      if (item.album) state.sleeves.push({ el: node, album: item.album });
    });
    if (!chunk.length) wing.classList.add("dark");                                        // casier vide : LED éteinte
    if (!albums.length && c === 0) wing.append(el("span", "quiet", "Pas encore d'écoute cette semaine"));
    row.append(wing);
  });
  $("bookcase").append(row);

  if (sortMode === "genre") loadGenres(albums);
}

function makeWing(side, r, c) {
  const wing = el("div", `wing ${side}`);
  wing.style.setProperty("--r", r);
  wing.append(el("div", "track"), el("div", "board"));
  // deux plantes : au tout début et à la toute fin de la bibliothèque
  const plant = c === 0 ? ["snake", "start"] : c === 5 ? ["pilea", "end"] : null;
  if (plant) {
    wing.classList.add(`decor-${plant[1]}`);
    wing.insertAdjacentHTML("beforeend", PLANTS[plant[0]].replace("<svg", `<svg class="plant ${plant[1]}"`));
  }
  return wing;
}

let genresLoading = false;
async function loadGenres(albums) {
  // les genres viennent de Deezer, via notre serveur ; on ne les demande qu'une fois, 4 à la fois
  const missing = albums.filter((a) => !infoCache.has(`album|${a.artist}|${a.album}`));
  if (!missing.length || genresLoading) return;
  genresLoading = true;
  const queue = missing.slice();
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      const key = `album|${a.artist}|${a.album}`;
      try { infoCache.set(key, await (await fetch(`/api/album?artist=${encodeURIComponent(a.artist)}&album=${encodeURIComponent(a.album)}`)).json()); }
      catch { infoCache.set(key, {}); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  genresLoading = false;
  if (sortMode === "genre" && state.data) renderShelves(state.data);
}

function setSort(mode) {
  if (!SORTS[mode] || !state.data) return;
  sortMode = mode;
  try { localStorage.setItem("sort", mode); } catch {}
  state.selected = null;
  renderShelves(state.data);
  renderDeck();
}
document.querySelectorAll(".sort button").forEach((b) => b.addEventListener("click", () => setSort(b.dataset.sort)));

function makeDivider(text, albums = []) {
  // un intercalaire en carton avec son onglet ; on peut le « sortir » pour voir son groupe
  const div = el("button", "divider");
  div.type = "button";
  const plays = albums.reduce((n, a) => n + a.plays, 0);
  const summary = `${albums.length} album${albums.length > 1 ? "s" : ""} · ${plays} écoute${plays > 1 ? "s" : ""}`;
  div.setAttribute("aria-label", `${text} : ${summary}`);
  const card = el("span", "card-div");
  card.append(el("span", "tab", text));
  div.append(card);
  div.addEventListener("mouseenter", (e) => showTip(e, null, [text, summary, albums.slice(0, 3).map((a) => a.album).join(", ") + (albums.length > 3 ? "…" : "")]));
  div.addEventListener("mousemove", moveTip);
  div.addEventListener("mouseleave", hideTip);
  div.addEventListener("click", () => albums[0] && select(albums[0].id));   // clic : le 1er disque du groupe
  return div;
}

function makeSlot(album) {
  // le bouton (zone cliquable fixe) contient la pochette, qui seule s'anime : plus de clignotement au survol
  const slot = el("button", "slot");
  slot.type = "button";
  slot.style.setProperty("--color", colorFor(album.key));
  slot.setAttribute("aria-label", `${album.album}, ${album.artist}, ${album.plays} écoute(s)`);

  const sleeve = el("span", "sleeve");
  const front = el("span", "front generic");                                              // pochette carton en attendant
  const label = el("span", "name", album.album);
  front.append(label);
  withCover(album.cover, album.artist, album.album, (url) => {                           // la vraie pochette, si on la trouve
    slot.style.setProperty("--img", `url("${url}")`);
    front.classList.remove("generic");
    label.remove();
  });
  if (album.loved) front.append(el("span", "postit", "♥"));                              // coup de cœur
  sleeve.append(el("span", "side"), front);
  slot.append(sleeve);

  slot.addEventListener("click", () => select(album.id));
  slot.addEventListener("mouseenter", (e) => showTip(e, album));
  slot.addEventListener("mousemove", moveTip);
  slot.addEventListener("mouseleave", hideTip);
  if (album.id === state.selected) slot.classList.add("selected");
  return slot;
}

function renderDeck() {
  const d = state.data;
  const pick = state.sleeves.find((s) => s.album.id === state.selected);
  const live = !pick;
  const playing = live && d.now_playing;

  let cover, name, kicker, title, meta;
  if (pick) {
    const { album } = pick;
    cover = coverUrl(album.cover, album.artist, album.album); name = album.album;
    kicker = `Sorti de l'étagère · ${hhmm(album.minute)}`;
    title = album.album; meta = `${album.artist} · ${album.plays} écoute${album.plays > 1 ? "s" : ""} cette semaine`;
  } else if (playing) {
    const t = d.now_playing;
    cover = coverUrl(t.cover, mainArtist(t.artist), t.album || t.name); name = t.album || t.name;
    kicker = "En train d'écouter"; title = t.name;
    meta = [t.artist, t.album].filter(Boolean).join(" · ") + (t.loved ? "  ♥" : "");
  } else if (d.last_played) {
    const t = d.last_played;
    cover = coverUrl(t.cover, mainArtist(t.artist), t.album || t.name); name = t.album || t.name;
    kicker = `Dernière écoute ${ago(t.ts)}`; title = t.name;
    meta = [t.artist, t.album].filter(Boolean).join(" · ");
  } else {
    name = "Pas de disque"; kicker = "Silence"; title = "Rien cette semaine";
    meta = "Écoute un morceau sur Deezer, il apparaîtra ici.";
  }
  putOnDeck(cover, name);
  showInfo(pick
    ? { kind: "album", artist: pick.album.artist, name: pick.album.album }
    : (playing || d.last_played) ? { kind: "track", artist: mainArtist((playing || d.last_played).artist), name: (playing || d.last_played).name }
    : null);

  $("record").classList.toggle("spinning", Boolean(playing));
  $("tonearm").classList.toggle("on", Boolean(playing));
  $("power").classList.toggle("on", Boolean(playing));
  $("onair").classList.toggle("on", Boolean(playing));

  $("kicker").textContent = kicker;
  $("kicker").classList.toggle("live", Boolean(playing));
  $("title").textContent = title;
  $("meta").textContent = meta;
  $("back").hidden = live;
  for (const s of state.sleeves) s.el.classList.toggle("selected", s.album.id === state.selected);
}

function putOnDeck(cover, name) {
  // le disque entier prend la pochette ; sans pochette, un vrai vinyle noir avec une étiquette au nom de l'album
  const record = $("record");
  const key = cover || `none:${name}`;
  if (record.dataset.key === key) return;
  record.dataset.key = key;
  record.classList.add("swap");
  const apply = (url) => setTimeout(() => {
    if (record.dataset.key !== key) return;
    record.style.setProperty("--disc-img", url ? `url("${url}")` : "none");
    record.style.setProperty("--disc-color", colorFor(name || ""));
    record.classList.toggle("plain", !url);
    $("record-text").textContent = url ? "" : name;
    record.classList.remove("swap");
  }, 250);
  if (!cover) return apply(null);
  const img = new Image();
  img.onload = () => apply(cover);
  img.onerror = () => apply(null);
  img.src = cover;
}

// adresse de la pochette : celle de Last.fm si elle existe, sinon notre serveur la cherche sur Deezer
function coverUrl(cover, artist, album) {
  if (cover) return cover;
  if (!artist || !album) return null;
  return `/art?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`;
}
const coverOk = new Map();   // adresse -> true / false, pour ne pas redemander une pochette introuvable
function withCover(cover, artist, album, done) {
  const url = coverUrl(cover, artist, album);
  if (!url || coverOk.get(url) === false) return;
  if (coverOk.get(url)) return done(url);
  const img = new Image();
  img.onload = () => { coverOk.set(url, true); done(url); };
  img.onerror = () => coverOk.set(url, false);
  img.src = url;
}

// ---------------------------------------------------------------- infos en plus (via notre serveur)
const infoCache = new Map();
let infoWanted = "";

async function showInfo(req) {
  const key = req ? `${req.kind}|${req.artist}|${req.name}` : "";
  infoWanted = key;
  if (!req) return paintInfo({}, null);
  if (!infoCache.has(key)) {
    paintInfo({}, req.kind);                                   // on vide pendant le chargement
    const url = `/api/${req.kind}?artist=${encodeURIComponent(req.artist)}&${req.kind}=${encodeURIComponent(req.name)}`;
    try { infoCache.set(key, await (await fetch(url)).json()); }
    catch { infoCache.set(key, {}); }
  }
  if (infoWanted === key) paintInfo(infoCache.get(key), req.kind);
}

function paintInfo(info, kind) {
  // deux infos au plus, pour que la fiche reste lisible d'un coup d'œil
  const facts = [];
  if (info.duration) facts.push(`${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, "0")}`);
  if (info.track_count) facts.push(`${info.track_count} titres`);
  if (info.genre) facts.push(info.genre);
  $("facts").replaceChildren(...facts.slice(0, 2).map((f) => el("li", "", f)));
}

function renderEmpty(message) {
  // pas encore de données et pas de serveur : la bibliothèque reste fermée, portes closes
  showBanner("");
  document.body.classList.add("closed");
  $("onair").classList.remove("on");
  $("kicker").textContent = "Pas de signal";
  $("title").textContent = "Le studio est fermé";
  $("meta").textContent = `${message} La page réessaie toute seule toutes les 30 secondes.`;
  $("record-text").textContent = "";
  $("clock").replaceChildren();
  $("tiles").replaceChildren(el("li", "wait", "Les chiffres reviendront avec la musique."));
  document.querySelectorAll(".shelf").forEach((n) => n.remove());
  const row = el("div", "shelf");
  COMPARTMENTS.forEach(([side, r], c) => {
    const wing = makeWing(side, r, c);
    wing.classList.add("dark");
    const doors = el("div", "doors");
    doors.append(el("span", "door left"), el("span", "door right"));
    if (c === 0) doors.append(el("span", "sign", "Fermé"));
    wing.append(doors);
    row.append(wing);
  });
  $("bookcase").append(row);
}

// ---------------------------------------------------------------- navigation
function select(id) {
  state.selected = state.selected === id ? null : id;
  hideTip();
  renderDeck();
}

$("back").addEventListener("click", () => select(null));
document.addEventListener("keydown", (e) => {
  if (!state.sleeves.length) return;
  if (e.key === "Escape") return select(null);
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const order = state.sleeves;                     // l'ordre affiché, quel que soit le rangement choisi
  const i = order.findIndex((s) => s.album.id === state.selected);
  const step = e.key === "ArrowRight" ? 1 : -1;
  const next = i === -1 ? (step > 0 ? 0 : order.length - 1) : (i + step + order.length) % order.length;
  state.selected = order[next].album.id;
  renderDeck();
});

// ---------------------------------------------------------------- bulle d'info
let tip;
function showTip(e, album, lines) {
  hideTip();
  tip = el("div", "tip");
  if (album) {
    lines = [album.album, album.artist,
             `${album.plays} écoute${album.plays > 1 ? "s" : ""} · dès ${hhmm(album.minute)}${album.loved ? " · ♥" : ""}`];
  }
  tip.append(el("strong", "", lines[0]), ...lines.slice(1).filter(Boolean).map((l) => el("small", "", l)));
  if (!album) tip.dataset.below = "1";          // sous la souris : on ne cache pas l'onglet qu'on vient de sortir
  document.body.append(tip);
  moveTip(e);
}
function moveTip(e) {
  if (!tip) return;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = tip.dataset.below ? `${Math.min(innerHeight - tip.offsetHeight - 8, e.clientY + 22)}px`
                                    : `${Math.max(8, e.clientY - tip.offsetHeight - 14)}px`;
}
function hideTip() { tip?.remove(); tip = null; }

// ---------------------------------------------------------------- petits outils
function el(tag, cls = "", text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function hhmm(minute) { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }
function mainArtist(artist) { return (artist || "").split(",")[0].trim(); }
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function colorFor(s) { return PALETTE[hash(s) % PALETTE.length]; }
function clock(ts) { return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function ago(ts) {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);

// ---------------------------------------------------------------- plantes (SVG faits main, style 70s)
const PLANTS = {
  snake: `<svg width="64" height="118" viewBox="0 0 64 118" aria-hidden="true">
    <g stroke="#c8b24c" stroke-width="1.4">
      <path d="M31 76 C24 52 20 26 26 4 C33 28 36 52 35 76Z" fill="#4f6b32"/>
      <path d="M26 76 C14 58 8 40 9 20 C19 38 25 56 30 76Z" fill="#5d7a39"/>
      <path d="M37 76 C46 58 54 42 56 24 C46 40 39 56 34 76Z" fill="#46622c"/>
      <path d="M33 76 C38 60 42 44 41 30 C35 44 32 60 30 76Z" fill="#668443"/>
    </g>
    <rect x="10" y="72" width="44" height="8" rx="2" fill="#d97a3e"/>
    <path d="M13 79 H51 L46 116 H18 Z" fill="#c4622d"/>
    <path d="M15 92 H49" stroke="#a84f22" stroke-width="3"/>
  </svg>`,
  cactus: `<svg width="58" height="96" viewBox="0 0 58 96" aria-hidden="true">
    <path d="M23 64 V22 a6 6 0 0 1 12 0 V64Z" fill="#5f7d3c"/>
    <path d="M23 46 H15 a5 5 0 0 1 -5 -5 V30 a4 4 0 0 1 8 0 V38 H23Z" fill="#56723a"/>
    <path d="M35 40 H42 V26 a4 4 0 0 1 8 0 V36 a6 6 0 0 1 -6 6 H35Z" fill="#56723a"/>
    <path d="M29 20 V62 M26 30 h6 M26 44 h6" stroke="#7f9c55" stroke-width="1"/>
    <circle cx="29" cy="16" r="3" fill="#e46a4a"/>
    <path d="M10 62 H48 L44 94 H14 Z" fill="#d9a52e"/>
    <path d="M12 70 H46" stroke="#b8862a" stroke-width="3"/>
  </svg>`,
  pilea: `<svg width="76" height="104" viewBox="0 0 76 104" aria-hidden="true">
    <g stroke="#4c6a2c" stroke-width="1.6" fill="none">
      <path d="M38 66 C36 50 24 40 14 34"/><path d="M38 66 C40 48 52 38 62 30"/>
      <path d="M38 66 C37 46 38 30 36 14"/><path d="M38 66 C30 54 22 54 10 54"/>
      <path d="M38 66 C46 56 56 54 68 52"/><path d="M38 66 C42 50 46 40 50 22"/>
    </g>
    <g fill="#6e8f45" stroke="#4f6e30" stroke-width="1">
      <circle cx="13" cy="33" r="9"/><circle cx="63" cy="29" r="10"/><circle cx="36" cy="12" r="9"/>
      <circle cx="9" cy="54" r="8"/><circle cx="68" cy="52" r="8"/><circle cx="51" cy="21" r="8"/>
    </g>
    <g fill="#83a356"><circle cx="11" cy="31" r="3"/><circle cx="61" cy="27" r="3.4"/><circle cx="34" cy="10" r="3"/></g>
    <path d="M18 64 H58 L54 100 H22 Z" fill="#d9a52e"/>
    <path d="M24 66 V99 M31 66 V100 M38 66 V100 M45 66 V100 M52 66 V99" stroke="#b8862a" stroke-width="2"/>
    <rect x="16" y="61" width="44" height="6" rx="2" fill="#e4b744"/>
  </svg>`,
};
