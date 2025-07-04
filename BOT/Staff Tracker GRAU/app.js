const { Client, GatewayIntentBits } = require('discord.js');
const mysql = require('mysql2');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config(); // Per caricare le variabili d'ambiente

// Configurazione del bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, // Necessario per fetchare i membri
    ],
});

// Configurazione del database MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD, // Carica la password dal .env
    database: 'assistenze'
});

// Mappatura degli ID consentiti per ciascun comando
const allowedUsers = {
    tempoassistenza: ['833104520191279124', '696064099309584404', '818520009725837332', '979458720713044078', '324851908261052416', '983659186044952597', '1237307512898981921', '404185281755873280', '838536188029435935'],
    resettempo: ['833104520191279124', '1242396784513384498'],
    resetall: ['833104520191279124', '1242396784513384498']
};

// ID del canale in cui inviare i log dei comandi
const logChannelId = '1293188433212211220';

// Inserisci qui gli ID dei ruoli da cui vuoi recuperare i dati
const ROLE_IDS = [
    '1022531138473971733',
    '842773063417331752',
    '828646018983133185',
    '1001247438377586830',
    '1069428924049801277',
    '930741318429319188'
];

// Definizione dei canali per ciascuna categoria
let assistenzaChannels = ['1259212724047712316', '1256980943621853295', '1072262859687473172', '1228078100059914380', '1072262866977161338', '1227716309416939640', '1232785726861742130', '1259541210390069320'];
let whitelistChannels = ['1072262844525072545', '1072262850845868102', '1231238509243924512', '1231238553095376989', '1072262866977161338', '1227716309416939640', '1232785726861742130', '1236595000142331934', '1236595046204178463', '1236595083571236904', '1236595120749674566', '1236595158712061952'];
let controlloChannels = ['1223754159660990627', '1224103902539157594', '1239597399849046147'];
let headstaffChannels = ['1247299334433935440', '1289597166989611111']; // Sostituisci con gli ID reali
let staffInRPChannels = ['1265421319584092283']; // Aggiungi questa linea

// Configura l'URL della tua applicazione web e il token segreto
const WEB_APP_URL = process.env.WEB_APP_URL; // Assicurati che questo endpoint esista nella tua applicazione web
const DISCORD_BOT_SECRET = process.env.DISCORD_BOT_SECRET; // Deve corrispondere a quello nel server.js

// Funzione per caricare utenti autorizzati dal database
function loadAllowedUsers() {
    const commands = Object.keys(allowedUsers);
    commands.forEach(command => {
        db.query('SELECT user_id FROM allowed_users WHERE command = ?', [command], (err, results) => {
            if (err) {
                console.error(`Errore nel caricamento degli utenti autorizzati per il comando ${command}:`, err);
                return;
            }
            allowedUsers[command] = results.map(row => row.user_id);
            console.log(`Caricati ${allowedUsers[command].length} utenti autorizzati per il comando ${command}.`);
        });
    });
}

db.connect((err) => {
    if (err) {
        console.error('Errore di connessione al database:', err);
        return;
    }
    console.log('Connesso al database MySQL');
    loadAllowedUsers();
});

// Oggetto per tenere traccia del tempo
const userTimes = {};

// Funzione per ottenere i ruoli e i membri
async function fetchAndSendData() {
    try {
        const guild = client.guilds.cache.first(); // Ottiene il primo server a cui il bot è connesso
        if (!guild) {
            console.error('Il bot non è connesso a nessun server.');
            return;
        }

        // Fetch dei membri del server
        await guild.members.fetch();

        const rolesData = [];

        for (const roleId of ROLE_IDS) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                const members = role.members.map((member) => ({
                    nickname: member.nickname || member.user.username,
                }));
                rolesData.push({
                    roleName: role.name,
                    members: members,
                });
            } else {
                console.warn(`Ruolo con ID ${roleId} non trovato.`);
            }
        }

        // Invia i dati alla tua applicazione web con l'header di autorizzazione
        await axios.post(WEB_APP_URL, rolesData, {
            headers: {
                Authorization: `Bearer ${DISCORD_BOT_SECRET}`,
            },
        });

        console.log('Dati inviati alla web app con successo!');
    } catch (error) {
        console.error('Errore nel fetch dei dati:', error);
    }
}

