const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js')
const { DisTube } = require('distube')
const { YtDlpPlugin } = require('@distube/yt-dlp')
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, push, child } = require('firebase/database');
const firebaseConfig = require('../config/firebaseConfig');

// Firebase 앱 초기화
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// DisTube 인스턴스 (전역에서 하나만 사용)
let distube = null;

// 자동 퇴장 타이머 (3분 = 180초)
const AUTO_LEAVE_TIMEOUT = 3 * 60 * 1000; // 3분

/**
 * DisTube 인스턴스를 초기화하는 함수
 * @param {Client} client - Discord 클라이언트
 * @returns {DisTube} - DisTube 인스턴스
 */
function initializeDistube(client) {
    if (distube) return distube;
    
    distube = new DisTube(client, {
        leaveOnStop: false,
        leaveOnFinish: false,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: AUTO_LEAVE_TIMEOUT,
        emitNewSongOnly: true,
        emitAddSongWhenCreatingQueue: false,
        emitAddListWhenCreatingQueue: false,
        plugins: [
            new YtDlpPlugin({
                update: true,
            })
        ],
        ytdlOptions: {
            quality: 'highestaudio',
            filter: 'audioonly',
        },
        searchSongs: 1,
        searchCooldown: 30,
        emptyCooldown: 0,
        nsfw: false,
    });
    
    setupDistubeEvents(distube);
    return distube;
}

/**
 * DisTube 이벤트를 설정하는 함수
 * @param {DisTube} distube - DisTube 인스턴스
 */
function setupDistubeEvents(distube) {
    distube.on('playSong', (queue, song) => {
        console.log(`[${queue.textChannel.guild.id}] 재생 시작: ${song.name}`);
    });
    
    distube.on('addSong', (queue, song) => {
        console.log(`[${queue.textChannel.guild.id}] 노래 추가: ${song.name}`);
    });
    
    distube.on('error', (textChannel, error) => {
        console.error(`[${textChannel.guild.id}] DisTube 오류:`, error);
    });
    
    distube.on('empty', queue => {
        console.log(`[${queue.textChannel.guild.id}] 큐가 비어서 자동 퇴장`);
    });
    
    distube.on('disconnect', queue => {
        console.log(`[${queue.textChannel.guild.id}] 음성 채널에서 연결 해제`);
    });
    
    distube.on('finish', queue => {
        console.log(`[${queue.textChannel.guild.id}] 재생목록 완료`);
    });
}

/**
 * 서버의 큐 데이터를 Firebase에서 가져오는 함수
 * @param {string} guildId - 길드 ID
 * @returns {Promise<object>} - 큐 데이터
 */
async function getQueueData(guildId) {
    try {
        const dbRef = ref(database, `music/${guildId}/queue`);
        const snapshot = await get(dbRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            console.log(`[${guildId}] Firebase에서 큐 데이터 로드:`, {
                songsCount: data.songs?.length || 0,
                currentIndex: data.currentIndex || 0,
                isPlaying: data.isPlaying || false
            });
            
            // songs 배열의 각 노래에 URL이 있는지 확인
            if (data.songs && data.songs.length > 0) {
                data.songs.forEach((song, index) => {
                    if (!song.url) {
                        console.error(`[${guildId}] 노래 ${index + 1}에 URL이 없습니다:`, song);
                    }
                });
            }
            
            return data;
        }
        console.log(`[${guildId}] Firebase에 큐 데이터가 없습니다. 기본값 반환.`);
        return { songs: [], currentIndex: 0, isPlaying: false };
    } catch (error) {
        console.error(`[${guildId}] 큐 데이터 가져오기 실패:`, error);
        return { songs: [], currentIndex: 0, isPlaying: false };
    }
}

/**
 * 서버의 큐 데이터를 Firebase에 저장하는 함수
 * @param {string} guildId - 길드 ID
 * @param {object} queueData - 저장할 큐 데이터
 */
async function setQueueData(guildId, queueData) {
    try {
        // URL이 없는 노래들을 필터링
        if (queueData.songs && queueData.songs.length > 0) {
            const originalCount = queueData.songs.length;
            queueData.songs = queueData.songs.filter(song => song.url);
            const filteredCount = queueData.songs.length;
            
            if (originalCount !== filteredCount) {
                console.log(`[${guildId}] URL이 없는 노래 ${originalCount - filteredCount}개를 제거했습니다.`);
                
                // currentIndex 조정
                if (queueData.currentIndex >= queueData.songs.length) {
                    queueData.currentIndex = Math.max(0, queueData.songs.length - 1);
                }
            }
        }
        
        await set(ref(database, `music/${guildId}/queue`), queueData);
        console.log(`[${guildId}] 큐 데이터 저장 완료. 노래 ${queueData.songs.length}개`);
    } catch (error) {
        console.error(`[${guildId}] 큐 데이터 저장 실패:`, error);
    }
}

/**
 * 큐에 노래를 추가하는 함수
 * @param {string} guildId - 길드 ID
 * @param {object} songData - 노래 데이터
 */
async function addSongToQueue(guildId, songData) {
    // URL 검증
    if (!songData.url) {
        console.error(`[${guildId}] 노래 추가 실패: URL이 없습니다. songData:`, songData);
        throw new Error('노래 URL이 없습니다.');
    }
    
    console.log(`[${guildId}] 노래 추가: ${songData.title} (URL: ${songData.url})`);
    
    const queueData = await getQueueData(guildId);
    const newSong = {
        title: songData.title,
        url: songData.url,
        duration: songData.duration,
        thumbnail: songData.thumbnail,
        addedBy: songData.addedBy,
        addedAt: Date.now()
    };
    
    queueData.songs.push(newSong);
    await setQueueData(guildId, queueData);
    serverQueues.set(guildId, queueData);
    
    console.log(`[${guildId}] 노래 추가 완료. 현재 큐 크기: ${queueData.songs.length}`);
}

/**
 * 현재 재생 중인 노래 정보를 포맷팅하는 함수
 * @param {number} seconds - 초 단위 시간
 * @returns {string} - 포맷된 시간 문자열
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * DisTube 기반 음악 플레이어 임베드를 생성하는 함수
 * @param {string} guildId - 길드 ID
 * @param {string} guildName - 길드 이름
 * @returns {EmbedBuilder} - 음악 플레이어 임베드
 */
