// commands/cmdLeague.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js')
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, update } = require('firebase/database');
const firebaseConfig = require('../config/firebaseConfig');

// Firebase 앱 초기화
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

/**
 * 길드의 리그 데이터를 Firebase에서 가져오는 함수
 * @param {string} guildId - 길드 ID
 * @returns {Promise<Map<string, object>>} - 리그 팀 데이터
 */
async function getLeagueData(guildId) {
    const dbRef = ref(database, `leagues/${guildId}/teams`);
    const snapshot = await get(dbRef);
    if (snapshot.exists()) {
        const teamsData = snapshot.val();
        // Firebase에서 받은 객체를 Map으로 변환하고, members가 없는 경우 빈 Set으로 초기화
        return new Map(Object.entries(teamsData).map(([teamName, teamData]) => {
            return [teamName, { ...teamData, members: new Set(teamData.members || []) }];
        }));
    }
    return new Map();
}

/**
 * 팀 데이터를 Firebase에 저장하는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} teamName - 팀 이름
 * @param {object} teamData - 저장할 팀 데이터
 */
async function setTeamData(guildId, teamName, teamData) {
    // Set을 Array로 변환하여 저장
    const dataToSave = {
        ...teamData,
        members: Array.from(teamData.members)
    };
    await set(ref(database, `leagues/${guildId}/teams/${teamName}`), dataToSave);
}

/**
 * 팀 데이터를 Firebase에서 삭제하는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} teamName - 팀 이름
 */
async function removeTeamData(guildId, teamName) {
    await remove(ref(database, `leagues/${guildId}/teams/${teamName}`));
}

/**
 * 모든 팀 데이터를 Firebase에서 삭제하는 함수
 * @param {string} guildId - 길드 ID
 */
async function removeAllTeams(guildId) {
    await remove(ref(database, `leagues/${guildId}/teams`));
}

/**
 * 팀 점수를 업데이트하는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} teamName - 팀 이름
 * @param {number} scoreChange - 점수 변경량
 */
async function updateTeamScore(guildId, teamName, scoreChange) {
    const teamRef = ref(database, `leagues/${guildId}/teams/${teamName}/score`);
    const snapshot = await get(teamRef);
    const currentScore = snapshot.val() || 0;
    await set(teamRef, currentScore + scoreChange);
}

/**
 * 메인 메뉴 임베드를 생성하는 함수
 * @param {string} guildName - 길드 이름
 * @returns {EmbedBuilder} - 메인 메뉴 임베드
 */
function createMainMenuEmbed(guildName) {
    return new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle('🏆 리그 관리 시스템')
        .setDescription(`${guildName}의 리그를 관리합니다.`)
        .addFields(
            { name: '👥 팀 관리', value: '팀 생성, 삭제, 초기화', inline: true },
            { name: '📊 점수 관리', value: '점수 추가, 차감', inline: true },
            { name: '🔊 팀 이동', value: '음성채널로 팀 이동', inline: true },
            { name: '📋 팀 목록', value: '모든 팀 정보 확인', inline: true }
        )
        .setTimestamp()
}

/**
 * 메인 메뉴 버튼을 생성하는 함수
 * @returns {ActionRowBuilder} - 메인 메뉴 버튼
 */
function createMainMenuButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('team_management')
                .setLabel('👥 팀 관리')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('score_management')
                .setLabel('📊 점수 관리')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('team_movement')
                .setLabel('🔊 팀 이동')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('team_list')
                .setLabel('📋 팀 목록')
                .setStyle(ButtonStyle.Secondary)
        )
}

/**
 * 팀 관리 메뉴 임베드를 생성하는 함수
 * @returns {EmbedBuilder} - 팀 관리 메뉴 임베드
 */
function createTeamManagementEmbed() {
    return new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle('👥 팀 관리')
        .setDescription('팀을 생성하거나 삭제할 수 있습니다.')
        .addFields(
            { name: '➕ 팀 생성', value: '새로운 팀을 만듭니다', inline: true },
            { name: '❌ 팀 삭제', value: '기존 팀을 삭제합니다', inline: true },
            { name: '🗑️ 전체 초기화', value: '모든 팀을 삭제합니다', inline: true }
        )
        .setTimestamp()
}

/**
 * 팀 관리 메뉴 버튼을 생성하는 함수
 * @param {boolean} hasTeams - 팀이 있는지 여부
 * @returns {ActionRowBuilder} - 팀 관리 메뉴 버튼
 */