client.once('ready', () => {
    console.log(`Bot loggato come ${client.user.tag}`);

    // Esegui il fetch immediatamente all'avvio
    fetchAndSendData();

    // Pianifica il fetch ogni 5 minuti
    cron.schedule('*/5 * * * *', () => {
        console.log('Esecuzione pianificata: fetch dei dati da Discord');
        fetchAndSendData();
    });
});

client.on('voiceStateUpdate', (oldState, newState) => {
    const userId = oldState.id;

    if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
        const disconnectTime = new Date();
        const channelType = getChannelType(oldState.channelId);

        if (channelType && userTimes[userId] && userTimes[userId][oldState.channelId]) {
            const connectTime = userTimes[userId][oldState.channelId].connectTime;
            if (connectTime) {
                const timeSpent = (disconnectTime - connectTime) / 1000; // Tempo in secondi
                const timeMuted = userTimes[userId][oldState.channelId].mutedTime || 0;
                saveTimeToDatabase(userId, channelType, timeSpent, timeMuted);
                delete userTimes[userId][oldState.channelId];

                console.log(`Utente ${userId} disconnesso dal canale ${oldState.channelId}. Tempo trascorso: ${timeSpent}s.`);
            }
        }
    }

    if (newState.channelId && 
        (assistenzaChannels.includes(newState.channelId) || 
         whitelistChannels.includes(newState.channelId) || 
         controlloChannels.includes(newState.channelId) || 
         headstaffChannels.includes(newState.channelId) ||
         staffInRPChannels.includes(newState.channelId))) { // Aggiungi staffInRPChannels
        const channelType = getChannelType(newState.channelId);
        if (!userTimes[userId]) userTimes[userId] = {};
        if (!userTimes[userId][newState.channelId]) {
            userTimes[userId][newState.channelId] = { connectTime: new Date(), mutedTime: 0, lastMuteChange: new Date(), isMuted: newState.selfMute };
        } else {
            const currentTime = new Date();
            if (userTimes[userId][newState.channelId].isMuted) {
                userTimes[userId][newState.channelId].mutedTime += (currentTime - userTimes[userId][newState.channelId].lastMuteChange) / 1000;
            }
            userTimes[userId][newState.channelId].lastMuteChange = currentTime;
            userTimes[userId][newState.channelId].isMuted = newState.selfMute;
        }

        console.log(`Utente ${userId} connesso al canale ${newState.channelId}.`);
    }
});

