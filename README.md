# Live Studio

Mes écoutes Last.fm des 7 derniers jours, rangées dans une bibliothèque en noyer des années 70.

- **La platine**, au centre, fait tourner le disque que j'écoute en ce moment. La pochette couvre tout le disque. En dessous, une fiche donne la durée, le nombre d'écoutes, les genres et un résumé, tirés de Last.fm. Quand rien ne joue, le bras se relève et la platine montre ma dernière écoute.
- **La bibliothèque** a 3 étages : la nuit (0 h–8 h), la journée (8 h–16 h) et le soir (16 h–24 h). Sur chaque étage, les disques sont rangés dans l'ordre de la journée, de gauche à droite, et se répartissent sur toute la largeur.
- **Un post-it ♥** marque les albums dont j'ai « aimé » un morceau sur Last.fm.
- On **sort un disque** en le survolant. Un clic le pose sur la platine, avec la liste des morceaux écoutés. ← → feuillettent les disques, Échap revient au direct.

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

## Comment ça marche

```
Navigateur ──► serveur Flask (Docker) ──► API Last.fm
   /api/music      cache 45 s
   /cover/...      pochettes servies par le serveur
```

- Le navigateur ne parle **qu'à mon serveur** : les données passent par `/api/music`, les pochettes par `/cover/<image>`. Aucune requête ne part vers Last.fm depuis la page.
- La **clé API** est lue dans la variable d'environnement `LASTFM_API_KEY`, qui vient du fichier `.env`. Ce fichier est ignoré par Git.
- Le serveur garde la réponse de Last.fm **45 secondes en mémoire**. Deux rechargements de suite ne font qu'un seul appel. L'en-tête `X-Cache` de `/api/music` indique `MISS` (appel à Last.fm), `HIT` (réponse du cache) ou `STALE` (Last.fm en panne, dernières données connues). Chaque appel à Last.fm est écrit dans les logs : `docker compose logs -f`.
- **Si Last.fm tombe**, la page garde les derniers disques connus et affiche un bandeau. S'il n'y a encore aucune donnée, elle affiche un message, puis réessaie toute seule toutes les 30 secondes.
- **Tester une panne de Last.fm** : ajouter `LASTFM_URL=http://127.0.0.1:9/` dans `.env`, puis `docker compose up -d`. Le serveur ne peut plus joindre Last.fm, et la page affiche un message au lieu d'un écran vide. Retirer la ligne pour revenir à la normale.
- La page s'adapte au **téléphone** : la platine en haut, l'étagère en dessous, qu'on fait défiler.

## Fichiers

| Fichier | Rôle |
|---|---|
| `compose.yaml` | Le service `web`, sur le port 8080 |
| `app/server.py` | Le serveur : appels à Last.fm, cache, pochettes, erreurs |
| `app/static/` | La page : `index.html`, `style.css`, `app.js` |
| `.env.example` | Le modèle du fichier `.env`, sans la clé |
