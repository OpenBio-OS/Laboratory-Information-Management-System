import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'OpenBioCache';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

interface CachedAsset {
    id: string;
    data: Blob;
    timestamp: number;
}

class DataCache {
    private db: Promise<IDBPDatabase> | null = null;

    private async getDB() {
        if (!this.db) {
            this.db = openDB(DB_NAME, DB_VERSION, {
                upgrade(db) {
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                },
            });
        }
        return this.db;
    }

    async get(id: string): Promise<Blob | null> {
        const db = await this.getDB();
        const result = await db.get(STORE_NAME, id) as CachedAsset | undefined;

        if (result) {
            // Update timestamp on access (LRU-ish)
            await db.put(STORE_NAME, { ...result, timestamp: Date.now() });
            return result.data;
        }
        return null;
    }

    async put(id: string, data: Blob): Promise<void> {
        const db = await this.getDB();
        await db.put(STORE_NAME, {
            id,
            data,
            timestamp: Date.now()
        });
    }

    async delete(id: string): Promise<void> {
        const db = await this.getDB();
        await db.delete(STORE_NAME, id);
    }

    async clear(): Promise<void> {
        const db = await this.getDB();
        await db.clear(STORE_NAME);
    }
}

export const dataCache = new DataCache();
