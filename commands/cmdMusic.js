const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js')
const { Player, useMainPlayer } = require('discord-player')
const { DefaultExtractors } = require('@discord-player/extractor')
const { YoutubeiExtractor } = require('discord-player-youtubei')
const { initializeApp } = require('firebase/app')
const { getDatabase, ref, get, set, remove, push, child } = require('firebase/database')
const firebaseConfig = require('../config/firebaseConfig')

// Firebase 앱 초기화
const firebaseApp = initializeApp(firebaseConfig)
const database = getDatabase(firebaseApp)

// 전역 Player 인스턴스 (한 번만 초기화)
let globalPlayer = null

// Discord 클라이언트 참조
let discordClient = null

// 서버별 큐 관리 (Firebase와 동기화)
const serverQueues = new Map() // guildId -> { songs: [], currentIndex: 0, isPlaying: false }

/**
 * Player 인스턴스를 초기화하는 함수
 * @param {Client} client - Discord 클라이언트
 */
async function initializePlayer(client) {
    if (globalPlayer) return

    discordClient = client
    globalPlayer = new Player(client, {
        ytdlOptions: {
            filter: 'audioonly',
            quality: 'highestaudio'
        }
    })

    // 기본 extractors 로드
    try {
        await globalPlayer.extractors.loadMulti(DefaultExtractors)
        console.log('기본 extractors 로드 완료')
    } catch (error) {
        console.error('기본 extractors 로드 실패:', error)
    }
    
    // YouTube 지원 강화를 위한 youtubei extractor 등록
    try {
        await globalPlayer.extractors.register(YoutubeiExtractor, {})
        console.log('YouTubei extractor 등록 완료')
    } catch (error) {
        console.error('YouTubei extractor 등록 실패:', error)
        console.log('기본 YouTube extractor를 사용합니다')
    }

    // Player 이벤트 설정
    setupPlayerEvents()

    // 모든 길드의 기존 재생목록 로드
    await loadAllGuildQueues(client)

    console.log('Discord Player 초기화 완료')
}

/**
 * Player 이벤트를 설정하는 함수
 */
function setupPlayerEvents() {
    if (!globalPlayer) return

    // 트랙 시작 이벤트
    globalPlayer.events.on('playerStart', (queue, track) => {
        const guildId = queue.guild.id
        console.log(`[${guildId}] 재생 시작: ${track.title}`)
        updatePlayingStatus(guildId, true)
    })

    // 트랙 종료 이벤트
    globalPlayer.events.on('playerFinish', (queue, track) => {
        const guildId = queue.guild.id
        console.log(`[${guildId}] 재생 완료: ${track.title}`)
    })

    // 큐 종료 이벤트 (1분 후 자동 퇴장)
    globalPlayer.events.on('emptyQueue', (queue) => {
        const guildId = queue.guild.id
        console.log(`[${guildId}] 큐가 비어있음 - 1분 후 자동 퇴장 예정`)
        updatePlayingStatus(guildId, false)
        
        // 1분(60초) 후 자동 퇴장
        setTimeout(() => {
            try {
                const currentQueue = globalPlayer?.nodes.get(guildId)
                if (currentQueue) {
                    // 큐가 여전히 비어있는지 확인
                    if (currentQueue.tracks.size === 0 && !currentQueue.currentTrack) {
                        console.log(`[${guildId}] 1분 경과 - 음성 채널에서 자동 퇴장`)
                        currentQueue.delete()
                        updatePlayingStatus(guildId, false)
                    } else {
                        console.log(`[${guildId}] 새로운 곡이 추가되어 자동 퇴장 취소`)
                    }
                }
            } catch (error) {
                console.error(`[${guildId}] 자동 퇴장 처리 중 오류:`, error)
            }
        }, 60000) // 60초 = 60,000ms
    })

    // 오류 이벤트
    globalPlayer.events.on('error', (queue, error) => {
        const guildId = queue ? queue.guild.id : 'unknown'
        console.error(`[${guildId}] Player 오류:`, error)
    })

    // 연결 생성 이벤트
    globalPlayer.events.on('connection', (queue) => {
        const guildId = queue.guild.id
        console.log(`[${guildId}] 음성 채널 연결됨`)
    })

    // 연결 해제 이벤트  
    globalPlayer.events.on('disconnect', (queue) => {
        const guildId = queue.guild.id
        console.log(`[${guildId}] 음성 채널 연결 해제됨`)
        updatePlayingStatus(guildId, false)
    })
}

/**
 * currentIndex 유효성 검사 및 자동 조정 함수
 * @param {object} queueData - 큐 데이터
 * @param {string} guildId - 길드 ID (로그용)
 * @returns {boolean} - 조정이 발생했는지 여부
 */
function validateAndFixCurrentIndex(queueData, guildId = 'unknown') {
    if (queueData.songs.length === 0) {
        queueData.currentIndex = 0
        return false
    }
    
    if (queueData.currentIndex >= queueData.songs.length || queueData.currentIndex < 0) {
        console.log(`[${guildId}] 현재 인덱스(${queueData.currentIndex})가 유효하지 않음. 첫 번째 곡으로 조정`)
        queueData.currentIndex = 0
        return true
    }
    
    return false
}

/**
 * 서버의 큐 데이터를 Firebase에서 가져오는 함수
 * @param {string} guildId - 길드 ID
 * @returns {Promise<object>} - 큐 데이터
 */
async function getQueueData(guildId) {
    try {
        const dbRef = ref(database, `music/${guildId}/queue`)
        const snapshot = await get(dbRef)
        let queueData
        if (snapshot.exists()) {
            queueData = snapshot.val()
        } else {
            queueData = { songs: [], currentIndex: 0, isPlaying: false }
        }
        
        // 데이터 무결성 확인 및 보정
        if (!queueData || typeof queueData !== 'object') {
            console.log(`[${guildId}] 잘못된 큐 데이터 형식, 초기화`)
            queueData = { songs: [], currentIndex: 0, isPlaying: false }
        }
        
        if (!Array.isArray(queueData.songs)) {
            console.log(`[${guildId}] songs 배열이 없음, 초기화`)
            queueData.songs = []
        }
        
        if (typeof queueData.currentIndex !== 'number') {
            console.log(`[${guildId}] currentIndex가 숫자가 아님, 0으로 초기화`)
            queueData.currentIndex = 0
        }
        
        if (typeof queueData.isPlaying !== 'boolean') {
            queueData.isPlaying = false
        }
        
        // 인덱스 유효성 검사 및 자동 조정
        validateAndFixCurrentIndex(queueData, guildId)
        
        return queueData
    } catch (error) {
        console.error('큐 데이터 가져오기 실패:', error)
        return { songs: [], currentIndex: 0, isPlaying: false }
    }
}

