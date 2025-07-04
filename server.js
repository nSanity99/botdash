// server.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const sharedSession = require('express-socket.io-session');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const cors = require('cors'); // Aggiunto per gestire CORS

const app = express();
const port = 3000; // Usa la porta che preferisci

// Creazione del server HTTP e dell'istanza di Socket.io
const server = http.createServer(app);
const io = socketIo(server);

// Configurazione del database MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',       // Sostituisci con il tuo utente MySQL
    password: '', // Sostituisci con la tua password MySQL
    database: 'bot_management'     // Assicurati che questo database esist
});
// Connessione al database
db.connect((err) => {
    if (err) {
        console.error('Errore di connessione al database:', err);
        process.exit(1);
    }
    console.log('Connesso al database MySQL');
});

// Middleware per la gestione delle sessioni
const sessionMiddleware = session({
    secret: 'il_tuo_segreto_sessione', // Sostituisci con un segreto sicuro
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,  // Imposta a true se usi HTTPS
        httpOnly: false // Necessario per consentire a Socket.io di accedere al cookie
    }
});

// Applicazione del middleware delle sessioni a Express
app.use(sessionMiddleware);

// Condivisione del middleware delle sessioni con Socket.io
io.use(sharedSession(sessionMiddleware, {
    autoSave: true
}));

// Middleware per gestire CORS
app.use(cors({
    origin: 'http://localhost:3000', // Sostituisci con l'URL del tuo frontend se diverso
    credentials: true
}));

// Applicazione del rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minuti
    max: 100, // Limita ogni IP a 100 richieste per windowMs
    message: 'Troppe richieste da questo IP, riprova più tardi.'
});
app.use(limiter);

// Middleware per analizzare i corpi delle richieste
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Definisci le cartelle dei bot
const botDirectories = {
    'nSanity': path.join(__dirname, 'BOT'),
    'Chapo': path.join(__dirname, 'BOT CHAPO')
};

// Middleware per servire file statici
app.use(express.static(path.join(__dirname, 'public')));

// Middleware per controllare l'autenticazione
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    } else {
        res.status(401).json({ error: 'Non autenticato' });
    }
}

// Oggetto per tracciare i processi dei bot
const botProcesses = {};

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Nuova connessione Socket.io');

    // Log dettagliato della sessione per il debug
    console.log('Sessione Socket.io:', socket.handshake.session);

    // Identificazione utente tramite sessione
    const session = socket.handshake.session;
    if (!session || !session.user) {
        console.log('Socket.io connection non autenticato');
        socket.disconnect(true);
        return;
    }

    // Ascolta i comandi inviati dal client
    socket.on('command', ({ botName, command, category }) => {
        const botKey = `${category}:${botName}`;
        const botProcess = botProcesses[botKey]?.process;
        if (botProcess) {
            botProcess.stdin.write(`${command}\n`);
        } else {
            socket.emit('output', { botName, data: 'Il bot non è in esecuzione.\n', category });
        }
    });

    socket.on('disconnect', () => {
        console.log('Connessione Socket.io disconnessa');
    });
});

// API per il login
app.post('/api/login', [
    body('username').trim().notEmpty().withMessage('Username richiesto'),
    body('password').notEmpty().withMessage('Password richiesta')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array() });
    }

    const { username, password } = req.body;

    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], (err, results) => {
        if (err) {
            console.error('Errore nella query del database:', err);
            return res.status(500).json({ error: 'Errore del server' });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        const user = results[0];

        // Confronta la password inserita con l'hash memorizzato
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                console.error('Errore nel confronto delle password:', err);
                return res.status(500).json({ error: 'Errore del server' });
            }

            if (isMatch) {
                req.session.user = { id: user.id, username: user.username };
                // Salva la sessione prima di inviare la risposta
                req.session.save((err) => {
                    if (err) {
                        console.error('Errore nel salvataggio della sessione:', err);
                        return res.status(500).json({ error: 'Errore del server' });
                    }
                    res.json({ message: 'Login riuscito' });
                });
            } else {
                res.status(401).json({ error: 'Credenziali non valide' });
            }
        });
    });
});

