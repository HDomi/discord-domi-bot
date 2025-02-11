// commands/cmdTeamShuffle.js
const { SlashCommandBuilder } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { getSteamUserId, getGameCount, getCurrentGameInfo } = require('../utils/steamUtils');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('스팀')
        .setDescription('스팀 게임 정보')
        .addStringOption(option => 
            option.setName('스팀아이디')
            .setDescription('스팀ID를 입력하세요')
            .setRequired(true)),
    async execute(interaction) {
        try {
            const userInput = interaction.options.getString('스팀아이디') || '기본값';
            const userId = await getSteamUserId(userInput);
            const gameCount = await getGameCount(userId);
            const pubgInfo = await getCurrentGameInfo(userId, 578080);
            const guguduckInfo = await getCurrentGameInfo(userId, 1568590);
            const embed = new EmbedBuilder()
                .setColor(0x426cf5)
                .setTitle(`당신의 스팀정보`)
                .addFields(
                    { name: `스팀아이디`, value: userInput },
                    { name: '보유 게임 수', value: String(gameCount) },
                    { name: '---------------------------------------', value: '<배그>' },
                    { name: '플레이 시간', value: pubgInfo.playTime},
                    { name: '최근 플레이 날짜', value: pubgInfo.lastPlayed},
                    { name: '---------------------------------------', value: '<구구덕>' },
                    { name: '플레이 시간', value: guguduckInfo.playTime},
                    { name: '최근 플레이 날짜', value: guguduckInfo.lastPlayed},
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