function createMusicPlayerEmbed(guildId, guildName) {
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 음악 플레이어')
        .setTimestamp();

    if (!distube) {
        embed.setDescription('DisTube가 초기화되지 않았습니다.');
        return embed;
    }

    const queue = distube.getQueue(guildId);
    if (!queue || !queue.songs || queue.songs.length === 0) {
        embed.setDescription('재생 목록이 비어있습니다.\n`/노래 추가` 명령어로 노래를 추가해보세요!');
        embed.setThumbnail('https://i.imgur.com/X8HLvgQ.png'); // 기본 이미지
        return embed;
    }

    const currentSong = queue.songs[0];
    const statusIcon = queue.playing ? '▶️' : '⏸️';
    
    embed.setDescription(`${statusIcon} **현재 재생 중**`)
        .addFields(
            { 
                name: '🎵 제목', 
                value: `**${currentSong.name}**`, 
                inline: false 
            },
            { 
                name: '⏱️ 재생 시간', 
                value: formatDuration(currentSong.duration), 
                inline: true 
            },
            { 
                name: '👤 추가한 사람', 
                value: `<@${currentSong.user.id}>`, 
                inline: true 
            },
            { 
                name: '📋 큐 정보', 
                value: `1 / ${queue.songs.length}곡`, 
                inline: true 
            }
        );

    if (currentSong.thumbnail) {
        embed.setThumbnail(currentSong.thumbnail);
    }

    return embed;
}

/**
 * DisTube 기반 음악 플레이어 컨트롤 버튼을 생성하는 함수
 * @param {string} guildId - 길드 ID
 * @returns {Array<ActionRowBuilder>} - 컨트롤 버튼들
 */
function createMusicControlButtons(guildId) {
    const queue = distube ? distube.getQueue(guildId) : null;
    const hasQueue = queue && queue.songs && queue.songs.length > 0;
    const hasMultipleSongs = hasQueue && queue.songs.length > 1;
    const isPlaying = hasQueue && queue.playing;
    
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
                .setEmoji(isPlaying ? '⏸️' : '▶️')
                .setLabel(isPlaying ? '  일시정지  ' : '  재 생  ')
                .setStyle(isPlaying ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!hasQueue),
            new ButtonBuilder()
                .setCustomId('music_next')
                .setEmoji('⏭️')
                .setLabel('  다음곡  ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasMultipleSongs)
        );

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
        );

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
                .setDisabled(!hasQueue),
            new ButtonBuilder()
                .setCustomId('music_leave')
                .setEmoji('👋')
                .setLabel('  나가기  ')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!hasQueue)
        );

    return [firstRow, secondRow, thirdRow];
}

/**
 * DisTube 기반 재생목록 임베드를 생성하는 함수
 * @param {string} guildId - 길드 ID
 * @param {number} page - 페이지 번호
 * @returns {EmbedBuilder} - 재생목록 임베드
 */
function createQueueEmbed(guildId, page = 0) {
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('📋 재생목록')
        .setTimestamp();

    if (!distube) {
        embed.setDescription('DisTube가 초기화되지 않았습니다.');
        return embed;
    }

    const queue = distube.getQueue(guildId);
    if (!queue || !queue.songs || queue.songs.length === 0) {
        embed.setDescription('재생목록이 비어있습니다.');
        return embed;
    }

    const songsPerPage = 10;
    const startIndex = page * songsPerPage;
    const endIndex = Math.min(startIndex + songsPerPage, queue.songs.length);
    const totalPages = Math.ceil(queue.songs.length / songsPerPage);

    let queueList = '';
    for (let i = startIndex; i < endIndex; i++) {
        const song = queue.songs[i];
        const isCurrentSong = i === 0; // DisTube에서는 첫 번째 곡이 현재 재생 중
        const icon = isCurrentSong ? '🎵' : '📄';
        const status = isCurrentSong ? ' **[재생 중]**' : '';
        
        queueList += `${icon} **${i + 1}.** ${song.name} (${formatDuration(song.duration)})${status}\n`;
    }

    embed.setDescription(queueList)
        .setFooter({ 
            text: `페이지 ${page + 1}/${totalPages} | 총 ${queue.songs.length}곡` 
        });

    return embed;
}

/**
 * YouTube URL에서 동영상 ID를 추출하는 함수
 * @param {string} url - YouTube URL
 * @returns {string|null} - 동영상 ID
 */
function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * YouTube 정보 추출 함수 (play-dl 사용)
 * @param {string} query - 검색어 또는 URL
 * @returns {Promise<object>} - 노래 정보
 */
async function getSongInfo(query) {
    try {
        let songInfo;
        
        // URL 검증
        if (play.yt_validate(query) === 'video') {
            // 유효한 YouTube URL인 경우
            songInfo = await play.video_info(query);
        } else if (play.yt_validate(query) === 'playlist') {
            // 플레이리스트인 경우 첫 번째 곡만 가져오기
            const playlist = await play.playlist_info(query, { incomplete: true });
            if (playlist.videos && playlist.videos.length > 0) {
                songInfo = playlist.videos[0];
            } else {
                throw new Error('플레이리스트가 비어있습니다.');
            }
        } else {
            // 검색어인 경우
            console.log(`[음악봇] YouTube에서 검색: "${query}"`);
            const searchResults = await play.search(query, { 
                limit: 1,
                source: { youtube: 'video' }
            });
            
            if (!searchResults || searchResults.length === 0) {
                throw new Error('검색 결과를 찾을 수 없습니다.');
            }
            
            songInfo = searchResults[0];
            console.log(`[음악봇] 검색 결과: ${songInfo.title}`);
        }
        
        if (!songInfo) {
            throw new Error('동영상 정보를 가져올 수 없습니다.');
        }
        
        return {
            title: songInfo.title || '제목 없음',
            url: songInfo.url,
            duration: songInfo.durationInSec || 0,
            thumbnail: songInfo.thumbnails?.[0]?.url || '',
            author: songInfo.channel?.name || '알 수 없음',
            viewCount: songInfo.views || 0
        };
    } catch (error) {
        console.error('YouTube 정보 가져오기 실패:', error);
        
        // 마지막 시도: YouTube ID 추출해서 기본 정보 반환
        const videoId = extractYouTubeId(query);
        if (videoId) {
            return {
                title: `검색어: ${query}`,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                duration: 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                author: '알 수 없음',
                viewCount: 0
            };
        }
        
        throw new Error(`노래 정보를 가져오는데 실패했습니다: ${error.message}`);
    }
}

