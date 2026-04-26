module.exports = function(io) {
    const mamineIo = io.of('/mamine');

    let gamePlayers = {}; 
    let mjData = { socketId: null, username: null, isConnected: false, stats: { victims: 0 } };
    
    let isGameRunning = false;
    let currentPhaseServer = 'lobby'; 
    let gameSettings = { rounds: 5 }; 
    let currentRoundNumber = 1; 
    let currentRound = { question: "", trueAnswer: "", mjLie: "", mjLieSubmitted: false, playerLies: {}, votes: {}, allAnswers: [] };

    mamineIo.on('connection', (socket) => {
        
        socket.on('join_as_player', (user) => {
            if (isGameRunning) {
                if (gamePlayers[user.username]) {
                    gamePlayers[user.username].socketId = socket.id;
                    gamePlayers[user.username].isConnected = true;
                    mamineIo.emit('game_resumed');
                    socket.emit('sync_state', { phase: currentPhaseServer, round: currentRound, roundNumber: currentRoundNumber, totalRounds: gameSettings.rounds });
                    return;
                } else {
                    return socket.emit('error', "Une partie est déjà en cours, vous ne pouvez pas la rejoindre.");
                }
            }

            gamePlayers[user.username] = { 
                socketId: socket.id, username: user.username, profile_pic: user.profile_pic, 
                score: 0, isReady: false, isConnected: true,
                stats: { victims: 0, truths: 0, perfects: 0 } 
            };
            broadcastLobby();
        });

        socket.on('join_as_mj', (user) => {
            if (isGameRunning && mjData.username === user.username) {
                mjData.socketId = socket.id;
                mjData.isConnected = true;
                mamineIo.emit('game_resumed');
                socket.emit('sync_state', { phase: currentPhaseServer, round: currentRound, roundNumber: currentRoundNumber, totalRounds: gameSettings.rounds });
                return;
            }

            mjData = { socketId: socket.id, username: user.username, isConnected: true, stats: { victims: 0 } };
            broadcastLobby();
        });

        socket.on('toggle_ready', () => {
            const user = getUserBySocket(socket.id);
            if (user && user.role === 'player') {
                gamePlayers[user.username].isReady = !gamePlayers[user.username].isReady;
                broadcastLobby();
            }
        });

        socket.on('leave_role', handleDisconnect);
        socket.on('disconnect', handleDisconnect);

        function handleDisconnect() {
            const user = getUserBySocket(socket.id);
            if (!user) return;

            // CORRECTION BUG 2/3 : On ne met PAS en pause si on est sur l'écran des résultats finaux
            if (isGameRunning && currentPhaseServer !== 'results') {
                if (user.role === 'player') gamePlayers[user.username].isConnected = false;
                if (user.role === 'mj') mjData.isConnected = false;
                mamineIo.emit('game_paused', { missingPlayer: user.username });
            } else {
                if (user.role === 'player') delete gamePlayers[user.username];
                if (user.role === 'mj') mjData = { socketId: null, username: null, isConnected: false, stats: { victims: 0 } };
                broadcastLobby();
            }
        }

        function getUserBySocket(socketId) {
            if (mjData.socketId === socketId) return { role: 'mj', username: mjData.username };
            for (let uname in gamePlayers) {
                if (gamePlayers[uname].socketId === socketId) return { role: 'player', username: uname };
            }
            return null;
        }

        function broadcastLobby() {
            mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: !!mjData.socketId });
        }

        socket.on('mj_force_scores', (newScores) => {
            for (let uname in newScores) {
                if (gamePlayers[uname]) gamePlayers[uname].score = newScores[uname];
            }
            broadcastLobby();
        });

        // NOUVEAU BOUTON : Réinitialisation d'urgence
        socket.on('mj_reset_session', () => {
            isGameRunning = false;
            currentPhaseServer = 'lobby';
            currentRoundNumber = 1;
            for(let uname in gamePlayers) { 
                gamePlayers[uname].score = 0; 
                gamePlayers[uname].isReady = false; 
                gamePlayers[uname].stats = { victims: 0, truths: 0, perfects: 0 };
            }
            if (mjData) mjData.stats.victims = 0;
            currentRound = { question: "", trueAnswer: "", mjLie: "", mjLieSubmitted: false, playerLies: {}, votes: {}, allAnswers: [] };
            mamineIo.emit('go_to_lobby');
            broadcastLobby();
        });

        socket.on('mj_start_wizard', (settings) => {
            isGameRunning = true;
            currentPhaseServer = 'prep';
            gameSettings = settings;
            currentRoundNumber = 1; 
            mamineIo.emit('phase_mj_preparing'); 
        });

        socket.on('mj_submit_q_a', (data) => {
            currentPhaseServer = 'writing';
            currentRound = { question: data.question, trueAnswer: data.trueAnswer, mjLie: "", mjLieSubmitted: false, playerLies: {}, votes: {}, allAnswers: [] };
            mamineIo.emit('phase_writing_all', { question: data.question, currentRoundNumber: currentRoundNumber, totalRounds: gameSettings.rounds }); 
        });

        socket.on('submit_mj_lie', (lie) => {
            currentRound.mjLie = lie;
            currentRound.mjLieSubmitted = true;
            checkAllLiesSubmitted();
        });

        socket.on('submit_lie', (data) => {
            currentRound.playerLies[data.username] = data.lie;
            checkAllLiesSubmitted();
        });

        function checkAllLiesSubmitted() {
            if (currentRound.mjLieSubmitted && Object.keys(currentRound.playerLies).length >= Object.keys(gamePlayers).length) {
                currentPhaseServer = 'voting';
                let answers = [currentRound.trueAnswer, currentRound.mjLie, ...Object.values(currentRound.playerLies)];
                currentRound.allAnswers = answers.sort(() => Math.random() - 0.5); 
                let authorsList = Object.values(gamePlayers).map(p => ({ id: p.username, name: p.username })); 
                authorsList.push({ id: 'MJ', name: 'Le Maître du Jeu' });
                
                // On envoie playerLies au front pour qu'il gère l'invisibilité
                mamineIo.emit('phase_voting', { question: currentRound.question, answers: currentRound.allAnswers, authors: authorsList, playerLies: currentRound.playerLies });
            }
        }

        socket.on('submit_votes', (data) => {
            currentRound.votes[data.username] = data.voteData;
            if (Object.keys(currentRound.votes).length >= Object.keys(gamePlayers).length) calculateScoresAndEndRound();
        });

        socket.on('trigger_next_round', () => {
            currentRoundNumber++;
            currentPhaseServer = 'prep'; // On retourne à la préparation MJ
            Object.values(gamePlayers).forEach(p => p.isReady = false);
            mamineIo.emit('phase_mj_preparing'); // Boucle directe sans passer par le lobby !
        });

        socket.on('trigger_end_game', () => {
            isGameRunning = false;
            currentPhaseServer = 'lobby';
            let maxScore = -1;
            let winners = [];
            for (let uname in gamePlayers) {
                if (gamePlayers[uname].score > maxScore) {
                    maxScore = gamePlayers[uname].score;
                    winners = [uname];
                } else if (gamePlayers[uname].score === maxScore && maxScore > 0) {
                    winners.push(uname); 
                }
            }
            const randomWinGif = `win${Math.floor(Math.random() * 5) + 1}.gif`;
            const finalLeaderboard = Object.values(gamePlayers).sort((a, b) => b.score - a.score);
            
            let matchStats = {
                players: Object.values(gamePlayers).map(p => ({
                    username: p.username, profile_pic: p.profile_pic, score: p.score,
                    victims: p.stats.victims, truths: p.stats.truths, perfects: p.stats.perfects
                })),
                mj: { username: mjData.username, victims: mjData.stats.victims }
            };

            mamineIo.emit('game_ended', { winners: winners, finalLeaderboard: finalLeaderboard, winGif: randomWinGif, matchStats: matchStats });

            // Reset pour la prochaine
            currentRoundNumber = 1;
            for(let uname in gamePlayers) { 
                gamePlayers[uname].score = 0; 
                gamePlayers[uname].isReady = false; 
                gamePlayers[uname].stats = { victims: 0, truths: 0, perfects: 0 };
            }
            if (mjData) mjData.stats.victims = 0;
            currentRound = { question: "", trueAnswer: "", mjLie: "", mjLieSubmitted: false, playerLies: {}, votes: {}, allAnswers: [] };
        });

        socket.on('force_kill_game', () => {
            isGameRunning = false;
            currentPhaseServer = 'lobby';
            currentRoundNumber = 1;
            for(let uname in gamePlayers) { 
                gamePlayers[uname].score = 0; 
                gamePlayers[uname].isReady = false; 
                gamePlayers[uname].stats = { victims: 0, truths: 0, perfects: 0 };
            }
            if (mjData) mjData.stats.victims = 0;
            currentRound = { question: "", trueAnswer: "", mjLie: "", mjLieSubmitted: false, playerLies: {}, votes: {}, allAnswers: [] };
            mamineIo.emit('game_ended_force');
        });

        function calculateScoresAndEndRound() {
            currentPhaseServer = 'results';
            let roundDetails = [];
            for (let uname in currentRound.votes) {
                let player = gamePlayers[uname];
                if (!player) continue;

                let vote = currentRound.votes[uname];
                let ptsTruth = 0, ptsTrap = 0, ptsGuess = 0, ptsBonus = 0;

                if (vote.selectedTruth === currentRound.trueAnswer) {
                    ptsTruth += 2;
                    player.stats.truths++;
                }

                if (vote.selectedTruth === currentRound.mjLie) {
                    mjData.stats.victims++;
                }

                let myLie = currentRound.playerLies[uname];
                let victimsCount = 0;
                for (let otherUname in currentRound.votes) {
                    if (otherUname !== uname && currentRound.votes[otherUname].selectedTruth === myLie) {
                        ptsTrap += 2; victimsCount++;
                    }
                }
                
                player.stats.victims += victimsCount;
                let correctGuesses = 0;
                let totalFalseAnswers = Object.keys(currentRound.playerLies).length + 1;

                for (let ans in vote.guesses) {
                    if (vote.guesses[ans] === getAuthorOfAnswer(ans)) correctGuesses++;
                }

                ptsGuess = correctGuesses;
                if (correctGuesses === totalFalseAnswers && totalFalseAnswers > 0) {
                    ptsBonus = 1;
                    player.stats.perfects++;
                }

                let roundTotal = ptsTruth + ptsTrap + ptsGuess + ptsBonus;
                player.score += roundTotal;

                roundDetails.push({
                    username: player.username, profile_pic: player.profile_pic, votedFor: vote.selectedTruth, myLie: myLie, victims: victimsCount,
                    points: { truth: ptsTruth, trap: ptsTrap, guess: ptsGuess, bonus: ptsBonus, total: roundTotal }
                });
            }
            
            let isLastRound = currentRoundNumber >= gameSettings.rounds;

            mamineIo.emit('phase_results', { 
                leaderboard: Object.values(gamePlayers).sort((a, b) => b.score - a.score), 
                trueAnswer: currentRound.trueAnswer, mjLie: currentRound.mjLie, roundDetails: roundDetails, isLastRound: isLastRound
            });
        }

        function getAuthorOfAnswer(answer) {
            if (answer === currentRound.mjLie) return 'MJ';
            for (let uname in currentRound.playerLies) { if (currentRound.playerLies[uname] === answer) return uname; }
            return null;
        }
    });
};