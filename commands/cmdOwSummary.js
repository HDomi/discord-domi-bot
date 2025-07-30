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
  const apiUrl = `https://overfast-api.tekrop.fr/players/${formatBattletag(battletag)}/summary`
  
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
 * 플레이어 정보 임베드를 생성하는 함수
 * @param {object} playerData - 플레이어 데이터
 * @param {string} battletag - 원본 배틀태그
 * @returns {EmbedBuilder} - Discord 임베드
 */
function createPlayerEmbed(playerData, battletag) {
  const embed = new EmbedBuilder()
    .setColor(0xf99e1a)
    .setTitle(`🎮 ${playerData.username}의 오버워치 전적`)
    .setDescription(`배틀태그: **${battletag}**`)
    .setThumbnail(playerData.avatar)
    .setTimestamp()
  
  // 추천 레벨 정보
  if (playerData.endorsement) {
    embed.addFields({
      name: '👍 추천 레벨',
      value: `${playerData.endorsement.level}레벨`,
      inline: true
    })
  }
  
  // 경쟁전 정보
  if (playerData.competitive && playerData.competitive.pc) {
    const comp = playerData.competitive.pc
    let compInfo = ''
    
    // 각 역할별 티어 정보
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
      embed.addFields({
        name: '🏆 경쟁전 티어',
        value: compInfo,
        inline: false
      })
    }
    
    // 시즌 정보
    if (comp.season) {
      embed.addFields({
        name: '📅 시즌',
        value: `시즌 ${comp.season}`,
        inline: true
      })
    }
  }
  
  // 네임카드가 있으면 추가
  if (playerData.namecard) {
    embed.setImage(playerData.namecard)
  }
  
  embed.setFooter({
    text: 'Overfast API 제공',
    iconURL: 'https://static.playoverwatch.com/img/pages/career/icons/role/tank-f64702b684.svg'
  })
  
  return embed
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('전적')
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
