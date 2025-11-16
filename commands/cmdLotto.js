const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')

/**
 * 1부터 45까지의 숫자 중에서 중복 없이 7개를 뽑는 함수 (로또번호 6개 + 보너스번호 1개)
 * @returns {object} - 로또번호 배열과 보너스번호
 */
function generateLottoNumbers() {
    const numbers = []
    
    // 1부터 45까지의 숫자 배열 생성
    for (let i = 1; i <= 45; i++) {
        numbers.push(i)
    }
    
    // Fisher-Yates 셔플 알고리즘으로 배열을 섞음
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]]
    }
    
    // 처음 6개는 로또번호, 7번째는 보너스번호
    const lottoNumbers = numbers.slice(0, 6).sort((a, b) => a - b) // 오름차순 정렬
    const bonusNumber = numbers[6]
    
    return {
        lottoNumbers,
        bonusNumber
    }
}

/**
 * 로또번호를 시각적으로 예쁘게 표시하기 위한 함수
 * @param {number} number - 로또 번호
 * @returns {string} - 포맷된 번호 문자열
 */
function formatLottoNumber(number) {
    // 번호에 따라 다른 색상의 원 이모지 사용
    if (number <= 10) return `🟡 **${number}**`      // 노란색 (1~10)
    else if (number <= 20) return `🔵 **${number}**` // 파란색 (11~20)
    else if (number <= 30) return `🔴 **${number}**` // 빨간색 (21~30)
    else if (number <= 40) return `⚫ **${number}**` // 검은색 (31~40)
    else return `🟢 **${number}**`                   // 초록색 (41~45)
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('로또번호')
        .setDescription('로또 6/45 번호를 랜덤으로 생성합니다'),

    /**
     * 로또번호 생성 명령어 실행 함수
     * @param {Interaction} interaction - Discord 상호작용 객체
     */
    async execute(interaction) {
        try {
            // 로또번호 생성
            const { lottoNumbers, bonusNumber } = generateLottoNumbers()
            
            // 로또번호를 예쁘게 포맷
            const formattedNumbers = lottoNumbers.map(num => formatLottoNumber(num)).join(' ')
            const formattedBonus = formatLottoNumber(bonusNumber)
            
            // 현재 날짜와 시간
            const now = new Date()
            const kstDate = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Seoul"}))
            
            const embed = new EmbedBuilder()
                .setColor(0x1DB954)
                .setTitle('🎰 로또 6/45 번호 생성')
                .setDescription('**행운의 번호가 생성되었습니다!**')
                .addFields(
                    {
                        name: '🎯 당첨 번호',
                        value: formattedNumbers,
                        inline: false
                    },
                    {
                        name: '⭐ 보너스 번호',
                        value: formattedBonus,
                        inline: false
                    },
                    // {
                    //     name: '📋 번호 (간단)',
                    //     value: `\`${lottoNumbers.join(', ')} + ${bonusNumber}\``,
                    //     inline: false
                    // }
                )
                .setFooter({ 
                    text: `${interaction.user.username}님의 행운을 빕니다! • 생성 시간`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp(kstDate)

            await interaction.reply({ embeds: [embed] })

        } catch (error) {
            console.error('로또번호 생성 중 오류:', error)
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('❌ 오류 발생')
                .setDescription('로또번호 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setTimestamp()

            await interaction.reply({ embeds: [errorEmbed], ephemeral: true })
        }
    }
}
