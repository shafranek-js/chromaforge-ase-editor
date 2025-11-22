
import { state } from "./state";
import { AseData } from "./types";

const DB_NAME = 'ChromaForgeDB';
const STORE_NAME = 'app_state';
const DB_KEY = 'full_state';

let db: IDBDatabase | null = null;
let saveTimeout: number | undefined;

interface PersistedState {
    aseData: AseData;
    currentFileName: string;
    viewMode: 'grid' | 'list';
    showContrastOverlay: boolean;
}

export async function initStorage(): Promise<boolean> {
    return new Promise((resolve) => {
        let isComplete = false;

        // Safety timeout: If DB open hangs, fallback to default state.
        // Increased to 3000ms to prevent premature fallback on slow devices.
        const timeoutId = setTimeout(() => {
            if (!isComplete) {
                isComplete = true;
                console.warn("[Storage] DB Open Timed out. UI will load default, but DB writes may activate later.");
                resolve(false);
            }
        }, 3000);

        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (e) => {
            const d = (e.target as IDBOpenDBRequest).result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = (e) => {
            // Always capture the DB instance so writes can happen even if initial read timed out
            db = (e.target as IDBOpenDBRequest).result;
            
            // Add version change handler to prevent blocking future operations
            db.onversionchange = () => {
                db?.close();
                db = null;
            };

            if (isComplete) {
                // If we timed out, we already resolved false. 
                // But we keep 'db' active so future saves will work.
                console.log("[Storage] DB connection established after timeout.");
                return;
            }
            
            clearTimeout(timeoutId);
            isComplete = true;
            loadState().then(resolve);
        };

        request.onerror = (e) => {
            if (isComplete) return;
            clearTimeout(timeoutId);
            isComplete = true;
            console.warn("[Storage] IndexedDB init failed:", e);
            resolve(false);
        };
        
        request.onblocked = () => {
            console.warn("[Storage] IndexedDB blocked");
        };
    });
}

function loadState(): Promise<boolean> {
    if (!db) return Promise.resolve(false);
    
    return new Promise((resolve) => {
        try {
            const transaction = db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(DB_KEY);

            request.onsuccess = () => {
                const data = request.result as PersistedState;
                if (data && data.aseData) {
                    // Hydrate State
                    state.aseData = data.aseData;
                    state.currentFileName = data.currentFileName || 'chromaforge-palette.ase';
                    state.viewMode = data.viewMode || 'grid';
                    state.showContrastOverlay = data.showContrastOverlay || false;
                    resolve(true);
                } else {
                    resolve(false);
                }
            };
            
            request.onerror = () => resolve(false);
        } catch (e) {
            console.warn("Error reading from DB", e);
            resolve(false);
        }
    });
}

export function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    // Reduced to 1s for more responsive saving
    saveTimeout = window.setTimeout(() => {
        persistState();
    }, 1000);
}

export function forceSaveState() {
    if (saveTimeout) clearTimeout(saveTimeout);
    persistState();
}

function persistState() {
    if (!db) return;
    
    // Only save serializable data, exclude UI refs like FlatList
    const snapshot: PersistedState = {
        aseData: state.aseData,
        currentFileName: state.currentFileName,
        viewMode: state.viewMode,
        showContrastOverlay: state.showContrastOverlay
    };

    try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(snapshot, DB_KEY);
    } catch (e) {
        console.warn("[Storage] Save failed", e);
    }
}