function createTeamManagementButtons(hasTeams) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_team')
                .setLabel('➕ 팀 생성')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('edit_team')
                .setLabel('✏️ 팀 편집')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('delete_team')
                .setLabel('❌ 팀 삭제')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('reset_all_teams')
                .setLabel('🗑️ 전체 초기화')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('back_to_main')
                .setLabel('🔙 메인으로')
                .setStyle(ButtonStyle.Secondary)
        )
}

/**
 * 팀 편집 메뉴 임베드를 생성하는 함수
 * @param {string} teamName - 팀 이름
 * @param {Map} teams - 팀 데이터
 * @returns {EmbedBuilder} - 팀 편집 메뉴 임베드
 */
function createTeamEditEmbed(teamName, teams) {
    const teamData = teams.get(teamName)
    if (!teamData) {
        return new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ 오류')
            .setDescription('팀 정보를 찾을 수 없습니다.')
    }

    const memberList = Array.from(teamData.members).map(userId => `<@${userId}>`).join(', ') || '없음'
    const voiceChannel = teamData.voiceChannelId ? `<#${teamData.voiceChannelId}>` : '설정 안됨'

    return new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle(`✏️ "${teamName}" 팀 편집`)
        .setDescription('수행할 작업을 선택하세요.')
        .addFields(
            { name: '현재 점수', value: `${teamData.score}점` },
            { name: '현재 멤버', value: memberList },
            { name: '현재 음성채널', value: voiceChannel }
        )
        .setTimestamp()
}

/**
 * 팀 편집 메뉴 버튼을 생성하는 함수
 * @param {string} teamName - 팀 이름
 * @returns {ActionRowBuilder} - 팀 편집 메뉴 버튼
 */
function createTeamEditButtons(teamName) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_name_${teamName}`)
                .setLabel('이름 변경')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`manage_members_${teamName}`)
                .setLabel('멤버 관리')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`edit_channel_${teamName}`)
                .setLabel('채널 변경')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('team_management')
                .setLabel('🔙 팀 관리로')
                .setStyle(ButtonStyle.Secondary)
        )
}

/**
 * 팀 목록 임베드를 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @returns {EmbedBuilder} - 팀 목록 임베드
 */
function createTeamListEmbed(teams) {
    const embed = new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle('📋 팀 목록')
        .setTimestamp()

    if (teams.size === 0) {
        embed.setDescription('등록된 팀이 없습니다.')
        return embed
    }

    let description = ''
    teams.forEach((teamData, teamName) => {
        const memberList = Array.from(teamData.members).map(userId => `<@${userId}>`).join(', ')
        const voiceChannel = teamData.voiceChannelId ? `<#${teamData.voiceChannelId}>` : '설정 안됨'
        description += `**${teamName}** (점수: ${teamData.score})\n`
        description += `멤버: ${memberList || '없음'}\n`
        description += `음성채널: ${voiceChannel}\n\n`
    })

    embed.setDescription(description)
    return embed
}

/**
 * 점수 관리 메뉴 임베드를 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @returns {EmbedBuilder} - 점수 관리 메뉴 임베드
 */
function createScoreManagementEmbed(teams) {
    const embed = new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle('📊 점수 관리')
        .setDescription('팀의 점수를 추가하거나 차감할 수 있습니다.')
        .setTimestamp()

    if (teams.size === 0) {
        embed.addFields({ name: '⚠️ 알림', value: '등록된 팀이 없습니다. 먼저 팀을 생성해주세요.' })
        return embed
    }

    let scoreInfo = ''
    teams.forEach((teamData, teamName) => {
        scoreInfo += `**${teamName}**: ${teamData.score}점\n`
    })

    embed.addFields({ name: '현재 점수', value: scoreInfo })
    return embed
}

/**
 * 점수 관리 메뉴 버튼을 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @returns {ActionRowBuilder} - 점수 관리 메뉴 버튼
 */
function createScoreManagementButtons(teams) {
    const row = new ActionRowBuilder()
    
    if (teams.size > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('add_score')
                .setLabel('➕ 점수 추가')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('subtract_score')
                .setLabel('➖ 점수 차감')
                .setStyle(ButtonStyle.Danger)
        )
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('back_to_main')
            .setLabel('🔙 메인으로')
            .setStyle(ButtonStyle.Secondary)
    )

    return row
}

/**
 * 팀 선택 드롭다운을 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @param {string} customId - 커스텀 ID
 * @param {string} placeholder - 플레이스홀더 텍스트
 * @returns {ActionRowBuilder} - 팀 선택 드롭다운
 */
