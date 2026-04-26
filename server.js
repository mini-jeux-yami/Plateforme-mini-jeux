const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==============================================================================
// 1. CONFIGURATION ET MIDDLEWARES
// ==============================================================================
app.use(express.json());
app.use(session({
    secret: 'arcade-secret-key-pour-les-potes',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, req.session.user.username + '_' + Date.now() + ext);
    }
});
const upload = multer({ storage: storage });

// ✨ NOUVEAU : L'INTERCEPTEUR GLOBAL HTML ✨
// Ce code lit chaque page HTML demandée et injecte le chat automatiquement !
app.use((req, res, next) => {
    // Si on demande la racine (/) ou un fichier .html (n'importe où dans les sous-dossiers)
    if (req.path === '/' || req.path.endsWith('.html')) {
        const filePath = req.path === '/' ? '/index.html' : req.path;
        const absolutePath = path.join(__dirname, filePath);
        
        if (fs.existsSync(absolutePath)) {
            let content = fs.readFileSync(absolutePath, 'utf8');
            
            // Si c'est bien une page web et qu'on n'a pas encore injecté le chat
            if (content.includes('</body>') && !content.includes('chat-client.js')) {
                // On glisse le script juste avant la fin
                content = content.replace('</body>', '<script src="/socket.io/socket.io.js"></script>\n<script src="/chat-client.js"></script>\n</body>');
            }
            
            res.send(content); // On envoie la page trafiquée
            return; 
        }
    }
    next(); // Si c'est une image, du CSS, etc., on laisse passer normalement
});

app.use(express.static(__dirname)); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS game_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        game_name TEXT NOT NULL,
        stat_type TEXT NOT NULL,
        stat_value INTEGER DEFAULT 0
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
        res.status(400).json({ success: false, message: 'Ce pseudo est déjà pris.' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    if (user) { req.session.user = user; res.json({ success: true, user: { username: user.username, profile_pic: user.profile_pic } }); } 
    else res.status(401).json({ success: false, message: 'Identifiants incorrects.' });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        const user = db.prepare('SELECT username, profile_pic FROM users WHERE id = ?').get(req.session.user.id);
        res.json({ loggedIn: true, user: user });
    } else res.json({ loggedIn: false });
});

app.get('/api/users', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    const users = db.prepare("SELECT username, profile_pic FROM users WHERE username != ?").all(req.session.user.username);
    res.json({ success: true, users });
});

app.post('/api/update-profile', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    db.prepare('UPDATE users SET profile_pic = ? WHERE id = ?').run(req.body.profile_pic, req.session.user.id);
    res.json({ success: true });
});

app.post('/api/upload-avatar', upload.single('avatarFile'), (req, res) => {
    if (!req.session.user || !req.file) return res.status(400).json({ success: false });
    const profilePicPath = '/uploads/' + req.file.filename;
    db.prepare('UPDATE users SET profile_pic = ? WHERE id = ?').run(profilePicPath, req.session.user.id);
    res.json({ success: true, profile_pic: profilePicPath });
});

app.post('/api/add-victory', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    const { game_name, game_url } = req.body;
    const row = db.prepare('SELECT * FROM victories WHERE username = ? AND game_name = ?').get(req.session.user.username, game_name);
    if (row) db.prepare('UPDATE victories SET wins = wins + 1, game_url = ? WHERE id = ?').run(game_url, row.id);
    else db.prepare('INSERT INTO victories (username, game_name, game_url, wins) VALUES (?, ?, ?, 1)').run(req.session.user.username, game_name, game_url);
    res.json({ success: true });
});

app.post('/api/save-stats', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    const { game_name, stats } = req.body;
    
    const insertStmt = db.prepare('INSERT INTO game_stats (username, game_name, stat_type, stat_value) VALUES (?, ?, ?, ?)');
    const updateStmt = db.prepare('UPDATE game_stats SET stat_value = stat_value + ? WHERE username = ? AND game_name = ? AND stat_type = ?');
    const checkStmt = db.prepare('SELECT * FROM game_stats WHERE username = ? AND game_name = ? AND stat_type = ?');

    stats.forEach(stat => {
        const row = checkStmt.get(req.session.user.username, game_name, stat.type);
        if (row) updateStmt.run(stat.value, req.session.user.username, game_name, stat.type);
        else insertStmt.run(req.session.user.username, game_name, stat.type, stat.value);
    });
    
    res.json({ success: true });
});

app.get('/api/leaderboards', (req, res) => {
    const data = db.prepare(`SELECT v.game_name, v.game_url, v.username, v.wins, u.profile_pic FROM victories v JOIN users u ON v.username = u.username ORDER BY v.game_name, v.wins DESC`).all();
    res.json({ success: true, data: data });
});

// ==============================================================================
// 4. LE CHAT GLOBAL
// ==========================================
const chatIo = io.of('/chat');
let onlineUsers = {}; 

chatIo.on('connection', (socket) => {
    socket.on('register', (username) => {
        if (!username) return;
        onlineUsers[username] = socket.id;
        socket.username = username;
        const unreadMsgs = db.prepare("SELECT sender, COUNT(*) as count FROM messages WHERE receiver = ? AND is_read = 0 GROUP BY sender").all(username);
        socket.emit('unread_data', unreadMsgs);
        chatIo.emit('users_online', Object.keys(onlineUsers)); 
    });

    socket.on('get_history', (contact) => {
        const history = db.prepare(`SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY timestamp ASC`).all(socket.username, contact, contact, socket.username);
        socket.emit('chat_history', { contact, history });
        db.prepare("UPDATE messages SET is_read = 1 WHERE sender = ? AND receiver = ?").run(contact, socket.username);
        socket.emit('messages_read_confirmed', contact);
    });

    socket.on('send_message', (data) => {
        const { receiver, content } = data;
        const sender = socket.username;
        const safeContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
        const info = db.prepare("INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)").run(sender, receiver, safeContent);
        const newMsg = { id: info.lastInsertRowid, sender, receiver, content: safeContent, timestamp: new Date().toISOString() };
        
        socket.emit('receive_message', newMsg); 
        if (onlineUsers[receiver]) chatIo.to(onlineUsers[receiver]).emit('receive_message', newMsg); 
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            chatIo.emit('users_online', Object.keys(onlineUsers));
        }
    });
});

require('./mamine/mamine-server.js')(io);
require('./imad/imad-server.js')(io);
require('./anas/Enchere/enchere-server.js')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur Arcade lancé sur le port ${PORT}`));
