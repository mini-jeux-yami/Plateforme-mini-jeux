const Database = require('better-sqlite3');
const db = new Database('arcade.db');

// On récupère les mots tapés après "node reset-game-score.js"
const args = process.argv.slice(2);
const gameName = args.join(' ');

// Si aucun nom n'est fourni, on liste les jeux disponibles
if (!gameName) {
    console.log("❌ Erreur : Tu dois préciser le nom exact du jeu à réinitialiser entre guillemets.");
    console.log("\n--- JEUX ACTUELLEMENT DANS LA BASE DE DONNÉES ---");
    
    const games = db.prepare('SELECT DISTINCT game_name FROM victories').all();
    if (games.length === 0) {
        console.log("  (Aucun jeu n'a de victoire enregistrée pour le moment)");
    } else {
        games.forEach(g => console.log(`  - "${g.game_name}"`));
    }
    
    console.log("\n💡 Exemple de commande à taper :");
    console.log("node reset-game-score.js \"Le Contrebandier\"");
    process.exit(1);
}

// On supprime uniquement les victoires du jeu spécifié
const info = db.prepare('DELETE FROM victories WHERE game_name = ?').run(gameName);

if (info.changes > 0) {
    console.log(`✅ SUCCÈS ! Le leaderboard du jeu "${gameName}" a été entièrement vidé (${info.changes} victoires supprimées).`);
} else {
    console.log(`⚠️ ATTENTION : Aucun score trouvé pour le jeu "${gameName}". Vérifie bien l'orthographe (majuscules/espaces) en relançant le script sans paramètre.`);
}