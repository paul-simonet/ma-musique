// Ma semaine en vinyles : la page ne parle qu'à notre serveur (/api/music et /cover/...).
const REFRESH_MS = 30_000;
const PALETTE = ["#d0692a", "#d9a52e", "#7b7a2e", "#a3472a", "#c98b3c", "#5f6b3a", "#8c5a2b", "#b8662f"];

const $ = (id) => document.getElementById(id);
const state = { data: null, selected: null, spines: [] };

// ---------------------------------------------------------------- chargement
async function load() {
  try {
    const reply = await fetch("/api/music", { cache: "no-store" });
    const body = await reply.json();
    if (!reply.ok) throw new Error(body.message || "Le serveur n'a pas pu lire Last.fm.");
    state.data = body;
    render();
    showBanner(body.stale
      ? `Last.fm ne répond pas : j'affiche les disques de ${clock(body.fetched_at)}.`
      : "");
  } catch (err) {
    const message = err instanceof TypeError ? "Le serveur ne répond pas." : err.message;
    if (state.data) {
      showBanner(`${message} J'affiche les derniers disques connus.`);
    } else {
      renderEmpty(message);
    }
  }
}

function showBanner(text) {
  $("banner").hidden = !text;
  $("banner").textContent = text;
}

// ---------------------------------------------------------------- rendu
function render() {
  const d = state.data;
  $("user").textContent = d.user;
  const busiest = d.days.reduce((a, b) => (b.plays > a.plays ? b : a), d.days[0]);
  $("summary").textContent = d.total_plays
    ? `${d.total_plays} écoutes sur 7 jours · jour le plus chargé : ${busiest.label.toLowerCase()} (${busiest.plays})`
    : "Aucune écoute cette semaine : lance un disque !";
  renderLight(d);
  renderShelves(d);
  renderDeck();
}

function renderLight(d) {
  // La pièce prend la lumière de l'heure de la dernière écoute (ou de maintenant si un disque tourne).
  const hour = d.now_playing ? d.hour : (d.last_played ? d.last_played.hour : d.hour);
  let glow, shade, name;
  if (hour < 6)       { glow = "rgba(90,110,200,.55)";  shade = .62; name = "nuit"; }
  else if (hour < 12) { glow = "rgba(200,225,255,.50)"; shade = .30; name = "matin"; }
  else if (hour < 18) { glow = "rgba(255,225,170,.50)"; shade = .35; name = "après-midi"; }
  else                { glow = "rgba(255,140,50,.65)";  shade = .48; name = "soirée"; }
  document.documentElement.style.setProperty("--glow", glow);
  document.documentElement.style.setProperty("--shade", shade);
  document.documentElement.style.setProperty("--legend-glow", glow.replace(/[\d.]+\)$/, "1)"));
  $("light-legend").textContent = `Lumière = heure de ta dernière écoute (${name}, ${hour} h)`;
}

function renderShelves(d) {
  const shelves = $("shelves");
  shelves.replaceChildren();
  state.spines = [];
  for (const day of d.days.slice().reverse()) {   // aujourd'hui en haut, il y a 6 jours en bas
    const row = el("div", "row");
    row.append(el("span", "plaque", `${day.label} · ${day.plays} écoute${day.plays > 1 ? "s" : ""}`));
    const rack = el("div", day.albums.length ? "rack" : "rack bare");
    if (!day.albums.length) rack.append(el("span", "empty", "Rien écouté ce jour-là"));
    for (const album of day.albums) {
      const spine = makeSpine(album, day);
      rack.append(spine);
      state.spines.push({ el: spine, album, day });
    }
    row.append(rack, el("div", "board"));
    shelves.append(row);
  }
}

function makeSpine(album, day) {
  const spine = el("button", "spine");
  spine.type = "button";
  const width = Math.min(64, 8 + album.plays * 5);          // épaisseur = nombre d'écoutes
  spine.style.setProperty("--w", `${width}px`);
  spine.style.setProperty("--dust", Math.min(0.85, album.days_since / 5).toFixed(2));  // poussière
  spine.style.setProperty("--spine", colorFor(album.key));
  spine.style.setProperty("--pos", `${hash(album.key) % 100}%`);
  spine.style.setProperty("--img", album.cover ? `url("${album.cover}")` : stripes(album.key, "180deg"));
  if (album.days_since < 1) spine.classList.add("fresh");                              // brille si écouté aujourd'hui
  spine.setAttribute("aria-label", `${album.album}, ${album.artist}, ${album.plays} écoute(s), ${day.label}`);
  if (width >= 22) spine.append(el("span", "spine-name", album.album));
  if (album.loved) spine.append(el("span", "postit", "♥"));                            // coup de cœur
  spine.addEventListener("click", () => select(album.id));
  spine.addEventListener("mouseenter", (e) => showTip(e, album));
  spine.addEventListener("mousemove", moveTip);
  spine.addEventListener("mouseleave", hideTip);
  if (album.id === state.selected) spine.classList.add("selected");
  return spine;
}

