const socket = io('/mamine');
let myRole = ''; 
let currentAuthors = [];
let myUser = null; 
let currentPhase = 'role'; 

// Ces gifs sont UNIQUEMENT pour l'attente classique
const gifList = ['silver.gif', 'pan.gif', 'vi.gif', 'fou.gif', 'jinx.gif', 'reb.gif', 'shoot.gif', 'mad.gif', 'imad.gif'];

function getRandomGif() {
    return `/mamine/asset/${gifList[Math.floor(Math.random() * gifList.length)]}`;
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showWaitScreen(title, subtitle, showLeaderboardBtn = false) {
    document.getElementById('wait-title').innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ` + title;
    document.getElementById('wait-subtitle').innerText = subtitle;
    
    const waitGif = document.getElementById('wait-gif');
    waitGif.src = getRandomGif();
    waitGif.style.display = 'inline-block';
    
    // On cache le podium par défaut
    document.getElementById('victory-podium-container').style.display = 'none';
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
        } else {
            window.location.href = '/'; 
        }
    } catch (err) {
        console.error("Erreur d'authentification", err);
        window.location.href = '/';
    }
}
initGame();

function joinAsPlayer() {
    myRole = 'player';
    currentPhase = 'lobby';
    history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    
    socket.emit('join_as_player', { username: myUser.username, profile_pic: myUser.profile_pic }); 
    document.getElementById('lobby-wait-gif').src = getRandomGif();
    document.getElementById('lobby-wait-gif').style.display = 'inline-block';
    showScreen('screen-lobby');
}

function joinAsMJ() {
    myRole = 'mj';
    currentPhase = 'lobby';
    history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    
    socket.emit('join_as_mj');
    document.getElementById('mj-controls').style.display = 'block';
    document.getElementById('wait-msg-container').style.display = 'none';
    showScreen('screen-lobby');
}

function leaveRole() {
    history.back(); 
}

window.addEventListener('popstate', (event) => {
    if (currentPhase === 'lobby' && myRole !== '') {
        socket.emit('leave_role');
        myRole = '';
        currentPhase = 'role';
        showScreen('screen-role');
    } else if (currentPhase === 'ingame') {
        history.pushState({ screen: 'ingame' }, '', '#ingame'); 
        alert("Action impossible : La partie est en cours. Si vous souhaitez vraiment abandonner, vous devez rafraîchir (F5) ou fermer la page.");
    }
});

socket.on('update_lobby', (data) => {
    const list = document.getElementById('player-list');
    list.innerHTML = data.players.map(p => `
        <li>
            <img src="${p.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?'}" class="avatar" onerror="this.onerror=null; this.src='https://via.placeholder.com/60/0ac8b9/000000?text=?';"> 
            ${p.username} &nbsp; // &nbsp; <span style="color:#0ac8b9;">Score : ${p.score}</span>
        </li>
    `).join('');

    if (myRole === 'mj' && data.players) {
        const grid = document.getElementById('mj-score-grid');
        grid.innerHTML = '';
        data.players.forEach(p => {
            grid.innerHTML += `
                <div>
                    <label>${p.username}</label>
                    <input type="number" id="edit-score-${p.username}" value="${p.score}">
                </div>
            `;
        });
    }
});

function mjUpdateScores() {
    const newScores = {};
    const inputs = document.querySelectorAll('#mj-score-grid input');
    inputs.forEach(input => {
        const username = input.id.replace('edit-score-', '');
        newScores[username] = parseInt(input.value) || 0;
    });
    socket.emit('mj_force_scores', newScores);
}

function mjStartRound() {
    const q = document.getElementById('mj-question').value;
    const t = document.getElementById('mj-true').value;
    const l = document.getElementById('mj-lie').value;
    if (q && t && l) {
        socket.emit('mj_setup_round', { question: q, trueAnswer: t, mjLie: l });
    }
}

socket.on('phase_writing_players', (data) => {
    currentPhase = 'ingame';
    history.pushState({ screen: 'ingame' }, '', '#ingame'); 

    if (myRole === 'mj') {
        showWaitScreen("UPLINK ÉTABLI", "Attente de la génération des fausses données par les terminaux.");
    } else {
        document.getElementById('display-question').innerText = data.question;
        document.getElementById('player-lie').value = ''; 
        showScreen('screen-writing');
    }
});

function submitLie() {
    const lie = document.getElementById('player-lie').value;
    if (!lie) return;
    socket.emit('submit_lie', lie);
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
        if (select.dataset.answer !== selectedTruth.value && select.value !== "") {
            guesses[select.dataset.answer] = select.value;
        }
    });

    socket.emit('submit_votes', { selectedTruth: selectedTruth.value, guesses: guesses });
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
                <img src="${detail.profile_pic || 'https://via.placeholder.com/30/0ac8b9/000000?text=?'}" class="avatar-small" onerror="this.onerror=null; this.src='https://via.placeholder.com/30/0ac8b9/000000?text=?';">
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
            <span><i class="fa-solid fa-medal"></i> #${i+1} - 
            <img src="${p.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?'}" class="avatar" onerror="this.onerror=null; this.src='https://via.placeholder.com/60/0ac8b9/000000?text=?';"> ${p.username}</span> 
            <span>${p.score} pts</span>
        </li>
    `).join('');

    if (myRole === 'mj') {
        document.getElementById('mj-next-btn').style.display = 'flex';
    } else {
        document.getElementById('mj-next-btn').style.display = 'none';
    }

    showScreen('screen-results');
});

