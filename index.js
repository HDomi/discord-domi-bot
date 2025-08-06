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
    GatewayIntentBits.DirectMessages, // DM 처리를 위해 추가
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

client.on('messageCreate', async (message) => {
    return;
    // 욕설 필터링 (길드 메시지만)
    if (message.guild && fWordCollector(message.content)) {
        message.reply('욕하지 마세염!');
    }
    
    if (message.author.bot) return false;

    // DM 메시지 처리 (밴픽 시스템)
    if (!message.guild) {
        await handleBanpickDM(message);
        return;
    }

    // 길드 메시지 로깅
    if (!log[message.channelId]) {
        log[message.channelId] = [];
    }
    log[message.channelId].push({ author: message.author.username, content: message.content });
});

// 밴픽 DM 처리 함수
async function handleBanpickDM(message) {
    const { EmbedBuilder } = require('discord.js');
    const leagueCommand = client.commands.get('리그');
    const banpickSessions = leagueCommand.banpickSessions;
    
    // 활성 밴픽 세션이 있는지 확인
    for (const [guildId, session] of banpickSessions) {
        if (!session.isActive) continue;
        
        // 메시지 보낸 사용자가 해당 세션의 팀장인지 확인
        const teamNames = Object.keys(session.teams);
        let userTeam = null;
        
        for (const teamName of teamNames) {
            if (session.teams[teamName].captain === message.author.id) {
                userTeam = teamName;
                break;
            }
        }
        
        if (!userTeam) continue;
        
        // 이미 밴픽을 입력했는지 확인
        if (session.banpicks.has(userTeam)) {
            await message.reply('⚠️ 이미 밴픽을 입력하셨습니다.');
            continue;
        }
        
        // 밴픽 등록
        const banpick = message.content.trim();
        session.banpicks.set(userTeam, banpick);
        
        await message.reply(`✅ "${banpick}"이(가) 밴픽으로 등록되었습니다!`);
        
        try {
            // 원래 채널에 진행 상황 업데이트
            const guild = client.guilds.cache.get(guildId);
            const channel = guild.channels.cache.get(session.channelId);
            
            const progressEmbed = new EmbedBuilder()
                .setColor(0x426cf5)
                .setTitle('⚔️ 밴픽 대기 중')
                .setDescription('팀장들이 개인 메시지에서 밴픽을 입력하고 있습니다.')
                .addFields(
                    { name: '대결 팀', value: `**${teamNames[0]}** vs **${teamNames[1]}**` },
                    { name: '진행 상태', value: `📤 DM 발송 완료\n⏳ 밴픽 입력 대기 중... (${session.banpicks.size}/2)` }
                )
                .setFooter({ text: '각 팀장은 개인 메시지에서 밴픽을 입력해주세요.' });
            
            await session.originalInteraction.editReply({ embeds: [progressEmbed], components: [] });
            
            // 2명 모두 밴픽을 입력했으면 결과 표시
            if (session.banpicks.size === 2) {
                session.isActive = false;
                
                // 3초 카운트다운
                for (let countdown = 3; countdown > 0; countdown--) {
                    const countdownEmbed = new EmbedBuilder()
                        .setColor(0xffaa00)
                        .setTitle('⚔️ 밴픽 완료!')
                        .setDescription(`밴픽이 완료되었습니다. ${countdown}초 후 결과를 표시합니다...`)
                        .addFields(
                            { name: '대결 팀', value: `**${teamNames[0]}** vs **${teamNames[1]}**` }
                        );
                    
                    await session.originalInteraction.editReply({ embeds: [countdownEmbed], components: [] });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                // 최종 결과 표시
                const resultEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('🎉 밴픽 결과 발표!')
                    .setDescription('양 팀의 밴픽이 완료되었습니다.')
                    .addFields(
                        ...teamNames.map(teamName => ({
                            name: `${teamName} 팀 밴픽`,
                            value: `🚫 **${session.banpicks.get(teamName)}**`,
                            inline: true
                        }))
                    )
                    .setTimestamp();
                
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back_to_main')
                            .setLabel('🔙 메인으로')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                await session.originalInteraction.editReply({ 
                    embeds: [resultEmbed], 
                    components: [backButton] 
                });
                
                // 세션 정리
                banpickSessions.delete(guildId);
            }
            
        } catch (error) {
            console.error('Error updating banpick progress:', error);
        }
        
        break; // 한 세션에서 처리되면 다른 세션은 확인하지 않음
    }
}

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