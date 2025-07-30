const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')

/**
 * 배틀태그를 API 형식으로 변환하는 함수 (# -> -)
 * @param {string} battletag - 원본 배틀태그
 * @returns {string} - API용 배틀태그
 */
function formatBattletag(battletag) {
  return battletag.replace('#', '-')
}

/**
 * 티어 이름을 한국어로 변환하는 함수
 * @param {string} division - 영어 티어 이름
 * @returns {string} - 한국어 티어 이름
 */
function translateTier(division) {
  const tierMap = {
    'bronze': '브론즈',
    'silver': '실버', 
    'gold': '골드',
    'platinum': '플래티넘',
    'diamond': '다이아몬드',
    'master': '마스터',
    'grandmaster': '그랜드마스터',
    'champion': '챔피언'
  }
  
  return tierMap[division] || division
}

/**
 * 역할 이름을 한국어로 변환하는 함수
 * @param {string} role - 영어 역할 이름
 * @returns {string} - 한국어 역할 이름
 */
function translateRole(role) {
  const roleMap = {
    'tank': '탱커',
    'damage': '딜러',
    'support': '서포터'
  }
  
  return roleMap[role] || role
}

/**
 * 오버워치 플레이어 정보를 가져오는 함수
 * @param {string} battletag - 플레이어 배틀태그
 * @returns {Promise<object>} - API 응답 데이터
 */
async function fetchPlayerData(battletag) {
  const apiUrl = `https://overfast-api.tekrop.fr/players/${formatBattletag(battletag)}`
  
  try {
    const response = await fetch(apiUrl)
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || '플레이어 정보를 가져올 수 없습니다')
    }
    
    return data
  } catch (error) {
    throw error
  }
}

/**
 * 시간(초)을 시:분 형식으로 변환하는 함수
 * @param {number} seconds - 초 단위 시간
 * @returns {string} - 포맷된 시간 문자열
 */
function formatPlayTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours}시간 ${minutes}분`
  }
  return `${minutes}분`
}

/**
 * 숫자를 적절하게 포맷팅하는 함수
 * @param {number} num - 포맷팅할 숫자
 * @returns {string} - 포맷된 숫자 문자열
 */
function formatNumber(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toFixed(2)
}

/**
 * 영웅 이름을 한국어로 변환하는 함수
 * @param {string} heroName - 영어 영웅 이름
 * @returns {string} - 한국어 영웅 이름
 */
function translateHeroName(heroName) {
  const heroMap = {
    'ana': '아나',
    'mercy': '메르시',
    'brigitte': '브리기테',
    'juno': '주노',
    'moira': '모이라',
    'kiriko': '키리코',
    'lucio': '루시우',
    'illari': '일리아리',
    'zenyatta': '젠야타',
    'soldier-76': '솔저: 76',
    'cassidy': '캐서디',
    'sojourn': '소전',
    'ashe': '애쉬',
    'mei': '메이',
    'widowmaker': '위도우메이커',
    'bastion': '바스티온',
    'reinhardt': '라인하르트',
    'winston': '윈스턴',
    'dva': 'D.Va',
    'sigma': '시그마',
    'orisa': '오리사',
    'roadhog': '로드호그',
    'wrecking-ball': '레킹볼',
    'zarya': '자리야',
    'mauga': '마우가',
    'junker-queen': '정커 퀸',
    'ramattra': '라마트라',
    'tracer': '트레이서',
    'genji': '겐지',
    'pharah': '파라',
    'reaper': '리퍼',
    'sombra': '솜브라',
    'torbjorn': '토르비욘',
    'hanzo': '한조',
    'junkrat': '정크랫',
    'symmetra': '시메트라',
    'echo': '에코',
    'venture': '벤처',
    'bastion': '바스티온',
    'hazard': '해저드',
    'freya': '프레야',
    'doomfist': '둠피스트',
    'baptiste': '바티스트',
  }
  
  return heroMap[heroName] || heroName
}

/**
 * 플레이어 정보 임베드를 생성하는 함수
 * @param {object} playerData - 플레이어 데이터
 * @param {string} battletag - 원본 배틀태그
 * @returns {EmbedBuilder} - Discord 임베드
 */
function createPlayerEmbed(playerData, battletag) {
  const summary = playerData.summary
  const stats = playerData.stats
  
  const embed = new EmbedBuilder()
    .setColor(0xf99e1a)
    .setTitle(`🎮 ${summary.username}의 오버워치 전적`)
    .setThumbnail(summary.avatar)
    .setTimestamp()
  
  // 기본 정보 섹션
  let basicInfo = `**배틀태그**: ${battletag}\n`
  
  if (summary.title) {
    basicInfo += `**칭호**: ${summary.title}\n`
  }
  
  if (summary.endorsement) {
    basicInfo += `**추천 레벨**: ${summary.endorsement.level}레벨\n`
  }
  
  if (summary.last_updated_at) {
    const lastUpdate = new Date(summary.last_updated_at * 1000)
    basicInfo += `**마지막 업데이트**: ${lastUpdate.toLocaleDateString('ko-KR')}`
  }
  
  embed.addFields({
    name: '📋 기본 정보',
    value: basicInfo,
    inline: false
  })
  
  // 경쟁전 티어 정보
  if (summary.competitive && summary.competitive.pc) {
    const comp = summary.competitive.pc
    let compInfo = ''
    
    const roles = ['tank', 'damage', 'support']
    
    roles.forEach(role => {
      if (comp[role]) {
        const roleData = comp[role]
        const koreanRole = translateRole(role)
        const koreanTier = translateTier(roleData.division)
        compInfo += `**${koreanRole}**: ${koreanTier} ${roleData.tier}\n`
      }
    })
    
    if (compInfo) {
      if (comp.season) {
        compInfo += `\n**시즌**: ${comp.season}`
      }
      
      embed.addFields({
        name: '🏆 경쟁전 티어',
        value: compInfo,
        inline: false
      })
    }
  }
  
  // PC 통계가 있는 경우에만 표시
  if (stats && stats.pc) {
    // 빠른대전 정보
    if (stats.pc.quickplay) {
      const qpData = stats.pc.quickplay
      let qpInfo = ''
      
      // 총 플레이 시간
      if (qpData.career_stats && qpData.career_stats['all-heroes']) {
        const gameStats = qpData.career_stats['all-heroes'].find(cat => cat.category === 'game')
        if (gameStats) {
          const timePlayedStat = gameStats.stats.find(stat => stat.key === 'time_played')
          if (timePlayedStat) {
            qpInfo += `**총 플레이 시간**: ${formatPlayTime(timePlayedStat.value)}\n`
          }
        }
      }
      
      // 모스트 3영웅 (플레이 시간 기준)
      if (qpData.heroes_comparisons && qpData.heroes_comparisons.time_played) {
        const topHeroes = qpData.heroes_comparisons.time_played.values.slice(0, 3)
        if (topHeroes.length > 0) {
          qpInfo += `**모스트 영웅**:\n`
          topHeroes.forEach((hero, index) => {
            const heroKorean = translateHeroName(hero.hero)
            const playTime = formatPlayTime(hero.value)
            
            // 추가 통계 가져오기
            const elimPerLife = qpData.heroes_comparisons.eliminations_per_life?.values.find(h => h.hero === hero.hero)?.value || 0
            
            // 서포터 영웅 목록
            const supportHeroes = ['ana', 'mercy', 'brigitte', 'juno', 'moira', 'kiriko', 'lucio', 'illari', 'zenyatta']
            
            let additionalStats = `목숨당 처치: ${formatNumber(elimPerLife)}`
            
            if (supportHeroes.includes(hero.hero)) {
              // 서포터는 힐량 표시
              const healingPer10Min = qpData.heroes_comparisons.healing_done_avg_per_10_min?.values.find(h => h.hero === hero.hero)?.value || 0
              additionalStats += `, 10분당 힐량: ${formatNumber(healingPer10Min)}`
            } else {
              // 나머지는 처치량 표시
              const elimPer10Min = qpData.heroes_comparisons.eliminations_avg_per_10_min?.values.find(h => h.hero === hero.hero)?.value || 0
              additionalStats += `, 10분당 처치: ${formatNumber(elimPer10Min)}`
            }
            
            qpInfo += `${index + 1}. **${heroKorean}** (${playTime})\n   ${additionalStats}\n`
          })
        }
      }
      
      if (qpInfo) {
        embed.addFields({
          name: '🎯 빠른대전',
          value: qpInfo,
          inline: true
        })
      }
    }
    
    // 경쟁전 정보
    if (stats.pc.competitive) {
      const compData = stats.pc.competitive
      let compStatsInfo = ''
      
      // 총 플레이 시간
      if (compData.career_stats && compData.career_stats['all-heroes']) {
        const gameStats = compData.career_stats['all-heroes'].find(cat => cat.category === 'game')
        if (gameStats) {
          const timePlayedStat = gameStats.stats.find(stat => stat.key === 'time_played')
          if (timePlayedStat) {
            compStatsInfo += `**총 플레이 시간**: ${formatPlayTime(timePlayedStat.value)}\n`
          }
        }
      }
      
      // 모스트 3영웅 (플레이 시간 기준)
      if (compData.heroes_comparisons && compData.heroes_comparisons.time_played) {
        const topHeroes = compData.heroes_comparisons.time_played.values.slice(0, 3)
        if (topHeroes.length > 0) {
          compStatsInfo += `**모스트 영웅**:\n`
          topHeroes.forEach((hero, index) => {
            const heroKorean = translateHeroName(hero.hero)
            const playTime = formatPlayTime(hero.value)
            
            // 추가 통계 가져오기
            const elimPerLife = compData.heroes_comparisons.eliminations_per_life?.values.find(h => h.hero === hero.hero)?.value || 0
            
            // 서포터 영웅 목록
            const supportHeroes = ['ana', 'mercy', 'brigitte', 'juno', 'moira', 'kiriko', 'lucio', 'illari', 'zenyatta']
            
            let additionalStats = `목숨당 처치: ${formatNumber(elimPerLife)}`
            
            if (supportHeroes.includes(hero.hero)) {
              // 서포터는 힐량 표시
              const healingPer10Min = compData.heroes_comparisons.healing_done_avg_per_10_min?.values.find(h => h.hero === hero.hero)?.value || 0
              additionalStats += `, 10분당 힐량: ${formatNumber(healingPer10Min)}`
            } else {
              // 나머지는 처치량 표시
              const elimPer10Min = compData.heroes_comparisons.eliminations_avg_per_10_min?.values.find(h => h.hero === hero.hero)?.value || 0
              additionalStats += `, 10분당 처치: ${formatNumber(elimPer10Min)}`
            }
            
            compStatsInfo += `${index + 1}. **${heroKorean}** (${playTime})\n   ${additionalStats}\n`
          })
        }
      }
      
      if (compStatsInfo) {
        embed.addFields({
          name: '⚔️ 경쟁전',
          value: compStatsInfo,
          inline: true
        })
      }
    }
  }
  
  // 네임카드가 있으면 추가
  if (summary.namecard) {
    embed.setImage(summary.namecard)
  }
  
  embed.setFooter({
    text: 'Overfast API 제공',
    iconURL: 'https://static.playoverwatch.com/img/pages/career/icons/role/tank-f64702b684.svg'
  })
  
  return embed
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('옵치전적')
    .setDescription('오버워치 플레이어의 전적을 조회합니다')
    .addStringOption(option =>
      option
        .setName('배틀태그')
        .setDescription('조회할 플레이어의 배틀태그 (예: 플레이어#1234)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const battletag = interaction.options.getString('배틀태그')
    
    // 배틀태그 형식 검증
    if (!battletag.includes('#')) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ 오류')
        .setDescription('올바른 배틀태그 형식을 입력해주세요.\n예시: `플레이어#1234`')
      
      return await interaction.reply({ embeds: [errorEmbed], ephemeral: true })
    }
    
    await interaction.deferReply()
    
    try {
      const playerData = await fetchPlayerData(battletag)
      const embed = createPlayerEmbed(playerData, battletag)
      
      await interaction.editReply({ embeds: [embed] })
      
    } catch (error) {
      console.error('오버워치 전적 조회 오류:', error)
      
      let errorMessage = '알 수 없는 오류가 발생했습니다'
      
      if (error.message.includes('rate limited')) {
        errorMessage = 'API 요청 한도가 초과되었습니다. 5초 후 다시 시도해주세요'
      } else if (error.message.includes('not found') || error.message.includes('404')) {
        errorMessage = '플레이어를 찾을 수 없습니다. 배틀태그를 확인해주세요'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ 전적 조회 실패')
        .setDescription(errorMessage)
        .addFields({
          name: '💡 도움말',
          value: '• 배틀태그가 정확한지 확인해주세요\n• 프로필이 공개로 설정되어 있는지 확인해주세요\n• 잠시 후 다시 시도해주세요'
        })
      
      await interaction.editReply({ embeds: [errorEmbed] })
    }
  }
}
