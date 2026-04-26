/**
 * server.js — v2
 * - Écoute sur 0.0.0.0 (toutes les interfaces réseau)
 * - Affiche toutes les IPs locales au démarrage
 * - Gère les 3 essais par joueur (bidHint envoyé individuellement)
 */

const path = require('path');
const http = require('http');
const os   = require('os');
const express = require('express');
const { Server } = require('socket.io');

const game = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// --- Fichiers statiques ---
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// --- API de diagnostic ---
app.get('/api/status', (_req, res) => {
  res.json({ state: game.getPublicState() });
});

// --- Fallback SPA ---
app.get('*', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function broadcastState() {
  io.emit('stateUpdate', { state: game.getPublicState() });
}

function getGMSocketId() {
  for (const [id, s] of io.sockets.sockets) {
    if (s.data && s.data.role === 'gm') return id;
  }
  return null;
}

function sendItemToEveryone() {
  const gmSocketId  = getGMSocketId();
  const playerItem  = game.getItemForPlayers();
  const gmItem      = game.getItemForGM();

  io.sockets.sockets.forEach(sock => {
    if (!sock.data || !sock.data.role) return;
    sock.emit('itemUpdate', { item: sock.id === gmSocketId ? gmItem : playerItem });
  });
}

// ------------------------------------------------------------
// Connexion Socket.io
// ------------------------------------------------------------

io.on('connection', socket => {
  console.log(`[+] connexion ${socket.id}`);

  // ---------- JOIN ----------
  socket.on('join', ({ pseudo, role }) => {
    pseudo = (pseudo || '').toString().trim();
    if (!pseudo) return socket.emit('joinError', { message: 'Pseudo obligatoire.' });

    if (role === 'gm') {
      const r = game.addGM(socket.id, pseudo);
      if (!r.ok) return socket.emit('joinError', { message: r.error });
      socket.data.role   = 'gm';
      socket.data.pseudo = pseudo;
      socket.emit('joinSuccess', {
        role: 'gm',
        you:   { pseudo, role: 'gm' },
        state: game.getPublicState(),
        item:  game.getItemForGM(),
      });

    } else if (role === 'player') {
      const r = game.addPlayer(socket.id, pseudo);
      if (!r.ok) return socket.emit('joinError', { message: r.error });
      socket.data.role   = 'player';
      socket.data.pseudo = pseudo;
      socket.emit('joinSuccess', {
        role: 'player',
        you:  { pseudo: r.player.pseudo, points: r.player.points, role: 'player' },
        state: game.getPublicState(),
        item:  game.getItemForPlayers(),
      });

    } else {
      return socket.emit('joinError', { message: 'Rôle inconnu.' });
    }

    broadcastState();
  });

  // ---------- START GAME ----------
  socket.on('startGame', () => {
    if (socket.data.role !== 'gm')
      return socket.emit('errorMessage', { message: 'Seul le MJ peut démarrer la partie.' });
    const r = game.startGame();
    if (!r.ok) return socket.emit('errorMessage', { message: r.error });
    broadcastState();
    sendItemToEveryone();
  });

  // ---------- PLACE BID (un essai parmi MAX_TRIES) ----------
  socket.on('placeBid', ({ amount }) => {
    if (socket.data.role !== 'player')
      return socket.emit('errorMessage', { message: 'Seuls les joueurs peuvent estimer.' });

    const r = game.placeBid(socket.id, amount);
    if (!r.ok) return socket.emit('errorMessage', { message: r.error });

    // Indice directionnel → uniquement pour CE joueur
    socket.emit('bidHint', r.hint);

    // Quand tous les essais sont épuisés → on prévient le MJ
    if (r.hint.isFinal) {
      const gmId = getGMSocketId();
      if (gmId) io.to(gmId).emit('bidPlaced', { pseudo: socket.data.pseudo });
    }

    broadcastState();
  });

  // ---------- ADJUDICATE ----------
  socket.on('adjudicate', () => {
    if (socket.data.role !== 'gm')
      return socket.emit('errorMessage', { message: 'Seul le MJ peut adjuger.' });
    const r = game.adjudicate();
    if (!r.ok) return socket.emit('errorMessage', { message: r.error });
    io.emit('roundResult', { result: r.result });
    broadcastState();
  });

  // ---------- NEXT ITEM ----------
  socket.on('nextItem', () => {
    if (socket.data.role !== 'gm')
      return socket.emit('errorMessage', { message: 'Seul le MJ peut passer à la suite.' });
    const r = game.nextItem();
    if (!r.ok) return socket.emit('errorMessage', { message: r.error });
    if (r.gameOver) {
      io.emit('gameOver', { finalScores: r.finalScores });
      broadcastState();
      return;
    }
    broadcastState();
    sendItemToEveryone();
  });

  // ---------- RESET GAME ----------
  socket.on('resetGame', () => {
    if (socket.data.role !== 'gm')
      return socket.emit('errorMessage', { message: 'Seul le MJ peut réinitialiser la partie.' });
    game.resetGame();
    io.emit('gameReset');
    broadcastState();
    io.sockets.sockets.forEach(s => s.disconnect(true));
  });

  // ---------- DISCONNECT ----------
  socket.on('disconnect', () => {
    console.log(`[-] déconnexion ${socket.id}`);
    const r = game.removeBySocketId(socket.id);
    if (r.type) broadcastState();
  });
});

// ------------------------------------------------------------
// Lancement — écoute sur 0.0.0.0 + affichage des IPs réseau
// ------------------------------------------------------------

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  // Collecte toutes les IPs IPv4 non-loopback
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of (ifaces[name] || [])) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  Les Enchères à l\'Aveugle — serveur démarré  v2');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ► localhost        http://localhost:${PORT}`);
  if (ips.length === 0) {
    console.log('  (aucune IP réseau détectée)');
  } else {
    ips.forEach(({ name, address }) => {
      console.log(`  ► ${name.padEnd(14)} http://${address}:${PORT}`);
    });
  }
  console.log('══════════════════════════════════════════════════');
  console.log('');
});
