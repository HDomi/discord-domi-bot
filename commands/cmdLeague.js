// commands/cmdLeague.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js')
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, update } = require('firebase/database');
const firebaseConfig = require('../config/firebaseConfig');

// Firebase 앱 초기화
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// 밴픽 설정 상태 관리 (메모리에 임시 저장)
const banpickSessions = new Map(); // guildId -> { users: Map, usedTeams: Set, isActive: boolean }

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
        return new Map(Object.entries(teamsData).map(([teamName, teamData]) => {
            return [teamName, { 
                ...teamData, 
                members: new Set(teamData.members || []),
                captain: teamData.captain || null // 팀장 필드 추가
            }];
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
            { name: '👥 팀 관리', value: '팀 생성, 편집, 삭제, 초기화', inline: true },
            { name: '📊 점수 관리', value: '점수 추가, 차감', inline: true },
            { name: '🔊 팀 이동', value: '음성채널로 팀 이동', inline: true },
            { name: '⚔️ 밴픽설정', value: '대표 선수 밴픽 설정', inline: true },
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
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('banpick_setup')
                .setLabel('⚔️ 밴픽설정')
                .setStyle(ButtonStyle.Primary),
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
        .setDescription('팀을 생성, 편집, 삭제할 수 있습니다.')
        .setTimestamp()
}

/**
 * 팀 관리 메뉴 버튼을 생성하는 함수
 * @returns {ActionRowBuilder} - 팀 관리 메뉴 버튼
 */
function createTeamManagementButtons() {
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
 * 점수 관리 메뉴 임베드를 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @returns {EmbedBuilder} - 점수 관리 메뉴 임베드
 */
function createScoreManagementEmbed(teams) {
    const embed = new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle('📊 점수 관리')
        .setDescription('팀을 선택하여 점수를 관리할 수 있습니다.')
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
                .setCustomId('score_change')
                .setLabel('🎯 점수 변경')
                .setStyle(ButtonStyle.Primary)
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
 * 팀 선택 드롭다운 메뉴를 생성하는 함수
 * @param {Map} teams - 팀 데이터
 * @param {string} customId - 커스텀 ID
 * @param {string} placeholder - 플레이스홀더
 * @returns {ActionRowBuilder} - 팀 선택 메뉴
 */
function createTeamSelectMenu(teams, customId, placeholder) {
    const options = Array.from(teams.keys()).map(teamName => ({
        label: teamName,
        value: teamName,
        description: `점수: ${teams.get(teamName).score}점, 멤버: ${teams.get(teamName).members.size}명`
    }))

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder(placeholder)
                .addOptions(options)
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
    const captain = teamData.captain ? `<@${teamData.captain}>` : '설정 안됨'

    return new EmbedBuilder()
        .setColor(0x426cf5)
        .setTitle(`✏️ "${teamName}" 팀 편집`)
        .setDescription('수정할 항목을 선택하세요.')
        .addFields(
            { name: '현재 점수', value: `${teamData.score}점` },
            { name: '현재 팀장', value: captain },
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
                .setCustomId(`set_captain_${teamName}`)
                .setLabel('팀장 설정')
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
        const captain = teamData.captain ? `<@${teamData.captain}>` : '설정 안됨'
        description += `**${teamName}** (점수: ${teamData.score})\n`
        description += `팀장: ${captain}\n`
        description += `멤버: ${memberList || '없음'}\n`
        description += `음성채널: ${voiceChannel}\n\n`
    })

    embed.setDescription(description)
    return embed
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('리그')
        .setDescription('리그용 커맨드입니다.'),
    banpickSessions, // 밴픽 세션 데이터 export
    async execute(interaction) {
        if (!interaction.guild) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ 오류')
                .setDescription('이 명령어는 서버에서만 사용할 수 있습니다.')
            return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        }

        const initialTeams = await getLeagueData(interaction.guild.id);
        const embed = createMainMenuEmbed(interaction.guild.name)
        const buttons = createMainMenuButtons()

        // fetchReply 대신 최신 방식 사용
        await interaction.reply({ 
            embeds: [embed], 
            components: [buttons]
        })

        const reply = await interaction.fetchReply()

        // 특정 메시지에 대한 수집기 생성 (세션 독립성 보장)
        const collector = reply.createMessageComponentCollector({ 
            filter: i => i.user.id === interaction.user.id, 
            time: 600000 // 10분
        })

        collector.on('collect', async i => {
            if (!i.guild) { return; }
            
            await i.deferUpdate()
            
            try {
                const currentTeams = await getLeagueData(i.guild.id)
                
                // === 메인 메뉴 네비게이션 ===
                if (i.customId === 'team_management') {
                    const embed = createTeamManagementEmbed()
                    const buttons = createTeamManagementButtons()
                    await i.editReply({ embeds: [embed], components: [buttons] })
                    
                } else if (i.customId === 'score_management') {
                    const embed = createScoreManagementEmbed(currentTeams)
                    const buttons = createScoreManagementButtons(currentTeams)
                    await i.editReply({ embeds: [embed], components: [buttons] })
                    
                } else if (i.customId === 'team_movement') {
                    if (currentTeams.size === 0) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('이동할 팀이 없습니다. 먼저 팀을 생성해주세요.')
                        await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                        return
                    }
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('🔊 팀 이동')
                        .setDescription('팀 이동 방식을 선택하세요.')
                    
                    const moveButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('move_all_teams')
                                .setLabel('🚀 모든 팀 이동')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('move_single_team')
                                .setLabel('👤 개별 팀 이동')
                                .setStyle(ButtonStyle.Primary)
                        )
                    
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main')
                                .setLabel('🔙 메인으로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [moveButtons, backButton] })
                    
                } else if (i.customId === 'team_list') {
                    const embed = createTeamListEmbed(currentTeams)
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main')
                                .setLabel('🔙 메인으로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [backButton] })
                    
                } else if (i.customId === 'banpick_setup') {
                    // 팀장이 설정된 팀이 최소 2개 있는지 확인
                    const teamsWithCaptains = Array.from(currentTeams.entries()).filter(([teamName, teamData]) => teamData.captain)
                    
                    if (teamsWithCaptains.length < 2) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('밴픽 설정을 위해서는 팀장이 설정된 팀이 최소 2개 필요합니다.')
                            .addFields(
                                { name: '현재 상태', value: `팀장이 설정된 팀: ${teamsWithCaptains.length}개` },
                                { name: '해결 방법', value: '팀 관리 → 팀 편집 → 팀장 설정을 통해 각 팀의 팀장을 먼저 설정해주세요.' }
                            )
                        await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                        return
                    }
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('⚔️ 밴픽 설정')
                        .setDescription('대결할 2개 팀을 선택하여 밴픽을 진행합니다.')
                        .addFields(
                            { name: '📝 진행 방법', value: '• 아래에서 대결할 2개 팀을 선택하세요\n• 각 팀장에게 개인 메시지(DM)로 밴픽 요청이 발송됩니다\n• 팀장들이 DM에서 밴픽을 입력하면 결과가 공개됩니다' },
                            { name: '⚠️ 주의사항', value: '• 팀장이 설정되지 않은 팀은 선택할 수 없습니다\n• 팀장이 DM을 받을 수 있는 상태여야 합니다' }
                        )
                    
                    // 팀장이 있는 팀들만 선택 옵션으로 제공
                    const teamOptions = teamsWithCaptains.map(([teamName, teamData]) => ({
                        label: teamName,
                        value: teamName,
                        description: `팀장: ${interaction.guild.members.cache.get(teamData.captain)?.displayName || '알 수 없음'}`
                    }))
                    
                    const teamSelect = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('banpick_team_select')
                                .setPlaceholder('대결할 2개 팀 선택')
                                .addOptions(teamOptions)
                                .setMinValues(2)
                                .setMaxValues(2)
                        )
                    
                    const cancelButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('cancel_banpick_setup')
                                .setLabel('❌ 취소')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('back_to_main')
                                .setLabel('🔙 메인으로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    
                    await i.editReply({ embeds: [embed], components: [teamSelect, cancelButton] })
                    
                } else if (i.customId === 'cancel_banpick_setup') {
                    // 밴픽 세션 정리
                    banpickSessions.delete(i.guild.id)
                    
                    const embed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle('❌ 밴픽 설정 취소')
                        .setDescription('밴픽 설정이 취소되었습니다.')
                    
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main')
                                .setLabel('🔙 메인으로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    
                    await i.editReply({ embeds: [embed], components: [backButton] })
                    
                } else if (i.customId === 'back_to_main') {
                    const embed = createMainMenuEmbed(interaction.guild.name)
                    const buttons = createMainMenuButtons()
                    await i.editReply({ embeds: [embed], components: [buttons] })
                    
                // === 팀 관리 ===
                } else if (i.customId === 'create_team') {
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('➕ 팀 생성')
                        .setDescription('새로운 팀을 생성합니다. 팀 이름을 입력해주세요.')
                        .addFields({ name: '📝 입력 방법', value: '채팅창에 팀 이름을 입력하세요. (예: 팀A, 블루팀)' })
                    await i.editReply({ embeds: [embed], components: [] })
                    
                    const messageFilter = m => m.author.id === i.user.id
                    const messageCollector = interaction.channel.createMessageCollector({ 
                        filter: messageFilter, 
                        time: 30000, 
                        max: 1 
                    })
                    
                    messageCollector.on('collect', async m => {
                        const teamName = m.content.trim()
                        
                        if (currentTeams.has(teamName)) {
                            const errorEmbed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription(`이미 존재하는 팀 이름입니다: ${teamName}`)
                            
                            await m.delete().catch(() => {})
                            await interaction.editReply({ embeds: [errorEmbed], components: [createTeamManagementButtons()] })
                            return
                        }

                        // 팀 생성
                        const newTeamData = { members: new Set(), score: 0, voiceChannelId: null, captain: null }
                        await setTeamData(i.guild.id, teamName, newTeamData)

                        const successEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 팀 생성 완료')
                            .setDescription(`팀 "${teamName}"이 성공적으로 생성되었습니다.`)
                            .addFields({ name: '다음 단계', value: '팀원을 선택해주세요.' })

                        const userSelect = new ActionRowBuilder()
                            .addComponents(
                                new UserSelectMenuBuilder()
                                    .setCustomId(`add_members_after_create_${teamName}`)
                                    .setPlaceholder('팀원 선택 (최대 25명)')
                                    .setMinValues(1)
                                    .setMaxValues(25)
                            )
                        
                        await m.delete().catch(() => {})
                        await interaction.editReply({ 
                            embeds: [successEmbed], 
                            components: [userSelect] 
                        })
                    })
                    
                } else if (i.customId === 'edit_team') {
                    if (currentTeams.size === 0) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('편집할 팀이 없습니다.')
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        return
                    }
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('✏️ 팀 편집')
                        .setDescription('편집할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'edit_team_select', '편집할 팀 선택')
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('🔙 팀 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                    
                } else if (i.customId === 'delete_team') {
                    if (currentTeams.size === 0) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('삭제할 팀이 없습니다.')
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        return
                    }
                    const embed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle('❌ 팀 삭제')
                        .setDescription('삭제할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'delete_team_select', '삭제할 팀 선택')
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('🔙 팀 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                    
                } else if (i.customId === 'reset_all_teams') {
                    const embed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle('🗑️ 전체 초기화')
                        .setDescription('정말로 모든 팀을 삭제하시겠습니까?\n**이 작업은 되돌릴 수 없습니다.**')
                    const confirmButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('confirm_reset_all')
                                .setLabel('✅ 확인')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('❌ 취소')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [confirmButtons] })
                    
                } else if (i.customId === 'confirm_reset_all') {
                    await removeAllTeams(i.guild.id)
                    const embed = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('✅ 초기화 완료')
                        .setDescription('모든 팀이 성공적으로 삭제되었습니다.')
                    await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                    
                } else if (i.customId.startsWith('skip_captain_')) {
                    const teamName = i.customId.replace('skip_captain_', '')
                    
                    // 팀장 설정을 건너뛰고 음성채널 선택으로 이동
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('⏭️ 팀장 건너뛰기')
                        .setDescription(`이제 팀 "${teamName}"이 사용할 음성채널을 선택해주세요.`)
                        .addFields(
                            { name: '팀장 설정', value: '나중에 팀 편집에서 설정할 수 있습니다.' }
                        )
                    
                    const channelSelect = new ActionRowBuilder()
                        .addComponents(
                            new ChannelSelectMenuBuilder()
                                .setCustomId(`set_voice_channel_${teamName}`)
                                .setPlaceholder('음성채널 선택')
                                .addChannelTypes(ChannelType.GuildVoice)
                        )
                    
                    const skipButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('나중에 설정하기')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    
                    await i.editReply({ embeds: [embed], components: [channelSelect, skipButton] })
                    
                // === 팀 이동 처리 ===
                } else if (i.customId === 'move_all_teams') {
                    if (!i.member.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 권한 부족')
                            .setDescription('멤버 이동 권한이 필요합니다.')
                        await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                        return
                    }
                    
                    // 음성채널이 설정된 팀만 필터링
                    const teamsWithChannels = Array.from(currentTeams.entries()).filter(([teamName, teamData]) => teamData.voiceChannelId)
                    
                    if (teamsWithChannels.length === 0) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('음성채널이 설정된 팀이 없습니다. 먼저 팀에 음성채널을 설정해주세요.')
                        await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                        return
                    }
                    
                    let totalMoved = 0
                    let totalErrors = 0
                    const moveResults = []
                    
                    for (const [teamName, teamData] of teamsWithChannels) {
                        const targetChannel = i.guild.channels.cache.get(teamData.voiceChannelId)
                        
                        if (!targetChannel) {
                            moveResults.push(`❌ ${teamName}: 채널을 찾을 수 없음`)
                            continue
                        }
                        
                        let teamMoved = 0
                        let teamErrors = 0
                        
                        for (const memberId of teamData.members) {
                            try {
                                const member = await i.guild.members.fetch(memberId)
                                if (member && member.voice && member.voice.channel) {
                                    await member.voice.setChannel(targetChannel)
                                    teamMoved++
                                    totalMoved++
                                }
                            } catch (error) {
                                teamErrors++
                                totalErrors++
                                console.error(`Failed to move member ${memberId} from team ${teamName}:`, error)
                            }
                        }
                        
                        if (teamMoved > 0 || teamErrors > 0) {
                            moveResults.push(`${teamMoved > 0 ? '✅' : '⚠️'} ${teamName}: ${teamMoved}명 이동, ${teamErrors}명 실패`)
                        }
                    }
                    
                    const embed = new EmbedBuilder()
                        .setColor(totalMoved > 0 ? 0x00ff00 : 0xff0000)
                        .setTitle('🚀 모든 팀 이동 결과')
                        .setDescription('모든 팀의 멤버 이동이 완료되었습니다.')
                        .addFields(
                            { name: '📊 전체 결과', value: `이동 완료: ${totalMoved}명\n이동 실패: ${totalErrors}명`, inline: true },
                            { name: '🎯 팀별 상세', value: moveResults.join('\n') || '이동할 멤버가 없습니다.', inline: false }
                        )
                    
                    await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                    
                } else if (i.customId === 'move_single_team') {
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('👤 개별 팀 이동')
                        .setDescription('이동할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'move_team_select', '이동할 팀 선택')
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_movement')
                                .setLabel('🔙 팀 이동으로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                    
                // === 점수 관리 ===
                } else if (i.customId === 'score_change') {
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle('🎯 점수 변경')
                        .setDescription('점수를 변경할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'score_team_select', '점수 변경할 팀 선택')
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('score_management')
                                .setLabel('🔙 점수 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                    
                // === 팀 편집 버튼들 ===
                } else if (i.customId.startsWith('edit_name_')) {
                    const teamName = i.customId.replace('edit_name_', '')
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(`✏️ "${teamName}" 이름 변경`)
                        .setDescription('새로운 팀 이름을 채팅으로 입력해주세요.')
                    await i.editReply({ embeds: [embed], components: [] })
                    
                    const messageFilter = m => m.author.id === i.user.id
                    const messageCollector = interaction.channel.createMessageCollector({ 
                        filter: messageFilter, 
                        time: 30000, 
                        max: 1 
                    })
                    
                    messageCollector.on('collect', async m => {
                        const newTeamName = m.content.trim()
                        const freshTeams = await getLeagueData(i.guild.id)
                        
                        if (freshTeams.has(newTeamName)) {
                            await m.delete().catch(() => {})
                            const errorEmbed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription(`이미 존재하는 팀 이름입니다: ${newTeamName}`)
                            await interaction.editReply({ embeds: [errorEmbed], components: [createTeamManagementButtons()] })
                            return
                        }
                        
                        const teamData = freshTeams.get(teamName)
                        await setTeamData(i.guild.id, newTeamName, teamData)
                        await removeTeamData(i.guild.id, teamName)
                        
                        await m.delete().catch(() => {})
                        const successEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 이름 변경 완료')
                            .setDescription(`팀 이름이 "${teamName}"에서 "${newTeamName}"으로 변경되었습니다.`)
                        await interaction.editReply({ embeds: [successEmbed], components: [createTeamManagementButtons()] })
                    })
                    
                } else if (i.customId.startsWith('manage_members_')) {
                    const teamName = i.customId.replace('manage_members_', '')
                    const teamData = currentTeams.get(teamName)
                    
                    if (!teamData) {
                        await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                        return
                    }
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(`👥 "${teamName}" 멤버 관리`)
                        .setDescription(`현재 멤버: ${Array.from(teamData.members).map(id => `<@${id}>`).join(', ') || '없음'}`)
                    
                    const userAddSelect = new ActionRowBuilder()
                        .addComponents(
                            new UserSelectMenuBuilder()
                                .setCustomId(`add_members_${teamName}`)
                                .setPlaceholder('추가할 멤버 선택')
                                .setMinValues(1)
                                .setMaxValues(25)
                        )
                    
                    const components = [userAddSelect]
                    
                    if (teamData.members.size > 0) {
                        const memberOptions = Array.from(teamData.members).map(memberId => ({
                            label: interaction.guild.members.cache.get(memberId)?.displayName || memberId,
                            value: memberId
                        }))
                        
                        const userRemoveSelect = new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId(`remove_members_${teamName}`)
                                    .setPlaceholder('제외할 멤버 선택')
                                    .addOptions(memberOptions)
                                    .setMinValues(1)
                                    .setMaxValues(memberOptions.length)
                            )
                        components.push(userRemoveSelect)
                    }
                    
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('🔙 팀 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    components.push(backButton)
                    
                    await i.editReply({ embeds: [embed], components })
                    
                } else if (i.customId.startsWith('set_captain_')) {
                    const teamName = i.customId.replace('set_captain_', '')
                    const teamData = currentTeams.get(teamName)
                    
                    if (!teamData) {
                        await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                        return
                    }
                    
                    if (teamData.members.size === 0) {
                        await i.followUp({ content: '⚠️ 팀에 멤버가 없어 팀장을 설정할 수 없습니다.', ephemeral: true })
                        return
                    }
                    
                    const memberOptions = Array.from(teamData.members).map(memberId => {
                        const member = interaction.guild.members.cache.get(memberId)
                        return {
                            label: member?.displayName || member?.user.username || memberId,
                            value: memberId,
                            description: teamData.captain === memberId ? '현재 팀장' : '팀원'
                        }
                    })
                    
                    const captainSelect = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`select_captain_${teamName}`)
                                .setPlaceholder('팀장으로 설정할 멤버 선택')
                                .addOptions(memberOptions)
                        )
                    
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('🔙 팀 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(`👑 "${teamName}" 팀장 설정`)
                        .setDescription('팀장으로 설정할 멤버를 선택하세요.')
                        .addFields(
                            { name: '현재 팀장', value: teamData.captain ? `<@${teamData.captain}>` : '설정 안됨' }
                        )
                    
                    await i.editReply({ embeds: [embed], components: [captainSelect, backButton] })
                    
                } else if (i.customId.startsWith('edit_channel_')) {
                    const teamName = i.customId.replace('edit_channel_', '')
                    const channelSelect = new ActionRowBuilder()
                        .addComponents(
                            new ChannelSelectMenuBuilder()
                                .setCustomId(`set_voice_channel_${teamName}`)
                                .setPlaceholder('새 음성채널 선택')
                                .addChannelTypes(ChannelType.GuildVoice)
                        )
                    const backButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('team_management')
                                .setLabel('🔙 팀 관리로')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    await i.editReply({ components: [channelSelect, backButton] })
                    
                // === 드롭다운 메뉴 처리 ===
                } else if (i.isStringSelectMenu()) {
                    const selectedValue = i.values[0]
                    
                    if (i.customId === 'edit_team_select') {
                        const embed = createTeamEditEmbed(selectedValue, currentTeams)
                        const buttons = createTeamEditButtons(selectedValue)
                        await i.editReply({ embeds: [embed], components: [buttons] })
                        
                    } else if (i.customId === 'delete_team_select') {
                        await removeTeamData(i.guild.id, selectedValue)
                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 팀 삭제 완료')
                            .setDescription(`팀 "${selectedValue}"이 성공적으로 삭제되었습니다.`)
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        
                    } else if (i.customId === 'move_team_select') {
                        const teamData = currentTeams.get(selectedValue)
                        
                        if (!teamData.voiceChannelId) {
                            const embed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription(`팀 "${selectedValue}"에 음성채널이 설정되지 않았습니다.`)
                            await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                            return
                        }
                        
                        if (!i.member.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
                            const embed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 권한 부족')
                                .setDescription('멤버 이동 권한이 필요합니다.')
                            await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                            return
                        }
                        
                        const targetChannel = i.guild.channels.cache.get(teamData.voiceChannelId)
                        
                        if (!targetChannel) {
                            const embed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription('설정된 음성채널을 찾을 수 없습니다.')
                            await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                            return
                        }
                        
                        let movedCount = 0
                        let errorCount = 0
                        
                        for (const memberId of teamData.members) {
                            try {
                                const member = await i.guild.members.fetch(memberId)
                                if (member && member.voice && member.voice.channel) {
                                    await member.voice.setChannel(targetChannel)
                                    movedCount++
                                }
                            } catch (error) {
                                errorCount++
                                console.error(`Failed to move member ${memberId}:`, error)
                            }
                        }
                        
                        const embed = new EmbedBuilder()
                            .setColor(movedCount > 0 ? 0x00ff00 : 0xff0000)
                            .setTitle('🔊 팀 이동 결과')
                            .setDescription(`팀 "${selectedValue}" 이동 완료`)
                            .addFields(
                                { name: '이동된 멤버', value: `${movedCount}명`, inline: true },
                                { name: '이동 실패', value: `${errorCount}명`, inline: true },
                                { name: '대상 채널', value: `<#${teamData.voiceChannelId}>`, inline: true }
                            )
                        
                        await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                        
                    } else if (i.customId === 'score_team_select') {
                        const embed = new EmbedBuilder()
                            .setColor(0x426cf5)
                            .setTitle(`🎯 "${selectedValue}" 점수 변경`)
                            .setDescription('변경할 점수를 숫자로 입력해주세요.\n(예: 10, -5, 15)')
                            .addFields(
                                { name: '현재 점수', value: `${currentTeams.get(selectedValue).score}점` },
                                { name: '입력 예시', value: '• 양수: 점수 추가 (예: 10)\n• 음수: 점수 차감 (예: -5)' }
                            )
                        await i.editReply({ embeds: [embed], components: [] })
                        
                        const messageFilter = m => m.author.id === i.user.id
                        const messageCollector = interaction.channel.createMessageCollector({ 
                            filter: messageFilter, 
                            time: 30000, 
                            max: 1 
                        })
                        
                        messageCollector.on('collect', async m => {
                            const scoreInput = m.content.trim()
                            const scoreChange = parseInt(scoreInput)
                            
                            if (isNaN(scoreChange)) {
                                const errorEmbed = new EmbedBuilder()
                                    .setColor(0xff0000)
                                    .setTitle('⚠️ 오류')
                                    .setDescription('올바른 숫자를 입력해주세요. (예: 10, -5)')
                                
                                await m.delete().catch(() => {})
                                await interaction.editReply({ 
                                    embeds: [errorEmbed], 
                                    components: [createScoreManagementButtons(currentTeams)] 
                                })
                                return
                            }
                            
                            await updateTeamScore(i.guild.id, selectedValue, scoreChange)
                            const updatedTeams = await getLeagueData(i.guild.id)
                            const newScore = updatedTeams.get(selectedValue).score
                            
                            const successEmbed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 점수 변경 완료')
                                .setDescription(`팀 "${selectedValue}"의 점수가 변경되었습니다.`)
                                .addFields(
                                    { name: '변경량', value: `${scoreChange > 0 ? '+' : ''}${scoreChange}점`, inline: true },
                                    { name: '현재 점수', value: `${newScore}점`, inline: true }
                                )
                            
                            await m.delete().catch(() => {})
                            await interaction.editReply({ 
                                embeds: [successEmbed], 
                                components: [createScoreManagementButtons(updatedTeams)] 
                            })
                        })
                        
                    } else if (i.customId.startsWith('remove_members_')) {
                        const teamName = i.customId.replace('remove_members_', '')
                        const teamData = currentTeams.get(teamName)
                        
                        if (!teamData) {
                            await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                            return
                        }
                        
                        i.values.forEach(userId => teamData.members.delete(userId))
                        await setTeamData(i.guild.id, teamName, teamData)
                        
                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 멤버 제외 완료')
                            .setDescription(`"${teamName}" 팀에서 ${i.values.length}명의 멤버가 제외되었습니다.`)
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        
                    } else if (i.customId.startsWith('select_captain_')) {
                        const teamName = i.customId.replace('select_captain_', '')
                        const selectedUserId = i.values[0]
                        
                        // 최신 팀 데이터를 다시 가져옴
                        const freshTeams = await getLeagueData(i.guild.id)
                        const teamData = freshTeams.get(teamName)
                        
                        if (!teamData) {
                            await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                            return
                        }
                        
                        teamData.captain = selectedUserId
                        await setTeamData(i.guild.id, teamName, teamData)
                        
                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 팀장 설정 완료')
                            .setDescription(`"${teamName}" 팀의 팀장이 설정되었습니다.`)
                            .addFields(
                                { name: '새 팀장', value: `<@${selectedUserId}>` }
                            )
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        
                    } else if (i.customId.startsWith('set_captain_after_create_')) {
                        const teamName = i.customId.replace('set_captain_after_create_', '')
                        const selectedUserId = i.values[0]
                        
                        // 최신 팀 데이터를 다시 가져옴
                        const freshTeams = await getLeagueData(i.guild.id)
                        const teamData = freshTeams.get(teamName)
                        
                        if (!teamData) {
                            await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                            return
                        }
                        
                        teamData.captain = selectedUserId
                        await setTeamData(i.guild.id, teamName, teamData)
                        
                        // 팀장 설정 후 음성채널 선택으로 이동
                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 팀장 설정 완료')
                            .setDescription(`이제 팀 "${teamName}"이 사용할 음성채널을 선택해주세요.`)
                            .addFields(
                                { name: '설정된 팀장', value: `<@${selectedUserId}>` }
                            )
                        
                        const channelSelect = new ActionRowBuilder()
                            .addComponents(
                                new ChannelSelectMenuBuilder()
                                    .setCustomId(`set_voice_channel_${teamName}`)
                                    .setPlaceholder('음성채널 선택')
                                    .addChannelTypes(ChannelType.GuildVoice)
                            )
                        
                        const skipButton = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('team_management')
                                    .setLabel('나중에 설정하기')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        
                        await i.editReply({ embeds: [embed], components: [channelSelect, skipButton] })
                        
                    } else if (i.customId === 'banpick_team_select') {
                        const selectedTeams = i.values
                        const team1Name = selectedTeams[0]
                        const team2Name = selectedTeams[1]
                        const team1Data = currentTeams.get(team1Name)
                        const team2Data = currentTeams.get(team2Name)
                        
                        const embed = new EmbedBuilder()
                            .setColor(0xffaa00)
                            .setTitle('⚔️ 밴픽 진행 중...')
                            .setDescription('각 팀장에게 개인 메시지를 발송하고 있습니다.')
                            .addFields(
                                { name: '대결 팀', value: `**${team1Name}** vs **${team2Name}**` },
                                { name: '상태', value: '팀장들에게 DM 발송 중...' }
                            )
                        
                        await i.editReply({ embeds: [embed], components: [] })
                        
                        // 밴픽 세션 초기화
                        banpickSessions.set(i.guild.id, {
                            teams: { [team1Name]: team1Data, [team2Name]: team2Data },
                            banpicks: new Map(), // teamName -> banpick
                            isActive: true,
                            channelId: interaction.channelId,
                            originalInteraction: interaction
                        })
                        
                        // 각 팀장에게 DM 발송
                        try {
                            const captain1 = await i.guild.members.fetch(team1Data.captain)
                            const captain2 = await i.guild.members.fetch(team2Data.captain)
                            
                            const dmEmbed = new EmbedBuilder()
                                .setColor(0x426cf5)
                                .setTitle('⚔️ 밴픽 요청')
                                .setDescription(`**${team1Name}** vs **${team2Name}** 대결에서 밴픽을 입력해주세요.`)
                                .addFields(
                                    { name: '📝 입력 방법', value: '이 DM에 밴픽할 내용을 채팅으로 입력하세요.\n(예: "바드", "야스오", "챔피언명" 등)' },
                                    { name: '⚠️ 주의사항', value: '• 상대방은 당신의 밴픽을 볼 수 없습니다\n• 먼저 입력하는 2명의 밴픽이 채택됩니다' }
                                )
                                .setFooter({ text: `당신의 팀: ${team1Data.captain === captain1.id ? team1Name : team2Name}` })
                            
                            await captain1.send({ embeds: [dmEmbed] })
                            await captain2.send({ 
                                embeds: [dmEmbed.setFooter({ text: `당신의 팀: ${team2Data.captain === captain2.id ? team2Name : team1Name}` })] 
                            })
                            
                            // 상태 업데이트
                            const progressEmbed = new EmbedBuilder()
                                .setColor(0x426cf5)
                                .setTitle('⚔️ 밴픽 대기 중')
                                .setDescription('팀장들이 개인 메시지에서 밴픽을 입력하고 있습니다.')
                                .addFields(
                                    { name: '대결 팀', value: `**${team1Name}** vs **${team2Name}**` },
                                    { name: '진행 상태', value: `📤 DM 발송 완료\n⏳ 밴픽 입력 대기 중... (0/2)` }
                                )
                                .setFooter({ text: '각 팀장은 개인 메시지에서 밴픽을 입력해주세요.' })
                            
                            await interaction.editReply({ embeds: [progressEmbed], components: [] })
                            
                        } catch (error) {
                            console.error('Failed to send DM to captains:', error)
                            
                            const errorEmbed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('❌ DM 발송 실패')
                                .setDescription('팀장들에게 개인 메시지를 발송하는데 실패했습니다.')
                                .addFields(
                                    { name: '가능한 원인', value: '• 팀장이 DM을 받지 않도록 설정했을 수 있습니다\n• 봇과 공통 서버가 없을 수 있습니다' },
                                    { name: '해결 방법', value: '팀장들에게 DM 설정을 확인하도록 요청해주세요.' }
                                )
                            
                            await interaction.editReply({ embeds: [errorEmbed], components: [createMainMenuButtons()] })
                            banpickSessions.delete(i.guild.id)
                        }
                    }
                    
                // === 사용자 선택 메뉴 처리 ===
                } else if (i.isUserSelectMenu()) {
                    // 팀 멤버 관리 처리
                    const teamName = i.customId.startsWith('add_members_after_create_') 
                        ? i.customId.replace('add_members_after_create_', '') 
                        : i.customId.replace('add_members_', '')
                    
                    const selectedUsers = i.values
                    const teamData = currentTeams.get(teamName)
                    
                    if (!teamData) {
                        await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                        return
                    }
                    
                    if (teamData) {
                        selectedUsers.forEach(userId => teamData.members.add(userId))
                        await setTeamData(i.guild.id, teamName, teamData)
                        
                        if (i.customId.startsWith('add_members_after_create_')) {
                            // 생성 플로우: 팀장 선택으로 이동
                            const embed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 팀원 추가 완료')
                                .setDescription(`이제 팀 "${teamName}"의 팀장을 선택해주세요.`)
                            
                            const captainOptions = selectedUsers.map(userId => {
                                const member = interaction.guild.members.cache.get(userId)
                                return {
                                    label: member?.displayName || member?.user.username || userId,
                                    value: userId,
                                    description: '팀장 후보'
                                }
                            })
                            
                            const captainSelect = new ActionRowBuilder()
                                .addComponents(
                                    new StringSelectMenuBuilder()
                                        .setCustomId(`set_captain_after_create_${teamName}`)
                                        .setPlaceholder('팀장 선택')
                                        .addOptions(captainOptions)
                                )
                            
                            const skipButton = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`skip_captain_${teamName}`)
                                        .setLabel('팀장 나중에 설정')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                            
                            await i.editReply({ embeds: [embed], components: [captainSelect, skipButton] })
                        } else {
                            // 편집 플로우
                            const embed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 팀원 추가 완료')
                                .setDescription(`팀 "${teamName}"에 ${selectedUsers.length}명의 멤버가 추가되었습니다.`)
                                .addFields(
                                    { name: '추가된 멤버', value: selectedUsers.map(id => `<@${id}>`).join(', ') }
                                )
                            
                            await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                        }
                    }
                    
                // === 채널 선택 메뉴 처리 ===
                } else if (i.isChannelSelectMenu()) {
                    const teamName = i.customId.replace('set_voice_channel_', '')
                    const selectedChannelId = i.values[0]
                    const teamData = currentTeams.get(teamName)
                    
                    if (!teamData) {
                        await i.followUp({ content: `⚠️ 팀 "${teamName}"을 찾을 수 없습니다.`, ephemeral: true })
                        return
                    }
                    
                    if (teamData) {
                        teamData.voiceChannelId = selectedChannelId
                        await setTeamData(i.guild.id, teamName, teamData)
                        
                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 음성채널 설정 완료')
                            .setDescription(`팀 "${teamName}"의 음성채널이 설정되었습니다.`)
                            .addFields(
                                { name: '설정된 채널', value: `<#${selectedChannelId}>` }
                            )
                        
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons()] })
                    }
                }
                
            } catch (error) {
                console.error(`[오류] 상호작용 처리 실패:`, {
                    customId: i.customId,
                    user: i.user.tag,
                    guild: i.guild.name,
                    error: error
                })
                
                try {
                    await i.followUp({
                        content: '⚠️ 명령 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                        ephemeral: true
                    })
                } catch (followUpError) {
                    console.error(`[오류] 사용자에게 오류 메시지 전송 실패:`, followUpError)
                }
            }
        })

        collector.on('end', () => {
            const expiredEmbed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('⏰ 시간 초과')
                .setDescription('상호작용 시간이 만료되었습니다. 다시 명령어를 실행해주세요.')
            
            reply.edit({ embeds: [expiredEmbed], components: [] }).catch(err => {
                if (err.code !== 10008) { // Ignore "Unknown Message" error if message was deleted
                    console.error('[오류] 만료된 상호작용 메시지 수정 실패:', err)
                }
            })
        })
    }
}
