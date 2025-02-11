// commands/cmdTeamShuffle.js
const { SlashCommandBuilder } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { getSteamUserId, getHasGame, getCurrentGameInfo, getTimeAndMinutes } = require('../utils/steamUtils');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('스팀')
        .setDescription('스팀 게임 정보')
        .addStringOption(option => 
            option.setName('스팀아이디')
            .setDescription('스팀 커뮤니티 ID를 입력하세요(내 프로필 누르면 상단 주소)')
            .setRequired(true)),
    async execute(interaction) {
        try {
            const userInput = interaction.options.getString('스팀아이디') || '기본값';
            const userId = await getSteamUserId(userInput);
            if (!userId) {
                await interaction.reply({ content: '존재하지 않거나 비공개 처리된 스팀 아이디입니다.', ephemeral: true });
                return;
            }
            const hasGame = await getHasGame(userId);
            // const pubgInfo = await getCurrentGameInfo(userId, 578080);
            const getTop3Game = () => {
                const top3Game = hasGame.sort((a, b) => b.playTime - a.playTime).slice(0, 3);
                return top3Game.map(game => {
                    return {
                        name: game.gameName,
                        value: `${getTimeAndMinutes(game.playTime)} (${game.lastPlayed})`
                    }
                })
            }
            const embed = new EmbedBuilder()
                .setColor(0x426cf5)
                .setTitle(`당신의 스팀정보`)
                .addFields(
                    { name: `스팀아이디`, value: userInput },
                    { name: '보유 게임 수', value: String(hasGame.length) },
                    { name: '---------------------------------------', value: '<Play Top3 Game>' },
                    ...getTop3Game(),
                    // { name: '---------------------------------------', value: '<배그>' },
                )
                .setTimestamp();
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('오류 발생:', error);
            await interaction.reply({ content: '오류가 발생했습니다. 다시 시도해주세요.', ephemeral: true });
        }
    }
};