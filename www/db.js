/* IndexedDB Native Engine - 100% Offline */

const DB_NAME = 'CashpointDB';
const DB_VERSION = 1;
let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Erreur IndexedDB:", event.target.errorCode);
            reject(event.target.errorCode);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('transactions')) {
                const txStore = dbInstance.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                txStore.createIndex('reference', 'reference', { unique: false });
                txStore.createIndex('date', 'date', { unique: false });
                txStore.createIndex('operator', 'operator', { unique: false });
            }
        };
    });
}

function saveTransaction(txData) {
    return new Promise((resolve, reject) => {
        if (!db) { reject("Database not initialized"); return; }
        const tx = db.transaction(['transactions'], 'readwrite');
        const store = tx.objectStore('transactions');
        const request = store.add(txData);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function getAllTransactions() {
    return new Promise((resolve, reject) => {
        if (!db) { reject("Database not initialized"); return; }
        const tx = db.transaction(['transactions'], 'readonly');
        const store = tx.objectStore('transactions');
        const request = store.getAll();

        request.onsuccess = () => {
            const results = request.result || [];
            results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            resolve(results);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

function clearDatabase() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['transactions'], 'readwrite');
        const store = tx.objectStore('transactions');
        const request = store.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = (e) => reject(e.target.error);
    });
}