/**
 * YouTube 검색 함수 (play-dl 사용, 현재는 getSongInfo에서 직접 처리하므로 사용하지 않음)
 * @param {string} query - 검색어
 * @returns {Promise<string|null>} - 첫 번째 검색 결과 URL
 */
async function searchYouTube(query) {
    // 이 함수는 현재 사용되지 않습니다. getSongInfo에서 직접 play.search()를 사용합니다.
    console.log('searchYouTube 함수가 호출되었지만, 현재는 사용되지 않습니다.');
    return null;
}

/**
 * 음성 채널에 연결하고 플레이어를 설정하는 함수
 * @param {VoiceChannel} voiceChannel - 연결할 음성 채널
 * @param {string} guildId - 길드 ID
 * @returns {Promise<object>} - { connection, player }
 */
async function connectToVoiceChannel(voiceChannel, guildId) {
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        
        // 플레이어 이벤트 설정
        player.on(AudioPlayerStatus.Playing, () => {
            console.log(`[${guildId}] 음악 재생 시작`);
            updatePlayingStatus(guildId, true);
        });

        player.on(AudioPlayerStatus.Paused, () => {
            console.log(`[${guildId}] 음악 일시정지`);
            updatePlayingStatus(guildId, false);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log(`[${guildId}] 음악 재생 완료, 다음 곡으로 이동`);
            playNextSong(guildId);
        });

        player.on('error', error => {
            console.error(`[${guildId}] 플레이어 오류:`, error);
            playNextSong(guildId);
        });

        // 연결 이벤트 설정
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`[${guildId}] 음성 채널 연결 완료`);
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`[${guildId}] 음성 채널 연결 해제`);
            voiceConnections.delete(guildId);
        });

        connection.subscribe(player);

        voiceConnections.set(guildId, {
            connection,
            player,
            isConnected: true,
            leaveTimer: null
        });

        // 연결 후 멤버 수 체크
        checkVoiceChannelMembers(guildId);

        return { connection, player };
    } catch (error) {
        console.error(`[${guildId}] 음성 채널 연결 실패:`, error);
        throw error;
    }
}

/**
 * ytdl-core를 사용하여 스트림을 생성하는 함수
 * @param {string} url - YouTube URL
 * @returns {Promise<object>} - 스트림 객체
 */
async function createYtdlStream(url) {
    try {
        console.log(`[스트림] ytdl-core로 스트림 생성 시도: ${url}`);
        
        // ytdl-core로 스트림 생성
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25, // 32MB
        });
        
        return {
            stream: stream,
            type: 'arbitrary', // ytdl-core는 arbitrary 타입 사용
        };
    } catch (error) {
        console.error('[스트림] ytdl-core 스트림 생성 실패:', error);
        throw error;
    }
}

/**
 * 현재 곡을 재생하는 함수
 * @param {string} guildId - 길드 ID
 * @param {number} retryCount - 재시도 횟수 (기본값: 0)
 * @returns {Promise<boolean>} - 재생 성공 여부
 */
async function playCurrentSong(guildId, retryCount = 0) {
    try {
        // Firebase에서 최신 큐 데이터 로드
        let queueData = await getQueueData(guildId);
        const voiceData = voiceConnections.get(guildId);

        if (!queueData || !voiceData || queueData.songs.length === 0) {
            console.log(`[${guildId}] 재생 조건 불만족: queueData=${!!queueData}, voiceData=${!!voiceData}, songs=${queueData?.songs?.length || 0}`);
            return false;
        }

        // 메모리 큐도 업데이트
        serverQueues.set(guildId, queueData);

        const currentSong = queueData.songs[queueData.currentIndex];
        
        // URL 검증 및 디버깅
        if (!currentSong.url) {
            console.error(`[${guildId}] URL이 없습니다. currentSong:`, currentSong);
            
            // Firebase에서 데이터를 다시 로드해보기
            const freshQueueData = await getQueueData(guildId);
            if (freshQueueData.songs.length > 0 && freshQueueData.songs[queueData.currentIndex]?.url) {
                console.log(`[${guildId}] Firebase에서 데이터를 다시 로드했습니다.`);
                serverQueues.set(guildId, freshQueueData);
                return await playCurrentSong(guildId); // 재귀 호출
            } else {
                console.error(`[${guildId}] Firebase에서도 URL을 찾을 수 없습니다.`);
                // 다음 곡으로 자동 이동
                setTimeout(() => playNextSong(guildId), 1000);
                return false;
            }
        }
        
        console.log(`[${guildId}] 재생 시작: ${currentSong.title} (URL: ${currentSong.url})`);

        // 오디오 스트림 생성 (play-dl 우선, 실패 시 ytdl-core 사용)
        let stream;
        let streamMethod = 'play-dl';
        
        try {
            // URL 최종 검증
            const urlToPlay = String(currentSong.url).trim();
            console.log(`[${guildId}] 스트림 생성 URL:`, urlToPlay);
            console.log(`[${guildId}] URL 타입:`, typeof urlToPlay);
            
            if (!urlToPlay || typeof urlToPlay !== 'string' || urlToPlay === 'undefined') {
                throw new Error(`잘못된 URL 형식: ${urlToPlay} (타입: ${typeof urlToPlay})`);
            }
            
            // play-dl로 먼저 시도
            try {
                console.log(`[${guildId}] play-dl로 스트림 생성 시도...`);
                console.log(`[${guildId}] URL 유효성 검사:`, play.yt_validate(urlToPlay));
                
                stream = await play.stream(urlToPlay, {
                    quality: 1, // 중간 품질
                    htmldata: false,
                    precache: 0,
                });
                
                if (!stream || !stream.stream) {
                    throw new Error('play-dl 스트림 생성 실패');
                }
                
                console.log(`[${guildId}] play-dl 스트림 생성 성공`);
                streamMethod = 'play-dl';
            } catch (playDlError) {
                console.warn(`[${guildId}] play-dl 실패, ytdl-core로 대체 시도:`, playDlError.message);
                
                // ytdl-core로 대체 시도
                stream = await createYtdlStream(urlToPlay);
                console.log(`[${guildId}] ytdl-core 스트림 생성 성공`);
                streamMethod = 'ytdl-core';
            }
            
        } catch (streamError) {
            console.error(`[${guildId}] 모든 스트림 방법 실패:`, streamError);
            console.error(`[${guildId}] 현재 노래 전체 객체:`, JSON.stringify(currentSong, null, 2));
            
            // 재시도 로직 (최대 2회)
            if (retryCount < 2) {
                console.log(`[${guildId}] 2초 후 재시도... (${retryCount + 1}/2)`);
                setTimeout(async () => {
                    try {
                        console.log(`[${guildId}] 재시도 중... (${retryCount + 1}/2)`);
                        const retrySuccess = await playCurrentSong(guildId, retryCount + 1);
                        if (!retrySuccess) {
                            console.log(`[${guildId}] 재시도 실패, 다음 곡으로 이동`);
                            playNextSong(guildId);
                        }
                    } catch (retryError) {
                        console.error(`[${guildId}] 재시도 중 오류:`, retryError);
                        playNextSong(guildId);
                    }
                }, 2000);
            } else {
                console.log(`[${guildId}] 최대 재시도 횟수 초과, 다음 곡으로 이동`);
                setTimeout(() => playNextSong(guildId), 1000);
            }
            return false;
        }

        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });

        voiceData.player.play(resource);
        
        // 재생 상태 업데이트
        queueData.isPlaying = true;
        await setQueueData(guildId, queueData);
        serverQueues.set(guildId, queueData);

        console.log(`[${guildId}] 재생 시작 완료 (방법: ${streamMethod})`);
        return true;
    } catch (error) {
        console.error(`[${guildId}] 음악 재생 실패:`, error);
        
        // 오류 발생 시 다음 곡으로 자동 이동
        setTimeout(() => {
            console.log(`[${guildId}] 오류로 인해 다음 곡으로 자동 이동`);
            playNextSong(guildId);
        }, 2000);
        
        return false;
    }
}

