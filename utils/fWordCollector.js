const { badWords } = require("../config/badwords.json");

const fWordCollector = (message) => {
    const msgSplit = message.split(" ");
    const hasBadWord = msgSplit.some((word) => 
        badWords.some((badWord) => word.includes(badWord))
    );
    return hasBadWord;
}

module.exports = { fWordCollector };