// addUser.js

const mysql = require('mysql2');
const bcrypt = require('bcrypt');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',       // Sostituisci con il tuo utente MySQL
    password: 'elchapodizona02@', // Sostituisci con la tua password MySQL
    database: 'bot_management',      // Assicurati che questo database esista
    port: 3307
});

db.connect((err) => {
    if (err) {
        console.error('Errore di connessione al database:', err);
        process.exit(1);
    }
    console.log('Connesso al database MySQL');
});

// Parametri dell'utente da creare
const username = 'admin';          // Sostituisci con il nome utente desiderato
const password = 'password123';    // Sostituisci con la password desiderata
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
        console.error('Errore nell\'hashing della password:', err);
        return;
    }

    const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(query, [username, hash], (err, results) => {
        if (err) {
            console.error('Errore nell\'inserimento dell\'utente:', err);
            return;
        }
        console.log('Utente creato con successo');
        db.end();
    });
});
