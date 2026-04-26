/**
 * app.js — v2
 * Nouveautés :
 *   - 3 essais par manche avec flèche directionnelle après chaque essai
 *   - Manche d'entraînement (bannière + points non comptés)
 *   - Tableau bids enrichi (colonne essais utilisés)
 *   - Dots tricolores dans le tableau MJ (0=rouge, partiel=orange, done=vert)
 */

(function () {

  // ============================================================
  // Helpers généraux
  // ============================================================

  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  const eur = (n) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(n || 0);

  const escapeHtml = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function switchView(name) {
    ['view-lobby', 'view-player', 'view-gm'].forEach(id => hide($(id)));
    show($('view-' + name));
  }

  function renderStandings(tbody, rows) {
    tbody.innerHTML = '';
    const sorted = (rows || []).slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    for (const r of sorted) {
      const tr = document.createElement('tr');
      if (r.pseudo === app.pseudo) tr.classList.add('me');
      tr.innerHTML =
        `<td>${escapeHtml(r.pseudo)}</td>` +
        `<td class="num points">${r.points || 0}</td>`;
      tbody.appendChild(tr);
    }
  }

  /**
   * Tableau des estimations — colonnes : Joueur | Estimation | Essais | Écart | Bonus | Pts
   */
  function renderBidsBreakdown(tbody, bids, trueValue, maxTries) {
    tbody.innerHTML = '';
    const rows = (bids || []).slice().sort((a, b) => {
      if (a.amount == null && b.amount == null) return 0;
      if (a.amount == null) return 1;
      if (b.amount == null) return -1;
      return (a.distance || 0) - (b.distance || 0);
    });
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.pseudo === app.pseudo) tr.classList.add('me');
      const guess = r.amount == null ? '—' : eur(r.amount);
      const delta =
        r.amount == null ? '—' :
        r.amount === trueValue ? '<span class="badge-pts exact">🎯 0</span>' :
        (r.amount > trueValue ? '+' : '−') + eur(Math.abs(r.amount - trueValue));
      const badges = [];
      if (r.exact)     badges.push('<span class="badge-pts exact">🎯 exact</span>');
      if (r.withinPct) badges.push('<span class="badge-pts within">±5 %</span>');
      if (r.closest)   badges.push('<span class="badge-pts closest">📏 proche</span>');

      // Historique des essais (petites pastilles)
      const triesHTML = buildTriesHTML(r.allBids || [], r.amount, maxTries || 3);

      tr.innerHTML =
        `<td>${escapeHtml(r.pseudo)}</td>` +
        `<td class="num">${guess}</td>` +
        `<td class="bids-tries">${triesHTML}</td>` +
        `<td class="num">${delta}</td>` +
        `<td class="badges">${badges.join(' ') || '—'}</td>` +
        `<td class="num points">${r.points || 0}</td>`;
      tbody.appendChild(tr);
    }
  }

  /** Construit des mini-pastilles montrant les essais successifs */
  function buildTriesHTML(allBids, lastBid, maxTries) {
    if (!allBids || allBids.length === 0) return '<span class="tries-none">—</span>';
    let html = '';
    for (let i = 0; i < allBids.length; i++) {
      const v = allBids[i];
      const isFinal = (i === allBids.length - 1);
      html += `<span class="try-chip ${isFinal ? 'try-final' : ''}" title="Essai ${i+1}: ${eur(v)}">${i+1}</span>`;
    }
    return html;
  }

  function formatRemaining(n) {
    if (n == null) return '';
    if (n === 0) return 'Dernier objet — fin de partie imminente !';
    if (n === 1) return 'Encore 1 objet.';
    return `Encore ${n} objets.`;
  }

  // État local côté client
  const app = {
    socket: null,
    role:   null,
    pseudo: null,
    maxTries: 3,
    currentTry: 1,
  };

  // ============================================================
  // VUE LOBBY
  // ============================================================

  const $lobbyForm    = $('joinForm');
  const $lobbyPseudo  = $('pseudo');
  const $lobbyMessage = $('lobbyMessage');

  function doJoin(pseudo, role) {
    pseudo = (pseudo || '').trim();
    if (!pseudo) {
      $lobbyMessage.textContent = 'Merci de renseigner un pseudo.';
      $lobbyMessage.classList.add('error');
      return;
    }
    if (role !== 'gm' && role !== 'player') role = 'player';
    app.pseudo = pseudo;
    app.role   = role;

    if (!app.socket) { app.socket = io(); bindSocket(app.socket); }
    const emitJoin = () => app.socket.emit('join', { pseudo, role });
    if (app.socket.connected) emitJoin();
    else app.socket.once('connect', emitJoin);
  }

  $lobbyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    $lobbyMessage.classList.remove('error');
    $lobbyMessage.textContent = '';
    const role = e.submitter ? e.submitter.value : 'player';
    doJoin($lobbyPseudo.value, role);
  });

  const _params = new URLSearchParams(window.location.search);
  app.autoJoin = _params.get('role') && _params.get('pseudo');
  if (app.autoJoin) doJoin(_params.get('pseudo'), _params.get('role'));

  function backToLobby(errorMsg) {
    app.role = null;
    switchView('lobby');
    if (errorMsg) {
      $lobbyMessage.textContent = errorMsg;
      $lobbyMessage.classList.add('error');
    }
  }

  // ============================================================
  // Socket.io : wiring global
  // ============================================================

  function bindSocket(socket) {

    socket.on('joinError', ({ message }) => backToLobby(message || 'Impossible de rejoindre.'));

    socket.on('joinSuccess', ({ role, you, state, item }) => {
      if (state && state.maxTries) app.maxTries = state.maxTries;
      if (role === 'gm') enterGMView(you, state, item);
      else               enterPlayerView(you, state, item);
    });

    socket.on('stateUpdate', ({ state }) => {
      if (state && state.maxTries) app.maxTries = state.maxTries;
      if (app.role === 'player') playerRenderState(state);
      if (app.role === 'gm')    gmRenderState(state);
    });

    socket.on('itemUpdate', ({ item }) => {
      if (app.role === 'player') playerRenderItem(item);
      if (app.role === 'gm')    gmRenderItem(item);
    });

    // Indice directionnel après un essai (envoyé uniquement à CE joueur)
    socket.on('bidHint', (hint) => {
      if (app.role === 'player') showBidHint(hint);
    });

    socket.on('waitingForOthers', () => {
      // Conservé pour compatibilité mais non utilisé dans v2
    });

    socket.on('bidPlaced', ({ pseudo }) => {
      if (app.role === 'gm') highlightPlayerRow(pseudo);
    });

    socket.on('roundResult', ({ result }) => {
      if (app.role === 'player') showPlayerResultModal(result);
      if (app.role === 'gm')    gmRevealBids(result);
    });

    socket.on('gameOver', ({ finalScores }) => {
      if (app.role === 'player') showPlayerGameOver(finalScores);
      if (app.role === 'gm')    showGMGameOver(finalScores);
    });

    socket.on('errorMessage', ({ message }) => {
      if (app.role === 'player') { $bidError.textContent = message || 'Erreur.'; }
      else if (app.role === 'gm') alert(message || 'Erreur.');
    });

    socket.on('gameReset', () => {
      if (app.autoJoin) { setTimeout(() => window.location.reload(), 250); return; }
      app.role = null;
      resetAllUI();
      backToLobby('La partie a été réinitialisée.');
    });

    socket.on('disconnect', () => console.warn('Déconnecté du serveur.'));
  }

  // ============================================================
  // VUE JOUEUR
  // ============================================================

  const $playerPseudo    = $('playerPseudo');
  const $playerPoints    = $('playerPoints');
  const $waitingRoom     = $('waitingRoom');
  const $waitingList     = $('waitingList');
  const $auctionZone     = $('auctionZone');
  const $playerGameOver  = $('playerGameOver');
  const $playerFinalScores = $('playerFinalScores');
  const $playerItemCounter = $('playerItemCounter');
  const $playerItemImage   = $('playerItemImage');
  const $playerItemName    = $('playerItemName');
  const $bidForm           = $('bidForm');
  const $bidAmount         = $('bidAmount');
  const $bidError          = $('bidError');
  const $waitingOverlay    = $('waitingOverlay');
  const $resultModal       = $('resultModal');
  const $resultTrueValue   = $('resultTrueValue');
  const $resultBidsBody    = $('resultBidsBody');
  const $resultBonusBanner = $('resultBonusBanner');
  const $closeResult       = $('closeResult');
  const $playerStandingsBody = document.querySelector('#playerStandings tbody');
  const $playerRemaining   = $('playerRemaining');
  const $bonusBanner       = $('bonusBanner');
  const $trainingBanner    = $('trainingBanner');
  const $bidHintArea       = $('bidHintArea');
  const $tryDots           = document.querySelectorAll('.try-dot');
  const $tryCounter        = $('tryCounter');
  const $trainingResultBanner = $('trainingResultBanner');

  function enterPlayerView(you, state, item) {
    switchView('player');
    $playerPseudo.textContent = you.pseudo;
    $playerPoints.textContent = String(you.points || 0);
    hide($playerGameOver);
    hide($resultModal);
    resetBidForm();
    if (item) playerRenderItem(item);
    playerRenderState(state);
  }

  function playerRenderState(state) {
    if (state.phase === 'lobby') {
      show($waitingRoom);
      hide($auctionZone);
      hide($playerGameOver);
      $waitingList.innerHTML = '';
      state.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `• ${p.pseudo}`;
        $waitingList.appendChild(li);
      });
      if (state.gm) {
        const li = document.createElement('li');
        li.textContent = `🎩 MJ : ${state.gm.pseudo}`;
        $waitingList.appendChild(li);
      }
      return;
    }

    if (state.phase === 'bidding' || state.phase === 'results') {
      hide($waitingRoom);
      hide($playerGameOver);
      show($auctionZone);
    }

    const me = state.players.find(p => p.pseudo === app.pseudo);
    if (me) $playerPoints.textContent = String(me.points || 0);

    if (state.totalItems) {
      $playerItemCounter.textContent =
        `Objet ${Math.min(state.currentItemIndex + 1, state.totalItems)} / ${state.totalItems}`;
    }

    // Bandeau manche bonus
    if ($bonusBanner) {
      const isBonus = !state.currentRoundIsTraining && state.phase === 'bidding' && state.nextRoundIsBonus === false
        ? false  // nextRoundIsBonus = prochain → on affiche si CETTE manche est bonus
        : false;
      // On utilise une autre logique : est-ce que cette manche est bonus ?
      // La manche courante est bonus si realRoundCount+1 % 10 === 0
      // Le serveur envoie nextRoundIsBonus pour la PROCHAINE manche
      // On affiche bonus si le serveur a envoyé l'info sur la manche précédente
      // Simplifié : bonus-banner piloté uniquement par itemUpdate/roundResult
    }

    // Bannière entraînement
    if ($trainingBanner) {
      if (state.currentRoundIsTraining && state.phase === 'bidding') show($trainingBanner);
      else hide($trainingBanner);
    }

    // Sync essai courant depuis l'état du joueur
    if (me && state.phase === 'bidding') {
      const nextTry = (me.triesUsed || 0) + 1;
      updateTryUI(me.triesUsed || 0);
      // Si le joueur a déjà utilisé tous ses essais → overlay
      if (me.hasBid) lockBidForm();
    }
  }

  function playerRenderItem(item) {
    if (!item) return;
    $playerItemImage.src = item.image;
    $playerItemImage.alt = item.name;
    $playerItemName.textContent = item.name;
    resetBidForm();
    hide($playerGameOver);
    hide($waitingRoom);
    show($auctionZone);
  }

  // ---------- Gestion des essais ----------

  function updateTryUI(triesUsed) {
    app.currentTry = triesUsed + 1;
    const max = app.maxTries;
    if ($tryCounter) $tryCounter.textContent = `${Math.min(triesUsed + 1, max)} / ${max}`;
    $tryDots.forEach((dot, i) => {
      dot.className = 'try-dot';
      if (i < triesUsed)     dot.classList.add('try-dot-done');
      else if (i === triesUsed && triesUsed < max) dot.classList.add('try-dot-active');
    });
  }

  /**
   * Affiche l'indice directionnel après un essai.
   * direction: 'higher' | 'lower' | 'exact'
   * big: boolean (>50% → double flèche)
   */
  function showBidHint(hint) {
    const { direction, big, tryNumber, isFinal, amount } = hint;
    updateTryUI(tryNumber);

    if ($bidHintArea) {
      $bidHintArea.className = 'bid-hint-area';
      let html = '';

      if (direction === 'exact') {
        html = `<span class="hint-icon hint-exact">🎯</span><span class="hint-text hint-exact-text">Vous êtes pile sur la valeur !</span>`;
        $bidHintArea.classList.add('hint-area-exact');
      } else if (direction === 'higher') {
        const arrow = big ? '⬆⬆' : '⬆';
        const msg   = big ? 'Beaucoup plus élevé !' : 'Plus élevé';
        html = `<span class="hint-icon hint-higher">${arrow}</span><span class="hint-text hint-higher-text">${msg}</span>`;
        $bidHintArea.classList.add('hint-area-higher');
      } else {
        const arrow = big ? '⬇⬇' : '⬇';
        const msg   = big ? 'Beaucoup plus bas !' : 'Plus bas';
        html = `<span class="hint-icon hint-lower">${arrow}</span><span class="hint-text hint-lower-text">${msg}</span>`;
        $bidHintArea.classList.add('hint-area-lower');
      }

      if (isFinal) {
        html += `<span class="hint-final-label"> — ESTIMATION FINALE</span>`;
      }

      $bidHintArea.innerHTML = html;
      show($bidHintArea);
    }

    if (isFinal) {
      // Dernier essai : bloquer le formulaire + afficher l'overlay
      lockBidForm();
    } else {
      // Essais restants : effacer le champ, focus
      $bidAmount.value = '';
      $bidAmount.focus();
    }
  }

  function resetBidForm() {
    if ($bidForm) $bidForm.reset();
    if ($bidError) $bidError.textContent = '';
    hide($waitingOverlay);
    if ($bidAmount) { $bidAmount.disabled = false; }
    if ($bidForm) {
      const btn = $bidForm.querySelector('button');
      if (btn) btn.disabled = false;
    }
    hide($bidHintArea);
    if ($bidHintArea) $bidHintArea.className = 'bid-hint-area hidden';
    app.currentTry = 1;
    updateTryUI(0);
  }

  function lockBidForm() {
    if ($bidAmount) $bidAmount.disabled = true;
    if ($bidForm) {
      const btn = $bidForm.querySelector('button');
      if (btn) btn.disabled = true;
    }
    show($waitingOverlay);
  }

  $bidForm && $bidForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (app.role !== 'player') return;
    if ($bidError) $bidError.textContent = '';
    const val = Number($bidAmount.value);
    if (!Number.isFinite(val) || val < 0) {
      if ($bidError) $bidError.textContent = 'Saisissez un nombre valide.';
      return;
    }
    // Envoi de l'essai courant
    app.socket.emit('placeBid', { amount: val });
  });

  $closeResult && $closeResult.addEventListener('click', () => hide($resultModal));

  function showPlayerResultModal(result) {
    // Entraînement ?
    if ($trainingResultBanner) {
      if (result.isTraining) show($trainingResultBanner);
      else hide($trainingResultBanner);
    }

    if (result.bonusRound) show($resultBonusBanner);
    else hide($resultBonusBanner);

    $resultTrueValue.innerHTML =
      `Valeur réelle de <em>${escapeHtml(result.item.name)}</em> : ` +
      `<strong>${eur(result.item.trueValue)}</strong>`;

    renderBidsBreakdown($resultBidsBody, result.bids, result.item.trueValue, result.maxTries);
    renderStandings($playerStandingsBody, result.standings);

    if ($playerRemaining) $playerRemaining.textContent = formatRemaining(result.remainingItems);
    show($resultModal);
  }

  function showPlayerGameOver(finalScores) {
    hide($auctionZone);
    hide($waitingRoom);
    hide($resultModal);
    show($playerGameOver);
    $playerFinalScores.innerHTML = '';
    finalScores.forEach((s, i) => {
      const li = document.createElement('li');
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      li.innerHTML =
        `<strong>${medal} ${escapeHtml(s.pseudo)}</strong>` +
        ` — <span class="score">${s.points || 0} pts</span>`;
      $playerFinalScores.appendChild(li);
    });
  }

  // ============================================================
  // VUE MJ
  // ============================================================

  const $gmPseudo    = $('gmPseudo');
  const $gmLobby     = $('gmLobby');
  const $gmMain      = $('gmMain');
  const $gmGameOver  = $('gmGameOver');
  const $lobbyCount  = $('lobbyCount');
  const $lobbyList   = $('lobbyList');
  const $startBtn    = $('startBtn');
  const $gmItemCounter  = $('gmItemCounter');
  const $gmItemImage    = $('gmItemImage');
  const $gmItemName     = $('gmItemName');
  const $gmItemTrueValue = $('gmItemTrueValue');
  const $gmTrainingBadge = $('gmTrainingBadge');
  const $playerBoard    = $('playerBoard');
  const $adjudicateBtn  = $('adjudicateBtn');
  const $nextItemBtn    = $('nextItemBtn');
  const $revealedBids   = $('revealedBids');
  const $gmBidsBody     = $('gmBidsBody');
  const $gmBonusBanner  = $('gmBonusBanner');
  const $gmTrainingReveal = $('gmTrainingReveal');
  const $gmStandingsBody = document.querySelector('#gmStandings tbody');
  const $gmRemaining    = $('gmRemaining');
  const $gmFinalScores  = $('gmFinalScores');
  const $resetBtn       = $('resetBtn');
  const $restartBtn     = $('restartBtn');

  function enterGMView(you, state, item) {
    switchView('gm');
    $gmPseudo.textContent = you.pseudo;
    hide($gmGameOver);
    hide($revealedBids);
    if (item) gmRenderItem(item);
    gmRenderState(state);
  }

  function gmRenderState(state) {
    if (state.phase === 'lobby') {
      show($gmLobby);
      hide($gmMain);
      hide($gmGameOver);
      const nb = state.players.length;
      $lobbyCount.textContent = `${nb} / 3 joueurs connectés`;
      $lobbyList.innerHTML = '';
      state.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `• ${p.pseudo}`;
        $lobbyList.appendChild(li);
      });
      $startBtn.disabled = !(nb === 3 && state.gm);
      return;
    }
    if (state.phase === 'gameOver') return;

    hide($gmLobby);
    hide($gmGameOver);
    show($gmMain);

    $gmItemCounter.textContent =
      `Objet ${Math.min(state.currentItemIndex + 1, state.totalItems)} / ${state.totalItems}`;

    // Badge entraînement
    if ($gmTrainingBadge) {
      if (state.currentRoundIsTraining) show($gmTrainingBadge);
      else hide($gmTrainingBadge);
    }

    renderPlayerBoard(state.players, state.maxTries || 3);

    if (state.phase === 'bidding') {
      // Le bouton Adjuger s'active quand TOUS les joueurs ont terminé leurs 3 essais
      const allDone = state.players.length > 0 && state.players.every(p => p.hasBid);
      $adjudicateBtn.disabled = !allDone;
    }
  }

  function gmRenderItem(item) {
    if (!item) return;
    $gmItemImage.src = item.image;
    $gmItemImage.alt = item.name;
    $gmItemName.textContent = item.name;
    $gmItemTrueValue.textContent = eur(item.trueValue);
    hide($revealedBids);
    hide($gmBonusBanner);
    hide($nextItemBtn);
    show($adjudicateBtn);
    $adjudicateBtn.disabled = true;
  }

  function renderPlayerBoard(players, maxTries) {
    $playerBoard.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-row';
      li.dataset.pseudo = p.pseudo;

      let dotClass   = 'dot-red';
      let statusText = '…';

      if (p.hasBid) {
        dotClass   = 'dot-green';
        statusText = `✔ ${maxTries}/${maxTries} essais`;
      } else if (p.triesUsed > 0) {
        dotClass   = 'dot-orange';
        statusText = `${p.triesUsed}/${maxTries} essais`;
      }

      li.innerHTML = `
        <span class="dot ${dotClass}"></span>
        <span class="row-name">${escapeHtml(p.pseudo)}</span>
        <span class="row-points">${p.points || 0} pts</span>
        <span class="row-status">${statusText}</span>
      `;
      $playerBoard.appendChild(li);
    });
  }

  function highlightPlayerRow(pseudo) {
    const row = $playerBoard.querySelector(`[data-pseudo="${CSS.escape(pseudo)}"]`);
    if (!row) return;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 600);
  }

  function gmRevealBids(result) {
    if (result.bonusRound) show($gmBonusBanner); else hide($gmBonusBanner);
    if (result.isTraining && $gmTrainingReveal) show($gmTrainingReveal);
    else if ($gmTrainingReveal) hide($gmTrainingReveal);

    renderBidsBreakdown($gmBidsBody, result.bids, result.item.trueValue, result.maxTries);
    renderStandings($gmStandingsBody, result.standings);
    if ($gmRemaining) $gmRemaining.textContent = formatRemaining(result.remainingItems);

    show($revealedBids);
    hide($adjudicateBtn);
    show($nextItemBtn);
  }

  function showGMGameOver(finalScores) {
    hide($gmMain);
    hide($gmLobby);
    show($gmGameOver);
    $gmFinalScores.innerHTML = '';
    finalScores.forEach((s, i) => {
      const li = document.createElement('li');
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      li.innerHTML =
        `<strong>${medal} ${escapeHtml(s.pseudo)}</strong>` +
        ` — <span class="score">${s.points || 0} pts</span>`;
      $gmFinalScores.appendChild(li);
    });
  }

  $startBtn    && $startBtn.addEventListener('click', () => app.socket.emit('startGame'));
  $adjudicateBtn && $adjudicateBtn.addEventListener('click', () => app.socket.emit('adjudicate'));
  $nextItemBtn && $nextItemBtn.addEventListener('click', () => app.socket.emit('nextItem'));
  $resetBtn    && $resetBtn.addEventListener('click', () => {
    if (confirm('Réinitialiser la partie ? Tous les joueurs seront renvoyés au lobby.'))
      app.socket.emit('resetGame');
  });
  $restartBtn  && $restartBtn.addEventListener('click', () => app.socket.emit('resetGame'));

  // ============================================================
  // Reset complet de l'UI
  // ============================================================

  function resetAllUI() {
    hide($auctionZone);
    hide($playerGameOver);
    hide($resultModal);
    show($waitingRoom);
    $waitingList.innerHTML = '';
    resetBidForm();
    $playerPoints.textContent = '0';
    hide($bonusBanner);
    hide($trainingBanner);

    show($gmLobby);
    hide($gmMain);
    hide($gmGameOver);
    hide($revealedBids);
    if ($gmBonusBanner) hide($gmBonusBanner);
    if ($gmTrainingReveal) hide($gmTrainingReveal);
    $playerBoard.innerHTML = '';
    $lobbyList.innerHTML = '';
  }

})();