/**
 * 서버의 큐 데이터를 Firebase에 저장하는 함수
 * @param {string} guildId - 길드 ID
 * @param {object} queueData - 저장할 큐 데이터
 */
async function setQueueData(guildId, queueData) {
    try {
        await set(ref(database, `music/${guildId}/queue`), queueData)
    } catch (error) {
        console.error('큐 데이터 저장 실패:', error)
    }
}

/**
 * 큐에 노래를 추가하는 함수
 * @param {string} guildId - 길드 ID
 * @param {object} songData - 노래 데이터
 */
async function addSongToQueue(guildId, songData) {
    try {
        // 입력 데이터 검증
        if (!songData || typeof songData !== 'object') {
            console.error(`[${guildId}] 잘못된 songData:`, songData)
            throw new Error('잘못된 노래 데이터')
        }

        const queueData = await getQueueData(guildId)
        
        // queueData와 songs 배열 재확인 (이중 보안)
        if (!queueData || !Array.isArray(queueData.songs)) {
            console.error(`[${guildId}] 큐 데이터 오류:`, queueData)
            throw new Error('큐 데이터를 가져올 수 없습니다')
        }

        // 안전한 songData 처리
        const safeSongData = {
            title: songData.title || '알 수 없는 제목',
            url: songData.url || '',
            duration: songData.duration || 0,
            thumbnail: songData.thumbnail || null,
            uploader: songData.uploader || '알 수 없는 업로더',
            addedBy: songData.addedBy || 'unknown',
            addedAt: Date.now()
        }

        queueData.songs.push(safeSongData)
        await setQueueData(guildId, queueData)
        serverQueues.set(guildId, queueData)
        
        console.log(`[${guildId}] 노래 추가 성공: ${safeSongData.title}`)
    } catch (error) {
        console.error(`[${guildId}] addSongToQueue 오류:`, error)
        throw error
    }
}

/**
 * 시간을 포맷팅하는 함수
 * @param {number} seconds - 초 단위 시간
 * @returns {string} - 포맷된 시간 문자열
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * 음악 플레이어 임베드를 생성하는 함수
 * @param {object} queueData - 큐 데이터
 * @param {string} guildName - 길드 이름
 * @returns {EmbedBuilder} - 음악 플레이어 임베드
 */
function createMusicPlayerEmbed(queueData, guildName) {
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 음악 플레이어')
        .setTimestamp()

    if (queueData.songs.length === 0) {
        embed.setDescription('재생 목록이 비어있습니다.\n`/노래 추가` 명령어로 노래를 추가해보세요!')
        embed.setThumbnail('https://i.imgur.com/X8HLvgQ.png')
        return embed
    }

    // 현재 인덱스 유효성 검사 및 자동 조정
    validateAndFixCurrentIndex(queueData, 'Embed')

    const currentSong = queueData.songs[queueData.currentIndex]
    const statusIcon = queueData.isPlaying ? '▶️' : '⏸️'
    
    embed.setDescription(`${statusIcon} **현재 재생 중**`)
        .addFields(
            { 
                name: '🎵 제목', 
                value: `**${currentSong.title}**`, 
                inline: false 
            },
            { 
                name: '⏱️ 재생 시간', 
                value: formatDuration(currentSong.duration), 
                inline: true 
            },
            { 
                name: '👤 추가한 사람', 
                value: `<@${currentSong.addedBy}>`, 
                inline: true 
            },
            { 
                name: '📋 큐 정보', 
                value: `${queueData.currentIndex + 1} / ${queueData.songs.length}곡`, 
                inline: true 
            }
        )

    if (currentSong.thumbnail) {
        embed.setThumbnail(currentSong.thumbnail)
    }

    return embed
}

/**
 * 음악 플레이어 컨트롤 버튼을 생성하는 함수
 * @param {object} queueData - 큐 데이터
 * @returns {Array<ActionRowBuilder>} - 컨트롤 버튼들
 */
function createMusicControlButtons(queueData) {
    const hasQueue = queueData.songs.length > 0
    const hasMultipleSongs = queueData.songs.length > 1
    
    const firstRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_previous')
                .setEmoji('⏮️')
                .setLabel('  이전곡  ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasMultipleSongs),
            new ButtonBuilder()
                .setCustomId('music_play_pause')
                .setEmoji(queueData.isPlaying ? '⏸️' : '▶️')
                .setLabel(queueData.isPlaying ? '  일시정지  ' : '  재 생  ')
                .setStyle(queueData.isPlaying ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!hasQueue),
            new ButtonBuilder()
                .setCustomId('music_next')
                .setEmoji('⏭️')
                .setLabel('  다음곡  ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasMultipleSongs)
        )

    const secondRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_add_song')
                .setEmoji('➕')
                .setLabel('  노래 추가  ')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_show_queue')
                .setEmoji('📋')
                .setLabel('  재생목록  ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasQueue),
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setEmoji('🔀')
                .setLabel('  셔플  ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasMultipleSongs)
        )

    const thirdRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_remove_song')
                .setEmoji('🗑️')
                .setLabel('  노래 삭제  ')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!hasQueue),
            new ButtonBuilder()
                .setCustomId('music_clear_queue')
                .setEmoji('🧹')
                .setLabel('  전체 삭제  ')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!hasQueue)
        )

    return [firstRow, secondRow, thirdRow]
}

/**
 * 재생목록 임베드를 생성하는 함수
 * @param {object} queueData - 큐 데이터
 * @param {number} page - 페이지 번호
 * @returns {EmbedBuilder} - 재생목록 임베드
 */
