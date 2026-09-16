/**
 * PdfLayoutTools.js
 * 帳票サイズ・抽出枠・PDFレイヤー（OCG）まわりの共通処理。
 */
(function (root) {
    const MM_TO_PT = 72 / 25.4;

    function mmToPt(mm) {
        return mm * MM_TO_PT;
    }

    /** JIS 系。値はポイント（縦置き時の幅×高さ）。 */
    const PAPER_SIZES = {
        A3: { key: 'A3', label: 'A3', width: mmToPt(297), height: mmToPt(420) },
        A4: { key: 'A4', label: 'A4', width: mmToPt(210), height: mmToPt(297) },
        A5: { key: 'A5', label: 'A5', width: mmToPt(148), height: mmToPt(210) },
        A6: { key: 'A6', label: 'A6', width: mmToPt(105), height: mmToPt(148) },
        B3: { key: 'B3', label: 'B3', width: mmToPt(364), height: mmToPt(515) },
        B4: { key: 'B4', label: 'B4', width: mmToPt(257), height: mmToPt(364) },
        B5: { key: 'B5', label: 'B5', width: mmToPt(182), height: mmToPt(257) },
        B6: { key: 'B6', label: 'B6', width: mmToPt(128), height: mmToPt(182) },
        hagaki: { key: 'hagaki', label: 'ハガキ', width: mmToPt(100), height: mmToPt(148) }
    };

    const PAPER_KEYS = ['A3', 'A4', 'A5', 'A6', 'B3', 'B4', 'B5', 'B6', 'hagaki'];
    const MIN_REGION_PT = 24;

    function getPaperSize(paperKey, landscape) {
        const spec = PAPER_SIZES[paperKey] || PAPER_SIZES.A4;
        if (landscape) {
            return { key: spec.key, label: spec.label, width: spec.height, height: spec.width, landscape: true };
        }
        return { key: spec.key, label: spec.label, width: spec.width, height: spec.height, landscape: false };
    }

    function paperAspect(paperKey, landscape) {
        const p = getPaperSize(paperKey, landscape);
        return p.width / p.height;
    }

    /**
     * ページ内に帳票比の枠を置く。scaleRatio はページ短辺に対する枠の割合。
     */
    function createCenteredRegion(id, pageIndex, paperKey, landscape, pageWidth, pageHeight, scaleRatio) {
        const paper = getPaperSize(paperKey, landscape);
        const ratio = (typeof scaleRatio === 'number' && scaleRatio > 0) ? scaleRatio : 0.72;
        const scale = Math.min((pageWidth * ratio) / paper.width, (pageHeight * ratio) / paper.height);
        let width = paper.width * scale;
        let height = paper.height * scale;
        if (width > pageWidth) {
            const s = pageWidth / width;
            width *= s;
            height *= s;
        }
        if (height > pageHeight) {
            const s = pageHeight / height;
            width *= s;
            height *= s;
        }
        const x = Math.max(0, (pageWidth - width) / 2);
        const y = Math.max(0, (pageHeight - height) / 2);
        return {
            id: id,
            pageIndex: pageIndex,
            x: round1(x),
            y: round1(y),
            width: round1(width),
            height: round1(height),
            paperKey: paper.key,
            landscape: !!landscape
        };
    }

    function round1(n) {
        return Math.round(n * 10) / 10;
    }

    function clampRegionToPage(region, pageWidth, pageHeight) {
        const out = Object.assign({}, region);
        out.width = Math.max(MIN_REGION_PT, Math.min(out.width, pageWidth));
        out.height = Math.max(MIN_REGION_PT / paperAspect(out.paperKey, out.landscape), Math.min(out.height, pageHeight));
        const aspect = paperAspect(out.paperKey, out.landscape);
        if (out.width / out.height > aspect) {
            out.width = out.height * aspect;
        } else {
            out.height = out.width / aspect;
        }
        out.width = Math.min(out.width, pageWidth);
        out.height = Math.min(out.height, pageHeight);
        out.width = Math.max(MIN_REGION_PT, out.width);
        out.height = out.width / aspect;
        if (out.height > pageHeight) {
            out.height = pageHeight;
            out.width = out.height * aspect;
        }
        out.x = Math.min(Math.max(0, out.x), Math.max(0, pageWidth - out.width));
        out.y = Math.min(Math.max(0, out.y), Math.max(0, pageHeight - out.height));
        out.x = round1(out.x);
        out.y = round1(out.y);
        out.width = round1(out.width);
        out.height = round1(out.height);
        return out;
    }

    function applyPaperToRegion(region, paperKey, landscape, pageWidth, pageHeight) {
        const next = Object.assign({}, region, { paperKey: paperKey, landscape: !!landscape });
        const aspect = paperAspect(paperKey, landscape);
        const cx = region.x + region.width / 2;
        const cy = region.y + region.height / 2;
        let width = region.width;
        let height = width / aspect;
        if (height > pageHeight) {
            height = pageHeight;
            width = height * aspect;
        }
        if (width > pageWidth) {
            width = pageWidth;
            height = width / aspect;
        }
        next.width = width;
        next.height = height;
        next.x = cx - width / 2;
        next.y = cy - height / 2;
        return clampRegionToPage(next, pageWidth, pageHeight);
    }

    function moveRegion(region, deltaX, deltaY, pageWidth, pageHeight) {
        const next = Object.assign({}, region);
        next.x = region.x + deltaX;
        next.y = region.y + deltaY;
        return clampRegionToPage(next, pageWidth, pageHeight);
    }

    /**
     * 対角を固定して帳票比を保ったまま拡大縮小する。
     * dir: nw, n, ne, e, se, s, sw, w
     */
    function resizeRegion(region, dir, deltaX, deltaY, pageWidth, pageHeight) {
        const aspect = paperAspect(region.paperKey, region.landscape);
        const init = {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height
        };
        const right = init.x + init.width;
        const top = init.y + init.height;

        let anchorX = init.x;
        let anchorY = init.y;
        if (dir.indexOf('w') !== -1) {
            anchorX = right;
        } else if (dir.indexOf('e') !== -1) {
            anchorX = init.x;
        } else {
            anchorX = init.x + init.width / 2;
        }
        if (dir.indexOf('s') !== -1) {
            anchorY = top;
        } else if (dir.indexOf('n') !== -1) {
            anchorY = init.y;
        } else {
            anchorY = init.y + init.height / 2;
        }

        let liveX = init.x;
        let liveY = init.y;
        let liveW = init.width;
        let liveH = init.height;
        if (dir.indexOf('e') !== -1) {
            liveW = init.width + deltaX;
        }
        if (dir.indexOf('w') !== -1) {
            liveW = init.width - deltaX;
            liveX = init.x + deltaX;
        }
        if (dir.indexOf('n') !== -1) {
            liveH = init.height + deltaY;
        }
        if (dir.indexOf('s') !== -1) {
            liveH = init.height - deltaY;
            liveY = init.y + deltaY;
        }

        let width = liveW;
        let height = liveH;
        const widthDriven = dir === 'e' || dir === 'w' || dir === 'ne' || dir === 'se' || dir === 'nw' || dir === 'sw';
        if (dir === 'n' || dir === 's') {
            height = Math.max(MIN_REGION_PT, liveH);
            width = height * aspect;
        } else if (widthDriven) {
            width = Math.max(MIN_REGION_PT, liveW);
            height = width / aspect;
        } else {
            const byW = Math.abs(liveW) / init.width;
            const byH = Math.abs(liveH) / init.height;
            const scale = Math.max(byW, byH);
            width = Math.max(MIN_REGION_PT, init.width * scale);
            height = width / aspect;
        }

        let x;
        let y;
        if (dir.indexOf('w') !== -1) {
            x = anchorX - width;
        } else if (dir.indexOf('e') !== -1) {
            x = anchorX;
        } else {
            x = anchorX - width / 2;
        }
        if (dir.indexOf('s') !== -1) {
            y = anchorY - height;
        } else if (dir.indexOf('n') !== -1) {
            y = anchorY;
        } else {
            y = anchorY - height / 2;
        }

        return clampRegionToPage({
            id: region.id,
            pageIndex: region.pageIndex,
            x: x,
            y: y,
            width: width,
            height: height,
            paperKey: region.paperKey,
            landscape: region.landscape
        }, pageWidth, pageHeight);
    }

    function rectsIntersect(a, b) {
        return a.x < b.x + b.width && a.x + a.width > b.x &&
            a.y < b.y + b.height && a.y + a.height > b.y;
    }

    function instanceBounds(instance, style) {
        if (style.shape === 'line') {
            const x2 = instance.x + style.width;
            const y2 = instance.y + style.height;
            const x = Math.min(instance.x, x2);
            const y = Math.min(instance.y, y2);
            return { x: x, y: y, width: Math.abs(style.width), height: Math.abs(style.height) };
        }
        return { x: instance.x, y: instance.y, width: style.width, height: style.height };
    }

    function mapInstanceToRegion(instance, style, region, paper) {
        const sx = paper.width / region.width;
        const sy = paper.height / region.height;
        return {
            instance: {
                x: (instance.x - region.x) * sx,
                y: (instance.y - region.y) * sy
            },
            style: Object.assign({}, style, {
                width: style.width * sx,
                height: style.height * sy,
                fontSize: style.fontSize * sx,
                bWidth: style.bWidth * sx,
                capSize: style.capSize * sx
            })
        };
    }

    function decodePdfName(obj) {
        if (!obj) return '';
        if (typeof obj.decodeText === 'function') {
            try { return obj.decodeText(); } catch (e) { /* fall through */ }
        }
        if (typeof obj.asString === 'function') {
            return String(obj.asString()).replace(/^\(|\)$/g, '');
        }
        return String(obj);
    }

    function listOptionalContentLayers(optionalContentConfig) {
        const layers = [];
        if (!optionalContentConfig) return layers;

        let entries = [];
        if (typeof optionalContentConfig.getGroups === 'function') {
            const groups = optionalContentConfig.getGroups();
            if (groups) {
                if (typeof groups.forEach === 'function' && typeof groups.get === 'function') {
                    groups.forEach((g, id) => entries.push([id, g]));
                } else {
                    entries = Object.entries(groups);
                }
            }
        }

        if (entries.length === 0 && typeof optionalContentConfig.getOrder === 'function') {
            const order = optionalContentConfig.getOrder() || [];
            const flat = [];
            const walk = (node) => {
                if (Array.isArray(node)) {
                    node.forEach(walk);
                } else if (node != null && node !== true && node !== false) {
                    flat.push(node);
                }
            };
            walk(order);
            for (let i = 0; i < flat.length; i++) {
                const id = flat[i];
                const g = typeof optionalContentConfig.getGroup === 'function'
                    ? optionalContentConfig.getGroup(id)
                    : null;
                entries.push([id, g || { name: String(id) }]);
            }
        }

        const seen = new Set();
        for (let i = 0; i < entries.length; i++) {
            const id = entries[i][0];
            const g = entries[i][1] || {};
            if (id == null || seen.has(id)) continue;
            seen.add(id);
            const name = g.name || g.Name || String(id);
            let visible = g.visible !== false;
            if (typeof optionalContentConfig.isVisible === 'function') {
                try {
                    visible = !!optionalContentConfig.isVisible(g);
                } catch (e) {
                    try {
                        visible = !!optionalContentConfig.isVisible(id);
                    } catch (e2) { /* keep g.visible */ }
                }
            }
            layers.push({ id: id, name: String(name), visible: visible });
        }
        return layers;
    }

    function applyOcgVisibility(pdfDoc, visibilityByName) {
        if (!pdfDoc || !visibilityByName) return false;
        const PDF = (typeof PDFLib !== 'undefined') ? PDFLib : (root && root.PDFLib);
        if (!PDF || !PDF.PDFName) return false;
        const PDFName = PDF.PDFName;
        try {
            const ocProps = pdfDoc.catalog.lookup(PDFName.of('OCProperties'));
            if (!ocProps) return false;
            const ocgs = ocProps.lookup(PDFName.of('OCGs'));
            if (!ocgs || typeof ocgs.size !== 'function') return false;

            const context = pdfDoc.context;
            const onArr = context.obj([]);
            const offArr = context.obj([]);
            let changed = false;

            for (let i = 0; i < ocgs.size(); i++) {
                const ref = ocgs.get(i);
                const dict = context.lookup(ref);
                if (!dict) continue;
                const name = decodePdfName(dict.lookup(PDFName.of('Name')));
                const visible = Object.prototype.hasOwnProperty.call(visibilityByName, name)
                    ? !!visibilityByName[name]
                    : true;
                if (visible) {
                    onArr.push(ref);
                } else {
                    offArr.push(ref);
                    changed = true;
                }
            }

            let d = ocProps.lookup(PDFName.of('D'));
            if (!d) {
                d = context.obj({});
                ocProps.set(PDFName.of('D'), d);
            }
            d.set(PDFName.of('BaseState'), PDFName.of('ON'));
            d.set(PDFName.of('ON'), onArr);
            d.set(PDFName.of('OFF'), offArr);
            return changed || offArr.size() > 0;
        } catch (e) {
            console.warn('OCG 可視状態の書き込みに失敗:', e);
            return false;
        }
    }

    function clipPageAndDrawEmbedded(page, embeddedPage, region, paper, PDF) {
        const scale = paper.width / region.width;
        const ops = [];
        if (PDF.pushGraphicsState) ops.push(PDF.pushGraphicsState());
        if (PDF.moveTo) ops.push(PDF.moveTo(0, 0));
        if (PDF.lineTo) {
            ops.push(PDF.lineTo(paper.width, 0));
            ops.push(PDF.lineTo(paper.width, paper.height));
            ops.push(PDF.lineTo(0, paper.height));
        }
        if (PDF.closePath) ops.push(PDF.closePath());
        if (PDF.clip) ops.push(PDF.clip());
        if (PDF.endPath) ops.push(PDF.endPath());
        if (ops.length) page.pushOperators.apply(page, ops);

        page.drawPage(embeddedPage, {
            x: -region.x * scale,
            y: -region.y * scale,
            width: embeddedPage.width * scale,
            height: embeddedPage.height * scale
        });

        if (PDF.popGraphicsState) {
            page.pushOperators(PDF.popGraphicsState());
        }
    }

    const MAX_RASTER_EDGE = 8192;

    function floorCanvasSize(width, height) {
        return {
            width: Math.max(1, Math.floor(Number(width) || 0)),
            height: Math.max(1, Math.floor(Number(height) || 0))
        };
    }

    function scaleToFitMaxEdge(pageWidth, pageHeight, scale, maxEdge) {
        const cap = maxEdge || MAX_RASTER_EDGE;
        const req = (typeof scale === 'number' && scale > 0) ? scale : 1;
        const w = pageWidth * req;
        const h = pageHeight * req;
        const edge = Math.max(w, h, 1);
        if (edge <= cap) return req;
        return req * (cap / edge);
    }

    function canvasTransformForViewport(viewport, canvasWidth, canvasHeight) {
        if (!viewport || !viewport.width || !viewport.height) return null;
        if (canvasWidth === viewport.width && canvasHeight === viewport.height) return null;
        return [canvasWidth / viewport.width, 0, 0, canvasHeight / viewport.height, 0, 0];
    }

    function clampDrawImageSource(sx, sy, sw, sh, canvasW, canvasH) {
        let x = Number(sx) || 0;
        let y = Number(sy) || 0;
        let w = Number(sw) || 0;
        let h = Number(sh) || 0;
        if (w < 0) {
            x += w;
            w = -w;
        }
        if (h < 0) {
            y += h;
            h = -h;
        }
        if (x < 0) {
            w += x;
            x = 0;
        }
        if (y < 0) {
            h += y;
            y = 0;
        }
        if (x + w > canvasW) w = canvasW - x;
        if (y + h > canvasH) h = canvasH - y;
        w = Math.max(0, w);
        h = Math.max(0, h);
        return { sx: x, sy: y, sw: w, sh: h, valid: w >= 1 && h >= 1 };
    }

    const api = {
        MM_TO_PT: MM_TO_PT,
        PAPER_SIZES: PAPER_SIZES,
        PAPER_KEYS: PAPER_KEYS,
        MIN_REGION_PT: MIN_REGION_PT,
        getPaperSize: getPaperSize,
        paperAspect: paperAspect,
        createCenteredRegion: createCenteredRegion,
        clampRegionToPage: clampRegionToPage,
        applyPaperToRegion: applyPaperToRegion,
        moveRegion: moveRegion,
        resizeRegion: resizeRegion,
        rectsIntersect: rectsIntersect,
        instanceBounds: instanceBounds,
        mapInstanceToRegion: mapInstanceToRegion,
        listOptionalContentLayers: listOptionalContentLayers,
        applyOcgVisibility: applyOcgVisibility,
        clipPageAndDrawEmbedded: clipPageAndDrawEmbedded,
        decodePdfName: decodePdfName,
        MAX_RASTER_EDGE: MAX_RASTER_EDGE,
        floorCanvasSize: floorCanvasSize,
        scaleToFitMaxEdge: scaleToFitMaxEdge,
        canvasTransformForViewport: canvasTransformForViewport,
        clampDrawImageSource: clampDrawImageSource
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.PdfLayoutTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
