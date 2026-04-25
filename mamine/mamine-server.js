// Ce module exporte une fonction qui prend l'objet 'io' global et gère tout ce qui se passe sur le canal '/mamine'
module.exports = function(io) {
    const mamineIo = io.of('/mamine');

    let gamePlayers = {}; 
    let mjSocketId = null;
    let currentRound = { question: "", trueAnswer: "", mjLie: "", playerLies: {}, votes: {}, allAnswers: [] };
    let inGameScores = {}; 

    mamineIo.on('connection', (socket) => {
        
        // CORRECTION : On accepte un objet "user" contenant le pseudo ET la photo
        socket.on('join_as_player', (user) => {
            if (inGameScores[user.username] === undefined) inGameScores[user.username] = 0;
            gamePlayers[socket.id] = { 
                id: socket.id, 
                username: user.username, 
                profile_pic: user.profile_pic, // On stocke la photo de profil ici !
                score: inGameScores[user.username] 
            };
            mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: !!mjSocketId, scoresDb: inGameScores });
        });

        socket.on('join_as_mj', () => {
            mjSocketId = socket.id;
            mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: true, scoresDb: inGameScores });
        });

        socket.on('disconnect', () => {
            if (gamePlayers[socket.id]) {
                delete gamePlayers[socket.id];
                mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: !!mjSocketId, scoresDb: inGameScores });
            }
            if (socket.id === mjSocketId) {
                mjSocketId = null;
                mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: false, scoresDb: inGameScores });
            }
        });

        socket.on('mj_force_scores', (newScores) => {
            for (let username in newScores) {
                inGameScores[username] = newScores[username];
                for(let id in gamePlayers) {
                    if (gamePlayers[id].username === username) {
                        gamePlayers[id].score = newScores[username];
                    }
                }
            }
            mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: !!mjSocketId, scoresDb: inGameScores });
        });

        socket.on('mj_setup_round', (data) => {
            currentRound = { question: data.question, trueAnswer: data.trueAnswer, mjLie: data.mjLie, playerLies: {}, votes: {}, allAnswers: [] };
            mamineIo.emit('phase_writing_players', { question: data.question });
        });

        socket.on('submit_lie', (lie) => {
            currentRound.playerLies[socket.id] = lie;
            if (Object.keys(currentRound.playerLies).length >= Object.keys(gamePlayers).length) startVotingPhase();
        });

        socket.on('submit_votes', (data) => {
            currentRound.votes[socket.id] = data;
            if (Object.keys(currentRound.votes).length >= Object.keys(gamePlayers).length) calculateScoresAndEndRound();
        });

        socket.on('trigger_next_round', () => {
            mamineIo.emit('update_lobby', { players: Object.values(gamePlayers), mjReady: true, scoresDb: inGameScores });
            mamineIo.emit('go_to_lobby');
        });

        function startVotingPhase() {
            let answers = [currentRound.trueAnswer, currentRound.mjLie, ...Object.values(currentRound.playerLies)];
            currentRound.allAnswers = answers.sort(() => Math.random() - 0.5); 
            let authorsList = Object.values(gamePlayers).map(p => ({ id: p.id, name: p.username }));
            authorsList.push({ id: 'MJ', name: 'Le Maître du Jeu' });
            mamineIo.emit('phase_voting', { question: currentRound.question, answers: currentRound.allAnswers, authors: authorsList });
        }

        function calculateScoresAndEndRound() {
            let roundDetails = [];

            for (let playerId in currentRound.votes) {
                let player = gamePlayers[playerId];
                if (!player) continue;

                let vote = currentRound.votes[playerId];
                let ptsTruth = 0, ptsTrap = 0, ptsGuess = 0, ptsBonus = 0;

                if (vote.selectedTruth === currentRound.trueAnswer) ptsTruth += 2;

                let myLie = currentRound.playerLies[playerId];
                let victimsCount = 0;
                for (let otherId in currentRound.votes) {
                    if (otherId !== playerId && currentRound.votes[otherId].selectedTruth === myLie) {
                        ptsTrap += 2; victimsCount++;
                    }
                }

                let correctGuesses = 0;
                let totalFalseAnswers = Object.keys(currentRound.playerLies).length + 1;

                for (let ans in vote.guesses) {
                    if (vote.guesses[ans] === getAuthorOfAnswer(ans)) correctGuesses++;
                }

                ptsGuess = correctGuesses;
                if (correctGuesses === totalFalseAnswers) ptsBonus = 1;

                let roundTotal = ptsTruth + ptsTrap + ptsGuess + ptsBonus;
                player.score += roundTotal;
                inGameScores[player.username] = player.score; 

                roundDetails.push({
                    username: player.username, 
                    profile_pic: player.profile_pic, // On transmet la photo au récap
                    votedFor: vote.selectedTruth, 
                    myLie: myLie, 
                    victims: victimsCount,
                    points: { truth: ptsTruth, trap: ptsTrap, guess: ptsGuess, bonus: ptsBonus, total: roundTotal }
                });
            }

            mamineIo.emit('phase_results', { 
                leaderboard: Object.values(gamePlayers).sort((a, b) => b.score - a.score), 
                trueAnswer: currentRound.trueAnswer, mjLie: currentRound.mjLie, roundDetails: roundDetails       
            });
        }

        function getAuthorOfAnswer(answer) {
            if (answer === currentRound.mjLie) return 'MJ';
            for (let id in currentRound.playerLies) { if (currentRound.playerLies[id] === answer) return id; }
            return null;
        }
    });
};