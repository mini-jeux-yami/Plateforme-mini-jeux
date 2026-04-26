(function initGlobalChat() {
    // 1. Injection IMMÉDIATE de l'interface (plus aucun délai d'apparition !)
    const chatHTML = `
        <div id="global-chat-btn" onclick="toggleChatModal()" style="display:none;">
            <i class="fa-solid fa-message"></i>
            <span id="global-unread-badge" style="display:none;">0</span>
        </div>

        <div id="global-chat-modal" style="display:none;">
            <div class="chat-header">
                <h3><i class="fa-solid fa-satellite-dish"></i> TRANSMISSIONS SECRÈTES</h3>
                <button onclick="toggleChatModal()" class="close-chat"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="chat-body">
                <div class="chat-sidebar">
                    <ul id="chat-user-list"></ul>
                </div>
                
                <div class="chat-main" id="chat-main-area">
                    <div id="chat-placeholder" style="color: #94a3b8; text-align: center; margin-top: 100px;">
                        <i class="fa-solid fa-user-secret" style="font-size:40px; margin-bottom:15px; opacity:0.5;"></i><br>
                        Sélectionnez un contact pour démarrer une transmission.
                    </div>
                    
                    <div id="chat-conversation" style="display:none;">
                        <div id="chat-history"></div>
                        <div class="chat-input-area">
                            <input type="text" id="chat-message-input" placeholder="Tapez votre message..." onkeypress="handleChatEnter(event)">
                            <button onclick="sendChatMessage()"><i class="fa-solid fa-paper-plane"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    // Si le chat n'est pas déjà sur la page, on l'ajoute
    if (!document.getElementById('global-chat-btn')) {
        document.body.insertAdjacentHTML('beforeend', chatHTML);
    }

    // 2. Chargement des données en arrière-plan
    async function loadChatData() {
        try {
            const authRes = await fetch('/api/me');
            const authData = await authRes.json();
            
            if (!authData.loggedIn) return; // On laisse le chat caché si non connecté

            // Le joueur est connecté, on affiche le bouton !
            document.getElementById('global-chat-btn').style.display = 'flex';

            const myUsername = authData.user.username;
            let currentChatContact = null;
            let unreadCounts = {};

            const usersRes = await fetch('/api/users');
            const usersData = await usersRes.json();
            const userListEl = document.getElementById('chat-user-list');

            function renderUserList(onlineUsersList = []) {
                userListEl.innerHTML = usersData.users.map(u => {
                    const isOnline = onlineUsersList.includes(u.username);
                    const unread = unreadCounts[u.username] || 0;
                    return `
                        <li onclick="openChatWith('${u.username}')" class="${currentChatContact === u.username ? 'active-contact' : ''}">
                            <div class="chat-avatar-container">
                                <img src="${u.profile_pic || 'https://via.placeholder.com/40/0ac8b9/000000'}" class="chat-avatar" onerror="this.onerror=null; this.src='https://via.placeholder.com/40/0ac8b9/000000';">
                                <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                            </div>
                            <span class="chat-username">${u.username}</span>
                            ${unread > 0 ? `<span class="chat-unread-pill">${unread}</span>` : ''}
                        </li>
                    `;
                }).join('');
            }
            renderUserList();

            // 3. Connexion Socket.io pour le chat
            const chatSocket = io('/chat');
            chatSocket.emit('register', myUsername);

            chatSocket.on('users_online', (onlineUsersList) => renderUserList(onlineUsersList));

            chatSocket.on('unread_data', (data) => {
                let totalUnread = 0;
                data.forEach(d => { unreadCounts[d.sender] = d.count; totalUnread += d.count; });
                updateTotalBadge(totalUnread);
                renderUserList();
            });

            chatSocket.on('chat_history', (data) => {
                const historyEl = document.getElementById('chat-history');
                historyEl.innerHTML = data.history.map(msg => buildMessageHTML(msg, myUsername)).join('');
                historyEl.scrollTop = historyEl.scrollHeight;
            });

            chatSocket.on('receive_message', (msg) => {
                if (currentChatContact === msg.sender || currentChatContact === msg.receiver) {
                    document.getElementById('chat-history').insertAdjacentHTML('beforeend', buildMessageHTML(msg, myUsername));
                    const historyEl = document.getElementById('chat-history');
                    historyEl.scrollTop = historyEl.scrollHeight;
                    if (msg.sender !== myUsername) chatSocket.emit('get_history', msg.sender);
                } else {
                    if (msg.sender !== myUsername) {
                        unreadCounts[msg.sender] = (unreadCounts[msg.sender] || 0) + 1;
                        updateTotalBadge();
                        renderUserList();
                    }
                }
            });

            chatSocket.on('messages_read_confirmed', (contact) => {
                unreadCounts[contact] = 0;
                updateTotalBadge();
                renderUserList();
            });

            // Fonctions attachées à Window pour être accessibles par le HTML
            window.toggleChatModal = function() {
                const modal = document.getElementById('global-chat-modal');
                modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
            };

            window.openChatWith = function(username) {
                currentChatContact = username;
                document.getElementById('chat-placeholder').style.display = 'none';
                document.getElementById('chat-conversation').style.display = 'flex';
                document.getElementById('chat-history').innerHTML = '<p style="text-align:center; color:#94a3b8; margin-top:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Déchiffrement...</p>';
                chatSocket.emit('get_history', username);
                renderUserList(); 
            };

            window.sendChatMessage = function() {
                const input = document.getElementById('chat-message-input');
                const content = input.value.trim();
                if (content && currentChatContact) {
                    chatSocket.emit('send_message', { receiver: currentChatContact, content: content });
                    input.value = '';
                }
            };

            window.handleChatEnter = function(e) {
                if (e.key === 'Enter') window.sendChatMessage();
            };

            function buildMessageHTML(msg, me) {
                const isMe = msg.sender === me;
                return `
                    <div class="chat-msg ${isMe ? 'msg-me' : 'msg-them'}">
                        <div class="msg-content">${msg.content}</div>
                        <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                    </div>
                `;
            }

            function updateTotalBadge() {
                let total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
                const badge = document.getElementById('global-unread-badge');
                badge.innerText = total;
                badge.style.display = total > 0 ? 'flex' : 'none';
            }

        } catch (error) {
            console.error("Erreur d'initialisation du chat global :", error);
        }
    }

    // Lancement
    loadChatData();
})();