function createQueueEmbed(queueData, page = 0) {
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('📋 재생목록')
        .setTimestamp()

    if (queueData.songs.length === 0) {
        embed.setDescription('재생목록이 비어있습니다.')
        return embed
    }

    const songsPerPage = 10
    const startIndex = page * songsPerPage
    const endIndex = Math.min(startIndex + songsPerPage, queueData.songs.length)
    const totalPages = Math.ceil(queueData.songs.length / songsPerPage)

    let queueList = ''
    for (let i = startIndex; i < endIndex; i++) {
        const song = queueData.songs[i]
        const isCurrentSong = i === queueData.currentIndex
        const icon = isCurrentSong ? '🎵' : '📄'
        const status = isCurrentSong ? ' **[재생 중]**' : ''
        
        queueList += `${icon} **${i + 1}.** ${song.title} (${formatDuration(song.duration)})${status}\n`
    }

    embed.setDescription(queueList)
        .setFooter({ 
            text: `페이지 ${page + 1}/${totalPages} | 총 ${queueData.songs.length}곡` 
        })

    return embed
}

/**
 * Discord Player를 사용해서 노래를 검색하는 함수
 * @param {string} query - 검색어 또는 URL
 * @returns {Promise<object>} - 검색 결과
 */
async function searchSong(query) {
    try {
        if (!globalPlayer) {
            throw new Error('Player가 초기화되지 않았습니다.')
        }

        const searchResult = await globalPlayer.search(query, {
            requestedBy: 'bot'
        })

        if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
            throw new Error('검색 결과를 찾을 수 없습니다.')
        }

        const track = searchResult.tracks[0]
        
        return {
            title: track.title || '제목 없음',
            url: track.url,
            duration: track.durationMS ? Math.floor(track.durationMS / 1000) : 0,
            thumbnail: track.thumbnail || '',
            author: track.author || '알 수 없음'
        }
    } catch (error) {
        console.error('노래 검색 실패:', error)
        throw new Error(`노래 검색에 실패했습니다: ${error.message}`)
    }
}

/**
 * Discord Player를 사용해서 음악을 재생하는 함수
 * @param {string} guildId - 길드 ID
 * @param {object} voiceChannel - 음성 채널
 * @param {string} query - 검색어 또는 URL
 * @param {object} requestedBy - 요청한 사용자
 * @returns {Promise<boolean>} - 재생 성공 여부
 */
async function playMusic(guildId, voiceChannel, query, requestedBy) {
    try {
        if (!globalPlayer) {
            throw new Error('Player가 초기화되지 않았습니다.')
        }

        const searchResult = await globalPlayer.search(query, {
            requestedBy: requestedBy
        })

        if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
            throw new Error('검색 결과를 찾을 수 없습니다.')
        }

        const { track } = await globalPlayer.play(voiceChannel, searchResult, {
            nodeOptions: {
                metadata: {
                    channel: voiceChannel,
                    requestedBy: requestedBy
                },
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 180000, // 3분
                leaveOnEnd: false,
                selfDeaf: true,
                volume: 80
            }
        })

        console.log(`[${guildId}] 재생 시작: ${track.title}`)
        return true
    } catch (error) {
        console.error(`[${guildId}] 음악 재생 실패:`, error)
        throw error
    }
}

/**
 * 재생 상태를 업데이트하는 함수
 * @param {string} guildId - 길드 ID
 * @param {boolean} isPlaying - 재생 상태
 */
async function updatePlayingStatus(guildId, isPlaying) {
    try {
        const queueData = serverQueues.get(guildId) || await getQueueData(guildId)
        queueData.isPlaying = isPlaying
        await setQueueData(guildId, queueData)
        serverQueues.set(guildId, queueData)
    } catch (error) {
        console.error(`[${guildId}] 재생 상태 업데이트 실패:`, error)
    }
}

/**
 * 큐를 Discord Player와 동기화하는 함수
 * @param {string} guildId - 길드 ID
 */
async function syncQueueWithPlayer(guildId) {
    try {
        if (!globalPlayer) return

        const queue = globalPlayer.nodes.get(guildId)
        if (!queue) return

        const queueData = await getQueueData(guildId)
        
        // Firebase 큐와 Discord Player 큐 동기화
        if (queueData.songs.length > 0) {
            queueData.isPlaying = queue.isPlaying()
            queueData.currentIndex = queue.currentTrack ? 
                queueData.songs.findIndex(song => song.url === queue.currentTrack.url) : 0
            
            await setQueueData(guildId, queueData)
            serverQueues.set(guildId, queueData)
        }
    } catch (error) {
        console.error(`[${guildId}] 큐 동기화 실패:`, error)
    }
}

/**
 * 모든 길드의 기존 재생목록을 Firebase에서 로드하는 함수
 * @param {Client} client - Discord 클라이언트
 */
async function loadAllGuildQueues(client) {
    try {
        console.log('모든 길드의 재생목록 로드 시작...')
        
        const guilds = client.guilds.cache
        let loadedCount = 0
        let totalSongs = 0

        for (const [guildId, guild] of guilds) {
            try {
                // Firebase에서 길드별 큐 데이터 로드
                const queueData = await getQueueData(guildId)
                
                if (queueData.songs && queueData.songs.length > 0) {
                    // 재생 상태는 봇 재시작 시 false로 초기화
                    queueData.isPlaying = false
                    
                    // 메모리에 저장
                    serverQueues.set(guildId, queueData)
                    
                    loadedCount++
                    totalSongs += queueData.songs.length
                    
                    console.log(`[${guild.name} (${guildId})] 재생목록 로드: ${queueData.songs.length}곡`)
                } else {
                    // 빈 큐 데이터로 초기화
                    const emptyQueue = { songs: [], currentIndex: 0, isPlaying: false }
                    serverQueues.set(guildId, emptyQueue)
                }
            } catch (error) {
                console.error(`[${guildId}] 길드 재생목록 로드 실패:`, error.message)
                // 오류 발생 시 빈 큐로 초기화
                const emptyQueue = { songs: [], currentIndex: 0, isPlaying: false }
                serverQueues.set(guildId, emptyQueue)
            }
        }

        console.log(`재생목록 로드 완료: ${loadedCount}개 길드에서 총 ${totalSongs}곡 로드`)
        
        // 로드된 큐가 있는 길드들의 정보 표시
        if (loadedCount > 0) {
            console.log('═'.repeat(50))
            console.log('📋 로드된 재생목록 요약:')
            for (const [guildId, queueData] of serverQueues) {
                if (queueData.songs.length > 0) {
                    const guild = client.guilds.cache.get(guildId)
                    const guildName = guild ? guild.name : `알 수 없는 길드 (${guildId})`
                    console.log(`  🎵 ${guildName}: ${queueData.songs.length}곡`)
                    
                    // 현재 곡이 있다면 표시
                    if (queueData.songs[queueData.currentIndex]) {
                        const currentSong = queueData.songs[queueData.currentIndex]
                        console.log(`     현재 곡: ${currentSong.title}`)
                    }
                }
            }
            console.log('═'.repeat(50))
        }

    } catch (error) {
        console.error('모든 길드 재생목록 로드 실패:', error)
    }
}

