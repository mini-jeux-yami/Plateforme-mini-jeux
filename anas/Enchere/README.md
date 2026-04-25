# Les Enchères à l'Aveugle — Le Juste Prix

Jeu web multijoueur en temps réel pour **1 Maître du Jeu + 3 Joueurs**.
Chaque joueur voit défiler des objets et doit **estimer leur vraie valeur**.
Plus l'estimation est précise, plus elle rapporte de **points**.
À la fin de la pile d'objets, le joueur avec le plus de points gagne.

## Installation

```bash
cd backend
npm install
npm start
```

Le serveur écoute sur `http://localhost:3000`.

Ouvrez 4 onglets (ou 4 appareils) sur cette même URL.
Le 1er joueur à cliquer **« Créer en tant que Maître du Jeu »** devient MJ.
Les 3 suivants cliquent **« Rejoindre en tant que Joueur »**.

## Mode test (jouer seul les 4 rôles)

Un lien **🧪 Mode test** sous le formulaire du lobby ouvre `/test.html`,
une page qui charge 4 iframes (1 MJ + 3 joueurs) auto-loguées via les
paramètres d'URL `?role=...&pseudo=...`. Pratique pour tester une
partie complète tout seul.

## Architecture SPA

Le frontend est une **Single Page Application** : une seule URL (`/`),
un seul fichier HTML, un seul fichier JS. Le rôle choisi au lobby
détermine simplement quelle vue est rendue. Pas de rechargement,
pas de `sessionStorage` pour transporter l'état entre pages.

```
Enchere/
├── backend/
│   ├── server.js         # Express (static + fallback SPA) + Socket.io
│   ├── gameLogic.js      # État global + scan des images + Fisher-Yates
│   └── package.json
├── frontend/
│   ├── index.html        # 3 vues : #view-lobby, #view-player, #view-gm
│   ├── test.html         # mode test (4 iframes)
│   ├── css/style.css
│   ├── js/app.js         # une seule socket, switch de vue interne
│   └── images/           # TOUS les objets du jeu viennent d'ici
│       ├── items.json    # manifeste : nom-de-fichier → prix
│       ├── vase-ming.svg
│       └── …
└── README.md
```

### Ajouter / remplacer un objet

C'est volontairement minimaliste : **un fichier image + une ligne JSON**.

1. Déposez une image (`.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`)
   dans `frontend/images/`.
2. Ouvrez `frontend/images/items.json` et ajoutez **une seule ligne** :
   ```json
   "ma-belle-pendule.svg": 1750
   ```
   La clé est le **nom de fichier exact**, la valeur est le **prix en €**.
   Le nom affiché dans le jeu est dérivé du nom de fichier
   (`ma-belle-pendule.svg` → *Ma Belle Pendule*).

3. Si vous voulez personnaliser le nom affiché, utilisez la forme étendue :
   ```json
   "ma-belle-pendule.svg": { "name": "Pendule Louis XV", "price": 1750 }
   ```
   (`trueValue` est aussi accepté comme alias de `price`.)

4. Redémarrez le serveur. Les images sans entrée dans le manifeste sont
   ignorées (un `console.warn` le signale).

### Déroulement d'une partie

- Au clic sur **« Lancer la partie »**, le serveur relit le dossier,
  construit la liste des objets et la **mélange** (Fisher–Yates).
- Les objets sont ensuite piochés un par un, dans cet ordre aléatoire.
- **Quand la pile est vide, la partie s'arrête** et l'écran de
  classement final s'affiche.
- **Entre chaque manche**, un panneau récapitule l'estimation de
  chaque joueur, l'écart à la vraie valeur, les pastilles bonus
  obtenues et les points gagnés. Le classement courant est aussi
  affiché côté joueur (modale) et côté MJ (panneau latéral).

## Règles & scoring

Le jeu est une variante du *Juste Prix* : il n'y a **pas d'argent**,
seulement des **points**.

À chaque tour, chaque joueur soumet son estimation secrète. Quand le
MJ clique **« Adjugé ! »**, les estimations sont révélées et chaque
joueur reçoit :

| Bonus | Quand ? | Cumulable ? |
|---|---|---|
| **+1 pt** | Vous êtes le **plus proche** de la vraie valeur (en cas d'égalité, tous les ex-aequo gagnent ce point) | oui |
| **+1 pt** | Votre estimation est **dans ±5 %** de la vraie valeur | oui |
| **+1 pt** | Votre estimation est **exactement** la vraie valeur | oui |

Donc un joueur qui tombe pile reçoit **3 points** (plus proche + 5 % + exact).

### Manche bonus (×2)

Toutes les **10 manches** (manche n° 10, 20, 30…), **tous les points
distribués pendant cette manche sont doublés**. Un bandeau
*« ⚡ Manche bonus : points doublés ! »* l'annonce sur le formulaire
d'estimation et sur l'écran de résultat.

### Comment fonctionne la SPA ?

1. `index.html` contient les 3 vues côte à côte ; deux d'entre elles
   sont masquées via la classe `.hidden`.
2. `app.js` ouvre **une seule** connexion Socket.io au moment où
   l'utilisateur soumet le formulaire de lobby.
3. Quand le serveur répond `joinSuccess`, la fonction `switchView()`
   affiche la vue `player` ou `gm` sans jamais recharger la page.
4. Le serveur ne sert qu'une seule page : toute route inconnue
   retombe sur `index.html` (fallback `app.get('*')`), ce qui permet
   de faire F5 à tout moment.

## Événements Socket.io

### Client → Serveur

| Événement | Payload | Rôle autorisé |
|---|---|---|
| `join` | `{ pseudo, role }` | tous |
| `startGame` | — | MJ |
| `placeBid` | `{ amount }` (= estimation, pas une mise) | Joueur |
| `adjudicate` | — | MJ |
| `nextItem` | — | MJ |
| `resetGame` | — | MJ |

### Serveur → Client

| Événement | Payload | Destinataire |
|---|---|---|
| `joinSuccess` | `{ role, you, state, item }` | l'émetteur |
| `joinError` | `{ message }` | l'émetteur |
| `stateUpdate` | `{ state }` | tous |
| `itemUpdate` | `{ item }` (filtré par rôle) | tous |
| `bidPlaced` | `{ pseudo }` | MJ |
| `waitingForOthers` | — | joueur qui vient d'estimer |
| `roundResult` | `{ result }` | tous |
| `gameOver` | `{ finalScores }` | tous |
| `gameReset` | — | tous |
| `errorMessage` | `{ message }` | l'émetteur |

#### Forme d'un `result` (envoyé après chaque adjudication)

```json
{
  "item": { "id": "vase-ming.svg", "name": "Vase Ming", "image": "/images/…", "trueValue": 4200 },
  "roundNumber": 10,
  "bonusRound": true,
  "multiplier": 2,
  "tolerancePct": 5,
  "bids": [
    {
      "pseudo": "Alice", "amount": 4200, "distance": 0,
      "closest": true, "withinPct": true, "exact": true,
      "basePoints": 3, "points": 6
    }
  ],
  "standings": [{ "pseudo": "Alice", "points": 33 }],
  "remainingItems": 2
}
```
