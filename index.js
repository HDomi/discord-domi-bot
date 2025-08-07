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

client.once(Events.ClientReady, async readyClient => {
    console.log(`${readyClient.user.tag} 실행완료`);
    
    // Discord Player 초기화
    try {
        const musicCommand = client.commands.get('노래');
        if (musicCommand && musicCommand.initializePlayer) {
            await musicCommand.initializePlayer(client);
            console.log('Discord Player 초기화 완료');
        }
    } catch (error) {
        console.error('Discord Player 초기화 실패:', error);
    }
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
    // 봇 메시지는 무시
    if (message.author.bot) return;

    // DM 메시지 처리 (밴픽 시스템)
    if (!message.guild) {
        await handleBanpickDM(message);
        return;
    }

    // 욕설 필터링 (길드 메시지만) - 현재 비활성화
    // if (message.guild && fWordCollector(message.content)) {
    //     message.reply('욕하지 마세염!');
    // }

    // 길드 메시지 로깅
    if (!log[message.channelId]) {
        log[message.channelId] = [];
    }
    log[message.channelId].push({ author: message.author.username, content: message.content });
});

// 밴픽 DM 처리 함수
async function handleBanpickDM(message) {
    console.log(`[DM 수신] ${message.author.tag}로부터 DM 수신: "${message.content}"`)
    
    const { EmbedBuilder } = require('discord.js');
    const leagueCommand = client.commands.get('리그');
    
    // 사용자가 속한 모든 길드를 검사하여 활성 밴픽 세션 찾기
    for (const guild of client.guilds.cache.values()) {
        try {
            console.log(`[DM 처리] 길드 ${guild.name}의 밴픽 세션 확인 중...`)
            // Firebase에서 밴픽 세션 가져오기
            const session = await leagueCommand.getBanpickSession(guild.id);
            if (!session || !session.isActive) {
                console.log(`[DM 처리] 길드 ${guild.name}: 활성 세션 없음`)
                continue;
            }
            
            console.log(`[DM 처리] 길드 ${guild.name}: 활성 밴픽 세션 발견`)
            
            // 메시지 보낸 사용자가 해당 세션의 팀장인지 확인
            const teamNames = Object.keys(session.teams);
            let userTeam = null;
            
            console.log(`[DM 처리] 팀장 확인 중... 팀: ${teamNames.join(', ')}`)
            
            for (const teamName of teamNames) {
                console.log(`[DM 처리] ${teamName} 팀장: ${session.teams[teamName].captain}, DM 보낸 사용자: ${message.author.id}`)
                if (session.teams[teamName].captain === message.author.id) {
                    userTeam = teamName;
                    break;
                }
            }
            
            if (!userTeam) {
                console.log(`[DM 처리] ${message.author.tag}는 이 세션의 팀장이 아님`)
                continue;
            }
            
            console.log(`[DM 처리] ${message.author.tag}는 "${userTeam}" 팀의 팀장으로 확인됨`)
            
            // 이미 밴픽을 입력했는지 확인
            if (session.banpicks.has(userTeam)) {
                console.log(`[DM 처리] ${userTeam} 팀은 이미 밴픽을 입력함`)
                await message.reply('⚠️ 이미 밴픽을 입력하셨습니다.');
                continue;
            }
            
            // 밴픽 등록 (Firebase 기반)
            const banpick = message.content.trim();
            console.log(`[DM 처리] ${userTeam} 팀의 밴픽 "${banpick}" 등록 중...`)
            const banpickCount = await leagueCommand.addBanpick(guild.id, userTeam, banpick);
            console.log(`[DM 처리] 밴픽 등록 완료. 현재 밴픽 수: ${banpickCount}/2`)
            
            await message.reply(`✅ "${banpick}"이(가) 밴픽으로 등록되었습니다!`);
            
            try {
                // 원래 채널에 진행 상황 업데이트
                const channel = guild.channels.cache.get(session.channelId);
                
                // 최신 세션 데이터를 다시 가져와서 정확한 밴픽 수 확인
                const updatedSession = await leagueCommand.getBanpickSession(guild.id);
                
                const progressEmbed = new EmbedBuilder()
                    .setColor(0x426cf5)
                    .setTitle('⚔️ 밴픽 대기 중')
                    .setDescription('팀장들이 개인 메시지에서 밴픽을 입력하고 있습니다.')
                    .addFields(
                        { name: '대결 팀', value: `**${teamNames[0]}** vs **${teamNames[1]}**` },
                        { name: '진행 상태', value: `📤 DM 발송 완료\n⏳ 밴픽 입력 대기 중... (${banpickCount}/2)` }
                    )
                    .setFooter({ text: '각 팀장은 개인 메시지에서 밴픽을 입력해주세요.' });
                
                // 채널에서 최근 메시지를 찾아서 업데이트
                const messages = await channel.messages.fetch({ limit: 10 });
                const botMessage = messages.find(msg => 
                    msg.author.id === client.user.id && 
                    msg.embeds.length > 0 && 
                    msg.embeds[0].title?.includes('밴픽')
                );
                
                if (botMessage) {
                    await botMessage.edit({ embeds: [progressEmbed], components: [] });
                }
                
                // 2명 모두 밴픽을 입력했으면 결과 표시
                if (banpickCount === 2) {
                    // 세션을 비활성화로 업데이트
                    await leagueCommand.updateBanpickSession(guild.id, { isActive: false });
                    
                    // 3초 카운트다운
                    for (let countdown = 3; countdown > 0; countdown--) {
                        const countdownEmbed = new EmbedBuilder()
                            .setColor(0xffaa00)
                            .setTitle('⚔️ 밴픽 완료!')
                            .setDescription(`밴픽이 완료되었습니다. ${countdown}초 후 결과를 표시합니다...`)
                            .addFields(
                                { name: '대결 팀', value: `**${teamNames[0]}** vs **${teamNames[1]}**` }
                            );
                        
                        if (botMessage) {
                            await botMessage.edit({ embeds: [countdownEmbed], components: [] });
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    
                    // 최종 결과 표시 (최신 밴픽 데이터 가져오기)
                    const finalSession = await leagueCommand.getBanpickSession(guild.id);
                    const resultEmbed = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('🎉 밴픽 결과 발표!')
                        .setDescription('양 팀의 밴픽이 완료되었습니다.')
                        .addFields(
                            ...teamNames.map(teamName => ({
                                name: `${teamName} 팀 밴픽`,
                                value: `🚫 **${finalSession.banpicks.get(teamName)}**`,
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
                    
                    if (botMessage) {
                        await botMessage.edit({ 
                            embeds: [resultEmbed], 
                            components: [backButton] 
                        });
                    }
                    
                    // 세션 정리 (Firebase 기반)
                    await leagueCommand.removeBanpickSession(guild.id);
                }
                
            } catch (error) {
                console.error('Error updating banpick progress:', error);
            }
            
            break; // 한 세션에서 처리되면 다른 길드는 확인하지 않음
            
        } catch (error) {
            console.error(`Error processing banpick session for guild ${guild.id}:`, error);
            continue; // 에러가 발생한 길드는 건너뛰고 다음 길드 확인
        }
    }
}

client.on('interactionCreate', async interaction => {
    // 슬래시 커맨드 처리
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
        return;
    }

    // 버튼 처리 (노래 삭제 관련)
    if (interaction.isButton()) {
        const customId = interaction.customId;
        
        try {
            const musicCommand = client.commands.get('노래');
            if (!musicCommand) return;

            // 노래 선택/해제 토글 버튼
            if (customId.startsWith('toggle_song_')) {
                const parts = customId.split('_');
                const guildId = parts[2];
                const songIndex = parseInt(parts[3]);
                
                // 현재 임베드에서 선택된 노래들 추출
                const embed = interaction.message.embeds[0];
                const fields = embed.fields || [];
                let selectedSongs = [];
                
                // 각 필드에서 ✅ 상태인 노래들의 인덱스 추출
                fields.forEach(field => {
                    if (field.value.includes('✅')) {
                        // 필드 이름에서 번호 추출 (예: "1번" -> 0)
                        const match = field.name.match(/(\d+)번/);
                        if (match) {
                            const index = parseInt(match[1]) - 1;
                            selectedSongs.push(index);
                        }
                    }
                });
                
                // 현재 페이지 정보 읽어오기
                const footer = embed.footer?.text || '';
                const pageMatch = footer.match(/페이지 (\d+)\/(\d+)/);
                const currentPage = pageMatch ? parseInt(pageMatch[1]) - 1 : 0;
                
                // 토글 처리
                if (selectedSongs.includes(songIndex)) {
                    selectedSongs = selectedSongs.filter(index => index !== songIndex);
                } else {
                    selectedSongs.push(songIndex);
                }
                
                // 페이지 다시 표시
                const queueData = await musicCommand.getQueueData(guildId);
                await musicCommand.showRemovePage(interaction, queueData, currentPage, selectedSongs);
                return;
            }

            // 이전 페이지 버튼
            if (customId.startsWith('remove_prev_')) {
                const parts = customId.split('_');
                const guildId = parts[2];
                const currentPage = parseInt(parts[3]);
                const selectedSongs = parts[4] ? parts[4].split(',').map(Number).filter(n => !isNaN(n)) : [];
                
                const queueData = await musicCommand.getQueueData(guildId);
                await musicCommand.showRemovePage(interaction, queueData, currentPage - 1, selectedSongs);
                return;
            }

            // 다음 페이지 버튼
            if (customId.startsWith('remove_next_')) {
                const parts = customId.split('_');
                const guildId = parts[2];
                const currentPage = parseInt(parts[3]);
                const selectedSongs = parts[4] ? parts[4].split(',').map(Number).filter(n => !isNaN(n)) : [];
                
                const queueData = await musicCommand.getQueueData(guildId);
                await musicCommand.showRemovePage(interaction, queueData, currentPage + 1, selectedSongs);
                return;
            }

            // 삭제 실행 버튼
            if (customId.startsWith('execute_remove_')) {
                const parts = customId.split('_');
                const guildId = parts[2];
                const selectedSongs = parts[3] ? parts[3].split(',').map(Number).filter(n => !isNaN(n)) : [];
                
                if (selectedSongs.length === 0) {
                    await interaction.reply({
                        content: '❌ 선택된 노래가 없습니다.',
                        ephemeral: true
                    });
                    return;
                }

                const result = await musicCommand.removeMultipleSongsFromQueue(guildId, selectedSongs);
                
                if (result.success) {
                    const embed = {
                        color: 0xff0000,
                        title: '🗑️ 노래가 삭제되었습니다',
                        description: `**${result.removedCount}곡**이 삭제되었습니다.\n\n남은 노래: ${result.remainingSongs}곡`,
                        fields: result.removedSongs.slice(0, 5).map((song, index) => ({
                            name: `삭제된 노래 ${index + 1}`,
                            value: `**${song.title}** - ${song.uploader}`,
                            inline: false
                        })),
                        timestamp: new Date().toISOString()
                    };

                    if (result.removedCount > 5) {
                        embed.fields.push({
                            name: '기타',
                            value: `외 ${result.removedCount - 5}곡이 더 삭제되었습니다.`,
                            inline: false
                        });
                    }

                    await interaction.update({
                        embeds: [embed],
                        components: []
                    });
                } else {
                    await interaction.reply({
                        content: `❌ 노래 삭제 중 오류가 발생했습니다: ${result.error}`,
                        ephemeral: true
                    });
                }
                return;
            }

            // 취소 버튼
            if (customId.startsWith('cancel_remove_')) {
                const embed = {
                    color: 0x999999,
                    title: '❌ 노래 삭제가 취소되었습니다',
                    description: '삭제 작업이 취소되었습니다.',
                    timestamp: new Date().toISOString()
                };

                await interaction.update({
                    embeds: [embed],
                    components: []
                });
                return;
            }

        } catch (error) {
            console.error('버튼 처리 오류:', error);
            await interaction.reply({
                content: '❌ 처리 중 오류가 발생했습니다.',
                ephemeral: true
            });
        }
        return;
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