module.exports = {
    initializePlayer, // Player 초기화 함수 export
    removeSongFromQueue, // 단일 노래 삭제 함수 export
    removeMultipleSongsFromQueue, // 다중 노래 삭제 함수 export
    showRemovePage, // 삭제 페이지 표시 함수 export
    getQueueData, // 큐 데이터 조회 함수 export
    data: new SlashCommandBuilder()
        .setName('노래')
        .setDescription('음악 플레이어를 조작합니다')
        .addSubcommand(subcommand =>
            subcommand
                .setName('플레이어')
                .setDescription('음악 플레이어 UI를 표시합니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('추가')
                .setDescription('재생목록에 노래를 추가합니다')
                .addStringOption(option =>
                    option
                        .setName('노래')
                        .setDescription('YouTube URL 또는 검색어를 입력하세요')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('재생')
                .setDescription('음악을 재생하거나 일시정지를 해제합니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('일시정지')
                .setDescription('현재 재생 중인 음악을 일시정지합니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('정지')
                .setDescription('음악 재생을 정지하고 큐를 초기화합니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('스킵')
                .setDescription('현재 곡을 건너뛰고 다음 곡으로 넘어갑니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('목록')
                .setDescription('현재 재생목록을 표시합니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('삭제')
                .setDescription('재생목록에서 노래를 삭제합니다 (UI 선택 방식)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('다음곡')
                .setDescription('다음 곡으로 넘어갑니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('이전곡')
                .setDescription('이전 곡으로 돌아갑니다')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('나가기')
                .setDescription('음성 채널에서 나갑니다')
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return await interaction.reply({ 
                content: '❌ 이 명령어는 서버에서만 사용할 수 있습니다.', 
                ephemeral: true 
            })
        }

        // Player 초기화 확인
        if (!globalPlayer) {
            await initializePlayer(interaction.client)
        }

        // 음성 채널 확인
        const voiceChannel = interaction.member.voice.channel
        if (!voiceChannel) {
            return await interaction.reply({
                content: '❌ 음성 채널에 먼저 참여해주세요!',
                ephemeral: true
            })
        }

        // 권한 확인
        if (!voiceChannel.permissionsFor(interaction.guild.members.me).has([
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
        ])) {
            return await interaction.reply({
                content: '❌ 해당 음성 채널에 연결하거나 말할 권한이 없습니다.',
                ephemeral: true
            })
        }

        const subcommand = interaction.options.getSubcommand()
        const guildId = interaction.guild.id

        // 큐 데이터 로드
        let queueData = serverQueues.get(guildId)
        if (!queueData) {
            queueData = await getQueueData(guildId)
            serverQueues.set(guildId, queueData)
        }

        try {
            if (subcommand === '플레이어') {
                await handlePlayerCommand(interaction, queueData, voiceChannel)
            } else if (subcommand === '추가') {
                await handleAddCommand(interaction, queueData, voiceChannel)
            } else if (subcommand === '재생') {
                await handlePlayCommand(interaction, queueData, voiceChannel)
            } else if (subcommand === '일시정지') {
                await handlePauseCommand(interaction, queueData)
            } else if (subcommand === '정지') {
                await handleStopCommand(interaction, queueData)
            } else if (subcommand === '스킵') {
                await handleSkipCommand(interaction, queueData)
            } else if (subcommand === '목록') {
                await handleQueueCommand(interaction, queueData)
            } else if (subcommand === '삭제') {
                await handleRemoveCommand(interaction, queueData)
            } else if (subcommand === '다음곡') {
                await handleNextCommand(interaction, queueData)
            } else if (subcommand === '이전곡') {
                await handlePreviousCommand(interaction, queueData)
            } else if (subcommand === '나가기') {
                await handleLeaveCommand(interaction, queueData)
            }
        } catch (error) {
            console.error('음악 명령어 실행 오류:', error)
            
            const errorMessage = error.message || '알 수 없는 오류가 발생했습니다.'
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: `❌ 명령어 실행 중 오류가 발생했습니다.\n${errorMessage}`,
                    ephemeral: true
                })
            } else {
                await interaction.reply({
                    content: `❌ 명령어 실행 중 오류가 발생했습니다.\n${errorMessage}`,
                    ephemeral: true
                })
            }
        }
    }
}

/**
 * 플레이어 명령어 처리 함수
 */
async function handlePlayerCommand(interaction, queueData, voiceChannel) {
    // Firebase 큐 데이터가 있지만 Discord Player 큐가 비어있는 경우 동기화
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    if ((!queue || queue.tracks.size === 0) && queueData.songs.length > 0) {
        // 음성 채널에 연결되어 있지 않으면 연결하지 않고 UI만 표시
        console.log(`[${interaction.guild.id}] 플레이어 UI 표시 - Firebase 큐: ${queueData.songs.length}곡`)
    }
    
    // 큐와 Player 동기화
    await syncQueueWithPlayer(interaction.guild.id)
    
    // 최신 큐 데이터 가져오기
    const updatedQueueData = serverQueues.get(interaction.guild.id) || queueData
    
    const embed = createMusicPlayerEmbed(updatedQueueData, interaction.guild.name)
    const buttons = createMusicControlButtons(updatedQueueData)

    await interaction.reply({
        embeds: [embed],
        components: buttons
    })

    // 버튼 상호작용 수집기 설정
    const reply = await interaction.fetchReply()
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 600000 // 10분
    })

    collector.on('collect', async i => {
        if (i.isButton()) {
            await handleMusicButtonInteraction(i, queueData)
        } else if (i.isStringSelectMenu() && i.customId === 'music_remove_select') {
            await handleRemoveSelectInteraction(i, queueData)
        }
    })

    // 모달 제출 이벤트 처리
    const modalFilter = i => i.customId === 'music_add_modal' && i.user.id === interaction.user.id
    const modalCollector = interaction.client.on('interactionCreate', async i => {
        if (i.isModalSubmit() && modalFilter(i)) {
            await handleAddModalSubmit(i, queueData)
        }
    })

    collector.on('end', () => {
        // 만료된 버튼들 비활성화
        const disabledButtons = createMusicControlButtons(queueData).map(row => {
            const newRow = new ActionRowBuilder()
            row.components.forEach(button => {
                newRow.addComponents(ButtonBuilder.from(button).setDisabled(true))
            })
            return newRow
        })

        reply.edit({ components: disabledButtons }).catch(() => {})
        
        // 모달 이벤트 리스너 제거
        interaction.client.removeListener('interactionCreate', modalCollector)
    })
}

/**
 * 노래 추가 명령어 처리 함수
 */
async function handleAddCommand(interaction, queueData, voiceChannel) {
    const query = interaction.options.getString('노래')
    
    await interaction.deferReply()

    try {
        // Discord Player로 노래 검색 및 재생
        const searchResult = await globalPlayer.search(query, {
            requestedBy: interaction.user
        })

        if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
            await interaction.editReply({
                content: '❌ 검색 결과를 찾을 수 없습니다.'
            })
            return
        }

        const track = searchResult.tracks[0]
        
        // Firebase 큐에도 추가
        await addSongToQueue(interaction.guild.id, {
            title: track.title,
            url: track.url,
            duration: track.durationMS ? Math.floor(track.durationMS / 1000) : 0,
            thumbnail: track.thumbnail,
            uploader: track.author || track.uploader || '알 수 없는 업로더',
            addedBy: interaction.user.id
        })

        // Discord Player로 재생
        const { queue } = await globalPlayer.play(voiceChannel, searchResult, {
            nodeOptions: {
                metadata: {
                    channel: interaction.channel,
                    requestedBy: interaction.user
                },
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 180000, // 3분
                leaveOnEnd: false,
                selfDeaf: true,
                volume: 80
            }
        })

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ 노래가 추가되었습니다!')
            .setDescription(`**${track.title}**`)
            .addFields(
                { name: '재생 시간', value: formatDuration(track.durationMS ? Math.floor(track.durationMS / 1000) : 0), inline: true },
                { name: '추가한 사람', value: `<@${interaction.user.id}>`, inline: true },
                { name: '재생목록 위치', value: `${queue.tracks.size + 1}번째`, inline: true }
            )
            .setThumbnail(track.thumbnail)
            .setTimestamp()

        if (queue.tracks.size === 1) {
            embed.setFooter({ text: '🎵 재생을 시작합니다!' })
        }

        await interaction.editReply({ embeds: [embed] })
    } catch (error) {
        console.error('노래 추가 오류:', error)
        await interaction.editReply({
            content: `❌ 노래를 추가하는 중 오류가 발생했습니다.\n오류: ${error.message}`
        })
    }
}

/**
 * 재생 명령어 처리 함수
 */
async function handlePlayCommand(interaction, queueData, voiceChannel) {
    let queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    // Discord Player 큐가 비어있지만 Firebase에 큐 데이터가 있는 경우
    if ((!queue || queue.tracks.size === 0) && queueData.songs.length > 0) {
        try {
            console.log(`[${interaction.guild.id}] Firebase 큐 데이터를 Discord Player에 동기화 중...`)
            
            // 현재 곡부터 재생하기 위해 순서 조정
            // 현재 인덱스 유효성 검사 및 자동 조정
            const wasAdjusted = validateAndFixCurrentIndex(queueData, interaction.guild.id)
            if (wasAdjusted) {
                await setQueueData(interaction.guild.id, queueData)
                serverQueues.set(interaction.guild.id, queueData)
            }
            
            const currentSong = queueData.songs[queueData.currentIndex]
            if (!currentSong) {
                return await interaction.reply({
                    content: '❌ 재생할 곡을 찾을 수 없습니다.',
                    ephemeral: true
                })
            }

            // Discord Player로 현재 곡 재생
            const searchResult = await globalPlayer.search(currentSong.url, {
                requestedBy: interaction.user
            })

            if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
                return await interaction.reply({
                    content: '❌ 저장된 곡을 찾을 수 없습니다.',
                    ephemeral: true
                })
            }

            const { queue: newQueue } = await globalPlayer.play(voiceChannel, searchResult, {
                nodeOptions: {
                    metadata: {
                        channel: interaction.channel,
                        requestedBy: interaction.user
                    },
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 180000,
                    leaveOnEnd: false,
                    selfDeaf: true,
                    volume: 80
                }
            })

            // 나머지 곡들도 큐에 추가
            for (let i = queueData.currentIndex + 1; i < queueData.songs.length; i++) {
                const song = queueData.songs[i]
                try {
                    const result = await globalPlayer.search(song.url, {
                        requestedBy: { id: song.addedBy }
                    })
                    if (result && result.tracks && result.tracks.length > 0) {
                        newQueue.addTrack(result.tracks[0])
                    }
                } catch (error) {
                    console.error(`곡 추가 실패: ${song.title}`, error)
                }
            }

            // 이전 곡들도 추가 (뒤쪽에)
            for (let i = 0; i < queueData.currentIndex; i++) {
                const song = queueData.songs[i]
                try {
                    const result = await globalPlayer.search(song.url, {
                        requestedBy: { id: song.addedBy }
                    })
                    if (result && result.tracks && result.tracks.length > 0) {
                        newQueue.addTrack(result.tracks[0])
                    }
                } catch (error) {
                    console.error(`곡 추가 실패: ${song.title}`, error)
                }
            }

            queue = newQueue
            console.log(`[${interaction.guild.id}] Firebase 큐 동기화 완료: ${queue.tracks.size + 1}곡`)
            
        } catch (error) {
            console.error('Firebase 큐 동기화 실패:', error)
            return await interaction.reply({
                content: '❌ 저장된 재생목록을 로드하는 중 오류가 발생했습니다.',
                ephemeral: true
            })
        }
    }
    
    // 여전히 큐가 비어있다면
    if (!queue || (queue.tracks.size === 0 && !queue.currentTrack)) {
        return await interaction.reply({
            content: '❌ 재생할 노래가 없습니다. `/노래 추가` 명령어로 노래를 먼저 추가해주세요.',
            ephemeral: true
        })
    }

    if (queue.node.isPlaying()) {
        return await interaction.reply({
            content: '🎵 이미 음악이 재생 중입니다.',
            ephemeral: true
        })
    }

    try {
        queue.node.resume()
        
        const currentTrack = queue.currentTrack
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('▶️ 음악 재생')
            .setDescription(`**${currentTrack?.title || '알 수 없는 제목'}**`)
            .setThumbnail(currentTrack?.thumbnail)
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('재생 오류:', error)
        await interaction.reply({
            content: '❌ 음악 재생 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 일시정지 명령어 처리 함수
 */
async function handlePauseCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue || !queue.node.isPlaying()) {
        return await interaction.reply({
            content: '❌ 현재 재생 중인 음악이 없습니다.',
            ephemeral: true
        })
    }

    try {
        queue.node.pause()
        
        const currentTrack = queue.currentTrack
        const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('⏸️ 음악 일시정지')
            .setDescription(`**${currentTrack?.title || '알 수 없는 제목'}**`)
            .setThumbnail(currentTrack?.thumbnail)
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('일시정지 오류:', error)
        await interaction.reply({
            content: '❌ 음악 일시정지 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 정지 명령어 처리 함수
 */
async function handleStopCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue) {
        return await interaction.reply({
            content: '❌ 음성 채널에 연결되어 있지 않습니다.',
            ephemeral: true
        })
    }

    try {
        queue.delete()
        
        // Firebase 큐 초기화
        queueData.songs = []
        queueData.currentIndex = 0
        queueData.isPlaying = false
        await setQueueData(interaction.guild.id, queueData)
        serverQueues.set(interaction.guild.id, queueData)

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⏹️ 음악 정지')
            .setDescription('재생이 정지되고 재생목록이 초기화되었습니다.')
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('정지 오류:', error)
        await interaction.reply({
            content: '❌ 음악 정지 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 스킵 명령어 처리 함수
 */
async function handleSkipCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue || queue.tracks.size === 0) {
        return await interaction.reply({
            content: '❌ 스킵할 다음 곡이 없습니다.',
            ephemeral: true
        })
    }

    try {
        const currentTrack = queue.currentTrack
        queue.node.skip()
        
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('⏭️ 곡 스킵')
            .setDescription(`**${currentTrack?.title || '알 수 없는 제목'}** 을(를) 건너뛰었습니다.`)
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('스킵 오류:', error)
        await interaction.reply({
            content: '❌ 곡 스킵 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 재생목록 명령어 처리 함수
 */
async function handleQueueCommand(interaction, queueData) {
    await syncQueueWithPlayer(interaction.guild.id)
    const embed = createQueueEmbed(queueData, 0)
    await interaction.reply({ embeds: [embed], ephemeral: true })
}

/**
 * 노래 삭제 명령어 처리 함수 (체크박스 방식)
 */
async function handleRemoveCommand(interaction, queueData) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 삭제할 노래가 없습니다.',
            ephemeral: true
        })
    }

    // 첫 번째 페이지 표시
    await showRemovePage(interaction, queueData, 0, [])
}

/**
 * 노래 삭제 페이지를 표시하는 함수
 * @param {object} interaction - Discord interaction
 * @param {object} queueData - 큐 데이터
 * @param {number} page - 현재 페이지
 * @param {Array} selectedSongs - 선택된 노래 인덱스 배열
 */
async function showRemovePage(interaction, queueData, page, selectedSongs) {
    const songsPerPage = 10 // 한 페이지당 10곡 (버튼 제한 고려)
    const totalPages = Math.ceil(queueData.songs.length / songsPerPage)
    const startIndex = page * songsPerPage
    const endIndex = Math.min(startIndex + songsPerPage, queueData.songs.length)
    const songsToShow = queueData.songs.slice(startIndex, endIndex)

    // Embed 생성
    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🗑️ 노래 삭제 (다중 선택)')
        .setDescription(`삭제할 노래들을 선택하세요\n\n**선택된 노래: ${selectedSongs.length}개**`)
        .setFooter({ text: `페이지 ${page + 1}/${totalPages}` })
        .setTimestamp()

    // 현재 페이지의 노래들 표시
    songsToShow.forEach((song, index) => {
        const actualIndex = startIndex + index
        const isCurrentSong = actualIndex === queueData.currentIndex
        const isSelected = selectedSongs.includes(actualIndex)
        const status = isSelected ? '✅' : '⬜'
        const songInfo = `${status} ${isCurrentSong ? '🔊 ' : ''}**${song.title}**\n*${song.uploader}* - ${formatDuration(song.duration)}`
        
        embed.addFields({
            name: `${actualIndex + 1}번`,
            value: songInfo.length > 100 ? songInfo.slice(0, 97) + '...' : songInfo,
            inline: true
        })
    })

    // 버튼 생성
    const components = []
    
    // 노래 선택 버튼들 (한 행에 5개씩)
    for (let i = 0; i < songsToShow.length; i += 5) {
        const row = new ActionRowBuilder()
        for (let j = i; j < Math.min(i + 5, songsToShow.length); j++) {
            const actualIndex = startIndex + j
            const isSelected = selectedSongs.includes(actualIndex)
            const isCurrentSong = actualIndex === queueData.currentIndex
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`toggle_song_${interaction.guild.id}_${actualIndex}`)
                    .setLabel(`${actualIndex + 1}`)
                    .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setEmoji(isCurrentSong ? '🔊' : (isSelected ? '✅' : '⬜'))
            )
        }
        components.push(row)
    }

    // 네비게이션 및 액션 버튼
    const actionRow = new ActionRowBuilder()
    
    // 이전 페이지 버튼
    if (page > 0) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`remove_prev_${interaction.guild.id}_${page}_${selectedSongs.join(',')}`)
                .setLabel('◀️ 이전')
                .setStyle(ButtonStyle.Primary)
        )
    }

    // 다음 페이지 버튼
    if (page < totalPages - 1) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`remove_next_${interaction.guild.id}_${page}_${selectedSongs.join(',')}`)
                .setLabel('다음 ▶️')
                .setStyle(ButtonStyle.Primary)
        )
    }

    // 삭제 실행 버튼
    if (selectedSongs.length > 0) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`execute_remove_${interaction.guild.id}_${selectedSongs.join(',')}`)
                .setLabel(`선택된 ${selectedSongs.length}곡 삭제`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        )
    }

    // 취소 버튼
    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_remove_${interaction.guild.id}`)
            .setLabel('취소')
            .setStyle(ButtonStyle.Secondary)
    )

    if (actionRow.components.length > 0) {
        components.push(actionRow)
    }

    const replyOptions = {
        embeds: [embed],
        components: components,
        ephemeral: true
    }

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply(replyOptions)
    } else {
        await interaction.reply(replyOptions)
    }
}

/**
 * 여러 노래를 한번에 삭제하는 함수
 * @param {string} guildId - 길드 ID
 * @param {Array} songIndices - 삭제할 노래 인덱스 배열
 */
async function removeMultipleSongsFromQueue(guildId, songIndices) {
    try {
        const queueData = await getQueueData(guildId)
        
        // 인덱스 정렬 (큰 수부터 삭제해야 인덱스가 꼬이지 않음)
        const sortedIndices = songIndices.sort((a, b) => b - a)
        const removedSongs = []
        
        // 잘못된 인덱스 체크
        for (const index of sortedIndices) {
            if (index < 0 || index >= queueData.songs.length) {
                throw new Error(`잘못된 노래 인덱스: ${index}`)
            }
        }

        // Discord Player에서 먼저 삭제 (현재 재생 중인 곡 처리)
        const queue = globalPlayer?.nodes.get(guildId)
        let shouldSkipCurrent = false
        
        // 현재 재생 중인 곡이 삭제 대상인지 확인
        if (sortedIndices.includes(queueData.currentIndex)) {
            shouldSkipCurrent = true
        }

        // Firebase에서 삭제 (큰 인덱스부터)
        for (const index of sortedIndices) {
            const removedSong = queueData.songs[index]
            removedSongs.push(removedSong)
            queueData.songs.splice(index, 1)
            
            // 현재 인덱스 조정
            if (index < queueData.currentIndex) {
                queueData.currentIndex--
            }
            
            // Discord Player에서도 삭제
            if (queue && queue.tracks.size > 0) {
                const tracks = queue.tracks.toArray()
                let trackToRemove = null
                
                for (let i = 0; i < tracks.length; i++) {
                    if (tracks[i].url === removedSong.url) {
                        trackToRemove = tracks[i]
                        break
                    }
                }
                
                if (trackToRemove) {
                    queue.removeTrack(trackToRemove)
                }
            }
        }

        // 현재 재생 중인 곡이 삭제되었으면 스킵
        if (shouldSkipCurrent && queue && queue.currentTrack) {
            queue.node.skip()
        }

        // 현재 인덱스가 범위를 벗어났으면 조정
        if (queueData.currentIndex >= queueData.songs.length) {
            queueData.currentIndex = 0
        }

        // Firebase 업데이트
        await setQueueData(guildId, queueData)
        serverQueues.set(guildId, queueData)

        return {
            success: true,
            removedSongs: removedSongs,
            removedCount: removedSongs.length,
            remainingSongs: queueData.songs.length
        }
    } catch (error) {
        console.error(`[${guildId}] 여러 노래 삭제 오류:`, error)
        return {
            success: false,
            error: error.message
        }
    }
}

/**
 * 단일 노래 삭제 함수 (이전 버전 호환성 유지)
 * @param {string} guildId - 길드 ID
 * @param {number} songIndex - 삭제할 노래 인덱스
 */
async function removeSongFromQueue(guildId, songIndex) {
    const result = await removeMultipleSongsFromQueue(guildId, [songIndex])
    if (result.success) {
        return {
            success: true,
            removedSong: result.removedSongs[0],
            remainingSongs: result.remainingSongs
        }
    }
    return result
}

/**
 * 다음곡 명령어 처리 함수
 */
async function handleNextCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue || queue.tracks.size === 0) {
        return await interaction.reply({
            content: '❌ 다음 곡이 없습니다.',
            ephemeral: true
        })
    }

    try {
        queue.node.skip()
        
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('⏭️ 다음 곡으로 이동')
            .setDescription('다음 곡으로 이동했습니다.')
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('다음곡 오류:', error)
        await interaction.reply({
            content: '❌ 다음 곡으로 이동 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 이전곡 명령어 처리 함수
 */
async function handlePreviousCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue) {
        return await interaction.reply({
            content: '❌ 재생 중인 음악이 없습니다.',
            ephemeral: true
        })
    }

    try {
        // Discord Player에서는 이전 곡 기능이 제한적이므로
        // 현재 곡을 다시 시작하는 방식으로 구현
        queue.node.seek(0)
        
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('⏮️ 곡을 다시 시작합니다')
            .setDescription('현재 곡을 처음부터 다시 재생합니다.')
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('이전곡 오류:', error)
        await interaction.reply({
            content: '❌ 이전 곡으로 이동 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 나가기 명령어 처리 함수
 */
async function handleLeaveCommand(interaction, queueData) {
    const queue = globalPlayer?.nodes.get(interaction.guild.id)
    
    if (!queue) {
        return await interaction.reply({
            content: '❌ 음성 채널에 연결되어 있지 않습니다.',
            ephemeral: true
        })
    }

    try {
        queue.delete()
        
        // 큐 상태 업데이트 (노래는 유지하되 재생 상태만 false로)
        queueData.isPlaying = false
        await setQueueData(interaction.guild.id, queueData)
        serverQueues.set(interaction.guild.id, queueData)

        const embed = new EmbedBuilder()
            .setColor(0x808080)
            .setTitle('👋 음성 채널에서 나갔습니다')
            .setDescription('재생목록은 유지됩니다. 다시 노래를 추가하면 자동으로 연결됩니다.')
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    } catch (error) {
        console.error('나가기 오류:', error)
        await interaction.reply({
            content: '❌ 음성 채널에서 나가는 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}

/**
 * 음악 버튼 상호작용 처리 함수
 */
async function handleMusicButtonInteraction(interaction, queueData) {
    const guildId = interaction.guild.id
    const queue = globalPlayer?.nodes.get(guildId)

    if (interaction.customId === 'music_add_song') {
        // 노래 추가 모달 표시
        const modal = new ModalBuilder()
            .setCustomId('music_add_modal')
            .setTitle('🎵 노래 추가')

        const songInput = new TextInputBuilder()
            .setCustomId('song_input')
            .setLabel('YouTube URL 또는 검색어')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('예: https://www.youtube.com/watch?v=... 또는 "아이유 좋은날"')
            .setRequired(true)
            .setMaxLength(200)

        const firstRow = new ActionRowBuilder().addComponents(songInput)
        modal.addComponents(firstRow)

        await interaction.showModal(modal)
        return
        
    } else if (interaction.customId === 'music_show_queue') {
        // 재생목록 보기
        await syncQueueWithPlayer(guildId)
        const queueEmbed = createQueueEmbed(queueData, 0)
        await interaction.reply({ embeds: [queueEmbed], ephemeral: true })
        return
        
    } else if (interaction.customId === 'music_remove_song') {
        // 노래 삭제 선택 메뉴 표시
        if (queueData.songs.length === 0) {
            await interaction.reply({ 
                content: '❌ 삭제할 노래가 없습니다.', 
                ephemeral: true 
            })
            return
        }

        const options = queueData.songs.map((song, index) => ({
            label: song.title.length > 25 ? song.title.substring(0, 22) + '...' : song.title,
            value: index.toString(),
            description: `재생시간: ${formatDuration(song.duration)} | 추가자: ${song.addedBy}`,
            emoji: index === queueData.currentIndex ? '🎵' : '📄'
        }))

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('music_remove_select')
            .setPlaceholder('삭제할 노래를 선택하세요')
            .addOptions(options.slice(0, 25)) // Discord 제한으로 최대 25개

        const row = new ActionRowBuilder().addComponents(selectMenu)
        await interaction.reply({ 
            content: '🗑️ 삭제할 노래를 선택해주세요:', 
            components: [row], 
            ephemeral: true 
        })
        return
    }

    // 나머지 버튼들은 deferUpdate 필요
    await interaction.deferUpdate()

    try {
        if (interaction.customId === 'music_play_pause') {
            if (queue && queue.node.isPlaying()) {
                queue.node.pause()
            } else if (queue) {
                queue.node.resume()
            }
        } else if (interaction.customId === 'music_next') {
            if (queue && queue.tracks.size > 0) {
                queue.node.skip()
            }
        } else if (interaction.customId === 'music_previous') {
            if (queue) {
                queue.node.seek(0) // 현재 곡 처음부터 재생
            }
        } else if (interaction.customId === 'music_shuffle') {
            if (queue && queue.tracks.size > 1) {
                queue.tracks.shuffle()
            }
        } else if (interaction.customId === 'music_clear_queue') {
            if (queue) {
                queue.delete()
                
                queueData.songs = []
                queueData.currentIndex = 0
                queueData.isPlaying = false
                
                await setQueueData(guildId, queueData)
                serverQueues.set(guildId, queueData)
            }
        }

        // UI 업데이트
        await syncQueueWithPlayer(guildId)
        const updatedQueueData = serverQueues.get(guildId) || queueData
        const embed = createMusicPlayerEmbed(updatedQueueData, interaction.guild.name)
        const buttons = createMusicControlButtons(updatedQueueData)

        await interaction.editReply({
            embeds: [embed],
            components: buttons
        })
    } catch (error) {
        console.error('버튼 처리 오류:', error)
    }
}

/**
 * 모달 제출 처리 함수
 */
async function handleAddModalSubmit(interaction, queueData) {
    const query = interaction.fields.getTextInputValue('song_input')
    
    await interaction.deferReply({ ephemeral: true })

    try {
        const voiceChannel = interaction.member.voice.channel
        if (!voiceChannel) {
            await interaction.editReply({
                content: '❌ 음성 채널에 먼저 참여해주세요!'
            })
            return
        }

        // Discord Player로 노래 검색 및 재생
        const searchResult = await globalPlayer.search(query, {
            requestedBy: interaction.user
        })

        if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
            await interaction.editReply({
                content: '❌ 검색 결과를 찾을 수 없습니다.'
            })
            return
        }

        const track = searchResult.tracks[0]
        
        // Firebase 큐에도 추가
        await addSongToQueue(interaction.guild.id, {
            title: track.title,
            url: track.url,
            duration: track.durationMS ? Math.floor(track.durationMS / 1000) : 0,
            thumbnail: track.thumbnail,
            uploader: track.author || track.uploader || '알 수 없는 업로더',
            addedBy: interaction.user.id
        })

        // Discord Player로 재생
        const { queue } = await globalPlayer.play(voiceChannel, searchResult, {
            nodeOptions: {
                metadata: {
                    channel: interaction.channel,
                    requestedBy: interaction.user
                },
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 180000, // 3분
                leaveOnEnd: false,
                selfDeaf: true,
                volume: 80
            }
        })

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ 노래가 추가되었습니다!')
            .setDescription(`**${track.title}**`)
            .addFields(
                { name: '재생 시간', value: formatDuration(track.durationMS ? Math.floor(track.durationMS / 1000) : 0), inline: true },
                { name: '추가한 사람', value: `<@${interaction.user.id}>`, inline: true },
                { name: '재생목록 위치', value: `${queue.tracks.size + 1}번째`, inline: true }
            )
            .setThumbnail(track.thumbnail)
            .setTimestamp()

        await interaction.editReply({ embeds: [embed] })
    } catch (error) {
        console.error('노래 추가 오류:', error)
        await interaction.editReply({
            content: `❌ 노래를 추가하는 중 오류가 발생했습니다.\n오류: ${error.message}`
        })
    }
}

/**
 * 노래 삭제 선택 처리 함수
 */
async function handleRemoveSelectInteraction(interaction, queueData) {
    await interaction.deferUpdate()
    
    const songIndex = parseInt(interaction.values[0])
    const guildId = interaction.guild.id

    if (songIndex < 0 || songIndex >= queueData.songs.length) {
        await interaction.followUp({
            content: '❌ 잘못된 노래 번호입니다.',
            ephemeral: true
        })
        return
    }

    try {
        const removedSong = queueData.songs[songIndex]
        queueData.songs.splice(songIndex, 1)

        // 현재 인덱스 조정
        if (songIndex < queueData.currentIndex) {
            queueData.currentIndex--
        } else if (songIndex === queueData.currentIndex && queueData.currentIndex >= queueData.songs.length) {
            queueData.currentIndex = Math.max(0, queueData.songs.length - 1)
        }

        await setQueueData(guildId, queueData)
        serverQueues.set(guildId, queueData)

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🗑️ 노래가 삭제되었습니다')
            .setDescription(`**${removedSong.title}**`)
            .setTimestamp()

        await interaction.followUp({ embeds: [embed], ephemeral: true })
    } catch (error) {
        console.error('노래 삭제 오류:', error)
        await interaction.followUp({
            content: '❌ 노래 삭제 중 오류가 발생했습니다.',
            ephemeral: true
        })
    }
}