const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { initializeApp } = require('firebase/app')
const { getDatabase, ref, get, set, update } = require('firebase/database')
const firebaseConfig = require('../config/firebaseConfig')

// Firebase 앱 초기화
const firebaseApp = initializeApp(firebaseConfig)
const database = getDatabase(firebaseApp)

/**
 * 현재 날짜를 YYYY-MM-DD 형식으로 반환하는 함수 (한국 시간 기준)
 * @returns {string} - 현재 날짜 (YYYY-MM-DD)
 */
function getCurrentDate() {
    // 한국 시간대(Asia/Seoul) 사용
    const now = new Date()
    const kstDate = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Seoul"}))
    
    const year = kstDate.getFullYear()
    const month = String(kstDate.getMonth() + 1).padStart(2, '0')
    const day = String(kstDate.getDate()).padStart(2, '0')
    
    const dateString = `${year}-${month}-${day}`
    console.log(`[출석] 한국 시간 기준 날짜: ${dateString}`)
    console.log(`[출석] 서버 UTC 시간: ${now.toISOString()}`)
    console.log(`[출석] 한국 로컬 시간: ${kstDate.toISOString()}`)
    
    return dateString
}

/**
 * 사용자의 출석 데이터를 Firebase에서 가져오는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<object>} - 출석 데이터
 */
async function getAttendanceData(guildId, userId) {
    try {
        const dbRef = ref(database, `attendance/${guildId}/${userId}`)
        const snapshot = await get(dbRef)
        
        if (snapshot.exists()) {
            return snapshot.val()
        }
        
        return {
            count: 0,
            lastDate: null
        }
    } catch (error) {
        console.error('출석 데이터 가져오기 실패:', error)
        return {
            count: 0,
            lastDate: null
        }
    }
}

/**
 * 사용자의 출석 데이터를 Firebase에 저장하는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @param {object} attendanceData - 출석 데이터
 */
async function setAttendanceData(guildId, userId, attendanceData) {
    try {
        await set(ref(database, `attendance/${guildId}/${userId}`), attendanceData)
    } catch (error) {
        console.error('출석 데이터 저장 실패:', error)
        throw error
    }
}

/**
 * 서버 전체 출석 데이터를 가져오는 함수
 * @param {string} guildId - 길드 ID
 * @returns {Promise<Array>} - 출석 랭킹 배열
 */
async function getServerAttendanceRanking(guildId) {
    try {
        const dbRef = ref(database, `attendance/${guildId}`)
        const snapshot = await get(dbRef)
        
        if (!snapshot.exists()) {
            return []
        }
        
        const attendanceData = snapshot.val()
        const ranking = []
        
        for (const userId in attendanceData) {
            const userData = attendanceData[userId]
            ranking.push({
                userId: userId,
                count: userData.count || 0,
                lastDate: userData.lastDate
            })
        }
        
        // 출석 횟수 기준으로 내림차순 정렬
        ranking.sort((a, b) => b.count - a.count)
        
        return ranking
    } catch (error) {
        console.error('서버 출석 랭킹 가져오기 실패:', error)
        return []
    }
}

/**
 * 출석 처리 함수
 * @param {object} interaction - Discord interaction
 */
