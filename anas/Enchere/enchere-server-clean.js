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
 *
 * Corrections v2 :
 *   - broadcastItemByRole : emit global + override ciblé pour le MJ
 *     (évite l'itération fragile sur enchereIo.sockets Map)
 *   - Vérification de rôle MJ sur les actions d'administration
 * ---------------------------------------------------------
 */

const gameLogic = require('./backend/gameLogic.js');

module.exports = function (io) {
  const enchereIo = io.of('/enchere');

  // ----------------------------------------------------------
  // Helper : envoie l'item en tenant compte du rôle.
  // Stratégie : broadcast "version joueur" à tous, puis envoie
  // immédiatement "version MJ" (avec trueValue) au MJ seulement.
  // ----------------------------------------------------------
  function broadcastItemByRole() {
    const gmSocketId = gameLogic.getGMSocketId();

    // 1. Tout le monde reçoit la version sans vraie valeur
    enchereIo.emit('itemUpdate', { item: gameLogic.getItemForPlayers() });

    // 2. Le MJ reçoit sa version complète juste après (écrase le précédent)
    if (gmSocketId) {
      const gmSock = enchereIo.sockets.get(gmSocketId);
      if (gmSock) gmSock.emit('itemUpdate', { item: gameLogic.getItemForGM() });
    }
  }

  // ----------------------------------------------------------
  // Helper : vérifie que le socket appelant est bien le MJ
  // ----------------------------------------------------------
  function isGM(socket) {
    return socket.id === gameLogic.getGMSocketId();
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

    // ---- START GAME (MJ uniquement) -------------------------
    socket.on('startGame', () => {
      if (!isGM(socket)) {
        socket.emit('errorMessage', { message: 'Seul le MJ peut lancer la partie.' });
        return;
      }
      const result = gameLogic.startGame();
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
      broadcastItemByRole();
    });

    // ---- PLACE BID (joueurs uniquement) ---------------------
    socket.on('placeBid', ({ amount }) => {
      const result = gameLogic.placeBid(socket.id, amount);
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }

      // Indice directionnel uniquement pour ce joueur
      socket.emit('bidHint', result.hint);

      // Notifie le MJ qu'un joueur a soumis un essai
      const gmSocketId = gameLogic.getGMSocketId();
      if (gmSocketId) {
        const gmSock = enchereIo.sockets.get(gmSocketId);
        if (gmSock) gmSock.emit('bidPlaced', { pseudo: result.player.pseudo });
      }

      // Mise à jour de l'état (triesUsed, hasBid) pour tous
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
    });

    // ---- ADJUDICATE (MJ uniquement) -------------------------
    socket.on('adjudicate', () => {
      if (!isGM(socket)) {
        socket.emit('errorMessage', { message: 'Seul le MJ peut adjuger.' });
        return;
      }
      const result = gameLogic.adjudicate();
      if (!result.ok) {
        socket.emit('errorMessage', { message: result.error });
        return;
      }
      enchereIo.emit('roundResult', { result: result.result });
      enchereIo.emit('stateUpdate', { state: gameLogic.getPublicState() });
    });

    // ---- NEXT ITEM (MJ uniquement) --------------------------
    socket.on('nextItem', () => {
      if (!isGM(socket)) {
        socket.emit('errorMessage', { message: 'Seul le MJ peut passer à l\'objet suivant.' });
        return;
      }
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

    // ---- RESET GAME (MJ uniquement) -------------------------
    socket.on('resetGame', () => {
      if (!isGM(socket)) {
        socket.emit('errorMessage', { message: 'Seul le MJ peut réinitialiser la partie.' });
        return;
      }
      gameLogic.resetGame();
      enchereIo.emit('gameReset');
    });

    // ---- DISCONNECT -----------------------------------------
    socket.on('disconnect', () => {
      gameLogic.removeBySocketId(socket.id);
      // Diffuse l'état mis à jour si on est encore en phase lobby
      const state = gameLogic.getPublicState();
      if (state.phase === 'lobby') {
      