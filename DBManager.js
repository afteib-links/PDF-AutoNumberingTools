/**
 * DBManager.js
 * IndexedDB で永続化。開けない環境（一部の file://）は localStorage に退避する。
 */
if (typeof window.DBManager === 'undefined') {
    const LS_DB_KEY = 'PdfEditorDB_local_v1';

    function requestResult(result) {
        const req = { result: result, error: null, onsuccess: null, onerror: null };
        queueMicrotask(function () {
            if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
        });
        return req;
    }

    function u8ToB64(bytes) {
        if (!bytes) return '';
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let bin = '';
        const step = 0x8000;
        for (let i = 0; i < u8.length; i += step) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + step, u8.length)));
        }
        return btoa(bin);
    }

    function b64ToU8(b64) {
        if (!b64) return new Uint8Array(0);
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function snapshotTables(tables) {
        const out = {};
        Object.keys(tables).forEach(function (name) {
            const t = tables[name];
            const rows = [];
            t.rows.forEach(function (row, key) {
                const copy = Object.assign({}, row);
                if (copy.pdfBytes) {
                    copy.pdfBytesB64 = u8ToB64(copy.pdfBytes);
                    delete copy.pdfBytes;
                }
                rows.push([key, copy]);
            });
            out[name] = { nextId: t.nextId || 1, rows: rows };
        });
        return out;
    }

    function restoreTables(tables, snap) {
        if (!snap) return;
        Object.keys(tables).forEach(function (name) {
            const src = snap[name];
            if (!src) return;
            tables[name].nextId = src.nextId || 1;
            tables[name].rows = new Map();
            (src.rows || []).forEach(function (pair) {
                const key = pair[0];
                const copy = Object.assign({}, pair[1]);
                if (copy.pdfBytesB64) {
                    copy.pdfBytes = b64ToU8(copy.pdfBytesB64);
                    delete copy.pdfBytesB64;
                }
                tables[name].rows.set(key, copy);
            });
        });
    }

    function persistTables(tables) {
        if (typeof localStorage === 'undefined') return false;
        try {
            localStorage.setItem(LS_DB_KEY, JSON.stringify(snapshotTables(tables)));
            return true;
        } catch (e) {
            console.warn('localStorage への履歴保存に失敗:', e);
            return false;
        }
    }

    function createMemoryDatabase(persist) {
        const tables = {
            projects: { keyPath: 'id', autoIncrement: true, nextId: 1, rows: new Map() },
            project_blobs: { keyPath: 'projectId', autoIncrement: false, rows: new Map() },
            project_data: { keyPath: 'projectId', autoIncrement: false, rows: new Map() }
        };

        if (persist && typeof localStorage !== 'undefined') {
            try {
                restoreTables(tables, JSON.parse(localStorage.getItem(LS_DB_KEY) || 'null'));
            } catch (e) {
                console.warn('localStorage 履歴の読込に失敗:', e);
            }
        }

        function makeStore(table, tx) {
            return {
                add: function (record) {
                    tx._pending++;
                    const row = Object.assign({}, record);
                    if (table.autoIncrement) {
                        row[table.keyPath] = table.nextId++;
                    }
                    const key = row[table.keyPath];
                    table.rows.set(key, row);
                    const req = requestResult(key);
                    queueMicrotask(function () { tx._done(); });
                    return req;
                },
                put: function (record) {
                    tx._pending++;
                    const row = Object.assign({}, record);
                    const key = row[table.keyPath];
                    table.rows.set(key, row);
                    const req = requestResult(key);
                    queueMicrotask(function () { tx._done(); });
                    return req;
                },
                get: function (key) {
                    tx._pending++;
                    const req = requestResult(table.rows.has(key) ? table.rows.get(key) : undefined);
                    queueMicrotask(function () { tx._done(); });
                    return req;
                },
                getAll: function () {
                    tx._pending++;
                    const req = requestResult(Array.from(table.rows.values()));
                    queueMicrotask(function () { tx._done(); });
                    return req;
                },
                delete: function (key) {
                    tx._pending++;
                    table.rows.delete(key);
                    const req = requestResult(undefined);
                    queueMicrotask(function () { tx._done(); });
                    return req;
                }
            };
        }

        return {
            objectStoreNames: {
                contains: function (name) { return Object.prototype.hasOwnProperty.call(tables, name); }
            },
            close: function () {},
            transaction: function () {
                const tx = {
                    oncomplete: null,
                    onerror: null,
                    onabort: null,
                    error: null,
                    _pending: 0,
                    _closed: false
                };
                tx._done = function () {
                    tx._pending--;
                    if (tx._pending <= 0 && !tx._closed) {
                        tx._closed = true;
                        if (persist) persistTables(tables);
                        if (typeof tx.oncomplete === 'function') tx.oncomplete();
                    }
                };
                tx.objectStore = function (name) { return makeStore(tables[name], tx); };
                queueMicrotask(function () {
                    if (tx._pending === 0 && !tx._closed) {
                        tx._closed = true;
                        if (persist) persistTables(tables);
                        if (typeof tx.oncomplete === 'function') tx.oncomplete();
                    }
                });
                return tx;
            }
        };
    }

    window.DBManager = class DBManager {
        constructor() {
            this.dbName = "PdfEditorDB";
            this.dbVersion = 6;
            this.db = null;
            this.usesMemory = false;
        }

        async open() {
            if (this.db) {
                const requiredStores = ["projects", "project_blobs", "project_data"];
                const hasAll = requiredStores.every(s => this.db.objectStoreNames.contains(s));
                if (hasAll) return this.db;
                if (typeof this.db.close === 'function') this.db.close();
                this.db = null;
            }

            if (typeof indexedDB === 'undefined') {
                this.usesMemory = true;
                this.db = createMemoryDatabase(true);
                return this.db;
            }

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = (e) => {
                    console.warn("IndexedDBを開けないため localStorage に保存します:", e.target.error);
                    this.usesMemory = true;
                    this.db = createMemoryDatabase(true);
                    resolve(this.db);
                };

                request.onblocked = () => {
                    alert("データベースの更新がブロックされました。他のタブで本ツールを開いている場合は閉じてください。");
                };

                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    this.usesMemory = false;

                    const requiredStores = ["projects", "project_blobs", "project_data"];
                    const hasAll = requiredStores.every(s => this.db.objectStoreNames.contains(s));
                    if (!hasAll) {
                        this.db.close();
                        this.db = null;
                        this.recreateDatabase().then(resolve).catch(reject);
                        return;
                    }

                    resolve(this.db);
                };

                request.onupgradeneeded = (e) => {
                    const db = e.target.result;

                    if (!db.objectStoreNames.contains("projects")) {
                        const projectStore = db.createObjectStore("projects", { keyPath: "id", autoIncrement: true });
                        projectStore.createIndex("updatedAt", "updatedAt", { unique: false });
                    } else {
                        const store = e.target.transaction.objectStore("projects");
                        if (!store.indexNames.contains("updatedAt")) {
                            store.createIndex("updatedAt", "updatedAt", { unique: false });
                        }
                    }

                    if (!db.objectStoreNames.contains("project_blobs")) {
                        db.createObjectStore("project_blobs", { keyPath: "projectId" });
                    }

                    if (!db.objectStoreNames.contains("project_data")) {
                        db.createObjectStore("project_data", { keyPath: "projectId" });
                    }
                };
            });
        }

        async recreateDatabase() {
            if (this.usesMemory || typeof indexedDB === 'undefined') {
                try {
                    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_DB_KEY);
                } catch (e) { /* ignore */ }
                this.db = createMemoryDatabase(true);
                this.usesMemory = true;
                return this.db;
            }
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            return new Promise((resolve, reject) => {
                const delReq = indexedDB.deleteDatabase(this.dbName);
                delReq.onsuccess = () => {
                    this.dbVersion = Math.max(this.dbVersion + 1, 7);
                    this.open().then(resolve).catch(reject);
                };
                delReq.onerror = () => {
                    this.usesMemory = true;
                    this.db = createMemoryDatabase(true);
                    resolve(this.db);
                };
            });
        }
    };
}
