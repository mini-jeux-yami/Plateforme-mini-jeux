const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==============================================================================
// 1. CONFIGURATION ET MIDDLEWARES
// ==============================================================================
app.use(express.json());

app.use(session({
    secret: 'arcade-secret-key-pour-les-potes',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.use(express.static(__dirname)); 

// ==============================================================================
// 2. BASE DE DONNÉES SQLite (arcade.db)
// ==============================================================================
const db = new Database('arcade.db', { verbose: console.log });

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        profile_pic TEXT DEFAULT '/asset/default.png'
    );

    CREATE TABLE IF NOT EXISTS victories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        game_name TEXT NOT NULL,
        game_url TEXT NOT NULL,
        wins INTEGER DEFAULT 0
    );
`);

// ==============================================================================
// 3. ROUTES API GLOBALES DE L'ARCADE
// ==============================================================================
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    try {
        const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        stmt.run(username, password);
        res.json({ success: true, message: 'Compte créé avec succès !' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ success: false, message: 'Ce pseudo est déjà pris.' });
        } else {
            res.status(500).json({ success: false, message: 'Erreur serveur.' });
        }
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
    const user = stmt.get(username, password);

    if (user) {
        req.session.user = user;
        res.json({ success: true, user: { username: user.username, profile_pic: user.profile_pic } });
    } else {
        res.status(401).json({ success: false, message: 'Identifiants incorrects.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        const stmt = db.prepare('SELECT username, profile_pic FROM users WHERE id = ?');
        const user = stmt.get(req.session.user.id);
        res.json({ loggedIn: true, user: user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/update-profile', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Non connecté.' });
    const { profile_pic } = req.body;
    const stmt = db.prepare('UPDATE users SET profile_pic = ? WHERE id = ?');
    stmt.run(profile_pic, req.session.user.id);
    res.json({ success: true });
});

// NOUVELLE ROUTE : Enregistrer une victoire
app.post('/api/add-victory', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Non connecté.' });
    const { game_name, game_url } = req.body;
    const username = req.session.user.username;

    // Vérifie si le joueur a déjà gagné à ce jeu
    const row = db.prepare('SELECT * FROM victories WHERE username = ? AND game_name = ?').get(username, game_name);
    
    if (row) {
        // Il a déjà gagné avant, on fait +1
        db.prepare('UPDATE victories SET wins = wins + 1, game_url = ? WHERE id = ?').run(game_url, row.id);
    } else {
        // C'est sa première victoire à ce jeu !
        db.prepare('INSERT INTO victories (username, game_name, game_url, wins) VALUES (?, ?, ?, 1)').run(username, game_name, game_url);
    }
    
    res.json({ success: true });
});

// NOUVELLE ROUTE : Récupérer les classements de victoires
app.get('/api/leaderboards', (req, res) => {
    const stmt = db.prepare(`
        SELECT v.game_name, v.game_url, v.username, v.wins, u.profile_pic
        FROM victories v
        JOIN users u ON v.username = u.username
        ORDER BY v.game_name, v.wins DESC
    `);
    res.json({ success: true, data: stmt.all() });
});

// ==============================================================================
// 4. DELEGATION DES JEUX (Architecture Modulaire)
// ==============================================================================
require('./mamine/mamine-server.js')(io);

// ==============================================================================
// 5. LANCEMENT DU SERVEUR
// ==============================================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur Arcade lancé sur le port ${PORT}`));