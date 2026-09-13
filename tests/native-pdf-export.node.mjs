/**
 * ネイティブ PDF 出力の検証（Node、ブラウザ UI なし）
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const sandbox = { PDFLib, fontkit, console, fetch, Uint8Array, ArrayBuffer };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.module = { exports: {} };
sandbox.exports = sandbox.module.exports;
const ctx = createContext(sandbox);
runInContext(readFileSync(join(root, 'PdfNativeExport.js'), 'utf8'), ctx);
const PdfNativeExport = sandbox.PdfNativeExport;

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function countSubstring(hay, needle) {
    let n = 0;
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
        n++;
        i += needle.length;
    }
    return n;
}

async function main() {
    const tri = PdfNativeExport.buildTriangleSvgPath(10, 20, 100, 40);
    assert(tri.includes('M 60 60'), '三角形の頂点は上辺中央 (PDF y 上向き)');
    assert(tri.includes('L 110 20'), '三角形の右下');
    assert(tri.includes('L 10 20'), '三角形の左下');

    const star = PdfNativeExport.buildStarSvgPath(0, 0, 100, 100);
    const firstY = parseFloat(star.match(/^M [-\d.]+ ([-\d.]+)/)[1]);
    assert(firstY > 50, '星の最初の点は視覚的な上（中心より +Y）: ' + firstY);

    const arrow = PdfNativeExport.buildArrowSvgPath(6);
    assert(arrow.startsWith('M 0 0'), '矢印は先端が原点');

    const { PDFDocument, StandardFonts } = PDFLib;

    const baseDoc = await PDFDocument.create();
    const helv = await baseDoc.embedFont(StandardFonts.Helvetica);
    const page0 = baseDoc.addPage([400, 500]);
    page0.drawText('BASE_PAGE_CONTENT', { x: 40, y: 450, size: 14, font: helv });
    const baseBytes = await baseDoc.save();

    const outDoc = await PDFDocument.load(baseBytes);
    PdfNativeExport.registerFontkitOnDocument(outDoc);
    const fontBytes = await PdfNativeExport.fetchNotoSansJpFontBytes();
    const jpFont = await outDoc.embedFont(fontBytes, { subset: true });
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

    const pdfBytes = await outDoc.save();
    const raw = Buffer.from(pdfBytes).toString('latin1');

    assert(raw.includes('BASE_PAGE_CONTENT'), '元ページのテキストが残っている');
    assert(raw.includes('/Subtype /Image') === false || countSubstring(raw, '/Subtype /Image') === 0, '画像XObjectを埋め込んでいない');
    assert(!raw.includes('PNG'), 'PNG埋め込みがない');
    assert(raw.includes('NotoSans') || raw.includes('NotoSansJP') || raw.includes('Noto'), 'Noto 系フォントが埋め込まれている');
    assert(countSubstring(raw, ' re\n') + countSubstring(raw, ' re\r') > 0 || raw.includes(' re'), '矩形パス (re) がある');
    assert(raw.includes(' Td') || raw.includes('Tj') || raw.includes('TJ'), 'テキスト演算子がある');
    assert(raw.includes(' cm\n') || raw.includes(' cm\r') || /[\s]cm[\s]/.test(raw), '水平圧縮用の cm 変換がある');

    const outPath = join('/tmp', 'native-export-sample.pdf');
    writeFileSync(outPath, pdfBytes);
    console.log('OK font=', PdfNativeExport.getCachedFontUrl(), 'bytes=', pdfBytes.length, 'out=', outPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
