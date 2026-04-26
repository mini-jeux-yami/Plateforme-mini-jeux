let currentUser = null;
let socket = null;
let isMJ = false;
let currentGameState = 'screen-loading';

// RÈGLE 5 : Navigation SPA et History API
function showScreen(screenId, pushToHistory = true) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    currentGameState = screenId;

    if (pushToHistory) {
        history.pushState({ screen: screenId }, '', '#' + screenId);
    }
}

// Bloquer la touche retour pendant une partie
window.addEventListener('popstate', (event) => {
    const inGameScreens = ['screen-theme-selection', 'screen-game', 'screen-review'];
    
    if (inGameScreens.includes(currentGameState)) {
        alert("Action impossible : vous ne pouvez pas quitter une partie en cours !");
        history.pushState({ screen: currentGameState }, '', '#' + currentGameState);
    } else if (currentGameState === 'screen-lobby') {
        if (socket) socket.disconnect();
        window.location.href = '/';
    } else if (event.state && event.state.screen) {
        showScreen(event.state.screen, false);
    }
});

// RÈGLE 2 : Auth Frontend
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/me')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn) {
                currentUser = data.user;
                initSocket(); 
            } else {
                window.location.href = '/'; // Redirection hub
            }
        })
        .catch(() => window.location.href = '/');
});

function initSocket() {
    socket = io('/yacine', {
        auth: {
            username: currentUser.username,
            profile_pic: currentUser.profile_pic
        }
    });

    socket.on('connect', () => {
        showScreen('screen-home'); // On arrive d'abord sur l'accueil
    });

    // --- NAVIGATION ACCUEIL & ÉDITEUR ---
    document.getElementById('btn-join-lobby').addEventListener('click', () => {
        socket.emit('join_lobby');
        showScreen('screen-lobby');
    });

    document.getElementById('btn-go-admin').addEventListener('click', () => {
        showScreen('screen-admin');
    });

    document.getElementById('btn-close-admin').addEventListener('click', () => {
        showScreen('screen-home');
        document.getElementById('admin-msg').innerText = '';
    });

    // Sauvegarde des questions Excel (Parsing)
    document.getElementById('btn-save-questions').addEventListener('click', () => {
        const rawText = document.getElementById('import-textarea').value;
        const lines = rawText.split('\n');
        let parsedQuestions = [];

        lines.forEach(line => {
            if (!line.trim()) return;
            const columns = line.split('\t'); // Détection des colonnes
            if (columns.length >= 4) {
                parsedQuestions.push({
                    theme: columns[0].trim(),
                    question: columns[1].trim(),
                    answer: columns[2].trim(),
                    difficulty: parseInt(columns[3].trim()) || 1
                });
            }
        });

        if (parsedQuestions.length > 0) {
            socket.emit('save_imported_questions', parsedQuestions);
            document.getElementById('import-textarea').value = ''; 
        } else {
            const msgEl = document.getElementById('admin-msg');
            msgEl.innerText = "Erreur de format. Vérifie tes colonnes !";
            msgEl.style.color = "var(--danger)";
        }
    });

    socket.on('admin_msg', (msg) => {
        const msgEl = document.getElementById('admin-msg');
        msgEl.style.color = "var(--success)";
        msgEl.innerText = msg;
    });

    // --- MISE À JOUR DU LOBBY ---
    socket.on('update_players', (playersList) => {
        const container = document.getElementById('lobby-players');
        container.innerHTML = ''; 
        let mjFound = false;

        playersList.forEach(player => {
            const div = document.createElement('div');
            div.className = `player-card ${player.isOnline ? '' : 'offline'}`;
            div.innerHTML = `
                <img src="${player.profile_pic || 'default.png'}" alt="Avatar">
                <span class="player-name">${player.username}</span>
                ${player.isMJ ? '<span class="mj-badge">👑 MJ</span>' : ''}
                ${!player.isOnline ? '<span class="offline-badge">Déco</span>' : ''}
            `;
            container.appendChild(div);
            if (player.username === currentUser.username && player.isMJ) mjFound = true;
        });

        isMJ = mjFound;
        
        // Affichage conditionnel MJ
        document.getElementById('mj-controls').classList.toggle('hidden', !isMJ);
        document.getElementById('waiting-msg').classList.toggle('hidden', isMJ);
    });

    socket.on('update_settings', (settings) => {
        if (!isMJ) {
            document.getElementById('setting-themes').value = settings.themesPerPlayer;
            document.getElementById('setting-questions').value = settings.questionsPerTheme;
        }
    });

    // Events lobby
    const themesInput = document.getElementById('setting-themes');
    const questionsInput = document.getElementById('setting-questions');

    const emitSettings = () => {
        if (isMJ) socket.emit('change_settings', { themesPerPlayer: parseInt(themesInput.value), questionsPerTheme: parseInt(questionsInput.value) });
    };

    themesInput.addEventListener('change', emitSettings);
    questionsInput.addEventListener('change', emitSettings);

    document.getElementById('btn-start-game').addEventListener('click', () => {
        if (isMJ) socket.emit('request_start_game');
    });

    // --- ÉVÈNEMENTS DE PARTIE (Anti-Déco) ---
    socket.on('game_started', () => showScreen('screen-theme-selection'));
    socket.on('game_paused', () => document.getElementById('pause-overlay').classList.remove('hidden'));
    socket.on('game_resumed', () => document.getElementById('pause-overlay').classList.add('hidden'));

    socket.on('sync_state', (data) => {
        const stateToScreen = { 'theme_selection': 'screen-theme-selection', 'quiz': 'screen-game', 'review': 'screen-review', 'dashboard': 'screen-dashboard' };
        if (stateToScreen[data.gameState]) showScreen(stateToScreen[data.gameState]);
    });
}