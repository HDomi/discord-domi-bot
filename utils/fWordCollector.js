const { badWords } = require("../config/badwords.json");

const fWordCollector = (message) => {
    const msgSplit = message.split(" ");
    const badWordsInMsg = msgSplit.filter((word) => badWords.includes(word));
    if (badWordsInMsg.length > 0) {
        return true;
    }
    return false;
}

module.exports = { fWordCollector };