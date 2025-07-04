const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Comando !creafaz
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!creafaz')) {
        const args = message.content.split(' ').slice(1);
        const descrizione = args[0];
        const userId = args[1];

        // ID del ruolo che può usare il comando
        const allowedRoleId = '1014962496584556635';

        // Controllare se l'autore del comando ha il ruolo permesso
        const hasPermission = message.member.roles.cache.some(role => role.id === allowedRoleId);
        if (!hasPermission) {
            message.channel.send("Non hai il permesso di usare questo comando.");
            return;
        }

        if (!descrizione || !userId) {
            message.channel.send("Usa il comando come segue: `!creafaz [Nome Fazione] [ID Discord]`");
            return;
        }

        const member = await message.guild.members.fetch(userId);
        if (!member) {
            message.channel.send(`Non è stato trovato alcun membro con l'ID ${userId}.`);
            return;
        }

        // ID del ruolo esistente a cui vogliamo dare accesso
        const existingRoleId = '1014962496584556635';
        const existingRole = message.guild.roles.cache.get(existingRoleId);

        // Creare il ruolo della fazione
        const newRole = await message.guild.roles.create({
            name: `🔪 | Fazione ${descrizione}`,
            reason: 'Creazione del ruolo fazione',
        });

        // Assegnare il ruolo alla persona
        await member.roles.add(newRole);

        // Creare il ruolo "Boss [Descrizione]" e assegnarlo al membro
        const bossRole = await message.guild.roles.create({
            name: `Boss ${descrizione}`,
            reason: 'Creazione del ruolo Boss',
        });
        await member.roles.add(bossRole);

        // Creare la categoria e i canali con permessi specifici
        const category = await message.guild.channels.create({
            name: descrizione,
            type: 4, // 4 indica un canale di tipo "category"
            permissionOverwrites: [
                {
                    id: message.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: newRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: existingRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: bossRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                }
            ]
        });

        // Creare canali testuali all'interno della categoria
        await message.guild.channels.create({
            name: 'convalida',
            type: 0, // 0 indica un canale testuale
            parent: category.id,
        });

        await message.guild.channels.create({
            name: 'da convalidare',
            type: 0, // Canale testuale
            parent: category.id,
        });

        // Canale "aggiungi fazionato" con permessi specifici
        const aggiungiChannel = await message.guild.channels.create({
            name: 'aggiungi fazionato',
            type: 0, // Canale testuale
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: bossRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                }
            ]
        });

        // Creare il canale "check" visibile a chi ha il ruolo della fazione
        await message.guild.channels.create({
            name: 'check',
            type: 0, // Canale testuale
            permissionOverwrites: [
                {
                    id: message.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: newRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                }
            ]
        });

        // Invia un messaggio nel canale "aggiungi fazionato"
        aggiungiChannel.send("Per aggiungere il ruolo ad un tuo fazionato devi usare il comando `!ruolo [ID DISCORD]`, es: `!ruolo 1237307512898981921`. Così facendo il tuo fazionato potrà vedere i canali convalide.");

        // Conferma dell'operazione
        message.channel.send(`Categoria "${descrizione}" e i ruoli "Boss ${descrizione}" e "Fazione ${descrizione}" sono stati creati e assegnati a ${member}.`);
    }
});

// Comando !ruolo
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!ruolo')) {
        const args = message.content.split(' ').slice(1);
        const userId = args[0];

        if (!userId) {
            message.channel.send("Devi specificare un ID Discord.");
            return;
        }

        const member = await message.guild.members.fetch(userId);
        if (!member) {
            message.channel.send(`Non è stato trovato alcun membro con l'ID ${userId}.`);
            return;
        }

        // Verificare se l'autore ha un ruolo che inizia con "Boss "
        const bossRole = message.member.roles.cache.find(role => role.name.startsWith('Boss '));
        if (!bossRole) {
            message.channel.send("Non hai il permesso di usare questo comando.");
            return;
        }

        const descrizione = bossRole.name.substring(5); // Rimuove "Boss " dal nome del ruolo
        const roleName = `🔪 | Fazione ${descrizione}`;
        const roleToAssign = message.guild.roles.cache.find(role => role.name === roleName);

        if (roleToAssign) {
            await member.roles.add(roleToAssign);
            message.channel.send(`Ruolo '${roleName}' assegnato a ${member}.`);
        } else {
            message.channel.send(`Non è stato trovato alcun ruolo con il nome '${roleName}'.`);
        }
    }
});

// Comando !inviacheck
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!inviacheck')) {
        const checkMessage = "Spunta per il Check settimanale. ✔";

        // Trova tutti i canali chiamati "check"
        const checkChannels = message.guild.channels.cache.filter(channel => channel.name === 'check' && channel.type === 0); // 0 indica un canale testuale

        // Invia il messaggio in ciascun canale "check"
        for (const channel of checkChannels.values()) {
            await channel.send(checkMessage);
        }

        message.channel.send("Messaggio inviato a tutti i canali 'check'.");
    }
});

// Effettua il login del bot
client.login('MTI0NTY3MjA1MDgxMTQ3Mzk3Mw.Gwc_YR.CDf0TlKrIt5B9GHeSTImybx8406AU1tJwmOmS8');