client.on('messageCreate', (message) => {
    // Ignora i messaggi inviati dal bot stesso
    if (message.author.bot) return;

    // Funzione per verificare se l'utente è autorizzato per un comando
    function isUserAllowed(command, userId) {
        return allowedUsers[command] && allowedUsers[command].includes(userId);
    }

    // Comando !tempoassistenza
    if (message.content.startsWith('!tempoassistenza')) {
        const mentionedUser = message.mentions.users.first();
        if (!mentionedUser) {
            message.reply('Per favore, menziona un utente per verificare il tempo trascorso nei canali. Esempio: `!tempoassistenza @username`');
            return;
        }

        const userId = mentionedUser.id;

        if (!isUserAllowed('tempoassistenza', message.author.id)) {
            message.reply('Non hai il permesso di utilizzare questo comando.');
            return;
        }

        console.log(`Comando !tempoassistenza utilizzato da <@${message.author.id}> su <@${userId}>`);

        db.query('SELECT * FROM user_times WHERE user_id = ?', [userId], (err, results) => {
            if (err) {
                console.error('Errore nella query al database:', err);
                message.reply('Errore nel recupero dei dati.');
                return;
            }

            let assistenzaTime = 0;
            let whitelistTime = 0;
            let controlloTime = 0;
            let headstaffTime = 0;
            let staffInRPTime = 0; // Aggiungi questa variabile
            let assistenzaMutedTime = 0;
            let whitelistMutedTime = 0;
            let controlloMutedTime = 0;
            let headstaffMutedTime = 0;
            let staffInRPMutedTime = 0; // Aggiungi questa variabile

            results.forEach(row => {
                if (row.channel_type === 'assistenza') {
                    assistenzaTime += row.time_spent;
                    assistenzaMutedTime += row.time_muted;
                } else if (row.channel_type === 'whitelist') {
                    whitelistTime += row.time_spent;
                    whitelistMutedTime += row.time_muted;
                } else if (row.channel_type === 'controllo') {
                    controlloTime += row.time_spent;
                    controlloMutedTime += row.time_muted;
                } else if (row.channel_type === 'headstaff') {
                    headstaffTime += row.time_spent;
                    headstaffMutedTime += row.time_muted;
                } else if (row.channel_type === 'staffinrp') { // Gestisci staffinrp
                    staffInRPTime += row.time_spent;
                    staffInRPMutedTime += row.time_muted;
                }
            });

            const embed = {
                color: 0x0099ff,
                title: 'Tempo trascorso nei canali',
                author: {
                    name: 'Staff Tracker',
                    icon_url: 'https://resized-image.uwufufu.com/worldCupSelection/16905113899719678/original/logo_grau.png',
                },
                description: `Ecco il tempo trascorso negli specifici canali per <@${userId}>`,
                fields: [
                    {
                        name: 'Canali di Assistenza',
                        value: `${formatTime(assistenzaTime)} (Tempo da Mutato: ${formatTime(assistenzaMutedTime)})`,
                        inline: true,
                    },
                    {
                        name: 'Canali Whitelist',
                        value: `${formatTime(whitelistTime)} (Tempo da Mutato: ${formatTime(whitelistMutedTime)})`,
                        inline: true,
                    },
                    {
                        name: 'Canali Controllo SS',
                        value: `${formatTime(controlloTime)} (Tempo da Mutato: ${formatTime(controlloMutedTime)})`,
                        inline: true,
                    },
                    {
                        name: 'Canali Headstaff',
                        value: `${formatTime(headstaffTime)} (Tempo da Mutato: ${formatTime(headstaffMutedTime)})`,
                        inline: true,
                    },
                    {
                        name: 'Canali Staff in RP', // Nuovo campo aggiunto
                        value: `${formatTime(staffInRPTime)} (Tempo da Mutato: ${formatTime(staffInRPMutedTime)})`,
                        inline: true,
                    },
                ],
                footer: {
                    text: 'Dev by nSanity for GRAU',
                },
            };

            sendLogToChannel(`Comando !tempoassistenza utilizzato da <@${message.author.id}> su <@${userId}>`);

            message.reply({ embeds: [embed] });
        });
    }

    // Comando !daipermesso
    if (message.content.startsWith('!daipermesso')) {
        // Controlla se l'autore è autorizzato a usare !daipermesso
        if (!isUserAllowed('tempoassistenza', message.author.id)) {
            message.reply('Non hai il permesso di utilizzare questo comando.');
            return;
        }

        // Estrai l'ID Discord dal messaggio
        const args = message.content.split(' ').slice(1);
        const targetUserId = args[0];

        // Verifica che l'ID Discord sia valido
        if (!targetUserId || !/^\d{17,19}$/.test(targetUserId)) {
            message.reply('Per favore, fornisci un ID Discord valido. Esempio: `!daipermesso 123456789012345678`');
            return;
        }

        // Aggiungi l'utente alla lista autorizzata per 'tempoassistenza'
        db.query('INSERT IGNORE INTO allowed_users (command, user_id) VALUES (?, ?)', ['tempoassistenza', targetUserId], (err) => {
            if (err) {
                console.error('Errore nell\'aggiungere l\'utente autorizzato:', err);
                message.reply('Errore nell\'aggiungere l\'utente autorizzato.');
                return;
            }

            // Aggiorna la lista in memoria
            if (!allowedUsers.tempoassistenza.includes(targetUserId)) {
                allowedUsers.tempoassistenza.push(targetUserId);
            }

            message.reply(`<@${targetUserId}> è stato autorizzato ad usare il comando \`!tempoassistenza\`.`);
            sendLogToChannel(`Comando !daipermesso utilizzato da <@${message.author.id}> per autorizzare <@${targetUserId}> a usare \`!tempoassistenza\`.`);
        });
    }

    // Comando !rimuovipermesso (Opzionale)
    if (message.content.startsWith('!rimuovipermesso')) {
        // Controlla se l'autore è autorizzato a usare !rimuovipermesso
        if (!isUserAllowed('tempoassistenza', message.author.id)) {
            message.reply('Non hai il permesso di utilizzare questo comando.');
            return;
        }

        // Estrai l'ID Discord dal messaggio
        const args = message.content.split(' ').slice(1);
        const targetUserId = args[0];

        // Verifica che l'ID Discord sia valido
        if (!targetUserId || !/^\d{17,19}$/.test(targetUserId)) {
            message.reply('Per favore, fornisci un ID Discord valido. Esempio: `!rimuovipermesso 123456789012345678`');
            return;
        }

        // Rimuovi l'utente dalla lista autorizzata per 'tempoassistenza'
        db.query('DELETE FROM allowed_users WHERE command = ? AND user_id = ?', ['tempoassistenza', targetUserId], (err) => {
            if (err) {
                console.error('Errore nel rimuovere l\'utente autorizzato:', err);
                message.reply('Errore nel rimuovere l\'utente autorizzato.');
                return;
            }

            // Aggiorna la lista in memoria
            allowedUsers.tempoassistenza = allowedUsers.tempoassistenza.filter(id => id !== targetUserId);

            message.reply(`<@${targetUserId}> non è più autorizzato ad usare il comando \`!tempoassistenza\`.`);
            sendLogToChannel(`Comando !rimuovipermesso utilizzato da <@${message.author.id}> per revocare l'autorizzazione di <@${targetUserId}> a usare \`!tempoassistenza\`.`);
        });
    }

    // Comando !autorizzati
    if (message.content.startsWith('!autorizzati')) {
        // Controlla se l'autore ha permessi per vedere gli autorizzati
        if (!isUserAllowed('tempoassistenza', message.author.id)) {
            message.reply('Non hai il permesso di utilizzare questo comando.');
            return;
        }

        const authorizedUsers = allowedUsers.tempoassistenza.map(userId => `<@${userId}>`).join(', ');
        if (authorizedUsers.length === 0) {
            message.reply('Nessun utente è attualmente autorizzato ad usare `!tempoassistenza`.');
        } else {
            message.reply(`Ecco gli utenti autorizzati ad usare \`!tempoassistenza\`:\n${authorizedUsers}`);
        }
    }

    // Comando !check (se già esistente, no need to duplicate)
    // Se il comando !check è già stato aggiunto in precedenza, verifica di non duplicarlo
});

// Funzioni di supporto
function getChannelType(channelId) {
    if (assistenzaChannels.includes(channelId)) return 'assistenza';
    if (whitelistChannels.includes(channelId)) return 'whitelist';
    if (controlloChannels.includes(channelId)) return 'controllo';
    if (headstaffChannels.includes(channelId)) return 'headstaff';
    if (staffInRPChannels.includes(channelId)) return 'staffinrp'; // Aggiungi questa linea
    return null;
}

function saveTimeToDatabase(userId, channelType, timeSpent, timeMuted) {
    db.query(
        'INSERT INTO user_times (user_id, channel_type, time_spent, time_muted) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE time_spent = time_spent + ?, time_muted = time_muted + ?',
        [userId, channelType, timeSpent, timeMuted, timeSpent, timeMuted],
        (err) => {
            if (err) {
                console.error('Errore nell\'inserimento dei dati nel database:', err);
            }
        }
    );
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
}

function sendLogToChannel(logMessage) {
    const logChannel = client.channels.cache.get(logChannelId);
    if (logChannel) {
        logChannel.send(logMessage);
    } else {
        console.error('Canale di log non trovato.');
    }
}

// Login al bot in modo sicuro
client.login(process.env.DISCORD_TOKEN);