/**
 * 다음 곡으로 이동하는 함수
 * @param {string} guildId - 길드 ID
 */
async function playNextSong(guildId) {
    try {
        // Firebase에서 최신 큐 데이터 로드
        let queueData = await getQueueData(guildId);
        
        if (!queueData || queueData.songs.length === 0) {
            // 큐가 비어있으면 재생 정지
            stopMusic(guildId);
            return;
        }

        // 다음 곡으로 인덱스 이동
        queueData.currentIndex = (queueData.currentIndex + 1) % queueData.songs.length;
        
        // 마지막 곡이었다면 재생 정지
        if (queueData.currentIndex === 0 && queueData.songs.length > 1) {
            // 루프가 아닌 경우 정지 (설정에 따라 변경 가능)
            stopMusic(guildId);
            return;
        }

        await setQueueData(guildId, queueData);
        serverQueues.set(guildId, queueData);

        console.log(`[${guildId}] 다음 곡으로 이동: ${queueData.currentIndex + 1}/${queueData.songs.length}`);

        // 다음 곡 재생
        await playCurrentSong(guildId);
    } catch (error) {
        console.error(`[${guildId}] 다음 곡 재생 실패:`, error);
    }
}

/**
 * 음악 재생을 정지하는 함수
 * @param {string} guildId - 길드 ID
 */
function stopMusic(guildId) {
    const voiceData = voiceConnections.get(guildId);
    
    if (voiceData && voiceData.player) {
        voiceData.player.stop();
    }

    updatePlayingStatus(guildId, false);
}

/**
 * 음악을 일시정지하는 함수
 * @param {string} guildId - 길드 ID
 */
function pauseMusic(guildId) {
    const voiceData = voiceConnections.get(guildId);
    
    if (voiceData && voiceData.player) {
        voiceData.player.pause();
    }
}

/**
 * 일시정지된 음악을 재개하는 함수
 * @param {string} guildId - 길드 ID
 */
function resumeMusic(guildId) {
    const voiceData = voiceConnections.get(guildId);
    
    if (voiceData && voiceData.player) {
        voiceData.player.unpause();
    }
}

/**
 * 재생 상태를 업데이트하는 함수
 * @param {string} guildId - 길드 ID
 * @param {boolean} isPlaying - 재생 상태
 */
async function updatePlayingStatus(guildId, isPlaying) {
    try {
        const queueData = serverQueues.get(guildId);
        if (queueData) {
            queueData.isPlaying = isPlaying;
            await setQueueData(guildId, queueData);
            serverQueues.set(guildId, queueData);
        }
    } catch (error) {
        console.error(`[${guildId}] 재생 상태 업데이트 실패:`, error);
    }
}

/**
 * 음성 채널에서 나가는 함수
 * @param {string} guildId - 길드 ID
 */
function leaveVoiceChannel(guildId) {
    // 자동 퇴장 타이머 취소
    cancelLeaveTimer(guildId);
    
    const connection = getVoiceConnection(guildId);
    
    if (connection) {
        connection.destroy();
    }
    
    voiceConnections.delete(guildId);
}

/**
 * 음성채널의 멤버 수를 체크하고 자동 퇴장 타이머를 관리하는 함수
 * @param {string} guildId - 길드 ID
 */
function checkVoiceChannelMembers(guildId) {
    const voiceData = voiceConnections.get(guildId);
    if (!voiceData || !voiceData.connection) {
        return;
    }

    try {
        // 연결된 음성 채널 정보 가져오기
        const channelId = voiceData.connection.joinConfig.channelId;
        
        // 클라이언트를 통해 길드와 채널 정보 가져오기
        const guild = discordClient ? discordClient.guilds.cache.get(guildId) : null;
        
        if (!guild) {
            console.log(`[${guildId}] 길드 정보를 찾을 수 없음`);
            return;
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            console.log(`[${guildId}] 음성채널을 찾을 수 없음: ${channelId}`);
            return;
        }

        // 봇을 제외한 실제 사용자 수 계산
        const humanMembers = channel.members.filter(member => !member.user.bot);
        const memberCount = humanMembers.size;

        console.log(`[${guildId}] 음성채널 멤버 수 체크: ${memberCount}명 (채널: ${channel.name})`);

        if (memberCount === 0) {
            // 혼자 있으면 타이머 시작
            startLeaveTimer(guildId);
        } else {
            // 누군가 있으면 타이머 취소
            cancelLeaveTimer(guildId);
        }
    } catch (error) {
        console.error(`[${guildId}] 멤버 수 체크 오류:`, error);
    }
}

/**
 * 자동 퇴장 타이머를 시작하는 함수
 * @param {string} guildId - 길드 ID
 */
