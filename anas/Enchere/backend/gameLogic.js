/**
 * gameLogic.js
 * ------------------------------------------------------------
 * État global de la partie + logique pure (pas de réseau).
 *
 * Nouveautés v2 :
 *   - Manche d'entraînement (training:true dans items.json) :
 *     toujours en premier, points remis à 0 après.
 *   - 3 essais par joueur par manche (MAX_TRIES).
 *     Après chaque essai, le serveur renvoie un indice directionnel
 *     (higher / lower / exact) + double flèche si > 50 %.
 *     Le dernier essai (3ᵉ) est celui retenu pour le scoring.
 *
 * Scoring (Le Juste Prix) :
 *   +1 pt  le plus proche de la vraie valeur (ex-aequo : tous)
 *   +1 pt  estimation dans ±5 % de la vraie valeur
 *   +1 pt  estimation exactement égale à la vraie valeur
 *   Toutes les 10 manches (hors entraînement) → ×2
 * ------------------------------------------------------------
 */

const fs   = require('fs');
const path = require('path');

const IMAGES_DIR    = path.join(__dirname, '..', 'frontend', 'images');
const MANIFEST_FILE = path.join(IMAGES_DIR, 'items.json');
const IMAGE_EXTS    = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);

const MAX_PLAYERS   = 3;
const MAX_TRIES     = 3;        // essais par joueur par manche
const BIG_DIFF_PCT  = 0.5;      // 50 % → double flèche
const TOLERANCE_PCT = 0.05;     // 5 % → bonus ±5 %
const BONUS_EVERY   = 10;       // doublé toutes les 10 manches réelles

let gameState = {
  gm: null,
  players: [],
  items: [],            // [trainingItems..., regularItems_shuffled...]
  currentItemIndex: 0,
  phase: 'lobby',       // 'lobby' | 'bidding' | 'results' | 'gameOver'
  lastRoundResult: null,
  realRoundCount: 0,    // manches réelles jouées (hors entraînement), pour le calcul du bonus
};

// ------------------------------------------------------------
// Chargement des objets
// ------------------------------------------------------------

