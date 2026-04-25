// ==========================================
// GESTION DE L'INTERFACE
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function toggleProfileEdit() {
    const box = document.getElementById('profile-edit-box');
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
}

function showMessage(elementId, text) {
    const el = document.getElementById(elementId);
    el.innerText = text;
    setTimeout(() => el.innerText = '', 4000);
}

// ==========================================
// APPELS FETCH (API)
// ==========================================

// 1. Vérifier si on est déjà connecté au chargement de la page
async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        
        if (data.loggedIn) {
            document.getElementById('user-name').innerText = data.user.username;
            document.getElementById('user-avatar').src = data.user.profile_pic || 'https://via.placeholder.com/60/0ac8b9/000000?text=?';
            showScreen('dashboard-section');
        } else {
            showScreen('auth-section');
        }
    } catch (err) {
        console.error("Erreur de connexion au serveur", err);
    }
}

// 2. Inscription
document.getElementById('btn-register').addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) return showMessage('auth-error', 'Remplissez les deux champs.');

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (data.success) {
        showMessage('auth-success', data.message + ' Connectez-vous maintenant !');
    } else {
        showMessage('auth-error', data.message);
    }
});

// 3. Connexion
document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault(); // Empêche la page de se rafraîchir
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (data.success) {
        checkAuth(); // Recharge le profil et affiche le dashboard
    } else {
        showMessage('auth-error', data.message);
    }
});

// 4. Déconnexion
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    checkAuth();
}

// 5. Modifier l'avatar
async function updateProfilePic() {
    const newUrl = document.getElementById('new-avatar-url').value;
    if (!newUrl) return;

    const response = await fetch('/api/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_pic: newUrl })
    });
    const data = await response.json();

    if (data.success) {
        document.getElementById('user-avatar').src = newUrl;
        toggleProfileEdit();
    }
}

// Lancement au démarrage
checkAuth();