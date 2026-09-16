/**
 * DBManager.js
 * ローカル永続化。file:// では IndexedDB が Edge でフレーム警告を出すためメモリに保持する。
 */
if (typeof window.DBManager === 'undefined') {
    function isFileProtocol() {
        return typeof location !== 'undefined' && location.protocol === 'file:';
    }

    function requestResult(result) {
        const req = { result: result, error: null, onsuccess: null, onerror: null };
        queueMicrotask(function () {
            if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
        });
        return req;
    }

    function createMemoryDatabase() {
        const tables = {
            projects: { keyPath: 'id', autoIncrement: true, nextId: 1, rows: new Map() },
            project_blobs: { keyPath: 'projectId', autoIncrement: false, rows: new Map() },
            project_data: { keyPath: 'projectId', autoIncrement: false, rows: new Map() }
        };

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
                        if (typeof tx.oncomplete === 'function') tx.oncomplete();
                    }
                };
                tx.objectStore = function (name) { return makeStore(tables[name], tx); };
                queueMicrotask(function () {
                    if (tx._pending === 0 && !tx._closed) {
                        tx._closed = true;
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

            if (isFileProtocol()) {
                this.usesMemory = true;
                this.db = createMemoryDatabase();
                return this.db;
            }

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = (e) => {
                    console.error("IndexedDBオープンエラー:", e.target.error);
                    this.usesMemory = true;
                    this.db = createMemoryDatabase();
                    resolve(this.db);
                };

                request.onblocked = () => {
                    alert("データベースの更新がブロックされました。他のタブで本ツールを開いている場合は閉じてください。");
                };

                request.onsuccess = (e) => {
                    this.db = e.target.result;

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
            if (isFileProtocol() || this.usesMemory) {
                this.db = createMemoryDatabase();
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
                delReq.onerror = () => reject(delReq.error);
            });
        }
    };
}
