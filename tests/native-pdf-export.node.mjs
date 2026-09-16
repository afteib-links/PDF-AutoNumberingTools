/**
 * ネイティブ PDF 出力の検証（Node、ブラウザ UI なし）
 */
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

globalThis.PDFLib = PDFLib;
globalThis.fontkit = fontkit;
const PdfNativeExport = require(join(root, 'PdfNativeExport.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function hexBlobsToAscii(s) {
    return s.replace(/<([0-9A-Fa-f]+)>/g, (_, h) => {
        let out = '';
        for (let i = 0; i < h.length; i += 2) {
            out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
        }
        return out;
    });
}

function decodePdfStreams(raw) {
    const parts = [];
    const re = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const bytes = Buffer.from(m[1], 'latin1');
        try {
            parts.push(inflateSync(bytes).toString('latin1'));
        } catch (_) {
            try {
                parts.push(inflateSync(bytes.subarray(2)).toString('latin1'));
            } catch (_) {
                parts.push(m[1]);
            }
        }
    }
    return parts.join('\n');
}

async function main() {
    const { readFileSync } = await import('node:fs');
    const appCoreSrc = readFileSync(join(root, 'AppCore.js'), 'utf8');
    const indexSrc = readFileSync(join(root, 'index.html'), 'utf8');
    assert(indexSrc.includes('id="pdf-export-mode-select"'), '出力方式セレクトがある');
    assert(indexSrc.includes('value="image"') && indexSrc.includes('value="vector"'), '画像／オブジェクトの選択肢がある');
    assert(appCoreSrc.includes("mode === 'vector'"), 'exportPdf が vector を分岐する');
    assert(appCoreSrc.includes('overlayImageObjects'), '画像合成経路がある');
    assert(appCoreSrc.includes("toDataURL('image/png')"), '画像経路は PNG 合成する');
    assert(appCoreSrc.includes('overlayVectorObjects'), 'オブジェクト描画経路がある');

    const tri = PdfNativeExport.buildTriangleSvgPath(10, 20, 100, 40);
    assert(tri.includes('M 60 60'), '三角形の頂点は上辺中央 (PDF y 上向き)');
    assert(tri.includes('L 110 20'), '三角形の右下');
    assert(tri.includes('L 10 20'), '三角形の左下');

    const star = PdfNativeExport.buildStarSvgPath(0, 0, 100, 100);
    const firstY = parseFloat(star.match(/^M [-\d.]+ ([-\d.]+)/)[1]);
    assert(firstY > 50, '星の最初の点は視覚的な上（中心より +Y）: ' + firstY);

    const arrow = PdfNativeExport.buildArrowSvgPath(6);
    assert(arrow.startsWith('M 0 0'), '矢印は先端が原点');

    assert(typeof PDFLib.concatTransformationMatrix === 'function', 'concatTransformationMatrix が pdf-lib にある');
    assert(typeof PDFLib.radians === 'function', 'radians が pdf-lib にある');
    assert(typeof PDFLib.rgb === 'function', 'rgb が pdf-lib にある');

    const { PDFDocument, StandardFonts } = PDFLib;

    const baseDoc = await PDFDocument.create();
    const helv = await baseDoc.embedFont(StandardFonts.Helvetica);
    const page0 = baseDoc.addPage([400, 500]);
    page0.drawText('BASE_PAGE_CONTENT', { x: 40, y: 450, size: 14, font: helv });
    const baseBytes = await baseDoc.save();

    const outDoc = await PDFDocument.load(baseBytes);
    PdfNativeExport.registerFontkitOnDocument(outDoc);
    const jpFont = await PdfNativeExport.embedNotoSansJpFont(outDoc);
    const page = outDoc.getPage(0);

    const common = {
        isAuto: false,
        hasBorder: true,
        bWidth: 1.5,
        bColor: '#112233',
        tColor: '#000000',
        bgColor: '#ffcc00',
        bgOpacity: 0.5,
        startCap: 'none',
        endCap: 'none',
        capSize: 6,
        fontSize: 12,
        rawText: '',
        width: 80,
        height: 30
    };

    PdfNativeExport.drawInstanceOnPage(page, { x: 20, y: 300 }, { ...common, shape: 'rectangle' }, '矩形\n二行', jpFont);
    PdfNativeExport.drawInstanceOnPage(page, { x: 120, y: 280 }, { ...common, shape: 'circle', bgOpacity: 0 }, '円', jpFont);
    PdfNativeExport.drawInstanceOnPage(page, { x: 220, y: 280 }, { ...common, shape: 'triangle' }, '三角', jpFont);
    PdfNativeExport.drawInstanceOnPage(page, { x: 20, y: 180 }, { ...common, shape: 'star', width: 50, height: 50 }, '星', jpFont);
    PdfNativeExport.drawInstanceOnPage(
        page,
        { x: 40, y: 80, width: 200, height: 40 },
        {
            ...common,
            shape: 'line',
            width: 200,
            height: 40,
            startCap: 'circle',
            endCap: 'arrow',
            capSize: 8,
            bgOpacity: 0
        },
        '線ラベル',
        jpFont
    );
    PdfNativeExport.drawInstanceOnPage(
        page,
        { x: 20, y: 20 },
        { ...common, shape: 'rectangle', width: 40, height: 20, bgOpacity: 0 },
        'WWWWWWWWWWWW',
        jpFont
    );

    const hiddenSkip = [];
    const instances = [
        { id: 1, groupId: 'g1', pageIndex: 0, isHidden: false, order: 2, x: 0, y: 0 },
        { id: 2, groupId: 'g1', pageIndex: 0, isHidden: true, order: 1, x: 0, y: 0 },
        { id: 3, groupId: 'g2', pageIndex: 0, isHidden: false, order: 0, x: 0, y: 0 },
        { id: 4, groupId: 'g1', pageIndex: 1, isHidden: false, order: 0, x: 0, y: 0 }
    ];
    const groups = [
        { id: 'g1', isHidden: false, zIndex: 1 },
        { id: 'g2', isHidden: true, zIndex: 9 }
    ];
    const pageInstances = instances.filter((inst) => inst.pageIndex === 0 && !inst.isHidden);
    pageInstances.sort((a, b) => {
        const groupA = groups.find((g) => g.id === a.groupId);
        const groupB = groups.find((g) => g.id === b.groupId);
        const zA = groupA ? groupA.zIndex || 0 : 0;
        const zB = groupB ? groupB.zIndex || 0 : 0;
        if (zA !== zB) return zA - zB;
        return a.order - b.order;
    });
    for (const instance of pageInstances) {
        const group = groups.find((g) => g.id === instance.groupId);
        if (!group || group.isHidden) continue;
        hiddenSkip.push(instance.id);
    }
    assert(hiddenSkip.length === 1 && hiddenSkip[0] === 1, '非表示インスタンス／グループは出力対象外: ' + hiddenSkip);

    const pdfBytes = await outDoc.save({ useObjectStreams: false });
    const raw = Buffer.from(pdfBytes).toString('latin1');
    const decoded = hexBlobsToAscii(raw + '\n' + decodePdfStreams(raw));

    assert(decoded.includes('BASE_PAGE_CONTENT'), '元ページのテキストが残っている');
    assert(decoded.includes('Helvetica'), '元ページの Helvetica が残っている');
    assert(!decoded.includes('/Subtype /Image'), '画像XObjectを埋め込んでいない');
    assert(!raw.includes('IDAT'), 'PNGラスタ埋め込みがない');
    assert(/NotoSansJP/i.test(decoded), 'Noto Sans JP が埋め込まれている');
    assert(/\.ttf/i.test(String(PdfNativeExport.getCachedFontUrl() || '')), 'Edge 向けに TrueType を埋め込む');
    assert(/CIDFontType2|\/TrueType/.test(decoded), 'CIDFontType2 (TrueType) である');
    assert(/\s[ml]\s/.test(decoded) || / m\n/.test(decoded) || decoded.includes(' m '), 'ベクトルパス (m/l) がある');
    assert(/Tj|TJ/.test(decoded), 'テキスト演算子がある');
    assert(/\scm[\s]/.test(decoded), 'cm 変換行列がある');
    assert(/0\.\d+\s+0\s+0\s+1\s+\d/.test(decodePdfStreams(raw)), 'textScaleX < 1 の水平 cm がある');

    const outPath = join('/tmp', 'native-export-sample.pdf');
    writeFileSync(outPath, pdfBytes);
    console.log('OK font=', PdfNativeExport.getCachedFontUrl(), 'bytes=', pdfBytes.length, 'out=', outPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
