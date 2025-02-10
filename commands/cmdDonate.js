const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('후원')
		.setDescription('돈좀 주세요'),
	async execute(interaction) {
		await interaction.reply(`카카오뱅크: 3333-02-4922298 황재영`);
	},
};