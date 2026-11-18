# Live Studio

Mes écoutes Last.fm des 7 derniers jours, rangées dans une bibliothèque en noyer des années 70.

- **La platine**, au centre, fait tourner le disque que j'écoute en ce moment. La pochette couvre tout le disque. En dessous, une fiche donne le morceau, l'artiste, l'album et au plus deux infos (durée, nombre de titres, genre), tirées de Deezer. Quand rien ne joue, le bras se relève et la platine montre ma dernière écoute.
- **La bibliothèque** se lit comme un livre : casier de gauche puis de droite, étage par étage. Les disques remplissent toute la place et sont séparés par des **intercalaires** en carton. On range la bibliothèque de 4 façons, avec les boutons « Ranger par » :
  - **Heure** : dans l'ordre de la journée, un intercalaire par heure (`10h`, `11h`…) ;
  - **Genre** : un intercalaire par genre (`Rap/Hip Hop`, `Pop`…), donné par Deezer ;
  - **A–Z** : par ordre alphabétique des albums ;
  - **Écoutes** : du plus au moins écouté (`10+ fois`, `5–9 fois`…).
- **Un post-it ♥** marque les albums dont j'ai « aimé » un morceau sur Last.fm.
- On **sort un disque** en le survolant, et un clic le pose sur la platine. On peut aussi sortir un intercalaire pour voir son groupe. ← → feuillettent les disques dans l'ordre affiché, Échap revient au direct.
- Sous la platine, **« Cette semaine »** : mes écoutes heure par heure, le nombre d'écoutes, d'albums et mon heure de pointe.
- **Si Last.fm ne répond pas** et que la page n'a encore rien reçu, le studio est fermé : portes closes sur chaque casier et un message clair.

## Lancer l'appli

Il faut Docker, et une clé API Last.fm ([en créer une](https://www.last.fm/api/account/create)).

```sh
git clone https://github.com/paul-simonet/ma-musique.git
cd ma-musique
cp .env.example .env      # PowerShell : Copy-Item .env.example .env
# ouvrir .env et remplir LASTFM_API_KEY (et LASTFM_USER pour un autre compte)
docker compose up --build
```

Puis ouvrir <http://localhost:8080>.

Sans fichier `.env`, l'appli démarre quand même, et la page explique qu'il manque la clé.

## En ligne

L'appli tourne sur <https://student20.wt.thomasjuldo.com>, derrière Caddy (HTTPS automatique).

Sur le serveur, dans le dossier `ma-musique` (avec un `.env` créé sur place) :

```sh
docker compose -f compose.yaml -f compose.server.yaml up -d --build
```

`compose.server.yaml` ajoute Caddy, qui seul ouvre les ports 80 et 443, et retire le port 8080 de l'appli. Le `Caddyfile` envoie tout le trafic vers `web:8000`. Pour mettre à jour : `git pull`, puis la même commande.

## Comment ça marche

```
Navigateur ──► serveur Flask (Docker) ──► API Last.fm   (mes écoutes)
                    │                 └─► API Deezer    (pochettes et durées manquantes)
   /api/music       cache 45 s
   /cover, /art     les images passent par le serveur
```

- Le navigateur ne parle **qu'à mon serveur**. Les données passent par `/api/music`, les pochettes par `/cover/...` (Last.fm) ou `/art?...` (Deezer, quand Last.fm n'a pas de pochette). Aucune requête ne part vers Last.fm depuis la page.
- La **clé API** est lue dans la variable d'environnement `LASTFM_API_KEY`, qui vient du fichier `.env`. Ce fichier est ignoré par Git.
- **Un seul appel à Last.fm par rafraîchissement** (`user.getRecentTracks`, mes 200 dernières écoutes), et la réponse est gardée **45 secondes en mémoire** pour tous les visiteurs. Deux rechargements de suite ne font donc qu'un seul appel. L'en-tête `X-Cache` de `/api/music` indique `MISS` (appel à Last.fm), `HIT` (réponse du cache) ou `STALE` (Last.fm en panne, dernières données connues). Chaque appel est écrit dans les logs : `docker compose logs -f`.
- Les infos en plus (pochettes manquantes, durée d'un morceau, nombre de titres) viennent de l'API publique de Deezer, sans clé. Elles sont gardées 1 h et ne comptent pas dans les appels à Last.fm.
- **Si Last.fm tombe**, la page garde les derniers disques connus et affiche un bandeau. S'il n'y a encore aucune donnée, elle affiche un message, puis réessaie toute seule toutes les 30 secondes.
- **Tester une panne de Last.fm** : ajouter `LASTFM_URL=http://127.0.0.1:9/` dans `.env`, puis `docker compose up -d`. Retirer la ligne pour revenir à la normale.
- La page tient sur **un seul écran** d'ordinateur, sans défilement, et s'adapte au **téléphone** : la platine en haut, la bibliothèque en dessous.

## Fichiers

| Fichier | Rôle |
|---|---|
| `compose.yaml` | Le service `web`, sur le port 8080 |
| `compose.server.yaml`, `Caddyfile` | En plus, sur le serveur : Caddy devant l'appli, en HTTPS |
| `app/server.py` | Le serveur : appels à Last.fm, cache, pochettes, erreurs |
| `app/static/` | La page : `index.html`, `style.css`, `app.js` |
| `.env.example` | Le modèle du fichier `.env`, sans la clé |