function nextRound() {
    socket.emit('trigger_next_round');
}

function endGame() {
    if(confirm("Voulez-vous vraiment terminer la partie et couronner le vainqueur ?")) {
        socket.emit('trigger_end_game');
    }
}

socket.on('game_ended', async (data) => {
    currentPhase = 'lobby'; 
    history.pushState({ screen: 'lobby' }, '', '#lobby');

    let subtitle = "Le vainqueur a été déclaré !";
    if (data.winners.length > 0) {
        subtitle = "Victoire de : " + data.winners.join(', ');
    }

    // Affichage personnalisé pour la victoire
    document.getElementById('wait-title').innerHTML = `<i class="fa-solid fa-trophy"></i> PARTIE TERMINÉE`;
    document.getElementById('wait-subtitle').innerText = subtitle;
    
    // On met le GIF synchronisé choisi par le serveur
    const waitGif = document.getElementById('wait-gif');
    waitGif.src = `/mamine/asset/${data.winGif}`;
    waitGif.style.display = 'inline-block';

    // Génération du podium HTML
    const podiumContainer = document.getElementById('victory-podium-container');
    let podiumHTML = '<ul id="leaderboard" style="margin-top: 20px;">';
    data.finalLeaderboard.forEach((p, i) => {
        let medal = i === 0 ? '<i class="fa-solid fa-crown" style="color: gold;"></i>' : `#${i+1}`;
        podiumHTML += `
            <li style="${i === 0 ? 'background: rgba(200, 155, 60, 0.2); border-color: #c89b3c; box-shadow: 0 0 20px rgba(200,155,60,0.3); transform: scale(1.05); z-index: 10;' : ''}">
                <span>
                    ${medal} &nbsp; 
                    <img src="${p.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?'}" class="avatar-small" onerror="this.onerror=null; this.src='https://via.placeholder.com/60/0ac8b9/000000?text=?';"> 
                    ${p.username}
                </span> 
                <span style="${i === 0 ? 'color: #c89b3c;' : 'color: #0ac8b9;'}">${p.score} pts</span>
            </li>
        `;
    });
    podiumHTML += '</ul>';
    podiumContainer.innerHTML = podiumHTML;
    podiumContainer.style.display = 'block';

    document.getElementById('btn-to-leaderboards').style.display = 'block';
    showScreen('screen-wait');

    if (myRole === 'player' && data.winners.includes(myUser.username)) {
        await fetch('/api/add-victory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                game_name: 'Le Contrebandier', 
                game_url: '/mamine/contrebandier.html' 
            })
        });
    }
});

socket.on('go_to_lobby', () => {
    currentPhase = 'lobby';
    history.pushState({ screen: 'lobby' }, '', '#lobby');

    if (myRole === 'mj') {
        document.getElementById('mj-question').value = '';
        document.getElementById('mj-true').value = '';
        document.getElementById('mj-lie').value = '';
    } else {
        document.getElementById('lobby-wait-gif').src = getRandomGif();
    }
    showScreen('screen-lobby');
});