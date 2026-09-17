/**
 * main.js
 * UIバインド・高精度検索フィルタ・カラーHEX同期・モーダル2列レイアウト連動
 */
document.addEventListener('DOMContentLoaded', async () => {
    const core = new PdfEditorCore();
    await core.init();
    window.pdfEditorCore = core;

    const sampleUrl = new URLSearchParams(location.search).get('previewSample');
    if (sampleUrl === 'tests/preview-sample.pdf' || sampleUrl === './tests/preview-sample.pdf') {
        try {
            const res = await fetch(sampleUrl);
            const file = new File([await res.arrayBuffer()], 'preview-sample.pdf', { type: 'application/pdf' });
            await core.loadPdfFile(file);
            const x = Math.max(0, Math.floor(core.layerCanvas.width / 2));
            const y = Math.max(0, Math.floor(core.layerCanvas.height / 2));
            const pixel = Array.from(core.layerCtx.getImageData(x, y, 1, 1).data);
            document.documentElement.dataset.previewPixel = pixel.join(',');
            window.__previewPixel = pixel;
        } catch (err) {
            console.error('プレビュー検証用PDFの読込に失敗:', err);
            document.documentElement.dataset.previewPixel = 'error';
        }
    }

    let currentMode = 'select';
    let currentWorkspace = 'place';
    let workspaceDirty = false;
    let lastSaveLabel = '';
    let autoSaveTimer = null;
    let appSettings = (typeof WorkspaceData !== 'undefined') ? WorkspaceData.loadSettings() : { autoSaveEnabled: true, autoSaveMinutes: 5, defaultGroup: {} };

    const undoStack = [];
    const redoStack = [];
    const maxStack = 40;

    function markDirty() {
        workspaceDirty = true;
    }

    function pushHistory() {
        undoStack.push({
            instances: JSON.parse(JSON.stringify(core.instances)),
            groups: JSON.parse(JSON.stringify(core.groups)),
            cropRegions: JSON.parse(JSON.stringify(core.cropRegions || []))
        });
        if (undoStack.length > maxStack) undoStack.shift();
        redoStack.length = 0;
        updateHistoryButtons();
        markDirty();
    }

    function updateHistoryButtons() {
        btnUndo.disabled = undoStack.length === 0;
        btnRedo.disabled = redoStack.length === 0;
    }

    // ヘッダー要素
    const btnWorkspacePlace = document.getElementById('btn-workspace-place');
    const btnWorkspaceExtract = document.getElementById('btn-workspace-extract');
    const btnModeSelect = document.getElementById('btn-mode-select');
    const btnModeDraw = document.getElementById('btn-mode-draw');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');

    const btnAlignLeft = document.getElementById('btn-align-left');
    const btnAlignHCenter = document.getElementById('btn-align-hcenter');
    const btnAlignRight = document.getElementById('btn-align-right');
    const btnDistributeH = document.getElementById('btn-distribute-h');
    const btnAlignTop = document.getElementById('btn-align-top');
    const btnAlignVCenter = document.getElementById('btn-align-vcenter');
    const btnAlignBottom = document.getElementById('btn-align-bottom');
    const btnDistributeV = document.getElementById('btn-distribute-v');

    const loadPdfFileInput = document.getElementById('load-pdf-file');
    const replacePdfFileInput = document.getElementById('replace-pdf-file');
    const btnReplacePdf = document.getElementById('btn-replace-pdf');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    const curPageNumSpan = document.getElementById('current-page-num');
    const totalPageNumSpan = document.getElementById('total-page-num');
    const zoomInput = document.getElementById('zoom-input');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnSaveProject = document.getElementById('btn-save-project');
    const projectNameInput = document.getElementById('project-name');
    const btnGeneratePdf = document.getElementById('btn-generate-pdf');
    const pdfExportModeSelect = document.getElementById('pdf-export-mode-select');
    const pdfExportScopeSelect = document.getElementById('pdf-export-scope-select');
    const pdfExportVisibleLayers = document.getElementById('pdf-export-visible-layers');
    const paperSizeSelect = document.getElementById('paper-size-select');
    const paperOrientSelect = document.getElementById('paper-orient-select');
    const btnAddCropRegion = document.getElementById('btn-add-crop-region');
    const btnDeleteCropRegion = document.getElementById('btn-delete-crop-region');
    const pdfLayerList = document.getElementById('pdf-layer-list');
    const cropRegionList = document.getElementById('crop-region-list');
    const btnLayersAllOn = document.getElementById('btn-layers-all-on');
    const btnLayersAllOff = document.getElementById('btn-layers-all-off');

    // 左サイドバー：グループマスター & インライン設定パネル
    const groupCardsContainer = document.getElementById('group-cards-container');
    const btnAddGroup = document.getElementById('btn-add-group');
    const btnSaveGroupAsDefault = document.getElementById('btn-save-group-as-default');
    const inlineGroupPanel = document.getElementById('group-inline-panel');

    const groupNameInput = document.getElementById('group-name-input');
    const groupShapeSelect = document.getElementById('group-shape-select');
    const groupSizeAuto = document.getElementById('group-size-auto');
    const groupLineSettings = document.getElementById('group-line-settings');
    const groupStartCap = document.getElementById('group-startcap-select');
    const groupEndCap = document.getElementById('group-endcap-select');
    const groupWidthInput = document.getElementById('group-width-input');
    const groupHeightInput = document.getElementById('group-height-input');
    const groupHasBorder = document.getElementById('group-has-border');
    const groupBorderWidth = document.getElementById('group-borderwidth-input');
    const groupBorderColor = document.getElementById('group-bordercolor-input');
    const groupBorderColorText = document.getElementById('group-bordercolor-text');
    const groupTextColor = document.getElementById('group-textcolor-input');
    const groupTextColorText = document.getElementById('group-textcolor-text');
    const groupFontSelect = document.getElementById('group-font-select');
    const groupFontSize = document.getElementById('group-fontsize-input');
    const groupBgColor = document.getElementById('group-bgcolor-input');
    const groupBgColorText = document.getElementById('group-bgcolor-text');
    const groupBgOpacity = document.getElementById('group-bgopacity-input');
    const groupZIndex = document.getElementById('group-zindex-input');
    const groupIsLocked = document.getElementById('group-is-locked');
    const groupIsHidden = document.getElementById('group-is-hidden');
    const groupTextInput = document.getElementById('group-text-input');
    const groupStartNum = document.getElementById('group-startnum-input');
    const groupCapSize = document.getElementById('group-capsize-input');
    const appStatus = document.getElementById('app-status');
    const helpModal = document.getElementById('help-modal');
    const btnHelp = document.getElementById('btn-help');
    const closeHelpModal = document.getElementById('close-help-modal');
    const btnHelpModalClose = document.getElementById('btn-help-modal-close');

    // 右サイドバー：アコーディオン
    const groupedAccordionContainer = document.getElementById('grouped-instance-accordion');
    const moveStepNumber = document.getElementById('move-step-number');
    const moveStepSlider = document.getElementById('move-step-slider');
    const instanceSearch = document.getElementById('instance-search');
    const btnCopyInstances = document.getElementById('btn-copy-instances');
    const btnPasteInstances = document.getElementById('btn-paste-instances');

    // インスタンス詳細モーダル要素
    const instanceModal = document.getElementById('instance-modal');
    const instModalTitle = document.getElementById('inst-modal-title');
    const closeInstModal = document.getElementById('close-inst-modal');
    const btnModalCancel = document.getElementById('btn-modal-cancel');
    const btnModalSave = document.getElementById('btn-modal-save');
    
    const instIsLocked = document.getElementById('inst-is-locked');
    const instIsHidden = document.getElementById('inst-is-hidden');
    const instX = document.getElementById('inst-x');
    const instY = document.getElementById('inst-y');

    // 個別上書きフラグ & 入力フィールド
    const flagOverrideShape = document.getElementById('flag-override-shape');
    const instShape = document.getElementById('inst-shape');

    const flagOverrideSize = document.getElementById('flag-override-size');
    const instWidth = document.getElementById('inst-width');
    const instHeight = document.getElementById('inst-height');

    const flagOverrideAutosize = document.getElementById('flag-override-autosize');
    const instSizeAuto = document.getElementById('inst-size-auto');

    const flagOverrideCaps = document.getElementById('flag-override-caps');
    const instStartCap = document.getElementById('inst-startcap');
    const instEndCap = document.getElementById('inst-endcap');
    const instLineRow = document.getElementById('inst-line-row');
    const flagOverrideCapSize = document.getElementById('flag-override-capsize');
    const instCapSize = document.getElementById('inst-cap-size');
    const instCapSizeRow = document.getElementById('inst-capsize-row');

    const flagOverrideHasBorder = document.getElementById('flag-override-hasborder');
    const instHasBorder = document.getElementById('inst-has-border');

    const flagOverrideBorderWidth = document.getElementById('flag-override-borderwidth');
    const instBorderWidth = document.getElementById('inst-border-width');

    const flagOverrideBorderColor = document.getElementById('flag-override-bordercolor');
    const instBorderColor = document.getElementById('inst-border-color');
    const instBorderColorText = document.getElementById('inst-bordercolor-text');

    const flagOverrideTextColor = document.getElementById('flag-override-textcolor');
    const instTextColor = document.getElementById('inst-text-color');
    const instTextColorText = document.getElementById('inst-textcolor-text');

    const flagOverrideBgColor = document.getElementById('flag-override-bgcolor');
    const instBgColor = document.getElementById('inst-bg-color');
    const instBgColorText = document.getElementById('inst-bgcolor-text');
    const instBgOpacity = document.getElementById('inst-bg-opacity');

    const flagOverrideFontSize = document.getElementById('flag-override-fontsize');
    const instFontSize = document.getElementById('inst-font-size');

    const flagOverrideZIndex = document.getElementById('flag-override-zindex');
    const instZIndex = document.getElementById('inst-zindex');

    const flagOverrideText = document.getElementById('flag-override-text');
    const instText = document.getElementById('inst-text');

    // データ管理モーダル
    const dataModal = document.getElementById('data-modal');
    const btnDataView = document.getElementById('btn-data-view');
    const closeDataModal = document.getElementById('close-data-modal');
    const btnDataModalClose = document.getElementById('btn-data-modal-close');
    const tabBtnHistory = document.getElementById('tab-btn-history');
    const tabBtnJson = document.getElementById('tab-btn-json');
    const tabContentHistory = document.getElementById('tab-content-history');
    const autosaveEnabledInput = document.getElementById('autosave-enabled');
    const autosaveMinutesInput = document.getElementById('autosave-minutes');
    const tabContentJson = document.getElementById('tab-content-json');
    const btnHistorySaveCurrent = document.getElementById('btn-history-save-current');
    const modalProjectHistoryList = document.getElementById('modal-project-history-list');

    const dataJsonTextarea = document.getElementById('data-json-textarea');
    const btnDataCopy = document.getElementById('btn-data-copy');
    const btnDataExport = document.getElementById('btn-data-export');
    const btnDataImport = document.getElementById('btn-data-import');
    const btnBackupFile = document.getElementById('btn-backup-file');
    const btnRestoreFileTrigger = document.getElementById('btn-restore-file-trigger');
    const restoreFileInput = document.getElementById('restore-file-input');

    let activeGroupId = null;
    let editingInstance = null;
    const collapsedGroupIds = new Set();
    const sortableInstances = [];
    let arrowNudgeHistoryReady = true;

    let isDragging = false;
    let dragMode = 'move'; 
    let resizeHandleDir = ''; 
    let dragStartMouse = { x: 0, y: 0 };
    let dragInitialPositions = new Map();
    let dragInitialCrop = null;

    function syncColorDisplay(inputEl, labelEl) {
        if (!inputEl || !labelEl) return;
        labelEl.textContent = (inputEl.value || '#000000').toUpperCase();
    }

    [
        [groupBorderColor, groupBorderColorText],
        [groupTextColor, groupTextColorText],
        [groupBgColor, groupBgColorText],
        [instBorderColor, instBorderColorText],
        [instTextColor, instTextColorText],
        [instBgColor, instBgColorText]
    ].forEach(([inp, lbl]) => {
        if (inp && lbl) {
            inp.addEventListener('input', () => syncColorDisplay(inp, lbl));
        }
    });

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    function isGroupLocked(groupOrId) {
        const group = typeof groupOrId === 'object' ? groupOrId : core.groups.find(g => g.id === groupOrId);
        return !!(group && group.isLocked);
    }

    function isInstanceLocked(inst) {
        if (!inst) return true;
        if (inst.isLocked) return true;
        return isGroupLocked(inst.groupId);
    }

    function getInstanceZ(inst) {
        const group = core.groups.find(g => g.id === inst.groupId);
        return inst.isZIndexLocked && inst.overrideZIndex !== null ? inst.overrideZIndex : (group ? group.zIndex || 0 : 0);
    }

    function getPaintSortedInstances(pageIndex) {
        return core.instances
            .filter(i => i.pageIndex === pageIndex)
            .sort((a, b) => {
                const z = getInstanceZ(a) - getInstanceZ(b);
                if (z !== 0) return z;
                return a.order - b.order;
            });
    }

    function currentPaperKey() {
        return paperSizeSelect ? paperSizeSelect.value : 'A4';
    }
    function currentLandscape() {
        return paperOrientSelect ? paperOrientSelect.value === 'landscape' : false;
    }

    function renderPdfLayerList() {
        if (!pdfLayerList) return;
        if (!core.pdfLayers || core.pdfLayers.length === 0) {
            pdfLayerList.innerHTML = '<p class="help-text">このPDFに切替可能なレイヤーはありません。</p>';
            return;
        }
        pdfLayerList.innerHTML = '';
        core.pdfLayers.forEach(layer => {
            const row = document.createElement('label');
            row.className = 'layer-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = layer.visible;
            cb.addEventListener('change', async () => {
                await core.setPdfLayerVisible(layer.id, cb.checked);
                renderPdfLayerList();
            });
            const name = document.createElement('span');
            name.textContent = layer.name;
            row.appendChild(cb);
            row.appendChild(name);
            pdfLayerList.appendChild(row);
        });
    }

    function renderCropRegionList() {
        if (!cropRegionList) return;
        if (!core.cropRegions.length) {
            cropRegionList.innerHTML = '<p class="help-text">「範囲追加」で帳票枠を置けます。</p>';
            return;
        }
        cropRegionList.innerHTML = '';
        core.cropRegions.forEach((region, idx) => {
            const row = document.createElement('div');
            row.className = 'crop-row' + (core.selectedCropRegionIds.has(region.id) ? ' selected' : '');
            const paper = PdfLayoutTools.getPaperSize(region.paperKey, region.landscape);
            row.innerHTML = `<span>${idx + 1}. ページ${region.pageIndex + 1}</span><span class="crop-row-meta">${paper.label}${region.landscape ? ' 横' : ' 縦'}</span>`;
            row.addEventListener('click', async () => {
                core.selectedCropRegionIds.clear();
                core.selectedCropRegionIds.add(region.id);
                core.selectedInstanceIds.clear();
                if (core.currentPageNum !== region.pageIndex + 1) {
                    await core.changePage(region.pageIndex + 1);
                    updatePageIndicator();
                }
                if (paperSizeSelect) paperSizeSelect.value = region.paperKey;
                if (paperOrientSelect) paperOrientSelect.value = region.landscape ? 'landscape' : 'portrait';
                core.renderInteractiveLayer();
                renderCropRegionList();
                renderGroupedAccordion();
            });
            cropRegionList.appendChild(row);
        });
    }

    function updateStatusBar() {
        if (!appStatus) return;
        const workspaceLabel = currentWorkspace === 'extract' ? '切り抜き・レイヤー' : '配置';
        const modeLabel = currentWorkspace === 'extract'
            ? '枠の移動・拡縮'
            : (currentMode === 'draw' ? '登録（クリックで配置）' : '選択');
        const zoom = Math.round(core.coordConverter.zoomLevel * 100);
        const cropN = core.cropRegions.length;
        appStatus.textContent = `${workspaceLabel} | ${modeLabel} | 選択 ${core.selectedInstanceIds.size}件 | 抽出 ${cropN} | ${zoom}%${lastSaveLabel ? ' | ' + lastSaveLabel : ''}`;
    }

    function setWorkspace(ws) {
        currentWorkspace = ws === 'extract' ? 'extract' : 'place';
        core.workspace = currentWorkspace;
        const app = document.getElementById('app-container');
        if (app) {
            app.classList.toggle('workspace-place', currentWorkspace === 'place');
            app.classList.toggle('workspace-extract', currentWorkspace === 'extract');
        }
        if (btnWorkspacePlace) btnWorkspacePlace.classList.toggle('active', currentWorkspace === 'place');
        if (btnWorkspaceExtract) btnWorkspaceExtract.classList.toggle('active', currentWorkspace === 'extract');
        if (currentWorkspace === 'extract') {
            setMode('crop');
        } else if (currentMode === 'crop') {
            setMode('select');
        }
        core.renderInteractiveLayer();
        updateStatusBar();
    }

    function setMode(mode) {
        currentMode = mode;
        btnModeSelect.classList.toggle('active', mode === 'select');
        btnModeDraw.classList.toggle('active', mode === 'draw');
        if (mode === 'draw') {
            core.layerCanvas.style.cursor = 'crosshair';
        } else if (mode === 'crop') {
            core.layerCanvas.style.cursor = 'move';
            core.selectedInstanceIds.clear();
            core.renderInteractiveLayer();
        } else {
            core.layerCanvas.style.cursor = 'default';
        }
        updateStatusBar();
    }

    btnModeSelect.addEventListener('click', () => setMode('select'));
    btnModeDraw.addEventListener('click', () => setMode('draw'));
    if (btnWorkspacePlace) btnWorkspacePlace.addEventListener('click', () => setWorkspace('place'));
    if (btnWorkspaceExtract) btnWorkspaceExtract.addEventListener('click', () => setWorkspace('extract'));

    btnUndo.addEventListener('click', () => {
        if (undoStack.length === 0) return;
        redoStack.push({
            instances: JSON.parse(JSON.stringify(core.instances)),
            groups: JSON.parse(JSON.stringify(core.groups)),
            cropRegions: JSON.parse(JSON.stringify(core.cropRegions || []))
        });
        const prev = undoStack.pop();
        core.instances = prev.instances;
        core.groups = prev.groups;
        core.cropRegions = prev.cropRegions || [];
        core.selectedInstanceIds.clear();
        core.selectedCropRegionIds.clear();
        core.renderInteractiveLayer();
        renderGroupCards();
        loadActiveGroupIntoInlinePanel();
        renderGroupedAccordion();
        renderCropRegionList();
        updateHistoryButtons();
        updateStatusBar();
    });

    btnRedo.addEventListener('click', () => {
        if (redoStack.length === 0) return;
        undoStack.push({
            instances: JSON.parse(JSON.stringify(core.instances)),
            groups: JSON.parse(JSON.stringify(core.groups)),
            cropRegions: JSON.parse(JSON.stringify(core.cropRegions || []))
        });
        const next = redoStack.pop();
        core.instances = next.instances;
        core.groups = next.groups;
        core.cropRegions = next.cropRegions || [];
        core.selectedInstanceIds.clear();
        core.selectedCropRegionIds.clear();
        core.renderInteractiveLayer();
        renderGroupCards();
        loadActiveGroupIntoInlinePanel();
        renderGroupedAccordion();
        renderCropRegionList();
        updateHistoryButtons();
        updateStatusBar();
    });

    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            if (isTypingTarget(e.target)) return;
            e.preventDefault();
            btnUndo.click();
        } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
            if (isTypingTarget(e.target)) return;
            e.preventDefault();
            btnRedo.click();
        }
    });

    function updatePageIndicator() {
        curPageNumSpan.textContent = core.currentPageNum;
        totalPageNumSpan.textContent = core.totalPageNum;
        btnPrevPage.disabled = core.currentPageNum <= 1;
        btnNextPage.disabled = core.currentPageNum >= core.totalPageNum;
    }

    loadPdfFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (core.groups.length > 0 || core.instances.length > 0) {
            const clearOverlays = confirm('配置データが残っています。\nOK: 配置を消去して新しいPDFを読み込む\nキャンセル: 配置を残してPDFだけ差し替える');
            if (clearOverlays) {
                pushHistory();
                core.groups = [];
                core.instances = [];
                core.cropRegions = [];
                core.selectedInstanceIds.clear();
                core.selectedCropRegionIds.clear();
                activeGroupId = null;
                hideInlineGroupPanel();
                renderGroupCards();
                renderCropRegionList();
            }
        }
        const success = await core.loadPdfFile(file);
        if (success) {
            markDirty();
            updatePageIndicator();
            renderGroupedAccordion();
            renderPdfLayerList();
            renderCropRegionList();
            updateStatusBar();
        }
        loadPdfFileInput.value = '';
    });

    btnReplacePdf.addEventListener('click', () => replacePdfFileInput.click());
    replacePdfFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const success = await core.replacePdfFile(file);
        if (success) {
            markDirty();
            updatePageIndicator();
            renderPdfLayerList();
            core.renderInteractiveLayer();
        }
        replacePdfFileInput.value = '';
    });

    btnPrevPage.addEventListener('click', async () => {
        if (core.currentPageNum > 1) {
            await core.changePage(core.currentPageNum - 1);
            updatePageIndicator();
            renderGroupedAccordion();
            renderCropRegionList();
        }
    });

    btnNextPage.addEventListener('click', async () => {
        if (core.currentPageNum < core.totalPageNum) {
            await core.changePage(core.currentPageNum + 1);
            updatePageIndicator();
            renderGroupedAccordion();
            renderCropRegionList();
        }
    });

    const applyZoom = async (newZoom) => {
        await core.setZoom(newZoom / 100);
        zoomInput.value = Math.round(core.coordConverter.zoomLevel * 100);
        updateStatusBar();
    };
    btnZoomIn.addEventListener('click', () => applyZoom(Math.round(core.coordConverter.zoomLevel * 100) + 10));
    btnZoomOut.addEventListener('click', () => applyZoom(Math.round(core.coordConverter.zoomLevel * 100) - 10));
    zoomInput.addEventListener('change', (e) => applyZoom(parseInt(e.target.value, 10) || 100));

    const executeSaveVersion = async (opts) => {
        const silent = !!(opts && opts.silent);
        const saveKind = (opts && opts.saveKind) || 'manual';
        const baseName = projectNameInput.value.trim() || "作業";
        try {
            const saved = await core.saveToDatabase(baseName, { saveKind: saveKind });
            projectNameInput.value = saved.workName || baseName;
            workspaceDirty = false;
            lastSaveLabel = (saveKind === 'auto' ? '自動保存 ' : '保存 ') + new Date().toLocaleTimeString();
            updateStatusBar();
            const isModalVisible = window.getComputedStyle(dataModal).display !== 'none';
            if (isModalVisible) {
                renderModalHistoryList();
            }
            if (!silent) {
                alert(`バージョン履歴として保存しました:\n${saved.workName}（${saved.name}）`);
            }
        } catch (err) {
            console.error("保存失敗詳細:", err);
            if (!silent) alert("保存失敗: " + (err.message || err));
        }
    };

    btnSaveProject.addEventListener('click', executeSaveVersion);
    btnHistorySaveCurrent.addEventListener('click', executeSaveVersion);

    btnGeneratePdf.addEventListener('click', () => {
        const mode = pdfExportModeSelect ? pdfExportModeSelect.value : 'vector';
        const scope = pdfExportScopeSelect ? pdfExportScopeSelect.value : 'all';
        const respectLayers = pdfExportVisibleLayers ? pdfExportVisibleLayers.checked : true;
        core.exportScope = scope;
        core.respectLayerVisibility = respectLayers;
        core.exportPdf(mode, { scope: scope, respectLayers: respectLayers });
    });

    if (pdfExportScopeSelect) {
        pdfExportScopeSelect.addEventListener('change', () => {
            core.exportScope = pdfExportScopeSelect.value;
        });
    }
    if (pdfExportVisibleLayers) {
        pdfExportVisibleLayers.addEventListener('change', async () => {
            core.respectLayerVisibility = pdfExportVisibleLayers.checked;
            if (core.pdfDocument) await core.renderPage(core.currentPageNum);
        });
    }
    if (btnAddCropRegion) {
        btnAddCropRegion.addEventListener('click', () => {
            pushHistory();
            core.addCropRegion(currentPaperKey(), currentLandscape());
            setWorkspace('extract');
            if (pdfExportScopeSelect) {
                pdfExportScopeSelect.value = 'regions';
                core.exportScope = 'regions';
            }
            renderCropRegionList();
            updateStatusBar();
        });
    }
    if (btnDeleteCropRegion) {
        btnDeleteCropRegion.addEventListener('click', () => {
            if (core.selectedCropRegionIds.size === 0) return;
            pushHistory();
            core.cropRegions = core.cropRegions.filter(r => !core.selectedCropRegionIds.has(r.id));
            core.selectedCropRegionIds.clear();
            core.renderInteractiveLayer();
            renderCropRegionList();
            updateStatusBar();
        });
    }
    if (paperSizeSelect) {
        paperSizeSelect.addEventListener('change', () => {
            if (core.selectedCropRegionIds.size === 0) return;
            pushHistory();
            core.applyPaperToSelectedCropRegions(currentPaperKey(), currentLandscape());
            renderCropRegionList();
        });
    }
    if (paperOrientSelect) {
        paperOrientSelect.addEventListener('change', () => {
            if (core.selectedCropRegionIds.size === 0) return;
            pushHistory();
            core.applyPaperToSelectedCropRegions(currentPaperKey(), currentLandscape());
            renderCropRegionList();
        });
    }
    if (btnLayersAllOn) {
        btnLayersAllOn.addEventListener('click', async () => {
            await core.setAllPdfLayersVisible(true);
            renderPdfLayerList();
        });
    }
    if (btnLayersAllOff) {
        btnLayersAllOff.addEventListener('click', async () => {
            await core.setAllPdfLayersVisible(false);
            renderPdfLayerList();
        });
    }

    function hideInlineGroupPanel() {
        inlineGroupPanel.classList.remove('is-open');
    }

    function showInlineGroupPanel(groupId) {
        activeGroupId = groupId;
        renderGroupCards();
        loadActiveGroupIntoInlinePanel();
        inlineGroupPanel.classList.add('is-open');
    }

    function renderGroupCards() {
        groupCardsContainer.innerHTML = '';
        core.groups.forEach(g => {
            const card = document.createElement('div');
            card.className = `group-card ${g.id === activeGroupId ? 'active' : ''}`;

            const canvas = document.createElement('canvas');
            canvas.className = 'group-preview-canvas';
            canvas.width = 44;
            canvas.height = 30;
            drawGroupMiniPreview(canvas, g);

            const info = document.createElement('div');
            info.className = 'group-card-info';
            info.innerHTML = `<div class="group-card-name">${g.name || '無題グループ'}</div>
                              <div class="group-card-meta">${g.shape} / ${g.width}×${g.height}pt</div>`;

            const actions = document.createElement('div');
            actions.className = 'group-card-actions';

            const btnSetting = document.createElement('button');
            btnSetting.className = 'btn small btn-group-setting';
            btnSetting.textContent = '設定';
            btnSetting.addEventListener('click', (e) => {
                e.stopPropagation();
                showInlineGroupPanel(g.id);
            });

            const btnDeleteGroup = document.createElement('button');
            btnDeleteGroup.className = 'btn small danger';
            btnDeleteGroup.textContent = '削除';
            btnDeleteGroup.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(g.id);
            });

            actions.appendChild(btnSetting);
            actions.appendChild(btnDeleteGroup);

            card.appendChild(canvas);
            card.appendChild(info);
            card.appendChild(actions);

            card.addEventListener('click', () => {
                activeGroupId = g.id;
                renderGroupCards();
                hideInlineGroupPanel();
            });

            groupCardsContainer.appendChild(card);
        });
    }

    function loadActiveGroupIntoInlinePanel() {
        const g = core.groups.find(item => item.id === activeGroupId);
        if (!g) {
            hideInlineGroupPanel();
            return;
        }

        groupNameInput.value = g.name;
        groupShapeSelect.value = g.shape;
        groupSizeAuto.checked = g.isSizeAuto;
        groupWidthInput.value = g.width;
        groupHeightInput.value = g.height;
        groupHasBorder.checked = g.hasBorder;
        groupBorderWidth.value = g.borderWidth;
        groupBorderColor.value = g.borderColor || '#000000';
        syncColorDisplay(groupBorderColor, groupBorderColorText);

        groupTextColor.value = g.textColor || '#000000';
        syncColorDisplay(groupTextColor, groupTextColorText);

        const fontMap = { '游ゴシック': 'Yu Gothic' };
        groupFontSelect.value = fontMap[g.font] || g.font || 'Yu Gothic';
        groupFontSize.value = g.fontSize;
        groupBgColor.value = g.bgColor || '#ffffff';
        syncColorDisplay(groupBgColor, groupBgColorText);

        groupBgOpacity.value = g.bgOpacity;
        groupZIndex.value = g.zIndex;
        groupIsLocked.checked = g.isLocked;
        groupIsHidden.checked = g.isHidden;
        groupTextInput.value = g.defaultText;
        groupStartNum.value = g.startNumber;
        groupCapSize.value = g.capSize !== undefined ? g.capSize : 6;

        groupStartCap.value = g.startCap || 'none';
        groupEndCap.value = g.endCap || 'none';
        groupLineSettings.classList.toggle('is-visible', g.shape === 'line');
    }

    function drawGroupMiniPreview(canvas, group) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const pad = 3;
        const w = canvas.width - pad * 2;
        const h = canvas.height - pad * 2;

        ctx.save();
        ctx.translate(pad, pad);
        ctx.strokeStyle = group.hasBorder ? group.borderColor || '#000000' : 'transparent';
        ctx.lineWidth = Math.min(group.borderWidth || 1.5, 2.5);
        ctx.fillStyle = group.bgColor || '#ffffff';

        if (group.shape === 'line') {
            ctx.beginPath();
            ctx.moveTo(2, h / 2);
            ctx.lineTo(w - 2, h / 2);
            ctx.strokeStyle = group.borderColor || '#000000';
            ctx.stroke();

            if (group.startCap === 'circle') {
                ctx.fillStyle = group.borderColor || '#000000';
                ctx.beginPath(); ctx.arc(4, h / 2, 2.5, 0, Math.PI * 2); ctx.fill();
            } else if (group.startCap === 'arrow') {
                ctx.fillStyle = group.borderColor || '#000000';
                ctx.beginPath(); ctx.moveTo(2, h / 2); ctx.lineTo(6, h / 2 - 2.5); ctx.lineTo(6, h / 2 + 2.5); ctx.fill();
            }

            if (group.endCap === 'circle') {
                ctx.fillStyle = group.borderColor || '#000000';
                ctx.beginPath(); ctx.arc(w - 4, h / 2, 2.5, 0, Math.PI * 2); ctx.fill();
            } else if (group.endCap === 'arrow') {
                ctx.fillStyle = group.borderColor || '#000000';
                ctx.beginPath(); ctx.moveTo(w - 2, h / 2); ctx.lineTo(w - 6, h / 2 - 2.5); ctx.lineTo(w - 6, h / 2 + 2.5); ctx.fill();
            }
        } else {
            ctx.beginPath();
            if (group.shape === 'rectangle') {
                ctx.rect(1.5, 1.5, w - 3, h - 3);
            } else if (group.shape === 'circle') {
                ctx.ellipse(w / 2, h / 2, (w - 3) / 2, (h - 3) / 2, 0, 0, Math.PI * 2);
            } else if (group.shape === 'triangle') {
                ctx.moveTo(w / 2, 1.5);
                ctx.lineTo(w - 1.5, h - 1.5);
                ctx.lineTo(1.5, h - 1.5);
                ctx.closePath();
            } else if (group.shape === 'star') {
                core.buildStarPath(ctx, 1.5, 1.5, w - 3, h - 3);
            }

            if (group.bgOpacity > 0) {
                ctx.globalAlpha = group.bgOpacity;
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            if (group.hasBorder) ctx.stroke();
        }

        ctx.fillStyle = group.textColor || '#000000';
        ctx.fillRect(w / 4, h / 2 - 1, w / 2, 2);
        ctx.restore();
    }

    btnAddGroup.addEventListener('click', () => {
        pushHistory();
        const newId = core.groups.length > 0 ? Math.max(...core.groups.map(g => g.id)) + 1 : 1;
        const tmpl = (typeof WorkspaceData !== 'undefined')
            ? Object.assign({}, WorkspaceData.loadSettings().defaultGroup)
            : {};
        const newGroup = Object.assign({}, GroupModel, tmpl, {
            id: newId,
            projectId: core.currentProjectId || 1,
            name: (tmpl.name && tmpl.name !== '新規グループ') ? tmpl.name : `新規グループ ${newId}`
        });
        core.groups.push(newGroup);
        showInlineGroupPanel(newId);
    });

    function deleteGroup(groupId) {
        const group = core.groups.find(g => g.id === groupId);
        if (!group) return;
        const memberCount = core.instances.filter(i => i.groupId === groupId).length;
        const message = memberCount > 0
            ? `グループ「${group.name}」と所属オブジェクト ${memberCount} 件を削除しますか？`
            : `グループ「${group.name}」を削除しますか？`;
        if (!confirm(message)) return;
        pushHistory();
        core.instances = core.instances.filter(i => i.groupId !== groupId);
        core.groups = core.groups.filter(g => g.id !== groupId);
        core.selectedInstanceIds.forEach(id => {
            if (!core.instances.some(i => i.id === id)) core.selectedInstanceIds.delete(id);
        });
        if (activeGroupId === groupId) {
            activeGroupId = core.groups.length ? core.groups[0].id : null;
            hideInlineGroupPanel();
        }
        renderGroupCards();
        core.renderInteractiveLayer();
        renderGroupedAccordion();
        updateStatusBar();
    }

    if (btnSaveGroupAsDefault) {
        btnSaveGroupAsDefault.addEventListener('click', () => {
            const g = core.groups.find(item => item.id === activeGroupId);
            if (!g) {
                alert('先にグループを選んでください。');
                return;
            }
            const tmpl = WorkspaceData.defaultGroupTemplate();
            Object.keys(tmpl).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(g, key) && key !== 'id' && key !== 'projectId') {
                    tmpl[key] = g[key];
                }
            });
            appSettings.defaultGroup = tmpl;
            WorkspaceData.saveSettings(appSettings);
            alert('現在のグループ設定を初期グループにしました。新規グループに使われます。');
        });
    }

    const syncGroupFromInputs = () => {
        const g = core.groups.find(item => item.id === activeGroupId);
        if (!g) return;
        g.name = groupNameInput.value;
        g.shape = groupShapeSelect.value;
        g.isSizeAuto = groupSizeAuto.checked;
        g.width = parseFloat(groupWidthInput.value) || 0;
        g.height = parseFloat(groupHeightInput.value) || 0;
        g.hasBorder = groupHasBorder.checked;
        g.borderWidth = parseFloat(groupBorderWidth.value) || 0;
        g.borderColor = groupBorderColor.value;
        g.textColor = groupTextColor.value;
        g.font = groupFontSelect.value;
        g.fontSize = parseFloat(groupFontSize.value) || 12;
        g.bgColor = groupBgColor.value;
        g.bgOpacity = parseFloat(groupBgOpacity.value) || 0;
        g.zIndex = parseInt(groupZIndex.value, 10) || 0;
        g.isLocked = groupIsLocked.checked;
        g.isHidden = groupIsHidden.checked;
        g.defaultText = groupTextInput.value;
        g.startNumber = parseInt(groupStartNum.value, 10) || 1;

        g.startCap = groupStartCap.value;
        g.endCap = groupEndCap.value;
        g.capSize = parseFloat(groupCapSize.value) || 6;
        groupLineSettings.classList.toggle('is-visible', g.shape === 'line');

        syncColorDisplay(groupBorderColor, groupBorderColorText);
        syncColorDisplay(groupTextColor, groupTextColorText);
        syncColorDisplay(groupBgColor, groupBgColorText);

        renderGroupCards();
        core.renderInteractiveLayer();
        renderGroupedAccordion();
    };

    [groupNameInput, groupShapeSelect, groupSizeAuto, groupWidthInput, groupHeightInput,
     groupHasBorder, groupBorderWidth, groupBorderColor, groupTextColor, groupFontSelect,
     groupFontSize, groupBgColor, groupBgOpacity, groupZIndex,
     groupIsLocked, groupIsHidden, groupTextInput, groupStartNum,
     groupStartCap, groupEndCap, groupCapSize].forEach(el => {
        el.addEventListener('input', syncGroupFromInputs);
        el.addEventListener('change', () => { syncGroupFromInputs(); pushHistory(); });
    });

    function renderGroupedAccordion() {
        sortableInstances.forEach(s => {
            try { s.destroy(); } catch (err) { /* ignore */ }
        });
        sortableInstances.length = 0;
        groupedAccordionContainer.innerHTML = '';
        const curPage = core.currentPageNum - 1;
        const pageInstances = core.instances.filter(i => i.pageIndex === curPage);
        const searchQuery = instanceSearch.value.trim().toLowerCase();

        core.buildAutoTextIndexMap();

        core.groups.forEach(group => {
            const groupInsts = pageInstances.filter(inst => {
                if (inst.groupId !== group.id) return false;
                if (!searchQuery) return true;

                const effectiveRawText = inst.isTextLocked && inst.overrideText !== null ? inst.overrideText : group.defaultText;
                const displayText = core.resolveAutoText(effectiveRawText, inst, group);

                const targets = [
                    displayText,
                    effectiveRawText,
                    group.name,
                    String(inst.id)
                ].map(val => (val || '').toLowerCase());

                return targets.some(str => str.includes(searchQuery));
            });

            if (searchQuery && groupInsts.length === 0) return;

            groupInsts.sort((a, b) => a.order - b.order);

            const isCollapsed = searchQuery ? false : collapsedGroupIds.has(group.id);

            const groupBlock = document.createElement('div');
            groupBlock.className = 'accordion-group';

            const header = document.createElement('div');
            header.className = 'accordion-header';
            header.innerHTML = `<span>${group.name || '無題'} (${groupInsts.length})</span>
                                <span class="accordion-arrow ${isCollapsed ? 'collapsed' : ''}">▼</span>`;
            header.addEventListener('click', () => {
                if (collapsedGroupIds.has(group.id)) {
                    collapsedGroupIds.delete(group.id);
                } else {
                    collapsedGroupIds.add(group.id);
                }
                renderGroupedAccordion();
            });

            const bodyList = document.createElement('ul');
            bodyList.className = `accordion-body ${isCollapsed ? 'collapsed' : ''}`;
            bodyList.dataset.groupId = group.id;

            groupInsts.forEach(inst => {
                const item = document.createElement('li');
                item.className = `instance-item ${core.selectedInstanceIds.has(inst.id) ? 'highlighted' : ''}`;
                item.dataset.instanceId = inst.id;

                const handle = document.createElement('span');
                handle.className = 'drag-handle';
                handle.innerHTML = '⋮⋮';
                handle.title = 'ドラッグして連番順序を変更';

                const hasAnyOverride = (
                    inst.overrideShape !== null ||
                    inst.isSizeLocked ||
                    inst.isSizeAutoLocked ||
                    inst.isCapsLocked ||
                    inst.isHasBorderLocked ||
                    inst.isBorderWidthLocked ||
                    inst.isBorderColorLocked ||
                    inst.isTextColorLocked ||
                    inst.isBgColorLocked ||
                    inst.isFontSizeLocked ||
                    inst.isZIndexLocked ||
                    inst.isCapSizeLocked ||
                    (inst.isTextLocked && inst.overrideText !== null)
                );

                const badge = hasAnyOverride ? `<span class="badge-override" title="個別設定が適用されています">個別</span>` : '';

                const title = document.createElement('span');
                title.className = 'instance-title';
                const effectiveRawText = inst.isTextLocked && inst.overrideText !== null ? inst.overrideText : group.defaultText;
                const displayText = core.resolveAutoText(effectiveRawText, inst, group);
                title.innerHTML = `${badge}${displayText || '[' + group.name + ']'}`;

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn-delete-instance';
                btnDelete.innerHTML = '&times;';
                btnDelete.title = '削除';
                btnDelete.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pushHistory();
                    core.instances = core.instances.filter(i => i.id !== inst.id);
                    core.selectedInstanceIds.delete(inst.id);
                    core.renderInteractiveLayer();
                    renderGroupedAccordion();
                    updateStatusBar();
                });

                item.appendChild(handle);
                item.appendChild(title);
                item.appendChild(btnDelete);

                item.addEventListener('click', (e) => {
                    if (e.shiftKey) {
                        if (core.selectedInstanceIds.has(inst.id)) core.selectedInstanceIds.delete(inst.id);
                        else core.selectedInstanceIds.add(inst.id);
                    } else {
                        core.selectedInstanceIds.clear();
                        core.selectedInstanceIds.add(inst.id);
                    }
                    core.renderInteractiveLayer();
                    renderGroupedAccordion();
                    updateStatusBar();
                });

                item.addEventListener('dblclick', () => openInstanceModal(inst));
                bodyList.appendChild(item);
            });

            groupBlock.appendChild(header);
            groupBlock.appendChild(bodyList);
            groupedAccordionContainer.appendChild(groupBlock);

            if (typeof Sortable !== 'undefined') {
                const sortable = new Sortable(bodyList, {
                    handle: '.drag-handle',
                    animation: 150,
                    onEnd: () => {
                        pushHistory();
                        const itemEls = Array.from(bodyList.children);
                        itemEls.forEach((el, index) => {
                            const instId = parseInt(el.dataset.instanceId, 10);
                            const instObj = core.instances.find(i => i.id === instId);
                            if (instObj) instObj.order = index;
                        });
                        core.renderInteractiveLayer();
                        renderGroupedAccordion();
                    }
                });
                sortableInstances.push(sortable);
            }
        });
    }

    instanceSearch.addEventListener('input', renderGroupedAccordion);

    function copySelectedInstances() {
        if (typeof WorkspaceData === 'undefined') return;
        if (core.selectedInstanceIds.size === 0) {
            alert('コピーするオブジェクトを選択してください。');
            return;
        }
        const payload = WorkspaceData.buildCopyPayload(core.groups, core.instances, core.selectedInstanceIds);
        const text = JSON.stringify(payload);
        window._pdfObjectClipboard = text;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
        lastSaveLabel = `コピー ${payload.instances.length}件`;
        updateStatusBar();
    }

    async function pasteCopiedInstances() {
        if (typeof WorkspaceData === 'undefined') return;
        let text = window._pdfObjectClipboard || '';
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                const clip = await navigator.clipboard.readText();
                if (clip && clip.indexOf('pdf-autonumbering-objects') !== -1) text = clip;
            } catch (e) { /* 権限なし時は内部クリップボード */ }
        }
        const payload = WorkspaceData.parseCopyPayload(text);
        if (!payload) {
            alert('貼り付けできるオブジェクトデータがありません。');
            return;
        }
        const mapped = WorkspaceData.cloneForPaste(
            payload,
            core.groups,
            core.instances,
            core.currentPageNum - 1,
            WorkspaceData.PASTE_OFFSET_PT
        );
        pushHistory();
        mapped.groups.forEach((g) => core.groups.push(g));
        mapped.instances.forEach((inst) => core.instances.push(inst));
        core.selectedInstanceIds = new Set(mapped.instances.map((i) => i.id));
        renderGroupCards();
        core.renderInteractiveLayer();
        renderGroupedAccordion();
        updateStatusBar();
    }

    if (btnCopyInstances) btnCopyInstances.addEventListener('click', copySelectedInstances);
    if (btnPasteInstances) btnPasteInstances.addEventListener('click', () => { pasteCopiedInstances(); });

    function bindOverridePair(checkbox, inputEl, parentCard) {
        const updateState = () => {
            const isChecked = checkbox.checked;
            if (Array.isArray(inputEl)) {
                inputEl.forEach(el => el.disabled = !isChecked);
            } else {
                inputEl.disabled = !isChecked;
            }
            if (parentCard) {
                if (isChecked) parentCard.classList.add('active');
                else parentCard.classList.remove('active');
            }
        };
        checkbox.addEventListener('change', updateState);
        updateState();
    }

    bindOverridePair(flagOverrideShape, instShape, flagOverrideShape.closest('.override-card'));
    bindOverridePair(flagOverrideSize, [instWidth, instHeight], flagOverrideSize.closest('.override-card'));
    bindOverridePair(flagOverrideAutosize, instSizeAuto, flagOverrideAutosize.closest('.override-card'));
    bindOverridePair(flagOverrideCaps, [instStartCap, instEndCap], flagOverrideCaps.closest('.override-card'));
    bindOverridePair(flagOverrideCapSize, instCapSize, flagOverrideCapSize.closest('.override-card'));
    bindOverridePair(flagOverrideHasBorder, instHasBorder, flagOverrideHasBorder.closest('.override-card'));
    bindOverridePair(flagOverrideBorderWidth, instBorderWidth, flagOverrideBorderWidth.closest('.override-card'));
    bindOverridePair(flagOverrideBorderColor, instBorderColor, flagOverrideBorderColor.closest('.override-card'));
    bindOverridePair(flagOverrideTextColor, instTextColor, flagOverrideTextColor.closest('.override-card'));
    bindOverridePair(flagOverrideBgColor, [instBgColor, instBgOpacity], flagOverrideBgColor.closest('.override-card'));
    bindOverridePair(flagOverrideFontSize, instFontSize, flagOverrideFontSize.closest('.override-card'));
    bindOverridePair(flagOverrideZIndex, instZIndex, flagOverrideZIndex.closest('.override-card'));
    bindOverridePair(flagOverrideText, instText, flagOverrideText.closest('.override-card'));

    function openInstanceModal(inst) {
        editingInstance = inst;
        const g = core.groups.find(group => group.id === inst.groupId) || GroupModel;

        instModalTitle.textContent = `アイテム詳細設定 [ID: ${inst.id}] (${g.name})`;

        instIsLocked.checked = !!inst.isLocked;
        instIsHidden.checked = !!inst.isHidden;
        instX.value = inst.x;
        instY.value = inst.y;

        flagOverrideShape.checked = (inst.overrideShape !== null);
        instShape.value = inst.overrideShape || g.shape;

        flagOverrideSize.checked = !!inst.isSizeLocked;
        instWidth.value = inst.overrideWidth !== null ? inst.overrideWidth : g.width;
        instHeight.value = inst.overrideHeight !== null ? inst.overrideHeight : g.height;

        flagOverrideAutosize.checked = !!inst.isSizeAutoLocked;
        instSizeAuto.checked = inst.overrideSizeAuto !== null ? inst.overrideSizeAuto : g.isSizeAuto;

        flagOverrideCaps.checked = !!inst.isCapsLocked;
        instStartCap.value = inst.overrideStartCap !== null ? inst.overrideStartCap : (g.startCap || 'none');
        instEndCap.value = inst.overrideEndCap !== null ? inst.overrideEndCap : (g.endCap || 'none');
        const effectiveShape = inst.overrideShape || g.shape;
        instLineRow.style.display = effectiveShape === 'line' ? 'flex' : 'none';
        instCapSizeRow.style.display = effectiveShape === 'line' ? 'flex' : 'none';

        flagOverrideCapSize.checked = !!inst.isCapSizeLocked;
        instCapSize.value = inst.overrideCapSize !== null ? inst.overrideCapSize : (g.capSize !== undefined ? g.capSize : 6);

        flagOverrideHasBorder.checked = !!inst.isHasBorderLocked;
        instHasBorder.checked = inst.overrideHasBorder !== null ? inst.overrideHasBorder : g.hasBorder;

        flagOverrideBorderWidth.checked = !!inst.isBorderWidthLocked;
        instBorderWidth.value = inst.overrideBorderWidth !== null ? inst.overrideBorderWidth : g.borderWidth;

        flagOverrideBorderColor.checked = !!inst.isBorderColorLocked;
        instBorderColor.value = inst.overrideBorderColor ? inst.overrideBorderColor : (g.borderColor || '#000000');
        syncColorDisplay(instBorderColor, instBorderColorText);

        flagOverrideTextColor.checked = !!inst.isTextColorLocked;
        instTextColor.value = inst.overrideTextColor ? inst.overrideTextColor : (g.textColor || '#000000');
        syncColorDisplay(instTextColor, instTextColorText);

        flagOverrideBgColor.checked = !!inst.isBgColorLocked;
        instBgColor.value = inst.overrideBgColor ? inst.overrideBgColor : (g.bgColor || '#ffffff');
        syncColorDisplay(instBgColor, instBgColorText);
        instBgOpacity.value = inst.overrideBgOpacity !== null ? inst.overrideBgOpacity : g.bgOpacity;

        flagOverrideFontSize.checked = !!inst.isFontSizeLocked;
        instFontSize.value = inst.overrideFontSize !== null ? inst.overrideFontSize : g.fontSize;

        flagOverrideZIndex.checked = !!inst.isZIndexLocked;
        instZIndex.value = inst.overrideZIndex !== null ? inst.overrideZIndex : g.zIndex;

        flagOverrideText.checked = !!inst.isTextLocked;
        instText.value = inst.overrideText !== null ? inst.overrideText : g.defaultText;

        [flagOverrideShape, flagOverrideSize, flagOverrideAutosize, flagOverrideCaps, flagOverrideCapSize,
         flagOverrideHasBorder, flagOverrideBorderWidth, flagOverrideBorderColor,
         flagOverrideTextColor, flagOverrideBgColor, flagOverrideFontSize,
         flagOverrideZIndex, flagOverrideText].forEach(chk => {
            chk.dispatchEvent(new Event('change'));
        });

        instanceModal.style.display = 'flex';
    }

    closeInstModal.addEventListener('click', () => instanceModal.style.display = 'none');
    btnModalCancel.addEventListener('click', () => instanceModal.style.display = 'none');

    btnModalSave.addEventListener('click', () => {
        if (!editingInstance) return;
        pushHistory();

        editingInstance.x = parseFloat(instX.value) || 0;
        editingInstance.y = parseFloat(instY.value) || 0;
        editingInstance.isLocked = instIsLocked.checked;
        editingInstance.isHidden = instIsHidden.checked;

        if (flagOverrideShape.checked) {
            editingInstance.overrideShape = instShape.value;
        } else {
            editingInstance.overrideShape = null;
        }

        if (flagOverrideSize.checked) {
            editingInstance.isSizeLocked = true;
            editingInstance.overrideWidth = parseFloat(instWidth.value) || 0;
            editingInstance.overrideHeight = parseFloat(instHeight.value) || 0;
        } else {
            editingInstance.isSizeLocked = false;
            editingInstance.overrideWidth = null;
            editingInstance.overrideHeight = null;
        }

        if (flagOverrideAutosize.checked) {
            editingInstance.isSizeAutoLocked = true;
            editingInstance.overrideSizeAuto = instSizeAuto.checked;
        } else {
            editingInstance.isSizeAutoLocked = false;
            editingInstance.overrideSizeAuto = null;
        }

        if (flagOverrideCaps.checked) {
            editingInstance.isCapsLocked = true;
            editingInstance.overrideStartCap = instStartCap.value;
            editingInstance.overrideEndCap = instEndCap.value;
        } else {
            editingInstance.isCapsLocked = false;
            editingInstance.overrideStartCap = null;
            editingInstance.overrideEndCap = null;
        }

        if (flagOverrideCapSize.checked) {
            editingInstance.isCapSizeLocked = true;
            editingInstance.overrideCapSize = parseFloat(instCapSize.value) || 6;
        } else {
            editingInstance.isCapSizeLocked = false;
            editingInstance.overrideCapSize = null;
        }

        if (flagOverrideHasBorder.checked) {
            editingInstance.isHasBorderLocked = true;
            editingInstance.overrideHasBorder = instHasBorder.checked;
        } else {
            editingInstance.isHasBorderLocked = false;
            editingInstance.overrideHasBorder = null;
        }

        if (flagOverrideBorderWidth.checked) {
            editingInstance.isBorderWidthLocked = true;
            editingInstance.overrideBorderWidth = parseFloat(instBorderWidth.value) || 0;
        } else {
            editingInstance.isBorderWidthLocked = false;
            editingInstance.overrideBorderWidth = null;
        }

        if (flagOverrideBorderColor.checked) {
            editingInstance.isBorderColorLocked = true;
            editingInstance.overrideBorderColor = instBorderColor.value;
        } else {
            editingInstance.isBorderColorLocked = false;
            editingInstance.overrideBorderColor = null;
        }

        if (flagOverrideTextColor.checked) {
            editingInstance.isTextColorLocked = true;
            editingInstance.overrideTextColor = instTextColor.value;
        } else {
            editingInstance.isTextColorLocked = false;
            editingInstance.overrideTextColor = null;
        }

        if (flagOverrideBgColor.checked) {
            editingInstance.isBgColorLocked = true;
            editingInstance.overrideBgColor = instBgColor.value;
            editingInstance.overrideBgOpacity = parseFloat(instBgOpacity.value) || 0;
        } else {
            editingInstance.isBgColorLocked = false;
            editingInstance.overrideBgColor = null;
            editingInstance.overrideBgOpacity = null;
        }

        if (flagOverrideFontSize.checked) {
            editingInstance.isFontSizeLocked = true;
            editingInstance.overrideFontSize = parseFloat(instFontSize.value) || 12;
        } else {
            editingInstance.isFontSizeLocked = false;
            editingInstance.overrideFontSize = null;
        }

        if (flagOverrideZIndex.checked) {
            editingInstance.isZIndexLocked = true;
            editingInstance.overrideZIndex = parseInt(instZIndex.value, 10) || 0;
        } else {
            editingInstance.isZIndexLocked = false;
            editingInstance.overrideZIndex = null;
        }

        if (flagOverrideText.checked) {
            editingInstance.isTextLocked = true;
            editingInstance.overrideText = instText.value;
        } else {
            editingInstance.isTextLocked = false;
            editingInstance.overrideText = null;
        }

        instanceModal.style.display = 'none';
        core.renderInteractiveLayer();
        renderGroupedAccordion();
        updateStatusBar();
    });

    const layerCanvas = document.getElementById('interactive-layer-canvas');

    layerCanvas.addEventListener('mousedown', (e) => {
        hideInlineGroupPanel();

        if (e.button !== 0) return;
        const rect = layerCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const curPage = core.currentPageNum - 1;

        const cropHit = core.hitTestCropRegion(clickX, clickY, curPage);
        if (currentWorkspace === 'extract') {
            if (!cropHit) {
                core.selectedCropRegionIds.clear();
                core.renderInteractiveLayer();
                renderCropRegionList();
                return;
            }
            if (!e.shiftKey) core.selectedInstanceIds.clear();
            core.selectedCropRegionIds.clear();
            core.selectedCropRegionIds.add(cropHit.region.id);
            if (paperSizeSelect) paperSizeSelect.value = cropHit.region.paperKey;
            if (paperOrientSelect) paperOrientSelect.value = cropHit.region.landscape ? 'landscape' : 'portrait';
            pushHistory();
            isDragging = true;
            dragMode = cropHit.handle ? 'crop-resize' : 'crop-move';
            resizeHandleDir = cropHit.handle || '';
            dragStartMouse = { x: clickX, y: clickY };
            dragInitialCrop = Object.assign({}, cropHit.region);
            core.renderInteractiveLayer();
            renderCropRegionList();
            updateStatusBar();
            return;
        }

        if (currentMode === 'draw') {
            if (core.groups.length === 0) {
                alert('先にグループを作成してください。');
                return;
            }
            if (!activeGroupId) {
                activeGroupId = core.groups[0].id;
            }
            const group = core.groups.find(g => g.id === activeGroupId);
            if (!group) return;
            if (group.isLocked) {
                alert('このグループはロックされています。配置できません。');
                return;
            }

            pushHistory();
            const isLine = group.shape === 'line';
            const ptCoords = core.coordConverter.screenPixelsToPdfPoints(clickX, clickY, group.width, group.height, isLine);
            const newInstId = core.instances.length > 0 ? Math.max(...core.instances.map(i => i.id)) + 1 : 1;
            const groupOrders = core.instances.filter(i => i.groupId === group.id).map(i => i.order);
            const nextOrder = groupOrders.length > 0 ? Math.max(...groupOrders) + 1 : 0;
            const newInst = Object.assign({}, InstanceModel, {
                id: newInstId,
                projectId: core.currentProjectId || 1,
                groupId: group.id,
                pageIndex: curPage,
                order: nextOrder,
                x: ptCoords.x,
                y: ptCoords.y
            });
            core.instances.push(newInst);
            core.selectedInstanceIds.clear();
            core.selectedInstanceIds.add(newInstId);
            core.renderInteractiveLayer();
            renderGroupedAccordion();
            updateStatusBar();
            return;
        }

        if (core.selectedInstanceIds.size === 1) {
            const selId = Array.from(core.selectedInstanceIds)[0];
            const selInst = core.instances.find(i => i.id === selId);
            if (selInst && selInst.pageIndex === curPage && !isInstanceLocked(selInst)) {
                const group = core.groups.find(g => g.id === selInst.groupId);
                const shape = selInst.overrideShape || (group ? group.shape : 'rectangle');
                const ptW = selInst.isSizeLocked && selInst.overrideWidth !== null ? selInst.overrideWidth : (group ? group.width : 100);
                const ptH = selInst.isSizeLocked && selInst.overrideHeight !== null ? selInst.overrideHeight : (group ? group.height : 50);

                if (shape === 'line') {
                    const sRect = core.coordConverter.pdfPointsToScreenPixels(selInst.x, selInst.y, ptW, ptH, true);
                    const startX = sRect.x, startY = sRect.y;
                    const endX = sRect.x + sRect.width, endY = sRect.y + sRect.height;
                    const hitR = 8 * core.coordConverter.zoomLevel;

                    if (Math.hypot(clickX - startX, clickY - startY) <= hitR) {
                        pushHistory();
                        isDragging = true;
                        dragMode = 'line-start';
                        dragStartMouse = { x: clickX, y: clickY };
                        dragInitialPositions.clear();
                        dragInitialPositions.set(selInst.id, { x: selInst.x, y: selInst.y, width: ptW, height: ptH });
                        return;
                    }
                    if (Math.hypot(clickX - endX, clickY - endY) <= hitR) {
                        pushHistory();
                        isDragging = true;
                        dragMode = 'line-end';
                        dragStartMouse = { x: clickX, y: clickY };
                        dragInitialPositions.clear();
                        dragInitialPositions.set(selInst.id, { x: selInst.x, y: selInst.y, width: ptW, height: ptH });
                        return;
                    }
                } else {
                    const sRect = core.coordConverter.pdfPointsToScreenPixels(selInst.x, selInst.y, ptW, ptH, false);
                    const rx = sRect.x, ry = sRect.y, rw = sRect.width, rh = sRect.height;
                    const handleDefs = [
                        { dir: 'nw', x: rx, y: ry },
                        { dir: 'n',  x: rx + rw / 2, y: ry },
                        { dir: 'ne', x: rx + rw, y: ry },
                        { dir: 'e',  x: rx + rw, y: ry + rh / 2 },
                        { dir: 'se', x: rx + rw, y: ry + rh },
                        { dir: 's',  x: rx + rw / 2, y: ry + rh },
                        { dir: 'sw', x: rx, y: ry + rh },
                        { dir: 'w',  x: rx, y: ry + rh / 2 }
                    ];

                    const hitHandle = handleDefs.find(h => Math.abs(clickX - h.x) <= 6 && Math.abs(clickY - h.y) <= 6);
                    if (hitHandle) {
                        pushHistory();
                        isDragging = true;
                        dragMode = 'resize';
                        resizeHandleDir = hitHandle.dir;
                        dragStartMouse = { x: clickX, y: clickY };
                        dragInitialPositions.clear();
                        dragInitialPositions.set(selInst.id, { x: selInst.x, y: selInst.y, width: ptW, height: ptH });
                        return;
                    }
                }
            }
        }

        let hitInstance = null;
        const paintOrder = getPaintSortedInstances(curPage);
        for (let i = paintOrder.length - 1; i >= 0; i--) {
            const inst = paintOrder[i];
            if (inst.isHidden) continue;
            const group = core.groups.find(g => g.id === inst.groupId);
            if (!group || group.isHidden) continue;

            const ptW = inst.isSizeLocked && inst.overrideWidth !== null ? inst.overrideWidth : group.width;
            const ptH = inst.isSizeLocked && inst.overrideHeight !== null ? inst.overrideHeight : group.height;
            const isLine = (inst.overrideShape || group.shape) === 'line';
            const sRect = core.coordConverter.pdfPointsToScreenPixels(inst.x, inst.y, ptW, ptH, isLine);

            if (isLine) {
                const x1 = sRect.x, y1 = sRect.y, x2 = sRect.x + sRect.width, y2 = sRect.y + sRect.height;
                const d = distToSegment({ x: clickX, y: clickY }, { x: x1, y: y1 }, { x: x2, y: y2 });
                if (d <= 8 * core.coordConverter.zoomLevel) {
                    hitInstance = inst;
                    break;
                }
            } else {
                if (clickX >= sRect.x && clickX <= sRect.x + sRect.width &&
                    clickY >= sRect.y && clickY <= sRect.y + sRect.height) {
                    hitInstance = inst;
                    break;
                }
            }
        }

        if (hitInstance) {
            if (e.shiftKey) {
                if (core.selectedInstanceIds.has(hitInstance.id)) core.selectedInstanceIds.delete(hitInstance.id);
                else core.selectedInstanceIds.add(hitInstance.id);
            } else {
                if (!core.selectedInstanceIds.has(hitInstance.id)) {
                    core.selectedInstanceIds.clear();
                    core.selectedInstanceIds.add(hitInstance.id);
                }
            }

            pushHistory();
            isDragging = true;
            dragMode = 'move';
            dragStartMouse = { x: clickX, y: clickY };
            dragInitialPositions.clear();
            core.selectedInstanceIds.forEach(id => {
                const it = core.instances.find(i => i.id === id);
                if (it && !isInstanceLocked(it)) {
                    dragInitialPositions.set(it.id, { x: it.x, y: it.y });
                }
            });
        } else {
            if (!e.shiftKey) core.selectedInstanceIds.clear();
            isDragging = true;
            dragMode = 'marquee';
            dragStartMouse = { x: clickX, y: clickY };
            core.selectionBox = { x: clickX, y: clickY, width: 0, height: 0 };
        }

        core.renderInteractiveLayer();
        renderGroupedAccordion();
        updateStatusBar();
    });

    window.addEventListener('mousemove', (e) => {
        const rect = layerCanvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        if (!isDragging && currentWorkspace === 'place' && core.selectedInstanceIds.size === 1) {
            const selId = Array.from(core.selectedInstanceIds)[0];
            const selInst = core.instances.find(i => i.id === selId);
            if (selInst && selInst.pageIndex === core.currentPageNum - 1 && !isInstanceLocked(selInst)) {
                const group = core.groups.find(g => g.id === selInst.groupId);
                const shape = selInst.overrideShape || (group ? group.shape : 'rectangle');
                if (shape !== 'line') {
                    const ptW = selInst.isSizeLocked && selInst.overrideWidth !== null ? selInst.overrideWidth : (group ? group.width : 100);
                    const ptH = selInst.isSizeLocked && selInst.overrideHeight !== null ? selInst.overrideHeight : (group ? group.height : 50);
                    const sRect = core.coordConverter.pdfPointsToScreenPixels(selInst.x, selInst.y, ptW, ptH, false);
                    const rx = sRect.x, ry = sRect.y, rw = sRect.width, rh = sRect.height;
                    const handleDefs = [
                        { dir: 'nw-resize', x: rx, y: ry },
                        { dir: 'ns-resize', x: rx + rw / 2, y: ry },
                        { dir: 'ne-resize', x: rx + rw, y: ry },
                        { dir: 'ew-resize', x: rx + rw, y: ry + rh / 2 },
                        { dir: 'se-resize', x: rx + rw, y: ry + rh },
                        { dir: 'ns-resize', x: rx + rw / 2, y: ry + rh },
                        { dir: 'sw-resize', x: rx, y: ry + rh },
                        { dir: 'ew-resize', x: rx + rw, y: ry + rh / 2 }
                    ];
                    const hit = handleDefs.find(h => Math.abs(currentX - h.x) <= 6 && Math.abs(currentY - h.y) <= 6);
                    if (hit) {
                        layerCanvas.style.cursor = hit.dir;
                        return;
                    }
                }
            }
        }
        if (!isDragging) {
            if (currentWorkspace === 'extract') {
                const cropHover = core.hitTestCropRegion(currentX, currentY, core.currentPageNum - 1);
                if (cropHover && cropHover.handle) {
                    const map = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize' };
                    layerCanvas.style.cursor = map[cropHover.handle] || 'move';
                    return;
                }
                layerCanvas.style.cursor = cropHover ? 'move' : 'default';
                return;
            }
            layerCanvas.style.cursor = currentMode === 'draw' ? 'crosshair' : 'default';
            return;
        }
        const deltaScreenX = currentX - dragStartMouse.x;
        const deltaScreenY = currentY - dragStartMouse.y;
        const deltaPtX = deltaScreenX / (core.coordConverter.zoomLevel * core.coordConverter.ptToPxRatio);
        const deltaPtY = -deltaScreenY / (core.coordConverter.zoomLevel * core.coordConverter.ptToPxRatio);
        const pageW = core.coordConverter.pageWidthPoints || 595.28;
        const pageH = core.coordConverter.pageHeightPoints || 841.89;

        if (dragMode === 'crop-move' && dragInitialCrop) {
            const moved = PdfLayoutTools.moveRegion(dragInitialCrop, deltaPtX, deltaPtY, pageW, pageH);
            const idx = core.cropRegions.findIndex(r => r.id === dragInitialCrop.id);
            if (idx >= 0) core.cropRegions[idx] = moved;
            core.requestLayerRender();
        } else if (dragMode === 'crop-resize' && dragInitialCrop) {
            const resized = PdfLayoutTools.resizeRegion(dragInitialCrop, resizeHandleDir, deltaPtX, deltaPtY, pageW, pageH);
            const idx = core.cropRegions.findIndex(r => r.id === dragInitialCrop.id);
            if (idx >= 0) core.cropRegions[idx] = resized;
            core.requestLayerRender();
        } else if (dragMode === 'move') {
            dragInitialPositions.forEach((pos, id) => {
                const inst = core.instances.find(i => i.id === id);
                if (inst) {
                    inst.x = Math.round((pos.x + deltaPtX) * 10) / 10;
                    inst.y = Math.round((pos.y + deltaPtY) * 10) / 10;
                }
            });
            core.requestLayerRender();
        } else if (dragMode === 'line-start') {
            const [instId, init] = Array.from(dragInitialPositions.entries())[0];
            const inst = core.instances.find(i => i.id === instId);
            if (inst) {
                inst.x = Math.round((init.x + deltaPtX) * 10) / 10;
                inst.y = Math.round((init.y + deltaPtY) * 10) / 10;
                inst.isSizeLocked = true;
                inst.overrideWidth = Math.round((init.width - deltaPtX) * 10) / 10;
                inst.overrideHeight = Math.round((init.height - deltaPtY) * 10) / 10;
                core.requestLayerRender();
            }
        } else if (dragMode === 'line-end') {
            const [instId, init] = Array.from(dragInitialPositions.entries())[0];
            const inst = core.instances.find(i => i.id === instId);
            if (inst) {
                inst.isSizeLocked = true;
                inst.overrideWidth = Math.round((init.width + deltaPtX) * 10) / 10;
                inst.overrideHeight = Math.round((init.height + deltaPtY) * 10) / 10;
                core.requestLayerRender();
            }
        } else if (dragMode === 'resize') {
            const [instId, init] = Array.from(dragInitialPositions.entries())[0];
            const inst = core.instances.find(i => i.id === instId);
            if (inst) {
                inst.isSizeLocked = true;
                let newX = init.x;
                let newY = init.y;
                let newW = init.width;
                let newH = init.height;

                if (resizeHandleDir.includes('e')) newW = Math.max(5, init.width + deltaPtX);
                if (resizeHandleDir.includes('w')) {
                    newW = Math.max(5, init.width - deltaPtX);
                    newX = init.x + (init.width - newW);
                }
                if (resizeHandleDir.includes('n')) newH = Math.max(5, init.height + deltaPtY);
                if (resizeHandleDir.includes('s')) {
                    newH = Math.max(5, init.height - deltaPtY);
                    newY = init.y + (init.height - newH);
                }

                inst.x = Math.round(newX * 10) / 10;
                inst.y = Math.round(newY * 10) / 10;
                inst.overrideWidth = Math.round(newW * 10) / 10;
                inst.overrideHeight = Math.round(newH * 10) / 10;
                core.requestLayerRender();
            }
        } else if (dragMode === 'marquee') {
            const x = Math.min(dragStartMouse.x, currentX);
            const y = Math.min(dragStartMouse.y, currentY);
            const w = Math.abs(currentX - dragStartMouse.x);
            const h = Math.abs(currentY - dragStartMouse.y);
            core.selectionBox = { x, y, width: w, height: h };
            core.requestLayerRender();
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        if (dragMode === 'marquee' && core.selectionBox) {
            const { x, y, width, height } = core.selectionBox;
            const curPage = core.currentPageNum - 1;
            core.instances.forEach(inst => {
                if (inst.pageIndex !== curPage || inst.isHidden) return;
                const g = core.groups.find(group => group.id === inst.groupId);
                if (!g || g.isHidden) return;
                const ptW = inst.isSizeLocked && inst.overrideWidth !== null ? inst.overrideWidth : g.width;
                const ptH = inst.isSizeLocked && inst.overrideHeight !== null ? inst.overrideHeight : g.height;
                const sRect = core.coordConverter.pdfPointsToScreenPixels(inst.x, inst.y, ptW, ptH, (inst.overrideShape || g.shape) === 'line');

                const rx = Math.min(sRect.x, sRect.x + sRect.width);
                const ry = Math.min(sRect.y, sRect.y + sRect.height);
                const rw = Math.abs(sRect.width);
                const rh = Math.abs(sRect.height);

                if (rx + rw >= x && rx <= x + width &&
                    ry + rh >= y && ry <= y + height) {
                    core.selectedInstanceIds.add(inst.id);
                }
            });
            core.selectionBox = null;
        }
        isDragging = false;
        dragInitialCrop = null;
        core.renderInteractiveLayer();
        renderGroupedAccordion();
        renderCropRegionList();
        updateStatusBar();
    });

    layerCanvas.addEventListener('dblclick', () => {
        if (currentWorkspace !== 'place') return;
        if (core.selectedInstanceIds.size === 1) {
            const id = Array.from(core.selectedInstanceIds)[0];
            const inst = core.instances.find(i => i.id === id);
            if (inst) openInstanceModal(inst);
        }
    });

    function distToSegment(p, v, w) {
        const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    }

    function getSelectedObjects() {
        return core.instances.filter(i => core.selectedInstanceIds.has(i.id) && !isInstanceLocked(i));
    }

    function getBounds(inst) {
        const g = core.groups.find(group => group.id === inst.groupId);
        const w = inst.isSizeLocked && inst.overrideWidth !== null ? inst.overrideWidth : (g ? g.width : 0);
        const h = inst.isSizeLocked && inst.overrideHeight !== null ? inst.overrideHeight : (g ? g.height : 0);
        return { x: inst.x, y: inst.y, w, h };
    }

    btnAlignLeft.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const minX = Math.min(...objs.map(o => o.x));
        objs.forEach(o => o.x = minX);
        core.renderInteractiveLayer();
    });

    btnAlignHCenter.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const bounds = objs.map(o => getBounds(o));
        const minX = Math.min(...bounds.map(b => b.x));
        const maxX = Math.max(...bounds.map(b => b.x + b.w));
        const targetCenterX = (minX + maxX) / 2;
        objs.forEach(o => {
            const b = getBounds(o);
            o.x = targetCenterX - b.w / 2;
        });
        core.renderInteractiveLayer();
    });

    btnAlignRight.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const bounds = objs.map(o => getBounds(o));
        const maxRight = Math.max(...bounds.map(b => b.x + b.w));
        objs.forEach(o => {
            const b = getBounds(o);
            o.x = maxRight - b.w;
        });
        core.renderInteractiveLayer();
    });

    btnDistributeH.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 3) return;
        pushHistory();
        objs.sort((a, b) => a.x - b.x);
        const bounds = objs.map(o => getBounds(o));
        const minX = bounds[0].x;
        const last = bounds[bounds.length - 1];
        const maxX = last.x + last.w;
        const totalObjW = bounds.reduce((sum, b) => sum + b.w, 0);
        const gap = (maxX - minX - totalObjW) / (objs.length - 1);
        let curX = minX;
        for (let i = 0; i < objs.length; i++) {
            objs[i].x = curX;
            curX += bounds[i].w + gap;
        }
        core.renderInteractiveLayer();
    });

    btnAlignTop.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const bounds = objs.map(o => getBounds(o));
        const maxTop = Math.max(...bounds.map(b => b.y + b.h));
        objs.forEach(o => {
            const b = getBounds(o);
            o.y = maxTop - b.h;
        });
        core.renderInteractiveLayer();
    });

    btnAlignVCenter.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const bounds = objs.map(o => getBounds(o));
        const minY = Math.min(...bounds.map(b => b.y));
        const maxY = Math.max(...bounds.map(b => b.y + b.h));
        const targetCenterY = (minY + maxY) / 2;
        objs.forEach(o => {
            const b = getBounds(o);
            o.y = targetCenterY - b.h / 2;
        });
        core.renderInteractiveLayer();
    });

    btnAlignBottom.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 2) return;
        pushHistory();
        const minY = Math.min(...objs.map(o => o.y));
        objs.forEach(o => o.y = minY);
        core.renderInteractiveLayer();
    });

    btnDistributeV.addEventListener('click', () => {
        const objs = getSelectedObjects();
        if (objs.length < 3) return;
        pushHistory();
        objs.sort((a, b) => a.y - b.y);
        const bounds = objs.map(o => getBounds(o));
        const minY = bounds[0].y;
        const last = bounds[bounds.length - 1];
        const maxY = last.y + last.h;
        const totalObjH = bounds.reduce((sum, b) => sum + b.h, 0);
        const gap = (maxY - minY - totalObjH) / (objs.length - 1);
        let curY = minY;
        for (let i = 0; i < objs.length; i++) {
            objs[i].y = curY;
            curY += bounds[i].h + gap;
        }
        core.renderInteractiveLayer();
    });

    function deleteSelectedInstances() {
        if (core.selectedCropRegionIds.size > 0 && currentWorkspace === 'extract') {
            pushHistory();
            core.cropRegions = core.cropRegions.filter(r => !core.selectedCropRegionIds.has(r.id));
            core.selectedCropRegionIds.clear();
            core.renderInteractiveLayer();
            renderCropRegionList();
            updateStatusBar();
            return;
        }
        if (core.selectedInstanceIds.size === 0) return;
        const ids = Array.from(core.selectedInstanceIds);
        const deletable = ids.filter(id => {
            const inst = core.instances.find(i => i.id === id);
            return inst && !isInstanceLocked(inst);
        });
        if (deletable.length === 0) return;
        pushHistory();
        const remove = new Set(deletable);
        core.instances = core.instances.filter(i => !remove.has(i.id));
        deletable.forEach(id => core.selectedInstanceIds.delete(id));
        core.renderInteractiveLayer();
        renderGroupedAccordion();
        updateStatusBar();
    }

    function closeTopModalOrDeselect() {
        if (window.getComputedStyle(helpModal).display !== 'none') {
            helpModal.style.display = 'none';
            return;
        }
        if (window.getComputedStyle(instanceModal).display !== 'none') {
            instanceModal.style.display = 'none';
            return;
        }
        if (window.getComputedStyle(dataModal).display !== 'none') {
            dataModal.style.display = 'none';
            return;
        }
        if (core.selectedInstanceIds.size > 0) {
            core.selectedInstanceIds.clear();
            core.renderInteractiveLayer();
            renderGroupedAccordion();
            updateStatusBar();
        }
        hideInlineGroupPanel();
    }

    window.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeTopModalOrDeselect();
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelectedInstances();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            copySelectedInstances();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            pasteCopiedInstances();
            return;
        }
        if (core.selectedInstanceIds.size === 0) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const step = parseFloat(moveStepNumber.value) || 1.0;
            if (arrowNudgeHistoryReady) {
                pushHistory();
                arrowNudgeHistoryReady = false;
            }
            core.selectedInstanceIds.forEach(id => {
                const inst = core.instances.find(i => i.id === id);
                if (!inst || isInstanceLocked(inst)) return;
                if (e.key === 'ArrowUp') inst.y += step;
                if (e.key === 'ArrowDown') inst.y -= step;
                if (e.key === 'ArrowLeft') inst.x -= step;
                if (e.key === 'ArrowRight') inst.x += step;
            });
            core.renderInteractiveLayer();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            arrowNudgeHistoryReady = true;
        }
    });

    moveStepSlider.addEventListener('input', (e) => moveStepNumber.value = e.target.value);
    moveStepNumber.addEventListener('input', (e) => moveStepSlider.value = e.target.value);

    tabBtnHistory.addEventListener('click', () => {
        tabBtnHistory.classList.add('active');
        tabBtnJson.classList.remove('active');
        tabContentHistory.classList.add('active');
        tabContentJson.classList.remove('active');
        renderModalHistoryList();
    });

    tabBtnJson.addEventListener('click', () => {
        tabBtnJson.classList.add('active');
        tabBtnHistory.classList.remove('active');
        tabContentJson.classList.add('active');
        tabContentHistory.classList.remove('active');
        updateDataTextarea();
    });

    btnDataView.addEventListener('click', () => {
        tabBtnHistory.click();
        dataModal.style.display = 'flex';
    });

    closeDataModal.addEventListener('click', () => dataModal.style.display = 'none');
    btnDataModalClose.addEventListener('click', () => dataModal.style.display = 'none');

    btnHelp.addEventListener('click', () => { helpModal.style.display = 'flex'; });
    closeHelpModal.addEventListener('click', () => helpModal.style.display = 'none');
    btnHelpModalClose.addEventListener('click', () => helpModal.style.display = 'none');

    async function renderModalHistoryList() {
        modalProjectHistoryList.innerHTML = '';
        try {
            await core.db.open();
            const tx = core.db.db.transaction(["projects"], "readonly");
            const store = tx.objectStore("projects");
            
            const req = store.getAll();
            req.onsuccess = () => {
                const items = req.result || [];
                const grouped = WorkspaceData.groupProjectsByWorkName(items);

                if (grouped.length === 0) {
                    modalProjectHistoryList.innerHTML = '<div style="font-size:12px; color:#94a3b8; text-align:center; padding:20px;">保存された履歴はありません。</div>';
                    return;
                }

                grouped.forEach((bundle) => {
                    const wrap = document.createElement('div');
                    wrap.className = 'history-work-group';

                    const header = document.createElement('div');
                    header.className = 'history-work-header';
                    const title = document.createElement('span');
                    title.textContent = `${bundle.workName}（${bundle.versions.length}）`;
                    const actions = document.createElement('div');
                    actions.className = 'history-work-actions';
                    const btnDelAll = document.createElement('button');
                    btnDelAll.className = 'btn danger small';
                    btnDelAll.textContent = '作業を削除';
                    btnDelAll.addEventListener('click', async (ev) => {
                        ev.stopPropagation();
                        if (!confirm(`作業「${bundle.workName}」の履歴 ${bundle.versions.length} 件をすべて削除しますか？`)) return;
                        for (const ver of bundle.versions) {
                            await core.deleteFromDatabase(ver.id);
                        }
                        renderModalHistoryList();
                    });
                    actions.appendChild(btnDelAll);
                    header.appendChild(title);
                    header.appendChild(actions);

                    const body = document.createElement('div');
                    body.className = 'history-work-body';
                    header.addEventListener('click', (ev) => {
                        if (ev.target.closest('button')) return;
                        body.classList.toggle('collapsed');
                    });

                    bundle.versions.forEach((item) => {
                    const card = document.createElement('div');
                    card.className = 'history-item-card';

                    const info = document.createElement('div');
                    const dateStr = new Date(item.updatedAt).toLocaleString();
                    const kind = item.saveKind === 'auto' ? '<span class="history-kind-auto">自動</span>' : '';
                    info.innerHTML = `<div class="history-card-title">${dateStr}${kind}</div>
                                      <div class="history-card-meta">
                                          <span>📄 ${item.pdfName || 'PDF未登録'}</span>
                                          <span>📌 配置数: ${item.instanceCount !== undefined ? item.instanceCount : '-'}</span>
                                      </div>`;

                    const cardActions = document.createElement('div');
                    cardActions.className = 'history-card-actions';

                    const btnRestore = document.createElement('button');
                    btnRestore.className = 'btn primary small';
                    btnRestore.textContent = '復元';
                    btnRestore.addEventListener('click', async () => {
                        if (confirm(`「${bundle.workName}」（${dateStr}）を復元しますか？現在の編集状態は上書きされます。`)) {
                            await core.loadFromDatabase(item.id);
                            projectNameInput.value = item.workName || WorkspaceData.stripWorkName(item.name);
                            updatePageIndicator();
                            renderGroupCards();
                            renderGroupedAccordion();
                            renderPdfLayerList();
                            renderCropRegionList();
                            updateStatusBar();
                            dataModal.style.display = 'none';
                            alert(`「${bundle.workName}」を復元しました。`);
                        }
                    });

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn danger small';
                    btnDelete.textContent = '削除';
                    btnDelete.addEventListener('click', async () => {
                        if (confirm(`この履歴（${dateStr}）を削除しますか？`)) {
                            await core.deleteFromDatabase(item.id);
                            renderModalHistoryList();
                        }
                    });

                    cardActions.appendChild(btnRestore);
                    cardActions.appendChild(btnDelete);

                    card.appendChild(info);
                    card.appendChild(cardActions);
                    body.appendChild(card);
                    });

                    wrap.appendChild(header);
                    wrap.appendChild(body);
                    modalProjectHistoryList.appendChild(wrap);
                });
            };
        } catch (err) {
            console.error("履歴取得エラー:", err);
            modalProjectHistoryList.innerHTML = `<div style="font-size:12px; color:#ef4444; padding:10px;">履歴の読込に失敗しました: ${err.message}</div>`;
        }
    }

    function updateDataTextarea() {
        const scope = document.querySelector('input[name="data-scope"]:checked').value;
        let exportInstances = [];
        if (scope === 'page') {
            const cur = core.currentPageNum - 1;
            exportInstances = core.instances.filter(i => i.pageIndex === cur);
        } else {
            exportInstances = core.instances;
        }
        dataJsonTextarea.value = JSON.stringify({
            scope,
            groups: core.groups,
            instances: exportInstances,
            cropRegions: core.cropRegions,
            layerVisibilityByName: core.layerVisibilityByName
        }, null, 2);
    }

    document.querySelectorAll('input[name="data-scope"]').forEach(r => {
        r.addEventListener('change', updateDataTextarea);
    });

    btnDataCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(dataJsonTextarea.value);
        alert("クリップボードへコピーしました。");
    });

    btnDataExport.addEventListener('click', () => {
        const blob = new Blob([dataJsonTextarea.value], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `pdf_data_${Date.now()}.json`;
        link.click();
    });

    btnDataImport.addEventListener('click', () => {
        try {
            const data = JSON.parse(dataJsonTextarea.value);
            if (!data.instances) throw new Error("無効なJSONデータです。");
            pushHistory();

            if (data.groups && Array.isArray(data.groups)) {
                core.groups = data.groups;
            }

            const scope = data.scope || 'page';
            if (scope === 'page') {
                const cur = core.currentPageNum - 1;
                core.instances = core.instances.filter(i => i.pageIndex !== cur).concat(data.instances);
            } else {
                core.instances = data.instances;
            }
            if (Array.isArray(data.cropRegions)) core.cropRegions = data.cropRegions;
            if (data.layerVisibilityByName) core.layerVisibilityByName = data.layerVisibilityByName;

            core.renderInteractiveLayer();
            renderGroupCards();
            renderGroupedAccordion();
            renderCropRegionList();
            alert("データを反映しました。");
            dataModal.style.display = 'none';
        } catch (err) {
            alert("インポート失敗: " + err.message);
        }
    });

    btnBackupFile.addEventListener('click', async () => {
        await core.db.open();
        const tx = core.db.db.transaction(["projects", "project_blobs", "project_data"], "readonly");
        const blobStore = tx.objectStore("project_blobs");

        let pdfBase64 = "";
        if (core.basePdfBytes && core.basePdfBytes.byteLength > 0) {
            pdfBase64 = arrayBufferToBase64(core.basePdfBytes);
        } else if (core.currentProjectId) {
            const blobRec = await new Promise(res => {
                blobStore.get(core.currentProjectId).onsuccess = e => res(e.target.result);
            });
            if (blobRec && blobRec.pdfBytes) {
                pdfBase64 = arrayBufferToBase64(blobRec.pdfBytes);
            }
        }

        const fullData = {
            projectName: projectNameInput.value,
            currentPdfName: core.currentPdfName,
            pdfBase64: pdfBase64,
            groups: core.groups,
            instances: core.instances,
            cropRegions: core.cropRegions,
            layerVisibilityByName: core.layerVisibilityByName
        };

        const blob = new Blob([JSON.stringify(fullData)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${projectNameInput.value || 'backup'}_full.json`;
        link.click();
    });

    btnRestoreFileTrigger.addEventListener('click', () => restoreFileInput.click());

    restoreFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            pushHistory();

            projectNameInput.value = data.projectName || "復元作業";
            core.groups = data.groups || [];
            core.instances = data.instances || [];
            core.cropRegions = Array.isArray(data.cropRegions) ? data.cropRegions : [];
            core.layerVisibilityByName = data.layerVisibilityByName || {};

            if (data.pdfBase64) {
                const bytes = base64ToUint8Array(data.pdfBase64);
                core.basePdfBytes = new Uint8Array(bytes.slice(0));
                core.currentPdfName = data.currentPdfName || "restored.pdf";
                
                const pdfjsData = new Uint8Array(bytes.slice(0));
                const loadingTask = pdfjsLib.getDocument({ data: pdfjsData });
                core.pdfDocument = await loadingTask.promise;
                core.totalPageNum = core.pdfDocument.numPages;
                core.currentPageNum = 1;
                await core.refreshPdfLayers();
                await core.renderPage(1);
            }

            renderGroupCards();
            updatePageIndicator();
            renderGroupedAccordion();
            renderPdfLayerList();
            renderCropRegionList();
            alert("完全バックアップから復元しました。");
            dataModal.style.display = 'none';
        } catch (err) {
            alert("復元に失敗しました: " + err.message);
        }
        restoreFileInput.value = '';
    });

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    function base64ToUint8Array(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes;
    }

    function persistAppSettings() {
        if (!autosaveEnabledInput || !autosaveMinutesInput || typeof WorkspaceData === 'undefined') return;
        appSettings.autoSaveEnabled = autosaveEnabledInput.checked;
        appSettings.autoSaveMinutes = Math.max(1, parseInt(autosaveMinutesInput.value, 10) || WorkspaceData.DEFAULT_AUTO_SAVE_MINUTES);
        WorkspaceData.saveSettings(appSettings);
        restartAutoSave();
    }

    function restartAutoSave() {
        if (autoSaveTimer) {
            clearInterval(autoSaveTimer);
            autoSaveTimer = null;
        }
        if (!appSettings.autoSaveEnabled) return;
        const ms = Math.max(1, Number(appSettings.autoSaveMinutes) || 5) * 60 * 1000;
        autoSaveTimer = setInterval(() => {
            if (!workspaceDirty) return;
            executeSaveVersion({ silent: true, saveKind: 'auto' });
        }, ms);
    }

    if (autosaveEnabledInput && autosaveMinutesInput) {
        autosaveEnabledInput.checked = appSettings.autoSaveEnabled !== false;
        autosaveMinutesInput.value = String(appSettings.autoSaveMinutes || 5);
        autosaveEnabledInput.addEventListener('change', persistAppSettings);
        autosaveMinutesInput.addEventListener('change', persistAppSettings);
    }
    restartAutoSave();

    renderGroupCards();
    renderGroupedAccordion();
    updateStatusBar();
});