function prettifyFilename(file) {
  const base = file.replace(/\.[^.]+$/, '');
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseManifestEntry(file, value) {
  if (typeof value === 'number') {
    return { name: prettifyFilename(file), trueValue: value, training: false };
  }
  if (value && typeof value === 'object') {
    const price = Number(value.price ?? value.trueValue);
    if (!Number.isFinite(price)) return null;
    return {
      name:      value.name || prettifyFilename(file),
      trueValue: price,
      training:  !!value.training,
    };
  }
  return null;
}

function loadItems() {
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch (e) {
    console.warn(`[items] impossible de lire ${MANIFEST_FILE} :`, e.message);
  }

  let files = [];
  try {
    files = fs.readdirSync(IMAGES_DIR);
  } catch (e) {
    console.warn(`[items] impossible de lire ${IMAGES_DIR} :`, e.message);
    return [];
  }

  const items = [];
  for (const file of files) {
    if (file.startsWith('.') || file === 'items.json') continue;
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const meta = parseManifestEntry(file, manifest[file]);
    if (!meta) {
      console.warn(`[items] "${file}" ignoré : pas d'entrée valide dans items.json`);
      continue;
    }
    items.push({
      id:        file,
      name:      meta.name,
      image:     `/images/${encodeURIComponent(file)}`,
      trueValue: meta.trueValue,
      training:  meta.training,
    });
  }
  console.log(`[items] ${items.length} objet(s) chargé(s).`);
  return items;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------
// Sérialisation
// ------------------------------------------------------------

function getPublicPlayer(p) {
  return {
    socketId:  p.socketId,
    pseudo:    p.pseudo,
    points:    p.points,
    hasBid:    p.hasBid,       // true = tous les essais utilisés
    triesUsed: p.triesUsed,
  };
}

function isTrainingRound(idx) {
  if (idx < 0 || idx >= gameState.items.length) return false;
  return !!gameState.items[idx].training;
}

function isBonusRound(realRoundNumber) {
  return realRoundNumber > 0 && realRoundNumber % BONUS_EVERY === 0;
}

function getPublicState() {
  const isTraining = isTrainingRound(gameState.currentItemIndex);
  // On compte les manches réelles (non-training) jouées + cette manche
  const thisRealRound = isTraining ? 0 : gameState.realRoundCount + 1;
  return {
    gm:                   gameState.gm ? { pseudo: gameState.gm.pseudo } : null,
    players:              gameState.players.map(getPublicPlayer),
    phase:                gameState.phase,
    currentItemIndex:     gameState.currentItemIndex,
    totalItems:           gameState.items.length,
    nextRoundIsBonus:     isBonusRound(thisRealRound + 1),
    currentRoundIsTraining: isTraining,
    maxTries:             MAX_TRIES,
  };
}

function getCurrentItem() {
  if (gameState.currentItemIndex >= gameState.items.length) return null;
  return gameState.items[gameState.currentItemIndex];
}
function getItemForPlayers() {
  const item = getCurrentItem();
  if (!item) return null;
  const { trueValue, training, ...safe } = item;
  return safe;
}
function getItemForGM() { return getCurrentItem(); }

// ------------------------------------------------------------
// Inscription / déconnexion
// ------------------------------------------------------------

function canJoinAsPlayer() { return gameState.players.length < MAX_PLAYERS; }
function canJoinAsGM()     { return gameState.gm === null; }

function makePlayer(socketId, pseudo) {
  return {
    socketId,
    pseudo:      (pseudo || 'Joueur').trim().slice(0, 20),
    points:      0,
    hasBid:      false,   // true quand triesUsed >= MAX_TRIES
    currentBid:  null,    // dernier essai soumis (utilisé pour le scoring)
    currentBids: [],      // historique des essais
    triesUsed:   0,
  };
}

function addPlayer(socketId, pseudo) {
  if (!canJoinAsPlayer()) return { ok: false, error: 'La partie est complète (3 joueurs max).' };
  const player = makePlayer(socketId, pseudo);
  gameState.players.push(player);
  return { ok: true, player };
}

function addGM(socketId, pseudo) {
  if (!canJoinAsGM()) return { ok: false, error: 'Un Maître du Jeu est déjà connecté.' };
  gameState.gm = { socketId, pseudo: (pseudo || 'MJ').trim().slice(0, 20) };
  return { ok: true, gm: gameState.gm };
}

function removeBySocketId(socketId) {
  if (gameState.gm && gameState.gm.socketId === socketId) {
    gameState.gm = null;
    return { type: 'gm' };
  }
  const idx = gameState.players.findIndex(p => p.socketId === socketId);
  if (idx !== -1) {
    gameState.players.splice(idx, 1);
    return { type: 'player' };
  }
  return { type: null };
}

// ------------------------------------------------------------
// Cycle de partie
// ------------------------------------------------------------

function startGame() {
  if (gameState.players.length !== MAX_PLAYERS || !gameState.gm) {
    return { ok: false, error: 'Il faut 1 MJ et 3 joueurs pour commencer.' };
  }
  const loaded = loadItems();
  if (loaded.length === 0) {
    return { ok: false, error: "Aucune image valide dans frontend/images/." };
  }

  const trainingItems = loaded.filter(i => i.training);
  const regularItems  = shuffle(loaded.filter(i => !i.training));

  gameState.items            = [...trainingItems, ...regularItems];
  gameState.currentItemIndex = 0;
  gameState.realRoundCount   = 0;
  gameState.phase            = 'bidding';
  gameState.players.forEach(p => { p.points = 0; });
  resetBids();
  return { ok: true };
}

function resetBids() {
  gameState.players.forEach(p => {
    p.hasBid      = false;
    p.currentBid  = null;
    p.currentBids = [];
    p.triesUsed   = 0;
  });
}

/**
 * Soumet un essai pour un joueur.
 * Retourne un indice directionnel (hint) envoyé uniquement à ce joueur.
 * C'est le DERNIER essai qui compte pour le scoring.
 */
function placeBid(socketId, amount) {
  if (gameState.phase !== 'bidding') return { ok: false, error: "Ce n'est pas le moment d'estimer." };
  const player = gameState.players.find(p => p.socketId === socketId);
  if (!player) return { ok: false, error: 'Joueur inconnu.' };
  if (player.hasBid) return { ok: false, error: 'Vous avez déjà utilisé vos 3 essais.' };

  const bid = Math.floor(Number(amount));
  if (!Number.isFinite(bid) || bid < 0) return { ok: false, error: 'Estimation invalide.' };

  player.currentBids.push(bid);
  player.triesUsed += 1;
  player.currentBid = bid;   // dernier essai = utilisé pour le scoring

  const item       = getCurrentItem();
  const trueValue  = item.trueValue;
  const diff       = bid - trueValue;
  const diffPct    = trueValue > 0 ? Math.abs(diff) / trueValue : 0;
  const big        = diffPct >= BIG_DIFF_PCT;

  let direction;
  if (bid === trueValue)  direction = 'exact';
  else if (bid < trueValue) direction = 'higher';   // le vrai prix est plus élevé
  else                    direction = 'lower';      // le vrai prix est plus bas

  const isFinal = player.triesUsed >= MAX_TRIES;
  if (isFinal) player.hasBid = true;

  return {
    ok: true,
    player,
    hint: { direction, big, tryNumber: player.triesUsed, isFinal, amount: bid },
  };
}

function allPlayersBid() {
  return gameState.players.length > 0 && gameState.players.every(p => p.hasBid);
}

/**
 * Adjudication : calcul des bonus et attribution des points.
 * Utilise le dernier essai (currentBid) de chaque joueur.
 */
function adjudicate() {
  if (gameState.phase !== 'bidding') return { ok: false, error: "L'enchère n'est pas en cours." };
  const item = getCurrentItem();
  if (!item) return { ok: false, error: 'Aucun objet en vente.' };

  const trueValue = item.trueValue;
  const tolerance = trueValue * TOLERANCE_PCT;
  const isTraining = !!item.training;

  // table des estimations (dernier essai)
  const bids = gameState.players.map(p => {
    const amount   = p.currentBid;   // null si aucun essai soumis
    const distance = amount == null ? Infinity : Math.abs(amount - trueValue);
    return { socketId: p.socketId, pseudo: p.pseudo, amount, distance, triesUsed: p.triesUsed, allBids: [...p.currentBids] };
  });

  const submittedDistances = bids.filter(b => b.amount != null).map(b => b.distance);
  const minDistance = submittedDistances.length ? Math.min(...submittedDistances) : Infinity;

  // numéro de manche réelle (hors entraînement)
  const realRound = isTraining ? 0 : gameState.realRoundCount + 1;
  const bonusRound = !isTraining && isBonusRound(realRound);
  const multiplier = bonusRound ? 2 : 1;

  const breakdown = bids.map(b => {
    if (b.amount == null) {
      return { ...b, closest: false, withinPct: false, exact: false, basePoints: 0, points: 0 };
    }
    const closest    = b.distance === minDistance;
    const withinPct  = b.distance <= tolerance;
    const exact      = b.amount === trueValue;
    const basePoints =
      (closest   ? 1 : 0) +
      (withinPct ? 1 : 0) +
      (exact     ? 1 : 0);

    return { ...b, closest, withinPct, exact, basePoints, points: isTraining ? 0 : basePoints * multiplier };
  });

  // créditer les joueurs (jamais pendant la manche d'entraînement)
  if (!isTraining) {
    breakdown.forEach(b => {
      const p = gameState.players.find(pl => pl.socketId === b.socketId);
      if (p) p.points += b.points;
    });
  }

  const standings = gameState.players
    .map(p => ({ pseudo: p.pseudo, points: p.points }))
    .sort((a, b) => b.points - a.points);

  const result = {
    item,
    isTraining,
    roundNumber: isTraining ? 0 : realRound,
    bonusRound,
    multiplier,
    tolerancePct: TOLERANCE_PCT * 100,
    bids: breakdown,
    standings,
    remainingItems: Math.max(0, gameState.items.length - gameState.currentItemIndex - 1),
    maxTries: MAX_TRIES,
  };

  gameState.lastRoundResult = result;
  gameState.phase           = 'results';
  return { ok: true, result };
}

function nextItem() {
  if (gameState.phase !== 'results') return { ok: false, error: 'Aucun résultat à clôturer.' };

  const wasTraining = isTrainingRound(gameState.currentItemIndex);
  if (!wasTraining) gameState.realRoundCount += 1;

  gameState.currentItemIndex += 1;

  if (gameState.currentItemIndex >= gameState.items.length) {
    gameState.phase = 'gameOver';
    return { ok: true, gameOver: true, finalScores: computeFinalScores() };
  }

  // Remise à zéro des points après la manche d'entraînement
  if (wasTraining) {
    gameState.players.forEach(p => { p.points = 0; });
  }

  gameState.phase = 'bidding';
  resetBids();
  return { ok: true, gameOver: false };
}

function computeFinalScores() {
  return gameState.players
    .map(p => ({ pseudo: p.pseudo, points: p.points }))
    .sort((a, b) => b.points - a.points);
}

function resetGame() {
  gameState.players          = [];
  gameState.gm               = null;
  gameState.currentItemIndex = 0;
  gameState.realRoundCount   = 0;
  gameState.phase            = 'lobby';
  gameState.lastRoundResult  = null;
  gameState.items            = [];
}

module.exports = {
  getPublicState, getItemForPlayers, getItemForGM, getCurrentItem,
  canJoinAsPlayer, canJoinAsGM, addPlayer, addGM, removeBySocketId,
  startGame, placeBid, allPlayersBid, adjudicate, nextItem,
  computeFinalScores, resetGame, loadItems, shuffle,
  MAX_PLAYERS, MAX_TRIES, TOLERANCE_PCT, BONUS_EVERY,
};