function startLeaveTimer(guildId) {
    const voiceData = voiceConnections.get(guildId);
    if (!voiceData) return;

    // 이미 타이머가 있으면 취소
    if (voiceData.leaveTimer) {
        clearTimeout(voiceData.leaveTimer);
    }

    console.log(`[${guildId}] 자동 퇴장 타이머 시작 (3분)`);

    voiceData.leaveTimer = setTimeout(() => {
        console.log(`[${guildId}] 자동 퇴장 실행`);
        
        // 다시 한 번 멤버 수 확인 (혹시 모를 상황 대비)
        try {
            const channelId = voiceData.connection.joinConfig.channelId;
            const guild = discordClient ? discordClient.guilds.cache.get(guildId) : null;
            const channel = guild?.channels.cache.get(channelId);
            
            if (channel) {
                const humanMembers = channel.members.filter(member => !member.user.bot);
                if (humanMembers.size > 0) {
                    console.log(`[${guildId}] 타이머 실행 시점에 멤버가 있어서 퇴장 취소`);
                    voiceData.leaveTimer = null;
                    return;
                }
            }
        } catch (error) {
            console.error(`[${guildId}] 최종 멤버 수 확인 오류:`, error);
        }

        // 자동 퇴장 실행
        autoLeaveVoiceChannel(guildId);
    }, AUTO_LEAVE_TIMEOUT);

    voiceConnections.set(guildId, voiceData);
}

/**
 * 자동 퇴장 타이머를 취소하는 함수
 * @param {string} guildId - 길드 ID
 */
function cancelLeaveTimer(guildId) {
    const voiceData = voiceConnections.get(guildId);
    if (!voiceData || !voiceData.leaveTimer) return;

    console.log(`[${guildId}] 자동 퇴장 타이머 취소`);
    
    clearTimeout(voiceData.leaveTimer);
    voiceData.leaveTimer = null;
    voiceConnections.set(guildId, voiceData);
}

/**
 * 자동으로 음성채널에서 나가는 함수
 * @param {string} guildId - 길드 ID
 */
async function autoLeaveVoiceChannel(guildId) {
    try {
        console.log(`[${guildId}] 자동 퇴장 - 3분간 혼자 있어서 음성채널에서 나감`);
        
        // 음악 정지
        stopMusic(guildId);
        
        // 음성채널에서 나가기
        leaveVoiceChannel(guildId);
        
        // 큐 상태 업데이트 (노래는 유지하되 재생 상태만 false로)
        const queueData = serverQueues.get(guildId);
        if (queueData) {
            queueData.isPlaying = false;
            await setQueueData(guildId, queueData);
            serverQueues.set(guildId, queueData);
        }
        
        console.log(`[${guildId}] 자동 퇴장 완료`);
    } catch (error) {
        console.error(`[${guildId}] 자동 퇴장 오류:`, error);
    }
}

// Discord 클라이언트 참조를 저장
let discordClient = null;

/**
 * 음성 상태 변화 이벤트 리스너를 설정하는 함수
 * @param {Client} client - Discord 클라이언트
 */
function setupVoiceStateListener(client) {
    discordClient = client; // 클라이언트 참조 저장
    client.on('voiceStateUpdate', (oldState, newState) => {
        const guildId = newState.guild.id;
        
        // 봇 자신의 상태 변화 처리
        if (newState.member?.user.id === client.user.id) {
            // 봇이 음성채널에서 나갔거나 연결이 해제된 경우
            if (!newState.channelId && oldState.channelId) {
                console.log(`[${guildId}] 봇이 음성채널에서 연결 해제됨`);
                
                const voiceData = voiceConnections.get(guildId);
                if (voiceData) {
                    // 타이머 취소 및 상태 정리
                    cancelLeaveTimer(guildId);
                    voiceConnections.delete(guildId);
                    
                    // 재생 상태 업데이트
                    updatePlayingStatus(guildId, false);
                }
            }
            return;
        }
        
        // 일반 유저의 상태 변화는 기존 로직 유지
        if (newState.member?.user.bot) return;
        const voiceData = voiceConnections.get(guildId);
        
        // 해당 서버에 봇이 음성채널에 연결되어 있지 않으면 무시
        if (!voiceData || !voiceData.isConnected) return;
        
        try {
            const botChannelId = voiceData.connection.joinConfig.channelId;
            
            // 봇이 있는 채널과 관련된 변화인지 확인
            const isOldChannelBot = oldState.channelId === botChannelId;
            const isNewChannelBot = newState.channelId === botChannelId;
            
            if (isOldChannelBot || isNewChannelBot) {
                console.log(`[${guildId}] 음성 상태 변화 감지:`, {
                    user: newState.member?.displayName,
                    oldChannel: oldState.channelId,
                    newChannel: newState.channelId,
                    botChannel: botChannelId
                });
                
                // 멤버 수 체크 (약간의 지연을 두어 상태 업데이트 완료 대기)
                setTimeout(() => {
                    checkVoiceChannelMembers(guildId);
                }, 1000);
            }
        } catch (error) {
            console.error(`[${guildId}] 음성 상태 업데이트 처리 오류:`, error);
        }
    });
    
    console.log('음성 상태 변화 이벤트 리스너 설정 완료');
}

