// commands/cmdTeamShuffle.js
const { SlashCommandBuilder } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('팀섞')
        .setDescription('팀을 섞고 임베디드 메시지를 표시합니다.'),
    async execute(interaction) {
        const { user } = interaction.member;
        const userName = user.globalName || user.nickname || user.username || '신원미상';
        const voiceChannel = interaction.member.voice.channel;

         //명령을 실행한 유저가 관리자 권한이 있는지 확인
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply(`${userName}님, 관리자 권한이 없습니다.`);
        }
        if (!voiceChannel) {
            return interaction.reply(`${userName}님, 먼저 음성채널에 들어가주세요.`);
        }

        const members = voiceChannel.members.map(member => member.user);
        let team1 = [];
        let team2 = [];
        const half = Math.ceil(members.length / 2);

        // 음성 채널 이름을 공백으로 분리하여 첫 번째 요소를 추출
        const channelNameParts = voiceChannel.name.split(" ");
        const baseChannelName = channelNameParts[0];
        const convertChannels = interaction.guild.channels.cache.map(channel => {
            return {
                name: channel.name,
                id: channel.id,
                type: channel.type,
                guildId: channel.guildId,
            }
        });
        // 현재 서버의 모든 음성 채널을 가져와서 baseChannelName을 포함하는 채널 찾기
        const availableChannels = convertChannels
            .filter(channel => channel.type === 2 && 
                channel.guildId === interaction.guild.id && 
                channel.name.includes(baseChannelName) &&
                channel.id !== voiceChannel.id
            );

        let team1ChannelObj = [];
        let team2ChannelObj = [];

        if (availableChannels.length > 1) {
            team1ChannelObj = availableChannels[0];
            team2ChannelObj = availableChannels[1];
        } else {
            return interaction.reply("팀을 섞을 수 있는 채널이 충분하지 않습니다.");
        }

        // 팀 나누기 (랜덤 섞기 포함)
        const shuffledMembers = members.sort(() => Math.random() - 0.5); // 랜덤 섞기
        shuffledMembers.forEach((member, index) => {
            if (index < half) {
                team1.push(member);
            } else {
                team2.push(member);
            }
        });

        const embed = new EmbedBuilder()
            .setColor(0x426cf5)
            .setTitle(`팀 섞기 결과(대기방: ${voiceChannel.name})`)
            .addFields(
                { name: `팀1(${team1ChannelObj.name})`, value: team1.map(m => m.nickname || m.globalName || m.username).join(', ') || '없음' },
                { name: `팀2(${team2ChannelObj.name})`, value: team2.map(m => m.nickname || m.globalName || m.username).join(', ') || '없음' },
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                // new ButtonBuilder()
                //     .setCustomId('back')
                //     .setLabel('뒤로가기')
                //     .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('reshuffle')
                    .setLabel('다시섞기')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('moveTeam1')
                    .setLabel('팀1 이동')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('moveTeam2')
                    .setLabel('팀2 이동')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('moveWaitingRoom')
                    .setLabel('대기방 이동')
                    .setStyle(ButtonStyle.Danger),
            );

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [embed], components: [row] });
        } else {
            await interaction.followUp({ embeds: [embed], components: [row] });
        }


        // 버튼 클릭 이벤트 처리
        const filter = i => i.customId.startsWith('move') || i.customId === 'back' || i.customId === 'reshuffle';
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            // 버튼 클릭 시, 이미 응답이 전송된 경우 업데이트
            const updateResponse = async (content, newEmbed = null) => {
                if (!i.replied && !i.deferred) {
                    await i.update({ content, embeds: newEmbed ? [newEmbed] : [], components: [row] });
                } else {
                    await i.followUp({ content, embeds: newEmbed ? [newEmbed] : [], components: [row] });
                }
            };

            // 현재 음성 채널을 다시 가져오기
            const currentVoiceChannel = i.member.voice.channel; // 클릭한 사용자의 현재 음성 채널

            if (!currentVoiceChannel) {
                return i.reply("먼저 음성채널에 들어가주세요.");
            }

            //명령을 실행한 유저가 관리자 권한이 있는지 확인
            if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return i.reply("관리자 권한이 없습니다.");
            }

            const curChannels = interaction.guild.channels.cache;
            if (i.customId === 'back') {
                // await updateResponse("이전 화면으로 돌아갑니다.");
            } else if (i.customId === 'reshuffle') {
                // 팀을 다시 섞기
                const newTeam1 = [];
                const newTeam2 = [];
                const newMembers = voiceChannel.members.map(member => member.user);
                const newHalf = Math.ceil(newMembers.length / 2);

                
                const shuffledMembers = newMembers.sort(() => Math.random() - 0.5); // 랜덤 섞기
                shuffledMembers.forEach((member, index) => {
                    if (index < newHalf) {
                        newTeam1.push(member);
                        team1 = newTeam1;
                    } else {
                        newTeam2.push(member);
                        team2 = newTeam2;
                    }
                });

                const newEmbed = new EmbedBuilder()
                    .setColor(0x426cf5)
                    .setTitle('팀 섞기 결과')
                    .addFields(
                        { name: `팀1(${team1ChannelObj.name})`, value: newTeam1.map(m => m.nickname || m.globalName || m.username).join(', ') || '없음' },
                        { name: `팀2(${team2ChannelObj.name})`, value: newTeam2.map(m => m.nickname || m.globalName || m.username).join(', ') || '없음' },
                    )
                    .setTimestamp();

                await updateResponse("팀을 다시 섞었습니다.", newEmbed);
            } else if (i.customId === 'moveTeam1') {
                const team1Channel = curChannels.find(channel => channel.name === team1ChannelObj.name);
                if (team1Channel) {
                    await i.deferUpdate(); // 상호작용 지연
                    for (const member of team1) {
                        const guildMember = await interaction.guild.members.fetch(member.id);
                        await guildMember.voice.setChannel(team1Channel);
                    }
                    await interaction.followUp("팀1이 이동되었습니다.");
                } else {
                    await i.reply({ content: "팀1을 이동할 음성 채널이 없습니다.", flags: 64 }); // ephemeral: true
                }
            } else if (i.customId === 'moveTeam2') {
                const team2Channel = curChannels.find(channel => channel.name === team2ChannelObj.name);
                if (team2Channel) {
                    await i.deferUpdate(); // 상호작용 지연
                    for (const member of team2) {
                        const guildMember = await interaction.guild.members.fetch(member.id);
                        await guildMember.voice.setChannel(team2Channel);
                    }
                    await interaction.followUp("팀2가 이동되었습니다.");
                } else {
                    await i.reply({ content: "팀2를 이동할 음성 채널이 없습니다.", flags: 64 }); // ephemeral: true
                }
            } else if (i.customId === 'moveWaitingRoom') {
                const waitingRoomChannel = curChannels.find(channel => channel.id === voiceChannel.id);
                if (waitingRoomChannel) {
                    await i.deferUpdate(); // 상호작용 지연
                    for (const member of members) {
                        const guildMember = await interaction.guild.members.fetch(member.id);
                        await guildMember.voice.setChannel(waitingRoomChannel);
                    }
                    await interaction.followUp("모든 사용자가 대기방으로 이동되었습니다.");
                } else {
                    await i.reply({ content: "대기방으로 이동할 음성 채널이 없습니다.", flags: 64 }); // ephemeral: true
                }
            }
        });
    },
};