function renderDeck() {
  const d = state.data;
  const pick = state.spines.find((s) => s.album.id === state.selected);
  const live = !pick;
  const playing = live && d.now_playing;
  const record = $("record"), label = $("label");

  let cover, text, kicker, title, meta, tracks = [];
  if (pick) {
    const { album, day } = pick;
    cover = album.cover; text = album.album;
    kicker = `${day.label} · ${album.plays} écoute${album.plays > 1 ? "s" : ""}`;
    title = album.album; meta = album.artist;
    tracks = album.tracks;
  } else if (playing) {
    const t = d.now_playing;
    cover = t.cover; text = t.album || t.name;
    kicker = "En train d'écouter"; title = t.name;
    meta = [t.artist, t.album].filter(Boolean).join(" · ") + (t.loved ? "  ♥" : "");
  } else if (d.last_played) {
    const t = d.last_played;
    cover = t.cover; text = t.album || t.name;
    kicker = `Dernière écoute ${ago(t.ts)}`; title = t.name;
    meta = [t.artist, t.album].filter(Boolean).join(" · ");
  } else {
    text = "Pas de disque"; kicker = "Silence"; title = "Rien cette semaine";
    meta = "Écoute un morceau sur Deezer, il apparaîtra ici.";
  }

  // changer d'étiquette en douceur
  const next = cover ? `url("${cover}")` : "none";
  if (label.dataset.img !== next) {
    label.classList.add("swap");
    setTimeout(() => {
      label.style.backgroundImage = cover ? next : rings(text || "");
      label.style.backgroundColor = colorFor(text || "");
      $("label-text").textContent = cover ? "" : text;
      label.dataset.img = next;
      label.classList.remove("swap");
    }, 250);
  }

  record.classList.toggle("spinning", Boolean(playing));
  record.style.animationPlayState = playing ? "running" : "paused";
  $("tonearm").classList.toggle("on", Boolean(playing));
  $("power").classList.toggle("on", Boolean(playing));

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

  for (const s of state.spines) s.el.classList.toggle("selected", s.album.id === state.selected);
}

function renderEmpty(message) {
  $("user").textContent = "…";
  $("summary").textContent = "";
  showBanner(message);
  $("kicker").textContent = "Pas de signal";
  $("title").textContent = "Last.fm est injoignable";
  $("meta").textContent = `${message} La page réessaie toute seule toutes les 30 secondes.`;
  $("label-text").textContent = "Pas de signal";
  $("shelves").replaceChildren(el("p", "empty", "L'étagère reviendra avec les données."));
}

// ---------------------------------------------------------------- navigation
function select(id) {
  state.selected = state.selected === id ? null : id;
  hideTip();
  renderDeck();
}

$("back").addEventListener("click", () => select(null));
document.addEventListener("keydown", (e) => {
  if (!state.spines.length) return;
  if (e.key === "Escape") return select(null);
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const i = state.spines.findIndex((s) => s.album.id === state.selected);
  const step = e.key === "ArrowRight" ? 1 : -1;
  const next = i === -1 ? (step > 0 ? 0 : state.spines.length - 1)
                        : (i + step + state.spines.length) % state.spines.length;
  state.selected = state.spines[next].album.id;
  state.spines[next].el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  renderDeck();
});

// ---------------------------------------------------------------- bulle d'info
let tip;
function showTip(e, album) {
  hideTip();
  tip = el("div", "tip");
  const img = album.cover ? Object.assign(document.createElement("img"), { src: album.cover, alt: "" }) : el("span", "noimg");
  const text = el("div");
  text.append(el("strong", "", album.album), el("small", "", album.artist),
              el("small", "", `${album.plays} écoute${album.plays > 1 ? "s" : ""} · ${album.days_since < 1 ? "aujourd'hui" : `il y a ${Math.floor(album.days_since)} j`}`));
  tip.append(img, text);
  document.body.append(tip);
  moveTip(e);
}
function moveTip(e) {
  if (!tip) return;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
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
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function colorFor(s) { return PALETTE[hash(s) % PALETTE.length]; }
// pochette « maison » dans le style 70s quand Last.fm n'en a pas
function trio(s) { const h = hash(s); return [0, 3, 5].map((k) => PALETTE[(h + k) % PALETTE.length]); }
function stripes(s, dir) {
  const [a, b, c] = trio(s);
  return `linear-gradient(${dir}, ${a} 0 38%, ${b} 38% 52%, ${c} 52% 66%, ${a} 66%)`;
}
function rings(s) {
  const [a, b, c] = trio(s);
  return `radial-gradient(circle, ${a} 0 34%, ${b} 34% 48%, ${c} 48% 62%, ${a} 62%)`;
}
function clock(ts) { return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function ago(ts) {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