async function handleAttendanceCheck(interaction) {
    const guildId = interaction.guild.id
    const userId = interaction.user.id
    const currentDate = getCurrentDate()
    
    try {
        await interaction.deferReply()
        
        // 사용자의 출석 데이터 가져오기
        const attendanceData = await getAttendanceData(guildId, userId)
        
        // 오늘 이미 출석했는지 확인
        if (attendanceData.lastDate === currentDate) {
            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('⚠️ 이미 출석 완료했습니다!')
                .setDescription(`**<@${userId}>**님은 오늘 이미 출석하셨습니다.`)
                .addFields(
                    { 
                        name: '📅 마지막 출석일', 
                        value: currentDate, 
                        inline: true 
                    },
                    { 
                        name: '🎯 총 출석 횟수', 
                        value: `${attendanceData.count}일`, 
                        inline: true 
                    }
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp()
            
            await interaction.editReply({ embeds: [embed] })
            return
        }
        
        // 출석 처리
        const newAttendanceData = {
            count: attendanceData.count + 1,
            lastDate: currentDate
        }
        
        await setAttendanceData(guildId, userId, newAttendanceData)
        
        // 성공 메시지
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ 출석 완료!')
            .setDescription(`**<@${userId}>**님의 출석이 완료되었습니다!`)
            .addFields(
                { 
                    name: '📅 출석일', 
                    value: currentDate, 
                    inline: true 
                },
                { 
                    name: '🎯 총 출석 횟수', 
                    value: `${newAttendanceData.count}일`, 
                    inline: true 
                },
                { 
                    name: '🎉 보상', 
                    value: '출석 완료!', 
                    inline: true 
                }
            )
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp()
        
        await interaction.editReply({ embeds: [embed] })
        
    } catch (error) {
        console.error('출석 처리 오류:', error)
        await interaction.editReply({
            content: '❌ 출석 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
        })
    }
}

/**
 * 출석 랭킹 표시 함수
 * @param {object} interaction - Discord interaction
 */
async function handleAttendanceRanking(interaction) {
    const guildId = interaction.guild.id
    
    try {
        await interaction.deferReply()
        
        const ranking = await getServerAttendanceRanking(guildId)
        
        if (ranking.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x999999)
                .setTitle('📊 출석 랭킹')
                .setDescription('아직 출석한 사용자가 없습니다.\n`/출석` 명령어로 첫 출석을 해보세요!')
                .setTimestamp()
            
            await interaction.editReply({ embeds: [embed] })
            return
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('🏆 출석 랭킹')
            .setDescription(`**${interaction.guild.name}** 서버의 출석 순위입니다`)
            .setTimestamp()
        
        let rankingText = ''
        const maxDisplay = Math.min(ranking.length, 10) // 최대 10명까지 표시
        
        for (let i = 0; i < maxDisplay; i++) {
            const user = ranking[i]
            let trophy = ''
            
            // 순위별 트로피/이모티콘
            if (i === 0) trophy = '🥇'      // 1위 - 금메달
            else if (i === 1) trophy = '🥈' // 2위 - 은메달
            else if (i === 2) trophy = '🥉' // 3위 - 동메달
            else if (i === 3 || i === 4) trophy = '⭐' // 4,5위 - 별
            else trophy = `${i + 1}.`       // 6위 이하 - 숫자
            
            const lastAttendance = user.lastDate ? ` (마지막: ${user.lastDate})` : ''
            rankingText += `${trophy} <@${user.userId}> - **${user.count}일**${lastAttendance}\n`
        }
        
        embed.setDescription(rankingText)
        
        if (ranking.length > 10) {
            embed.setFooter({ text: `외 ${ranking.length - 10}명이 더 있습니다.` })
        }
        
        await interaction.editReply({ embeds: [embed] })
        
    } catch (error) {
        console.error('출석 랭킹 조회 오류:', error)
        await interaction.editReply({
            content: '❌ 출석 랭킹 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
        })
    }
}

// 출석 체크 명령어
const attendanceCommand = {
    data: new SlashCommandBuilder()
        .setName('출석')
        .setDescription('오늘의 출석을 진행합니다'),
    
    async execute(interaction) {
        await handleAttendanceCheck(interaction)
    }
}

// 출석 랭킹 명령어  
const attendanceRankCommand = {
    data: new SlashCommandBuilder()
        .setName('출석랭크')
        .setDescription('서버의 출석 랭킹을 확인합니다'),
    
    async execute(interaction) {
        await handleAttendanceRanking(interaction)
    }
}

module.exports = [attendanceCommand, attendanceRankCommand]