// IndexedDB ラッパー。画像は Blob のまま保存する。
const DB_NAME = 'sake-label-book';
const VERSION = 1;
const STORE = 'labels';

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const all = () => run('readonly', (s) => s.getAll());
export const get = (id) => run('readonly', (s) => s.get(id));
export const put = (rec) => run('readwrite', (s) => s.put(rec));
export const del = (id) => run('readwrite', (s) => s.delete(id));
