const { initializeApp } = require('firebase/app')
const { getDatabase, ref, get, set, update } = require('firebase/database')
const firebaseConfig = require('../config/firebaseConfig')

const firebaseApp = initializeApp(firebaseConfig)
const database = getDatabase(firebaseApp)

/**
 * USER_KEY 유효성 검사 함수
 */
async function verifyUserKey() {
    try {
        const inputKey = process.env.FIREBASE_USER_KEY
        const snapshot = await get(ref(database, 'USER_KEYS'))
        if (!snapshot.exists()) return false

        const data = snapshot.val()
        const validKeys = Object.values(data)
        return validKeys.includes(inputKey)
    } catch (err) {
        console.error('[FirebaseAuth] USER_KEY 검증 실패:', err)
        return false
    }
}

/**
 * Firebase 데이터 안전하게 조회
 */
async function secureGet(path) {
    const isValid = await verifyUserKey()
    if (!isValid) throw new Error('❌ USER_KEY 인증 실패')
    const snapshot = await get(ref(database, path))
    return snapshot.exists() ? snapshot.val() : null
}

/**
 * Firebase 데이터 안전하게 저장
 */
async function secureSet(path, data) {
    const isValid = await verifyUserKey()
    if (!isValid) throw new Error('❌ USER_KEY 인증 실패')
    await set(ref(database, path), data)
}

/**
 * Firebase 데이터 안전하게 업데이트
 */
async function secureUpdate(path, data) {
    const isValid = await verifyUserKey()
    if (!isValid) throw new Error('❌ USER_KEY 인증 실패')
    await update(ref(database, path), data)
}

module.exports = {
    database,
    secureGet,
    secureSet,
    secureUpdate,
    verifyUserKey
}