module.exports = {
    initializeDistube, // DisTube 초기화 함수 export
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
                .setDescription('재생목록에서 노래를 삭제합니다')
                .addIntegerOption(option =>
                    option
                        .setName('번호')
                        .setDescription('삭제할 노래의 번호를 입력하세요')
                        .setRequired(true)
                        .setMinValue(1)
                )
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
            });
        }

        // DisTube 초기화 확인
        if (!distube) {
            distube = initializeDistube(interaction.client);
        }

        // 음성 채널 확인
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply({
                content: '❌ 음성 채널에 먼저 참여해주세요!',
                ephemeral: true
            });
        }

        // 권한 확인
        if (!voiceChannel.permissionsFor(interaction.guild.members.me).has([
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
        ])) {
            return await interaction.reply({
                content: '❌ 해당 음성 채널에 연결하거나 말할 권한이 없습니다.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === '플레이어') {
                await handlePlayerCommand(interaction);
            } else if (subcommand === '추가') {
                await handleAddCommand(interaction);
            } else if (subcommand === '재생') {
                await handlePlayCommand(interaction);
            } else if (subcommand === '일시정지') {
                await handlePauseCommand(interaction);
            } else if (subcommand === '정지') {
                await handleStopCommand(interaction);
            } else if (subcommand === '스킵') {
                await handleSkipCommand(interaction);
            } else if (subcommand === '목록') {
                await handleQueueCommand(interaction);
            } else if (subcommand === '삭제') {
                await handleRemoveCommand(interaction);
            } else if (subcommand === '다음곡') {
                await handleNextCommand(interaction);
            } else if (subcommand === '이전곡') {
                await handlePreviousCommand(interaction);
            } else if (subcommand === '나가기') {
                await handleLeaveCommand(interaction);
            }
        } catch (error) {
            console.error('음악 명령어 실행 오류:', error);
            
            const errorMessage = error.message || '알 수 없는 오류가 발생했습니다.';
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: `❌ 명령어 실행 중 오류가 발생했습니다.\n${errorMessage}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `❌ 명령어 실행 중 오류가 발생했습니다.\n${errorMessage}`,
                    ephemeral: true
                });
            }
        }
    }
};

/**
 * DisTube 기반 플레이어 명령어 처리 함수
 */
async function handlePlayerCommand(interaction) {
    const embed = createMusicPlayerEmbed(interaction.guild.id, interaction.guild.name);
    const buttons = createMusicControlButtons(interaction.guild.id);

    await interaction.reply({
        embeds: [embed],
        components: buttons
    });

    // 버튼 상호작용 수집기 설정
    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 600000 // 10분
    });

    collector.on('collect', async i => {
        await handleMusicButtonInteraction(i);
    });

    collector.on('end', () => {
        // 만료된 버튼들 비활성화
        const disabledButtons = createMusicControlButtons(interaction.guild.id).map(row => {
            const newRow = new ActionRowBuilder();
            row.components.forEach(button => {
                newRow.addComponents(ButtonBuilder.from(button).setDisabled(true));
            });
            return newRow;
        });

        reply.edit({ components: disabledButtons }).catch(() => {});
    });
}

/**
 * DisTube 기반 노래 추가 명령어 처리 함수
 */
async function handleAddCommand(interaction) {
    const query = interaction.options.getString('노래');
    const voiceChannel = interaction.member.voice.channel;
    
    await interaction.deferReply();

    try {
        console.log(`[${interaction.guild.id}] DisTube로 노래 추가 시도: ${query}`);
        
        // DisTube로 노래 재생/추가
        const song = await distube.play(voiceChannel, query, {
            textChannel: interaction.channel,
            member: interaction.member
        });

        // 노래 추가 성공 메시지
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ 노래가 추가되었습니다!')
            .setDescription(`**${song.name}**`)
            .addFields(
                { name: '재생 시간', value: formatDuration(song.duration), inline: true },
                { name: '추가한 사람', value: `<@${interaction.user.id}>`, inline: true },
                { name: '채널', value: song.uploader?.name || '알 수 없음', inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setTimestamp();

        // 큐 상태에 따른 메시지 추가
        const queue = distube.getQueue(interaction.guild.id);
        if (queue && queue.songs.length === 1) {
            embed.setFooter({ text: '🎵 재생을 시작합니다!' });
        } else if (queue) {
            embed.addFields({
                name: '재생목록 위치',
                value: `${queue.songs.length}번째`,
                inline: true
            });
        }

        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error(`[${interaction.guild.id}] DisTube 노래 추가 오류:`, error);
        
        let errorMessage = '❌ 노래를 추가하는 중 오류가 발생했습니다.';
        if (error.message.includes('No result')) {
            errorMessage = '❌ 검색 결과를 찾을 수 없습니다. 다른 검색어를 시도해보세요.';
        } else if (error.message.includes('age')) {
            errorMessage = '❌ 연령 제한이 있는 동영상입니다.';
        }
        
        await interaction.editReply({ content: errorMessage });
    }
}

/**
 * DisTube 기반 재생목록 명령어 처리 함수
 */
async function handleQueueCommand(interaction) {
    const embed = createQueueEmbed(interaction.guild.id, 0);
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * DisTube 기반 재생/일시정지 명령어 처리 함수
 */
async function handlePlayCommand(interaction) {
    try {
        const queue = distube.getQueue(interaction.guild.id);
        if (!queue) {
            return await interaction.reply({
                content: '❌ 재생할 노래가 없습니다. `/노래 추가` 명령어로 노래를 먼저 추가해주세요.',
                ephemeral: true
            });
        }

        if (queue.paused) {
            distube.resume(interaction.guild.id);
            await interaction.reply({ content: '▶️ 재생을 재개했습니다.' });
        } else {
            await interaction.reply({ content: '🎵 이미 재생 중입니다.' });
        }
    } catch (error) {
        await interaction.reply({ content: '❌ 재생 중 오류가 발생했습니다.', ephemeral: true });
    }
}

/**
 * DisTube 기반 일시정지 명령어 처리 함수
 */
async function handlePauseCommand(interaction) {
    try {
        const queue = distube.getQueue(interaction.guild.id);
        if (!queue) {
            return await interaction.reply({
                content: '❌ 재생 중인 노래가 없습니다.',
                ephemeral: true
            });
        }

        if (queue.paused) {
            await interaction.reply({ content: '❌ 이미 일시정지 상태입니다.', ephemeral: true });
        } else {
            distube.pause(interaction.guild.id);
            await interaction.reply({ content: '⏸️ 재생을 일시정지했습니다.' });
        }
    } catch (error) {
        await interaction.reply({ content: '❌ 일시정지 중 오류가 발생했습니다.', ephemeral: true });
    }
}

/**
 * DisTube 기반 정지 명령어 처리 함수
 */
async function handleStopCommand(interaction) {
    try {
        const queue = distube.getQueue(interaction.guild.id);
        if (!queue) {
            return await interaction.reply({
                content: '❌ 재생 중인 노래가 없습니다.',
                ephemeral: true
            });
        }

        distube.stop(interaction.guild.id);
        await interaction.reply({ content: '⏹️ 재생을 정지하고 재생목록을 초기화했습니다.' });
    } catch (error) {
        await interaction.reply({ content: '❌ 정지 중 오류가 발생했습니다.', ephemeral: true });
    }
}

/**
 * DisTube 기반 스킵 명령어 처리 함수
 */
async function handleSkipCommand(interaction) {
    try {
        const queue = distube.getQueue(interaction.guild.id);
        if (!queue) {
            return await interaction.reply({
                content: '❌ 재생 중인 노래가 없습니다.',
                ephemeral: true
            });
        }

        if (queue.songs.length === 1) {
            return await interaction.reply({
                content: '❌ 스킵할 다음 곡이 없습니다.',
                ephemeral: true
            });
        }

        const currentSong = queue.songs[0];
        distube.skip(interaction.guild.id);
        
        await interaction.reply({ 
            content: `⏭️ **${currentSong.name}**을(를) 스킵했습니다.` 
        });
    } catch (error) {
        await interaction.reply({ content: '❌ 스킵 중 오류가 발생했습니다.', ephemeral: true });
    }
}

/**
 * DisTube 기반 나가기 명령어 처리 함수
 */
async function handleLeaveCommand(interaction) {
    try {
        const queue = distube.getQueue(interaction.guild.id);
        if (!queue) {
            return await interaction.reply({
                content: '❌ 음성 채널에 연결되어 있지 않습니다.',
                ephemeral: true
            });
        }

        distube.leave(interaction.guild.id);
        await interaction.reply({ content: '👋 음성 채널에서 나갔습니다.' });
    } catch (error) {
        await interaction.reply({ content: '❌ 나가기 중 오류가 발생했습니다.', ephemeral: true });
    }
}

/**
 * 노래 삭제 명령어 처리 함수
 */
async function handleRemoveCommand(interaction, queueData) {
    const songNumber = interaction.options.getInteger('번호');
    const songIndex = songNumber - 1;

    if (songIndex < 0 || songIndex >= queueData.songs.length) {
        return await interaction.reply({
            content: '❌ 잘못된 노래 번호입니다.',
            ephemeral: true
        });
    }

    const removedSong = queueData.songs[songIndex];
    queueData.songs.splice(songIndex, 1);

    // 현재 인덱스 조정
    if (songIndex < queueData.currentIndex) {
        queueData.currentIndex--;
    } else if (songIndex === queueData.currentIndex && queueData.currentIndex >= queueData.songs.length) {
        queueData.currentIndex = 0;
    }

    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🗑️ 노래가 삭제되었습니다')
        .setDescription(`**${removedSong.title}**`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 다음곡 명령어 처리 함수
 */
async function handleNextCommand(interaction, queueData) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 재생목록이 비어있습니다.',
            ephemeral: true
        });
    }

    queueData.currentIndex = (queueData.currentIndex + 1) % queueData.songs.length;
    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    const currentSong = queueData.songs[queueData.currentIndex];
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('⏭️ 다음 곡으로 이동')
        .setDescription(`**${currentSong.title}**`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 이전곡 명령어 처리 함수
 */
async function handlePreviousCommand(interaction, queueData) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 재생목록이 비어있습니다.',
            ephemeral: true
        });
    }

    queueData.currentIndex = queueData.currentIndex > 0 
        ? queueData.currentIndex - 1 
        : queueData.songs.length - 1;
    
    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    const currentSong = queueData.songs[queueData.currentIndex];
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('⏮️ 이전 곡으로 이동')
        .setDescription(`**${currentSong.title}**`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * DisTube 기반 음악 버튼 상호작용 처리 함수
 */
async function handleMusicButtonInteraction(interaction) {
    const guildId = interaction.guild.id;

    try {
        if (interaction.customId === 'music_add_song') {
            // 노래 추가 모달 표시
            const modal = new ModalBuilder()
                .setCustomId('music_add_modal')
                .setTitle('🎵 노래 추가');

            const songInput = new TextInputBuilder()
                .setCustomId('song_input')
                .setLabel('YouTube URL 또는 검색어')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('예: https://www.youtube.com/watch?v=... 또는 "아이유 좋은날"')
                .setRequired(true)
                .setMaxLength(200);

            const firstRow = new ActionRowBuilder().addComponents(songInput);
            modal.addComponents(firstRow);

            await interaction.showModal(modal);
            return;
            
        } else if (interaction.customId === 'music_show_queue') {
            // 재생목록 보기
            const queueEmbed = createQueueEmbed(guildId, 0);
            await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
            return;
            
        } else if (interaction.customId === 'music_play_pause') {
            await interaction.deferUpdate();
            const queue = distube.getQueue(guildId);
            if (!queue) return;
            
            if (queue.paused) {
                distube.resume(guildId);
            } else {
                distube.pause(guildId);
            }
            
        } else if (interaction.customId === 'music_next') {
            await interaction.deferUpdate();
            const queue = distube.getQueue(guildId);
            if (queue && queue.songs.length > 1) {
                distube.skip(guildId);
            }
            
        } else if (interaction.customId === 'music_previous') {
            await interaction.deferUpdate();
            const queue = distube.getQueue(guildId);
            if (queue && queue.songs.length > 1) {
                distube.previous(guildId);
            }
            
        } else if (interaction.customId === 'music_shuffle') {
            await interaction.deferUpdate();
            const queue = distube.getQueue(guildId);
            if (queue && queue.songs.length > 1) {
                distube.shuffle(guildId);
            }
            
        } else if (interaction.customId === 'music_clear_queue') {
            await interaction.deferUpdate();
            distube.stop(guildId);
            
        } else if (interaction.customId === 'music_leave') {
            await interaction.deferUpdate();
            distube.leave(guildId);
        }

        // UI 업데이트 (모달이 아닌 경우)
        if (!interaction.customId.includes('modal') && interaction.deferred) {
            const embed = createMusicPlayerEmbed(guildId, interaction.guild.name);
            const buttons = createMusicControlButtons(guildId);

            await interaction.editReply({
                embeds: [embed],
                components: buttons
            });
        }
    } catch (error) {
        console.error(`[${guildId}] 버튼 상호작용 오류:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ 처리 중 오류가 발생했습니다.', ephemeral: true });
        }
    }
}

