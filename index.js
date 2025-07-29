// 1. 주요 클래스 가져오기
const { Client, Events, Collection, GatewayIntentBits, Routes } = require('discord.js');
const { fWordCollector } = require('./utils/fWordCollector');
const { REST } = require('@discordjs/rest');
const fs = require('node:fs');
const path = require('node:path');
const queue = new Map();
const log = new Map();
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const rest = new REST({ version: '10' }).setToken(token);

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, // 멤버 정보 접근을 위해 추가
    GatewayIntentBits.MessageContent,
]});

client.once(Events.ClientReady, readyClient => {
console.log(`${readyClient.user.tag} 실행완료`);
});

module.exports = { queue, log };

//명령어 처리부분
const commands = [];
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
}

client.on('messageCreate', (message) => {
    if (fWordCollector(message.content)) {
        message.reply('욕하지 마세염!');
    }
    if (message.author.bot) return false;

    if (!log[message.channelId]) {
        log[message.channelId] = [];
    }
    log[message.channelId].push({ author: message.author.username, content: message.content });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// and deploy your commands!
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();

client.login(token);