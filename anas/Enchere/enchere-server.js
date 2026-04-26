/**
 * enchere-server.js
 * ---------------------------------------------------------
 * Handler Socket.io pour le jeu "L'Enchère à l'Aveugle".
 * Utilise le namespace /enchere pour ne pas interférer avec
 * les autres jeux de la plateforme.
 *
 * Intégration profil plateforme :
 *   - L'événement `join` accepte désormais { pseudo, role, profile_pic }
 *   - profile_pic est propagé dans l'état public des joueurs
 * ---------------------------------------------------------
 */

const gameLogic = require('./backend/gameLogic.js');

module.exports = function (io) {
  const enchereIo = io.of('/enchere');

  // ----------------------------------------------------------
  // Helper : envoie l'item en tenant compte du rôle
  // (le GM reçoit la vraie valeur, les joueurs non)
  // ----------------------------------------------------------
  function broadcastItemByRole() {
    const gmSocketId = gameLogic.getGMSocketId();
    const playerItem = gameLogic.getItemForPlayers();
    const gmItem     = gameLogic.getItemForGM();

    enchereIo.sockets.forEach((clientSocket) => {
      if (clientSocket.id === gmSocketId) {
        clientSocket.emit('itemUpdate', { item: gmItem });
      } else {
        clientSocket.emit('itemUpdate', { item: playerItem });
      }
    });
  }

  // ----------------------------------------------------------
  // Connexion
  // ----------------------------------------------------------
  enchereIo.on('connection', (socket) => {

    // ---- JOIN -----------------------------------------------
    socket.on('join', ({ pseudo, role, profile_pic }) => {
      pseudo = (pseudo || '').trim();
      if (!pseudo) {
        socket.emit('joinError', { message: 'Merci de renseigner un pseudo.' });
        return;
      }

      if (role === 'gm') {
        const result = gameLogic.addGM(socket.id, pseudo, profile_pic);
        if (!result.ok) {
          socket.emit('joinError', { message: result.error });
          return;
        }
        socket.emit('joinSuccess', {
          role: 'gm',
          you:   result.gm,
          state: gameLogic.getPublicState(),
          item:  gameLogic.getItemForGM(),
        });
      } else {
        const result = gameLogic.addPlayer(socket.id, pseudo, profile_pic);
        if (!result.ok) {
          socket.emit('joinError', { message: result.error });
          return;
        }
        socket.emit('joinSuccess', {
          role: 'player',
          you:   result.player,
          state: gameLogic.getPublicState(),
          item:  gameLogic.getItemForPlayers(),
        });
      }

      // Notifie tout le monde du nouvel état du lobby
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
    });

    // ---- START GAME -----------------------------------------
    socket.on('startGame', () => {
      const result = gameLogic.startGame();
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
      broadcastItemByRole();
    });

    // ---- PLACE BID ------------------------------------------
    socket.on('placeBid', ({ amount }) => {
      const result = gameLogic.placeBid(socket.id, amount);
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }

      // Indice directionnel uniquement pour ce joueur
      socket.emit('bidHint', result.hint);

      // Notifie le GM qu'un joueur a soumis un essai
      const gmSocketId = gameLogic.getGMSocketId();
      if (gmSocketId) {
        const gmSock = enchereIo.sockets.get(gmSocketId);
        if (gmSock) gmSock.emit('bidPlaced', { pseudo: result.player.pseudo });
      }

      // Mise à jour de l'état (triesUsed, hasBid)
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
    });

    // ---- ADJUDICATE -----------------------------------------
    socket.on('adjudicate', () => {
      const result = gameLogic.adjudicate();
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }
      enchereIo.emit('roundResult', { result: result.result });
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
    });

    // ---- NEXT ITEM ------------------------------------------
    socket.on('nextItem', () => {
      const result = gameLogic.nextItem();
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }
      if (result.gameOver) {
        enchereIo.emit('gameOver', { finalScores: result.finalScores });
        enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
      } else {
        enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
        broadcastItemByRole();
      }
    });

    // ---- RESET GAME -----------------------------------------
    socket.on('resetGame', () => {
      gameLogic.resetGame();
      enchereIo.emit('gameReset');
    });

    // ---- DISCONNECT -----------------------------------------
    socket.on('disconnect', () => {
      gameLogic.removeBySocketId(socket.id);
      // Si la partie n'est pas en cours, on diffuse l'état du lobby mis à jour
      const state = gameLogic.getPublicState();
      if (state.phase === 'lobby') {
        enchereIo.emit('stateUpdate', { state });
      }
    });
  });
};
