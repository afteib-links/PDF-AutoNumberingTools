/**
 * AppCore.js
 * コアエンジン（描画最適化・個別オーバーライド完全判定・画像／オブジェクトPDF出力・安全保存対応版）
 */
class PdfEditorCore {
    constructor() {
        this.db = new DBManager();
        this.coordConverter = new CoordinateConverter();
        this.currentProjectId = null; 
        this.currentPdfName = "";     
        this.currentPdfPath = "";     
        this.groups = [];
        this.instances = [];
        this.pdfDocument = null;
        this.basePdfBytes = null; 
        this.currentPageNum = 1;
        this.totalPageNum = 1;
        
        this.selectedInstanceIds = new Set();
        this.selectedCropRegionIds = new Set();
        this.cropRegions = [];
        this.pdfLayers = [];
        this.optionalContentConfig = null;
        this.layerVisibilityByName = {};
        this.respectLayerVisibility = true;
        this.exportScope = 'all';
        this.workspace = 'place';

        this.pdfCanvas = document.getElementById('pdf-render-canvas');
        this.pdfCtx = this.pdfCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
        this.layerCanvas = document.getElementById('interactive-layer-canvas');
        this.layerCtx = this.layerCanvas.getContext('2d', { alpha: false });
        this.canvasWrapper = document.getElementById('canvas-wrapper');

        this.currentRenderTask = null;    
        this.animFrameId = null;          
        this.groupInstanceIndexMap = new Map(); 

        this.selectionBox = null; 
    }

    async init() { 
        try { 
            await this.db.open(); 
        } catch (error) { 
            console.error("DB初期化失敗:", error); 
        } 
    }

    pdfJsDocumentOptions(data) {
        const opts = {
            data: data,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
            isOffscreenCanvasSupported: false,
            useSystemFonts: true
        };
        if (typeof location !== 'undefined' && location.protocol === 'file:') {
            opts.disableRange = true;
            opts.disableStream = true;
            opts.disableAutoFetch = true;
        }
        return opts;
    }

    async loadPdfFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.basePdfBytes = new Uint8Array(arrayBuffer.slice(0)); 
            this.currentPdfName = file.name;
            this.currentPdfPath = file.webkitRelativePath || file.name;

            const pdfjsData = new Uint8Array(arrayBuffer.slice(0));
            const loadingTask = pdfjsLib.getDocument(this.pdfJsDocumentOptions(pdfjsData));
            
