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
    const message = err instanceof TypeError ? "Le serveur ne répond pas." : err.message;
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
  $("summary").textContent = `${d.user} · ${d.total_plays} écoute${d.total_plays > 1 ? "s" : ""} sur 7 jours`;
  renderShelves(d);
  renderDeck();
}

// La bibliothèque se lit comme un livre : casier de gauche puis de droite, étage par étage.
// Tous les disques de la journée s'y suivent dans l'ordre, séparés par des intercalaires d'heure.
const COMPARTMENTS = [["a", 1], ["b", 1], ["a", 2], ["b", 2], ["a", 3], ["b", 3]];

function renderShelves(d) {
  document.querySelectorAll(".shelf").forEach((n) => n.remove());
  state.sleeves = [];

  // 1. une seule file : intercalaire « 10 h », puis les albums de 10 h, intercalaire « 11 h »…
  const albums = d.shelves.flatMap((shelf) => shelf.albums.map((album) => ({ album, shelf })))
                          .sort((x, y) => x.album.minute - y.album.minute);
  const items = [];
  let hour = -1;
  for (const entry of albums) {
    const h = Math.floor(entry.album.minute / 60);
    if (h !== hour) { items.push({ divider: h }); hour = h; }
    items.push(entry);
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
    const wing = el("div", `wing ${side}`);
    wing.style.setProperty("--r", r);
    const track = el("div", "track");
    const chunk = chunks[c];
    chunk.forEach((item, k) => {
      const node = item.divider !== undefined ? makeDivider(item.divider) : makeSlot(item.album, item.shelf);
      node.style.setProperty("--f", chunk.length > 1 ? k / (chunk.length - 1) : 0.5);    // toute la largeur
      node.style.zIndex = k + 1;                                                          // les plus tardifs devant
      track.append(node);
      if (item.album) state.sleeves.push({ el: node, album: item.album, shelf: item.shelf });
    });
    wing.append(track, el("div", "board"));
    if (!chunk.length) wing.classList.add("dark");                                        // casier vide : LED éteinte
    if (!albums.length && c === 0) wing.append(el("span", "quiet", "Pas encore d'écoute cette semaine"));
    // deux plantes : au tout début et à la toute fin de la journée
    const plant = c === 0 ? ["snake", "start"] : c === 5 ? ["pilea", "end"] : null;
    if (plant) {
      wing.classList.add(`decor-${plant[1]}`);
      wing.insertAdjacentHTML("beforeend", PLANTS[plant[0]].replace("<svg", `<svg class="plant ${plant[1]}"`));
    }
    row.append(wing);
  });
  $("bookcase").append(row);
}

function makeDivider(hour) {
  // un intercalaire en carton, avec un onglet qui dépasse : « 10 h »
  const div = el("div", "divider");
  div.setAttribute("aria-label", `À partir de ${hour} h`);
  const card = el("span", "card-div");
  card.append(el("span", "tab", `${hour}h`));
  div.append(card);
  return div;
}

function makeSlot(album, shelf) {
  // le bouton (zone cliquable fixe) contient la pochette, qui seule s'anime : plus de clignotement au survol
  const slot = el("button", "slot");
  slot.type = "button";
  slot.style.setProperty("--color", colorFor(album.key));
  if (album.cover) slot.style.setProperty("--img", `url("${album.cover}")`);
  slot.setAttribute("aria-label", `${album.album}, ${album.artist}, ${album.plays} écoute(s), ${shelf.label.toLowerCase()}`);

  const sleeve = el("span", "sleeve");
  const front = el("span", "front");
  if (!album.cover) front.append(el("span", "name", album.album));                       // pochette maison
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

  let cover, name, kicker, title, meta, tracks = [];
  if (pick) {
    const { album, shelf } = pick;
    cover = album.cover; name = album.album;
    kicker = `${shelf.label} · ${album.plays} écoute${album.plays > 1 ? "s" : ""}`;
    title = album.album; meta = album.artist; tracks = album.tracks;
  } else if (playing) {
    const t = d.now_playing;
    cover = t.cover; name = t.album || t.name;
    kicker = "En train d'écouter"; title = t.name;
    meta = [t.artist, t.album].filter(Boolean).join(" · ") + (t.loved ? "  ♥" : "");
  } else if (d.last_played) {
    const t = d.last_played;
    cover = t.cover; name = t.album || t.name;
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
  $("tracks").replaceChildren(...tracks.slice().reverse().map((t) => {
    const li = el("li");
    li.append(el("time", "", t.time), el("span", "", t.name));
    if (t.loved) li.append(el("span", "heart", "♥"));
    return li;
  }));
  $("back").hidden = live;
  for (const s of state.sleeves) s.el.classList.toggle("selected", s.album.id === state.selected);
}

function putOnDeck(cover, name) {
  // le disque entier prend la pochette ; sans pochette, une couleur unie avec le nom de l'album
  const record = $("record");
  const key = cover || `color:${name}`;
  if (record.dataset.key === key) return;
  record.classList.add("swap");
  setTimeout(() => {
    record.style.setProperty("--disc-img", cover ? `url("${cover}")` : "none");
    record.style.setProperty("--disc-color", colorFor(name || ""));
    $("record-text").textContent = cover ? "" : name;
    record.dataset.key = key;
    record.classList.remove("swap");
  }, 250);
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
  const facts = [];
  const fmt = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
  if (info.duration) facts.push(["", `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, "0")}`]);
  if (info.track_count) facts.push([info.track_count, " titres"]);
  if (info.released) facts.push(["", `sorti le ${info.released}`]);
  if (info.user_plays) facts.push([info.user_plays, kind === "album" ? " écoutes au total" : ` écoute${info.user_plays > 1 ? "s" : ""} par toi`]);
  if (info.listeners) facts.push([fmt.format(info.listeners), " auditeurs sur Last.fm"]);
  $("facts").replaceChildren(...facts.map(([strong, text]) => {
    const li = el("li");
    if (strong !== "") li.append(el("b", "", String(strong)));
    li.append(text);
    return li;
  }));
  $("tags").replaceChildren(...(info.tags || []).map((t) => el("li", "", t)));
  $("about").textContent = info.summary || "";
}

function renderEmpty(message) {
  showBanner(message);
  $("summary").textContent = "";
  $("kicker").textContent = "Pas de signal";
  $("title").textContent = "Last.fm est injoignable";
  $("meta").textContent = `${message} La page réessaie toute seule toutes les 30 secondes.`;
  $("record-text").textContent = "Pas de signal";
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
  const order = state.sleeves.slice().sort((a, b) => a.album.minute - b.album.minute);  // dans l'ordre de la journée
  const i = order.findIndex((s) => s.album.id === state.selected);
  const step = e.key === "ArrowRight" ? 1 : -1;
  const next = i === -1 ? (step > 0 ? 0 : order.length - 1) : (i + step + order.length) % order.length;
  state.selected = order[next].album.id;
  renderDeck();
});

// ---------------------------------------------------------------- bulle d'info
let tip;
function showTip(e, album) {
  hideTip();
  tip = el("div", "tip");
  const first = hhmm(album.minute);
  tip.append(el("strong", "", album.album), el("small", "", album.artist),
             el("small", "", `${album.plays} écoute${album.plays > 1 ? "s" : ""} · dès ${first}${album.loved ? " · ♥" : ""}`));
  document.body.append(tip);
  moveTip(e);
}
function moveTip(e) {
  if (!tip) return;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.max(8, e.clientY - tip.offsetHeight - 14)}px`;
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
