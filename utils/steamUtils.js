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
    if (!timestamp) return '숨겨져있거나 찾을 수 없습니다.';
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

const getHasGame = async (steamId) => {
    const steam = await returnSteamClient();
    const games = await steam.getUserOwnedGames(steamId, {
        includeAppInfo: true,
    }) || [];

    const gameList = games.map(g => {
        return {
            gameId: g.game.id,
            gameName: g.game.name,
            playTime: g.minutes,
            lastPlayed: convertTimestampToDate(g.lastPlayedTimestamp),
        }
    });
    return gameList;
}

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

module.exports = { getSteamUserId, getHasGame, getCurrentGameInfo, getTimeAndMinutes };