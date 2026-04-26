const fs = require('fs');
const path = require('path');

// RÈGLE 3 : Exporte une fonction prenant l'objet io global (PAS de serveur HTTP ici)
module.exports = function(io) {
    // Utilisation EXCLUSIVE du Namespace dédié
    const namespace = io.of('/yacine');
    const dbPath = path.join(__dirname, 'questions.json');

    // État global du jeu
    let players = {}; // Structure: { username: { socketId, profile_pic, isMJ, isOnline } }
    let gameState = 'lobby'; 
    let mjUsername = null;
    let gameSettings = { themesPerPlayer: 2, questionsPerTheme: 10 };

    // Fonction pour lire la base de données JSON
    function getQuestionsDB() {
        if (!fs.existsSync(dbPath)) return [];
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }

    namespace.on('connection', (socket) => {
        const authInfo = socket.handshake.auth;
        const username = authInfo.username;

        if (!username) {
            socket.disconnect();
            return;
        }

        // Envoi des infos DB dès la connexion au namespace (pour l'éditeur)
        socket.emit('db_info', { totalQuestions: getQuestionsDB().length });

        // --- ENTRÉE DANS LE LOBBY ---
        socket.on('join_lobby', () => {
            // RÈGLE 4 : Système Anti-Déconnexion (Indexation par username)
            if (players[username]) {
                // Le joueur se reconnecte
                players[username].socketId = socket.id;
                players[username].isOnline = true;
                console.log(`[Jeu] ${username} s'est reconnecté.`);

                if (gameState !== 'lobby') {
                    namespace.emit('game_resumed');
                    socket.emit('sync_state', { gameState, settings: gameSettings });
                }
            } else {
                // Nouveau joueur
                if (gameState !== 'lobby') {
                    socket.emit('error', 'Une partie est déjà en cours.');
                    return;
                }

                // Le premier joueur à rejoindre devient le MJ
                const isFirstPlayer = Object.keys(players).length === 0;
                players[username] = {
                    socketId: socket.id,
                    username: username,
                    profile_pic: authInfo.profile_pic,
                    isMJ: isFirstPlayer,
                    isOnline: true
                };

                if (isFirstPlayer) mjUsername = username;
                console.log(`[Jeu] ${username} a rejoint le lobby. MJ: ${players[username].isMJ}`);
            }

            namespace.emit('update_players', Object.values(players));
            namespace.emit('update_settings', gameSettings);
        });

        // --- SAUVEGARDE DES QUESTIONS DEPUIS L'ÉDITEUR ---
        socket.on('save_imported_questions', (newQuestions) => {
            let currentDB = getQuestionsDB();
            currentDB = currentDB.concat(newQuestions);
            fs.writeFileSync(dbPath, JSON.stringify(currentDB, null, 2));
            
            socket.emit('admin_msg', `${newQuestions.length} questions ajoutées avec succès !`);
            namespace.emit('db_info', { totalQuestions: currentDB.length });
        });

        // --- GESTION DES PARAMÈTRES ET DÉPART ---
        socket.on('change_settings', (newSettings) => {
            if (username === mjUsername && gameState === 'lobby') {
                gameSettings = { ...gameSettings, ...newSettings };
                socket.broadcast.emit('update_settings', gameSettings);
            }
        });

        socket.on('request_start_game', () => {
            if (username === mjUsername && gameState === 'lobby') {
                gameState = 'theme_selection';
                namespace.emit('game_started', { state: gameState, settings: gameSettings });
            }
        });

        // --- DÉCONNEXION ---
        socket.on('disconnect', () => {
            if (players[username]) {
                players[username].isOnline = false;
                console.log(`[Jeu] ${username} s'est déconnecté.`);

                if (gameState === 'lobby') {
                    delete players[username];
                    if (mjUsername === username) {
                        const remaining = Object.values(players);
                        if (remaining.length > 0) {
                            remaining[0].isMJ = true;
                            mjUsername = remaining[0].username;
                        } else {
                            mjUsername = null;
                        }
                    }
                    namespace.emit('update_players', Object.values(players));
                } else {
                    // RÈGLE 4 : Pause la partie si déco in-game
                    namespace.emit('game_paused');
                }
            }
        });
    });
};