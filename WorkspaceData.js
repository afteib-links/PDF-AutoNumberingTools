/**
 * WorkspaceData.js
 * 作業名の正規化、履歴グルーピング、初期グループ、オブジェクト複製。
 */
(function (root) {
    const SETTINGS_KEY = 'PdfEditorSettings_v1';
    const DEFAULT_AUTO_SAVE_MINUTES = 5;
    const PASTE_OFFSET_PT = 12;

    function defaultGroupTemplate() {
        return {
            name: '新規グループ',
            shape: 'rectangle',
            width: 100,
            height: 40,
            isSizeAuto: false,
            hasBorder: true,
            borderWidth: 1.5,
            borderColor: '#000000',
            textColor: '#000000',
            startCap: 'none',
            endCap: 'none',
            capSize: 6,
            font: 'Yu Gothic',
            fontSize: 12,
            bgColor: '#ffffff',
            bgOpacity: 0,
            defaultText: '項目:{auto:000}',
            startNumber: 1,
            zIndex: 0,
            isLocked: false,
            isHidden: false
        };
    }

    function defaultSettings() {
        return {
            autoSaveEnabled: true,
            autoSaveMinutes: DEFAULT_AUTO_SAVE_MINUTES,
            defaultGroup: defaultGroupTemplate()
        };
    }

    function loadSettings(storage) {
        const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        const base = defaultSettings();
        if (!store) return base;
        try {
            const raw = store.getItem(SETTINGS_KEY);
            if (!raw) return base;
            const parsed = JSON.parse(raw);
            const minutes = Number(parsed.autoSaveMinutes);
            base.autoSaveEnabled = parsed.autoSaveEnabled !== false;
            base.autoSaveMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_AUTO_SAVE_MINUTES;
            if (parsed.defaultGroup && typeof parsed.defaultGroup === 'object') {
                base.defaultGroup = Object.assign(defaultGroupTemplate(), parsed.defaultGroup);
            }
        } catch (e) { /* 壊れた設定は初期値 */ }
        return base;
    }

    function saveSettings(settings, storage) {
        const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!store) return false;
        const next = Object.assign(defaultSettings(), settings || {});
        next.autoSaveMinutes = Math.max(1, Number(next.autoSaveMinutes) || DEFAULT_AUTO_SAVE_MINUTES);
        next.defaultGroup = Object.assign(defaultGroupTemplate(), next.defaultGroup || {});
        store.setItem(SETTINGS_KEY, JSON.stringify(next));
        return true;
    }

    function stripWorkName(name) {
        const raw = String(name || '').replace(/_\d{8}_\d{6}$/, '').trim();
        return raw || '作業';
    }

    function groupProjectsByWorkName(items) {
        const map = new Map();
        (items || []).forEach((item) => {
            const workName = item.workName || stripWorkName(item.name);
            if (!map.has(workName)) map.set(workName, []);
            map.get(workName).push(item);
        });
        const groups = [];
        map.forEach((versions, workName) => {
            versions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            groups.push({
                workName: workName,
                versions: versions,
                latestAt: versions[0] ? versions[0].updatedAt : 0
            });
        });
        groups.sort((a, b) => (b.latestAt || 0) - (a.latestAt || 0));
        return groups;
    }

    function nextId(list, key) {
        const k = key || 'id';
        let max = 0;
        (list || []).forEach((row) => {
            const n = Number(row[k]) || 0;
            if (n > max) max = n;
        });
        return max + 1;
    }

    function cloneForPaste(payload, existingGroups, existingInstances, pageIndex, offsetPt) {
        const offset = Number.isFinite(offsetPt) ? offsetPt : PASTE_OFFSET_PT;
        const groupsIn = Array.isArray(payload && payload.groups) ? payload.groups : [];
        const instIn = Array.isArray(payload && payload.instances) ? payload.instances : [];
        const groupIdMap = {};
        const newGroups = [];
        let gid = nextId(existingGroups);

        groupsIn.forEach((g) => {
            const existing = (existingGroups || []).find((eg) => eg.id === g.id);
            if (existing) {
                groupIdMap[g.id] = existing.id;
                return;
            }
            const ng = Object.assign({}, g, { id: gid });
            groupIdMap[g.id] = gid;
            newGroups.push(ng);
            gid += 1;
        });

        let iid = nextId(existingInstances);
        const newInstances = instIn.map((inst, i) => {
            const mappedGroup = groupIdMap[inst.groupId];
            const groupId = mappedGroup !== undefined
                ? mappedGroup
                : ((existingGroups || [])[0] ? existingGroups[0].id : 1);
            return Object.assign({}, inst, {
                id: iid + i,
                groupId: groupId,
                pageIndex: pageIndex,
                order: iid + i,
                x: (Number(inst.x) || 0) + offset,
                y: (Number(inst.y) || 0) + offset
            });
        });

        return { groups: newGroups, instances: newInstances };
    }

    function buildCopyPayload(groups, instances, selectedIds) {
        const ids = selectedIds instanceof Set ? Array.from(selectedIds) : (selectedIds || []);
        const picked = (instances || []).filter((inst) => ids.indexOf(inst.id) !== -1);
        const groupIds = {};
        picked.forEach((inst) => { groupIds[inst.groupId] = true; });
        const pickedGroups = (groups || []).filter((g) => groupIds[g.id]);
        return {
            type: 'pdf-autonumbering-objects',
            groups: JSON.parse(JSON.stringify(pickedGroups)),
            instances: JSON.parse(JSON.stringify(picked))
        };
    }

    function parseCopyPayload(text) {
        if (!text) return null;
        try {
            const data = typeof text === 'string' ? JSON.parse(text) : text;
            if (!data || data.type !== 'pdf-autonumbering-objects') return null;
            if (!Array.isArray(data.instances) || data.instances.length === 0) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    const api = {
        SETTINGS_KEY: SETTINGS_KEY,
        DEFAULT_AUTO_SAVE_MINUTES: DEFAULT_AUTO_SAVE_MINUTES,
        PASTE_OFFSET_PT: PASTE_OFFSET_PT,
        defaultGroupTemplate: defaultGroupTemplate,
        defaultSettings: defaultSettings,
        loadSettings: loadSettings,
        saveSettings: saveSettings,
        stripWorkName: stripWorkName,
        groupProjectsByWorkName: groupProjectsByWorkName,
        cloneForPaste: cloneForPaste,
        buildCopyPayload: buildCopyPayload,
        parseCopyPayload: parseCopyPayload
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) root.WorkspaceData = api;
}(typeof window !== 'undefined' ? window : globalThis));