            this.pdfDocument = await loadingTask.promise;
            this.totalPageNum = this.pdfDocument.numPages;
            this.currentPageNum = 1;
            await this.refreshPdfLayers();
            await this.renderPage(this.currentPageNum);
            return true;
        } catch (error) { 
            alert("PDF読込失敗: " + error.message); 
            return false;
        }
    }

    async changePage(pageNum) {
        if (pageNum < 1 || pageNum > this.totalPageNum) return;
        this.currentPageNum = pageNum;
        await this.renderPage(this.currentPageNum);
    }

    async replacePdfFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.basePdfBytes = new Uint8Array(arrayBuffer.slice(0)); 
            this.currentPdfName = file.name;
            this.currentPdfPath = file.webkitRelativePath || file.name;

            const pdfjsData = new Uint8Array(arrayBuffer.slice(0));
            const loadingTask = pdfjsLib.getDocument(this.pdfJsDocumentOptions(pdfjsData));
            this.pdfDocument = await loadingTask.promise;
            this.totalPageNum = this.pdfDocument.numPages;
            if (this.currentPageNum > this.totalPageNum) this.currentPageNum = 1;
            await this.refreshPdfLayers();
            await this.renderPage(this.currentPageNum);
            return true;
        } catch (error) { 
            alert("PDF差し替えに失敗しました: " + error.message); 
            return false;
        }
    }

    async saveToDatabase(baseProjectName) {
        await this.db.open();

        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        
        const rawName = (baseProjectName || "作業").replace(/_\d{8}_\d{6}$/, '').trim() || "作業";
        const versionedName = `${rawName}_${timestamp}`;

        const cleanGroups = JSON.parse(JSON.stringify(this.groups || []));
        const cleanInstances = JSON.parse(JSON.stringify(this.instances || []));

        let pdfBytesToSave = null;
        if (this.basePdfBytes && this.basePdfBytes.byteLength > 0) {
            try {
                pdfBytesToSave = new Uint8Array(this.basePdfBytes.slice(0));
            } catch (e) {
                console.warn("PDFデータバッファの複製に失敗:", e);
                pdfBytesToSave = null;
            }
        }

        const executeTransaction = () => {
            return new Promise((resolve, reject) => {
                let tx = null;
                try {
                    tx = this.db.db.transaction(["projects", "project_blobs", "project_data"], "readwrite");
                } catch (txErr) {
                    reject(txErr);
                    return;
                }

                let newProjectId = null;

                tx.onerror = () => {
                    console.error("保存トランザクションエラー:", tx.error);
                    reject(tx.error || new Error("保存トランザクション中にエラーが発生しました"));
                };

                tx.onabort = () => {
                    console.error("保存トランザクション中断:", tx.error);
                    reject(tx.error || new Error("保存処理が中断されました"));
                };

                tx.oncomplete = () => {
                    if (newProjectId !== null) {
                        this.currentProjectId = newProjectId;
                        resolve({ id: newProjectId, name: versionedName });
                    } else {
                        reject(new Error("プロジェクトIDの発行に失敗しました"));
                    }
                };

                const projectStore = tx.objectStore("projects");
                const blobStore = tx.objectStore("project_blobs");
                const dataStore = tx.objectStore("project_data");

                const projectRecord = {
                    name: versionedName,
                    pdfName: this.currentPdfName || "",
                    pdfPath: this.currentPdfPath || "",
                    updatedAt: Date.now(),
                    currentPageNum: this.currentPageNum || 1,
                    zoomLevel: this.coordConverter ? this.coordConverter.zoomLevel : 1.0,
                    instanceCount: cleanInstances.length
                };

                const reqAdd = projectStore.add(projectRecord);
                reqAdd.onsuccess = (e) => {
                    newProjectId = e.target.result;

                    if (pdfBytesToSave) {
                        blobStore.put({ projectId: newProjectId, pdfBytes: pdfBytesToSave });
                    }

                    dataStore.put({
                        projectId: newProjectId,
                        groups: cleanGroups,
                        instances: cleanInstances,
                        cropRegions: JSON.parse(JSON.stringify(this.cropRegions || [])),
                        layerVisibilityByName: Object.assign({}, this.layerVisibilityByName || {}),
                        exportScope: this.exportScope || 'all'
                    });
                };

                reqAdd.onerror = (e) => {
                    console.error("プロジェクトレコード登録エラー:", reqAdd.error);
                };
            });
        };

        try {
            return await executeTransaction();
        } catch (firstErr) {
            console.warn("初回保存失敗。DB修復を試みます...", firstErr);
            await this.db.recreateDatabase();
            return await executeTransaction();
        }
    }

    async loadFromDatabase(projectId) {
        await this.db.open();
        return new Promise((resolve, reject) => {
            let tx = null;
            try {
                tx = this.db.db.transaction(["projects", "project_blobs", "project_data"], "readonly");
            } catch (err) {
                reject(err);
                return;
            }

            const projectStore = tx.objectStore("projects");
            const blobStore = tx.objectStore("project_blobs");
            const dataStore = tx.objectStore("project_data");

            let projectRecord = null;
            let blobRecord = null;
            let dataRecord = null;

            projectStore.get(projectId).onsuccess = e => { projectRecord = e.target.result; };
            blobStore.get(projectId).onsuccess = e => { blobRecord = e.target.result; };
            dataStore.get(projectId).onsuccess = e => { dataRecord = e.target.result; };

            tx.onerror = () => reject(tx.error);
            tx.oncomplete = async () => {
                if (!projectRecord) { reject(new Error("指定の履歴が見つかりません。")); return; }
                this.currentProjectId = projectId;
                this.currentPdfName = projectRecord.pdfName || "";
                this.currentPdfPath = projectRecord.pdfPath || "";
                this.groups = dataRecord && dataRecord.groups ? dataRecord.groups : [];
                this.instances = dataRecord && dataRecord.instances ? dataRecord.instances : [];
                this.cropRegions = dataRecord && Array.isArray(dataRecord.cropRegions) ? dataRecord.cropRegions : [];
                this.layerVisibilityByName = dataRecord && dataRecord.layerVisibilityByName ? dataRecord.layerVisibilityByName : {};
                this.exportScope = dataRecord && dataRecord.exportScope ? dataRecord.exportScope : 'all';
                this.currentPageNum = projectRecord.currentPageNum || 1;
                this.coordConverter.zoomLevel = projectRecord.zoomLevel || 1.0;
                this.selectedInstanceIds.clear();
                this.selectedCropRegionIds.clear();

                if (blobRecord && blobRecord.pdfBytes) {
                    const rawBytes = blobRecord.pdfBytes instanceof Uint8Array 
                        ? blobRecord.pdfBytes 
                        : new Uint8Array(blobRecord.pdfBytes);
                    this.basePdfBytes = new Uint8Array(rawBytes.slice(0));
                    const pdfjsData = new Uint8Array(this.basePdfBytes.slice(0));
                    const loadingTask = pdfjsLib.getDocument(this.pdfJsDocumentOptions(pdfjsData));
                    this.pdfDocument = await loadingTask.promise;
                    this.totalPageNum = this.pdfDocument.numPages;
                    await this.refreshPdfLayers();
                    await this.renderPage(this.currentPageNum);
                } else {
                    this.basePdfBytes = null;
                    this.pdfDocument = null;
                    this.totalPageNum = 1;
                    this.currentPageNum = 1;
                    
                    this.coordConverter.setPageContext(595, 842, this.canvasWrapper);
                    const viewportW = 595 * this.coordConverter.zoomLevel;
                    const viewportH = 842 * this.coordConverter.zoomLevel;
                    this.pdfCanvas.width = viewportW;
                    this.pdfCanvas.height = viewportH;
                    this.pdfCanvas.style.width = `${viewportW}px`;
                    this.pdfCanvas.style.height = `${viewportH}px`;
                    this.pdfCtx.fillStyle = "#ffffff";
                    this.pdfCtx.fillRect(0, 0, viewportW, viewportH);
                    this.layerCanvas.width = viewportW;
                    this.layerCanvas.height = viewportH;
                    this.layerCanvas.style.width = `${viewportW}px`;
                    this.layerCanvas.style.height = `${viewportH}px`;
                    this.canvasWrapper.style.width = `${viewportW}px`;
                    this.canvasWrapper.style.height = `${viewportH}px`;
                    this.renderInteractiveLayer();
                }
                resolve(projectRecord);
            };
        });
    }

    async deleteFromDatabase(projectId) {
        await this.db.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.db.transaction(["projects", "project_blobs", "project_data"], "readwrite");
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => resolve();

            tx.objectStore("projects").delete(projectId);
            tx.objectStore("project_blobs").delete(projectId);
            tx.objectStore("project_data").delete(projectId);
        });
    }

    async renderPage(pageNum) {
        if (!this.pdfDocument) return;

        if (this.currentRenderTask) {
            try {
                this.currentRenderTask.cancel();
                await this.currentRenderTask.promise.catch(() => {});
            } catch (err) {}
            this.currentRenderTask = null;
        }

        try {
            const page = await this.pdfDocument.getPage(pageNum);
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            this.coordConverter.setPageContext(unscaledViewport.width, unscaledViewport.height, this.canvasWrapper);
            const viewport = page.getViewport({ scale: this.coordConverter.zoomLevel });
            const px = PdfLayoutTools.floorCanvasSize(viewport.width, viewport.height);
            this.pdfCanvas.width = px.width;
            this.pdfCanvas.height = px.height;
            this.pdfCanvas.style.width = `${viewport.width}px`;
            this.pdfCanvas.style.height = `${viewport.height}px`;
            this.layerCanvas.width = px.width;
            this.layerCanvas.height = px.height;
            this.layerCanvas.style.width = `${viewport.width}px`;
            this.layerCanvas.style.height = `${viewport.height}px`;
            this.canvasWrapper.style.width = `${viewport.width}px`;
            this.canvasWrapper.style.height = `${viewport.height}px`;

            this.pdfCtx.setTransform(1, 0, 0, 1, 0, 0);
            this.pdfCtx.fillStyle = '#ffffff';
            this.pdfCtx.fillRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);

            const renderContext = {
                canvasContext: this.pdfCtx,
                viewport: viewport
            };
            const transform = PdfLayoutTools.canvasTransformForViewport(viewport, px.width, px.height);
            if (transform) renderContext.transform = transform;
            if (this.respectLayerVisibility && this.optionalContentConfig) {
                renderContext.optionalContentConfig = this.optionalContentConfig;
            }
            this.currentRenderTask = page.render(renderContext);
            await this.currentRenderTask.promise;
            this.currentRenderTask = null;

            this.renderInteractiveLayer();
        } catch (error) {
            if (error && error.name === 'RenderingCancelledException') {
                return;
            }
            console.error("PDFレンダリングエラー:", error);
            alert("PDFは開けましたが画面に描けませんでした: " + (error && error.message ? error.message : error));
        }
    }

    async setZoom(newZoomLevel) {
        const clampedZoom = Math.max(0.5, Math.min(newZoomLevel, 8.0));
        this.coordConverter.setZoom(clampedZoom);
        if (this.pdfDocument) {
            await this.renderPage(this.currentPageNum);
        } else {
            const viewportW = 595 * this.coordConverter.zoomLevel;
            const viewportH = 842 * this.coordConverter.zoomLevel;
            this.pdfCanvas.width = viewportW;
            this.pdfCanvas.height = viewportH;
            this.pdfCanvas.style.width = `${viewportW}px`;
            this.pdfCanvas.style.height = `${viewportH}px`;
            this.pdfCtx.fillStyle = "#ffffff";
            this.pdfCtx.fillRect(0, 0, viewportW, viewportH);
            this.layerCanvas.width = viewportW;
            this.layerCanvas.height = viewportH;
            this.layerCanvas.style.width = `${viewportW}px`;
            this.layerCanvas.style.height = `${viewportH}px`;
            this.canvasWrapper.style.width = `${viewportW}px`;
            this.canvasWrapper.style.height = `${viewportH}px`;
            this.renderInteractiveLayer();
        }
    }

    requestLayerRender() {
        if (this.animFrameId) return;
        this.animFrameId = requestAnimationFrame(() => {
            this.renderInteractiveLayer();
            this.animFrameId = null;
        });
    }

    buildAutoTextIndexMap() {
        this.groupInstanceIndexMap.clear();
        const grouped = new Map();
        for (let i = 0; i < this.instances.length; i++) {
            const inst = this.instances[i];
            let list = grouped.get(inst.groupId);
            if (!list) {
                list = [];
                grouped.set(inst.groupId, list);
            }
            list.push(inst);
        }

        grouped.forEach((list) => {
            list.sort((a, b) => a.order - b.order);
            for (let idx = 0; idx < list.length; idx++) {
                this.groupInstanceIndexMap.set(list[idx].id, idx);
            }
        });
    }

    async refreshPdfLayers() {
        this.pdfLayers = [];
        this.optionalContentConfig = null;
        if (!this.pdfDocument || typeof this.pdfDocument.getOptionalContentConfig !== 'function') {
            return;
        }
        try {
            this.optionalContentConfig = await this.pdfDocument.getOptionalContentConfig();
        } catch (e) {
            this.optionalContentConfig = null;
            return;
        }
        if (typeof PdfLayoutTools === 'undefined') return;
        this.pdfLayers = PdfLayoutTools.listOptionalContentLayers(this.optionalContentConfig);
        for (let i = 0; i < this.pdfLayers.length; i++) {
            const layer = this.pdfLayers[i];
            if (Object.prototype.hasOwnProperty.call(this.layerVisibilityByName, layer.name)) {
                const vis = !!this.layerVisibilityByName[layer.name];
                if (this.optionalContentConfig && typeof this.optionalContentConfig.setVisibility === 'function') {
                    try {
                        this.optionalContentConfig.setVisibility(layer.id, vis);
                    } catch (e) { /* 一部の PDF では id 形式が異なる */ }
                }
                layer.visible = vis;
            } else {
                this.layerVisibilityByName[layer.name] = layer.visible;
            }
        }
    }

    async setPdfLayerVisible(layerId, visible) {
        const layer = this.pdfLayers.find(l => l.id === layerId);
        if (!layer) return;
        layer.visible = !!visible;
        this.layerVisibilityByName[layer.name] = layer.visible;
        if (this.optionalContentConfig && typeof this.optionalContentConfig.setVisibility === 'function') {
            try {
                this.optionalContentConfig.setVisibility(layerId, layer.visible);
            } catch (e) {
                console.warn('レイヤー可視切替に失敗:', e);
            }
        }
        await this.renderPage(this.currentPageNum);
    }

    async setAllPdfLayersVisible(visible) {
        for (let i = 0; i < this.pdfLayers.length; i++) {
            const layer = this.pdfLayers[i];
            layer.visible = !!visible;
            this.layerVisibilityByName[layer.name] = layer.visible;
            if (this.optionalContentConfig && typeof this.optionalContentConfig.setVisibility === 'function') {
                try {
                    this.optionalContentConfig.setVisibility(layer.id, layer.visible);
                } catch (e) { /* skip */ }
            }
        }
        await this.renderPage(this.currentPageNum);
    }

    nextCropRegionId() {
        if (!this.cropRegions.length) return 1;
        return Math.max.apply(null, this.cropRegions.map(r => r.id)) + 1;
    }

    addCropRegion(paperKey, landscape) {
        const tools = PdfLayoutTools;
        const pageW = this.coordConverter.pageWidthPoints || 595.28;
        const pageH = this.coordConverter.pageHeightPoints || 841.89;
        const region = tools.createCenteredRegion(
            this.nextCropRegionId(),
            this.currentPageNum - 1,
            paperKey || 'A4',
            !!landscape,
            pageW,
            pageH,
            0.72
        );
        this.cropRegions.push(region);
        this.selectedCropRegionIds.clear();
        this.selectedCropRegionIds.add(region.id);
        this.requestLayerRender();
        return region;
    }

    getPageSizeForIndex(pageIndex) {
        return {
            width: this.coordConverter.pageWidthPoints || 595.28,
            height: this.coordConverter.pageHeightPoints || 841.89,
            pageIndex: pageIndex
        };
    }

    applyPaperToSelectedCropRegions(paperKey, landscape) {
        const pageW = this.coordConverter.pageWidthPoints || 595.28;
        const pageH = this.coordConverter.pageHeightPoints || 841.89;
        const cur = this.currentPageNum - 1;
        this.cropRegions = this.cropRegions.map(r => {
            if (!this.selectedCropRegionIds.has(r.id)) return r;
            if (r.pageIndex !== cur) {
                return Object.assign({}, r, { paperKey: paperKey, landscape: !!landscape });
            }
            return PdfLayoutTools.applyPaperToRegion(r, paperKey, landscape, pageW, pageH);
        });
        this.requestLayerRender();
    }

    renderInteractiveLayer() {
        const w = this.layerCanvas.width;
        const h = this.layerCanvas.height;
        this.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.layerCtx.globalCompositeOperation = 'copy';
        // 下絵キャンバスは非表示バッファ。表示面へ不透明コピーしてからオブジェクトを描く
        if (this.pdfCanvas && this.pdfCanvas.width > 0 && this.pdfCanvas.height > 0) {
            try {
                this.layerCtx.drawImage(this.pdfCanvas, 0, 0, w, h);
            } catch (e) {
                this.layerCtx.fillStyle = '#ffffff';
                this.layerCtx.fillRect(0, 0, w, h);
            }
        } else {
            this.layerCtx.fillStyle = '#ffffff';
            this.layerCtx.fillRect(0, 0, w, h);
        }
        this.layerCtx.globalCompositeOperation = 'source-over';

        this.buildAutoTextIndexMap();

        const curPage = this.currentPageNum - 1;
        const pageInstances = [];
        for (let i = 0; i < this.instances.length; i++) {
            if (this.instances[i].pageIndex === curPage) {
                pageInstances.push(this.instances[i]);
            }
        }

        pageInstances.sort((a, b) => {
            const groupA = this.groups.find(g => g.id === a.groupId);
            const groupB = this.groups.find(g => g.id === b.groupId);
            const zA = a.isZIndexLocked && a.overrideZIndex !== null ? a.overrideZIndex : (groupA ? groupA.zIndex || 0 : 0);
            const zB = b.isZIndexLocked && b.overrideZIndex !== null ? b.overrideZIndex : (groupB ? groupB.zIndex || 0 : 0);
            if (zA !== zB) return zA - zB;
            return a.order - b.order;
        });

        for (let i = 0; i < pageInstances.length; i++) {
            const instance = pageInstances[i];
            const group = this.groups.find(g => g.id === instance.groupId);
            if (!group || group.isHidden || instance.isHidden) continue;
            this.drawInstance(instance, group, this.layerCtx, this.coordConverter, false);
        }

        this.drawCropRegions();
        this.drawSelectionBox();
    }

    drawCropRegions() {
        if (this.workspace !== 'extract') return;
        const ctx = this.layerCtx;
        const curPage = this.currentPageNum - 1;
        const regions = this.cropRegions.filter(r => r.pageIndex === curPage);
        if (!regions.length) return;
        const zoom = this.coordConverter.zoomLevel || 1;

        for (let i = 0; i < this.cropRegions.length; i++) {
            const region = this.cropRegions[i];
            if (region.pageIndex !== curPage) continue;
            const screen = this.coordConverter.pdfPointsToScreenPixels(region.x, region.y, region.width, region.height, false);
            const selected = this.selectedCropRegionIds.has(region.id);
            const paper = PdfLayoutTools.getPaperSize(region.paperKey, region.landscape);
            const orderLabel = String(i + 1);

            ctx.save();
            ctx.strokeStyle = selected ? '#dc2626' : '#2563eb';
            ctx.lineWidth = selected ? 2.5 : 1.5;
            ctx.setLineDash([8 * zoom, 4 * zoom]);
            ctx.strokeRect(screen.x, screen.y, screen.width, screen.height);
            ctx.setLineDash([]);

            ctx.fillStyle = selected ? 'rgba(220, 38, 38, 0.08)' : 'rgba(37, 99, 235, 0.06)';
            ctx.fillRect(screen.x, screen.y, screen.width, screen.height);

            const tag = `${orderLabel} ${paper.label}${region.landscape ? ' 横' : ' 縦'}`;
            ctx.font = `${11 * Math.max(1, zoom)}px sans-serif`;
            ctx.textBaseline = 'top';
            const tw = ctx.measureText(tag).width + 10;
            const th = 16 * Math.max(1, zoom);
            ctx.fillStyle = selected ? '#dc2626' : '#2563eb';
            ctx.fillRect(screen.x, screen.y - th, tw, th);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tag, screen.x + 5, screen.y - th + 2);

            if (selected) {
                const hs = 7;
                const handles = [
                    [screen.x, screen.y],
                    [screen.x + screen.width / 2, screen.y],
                    [screen.x + screen.width, screen.y],
                    [screen.x + screen.width, screen.y + screen.height / 2],
                    [screen.x + screen.width, screen.y + screen.height],
                    [screen.x + screen.width / 2, screen.y + screen.height],
                    [screen.x, screen.y + screen.height],
                    [screen.x, screen.y + screen.height / 2]
                ];
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 1.5;
                handles.forEach(([hx, hy]) => {
                    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
                    ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
                });
            }
            ctx.restore();
        }
    }


    drawSelectionBox() {
        if (!this.selectionBox) return;
        const ctx = this.layerCtx;
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        const { x, y, width, height } = this.selectionBox;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }

    getInstanceStyle(instance, group) {
        const shape = instance.overrideShape || group.shape;
        const isAuto = instance.isSizeAutoLocked && instance.overrideSizeAuto !== null
            ? instance.overrideSizeAuto
            : (group.isSizeAuto || false);
        const hasBorder = instance.isHasBorderLocked && instance.overrideHasBorder !== null
            ? instance.overrideHasBorder
            : (group.hasBorder !== undefined ? group.hasBorder : true);
        const bWidth = instance.isBorderWidthLocked && instance.overrideBorderWidth !== null
            ? instance.overrideBorderWidth
            : (group.borderWidth !== undefined ? group.borderWidth : 1.5);
        const bColor = instance.isBorderColorLocked && instance.overrideBorderColor
            ? instance.overrideBorderColor
            : (group.borderColor || '#000000');
        const tColor = instance.isTextColorLocked && instance.overrideTextColor
            ? instance.overrideTextColor
            : (group.textColor || '#000000');
        const bgColor = instance.isBgColorLocked && instance.overrideBgColor
            ? instance.overrideBgColor
            : (group.bgColor || '#ffffff');
        const bgOpacity = instance.isBgColorLocked && instance.overrideBgOpacity !== null
            ? instance.overrideBgOpacity
            : (group.bgOpacity !== undefined ? group.bgOpacity : 0);
        const startCap = instance.isCapsLocked && instance.overrideStartCap
            ? instance.overrideStartCap
            : (group.startCap || 'none');
        const endCap = instance.isCapsLocked && instance.overrideEndCap
            ? instance.overrideEndCap
            : (group.endCap || 'none');
        const capSize = instance.isCapSizeLocked && instance.overrideCapSize !== null
            ? instance.overrideCapSize
            : (group.capSize !== undefined ? group.capSize : 6);
        const fontSize = instance.isFontSizeLocked && instance.overrideFontSize
            ? instance.overrideFontSize
            : group.fontSize;
        const rawText = instance.isTextLocked && instance.overrideText !== null
            ? instance.overrideText
            : group.defaultText;
        const width = instance.isSizeLocked && instance.overrideWidth !== null
            ? instance.overrideWidth
            : group.width;
        const height = instance.isSizeLocked && instance.overrideHeight !== null
            ? instance.overrideHeight
            : group.height;
        return {
            shape, isAuto, hasBorder, bWidth, bColor, tColor,
            bgColor, bgOpacity, startCap, endCap, capSize, fontSize, rawText, width, height
        };
    }

    drawInstance(instance, group, ctx, converter, isExport = false) {
        const style = this.getInstanceStyle(instance, group);
        const shape = style.shape;
        const isAuto = style.isAuto;
        const hasBorder = style.hasBorder;
        const bWidth = style.bWidth;
        const bColor = style.bColor;
        const tColor = style.tColor;
        const bgColor = style.bgColor;
        const bgOpacity = style.bgOpacity;
        const startCap = style.startCap;
        const endCap = style.endCap;
        const capSize = style.capSize;
        const fontSize = style.fontSize;
        const displayText = this.resolveAutoText(style.rawText, instance, group);
        const lines = displayText.split('\n');
        
        const renderFontSize = fontSize * converter.zoomLevel;
        ctx.font = `${renderFontSize}px "${group.font || '游ゴシック'}", "Noto Sans JP", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif`;
        
        let maxTextWidth = 0;
        for (let i = 0; i < lines.length; i++) {
            const w = ctx.measureText(lines[i]).width;
            if (w > maxTextWidth) maxTextWidth = w;
        }
        const lineHeight = renderFontSize * 1.25;
        const totalTextHeight = lines.length * lineHeight;

        const ptWidth = style.width;
        const ptHeight = style.height;
        const screenRect = converter.pdfPointsToScreenPixels(instance.x, instance.y, ptWidth, ptHeight, shape === 'line');

        let textScaleX = 1.0; 
        if (shape !== 'line') {
            if (isAuto) {
                const padding = 10 * converter.zoomLevel;
                screenRect.width = maxTextWidth + (padding * 2);
                screenRect.height = totalTextHeight + (padding * 2);
            } else {
                if (maxTextWidth > screenRect.width && maxTextWidth > 0) {
                    textScaleX = (screenRect.width - (10 * converter.zoomLevel)) / maxTextWidth;
                }
            }
        }

        const isSelected = !isExport && this.selectedInstanceIds.has(instance.id);

        ctx.lineWidth = bWidth * converter.zoomLevel;
        ctx.setLineDash([]);
        ctx.strokeStyle = bColor;

        if (shape === 'line') {
            const startX = screenRect.x;
            const startY = screenRect.y;
            const endX = screenRect.x + screenRect.width;
            const endY = screenRect.y + screenRect.height;
            const angle = Math.atan2(endY - startY, endX - startX);

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            if (startCap !== 'none') {
                ctx.fillStyle = bColor;
                this.drawCanvasCap(ctx, startX, startY, angle + Math.PI, startCap, capSize, converter.zoomLevel);
            }
            if (endCap !== 'none') {
                ctx.fillStyle = bColor;
                this.drawCanvasCap(ctx, endX, endY, angle, endCap, capSize, converter.zoomLevel);
            }

            if (displayText.trim() !== "") {
                ctx.fillStyle = tColor;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                let textY = (startY + screenRect.height / 2) - (totalTextHeight / 2) + (lineHeight / 2);
                for (let i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], startX + screenRect.width / 2, textY);
                    textY += lineHeight;
                }
            }

            if (isSelected) {
                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 2]);
                const pad = 6 * converter.zoomLevel;
                ctx.strokeRect(
                    Math.min(startX, endX) - pad,
                    Math.min(startY, endY) - pad,
                    Math.abs(endX - startX) + pad * 2,
                    Math.abs(endY - startY) + pad * 2
                );

                ctx.setLineDash([]);
                ctx.fillStyle = '#2563eb';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                const r = 5 * converter.zoomLevel;
                ctx.beginPath(); ctx.arc(startX, startY, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.arc(endX, endY, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
        } else {
            ctx.beginPath();
            switch (shape) {
                case 'rectangle': 
                    ctx.rect(screenRect.x, screenRect.y, screenRect.width, screenRect.height); 
                    break;
                case 'circle': 
                    ctx.ellipse(screenRect.x + screenRect.width / 2, screenRect.y + screenRect.height / 2, Math.abs(screenRect.width) / 2, Math.abs(screenRect.height) / 2, 0, 0, 2 * Math.PI); 
                    break;
                case 'triangle': 
                    ctx.moveTo(screenRect.x + screenRect.width / 2, screenRect.y);
                    ctx.lineTo(screenRect.x + screenRect.width, screenRect.y + screenRect.height);
                    ctx.lineTo(screenRect.x, screenRect.y + screenRect.height);
                    ctx.closePath(); 
                    break;
                case 'star': 
                    this.buildStarPath(ctx, screenRect.x, screenRect.y, screenRect.width, screenRect.height); 
                    break;
            }

            if (bgOpacity > 0) {
                ctx.save();
                ctx.fillStyle = bgColor;
                ctx.globalAlpha = bgOpacity;
                ctx.fill();
                ctx.restore();
            }

            if (hasBorder) ctx.stroke();

            if (displayText.trim() !== "") {
                ctx.fillStyle = tColor;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                const textCenterX = screenRect.x + screenRect.width / 2;
                let startY = (screenRect.y + screenRect.height / 2) - (totalTextHeight / 2) + (lineHeight / 2);
                for (let i = 0; i < lines.length; i++) {
                    ctx.save();
                    ctx.translate(textCenterX, startY);
                    ctx.scale(textScaleX, 1.0);
                    ctx.fillText(lines[i], 0, 0);
                    ctx.restore();
                    startY += lineHeight;
                }
            }

            if (isSelected) {
                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.strokeRect(screenRect.x - 2, screenRect.y - 2, screenRect.width + 4, screenRect.height + 4);

                if (this.selectedInstanceIds.size === 1) {
                    ctx.setLineDash([]);
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#2563eb';
                    ctx.lineWidth = 1.5;
                    const hs = 7;
                    const hhs = hs / 2;
                    const rx = screenRect.x, ry = screenRect.y, rw = screenRect.width, rh = screenRect.height;
                    const handles = [
                        [rx, ry], [rx + rw / 2, ry], [rx + rw, ry],
                        [rx + rw, ry + rh / 2], [rx + rw, ry + rh],
                        [rx + rw / 2, ry + rh], [rx, ry + rh], [rx, ry + rh / 2]
                    ];
                    handles.forEach(([hx, hy]) => {
                        ctx.fillRect(hx - hhs, hy - hhs, hs, hs);
                        ctx.strokeRect(hx - hhs, hy - hhs, hs, hs);
                    });
                }
                ctx.restore();
            }
        }
    }

    drawCanvasCap(ctx, x, y, angle, type, baseSize, zoomLevel = 1.0) {
        const size = baseSize * zoomLevel;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        if (type === 'arrow') {
            ctx.moveTo(0, 0);
            ctx.lineTo(-size * 2, size);
            ctx.lineTo(-size * 2, -size);
            ctx.closePath();
            ctx.fill();
        } else if (type === 'circle') {
            ctx.arc(0, 0, size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    resolveAutoText(rawText, currentInstance, group) {
        if (!rawText.includes('{auto')) return rawText;

        let idx = this.groupInstanceIndexMap.get(currentInstance.id);
        if (idx === undefined) idx = 0;

        return rawText.replace(/\{auto(?::(.*?))?\}/g, (match, format) => {
            if (!format) return String((group.startNumber || 1) + idx);
            const rangeMatch = format.match(/^([a-zA-Z])(\d+)-([a-zA-Z])(\d+)$/);
            if (rangeMatch) {
                const startChar = rangeMatch[1];
                const startNumStr = rangeMatch[2];
                const startNum = parseInt(startNumStr, 10);
                const rangeSize = parseInt(rangeMatch[4], 10) - startNum + 1;
                const charOffset = Math.floor(idx / rangeSize);
                const numOffset = idx % rangeSize;
                const currentChar = String.fromCharCode(startChar.charCodeAt(0) + charOffset);
                const currentNum = startNum + numOffset;
                return currentChar + String(currentNum).padStart(startNumStr.replace(/[^0-9]/g, '').length, '0');
            }
            const alphaMatch = format.match(/^([a-zA-Z])-([a-zA-Z])$/);
            if (alphaMatch) {
                return String.fromCharCode(alphaMatch[1].charCodeAt(0) + (idx % 26));
            }
            if (/^\d+$/.test(format)) {
                return String(parseInt(format, 10) + idx).padStart(format.length, '0');
            }
            return match; 
        });
    }

    buildStarPath(ctx, x, y, width, height) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const outerRadius = Math.min(width, height) / 2;
        const innerRadius = outerRadius / 2;
        const spikes = 5;
        const step = Math.PI / spikes;
        let rot = Math.PI / 2 * 3;
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius); rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius); rot += step;
        }
        ctx.closePath();
    }

    getSortedVisiblePageInstances(pageIdx) {
        const pageInstances = this.instances.filter(inst => inst.pageIndex === pageIdx && !inst.isHidden);
        pageInstances.sort((a, b) => {
            const groupA = this.groups.find(g => g.id === a.groupId);
            const groupB = this.groups.find(g => g.id === b.groupId);
            const zA = a.isZIndexLocked && a.overrideZIndex !== null ? a.overrideZIndex : (groupA ? groupA.zIndex || 0 : 0);
            const zB = b.isZIndexLocked && b.overrideZIndex !== null ? b.overrideZIndex : (groupB ? groupB.zIndex || 0 : 0);
            if (zA !== zB) return zA - zB;
            return a.order - b.order;
        });
        return pageInstances;
    }

    pageHasDrawableText(pageIdx) {
        const pageInstances = this.getSortedVisiblePageInstances(pageIdx);
        for (let i = 0; i < pageInstances.length; i++) {
            const instance = pageInstances[i];
            const group = this.groups.find(g => g.id === instance.groupId);
            if (!group || group.isHidden) continue;
            const style = this.getInstanceStyle(instance, group);
            const displayText = this.resolveAutoText(style.rawText, instance, group);
            if (String(displayText || '').trim() !== '') return true;
        }
        return false;
    }

    async overlayVectorObjects(pdfDoc, totalPages) {
        if (typeof PdfNativeExport === 'undefined') {
            throw new Error('PDFネイティブ出力モジュールが読み込まれていません。');
        }
        let embeddedFont = null;
        let needFont = false;
        for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
            if (this.pageHasDrawableText(pageIdx)) {
                needFont = true;
                break;
            }
        }
        if (needFont) {
            embeddedFont = await PdfNativeExport.embedNotoSansJpFont(pdfDoc);
        }

        for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
            const pageInstances = this.getSortedVisiblePageInstances(pageIdx);
            if (pageInstances.length === 0) continue;

            const page = pdfDoc.getPage(pageIdx);
            for (const instance of pageInstances) {
                const group = this.groups.find(g => g.id === instance.groupId);
                if (!group || group.isHidden) continue;
                const style = this.getInstanceStyle(instance, group);
                const displayText = this.resolveAutoText(style.rawText, instance, group);
                if (String(displayText || '').trim() !== '' && !embeddedFont) continue;
                PdfNativeExport.drawInstanceOnPage(page, instance, style, displayText, embeddedFont);
            }
        }
    }

    hitTestCropHandle(screenX, screenY, region) {
        const screen = this.coordConverter.pdfPointsToScreenPixels(region.x, region.y, region.width, region.height, false);
        const rx = screen.x, ry = screen.y, rw = screen.width, rh = screen.height;
        const defs = [
            { dir: 'nw', x: rx, y: ry },
            { dir: 'n', x: rx + rw / 2, y: ry },
            { dir: 'ne', x: rx + rw, y: ry },
            { dir: 'e', x: rx + rw, y: ry + rh / 2 },
            { dir: 'se', x: rx + rw, y: ry + rh },
            { dir: 's', x: rx + rw / 2, y: ry + rh },
            { dir: 'sw', x: rx, y: ry + rh },
            { dir: 'w', x: rx, y: ry + rh / 2 }
        ];
        return defs.find(h => Math.abs(screenX - h.x) <= 7 && Math.abs(screenY - h.y) <= 7) || null;
    }

    hitTestCropRegion(screenX, screenY, pageIndex) {
        const list = this.cropRegions.filter(r => r.pageIndex === pageIndex);
        for (let i = list.length - 1; i >= 0; i--) {
            const region = list[i];
            const handle = this.hitTestCropHandle(screenX, screenY, region);
            if (handle) return { region: region, handle: handle.dir };
            const screen = this.coordConverter.pdfPointsToScreenPixels(region.x, region.y, region.width, region.height, false);
            if (screenX >= screen.x && screenX <= screen.x + screen.width &&
                screenY >= screen.y && screenY <= screen.y + screen.height) {
                return { region: region, handle: null };
            }
        }
        return null;
    }

    getCleanPdfBytes() {
        if (!this.basePdfBytes) return null;
        let bytes = this.basePdfBytes instanceof Uint8Array
            ? this.basePdfBytes
            : new Uint8Array(this.basePdfBytes);
        if (bytes.byteLength === 0) {
            throw new Error("PDFデータが空（0バイト）です。PDFを再度読み込んでください。");
        }
        let headerOffset = -1;
        const searchLimit = Math.min(bytes.length - 5, 4096);
        for (let i = 0; i <= searchLimit; i++) {
            if (
                bytes[i] === 0x25 &&
                bytes[i + 1] === 0x50 &&
                bytes[i + 2] === 0x44 &&
                bytes[i + 3] === 0x46 &&
                bytes[i + 4] === 0x2D
            ) {
                headerOffset = i;
                break;
            }
        }
        if (headerOffset === -1) {
            throw new Error("有効なPDFヘッダー（%PDF-）が見つかりません。ファイルが破損している可能性があります。");
        }
        if (headerOffset > 0) bytes = bytes.subarray(headerOffset);
        return new Uint8Array(bytes.slice(0));
    }

    async overlayNumberingPng(pdfDoc, page, pageIndex, region, paper) {
        const pageInstances = this.getSortedVisiblePageInstances(pageIndex);
        if (!pageInstances.length) return;

        const srcW = region
            ? (this.coordConverter.pageWidthPoints || paper.width)
            : page.getSize().width;
        const srcH = region
            ? (this.coordConverter.pageHeightPoints || paper.height)
            : page.getSize().height;
        const destW = region ? paper.width : srcW;
        const destH = region ? paper.height : srcH;

        const requestedScale = 3.0;
        const usedScale = PdfLayoutTools.scaleToFitMaxEdge(srcW, srcH, requestedScale, PdfLayoutTools.MAX_RASTER_EDGE);
        const px = PdfLayoutTools.floorCanvasSize(srcW * usedScale, srcH * usedScale);
        const offCanvas = document.createElement('canvas');
        offCanvas.width = px.width;
        offCanvas.height = px.height;
        const offCtx = offCanvas.getContext('2d');
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);

        const exportConverter = new CoordinateConverter();
        exportConverter.setPageContext(srcW, srcH, null);
        exportConverter.setZoom(offCanvas.width / srcW);

        for (const instance of pageInstances) {
            const group = this.groups.find(g => g.id === instance.groupId);
            if (!group || group.isHidden) continue;
            if (region) {
                const style = this.getInstanceStyle(instance, group);
                if (!PdfLayoutTools.rectsIntersect(PdfLayoutTools.instanceBounds(instance, style), region)) continue;
            }
            this.drawInstance(instance, group, offCtx, exportConverter, true);
        }

        let pngCanvas = offCanvas;
        if (region) {
            const pixelScale = offCanvas.width / srcW;
            const srcRect = PdfLayoutTools.clampDrawImageSource(
                region.x * pixelScale,
                (srcH - region.y - region.height) * pixelScale,
                region.width * pixelScale,
                region.height * pixelScale,
                offCanvas.width,
                offCanvas.height
            );
            const dest = document.createElement('canvas');
            const destPx = PdfLayoutTools.floorCanvasSize(destW * 2, destH * 2);
            dest.width = destPx.width;
            dest.height = destPx.height;
            if (srcRect.valid) {
                dest.getContext('2d').drawImage(
                    offCanvas,
                    srcRect.sx, srcRect.sy, srcRect.sw, srcRect.sh,
                    0, 0, dest.width, dest.height
                );
            }
            pngCanvas = dest;
        }

        // 番号オブジェクトだけ透過 PNG。下絵は呼び出し側が Form XObject として残す。
        const pngImage = await pdfDoc.embedPng(pngCanvas.toDataURL('image/png'));
        page.drawImage(pngImage, { x: 0, y: 0, width: destW, height: destH });
    }

    async overlayImageObjects(pdfDoc, totalPages) {
        for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
            await this.overlayNumberingPng(pdfDoc, pdfDoc.getPage(pageIdx), pageIdx, null, null);
        }
    }

    async downloadPdfBytes(pdfDoc) {
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const downloadName = (this.currentPdfName || 'output').replace(/\.pdf$/i, '') + '_edited.pdf';
        link.download = downloadName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    async exportCroppedPdf(exportMode) {
        if (!this.cropRegions.length) {
            throw new Error('抽出エリアがありません。帳票サイズを選んで「範囲追加」してください。');
        }
        const { PDFDocument } = PDFLib;
        const outDoc = await PDFDocument.create();
        let srcDoc = null;
        let embeddedPages = [];
        if (this.basePdfBytes) {
            srcDoc = await PDFDocument.load(this.getCleanPdfBytes(), { ignoreEncryption: true });
            if (this.respectLayerVisibility) {
                PdfLayoutTools.applyOcgVisibility(srcDoc, this.layerVisibilityByName);
            }
            embeddedPages = await outDoc.embedPdf(srcDoc, srcDoc.getPageIndices());
        }

        let vectorFont = null;
        if (exportMode === 'vector') {
            if (typeof PdfNativeExport === 'undefined') {
                throw new Error('PDFネイティブ出力モジュールが読み込まれていません。');
            }
            this.buildAutoTextIndexMap();
            let needFont = false;
            for (let r = 0; r < this.cropRegions.length; r++) {
                if (this.pageHasDrawableText(this.cropRegions[r].pageIndex)) {
                    needFont = true;
                    break;
                }
            }
            if (needFont) {
                vectorFont = await PdfNativeExport.embedNotoSansJpFont(outDoc);
            }
        }

        this.buildAutoTextIndexMap();

        for (let i = 0; i < this.cropRegions.length; i++) {
            const region = this.cropRegions[i];
            const paper = PdfLayoutTools.getPaperSize(region.paperKey, region.landscape);
            const page = outDoc.addPage([paper.width, paper.height]);
            const emb = embeddedPages[region.pageIndex];
            if (emb) {
                PdfLayoutTools.clipPageAndDrawEmbedded(page, emb, region, paper, PDFLib);
            }

            if (exportMode === 'vector') {
                const pageInstances = this.getSortedVisiblePageInstances(region.pageIndex);
                for (const instance of pageInstances) {
                    const group = this.groups.find(g => g.id === instance.groupId);
                    if (!group || group.isHidden) continue;
                    const style = this.getInstanceStyle(instance, group);
                    if (!PdfLayoutTools.rectsIntersect(PdfLayoutTools.instanceBounds(instance, style), region)) continue;
                    const mapped = PdfLayoutTools.mapInstanceToRegion(instance, style, region, paper);
                    const displayText = this.resolveAutoText(style.rawText, instance, group);
                    PdfNativeExport.drawInstanceOnPage(page, mapped.instance, mapped.style, displayText, vectorFont);
                }
            } else {
                await this.overlayNumberingPng(outDoc, page, region.pageIndex, region, paper);
            }
        }

        await this.downloadPdfBytes(outDoc);
    }

    async exportPdf(mode = 'image', options = {}) {
        const exportMode = mode === 'vector' ? 'vector' : 'image';
        if (options.respectLayers === false) this.respectLayerVisibility = false;
        else if (options.respectLayers === true) this.respectLayerVisibility = true;
        const scope = options.scope || this.exportScope || 'all';
        try {
            if (scope === 'regions') {
                await this.exportCroppedPdf(exportMode);
                return;
            }

            const { PDFDocument } = PDFLib;
            let pdfDoc = null;
            let totalPages = 1;

            if (this.basePdfBytes) {
                pdfDoc = await PDFDocument.load(this.getCleanPdfBytes(), { ignoreEncryption: true });
                if (this.respectLayerVisibility) {
                    PdfLayoutTools.applyOcgVisibility(pdfDoc, this.layerVisibilityByName);
                }
                totalPages = pdfDoc.getPageCount();
            } else {
                pdfDoc = await PDFDocument.create();
                let maxPage = 0;
                for (let i = 0; i < this.instances.length; i++) {
                    if (this.instances[i].pageIndex > maxPage) {
                        maxPage = this.instances[i].pageIndex;
                    }
                }
                totalPages = maxPage + 1;
                const ptW = this.coordConverter.pageWidthPoints || 595.28;
                const ptH = this.coordConverter.pageHeightPoints || 841.89;
                for (let p = 0; p < totalPages; p++) {
                    pdfDoc.addPage([ptW, ptH]);
                }
            }

            this.buildAutoTextIndexMap();
            if (exportMode === 'vector') {
                await this.overlayVectorObjects(pdfDoc, totalPages);
            } else {
                await this.overlayImageObjects(pdfDoc, totalPages);
            }

            await this.downloadPdfBytes(pdfDoc);
        } catch (e) {
            console.error("PDF出力失敗:", e);
            alert("PDF出力失敗: " + e.message);
        }
    }
}
