/**
 * DBManager.js
 * ローカル永続化ストレージ管理（自動修復・完全整合性保証版）
 */
if (typeof window.DBManager === 'undefined') {
    window.DBManager = class DBManager {
        constructor() { 
            this.dbName = "PdfEditorDB"; 
            this.dbVersion = 6; 
            this.db = null; 
        }

        async open() {
            if (this.db) {
                const requiredStores = ["projects", "project_blobs", "project_data"];
                const hasAll = requiredStores.every(s => this.db.objectStoreNames.contains(s));
                if (hasAll) return this.db;
                this.db.close();
                this.db = null;
            }

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = (e) => {
                    console.error("IndexedDBオープンエラー:", e.target.error);
                    reject(e.target.error);
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
