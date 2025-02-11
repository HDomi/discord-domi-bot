require('dotenv').config();


const returnSteamClient = async () => {
    const steamKey = process.env.STEAM_API;
    const SteamAPI = (await import('steamapi')).default;
    const steam = new SteamAPI(steamKey);
    return steam;
}
const getTimeAndMinutes = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}시간 ${mins}분`;
}
const convertTimestampToDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const getSteamUserId = async (steamId) => {
    try {
        const steam = await returnSteamClient();
        const id = await steam.resolve(`https://steamcommunity.com/id/${steamId}`);
        return id;
    } catch (error) {
        console.error('유효하지 않은 Steam ID입니다:', error.message);
        throw new Error('Steam ID를 확인해주세요.');
    }
}

const getGameCount = async (steamId) => {
    const steam = await returnSteamClient();
    const gameCount = await steam.getUserOwnedGames(steamId) || [];
    return gameCount.length;
}
// 578080
const getCurrentGameInfo = async (steamId, gameId) => {
    const steam = await returnSteamClient();
    const gamesInfo = await steam.getUserOwnedGames(steamId);
    const currentGameInfo = gamesInfo.find(game => game.game.id === gameId);
    if (!currentGameInfo) {
        return {
            playTime: '0시간 0분',
            lastPlayed: '0000-00-00',
        }
    }
    const info = {
        playTime: getTimeAndMinutes(currentGameInfo.minutes),
        lastPlayed: convertTimestampToDate(currentGameInfo.lastPlayedTimestamp),
    }
    return info;
}

module.exports = { getSteamUserId, getGameCount, getCurrentGameInfo };