function createTeamSelectMenu(teams, customId, placeholder) {
    const options = Array.from(teams.keys()).map(teamName => ({
        label: teamName,
        value: teamName,
        description: `점수: ${teams.get(teamName).score}점`
    }))

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder(placeholder)
                .addOptions(options)
        )
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('리그')
        .setDescription('리그용 커맨드입니다.'),
    
    async execute(interaction) {
        if (!interaction.guild) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ 오류')
                .setDescription('이 명령어는 서버에서만 사용할 수 있습니다.')
                .setTimestamp()
            
            return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        }

        // 1. Deprecated `fetchReply` 옵션 제거 및 최신 방식으로 변경
        await interaction.reply({ 
            embeds: [createMainMenuEmbed(interaction.guild.name)], 
            components: [createMainMenuButtons()]
        });
        const reply = await interaction.fetchReply(); // 메시지 객체를 별도로 가져옴

        // 2. 특정 메시지에 대한 수집기 생성 (이전과 동일)
        const collector = reply.createMessageComponentCollector({ 
            filter: i => i.user.id === interaction.user.id, 
            time: 600000 // 10분
        });

        collector.on('collect', async i => {
            if (!i.guild) { return; }
            
            await i.deferUpdate();

            const currentTeams = await getLeagueData(i.guild.id);
            
            try {
                // ... (버튼 핸들러들은 대부분 동일하게 유지)

                // 3. StringSelectMenu 핸들러 로직 재구성 및 단순화
                if (i.isStringSelectMenu()) {
                    const selectedValue = i.values[0];

                    // 팀 편집 선택
                    if (i.customId === 'edit_team_select') {
                        const editEmbed = createTeamEditEmbed(selectedValue, currentTeams);
                        const editButtons = createTeamEditButtons(selectedValue);
                        await i.editReply({ embeds: [editEmbed], components: [editButtons] });
                    }
                    // 팀 삭제 선택
                    else if (i.customId === 'delete_team_select') {
                        await removeTeamData(i.guild.id, selectedValue);
                        const updatedTeams = await getLeagueData(i.guild.id);
                        const embed = createTeamManagementEmbed();
                        embed.setDescription(`✅ 팀 "${selectedValue}"이(가) 성공적으로 삭제되었습니다.`);
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(updatedTeams.size > 0)] });
                    }
                    // 팀 이동 선택
                    else if (i.customId === 'move_team_select') {
                        const teamData = currentTeams.get(selectedValue);
                        if (!teamData || !teamData.voiceChannelId) {
                            await i.followUp({ content: `⚠️ 팀 "${selectedValue}"에 음성채널이 설정되지 않았습니다.`, ephemeral: true });
                            return;
                        }
                        if (!i.member.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
                             await i.followUp({ content: '⚠️ 멤버 이동 권한이 없습니다.', ephemeral: true });
                             return;
                        }

                        const targetChannel = i.guild.channels.cache.get(teamData.voiceChannelId);
                        if (!targetChannel) {
                            await i.followUp({ content: '⚠️ 설정된 음성채널을 찾을 수 없습니다.', ephemeral: true });
                            return;
                        }
                        
                        let movedCount = 0;
                        for (const memberId of teamData.members) {
                            try {
                                const member = await i.guild.members.fetch(memberId);
                                if (member && member.voice.channel) {
                                    await member.voice.setChannel(targetChannel);
                                    movedCount++;
                                }
                            } catch { /* 멤버를 찾지 못하는 등 오류는 무시 */ }
                        }
                        await i.followUp({ content: `🔊 팀 "${selectedValue}"의 멤버 ${movedCount}명을 <#${targetChannel.id}> 채널로 이동시켰습니다.`, ephemeral: true });
                    }
                    // 멤버 제외 선택
                    else if (i.customId.startsWith('remove_members_')) {
                        const teamName = i.customId.replace('remove_members_', '');
                        const teamData = currentTeams.get(teamName);
                        if (teamData) {
                            i.values.forEach(userId => teamData.members.delete(userId));
                            await setTeamData(i.guild.id, teamName, teamData);
                        }
                        const updatedTeams = await getLeagueData(i.guild.id);
                        const embed = createTeamManagementEmbed();
                        embed.setDescription(`✅ "${teamName}" 팀에서 선택된 멤버가 제외되었습니다.`);
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(updatedTeams.size > 0)] });
                    }
                    // 점수 관리 선택
                    else if (i.customId.endsWith('_score_team_select')) {
                        // ... 점수 관리 로직 ...
                    }
                }
                
                // ... (UserSelect, ChannelSelect 핸들러)

            } catch (error) {
                // ... (에러 핸들링)
            }
        });

        // 4. 만료 처리 로직 (이전과 동일)
        collector.on('end', () => {
            // ...
        });
    }
};
