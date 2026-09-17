/**
 * 作業名・コピペ・設定の検証（Node）
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const WorkspaceData = require(join(__dirname, '..', 'WorkspaceData.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function main() {
    assert(WorkspaceData.stripWorkName('図面A_20260917_123045') === '図面A', 'タイムスタンプを外す');
    assert(WorkspaceData.stripWorkName('作業') === '作業', '素の作業名');
    assert(WorkspaceData.stripWorkName('') === '作業', '空は作業');

    const grouped = WorkspaceData.groupProjectsByWorkName([
        { id: 1, name: 'A_20260101_000000', workName: 'A', updatedAt: 10 },
        { id: 2, name: 'B_20260101_000001', workName: 'B', updatedAt: 30 },
        { id: 3, name: 'A_20260102_000000', workName: 'A', updatedAt: 20 }
    ]);
    assert(grouped.length === 2, '作業名は2件');
    assert(grouped[0].workName === 'B' && grouped[1].workName === 'A', '新しい作業が先');
    assert(grouped[1].versions.length === 2 && grouped[1].versions[0].id === 3, 'A は新しい順');

    const mem = {
        getItem() { return null; },
        setItem(_k, v) { this._v = v; },
        _v: null
    };
    const settings = WorkspaceData.loadSettings(mem);
    assert(settings.autoSaveMinutes === 5, '自動保存初期値は5分');
    settings.autoSaveMinutes = 8;
    settings.defaultGroup.width = 77;
    WorkspaceData.saveSettings(settings, mem);
    mem.getItem = () => mem._v;
    const loaded = WorkspaceData.loadSettings(mem);
    assert(loaded.autoSaveMinutes === 8 && loaded.defaultGroup.width === 77, '設定を保存できる');

    const payload = WorkspaceData.buildCopyPayload(
        [{ id: 1, name: 'g1', width: 10 }],
        [{ id: 5, groupId: 1, x: 0, y: 0, pageIndex: 0 }],
        [5]
    );
    assert(payload.type === 'pdf-autonumbering-objects', 'コピー種別');
    const pasted = WorkspaceData.cloneForPaste(
        payload,
        [{ id: 1, name: 'g1', width: 10 }],
        [{ id: 5, groupId: 1, x: 0, y: 0 }],
        2,
        12
    );
    assert(pasted.groups.length === 0, '既存グループは再利用');
    assert(pasted.instances[0].id === 6, '新しいID');
    assert(pasted.instances[0].pageIndex === 2, '現在ページへ貼る');
    assert(pasted.instances[0].x === 12 && pasted.instances[0].y === 12, 'オフセット');
    assert(WorkspaceData.parseCopyPayload(JSON.stringify(payload)), 'ペイロードを読める');
    assert(!WorkspaceData.parseCopyPayload('{}'), '不正JSONは拒否');

    console.log('OK workspace data');
}

main();
