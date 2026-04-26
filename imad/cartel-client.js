const socket = io('/imad');
let myRole = ''; 
let myUser = null; 
let currentPhase = 'role'; 
let myCartelId = null; 

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function formatMoney(amount) {
    return amount.toLocaleString('fr-FR');
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

// ==========================================
// ANTI-DÉCONNEXION (PAUSE / REPRISE)
// ==========================================
socket.on('game_paused', (data) => {
    document.getElementById('pause-overlay').style.display = 'flex';
    document.getElementById('pause-missing-name').innerText = data.missingPlayer;
    if (myRole === 'politician') document.getElementById('mj-pause-controls').style.display = 'block';
});

socket.on('game_resumed', () => {
    document.getElementById('pause-overlay').style.display = 'none';
});

socket.on('sync_state', (state) => {
    document.getElementById('pause-overlay').style.display = 'none';
    currentPhase = 'ingame';
    
    if (myRole === 'cartel') {
        document.getElementById('role-badge').innerText = "RÔLE : CARTEL";
        document.getElementById('cartel-actions-panel').style.display = 'block';
        document.getElementById('politician-actions-panel').style.display = 'none';
        document.getElementById('politician-intel-panel').style.display = 'none';
    } else {
        document.getElementById('role-badge').innerText = "RÔLE : POLITICIEN";
        document.getElementById('role-badge').style.background = "#2e7d32";
        document.getElementById('cartel-actions-panel').style.display = 'none';
        document.getElementById('politician-actions-panel').style.display = 'block';
        document.getElementById('politician-intel-panel').style.display = 'block';
    }
    showScreen('screen-game');
    
    // On simule une réception de début de tour pour tout redessiner proprement
    socket.emit('get_private_info');
    document.getElementById('display-turn').innerText = state.turn;
    
    let marketHtml = '';
    for(let key in state.market) {
        let m = state.market[key];
        let icon = key === 'weapons' ? 'gun' : (key === 'contraband' ? 'box' : 'laptop-code');
        marketHtml += `<div class="market-item"><span><i class="fa-solid fa-${icon}"></i> ${m.name}</span> <span>${formatMoney(m.currentPrice)} $</span></div>`;
    }
    document.getElementById('market-display').innerHTML = marketHtml;
    document.getElementById('log-display').innerHTML = state.logs.map(l => `<div class="log-entry">${l}</div>`).join('');
});

socket.on('game_ended_force', () => {
    document.getElementById('pause-overlay').style.display = 'none';
    alert("Le Politicien a ordonné l'annulation de la partie suite à un abandon.");
    window.location.reload();
});

function forceEndGame() {
    if(confirm("Toutes les données de la partie seront perdues. Êtes-vous sûr ?")) socket.emit('force_kill_game');
}
// ==========================================

function joinAsCartel() {
    myRole = 'cartel'; currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    socket.emit('join_as_cartel', { username: myUser.username, profile_pic: myUser.profile_pic }); 
    showScreen('screen-lobby');
}

function joinAsPolitician() {
    myRole = 'politician'; currentPhase = 'lobby'; history.pushState({ screen: 'lobby' }, '', '#lobby'); 
    socket.emit('join_as_politician', { username: myUser.username, profile_pic: myUser.profile_pic }); 
    showScreen('screen-lobby');
    document.getElementById('mj-controls').style.display = 'block';
}

function leaveRole() { history.back(); }

window.addEventListener('popstate', (event) => {
    if (currentPhase === 'lobby' && myRole !== '') {
        socket.emit('leave_role'); myRole = ''; currentPhase = 'role'; showScreen('screen-role');
        document.getElementById('mj-controls').style.display = 'none';
    } else if (currentPhase === 'ingame') {
        history.pushState({ screen: 'ingame' }, '', '#ingame'); 
        alert("Action impossible : La partie est en cours !");
    }
});

socket.on('error', (msg) => { alert(msg); leaveRole(); });

socket.on('update_lobby', (data) => {
    const cList = document.getElementById('cartel-list');
    cList.innerHTML = data.cartels.map(p => `<li><img src="${p.profile_pic || '/asset/default.png'}" class="avatar"> <span style="${!p.isConnected ? 'color:#d32f2f; text-decoration:line-through;' : ''}">${p.username}</span></li>`).join('');
    
    for(let i = data.cartels.length; i < 3; i++) {
        cList.innerHTML += `<li><i class="fa-solid fa-user-secret" style="margin-right:15px; font-size:24px; color:#555;"></i> <span style="color:#555;">En attente d'un joueur...</span></li>`;
    }

    const pList = document.getElementById('politician-list');
    if (data.politician) {
        pList.innerHTML = `<li><img src="${data.politician.profile_pic || '/asset/default.png'}" class="avatar" style="border-color:#2e7d32;"> <span style="${!data.politician.isConnected ? 'color:#d32f2f; text-decoration:line-through;' : ''}">${data.politician.username}</span></li>`;
    } else {
        pList.innerHTML = `<li><i class="fa-solid fa-building-columns" style="margin-right:15px; font-size:24px; color:#555;"></i> <span style="color:#555;">En attente du MJ...</span></li>`;
    }

    if (myRole === 'politician') document.getElementById('btn-start-game').disabled = !data.canStart;
});

function startGame() { socket.emit('start_game'); }

socket.on('game_started', () => {
    currentPhase = 'ingame'; history.pushState({ screen: 'ingame' }, '', '#ingame'); 
    showScreen('screen-game');

    if (myRole === 'cartel') {
        document.getElementById('role-badge').innerText = "RÔLE : CARTEL";
        document.getElementById('cartel-actions-panel').style.display = 'block';
        document.getElementById('politician-actions-panel').style.display = 'none';
        document.getElementById('politician-intel-panel').style.display = 'none';
    } else {
        document.getElementById('role-badge').innerText = "RÔLE : POLITICIEN";
        document.getElementById('role-badge').style.background = "#2e7d32";
        document.getElementById('cartel-actions-panel').style.display = 'none';
        document.getElementById('politician-actions-panel').style.display = 'block';
        document.getElementById('politician-intel-panel').style.display = 'block';
    }
});

socket.on('turn_start', (state) => {
    document.getElementById('btn-submit-turn').style.display = 'block';
    document.getElementById('wait-turn-msg').style.display = 'none';
    document.getElementById('display-turn').innerText = state.turn;
    
    let marketHtml = '';
    for(let key in state.market) {
        let m = state.market[key];
        let icon = key === 'weapons' ? 'gun' : (key === 'contraband' ? 'box' : 'laptop-code');
        marketHtml += `<div class="market-item"><span><i class="fa-solid fa-${icon}"></i> ${m.name}</span> <span>${formatMoney(m.currentPrice)} $</span></div>`;
    }
    document.getElementById('market-display').innerHTML = marketHtml;
    document.getElementById('log-display').innerHTML = state.logs.map(l => `<div class="log-entry">${l}</div>`).join('');

    socket.emit('get_private_info');

    if (myRole === 'cartel') {
        let heistSelect = document.getElementById('heist-target-player');
        heistSelect.innerHTML = '';
        for(let id in state.publicPlayers) {
            let p = state.publicPlayers[id];
            if (p.username === myUser.username) {
                myCartelId = id;
                let inv = p.inventory;
                document.getElementById('cartel-stock-info').innerHTML = `📦 En stock : ${inv.weapons} Armes | ${inv.contraband} Contrebande | ${inv.data} Données`;
            } else {
                heistSelect.innerHTML += `<option value="${id}">${p.username}</option>`;
            }
        }
        
        document.getElementById('bribe-amount').value = '';
        document.getElementById('bribe-msg').value = '';

    } else if (myRole === 'politician') {
        let intelHtml = '';
        for(let id in state.publicPlayers) {
            let p = state.publicPlayers[id];
            let status = p.isReady ? '<i class="fa-solid fa-check status-ready"></i>' : '<i class="fa-solid fa-hourglass status-waiting"></i>';
            intelHtml += `
                <div class="intel-card">
                    <h4>${p.username} ${status}</h4>
                    <div class="intel-stats">
                        <span>🔫 ${p.inventory.weapons}</span>
                        <span>📦 ${p.inventory.contraband}</span>
                        <span>💻 ${p.inventory.data}</span>
                    </div>
                </div>`;
        }
        document.getElementById('intel-display').innerHTML = intelHtml;

        let canRaid = (state.lastRaidTurn !== state.turn - 1);
        document.getElementById('raid-weapons').disabled = !canRaid;
        document.getElementById('raid-contraband').disabled = !canRaid;
        document.getElementById('raid-data').disabled = !canRaid;
        document.getElementById('raid-cooldown-msg').style.display = canRaid ? 'none' : 'block';
        if(!canRaid) document.querySelector('input[name="polActionA"][value="none"]').checked = true;
    }
});

socket.on('private_info', (data) => {
    document.getElementById('display-bank').innerText = formatMoney(data.bank);

    if (myRole === 'cartel') {
        let repDiv = document.getElementById('bribe-reply-display');
        if (data.bribeReply) {
            repDiv.innerHTML = `<i class="fa-solid fa-envelope-open-text"></i> Le Politicien dit : "<em>${data.bribeReply}</em>"`;
        } else {
            repDiv.innerHTML = '';
        }
    } else if (myRole === 'politician') {
        let container = document.getElementById('incoming-bribes-container');
        if (data.incomingBribes && data.incomingBribes.length > 0) {
            container.innerHTML = data.incomingBribes.map(b => `
                <div class="bribe-alert" id="bribe-box-${b.cartelId}">
                    <strong>${b.username}</strong> offre <strong>${formatMoney(b.amount)}$</strong><br>
                    Demande : "<em>${b.question}</em>"<br>
                    <div style="margin-top:5px;">
                        <button onclick="answerBribe('${b.cartelId}', true)" class="btn-secondary" style="width:auto; padding:5px 10px; font-size:12px;">Accepter</button>
                        <button onclick="answerBribe('${b.cartelId}', false)" class="btn-primary" style="width:auto; padding:5px 10px; font-size:12px;">Refuser</button>
                    </div>
                    <input type="text" id="bribe-reply-${b.cartelId}" placeholder="Votre réponse au cartel..." style="margin-top:10px; display:none;">
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="font-size:13px; color:#a89f91;">Aucune offre reçue ce tour.</p>';
        }
    }
});

let currentBribeResponses = {};

function answerBribe(cartelId, isAccepted) {
    let replyInput = document.getElementById(`bribe-reply-${cartelId}`);
    if (isAccepted) {
        replyInput.style.display = 'block';
        currentBribeResponses[cartelId] = { accepted: true, reply: "" }; 
    } else {
        replyInput.style.display = 'none';
        currentBribeResponses[cartelId] = { accepted: false, reply: "" };
        document.getElementById(`bribe-box-${cartelId}`).style.opacity = '0.5';
    }
}

function submitTurn() {
    document.getElementById('btn-submit-turn').style.display = 'none';
    document.getElementById('wait-turn-msg').style.display = 'block';

    if (myRole === 'cartel') {
        let actA_val = document.querySelector('input[name="actionA"]:checked').value; 
        let actA = { type: actA_val.split('_')[0], resource: actA_val.split('_')[1] };

        let actB_val = document.querySelector('input[name="actionB"]:checked').value;
        let actB = { type: actB_val };
        if (actB_val === 'protect') actB.resource = document.getElementById('protect-target').value;
        if (actB_val === 'heist') {
            actB.targetId = document.getElementById('heist-target-player').value;
            actB.resource = document.getElementById('heist-target-res').value;
        }

        let bribeAmt = parseInt(document.getElementById('bribe-amount').value) || 0;
        let actC = { amount: bribeAmt, question: document.getElementById('bribe-msg').value };

        socket.emit('submit_cartel_actions', { actions: { a: actA, b: actB, c: actC } });

    } else if (myRole === 'politician') {
        let raidTarget = document.querySelector('input[name="polActionA"]:checked').value;
        
        for(let id in currentBribeResponses) {
            if (currentBribeResponses[id].accepted) {
                let inputEl = document.getElementById(`bribe-reply-${id}`);
                currentBribeResponses[id].reply = inputEl ? inputEl.value : "Marché conclu.";
            }
        }

        socket.emit('submit_politician_actions', { 
            raid: raidTarget === 'none' ? null : raidTarget, 
            bribesResponse: currentBribeResponses 
        });
        currentBribeResponses = {}; 
    }
}

socket.on('game_ended', async (data) => {
    currentPhase = 'lobby'; 
    history.pushState({ screen: 'lobby' }, '', '#lobby');

    const container = document.getElementById('stylized-leaderboard-container');
    container.innerHTML = '';

    data.leaderboard.forEach((p, i) => {
        let imgUrl = p.profile_pic || '/asset/default.png';

        if (p.isWinner) {
            let wantedTitle = p.role === 'Politicien' ? "WANTED : EL PRESIDENTE" : "WANTED : EL PATRÓN";
            container.innerHTML += `
                <div class="wanted-poster">
                    <div class="wanted-title">${wantedTitle}</div>
                    <img src="${imgUrl}" class="mugshot" onerror="this.onerror=null; this.src='/asset/default.png';">
                    <div class="wanted-name">${p.username}</div>
                    <div style="font-family:'Special Elite', cursive; margin-bottom:10px;">A remporté la guerre des Cartels</div>
                    <div class="wanted-bounty">Fortune : ${formatMoney(p.bank)} $</div>
                </div>
            `;
        } else {
            let stamp = p.role === 'Politicien' ? "DESTITUÉ" : "DÉMANTELÉ";
            container.innerHTML += `
                <div class="dossier-entry">
                    <div class="dossier-info">
                        <img src="${imgUrl}" class="dossier-mugshot" onerror="this.onerror=null; this.src='/asset/default.png';">
                        <div class="dossier-text">
                            <h4>${p.username} (${p.role})</h4>
                            <p>Saisie : ${formatMoney(p.bank)} $</p>
                        </div>
                    </div>
                    <div class="stamp-failed">${stamp}</div>
                </div>
            `;
        }
    });

    showScreen('screen-results');

    if (data.winners.includes(myUser.username)) {
        await fetch('/api/add-victory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_name: 'El Cartel', game_url: '/imad/cartel.html' })
        });
    }
});