/**
 * 모달 제출 처리 함수
 */
async function handleAddModalSubmit(interaction, queueData) {
    const query = interaction.fields.getTextInputValue('song_input');
    
    await interaction.deferReply({ ephemeral: true });

    try {
        const songInfo = await getSongInfo(query);
        
        await addSongToQueue(interaction.guild.id, {
            ...songInfo,
            addedBy: interaction.user.id
        });

        // queueData 업데이트
        const updatedQueueData = await getQueueData(interaction.guild.id);
        serverQueues.set(interaction.guild.id, updatedQueueData);

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ 노래가 추가되었습니다!')
            .setDescription(`**${songInfo.title}**`)
            .addFields(
                { name: '재생 시간', value: formatDuration(songInfo.duration), inline: true },
                { name: '추가한 사람', value: `<@${interaction.user.id}>`, inline: true },
                { name: '재생목록 위치', value: `${updatedQueueData.songs.length}번째`, inline: true }
            )
            .setThumbnail(songInfo.thumbnail)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('노래 추가 오류:', error);
        await interaction.editReply({
            content: `❌ 노래를 추가하는 중 오류가 발생했습니다.\n오류: ${error.message}`
        });
    }
}

/**
 * 노래 삭제 선택 처리 함수
 */
async function handleRemoveSelectInteraction(interaction, queueData) {
    await interaction.deferUpdate();
    
    const songIndex = parseInt(interaction.values[0]);
    const guildId = interaction.guild.id;

    if (songIndex < 0 || songIndex >= queueData.songs.length) {
        await interaction.followUp({
            content: '❌ 잘못된 노래 번호입니다.',
            ephemeral: true
        });
        return;
    }

    const removedSong = queueData.songs[songIndex];
    queueData.songs.splice(songIndex, 1);

    // 현재 인덱스 조정
    if (songIndex < queueData.currentIndex) {
        queueData.currentIndex--;
    } else if (songIndex === queueData.currentIndex && queueData.currentIndex >= queueData.songs.length) {
        queueData.currentIndex = Math.max(0, queueData.songs.length - 1);
    }

    await setQueueData(guildId, queueData);
    serverQueues.set(guildId, queueData);

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🗑️ 노래가 삭제되었습니다')
        .setDescription(`**${removedSong.title}**`)
        .setTimestamp();

    await interaction.followUp({ embeds: [embed], ephemeral: true });
}

