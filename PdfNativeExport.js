/**
 * PdfNativeExport.js
 * PDF出力用のネイティブ（ベクトル／テキスト）描画。
 * 画面プレビューの drawInstance とは独立し、pdf-lib のパス／文字演算子だけを使う。
 * 埋め込みフォントはライセンス上埋め込みできない游ゴシック等の代わりに Noto Sans JP を用いる。
 */
(function (root) {
    const NOTO_SANS_JP_FONT_URLS = [
        'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@5.2.5/japanese-400-normal.ttf',
        'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf'
    ];

    let cachedFontBytes = null;
    let cachedFontUrl = null;

    function getPdfLib() {
        const lib = (typeof PDFLib !== 'undefined') ? PDFLib : (root && root.PDFLib);
        if (!lib) {
            throw new Error('pdf-lib が読み込まれていません。CDN の読み込みを確認してください。');
        }
        return lib;
    }

    function getFontkit() {
        const fk = (typeof fontkit !== 'undefined') ? fontkit : (root && root.fontkit);
        if (!fk) {
            throw new Error('fontkit が読み込まれていません。CDN の読み込みを確認してください。');
        }
        return fk;
    }

    function hexToPdfRgb(hex) {
        const { rgb } = getPdfLib();
        let h = String(hex || '#000000').replace('#', '').trim();
        if (h.length === 3) {
            h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        if (h.length !== 6) {
            return rgb(0, 0, 0);
        }
        const n = parseInt(h, 16);
        if (Number.isNaN(n)) {
            return rgb(0, 0, 0);
        }
        return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }

    function normalizeRect(x, y, width, height) {
        let rx = x;
        let ry = y;
        let rw = width;
        let rh = height;
        if (rw < 0) {
            rx += rw;
            rw = -rw;
        }
        if (rh < 0) {
            ry += rh;
            rh = -rh;
        }
        return { x: rx, y: ry, width: rw, height: rh };
    }

    /** 三角形。PDF座標（原点左下、y 上向き）。頂点は矩形の上辺中央。 */
    function buildTriangleSvgPath(x, y, width, height) {
        const rect = normalizeRect(x, y, width, height);
        const topX = rect.x + rect.width / 2;
        const topY = rect.y + rect.height;
        return `M ${topX} ${topY} L ${rect.x + rect.width} ${rect.y} L ${rect.x} ${rect.y} Z`;
    }

    /**
     * 星形。Canvas は Y 下向きで rot=3π/2 から始めるため、
     * PDF（Y 上向き）では rot=π/2 から始めて同じ見た目にする。
     */
    function buildStarSvgPath(x, y, width, height) {
        const rect = normalizeRect(x, y, width, height);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const outerRadius = Math.min(rect.width, rect.height) / 2;
        const innerRadius = outerRadius / 2;
        const spikes = 5;
        const step = Math.PI / spikes;
        let rot = Math.PI / 2;
        let d = `M ${cx + Math.cos(rot) * outerRadius} ${cy + Math.sin(rot) * outerRadius}`;
        for (let i = 0; i < spikes; i++) {
            d += ` L ${cx + Math.cos(rot) * outerRadius} ${cy + Math.sin(rot) * outerRadius}`;
            rot += step;
            d += ` L ${cx + Math.cos(rot) * innerRadius} ${cy + Math.sin(rot) * innerRadius}`;
            rot += step;
        }
        d += ' Z';
        return d;
    }

    /** 矢印キャップ。先端が原点、+X 方向を向く（回転は呼び出し側）。 */
    function buildArrowSvgPath(size) {
        return `M 0 0 L ${-size * 2} ${size} L ${-size * 2} ${-size} Z`;
    }

    function shapeFillBorderOptions(bgColor, bgOpacity, hasBorder, bColor, bWidth) {
        const opts = {};
        if (bgOpacity > 0) {
            opts.color = hexToPdfRgb(bgColor);
            opts.opacity = bgOpacity;
        }
        if (hasBorder) {
            opts.borderColor = hexToPdfRgb(bColor);
            opts.borderWidth = bWidth;
            opts.borderOpacity = 1;
        }
        return opts;
    }

    function textBaselineY(font, fontSize, midY) {
        const full = font.heightAtSize(fontSize, { descender: true });
        const ascent = font.heightAtSize(fontSize, { descender: false });
        const centerOffset = ascent - full / 2;
        return midY - centerOffset;
    }

    function drawCenteredLines(page, font, lines, centerX, firstMidY, lineHeight, fontSize, textColor, textScaleX) {
        const PDF = getPdfLib();
        let midY = firstMidY;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const textWidth = font.widthOfTextAtSize(line, fontSize);
            const baselineY = textBaselineY(font, fontSize, midY);
            if (textScaleX < 1) {
                page.pushOperators(
                    PDF.pushGraphicsState(),
                    PDF.concatTransformationMatrix(textScaleX, 0, 0, 1, centerX, baselineY)
                );
                page.drawText(line, {
                    x: -textWidth / 2,
                    y: 0,
                    size: fontSize,
                    font: font,
                    color: textColor
                });
                page.pushOperators(PDF.popGraphicsState());
            } else {
                page.drawText(line, {
                    x: centerX - textWidth / 2,
                    y: baselineY,
                    size: fontSize,
                    font: font,
                    color: textColor
                });
            }
            midY -= lineHeight;
        }
    }

    function drawCap(page, x, y, angle, type, capSize, color) {
        const PDF = getPdfLib();
        if (type === 'arrow') {
            page.drawSvgPath(buildArrowSvgPath(capSize), {
                x: x,
                y: y,
                rotate: PDF.radians(angle),
                color: color
            });
        } else if (type === 'circle') {
            page.drawCircle({
                x: x,
                y: y,
                size: capSize,
                color: color
            });
        }
    }

    /**
     * instance.x/y は PDF ポイント（原点左下）。線の終点は (x+width, y+height)。
     * すべての UI フォントは Noto Sans JP（引数 font）にマップする。
     */
    function drawInstanceOnPage(page, instance, style, displayText, font) {
        const shape = style.shape;
        const fontSize = style.fontSize;
        const lines = String(displayText == null ? '' : displayText).split('\n');
        let maxTextWidth = 0;
        if (font) {
            for (let i = 0; i < lines.length; i++) {
                const w = font.widthOfTextAtSize(lines[i], fontSize);
                if (w > maxTextWidth) maxTextWidth = w;
            }
        }
        const lineHeight = fontSize * 1.25;
        const totalTextHeight = lines.length * lineHeight;

        let x = instance.x;
        let y = instance.y;
        let width = style.width;
        let height = style.height;
        let textScaleX = 1.0;
        const padding = 10;

        if (shape !== 'line') {
            if (style.isAuto) {
                width = maxTextWidth + padding * 2;
                height = totalTextHeight + padding * 2;
            } else if (maxTextWidth > width && maxTextWidth > 0) {
                textScaleX = (width - padding) / maxTextWidth;
                if (textScaleX < 0.01) textScaleX = 0.01;
            }
        }

        const textColor = hexToPdfRgb(style.tColor);
        const hasText = font && String(displayText || '').trim() !== '';

        if (shape === 'line') {
            const x2 = x + width;
            const y2 = y + height;
            page.drawLine({
                start: { x: x, y: y },
                end: { x: x2, y: y2 },
                thickness: style.bWidth,
                color: hexToPdfRgb(style.bColor)
            });
            const angle = Math.atan2(y2 - y, x2 - x);
            if (style.startCap && style.startCap !== 'none') {
                drawCap(page, x, y, angle + Math.PI, style.startCap, style.capSize, hexToPdfRgb(style.bColor));
            }
            if (style.endCap && style.endCap !== 'none') {
                drawCap(page, x2, y2, angle, style.endCap, style.capSize, hexToPdfRgb(style.bColor));
            }
            if (hasText) {
                const firstMidY = (y + y2) / 2 + totalTextHeight / 2 - lineHeight / 2;
                drawCenteredLines(page, font, lines, (x + x2) / 2, firstMidY, lineHeight, fontSize, textColor, 1);
            }
            return;
        }

        const rect = normalizeRect(x, y, width, height);
        const fb = shapeFillBorderOptions(style.bgColor, style.bgOpacity, style.hasBorder, style.bColor, style.bWidth);

        if (shape === 'rectangle') {
            if (fb.color || fb.borderColor) {
                page.drawRectangle({
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    ...fb
                });
            }
        } else if (shape === 'circle') {
            if (fb.color || fb.borderColor) {
                page.drawEllipse({
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    xScale: rect.width / 2,
                    yScale: rect.height / 2,
                    ...fb
                });
            }
        } else if (shape === 'triangle') {
            if (fb.color || fb.borderColor) {
                page.drawSvgPath(buildTriangleSvgPath(rect.x, rect.y, rect.width, rect.height), {
                    x: 0,
                    y: 0,
                    ...fb
                });
            }
        } else if (shape === 'star') {
            if (fb.color || fb.borderColor) {
                page.drawSvgPath(buildStarSvgPath(rect.x, rect.y, rect.width, rect.height), {
                    x: 0,
                    y: 0,
                    ...fb
                });
            }
        }

        if (hasText) {
            const firstMidY = rect.y + rect.height / 2 + totalTextHeight / 2 - lineHeight / 2;
            drawCenteredLines(
                page,
                font,
                lines,
                rect.x + rect.width / 2,
                firstMidY,
                lineHeight,
                fontSize,
                textColor,
                textScaleX
            );
        }
    }

    async function fetchNotoSansJpFontBytes() {
        if (cachedFontBytes) {
            return cachedFontBytes;
        }

        let lastError = null;
        for (let i = 0; i < NOTO_SANS_JP_FONT_URLS.length; i++) {
            const url = NOTO_SANS_JP_FONT_URLS[i];
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    lastError = new Error('HTTP ' + res.status + ' ' + url);
                    continue;
                }
                const buf = await res.arrayBuffer();
                if (!buf || buf.byteLength < 1000) {
                    lastError = new Error('フォントデータが不正です: ' + url);
                    continue;
                }
                const head = new Uint8Array(buf.slice(0, 4));
                const isWoff = head[0] === 0x77 && head[1] === 0x4F && head[2] === 0x46 && head[3] === 0x46;
                if (isWoff) {
                    lastError = new Error('WOFF は PDF 埋め込みに使えません: ' + url);
                    continue;
                }
                cachedFontBytes = buf;
                cachedFontUrl = url;
                return cachedFontBytes;
            } catch (e) {
                lastError = e;
            }
        }

        const detail = lastError && lastError.message ? lastError.message : String(lastError);
        throw new Error(
            'Noto Sans JP フォントの取得に失敗しました。ネットワークまたは CDN を確認してください。(' + detail + ')'
        );
    }

    function getCachedFontUrl() {
        return cachedFontUrl;
    }

    function registerFontkitOnDocument(pdfDoc) {
        pdfDoc.registerFontkit(getFontkit());
    }

    async function embedNotoSansJpFont(pdfDoc) {
        registerFontkitOnDocument(pdfDoc);
        const fontBytes = await fetchNotoSansJpFontBytes();
        const isTrueType = isLikelyTrueTypeFont(fontBytes);
        try {
            return await pdfDoc.embedFont(fontBytes, {
                subset: isTrueType,
                customName: 'NotoSansJP'
            });
        } catch (e) {
            console.warn('フォント埋め込みに失敗したため、非 subset で再試行します:', e);
            return await pdfDoc.embedFont(fontBytes, {
                subset: false,
                customName: 'NotoSansJP'
            });
        }
    }

    function isLikelyTrueTypeFont(fontBytes) {
        const u8 = fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes);
        if (u8.length < 4) return false;
        const tag = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
        if (tag === 'true' || tag === 'ttcf') return true;
        return u8[0] === 0x00 && u8[1] === 0x01 && u8[2] === 0x00 && u8[3] === 0x00;
    }

    const api = {
        NOTO_SANS_JP_FONT_URLS: NOTO_SANS_JP_FONT_URLS,
        hexToPdfRgb: hexToPdfRgb,
        normalizeRect: normalizeRect,
        buildTriangleSvgPath: buildTriangleSvgPath,
        buildStarSvgPath: buildStarSvgPath,
        buildArrowSvgPath: buildArrowSvgPath,
        drawInstanceOnPage: drawInstanceOnPage,
        fetchNotoSansJpFontBytes: fetchNotoSansJpFontBytes,
        getCachedFontUrl: getCachedFontUrl,
        registerFontkitOnDocument: registerFontkitOnDocument,
        embedNotoSansJpFont: embedNotoSansJpFont,
        getFontkit: getFontkit
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.PdfNativeExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
