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
        
        // 최초 응답 및 메시지 객체 가져오기
        const initialTeams = await getLeagueData(interaction.guild.id);
        const embed = createMainMenuEmbed(interaction.guild.name);
        const buttons = createMainMenuButtons();
        const reply = await interaction.reply({ 
            embeds: [embed], 
            components: [buttons],
            fetchReply: true // 중요: 이 옵션으로 메시지 객체를 반환받음
        });

        // 특정 메시지에 대한 수집기 생성
        const collector = reply.createMessageComponentCollector({ 
            filter: i => i.user.id === interaction.user.id, 
            time: 600000 // 10분
        });

        collector.on('collect', async i => {
            if (!i.guild) { return; }
            
            // 모든 상호작용에 대해 즉시 응답하여 '상호작용 실패' 방지
            await i.deferUpdate();

            const currentTeams = await getLeagueData(i.guild.id);
            
            try {
                // Main Menu
                if (i.customId === 'back_to_main') {
                    const mainMenuEmbed = createMainMenuEmbed(i.guild.name);
                    await i.editReply({ embeds: [mainMenuEmbed], components: [createMainMenuButtons()] });
                }
                else if (i.customId === 'team_management' || i.customId === 'back_to_team_management') {
                    const teamManagementEmbed = createTeamManagementEmbed();
                    await i.editReply({ embeds: [teamManagementEmbed], components: [createTeamManagementButtons(currentTeams.size > 0)] });
                }
                else if (i.customId === 'score_management') {
                    const scoreEmbed = createScoreManagementEmbed(currentTeams);
                    await i.editReply({ embeds: [scoreEmbed], components: [createScoreManagementButtons(currentTeams.size > 0)] });
                }
                else if (i.customId === 'team_movement') {
                    if (currentTeams.size === 0) {
                        const errorEmbed = new EmbedBuilder().setColor(0xff0000).setTitle('⚠️ 오류').setDescription('이동할 팀이 없습니다. 먼저 팀을 생성해주세요.');
                        await i.editReply({ embeds: [errorEmbed], components: [createMainMenuButtons()] });
                        return;
                    }
                    const moveEmbed = new EmbedBuilder().setColor(0x426cf5).setTitle('🔊 팀 이동').setDescription('이동할 팀을 선택하세요.');
                    const teamSelect = createTeamSelectMenu(currentTeams, 'move_team_select', '이동할 팀 선택');
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_to_main').setLabel('🔙 메인으로').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [moveEmbed], components: [teamSelect, backButton] });
                }
                else if (i.customId === 'team_list') {
                    const listEmbed = createTeamListEmbed(currentTeams);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_to_main').setLabel('🔙 메인으로').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [listEmbed], components: [backButton] });
                }

                // Team Creation Flow
                else if (i.customId === 'create_team') {
                    const embed = new EmbedBuilder().setColor(0x426cf5).setTitle('➕ 팀 생성').setDescription('새로운 팀을 생성합니다. 팀 이름을 입력해주세요.').addFields({ name: '📝 입력 방법', value: '채팅창에 팀 이름을 입력하세요. (예: 팀A, 블루팀)' })
                    await i.editReply({ embeds: [embed], components: [] })
                    const messageFilter = m => m.author.id === i.user.id
                    const messageCollector = interaction.channel.createMessageCollector({ filter: messageFilter, time: 30000, max: 1 })
                    messageCollector.on('collect', async m => {
                        const teamName = m.content.trim()
                        
                        if (currentTeams.has(teamName)) {
                            const errorEmbed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription(`이미 존재하는 팀 이름입니다: ${teamName}`)
                            
                            await m.delete().catch(() => {})
                            await i.editReply({ embeds: [errorEmbed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                            return
                        }

                        // 팀 생성
                        const newTeamData = { members: new Set(), score: 0, voiceChannelId: null };
                        await setTeamData(i.guild.id, teamName, newTeamData);

                        const successEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 팀 생성 완료')
                            .setDescription(`팀 "${teamName}"이 성공적으로 생성되었습니다.`)
                            .addFields(
                                { name: '다음 단계', value: '팀원을 선택해주세요.' }
                            )

                        const userSelect = new ActionRowBuilder()
                            .addComponents(
                                new UserSelectMenuBuilder()
                                    .setCustomId(`add_members_after_create_${teamName}`)
                                    .setPlaceholder('팀원 선택 (최대 25명)')
                                    .setMinValues(1)
                                    .setMaxValues(25)
                            )
                        
                        await m.delete().catch(() => {})
                        await i.editReply({ 
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
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                        return
                    }
                    const embed = new EmbedBuilder().setColor(0x426cf5).setTitle('✏️ 팀 편집').setDescription('편집할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'edit_team_select', '편집할 팀 선택')
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_to_team_management').setLabel('🔙 팀 관리로').setStyle(ButtonStyle.Secondary))
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                } else if (i.customId === 'delete_team') {
                    if (currentTeams.size === 0) {
                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('⚠️ 오류')
                            .setDescription('삭제할 팀이 없습니다.')
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                        return
                    }
                    const embed = new EmbedBuilder().setColor(0xff0000).setTitle('❌ 팀 삭제').setDescription('삭제할 팀을 선택하세요.')
                    const teamSelect = createTeamSelectMenu(currentTeams, 'delete_team_select', '삭제할 팀 선택')
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_to_team_management').setLabel('🔙 팀 관리로').setStyle(ButtonStyle.Secondary))
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                } else if (i.customId === 'reset_all_teams') {
                    const embed = new EmbedBuilder().setColor(0xff0000).setTitle('🗑️ 전체 초기화').setDescription('정말로 모든 팀을 삭제하시겠습니까?\n**이 작업은 되돌릴 수 없습니다.**')
                    const confirmButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('confirm_reset_all').setLabel('✅ 확인').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('back_to_team_management').setLabel('❌ 취소').setStyle(ButtonStyle.Secondary))
                    await i.editReply({ embeds: [embed], components: [confirmButtons] })
                } else if (i.customId === 'confirm_reset_all') {
                    await removeAllTeams(i.guild.id);
                    const embed = new EmbedBuilder().setColor(0x00ff00).setTitle('✅ 초기화 완료').setDescription('모든 팀이 성공적으로 삭제되었습니다.')
                    await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                } 

                // Score Management
                else if (i.customId.endsWith('score_team_select')) {
                    const isAdding = i.customId.startsWith('add');
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(isAdding ? '➕ 점수 추가' : '➖ 점수 차감')
                        .setDescription(`점수를 ${isAdding ? '추가할' : '차감할'} 팀을 선택하세요.`)

                    const teamSelect = createTeamSelectMenu(currentTeams, isAdding ? 'add_score_team_select' : 'subtract_score_team_select', '점수를 변경할 팀 선택')
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('score_management').setLabel('🔙 점수 관리로').setStyle(ButtonStyle.Secondary))
                    await i.editReply({ embeds: [embed], components: [teamSelect, backButton] })
                }

                // Team Editing
                else if (i.customId.startsWith('edit_name_')) {
                    const oldTeamName = i.customId.replace('edit_name_', '')
                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(`✏️ "${oldTeamName}" 이름 변경`)
                        .setDescription('새로운 팀 이름을 채팅으로 입력해주세요.')
                    await i.editReply({ embeds: [embed], components: [] })

                    const messageFilter = m => m.author.id === i.user.id
                    const messageCollector = interaction.channel.createMessageCollector({ filter: messageFilter, time: 30000, max: 1 })

                    messageCollector.on('collect', async m => {
                        const newTeamName = m.content.trim()
                        if (currentTeams.has(newTeamName)) {
                            await m.delete().catch(() => {})
                            await i.editReply({
                                content: `⚠️ 이미 존재하는 팀 이름입니다: ${newTeamName}`,
                                embeds: [],
                                components: [createTeamManagementButtons(currentTeams.size > 0)]
                            })
                            return
                        }
                        const teamData = currentTeams.get(oldTeamName)
                        await setTeamData(i.guild.id, newTeamName, teamData)
                        await removeTeamData(i.guild.id, oldTeamName)

                        await m.delete().catch(() => {})
                        const successEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 이름 변경 완료')
                            .setDescription(`팀 이름이 "${oldTeamName}"에서 "${newTeamName}"으로 변경되었습니다.`)
                        await i.editReply({ embeds: [successEmbed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                    })

                } else if (i.customId.startsWith('manage_members_')) {
                    const teamName = i.customId.replace('manage_members_', '')
                    const teamData = currentTeams.get(teamName)

                    const embed = new EmbedBuilder()
                        .setColor(0x426cf5)
                        .setTitle(`👥 "${teamName}" 멤버 관리`)
                        .setDescription(`현재 멤버: ${Array.from(teamData.members).map(id => `<@${id}>`).join(', ') || '없음'}`)

                    const userAddSelect = new ActionRowBuilder().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId(`add_members_${teamName}`)
                            .setPlaceholder('추가할 멤버 선택')
                            .setMinValues(1)
                            .setMaxValues(25)
                    )

                    const backButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('team_management') // 단순화를 위해 메인으로
                            .setLabel('🔙 팀 관리로')
                            .setStyle(ButtonStyle.Secondary)
                    )
                    
                    if (teamData.members.size > 0) {
                        const memberOptions = Array.from(teamData.members).map(memberId => ({
                            label: interaction.guild.members.cache.get(memberId)?.displayName || memberId,
                            value: memberId
                        }))

                        const userRemoveSelect = new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`remove_members_${teamName}`)
                                .setPlaceholder('제외할 멤버 선택')
                                .addOptions(memberOptions)
                                .setMinValues(1)
                                .setMaxValues(memberOptions.length)
                        )
                        await i.editReply({ embeds: [embed], components: [userAddSelect, userRemoveSelect, backButton] })
                    } else {
                        await i.editReply({ embeds: [embed], components: [userAddSelect, backButton] })
                    }


                } else if (i.customId.startsWith('edit_channel_')) {
                    const teamName = i.customId.replace('edit_channel_', '')
                    const channelSelect = new ActionRowBuilder()
                        .addComponents(
                            new ChannelSelectMenuBuilder()
                                .setCustomId(`set_voice_channel_${teamName}`)
                                .setPlaceholder('새 음성채널 선택')
                                .addChannelTypes(ChannelType.GuildVoice)
                        )
                    const backButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('team_management')
                            .setLabel('🔙 팀 관리로')
                            .setStyle(ButtonStyle.Secondary)
                    )
                    await i.editReply({ components: [channelSelect, backButton] })

                } else if (i.isStringSelectMenu()) {
                    const [action, ...params] = i.customId.split('_');
                    const teamName = params.join('_');
                    const selectedValue = i.values[0];

                    if (action === 'edit' && teamName === 'team' && selectedValue) {
                         const embed = createTeamEditEmbed(selectedValue, currentTeams)
                         const buttons = createTeamEditButtons(selectedValue)
                         await i.editReply({ embeds: [embed], components: [buttons] })
                    } else if (action === 'delete' && teamName === 'team' && selectedValue) {
                        await removeTeamData(i.guild.id, selectedValue)
                        const embed = new EmbedBuilder().setColor(0x00ff00).setTitle('✅ 팀 삭제 완료').setDescription(`팀 "${selectedValue}"이 성공적으로 삭제되었습니다.`)
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                    } else if (action === 'add' && teamName === 'score' && selectedValue || action === 'subtract' && teamName === 'score' && selectedValue) {
                        const isAdding = action === 'add'
                        const embed = new EmbedBuilder().setColor(0x426cf5).setTitle(isAdding ? '➕ 점수 추가' : '➖ 점수 차감').setDescription(`팀 "${selectedValue}"에 ${isAdding ? '추가할' : '차감할'} 점수를 입력하세요.`)
                        await i.editReply({ embeds: [embed], components: [] })
                        const messageFilter = m => m.author.id === i.user.id
                        const messageCollector = interaction.channel.createMessageCollector({ filter: messageFilter, time: 30000, max: 1 })
                        messageCollector.on('collect', async m => {
                            const score = parseInt(m.content.trim())
                            
                            if (isNaN(score)) {
                                const errorEmbed = new EmbedBuilder()
                                    .setColor(0xff0000)
                                    .setTitle('⚠️ 오류')
                                    .setDescription('올바른 숫자를 입력해주세요.')
                                
                                await m.delete().catch(() => {})
                                await i.editReply({ embeds: [errorEmbed], components: [createScoreManagementButtons(currentTeams)] })
                                return
                            }

                            await updateTeamScore(i.guild.id, selectedValue, isAdding ? score : -score);

                            const successEmbed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 점수 추가 완료')
                                .setDescription(`팀 "${selectedValue}"에 ${score}점을 추가했습니다.`)
                                .addFields(
                                    { name: '현재 점수', value: `${currentTeams.get(selectedValue).score}점` }
                                )

                            await m.delete().catch(() => {})
                            await i.editReply({ embeds: [successEmbed], components: [createScoreManagementButtons(currentTeams)] })
                        });
                    } else if (action === 'move' && teamName === 'team' && selectedValue) {
                        const teamData = currentTeams.get(selectedValue)
                        
                        if (!teamData.voiceChannelId) {
                            const embed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 오류')
                                .setDescription(`팀 "${selectedValue}"에 음성채널이 설정되지 않았습니다.`)
                            
                            await i.editReply({ embeds: [embed], components: [createMainMenuButtons()] })
                            return
                        }

                        // 관리자 권한 확인
                        if (!i.member || !i.member.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
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
                    } else if (action === 'remove' && i.customId.startsWith('remove_members_')) {
                        const teamData = currentTeams.get(teamName)
                        i.values.forEach(userId => teamData.members.delete(userId))
                        await setTeamData(i.guild.id, teamName, teamData); // 멤버 변경 사항 저장

                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 멤버 제외 완료')
                            .setDescription(`"${teamName}" 팀에서 멤버가 제외되었습니다.`)
                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                        return
                    }
                } else if (i.isUserSelectMenu()) {
                    // 사용자 선택 메뉴 처리
                    const teamName = i.customId.startsWith('add_members_after_create_') 
                        ? i.customId.replace('add_members_after_create_', '') 
                        : i.customId.replace('add_members_', '')
                    
                    const selectedUsers = i.values
                    
                    if (currentTeams.has(teamName)) {
                        const teamData = currentTeams.get(teamName)
                        selectedUsers.forEach(userId => teamData.members.add(userId))
                        await setTeamData(i.guild.id, teamName, teamData); // 멤버 변경 사항 저장

                        if (i.customId.startsWith('add_members_after_create_')) {
                            // 생성 플로우의 다음 단계: 음성채널 선택
                            const embed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 팀원 추가 완료')
                                .setDescription(`이제 팀 "${teamName}"이 사용할 음성채널을 선택해주세요.`)
                            
                            const channelSelect = new ActionRowBuilder()
                                .addComponents(
                                    new ChannelSelectMenuBuilder()
                                        .setCustomId(`set_voice_channel_${teamName}`)
                                        .setPlaceholder('음성채널 선택')
                                        .addChannelTypes(ChannelType.GuildVoice)
                                )
                            
                            const backButton = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('team_management')
                                        .setLabel('완료 및 돌아가기')
                                        .setStyle(ButtonStyle.Success)
                                )
                            
                            await i.editReply({ embeds: [embed], components: [channelSelect, backButton] })
                        } else {
                            // 편집 플로우
                            const embed = new EmbedBuilder()
                                .setColor(0x00ff00)
                                .setTitle('✅ 팀원 추가 완료')
                                .setDescription(`팀 "${teamName}"에 ${selectedUsers.length}명의 멤버가 추가되었습니다.`)
                                .addFields(
                                    { name: '추가된 멤버', value: selectedUsers.map(id => `<@${id}>`).join(', ') }
                                )

                            await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                        }
                    }

                } else if (i.isChannelSelectMenu()) {
                    // 채널 선택 메뉴 처리
                    const teamName = i.customId.replace('set_voice_channel_', '')
                    const selectedChannelId = i.values[0]
                    
                    if (currentTeams.has(teamName)) {
                        const teamData = currentTeams.get(teamName)
                        teamData.voiceChannelId = selectedChannelId
                        await setTeamData(i.guild.id, teamName, teamData); // 채널 변경 사항 저장

                        const embed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('✅ 음성채널 설정 완료')
                            .setDescription(`팀 "${teamName}"의 음성채널이 설정되었습니다.`)
                            .addFields(
                                { name: '설정된 채널', value: `<#${selectedChannelId}>` }
                            )

                        await i.editReply({ embeds: [embed], components: [createTeamManagementButtons(currentTeams.size > 0)] })
                    }
                }

            } catch (error) {
                console.error(`[오류] 상호작용 처리 실패:`, {
                    customId: i.customId,
                    user: i.user.tag,
                    guild: i.guild.name,
                    error: error
                });
                try {
                    await i.followUp({
                        content: '⚠️ 명령 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                        ephemeral: true
                    });
                } catch (followUpError) {
                    console.error(`[오류] 사용자에게 오류 메시지 전송 실패:`, followUpError);
                }
            }
        });

        collector.on('end', () => {
            const expiredEmbed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('⏰ 시간 초과')
                .setDescription('상호작용 시간이 만료되었습니다. 다시 명령어를 실행해주세요.');
            
            // 저장된 reply 객체를 수정하여 만료 처리
            reply.edit({ embeds: [expiredEmbed], components: [] }).catch(err => {
                // 메시지가 이미 삭제된 경우 등의 오류는 무시
                if (err.code !== 10008) {
                    console.error('[오류] 만료된 상호작용 메시지 수정 실패:', err);
                }
            });
        });
    }
};