// API per la registrazione
app.post('/api/register', [
    body('username').trim().notEmpty().withMessage('Username richiesto').isAlphanumeric().withMessage('Username deve essere alfanumerico'),
    body('password').notEmpty().withMessage('Password richiesta').isLength({ min: 6 }).withMessage('Password deve avere almeno 6 caratteri')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array() });
    }

    const { username, password } = req.body;

    // Verifica se l'utente esiste già
    const checkQuery = 'SELECT * FROM users WHERE username = ?';
    db.query(checkQuery, [username], (err, results) => {
        if (err) {
            console.error('Errore nella query di verifica del database:', err);
            return res.status(500).json({ error: 'Errore del server' });
        }

        if (results.length > 0) {
            return res.status(409).json({ error: 'Username già in uso' });
        }

        // Hash della password
        const saltRounds = 10;
        bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) {
                console.error('Errore nell\'hashing della password:', err);
                return res.status(500).json({ error: 'Errore del server' });
            }

            // Inserimento dell'utente nel database
            const insertQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
            db.query(insertQuery, [username, hash], (err, results) => {
                if (err) {
                    console.error('Errore nell\'inserimento dell\'utente:', err);
                    return res.status(500).json({ error: 'Errore del server' });
                }

                // Imposta la sessione
                req.session.user = { id: results.insertId, username: username };
                // Salva la sessione prima di inviare la risposta
                req.session.save((err) => {
                    if (err) {
                        console.error('Errore nel salvataggio della sessione:', err);
                        return res.status(500).json({ error: 'Errore del server' });
                    }
                    res.json({ message: 'Registrazione riuscita' });
                });
            });
        });
    });
});

// API per il logout
app.post('/api/logout', isAuthenticated, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Errore nella distruzione della sessione:', err);
            return res.status(500).json({ error: 'Errore nel logout' });
        }
        res.json({ message: 'Logout riuscito' });
    });
});

// API per ottenere la lista dei bot - Protetta
app.get('/api/bots', isAuthenticated, (req, res) => {
    const category = req.query.category || 'nSanity'; // Default a 'nSanity' se non specificato
    const botsDirectory = botDirectories[category];

    if (!botsDirectory) {
        return res.status(400).json({ error: 'Categoria non valida' });
    }

    fs.readdir(botsDirectory, { withFileTypes: true }, (err, files) => { 
        if (err) {
            return res.status(500).json({ error: "Errore nella lettura della directory" });
        }

        // Filtra solo le directory (che rappresentano i bot)
        const botFolders = files
            .filter(file => file.isDirectory())
            .map(folder => folder.name);

        res.json(botFolders);
    });
});

// API per ottenere lo stato di tutti i bot - Protetta
app.get('/api/bot-status', isAuthenticated, (req, res) => {
    const category = req.query.category || 'nSanity'; // Default a 'nSanity' se non specificato
    const botsDirectory = botDirectories[category];

    if (!botsDirectory) {
        return res.status(400).json({ error: 'Categoria non valida' });
    }

    fs.readdir(botsDirectory, { withFileTypes: true }, (err, files) => { 
        if (err) {
            return res.status(500).json({ error: "Errore nella lettura della directory" });
        }

        const botFolders = files
            .filter(file => file.isDirectory())
            .map(folder => folder.name);

        const statusList = botFolders.map(botName => {
            const botKey = `${category}:${botName}`;
            return {
                botName,
                status: botProcesses[botKey] ? 'In esecuzione' : 'Stop'
            };
        });

        res.json(statusList);
    });
});