/**
 * 재생 명령어 처리 함수
 */
async function handlePlayCommand(interaction, queueData, voiceChannel) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 재생할 노래가 없습니다. `/노래 추가` 명령어로 노래를 먼저 추가해주세요.',
            ephemeral: true
        });
    }

    let voiceData = voiceConnections.get(interaction.guild.id);
    
    // 음성 채널에 연결되어 있지 않다면 연결
    if (!voiceData || !voiceData.isConnected) {
        try {
            voiceData = await connectToVoiceChannel(voiceChannel, interaction.guild.id);
        } catch (error) {
            return await interaction.reply({
                content: '❌ 음성 채널에 연결할 수 없습니다.',
                ephemeral: true
            });
        }
    }

    // 일시정지 상태라면 재개, 아니라면 처음부터 재생
    if (queueData.isPlaying) {
        return await interaction.reply({
            content: '🎵 이미 음악이 재생 중입니다.',
            ephemeral: true
        });
    } else {
        // 일시정지 상태에서 재개 시도
        resumeMusic(interaction.guild.id);
        
        // 잠시 기다린 후 상태 확인
        setTimeout(async () => {
            const currentQueueData = await getQueueData(interaction.guild.id);
            if (!currentQueueData.isPlaying) {
                // 재개가 안 되었다면 새로 재생
                await playCurrentSong(interaction.guild.id);
            }
        }, 100);
    }

    const currentSong = queueData.songs[queueData.currentIndex];
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('▶️ 음악 재생')
        .setDescription(`**${currentSong.title}**`)
        .setThumbnail(currentSong.thumbnail)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 일시정지 명령어 처리 함수
 */
async function handlePauseCommand(interaction, queueData) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 재생 중인 노래가 없습니다.',
            ephemeral: true
        });
    }

    if (!queueData.isPlaying) {
        return await interaction.reply({
            content: '❌ 현재 재생 중인 음악이 없습니다.',
            ephemeral: true
        });
    }

    pauseMusic(interaction.guild.id);

    const currentSong = queueData.songs[queueData.currentIndex];
    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('⏸️ 음악 일시정지')
        .setDescription(`**${currentSong.title}**`)
        .setThumbnail(currentSong.thumbnail)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 정지 명령어 처리 함수
 */
async function handleStopCommand(interaction, queueData) {
    const voiceData = voiceConnections.get(interaction.guild.id);
    
    if (!voiceData) {
        return await interaction.reply({
            content: '❌ 음성 채널에 연결되어 있지 않습니다.',
            ephemeral: true
        });
    }

    // 음악 정지
    stopMusic(interaction.guild.id);

    // 큐 초기화
    queueData.songs = [];
    queueData.currentIndex = 0;
    queueData.isPlaying = false;
    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('⏹️ 음악 정지')
        .setDescription('재생이 정지되고 재생목록이 초기화되었습니다.')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 스킵 명령어 처리 함수
 */
async function handleSkipCommand(interaction, queueData) {
    if (queueData.songs.length === 0) {
        return await interaction.reply({
            content: '❌ 재생목록이 비어있습니다.',
            ephemeral: true
        });
    }

    if (queueData.songs.length === 1) {
        return await interaction.reply({
            content: '❌ 스킵할 다음 곡이 없습니다.',
            ephemeral: true
        });
    }

    const currentSong = queueData.songs[queueData.currentIndex];
    
    // 다음 곡으로 이동
    queueData.currentIndex = (queueData.currentIndex + 1) % queueData.songs.length;
    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    // 다음 곡 재생
    await playCurrentSong(interaction.guild.id);

    const nextSong = queueData.songs[queueData.currentIndex];
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('⏭️ 곡 스킵')
        .setDescription(`**${currentSong.title}** → **${nextSong.title}**`)
        .setThumbnail(nextSong.thumbnail)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 나가기 명령어 처리 함수
 */
async function handleLeaveCommand(interaction, queueData) {
    const voiceData = voiceConnections.get(interaction.guild.id);
    
    if (!voiceData) {
        return await interaction.reply({
            content: '❌ 음성 채널에 연결되어 있지 않습니다.',
            ephemeral: true
        });
    }

    // 음악 정지
    stopMusic(interaction.guild.id);

    // 음성 채널에서 나가기 (타이머도 자동으로 취소됨)
    leaveVoiceChannel(interaction.guild.id);

    // 큐 상태 업데이트 (노래는 유지하되 재생 상태만 false로)
    queueData.isPlaying = false;
    await setQueueData(interaction.guild.id, queueData);
    serverQueues.set(interaction.guild.id, queueData);

    const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('👋 음성 채널에서 나갔습니다')
        .setDescription('재생목록은 유지됩니다. 다시 노래를 추가하면 자동으로 연결됩니다.')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
