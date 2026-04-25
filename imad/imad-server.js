module.exports = function(io) {
    const imadIo = io.of('/imad');

    // ==========================================
    // 1. ÉTAT DU JEU (STATE)
    // ==========================================
    let gameState = {
        status: 'lobby', 
        turn: 1,
        market: {
            weapons: { name: 'Armes', basePrice: 100000, currentPrice: 100000 },
            contraband: { name: 'Contrebande', basePrice: 80000, currentPrice: 80000 },
            data: { name: 'Données', basePrice: 60000, currentPrice: 60000 }
        },
        players: {}, 
        politician: null, 
        logs: [], 
        winners: []
    };

    const WIN_CARTEL = 1000000;
    const WIN_POLITICIAN = 500000;

    // ==========================================
    // 2. UTILITAIRES ET ÉVÉNEMENTS DU MARCHÉ
    // ==========================================
    function generateMarketEvent() {
        const resources = ['weapons', 'contraband', 'data'];
        let eventLogs = [];
        
        resources.forEach(res => {
            let variation = (Math.random() * 0.7) - 0.3; 
            
            gameState.market[res].currentPrice = Math.round(gameState.market[res].basePrice * (1 + variation));
            
            let percentStr = Math.round(variation * 100);
            if (percentStr !== 0) {
                let sign = percentStr > 0 ? '+' : '';
                eventLogs.push(`Le cours des ${gameState.market[res].name} fait ${sign}${percentStr}%.`);
            }
        });
        
        return eventLogs;
    }

    function checkVictory() {
        // On trie d'abord les cartels du plus riche au plus pauvre
        let sortedCartels = Object.values(gameState.players).sort((a, b) => b.bank - a.bank);
        
        let cartelWinner = null;
        let polWinner = null;

        // Le vainqueur Cartel potentiel est forcément le premier de la liste triée
        if (sortedCartels.length > 0 && sortedCartels[0].bank >= WIN_CARTEL) {
            cartelWinner = sortedCartels[0];
        }
        
        // Check Politician
        if (gameState.politician.bank >= WIN_POLITICIAN) {
            polWinner = gameState.politician;
        }

        if (cartelWinner || polWinner) {
            gameState.status = 'finished';
            let finalLeaderboard = [];

            // GESTION DU CAS EXTRÊME : Le Politicien ET un Cartel gagnent au même tour
            let polScoreRatio = polWinner ? (polWinner.bank / WIN_POLITICIAN) : 0;
            let cartelScoreRatio = cartelWinner ? (cartelWinner.bank / WIN_CARTEL) : 0;

            if (polWinner && polScoreRatio >= cartelScoreRatio) {
                // Politicien gagne
                finalLeaderboard.push({ username: polWinner.username, profile_pic: polWinner.profile_pic, role: 'Politicien', bank: polWinner.bank, isWinner: true });
                sortedCartels.forEach(c => finalLeaderboard.push({ username: c.username, profile_pic: c.profile_pic, role: 'Cartel', bank: c.bank, isWinner: false }));
                gameState.winners = [polWinner.username];
            } else {
                // Cartel gagne
                finalLeaderboard.push({ username: sortedCartels[0].username, profile_pic: sortedCartels[0].profile_pic, role: 'Cartel', bank: sortedCartels[0].bank, isWinner: true });
                if(sortedCartels[1]) finalLeaderboard.push({ username: sortedCartels[1].username, profile_pic: sortedCartels[1].profile_pic, role: 'Cartel', bank: sortedCartels[1].bank, isWinner: false });
                if(sortedCartels[2]) finalLeaderboard.push({ username: sortedCartels[2].username, profile_pic: sortedCartels[2].profile_pic, role: 'Cartel', bank: sortedCartels[2].bank, isWinner: false });
                finalLeaderboard.push({ username: gameState.politician.username, profile_pic: gameState.politician.profile_pic, role: 'Politicien', bank: gameState.politician.bank, isWinner: false });
                gameState.winners = [sortedCartels[0].username]; 
            }

            imadIo.emit('game_ended', { leaderboard: finalLeaderboard, winners: gameState.winners });
            return true;
        }
        return false;
    }

    // ==========================================
    // 3. L'ALGORITHME DE RÉSOLUTION STRICTE
    // ==========================================
    function resolveTurn() {
        let turnLogs = [];
        let pol = gameState.politician;
        let cartels = Object.values(gameState.players);

        // --- ETAPE 1 : POTS-DE-VIN ---
        cartels.forEach(c => {
            let actC = c.currentActions.c;
            if (actC && actC.amount > 0) {
                let rep = pol.currentActions.bribesResponse ? pol.currentActions.bribesResponse[c.id] : null;
                
                if (rep && rep.accepted) {
                    c.bank -= actC.amount;
                    pol.bank += actC.amount;
                    c.bribeReply = rep.reply;
                    turnLogs.push(`🤐 Un accord discret a été passé avec un Cartel.`);
                } else {
                    let loss = Math.round(actC.amount * 0.10); 
                    c.bank -= loss;
                    c.bribeReply = "Refusé catégoriquement.";
                    turnLogs.push(`❌ Un pot-de-vin a été intercepté et refusé.`);
                }
            } else {
                c.bribeReply = null;
            }
        });

        // --- ETAPE 2 : DESCENTE DE POLICE ---
        let raidTarget = pol.currentActions.raid;
        if (raidTarget) {
            pol.lastRaidTurn = gameState.turn;
            let totalSeizedValue = 0;

            cartels.forEach(c => {
                let actA = c.currentActions.a;
                if (actA && actA.type === 'sell' && actA.resource === raidTarget) {
                    let stock = c.inventory[raidTarget];
                    if (stock > 0) {
                        totalSeizedValue += stock * gameState.market[raidTarget].currentPrice;
                        c.inventory[raidTarget] = 0; 
                        c.raidedThisTurn = true; 
                        turnLogs.push(`🚨 Le Cartel de ${c.username} a subi une saisie majeure de ${gameState.market[raidTarget].name} !`);
                    }
                }
            });

            if (totalSeizedValue > 0) {
                pol.bank += Math.round(totalSeizedValue * 0.85);
            } else {
                turnLogs.push(`🚔 La police a perquisitionné la route des ${gameState.market[raidTarget].name}, mais elle était vide.`);
            }
        }

        // --- ETAPE 3 : BRAQUAGES ET PROTECTIONS ---
        let protections = {};
        cartels.forEach(c => {
            if (c.currentActions.b && c.currentActions.b.type === 'protect') {
                protections[c.id] = c.currentActions.b.resource;
            }
        });

        cartels.forEach(c => {
            let actB = c.currentActions.b;
            if (actB && actB.type === 'heist') {
                let targetCartel = gameState.players[actB.targetId];
                let targetRes = actB.resource;

                if (targetCartel) {
                    if (protections[targetCartel.id] === targetRes) {
                        turnLogs.push(`🛡️ Un braquage visant ${targetCartel.username} a été repoussé par une milice armée.`);
                    } else {
                        let availableStock = targetCartel.inventory[targetRes];
                        if (availableStock > 0) {
                            c.inventory[targetRes] += availableStock;
                            targetCartel.inventory[targetRes] = 0;
                            turnLogs.push(`🔫 Braquage réussi ! Une cargaison de ${gameState.market[targetRes].name} a été volée.`);
                        } else {
                            let penalty = Math.round(gameState.market[targetRes].currentPrice * 0.15);
                            c.bank -= penalty;
                            turnLogs.push(`📉 Un braquage a échoué (entrepôt vide). Le gang attaquant perd ${penalty}$ en frais médicaux.`);
                        }
                    }
                }
            }
        });

        // --- ETAPE 4 : PRODUCTION (ET BOOST) ---
        cartels.forEach(c => {
            let actA = c.currentActions.a;
            if (actA && actA.type === 'produce') {
                let amount = 1;
                if (c.currentActions.b && c.currentActions.b.type === 'boost') {
                    amount = 1.5;
                }
                c.inventory[actA.resource] += amount;
            }
        });

        // --- ETAPE 5 : VENTES ET DYNAMIQUE DES PRIX ---
        let sellersCount = { weapons: 0, contraband: 0, data: 0 };
        cartels.forEach(c => {
            let actA = c.currentActions.a;
            if (actA && actA.type === 'sell' && !c.raidedThisTurn && c.inventory[actA.resource] > 0) {
                sellersCount[actA.resource]++;
            }
        });

        cartels.forEach(c => {
            let actA = c.currentActions.a;
            if (actA && actA.type === 'sell' && !c.raidedThisTurn) {
                let res = actA.resource;
                let stock = c.inventory[res];
                
                if (stock > 0) {
                    let finalPrice = Math.round(gameState.market[res].currentPrice / sellersCount[res]);
                    c.bank += (stock * finalPrice);
                    c.inventory[res] = 0;
                }
            }
            delete c.raidedThisTurn; 
        });

        // --- ETAPE 6 : FIN DE TOUR ET ENVOI ---
        gameState.logs = turnLogs;

        if (!checkVictory()) {
            gameState.turn++;
            let marketEvents = generateMarketEvent();
            gameState.logs = [...marketEvents, ...gameState.logs];

            pol.isReady = false;
            pol.currentActions = { raid: null, bribesResponse: {} };
            cartels.forEach(c => {
                c.isReady = false;
                c.currentActions = { a: null, b: null, c: null };
            });

            imadIo.emit('turn_start', getPublicGameState());
        }
    }

    function getPublicGameState() {
        let publicPlayers = {};
        for(let id in gameState.players) {
            let p = gameState.players[id];
            publicPlayers[id] = { id: p.id, username: p.username, profile_pic: p.profile_pic, inventory: p.inventory, isReady: p.isReady };
        }
        return {
            turn: gameState.turn, market: gameState.market, logs: gameState.logs, publicPlayers: publicPlayers,
            polReady: gameState.politician ? gameState.politician.isReady : false, lastRaidTurn: gameState.politician ? gameState.politician.lastRaidTurn : null
        };
    }

    // ==========================================
    // 4. GESTION DES CONNEXIONS SOCKET.IO
    // ==========================================
    imadIo.on('connection', (socket) => {
        
        socket.on('join_as_cartel', (user) => {
            if (gameState.status !== 'lobby') return socket.emit('error', 'Partie déjà en cours.');
            if (Object.keys(gameState.players).length >= 3 && !gameState.players[socket.id]) return socket.emit('error', 'Les 3 Cartels sont complets.');

            gameState.players[socket.id] = {
                id: socket.id, username: user.username, profile_pic: user.profile_pic,
                bank: 0, inventory: { weapons: 0, contraband: 0, data: 0 },
                currentActions: { a: null, b: null, c: null }, isReady: false, bribeReply: null
            };
            broadcastLobbyUpdate();
        });

        socket.on('join_as_politician', (user) => {
            if (gameState.status !== 'lobby') return socket.emit('error', 'Partie déjà en cours.');
            if (gameState.politician && gameState.politician.id !== socket.id) return socket.emit('error', 'Le Politicien est déjà pris.');

            gameState.politician = {
                id: socket.id, username: user.username, profile_pic: user.profile_pic,
                bank: 0, lastRaidTurn: -99, currentActions: { raid: null, bribesResponse: {} }, isReady: false
            };
            broadcastLobbyUpdate();
        });

        socket.on('leave_role', handleDisconnect);
        socket.on('disconnect', handleDisconnect);

        function handleDisconnect() {
            if (gameState.status === 'lobby') {
                if (gameState.players[socket.id]) delete gameState.players[socket.id];
                else if (gameState.politician && gameState.politician.id === socket.id) gameState.politician = null;
                broadcastLobbyUpdate();
            }
        }

        function broadcastLobbyUpdate() {
            imadIo.emit('update_lobby', {
                cartels: Object.values(gameState.players).map(p => ({ username: p.username, profile_pic: p.profile_pic })),
                politician: gameState.politician ? { username: gameState.politician.username, profile_pic: gameState.politician.profile_pic } : null,
                canStart: Object.keys(gameState.players).length === 3 && gameState.politician !== null
            });
        }

        socket.on('start_game', () => {
            if (Object.keys(gameState.players).length === 3 && gameState.politician) {
                gameState.status = 'playing';
                gameState.turn = 1;
                gameState.logs = generateMarketEvent();
                imadIo.emit('game_started');
                imadIo.emit('turn_start', getPublicGameState());
            }
        });

        socket.on('get_private_info', () => {
            if (gameState.players[socket.id]) {
                socket.emit('private_info', { bank: gameState.players[socket.id].bank, bribeReply: gameState.players[socket.id].bribeReply });
            } else if (gameState.politician && gameState.politician.id === socket.id) {
                let bribes = [];
                Object.values(gameState.players).forEach(c => {
                    if (c.currentActions.c && c.currentActions.c.amount > 0) {
                        bribes.push({ cartelId: c.id, username: c.username, amount: c.currentActions.c.amount, question: c.currentActions.c.question });
                    }
                });
                socket.emit('private_info', { bank: gameState.politician.bank, incomingBribes: bribes });
            }
        });

        socket.on('submit_cartel_actions', (actions) => {
            if (gameState.players[socket.id] && !gameState.players[socket.id].isReady) {
                gameState.players[socket.id].currentActions = actions;
                gameState.players[socket.id].isReady = true;
                checkAllReady();
            }
        });

        socket.on('submit_politician_actions', (actions) => {
            if (gameState.politician && gameState.politician.id === socket.id && !gameState.politician.isReady) {
                gameState.politician.currentActions = actions;
                gameState.politician.isReady = true;
                checkAllReady();
            }
        });

        function checkAllReady() {
            let allCartelsReady = Object.values(gameState.players).every(p => p.isReady);
            let polReady = gameState.politician.isReady;
            imadIo.emit('turn_start', getPublicGameState());
            if (allCartelsReady && polReady) {
                resolveTurn();
            }
        }
    });
};