// API per avviare un bot - Protetta
app.post('/api/start-bot', isAuthenticated, (req, res) => {
    const { name, category } = req.body;
    const botsDirectory = botDirectories[category || 'nSanity'];

    if (!botsDirectory) {
        return res.status(400).json({ error: 'Categoria non valida' });
    }

    const botName = name;
    const botPath = path.join(botsDirectory, botName, 'start.bat');

    if (!fs.existsSync(botPath)) {
        return res.status(404).json({ error: "File start.bat non trovato" });
    }

    const botKey = `${category}:${botName}`;

    if (botProcesses[botKey]) {
        return res.status(400).json({ error: "Il bot è già in esecuzione" });
    }

    // Avvia il bot utilizzando spawn
    const botProcess = spawn('cmd.exe', ['/c', botPath], {
        cwd: path.join(botsDirectory, botName),
        stdio: ['pipe', 'pipe', 'pipe']
    });

    botProcesses[botKey] = { process: botProcess, category };

    // Invia l'output del bot tramite Socket.io
    botProcess.stdout.on('data', (data) => {
        io.emit('output', { botName, data: data.toString(), category });
    });

    botProcess.stderr.on('data', (data) => {
        io.emit('output', { botName, data: data.toString(), category });
    });

    botProcess.on('close', (code) => {
        io.emit('output', { botName, data: `\nIl bot ${botName} si è chiuso con codice ${code}.\n`, category });
        delete botProcesses[botKey];
        // Invia lo stato aggiornato del bot
        io.emit('status', { botName, status: 'Stop', category });
    });

    // Invia lo stato aggiornato del bot
    io.emit('status', { botName, status: 'In esecuzione', category });

    res.json({ message: `Bot ${botName} avviato!`, pid: botProcess.pid });
});

// API per riavviare un bot - Protetta
app.post('/api/restart-bot', isAuthenticated, (req, res) => {
    const { name, category } = req.body;
    const botsDirectory = botDirectories[category || 'nSanity'];

    if (!botsDirectory) {
        return res.status(400).json({ error: 'Categoria non valida' });
    }

    const botName = name;
    const botPath = path.join(botsDirectory, botName, 'start.bat');

    if (!fs.existsSync(botPath)) {
        return res.status(404).json({ error: "File start.bat non trovato" });
    }

    const botKey = `${category}:${botName}`;

    if (!botProcesses[botKey]) {
        return res.status(400).json({ error: "Il bot non è in esecuzione" });
    }

    // Termina il processo esistente
    try {
        process.kill(botProcesses[botKey].process.pid, 'SIGTERM');
        delete botProcesses[botKey];
        // Invia lo stato aggiornato del bot
        io.emit('status', { botName, status: 'Stop', category });
    } catch (error) {
        console.error(`Errore nella terminazione del bot ${botName}:`, error);
        return res.status(500).json({ error: "Errore nella terminazione del bot" });
    }

    // Avvia nuovamente il bot
    const botProcess = spawn('cmd.exe', ['/c', botPath], {
        cwd: path.join(botsDirectory, botName),
        stdio: ['pipe', 'pipe', 'pipe']
    });

    botProcesses[botKey] = { process: botProcess, category };

    // Invia l'output del bot tramite Socket.io
    botProcess.stdout.on('data', (data) => {
        io.emit('output', { botName, data: data.toString(), category });
    });

    botProcess.stderr.on('data', (data) => {
        io.emit('output', { botName, data: data.toString(), category });
    });

    botProcess.on('close', (code) => {
        io.emit('output', { botName, data: `\nIl bot ${botName} si è chiuso con codice ${code}.\n`, category });
        delete botProcesses[botKey];
        // Invia lo stato aggiornato del bot
        io.emit('status', { botName, status: 'Stop', category });
    });

    // Invia lo stato aggiornato del bot
    io.emit('status', { botName, status: 'In esecuzione', category });

    res.json({ message: `Bot ${botName} riavviato!`, pid: botProcess.pid });
});

// Serviamo la pagina HTML principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Avvio del server
server.listen(port, () => {
    console.log(`Server avviato su http://localhost:${port}`);
});
