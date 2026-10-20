/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";

/* Synchronous string key-value store with the localStorage interface, held in
   memory and written through to IndexedDB. storageLoad() fills the table from
   the database before any other quadplay script runs, so every getItem() call
   is synchronous. */

const STORAGE_DATABASE_NAME = 'quadplay';
const STORAGE_OBJECT_STORE_NAME = 'keyValue';

const storageTable = new Map();
let storageDatabase = null;

const quadplayStorage = {
    getItem: function (key) {
        return storageTable.has(key) ? storageTable.get(key) : null;
    },

    setItem: function (key, value) {
        value = String(value);
        storageTable.set(key, value);
        const request = storageDatabase.transaction(STORAGE_OBJECT_STORE_NAME, 'readwrite').objectStore(STORAGE_OBJECT_STORE_NAME).put(value, key);
        request.onerror = function () { throw request.error; };
    }
};


function storageLoad(callback) {
    const openRequest = indexedDB.open(STORAGE_DATABASE_NAME, 1);
    openRequest.onerror = function () { throw openRequest.error; };

    openRequest.onupgradeneeded = function () {
        openRequest.result.createObjectStore(STORAGE_OBJECT_STORE_NAME);
    };

    openRequest.onsuccess = function () {
        storageDatabase = openRequest.result;
        const objectStore = storageDatabase.transaction(STORAGE_OBJECT_STORE_NAME, 'readonly').objectStore(STORAGE_OBJECT_STORE_NAME);
        const keysRequest = objectStore.getAllKeys();
        const valuesRequest = objectStore.getAll();
        valuesRequest.onerror = keysRequest.onerror = function () { throw valuesRequest.error || keysRequest.error; };
        valuesRequest.onsuccess = function () {
            const keyArray = keysRequest.result;
            const valueArray = valuesRequest.result;
            for (let i = 0; i < keyArray.length; ++i) {
                storageTable.set(keyArray[i], valueArray[i]);
            }
            callback();
        };
    };
}
