const socket = io('/mamine');
let myRole = ''; 
let currentAuthors = [];
let myUser = null; 
let currentPhase = 'role'; 
let myLieText = ""; 

const gifList = ['silver.gif', 'pan.gif', 'vi.gif', 'fou.gif', 'jinx.gif', 'reb.gif', 'shoot.gif', 'mad.gif', 'imad.gif'];
function getRandomGif() { return `/mamine/asset/${gifList[Math.floor(Math.random() * gifList.length)]}`; }

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showWaitScreen(title, subtitle, showLeaderboardBtn = false) {
    document.getElementById('wait-title').innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ` + title;
    document.getElementById('wait-subtitle').innerText = subtitle;
    document.getElementById('wait-gif').src = getRandomGif();
    document.getElementById('wait-gif').style.display = 'inline-block';
    document.getElementById('victory-podium-container').style.display = 'none';
    document.getElementById('stats-dashboard-container').style.display = 'none'; // On cache les stats
    document.getElementById('btn-to-leaderboards').style.display = showLeaderboardBtn ? 'block' : 'none';
    showScreen('screen-wait');
}

async function initGame() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        if (data.loggedIn) {
            myUser = data.user;
            document.getElementById('display-username').innerText = myUser.username;
        } else window.location.href = '/'; 
    } catch (err) { window.location.href = '/'; }
}
initGame();

// --- SYSTÈME ANTI-DÉCONNEXION (PAUSE) ---
socket.on('game_paused', (data) => {
    document.getElementById('pause-overlay').style.display = 'flex';
    document.getElementById('pause-missing-name').innerText = data.missingPlayer;
    if (myRole === 'mj') document.getElementById('mj-pause-controls').style.display = 'block';
});

socket.on('game_resumed', () => { document.getElementById('pause-overlay').style.display = 'none'; });

socket.on('sync_state', (state) => {
    document.getElementById('pause-overlay').style.display = 'none';
    currentPhase = 'ingame';
    if (state.phase === 'prep' && myRole === 'mj') showScreen('screen-mj-prep');
    else if (state.phase === 'writing') showScreen('screen-writing');
    else if (state.phase === 'voting') showScreen('screen-voting');
    else if (state.phase === 'results') showScreen('screen-results');
    else showWaitScreen("RECONNEXION", "Synchronisation avec le serveur en cours...");
});

socket.on('game_ended_force', () => {
    document.getElementById('pause-overlay').style.display = 'none';
    alert("La partie a été annulée par le Maître du Jeu suite à une déconnexion.");
    window.location.reload();
});

function forceEndGame() { if(confirm("Cela va annuler la partie pour tout le monde. Êtes-vous sûr ?")) socket.emit('force_kill_game'); }
// ----------------------------------------

function joinAsPlayer() {
    myRole = 'player'; currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    socket.emit('join_as_player', { username: myUser.username, profile_pic: myUser.profile_pic }); 
    document.getElementById('lobby-wait-gif').src = getRandomGif();
    document.getElementById('lobby-wait-gif').style.display = 'inline-block';
    
    document.getElementById('player-controls').style.display = 'block';
    document.getElementById('mj-controls').style.display = 'none';
    showScreen('screen-lobby');
}

function joinAsMJ() {
    myRole = 'mj'; currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    socket.emit('join_as_mj', { username: myUser.username });
    document.getElementById('mj-controls').style.display = 'block';
    document.getElementById('player-controls').style.display = 'none';
    document.getElementById('wait-msg-container').style.display = 'none';
    showScreen('screen-lobby');
}

function toggleReady() {
    socket.emit('toggle_ready');
    document.getElementById('btn-ready').classList.toggle('btn-secondary');
    document.getElementById('btn-ready').classList.toggle('btn-primary');
}

function leaveRole() { history.back(); }

window.addEventListener('popstate', (event) => {
    if (currentPhase === 'lobby' && myRole !== '') {
        socket.emit('leave_role'); myRole = ''; currentPhase = 'role'; showScreen('screen-role');
    } else if (currentPhase === 'ingame') {
        history.pushState({ screen: 'ingame' }, '', '#ingame'); 
        alert("Action impossible : La partie est en cours !");
    }
});

socket.on('update_lobby', (data) => {
    const list = document.getElementById('player-list');
    list.innerHTML = data.players.map(p => `
        <li>
            <img src="${p.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?'}" class="avatar" onerror="this.onerror=null; this.src='https://via.placeholder.com/60/0ac8b9/000000?text=?';"> 
            <span style="${!p.isConnected ? 'color:red; text-decoration:line-through;' : ''}">${p.username}</span> &nbsp; // &nbsp; <span style="color:#0ac8b9;">Score : ${p.score}</span>
            ${p.isReady ? '<span style="color:#4caf50; margin-left:auto; font-weight:bold;"><i class="fa-solid fa-check"></i> Prêt</span>' : '<span style="color:#f44336; margin-left:auto;"><i class="fa-solid fa-hourglass"></i> Attente</span>'}
        </li>
    `).join('');

    if (myRole === 'mj') {
        const allReady = data.players.length > 0 && data.players.every(p => p.isReady);
        document.getElementById('btn-mj-start-wizard').disabled = !allReady;

        const grid = document.getElementById('mj-score-grid');
        grid.innerHTML = '';
        data.players.forEach(p => {
            grid.innerHTML += `<div><label>${p.username}</label><input type="number" id="edit-score-${p.username}" value="${p.score}"></div>`;
        });
    }
});

function mjUpdateScores() {
    const newScores = {};
    document.querySelectorAll('#mj-score-grid input').forEach(input => { newScores[input.id.replace('edit-score-', '')] = parseInt(input.value) || 0; });
    socket.emit('mj_force_scores', newScores);
}

function mjStartWizard() {
    const rounds = parseInt(document.getElementById('wizard-rounds').value) || 5;
    if (rounds < 1) return alert("Veuillez choisir un nombre de manches valide.");
    socket.emit('mj_start_wizard', { rounds: rounds });
}

socket.on('phase_mj_preparing', () => {
    currentPhase = 'ingame'; history.pushState({ screen: 'ingame' }, '', '#ingame');
    if (myRole === 'mj') showScreen('screen-mj-prep');
    else showWaitScreen("CONNEXION AU SERVEUR", "Le Maître du Jeu prépare la base de données...");
});

function mjSubmitQA() {
    const q = document.getElementById('mj-prep-question').value;
    const a = document.getElementById('mj-prep-true').value;
    if (q && a) socket.emit('mj_submit_q_a', { question: q, trueAnswer: a });
}

socket.on('phase_writing_all', (data) => {
    document.getElementById('display-question').innerHTML = `${data.question} <br><span style="font-size:14px; color:#94a3b8;">(Manche ${data.currentRoundNumber}/${data.totalRounds})</span>`;
    document.getElementById('player-lie').value = ''; 
    showScreen('screen-writing');
});

function submitLie() {
    const lie = document.getElementById('player-lie').value;
    if (!lie) return;
    myLieText = lie; 
    
    if (myRole === 'mj') socket.emit('submit_mj_lie', lie);
    else socket.emit('submit_lie', { username: myUser.username, lie: lie });
    
    showWaitScreen("ARCHIVE TRANSFÉRÉE", "Analyse en attente de la synchronisation.");
}

socket.on('phase_voting', (data) => {
    document.getElementById('vote-question').innerText = data.question;
    
    if (myRole === 'mj') {
        document.getElementById('player-voting-area').style.display = 'none';
        const mjDisplay = document.getElementById('mj-answers-display');
        mjDisplay.innerHTML = data.answers.map(ans => `<div class="answer-card mj-view"><i class="fa-solid fa-file-code"></i> « ${ans} »</div>`).join('');
        document.getElementById('mj-voting-area').style.display = 'block';
        showScreen('screen-voting');
        return;
    }
    
    currentAuthors = data.authors;
    document.getElementById('mj-voting-area').style.display = 'none';
    document.getElementById('player-voting-area').style.display = 'block';
    
    const container = document.getElementById('answers-container');
    container.innerHTML = '';

    data.answers.forEach((ans) => {
        if (ans === myLieText) return; 

        let authorsOptions = `<option value="">Anomalie non-identifiée...</option>`;
        authorsOptions += currentAuthors.map(a => `<option value="${a.id}">Auteur probable : ${a.name}</option>`).join('');
        container.innerHTML += `
            <div class="answer-card">
                <label class="truth-label"><input type="radio" name="truth" value="${ans}"> MARQUER COMME VÉRITÉ</label>
                <p>« ${ans} »</p>
                <label class="instruction"><i class="fa-solid fa-user-secret"></i> Si l'archive est corrompue, identifiez le pirate :</label>
                <select class="author-guess" data-answer="${ans}">${authorsOptions}</select>
            </div>
        `;
    });
    
    showScreen('screen-voting');
});

function submitVotes() {
    const selectedTruth = document.querySelector('input[name="truth"]:checked');
    if (!selectedTruth) return alert("Erreur Système : Vérité non sélectionnée !");

    const guesses = {};
    document.querySelectorAll('.author-guess').forEach(select => {
        if (select.dataset.answer !== selectedTruth.value && select.value !== "") guesses[select.dataset.answer] = select.value;
    });

    socket.emit('submit_votes', { username: myUser.username, voteData: { selectedTruth: selectedTruth.value, guesses: guesses } });
    showWaitScreen("TRAITEMENT DES DONNÉES", "Calcul des affinités en cours...");
}

socket.on('phase_results', async (data) => {
    document.getElementById('res-true-answer').innerText = data.trueAnswer;
    document.getElementById('recap-mj-lie').innerHTML = `Mensonge du MJ : <em>« ${data.mjLie} »</em>`;
    
    const recapList = document.getElementById('round-recap-list');
    recapList.innerHTML = data.roundDetails.map(detail => {
        let pointsHTML = '';
        if (detail.points.truth > 0) pointsHTML += `<span class="point-pill truth-pill">+${detail.points.truth} Vérité</span>`;
        if (detail.points.trap > 0) pointsHTML += `<span class="point-pill trap-pill">+${detail.points.trap} Piège (${detail.victims} victime(s))</span>`;
        if (detail.points.guess > 0) pointsHTML += `<span class="point-pill guess-pill">+${detail.points.guess} Profilage</span>`;
        if (detail.points.bonus > 0) pointsHTML += `<span class="point-pill bonus-pill">+${detail.points.bonus} Sans-faute</span>`;
        if (detail.points.total === 0) pointsHTML += `<span class="point-pill fail-pill">0 pt (Piratage échoué)</span>`;

        return `
        <div class="recap-item">
            <div class="recap-header">
                <img src="${detail.profile_pic || 'https://via.placeholder.com/30/0ac8b9/000000?text=?'}" class="avatar-small">
                <strong>${detail.username}</strong> a gagné <strong>+${detail.points.total} pts</strong>
            </div>
            <div class="recap-body">
                <p>A voté pour : <em>« ${detail.votedFor} »</em></p>
                <p>Son mensonge : <em>« ${detail.myLie} »</em></p>
                <div class="recap-badges">${pointsHTML}</div>
            </div>
        </div>`;
    }).join('');

    const lb = document.getElementById('leaderboard');
    lb.innerHTML = data.leaderboard.map((p, i) => `
        <li>
            <span><i class="fa-solid fa-medal"></i> #${i+1} - <img src="${p.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?'}" class="avatar"> ${p.username}</span> 
            <span>${p.score} pts</span>
        </li>
    `).join('');

    if (myRole === 'mj') {
        document.getElementById('mj-next-btn').style.display = 'flex';
        document.getElementById('btn-next-round').style.display = data.isLastRound ? 'none' : 'block';
    } else {
        document.getElementById('mj-next-btn').style.display = 'none';
    }

    showScreen('screen-results');
});

function nextRound() { socket.emit('trigger_next_round'); }
function endGame() { if(confirm("Voulez-vous vraiment terminer la partie et couronner le vainqueur ?")) socket.emit('trigger_end_game'); }

socket.on('game_ended', async (data) => {
    currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby');
    let subtitle = data.winners.length > 0 ? "Victoire de : " + data.winners.join(', ') : "Le vainqueur a été déclaré !";
    
    document.getElementById('wait-title').innerHTML = `<i class="fa-solid fa-trophy"></i> PARTIE TERMINÉE`;
    document.getElementById('wait-subtitle').innerText = subtitle;
    const waitGif = document.getElementById('wait-gif');
    waitGif.src = `/mamine/asset/${data.winGif}`;
    waitGif.style.display = 'inline-block';

    // 1. Construction du Podium
    const podiumContainer = document.getElementById('victory-podium-container');
    let podiumHTML = '<ul id="leaderboard" style="margin-top: 20px;">';
    data.finalLeaderboard.forEach((p, i) => {
        let medal = i === 0 ? '<i class="fa-solid fa-crown" style="color: gold;"></i>' : `#${i+1}`;
        podiumHTML += `
            <li style="${i === 0 ? 'background: rgba(200, 155, 60, 0.2); border-color: #c89b3c; box-shadow: 0 0 20px rgba(200,155,60,0.3); transform: scale(1.05); z-index: 10;' : ''}">
                <span>${medal} &nbsp; <img src="${p.profile_pic}" class="avatar-small"> ${p.username}</span> 
                <span style="${i === 0 ? 'color: #c89b3c;' : 'color: #0ac8b9;'}">${p.score} pts</span>
            </li>`;
    });
    podiumHTML += '</ul>';
    podiumContainer.innerHTML = podiumHTML;
    podiumContainer.style.display = 'block';

    // 2. Construction du Dashboard des Statistiques
    let bestLiar = data.matchStats.players.reduce((prev, current) => (prev.victims > current.victims) ? prev : current);
    let bestDetective = data.matchStats.players.reduce((prev, current) => (prev.truths > current.truths) ? prev : current);
    let bestProfiler = data.matchStats.players.reduce((prev, current) => (prev.perfects > current.perfects) ? prev : current);

    const statsContainer = document.getElementById('stats-dashboard-container');
    statsContainer.innerHTML = `
        <h3 style="color:#0ac8b9; text-align:center; border-bottom: 1px solid rgba(10,200,185,0.3); padding-bottom:10px; margin-top:30px;"><i class="fa-solid fa-chart-simple"></i> PERFORMANCE GLOBALE</h3>
        <div class="stats-grid-dashboard">
            <div class="stat-card">
                <i class="fa-solid fa-mask"></i>
                <h4>Le Pire Menteur (MJ)</h4>
                <div class="stat-val">${data.matchStats.mj.victims}</div>
                <span class="stat-player">victimes de ${data.matchStats.mj.username}</span>
            </div>
            <div class="stat-card">
                <i class="fa-solid fa-virus"></i>
                <h4>Le Roi de l'Illusion</h4>
                <div class="stat-val">${bestLiar.victims}</div>
                <span class="stat-player">victimes de ${bestLiar.username}</span>
            </div>
            <div class="stat-card">
                <i class="fa-solid fa-magnifying-glass"></i>
                <h4>Le Détective</h4>
                <div class="stat-val">${bestDetective.truths}</div>
                <span class="stat-player">vérités trouvées par ${bestDetective.username}</span>
            </div>
            <div class="stat-card">
                <i class="fa-solid fa-brain"></i>
                <h4>Le Génie du Profilage</h4>
                <div class="stat-val">${bestProfiler.perfects}</div>
                <span class="stat-player">sans-fautes pour ${bestProfiler.username}</span>
            </div>
        </div>
    `;
    statsContainer.style.display = 'block';

    document.getElementById('btn-to-leaderboards').style.display = 'block';
    showScreen('screen-wait');

    // 3. Sauvegarde des Victoires & Statistiques en Base de Données
    if (myRole === 'player') {
        const myStats = data.matchStats.players.find(p => p.username === myUser.username);
        
        // Sauvegarder les stats
        fetch('/api/save-stats', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_name: 'Le Contrebandier',
                stats: [ { type: 'victims', value: myStats.victims }, { type: 'truths', value: myStats.truths }, { type: 'perfects', value: myStats.perfects } ]
            })
        });

        // Sauvegarder la victoire si gagnant
        if (data.winners.includes(myUser.username)) {
            fetch('/api/add-victory', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ game_name: 'Le Contrebandier', game_url: '/mamine/contrebandier.html' })
            });
        }
    } else if (myRole === 'mj') {
        fetch('/api/save-stats', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_name: 'Le Contrebandier', stats: [ { type: 'mj_victims', value: data.matchStats.mj.victims } ] })
        });
    }
});

socket.on('go_to_lobby', () => {
    currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby');
    if (myRole === 'mj') {
        document.getElementById('mj-prep-question').value = '';
        document.getElementById('mj-prep-true').value = '';
    } else {
        document.getElementById('lobby-wait-gif').src = getRandomGif();
        document.getElementById('btn-ready').classList.remove('btn-primary');
        document.getElementById('btn-ready').classList.add('btn-secondary');
    }
    showScreen('screen-lobby');
});