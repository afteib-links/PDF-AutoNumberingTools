/**
 * AppCore.js
 * コアエンジン（描画最適化・個別オーバーライド完全判定・高解像度PDF出力・安全保存対応版）
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

        this.pdfCanvas = document.getElementById('pdf-render-canvas');
        this.pdfCtx = this.pdfCanvas.getContext('2d');
        this.layerCanvas = document.getElementById('interactive-layer-canvas');
        this.layerCtx = this.layerCanvas.getContext('2d');
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

    async loadPdfFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.basePdfBytes = new Uint8Array(arrayBuffer.slice(0)); 
            this.currentPdfName = file.name;
            this.currentPdfPath = file.webkitRelativePath || file.name;

            const pdfjsData = new Uint8Array(arrayBuffer.slice(0));
            const loadingTask = pdfjsLib.getDocument({ 
                data: pdfjsData,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                cMapPacked: true
            });
            
            this.pdfDocument = await loadingTask.promise;
            this.totalPageNum = this.pdfDocument.numPages;
            this.currentPageNum = 1;
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
            const loadingTask = pdfjsLib.getDocument({ 
                data: pdfjsData,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                cMapPacked: true
            });
            this.pdfDocument = await loadingTask.promise;
            this.totalPageNum = this.pdfDocument.numPages;
            if (this.currentPageNum > this.totalPageNum) this.currentPageNum = 1;
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
                        instances: cleanInstances
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
                this.currentPageNum = projectRecord.currentPageNum || 1;
                this.coordConverter.zoomLevel = projectRecord.zoomLevel || 1.0;
                this.selectedInstanceIds.clear();

                if (blobRecord && blobRecord.pdfBytes) {
                    const rawBytes = blobRecord.pdfBytes instanceof Uint8Array 
                        ? blobRecord.pdfBytes 
                        : new Uint8Array(blobRecord.pdfBytes);
                    this.basePdfBytes = new Uint8Array(rawBytes.slice(0));
                    const pdfjsData = new Uint8Array(this.basePdfBytes.slice(0));
                    const loadingTask = pdfjsLib.getDocument({ 
                        data: pdfjsData,
                        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                        cMapPacked: true
                    });
                    this.pdfDocument = await loadingTask.promise;
                    this.totalPageNum = this.pdfDocument.numPages;
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

            this.pdfCanvas.width = viewport.width;
            this.pdfCanvas.height = viewport.height;
            this.pdfCanvas.style.width = `${viewport.width}px`;
            this.pdfCanvas.style.height = `${viewport.height}px`;
            this.layerCanvas.width = viewport.width;
            this.layerCanvas.height = viewport.height;
            this.layerCanvas.style.width = `${viewport.width}px`;
            this.layerCanvas.style.height = `${viewport.height}px`;
            this.canvasWrapper.style.width = `${viewport.width}px`;
            this.canvasWrapper.style.height = `${viewport.height}px`;

            const renderContext = { canvasContext: this.pdfCtx, viewport: viewport };
            this.currentRenderTask = page.render(renderContext);
            await this.currentRenderTask.promise;
            this.currentRenderTask = null;

            this.renderInteractiveLayer();
        } catch (error) {
            if (error && error.name === 'RenderingCancelledException') {
                return;
            }
            console.error("PDFレンダリングエラー:", error);
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

    renderInteractiveLayer() {
        this.layerCtx.clearRect(0, 0, this.layerCanvas.width, this.layerCanvas.height);
        if (!this.instances || this.instances.length === 0) {
            this.drawSelectionBox();
            return;
        }

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

        this.drawSelectionBox();
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

    drawInstance(instance, group, ctx, converter, isExport = false) {
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
        
        const displayText = this.resolveAutoText(rawText, instance, group);
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

        const ptWidth = instance.isSizeLocked && instance.overrideWidth !== null ? instance.overrideWidth : group.width;
        const ptHeight = instance.isSizeLocked && instance.overrideHeight !== null ? instance.overrideHeight : group.height;
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

    async exportPdf() {
        try {
            const { PDFDocument } = PDFLib;
            let pdfDoc = null;
            let totalPages = 1;

            if (this.basePdfBytes) {
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

                if (headerOffset > 0) {
                    bytes = bytes.subarray(headerOffset);
                }

                const cleanBytes = new Uint8Array(bytes.slice(0));
                pdfDoc = await PDFDocument.load(cleanBytes, { ignoreEncryption: true });
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

            const exportScale = 3.0; 
            this.buildAutoTextIndexMap();

            for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
                const pageInstances = this.instances.filter(inst => inst.pageIndex === pageIdx && !inst.isHidden);
                if (pageInstances.length === 0) continue;

                const page = pdfDoc.getPage(pageIdx);
                const { width: ptW, height: ptH } = page.getSize();

                const offCanvas = document.createElement('canvas');
                offCanvas.width = ptW * exportScale;
                offCanvas.height = ptH * exportScale;
                const offCtx = offCanvas.getContext('2d');

                const exportConverter = new CoordinateConverter();
                exportConverter.setPageContext(ptW, ptH, null);
                exportConverter.setZoom(exportScale);

                pageInstances.sort((a, b) => {
                    const groupA = this.groups.find(g => g.id === a.groupId);
                    const groupB = this.groups.find(g => g.id === b.groupId);
                    const zA = a.isZIndexLocked && a.overrideZIndex !== null ? a.overrideZIndex : (groupA ? groupA.zIndex || 0 : 0);
                    const zB = b.isZIndexLocked && b.overrideZIndex !== null ? b.overrideZIndex : (groupB ? groupB.zIndex || 0 : 0);
                    if (zA !== zB) return zA - zB;
                    return a.order - b.order;
                });

                for (const instance of pageInstances) {
                    const group = this.groups.find(g => g.id === instance.groupId);
                    if (!group || group.isHidden) continue;
                    this.drawInstance(instance, group, offCtx, exportConverter, true);
                }

                const pngDataUrl = offCanvas.toDataURL('image/png');
                const pngImage = await pdfDoc.embedPng(pngDataUrl);

                page.drawImage(pngImage, {
                    x: 0,
                    y: 0,
                    width: ptW,
                    height: ptH,
                });
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: "application/pdf" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            const downloadName = (this.currentPdfName || 'output').replace(/\.pdf$/i, '') + '_edited.pdf';
            link.download = downloadName;
            link.click();
            URL.revokeObjectURL(link.href);
        } catch (e) {
            console.error("PDF出力失敗:", e);
            alert("PDF出力失敗: " + e.message);
        }
    }
}
