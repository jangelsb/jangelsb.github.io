import { STORAGE_KEY, createDefaultAppData, normalizeAppData } from './data.js';

export function loadAppData(storage = window.localStorage) {
    try {
        const saved = storage.getItem(STORAGE_KEY);
        return saved ? normalizeAppData(JSON.parse(saved)) : createDefaultAppData();
    } catch (error) {
        console.warn('Could not load saved mortgage data; using defaults.', error);
        return createDefaultAppData();
    }
}

export function saveAppData(data, storage = window.localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function parseImportedData(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.homes)) {
        throw new Error('Invalid mortgage analyzer data.');
    }
    return normalizeAppData(parsed);
}
