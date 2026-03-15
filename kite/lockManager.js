const activeLocks = new Set();
const lockTimestamps = new Map();
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function acquireLock(key) {
    cleanupStaleLocks();
    
    if (activeLocks.has(key)) {
        return false;
    }
    
    activeLocks.add(key);
    lockTimestamps.set(key, Date.now());
    return true;
}

function releaseLock(key) {
    activeLocks.delete(key);
    lockTimestamps.delete(key);
}

function hasLock(key) {
    cleanupStaleLocks();
    return activeLocks.has(key);
}

function cleanupStaleLocks() {
    const now = Date.now();
    const staleKeys = [];
    
    for (const [key, timestamp] of lockTimestamps.entries()) {
        if (now - timestamp > LOCK_TIMEOUT_MS) {
            staleKeys.push(key);
        }
    }
    
    for (const key of staleKeys) {
        activeLocks.delete(key);
        lockTimestamps.delete(key);
        console.log(`🧹 Cleaned up stale lock for ${key}`);
    }
}

function forceReleaseLock(key) {
    releaseLock(key);
}

function getAllLocks() {
    cleanupStaleLocks();
    return Array.from(activeLocks);
}

function clearAllLocks() {
    activeLocks.clear();
    lockTimestamps.clear();
}

module.exports = {
    acquireLock,
    releaseLock,
    hasLock,
    forceReleaseLock,
    getAllLocks,
    clearAllLocks,
    cleanupStaleLocks
};
