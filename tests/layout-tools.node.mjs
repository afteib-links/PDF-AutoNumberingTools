/**
 * 帳票サイズ・抽出枠・レイヤー一覧の検証（Node）
 */
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const __dirname = dirname(fileURLToPath(import.meta.url));
globalThis.PDFLib = PDFLib;
const PdfLayoutTools = require(join(__dirname, '..', 'PdfLayoutTools.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function nearly(a, b, eps) {
    return Math.abs(a - b) < (eps || 0.6);
}

async function main() {
    assert(PdfLayoutTools.PAPER_KEYS.join(',') === 'A3,A4,A5,A6,B3,B4,B5,B6,hagaki', '帳票キー');
    const a4 = PdfLayoutTools.getPaperSize('A4', false);
    assert(nearly(a4.width / a4.height, 210 / 297), 'A4縦の縦横比');
    const a4l = PdfLayoutTools.getPaperSize('A4', true);
    assert(nearly(a4l.width, a4.height) && nearly(a4l.height, a4.width), 'A4横は縦の入替');
    const hagaki = PdfLayoutTools.getPaperSize('hagaki', false);
    assert(nearly(hagaki.width / hagaki.height, 100 / 148), 'ハガキ比');

    const region = PdfLayoutTools.createCenteredRegion(1, 0, 'A4', false, 841.89, 1190.55, 0.7);
    assert(nearly(region.width / region.height, a4.width / a4.height), '中央枠は帳票比');
    assert(region.x >= 0 && region.y >= 0, '枠はページ内');

    const moved = PdfLayoutTools.moveRegion(region, 10000, -10000, 841.89, 1190.55);
    assert(moved.x + moved.width <= 841.89 + 0.2, '移動後は右端でクランプ');
    assert(moved.y >= -0.2, '移動後は下端でクランプ');

    const se = PdfLayoutTools.resizeRegion(region, 'se', 40, -10, 841.89, 1190.55);
    assert(nearly(se.width / se.height, a4.width / a4.height), '拡大後も帳票比');
    assert(se.width > region.width, 'se で幅が増える');

    const paper = PdfLayoutTools.getPaperSize('A4', false);
    const mapped = PdfLayoutTools.mapInstanceToRegion(
        { x: region.x + 10, y: region.y + 20 },
        { width: 30, height: 12, fontSize: 10, bWidth: 1, capSize: 4, shape: 'rectangle' },
        region,
        paper
    );
    assert(nearly(mapped.instance.x, 10 * (paper.width / region.width)), '切り出し後の X');
    assert(PdfLayoutTools.rectsIntersect(region, { x: region.x + 1, y: region.y + 1, width: 5, height: 5 }), '交差');
    assert(!PdfLayoutTools.rectsIntersect(region, { x: region.x + region.width + 2, y: region.y, width: 5, height: 5 }), '非交差');

    const mockConfig = {
        getGroups() {
            return {
                a: { name: '寸法', visible: true },
                b: { name: '電気', visible: false }
            };
        },
        isVisible(g) {
            if (g && typeof g === 'object') return g.visible !== false;
            return true;
        }
    };
    const layers = PdfLayoutTools.listOptionalContentLayers(mockConfig);
    assert(layers.length === 2 && layers[0].name === '寸法', 'レイヤー名');
    assert(layers[1].visible === false, '非表示レイヤー');

    const src = await PDFLib.PDFDocument.create();
    const { StandardFonts } = PDFLib;
    const helv = await src.embedFont(StandardFonts.Helvetica);
    const srcPage = src.addPage([200, 200]);
    srcPage.drawText('SRC', { x: 20, y: 160, size: 12, font: helv });
    const srcBytes = await src.save();
    const srcLoaded = await PDFLib.PDFDocument.load(srcBytes);
    const out = await PDFLib.PDFDocument.create();
    const [emb] = await out.embedPdf(srcLoaded, [0]);
    const page = out.addPage([100, 141.4]);
    PdfLayoutTools.clipPageAndDrawEmbedded(
        page,
        emb,
        { x: 10, y: 20, width: 50, height: 70.7 },
        { width: 100, height: 141.4 },
        PDFLib
    );
    const bytes = await out.save({ useObjectStreams: false });
    assert(bytes.length > 100, '切り出しページを保存できる');
    const raw = Buffer.from(bytes).toString('latin1');
    assert(/\/Subtype\s*\/Form/.test(raw), '下絵は Form XObject として埋め込む');
    assert(!raw.includes('IDAT'), '切り出し下絵を PNG にしない');
    const parts = [];
    const re = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const chunk = Buffer.from(m[1], 'latin1');
        try {
            parts.push(inflateSync(chunk).toString('latin1'));
        } catch (_) {
            try {
                parts.push(inflateSync(chunk.subarray(2)).toString('latin1'));
            } catch (_) {
                parts.push(m[1]);
            }
        }
    }
    const decoded = parts.join('\n');
    assert(decoded.includes('SRC') || raw.includes('SRC'), '元ページのテキストが切り出し後も残る');

    const srcClamp = PdfLayoutTools.clampDrawImageSource(-10, -5, 40, 20, 100, 80);
    assert(srcClamp.sx === 0 && srcClamp.sy === 0, '負の切り出し原点を 0 にクランプ');
    assert(srcClamp.valid, 'クランプ後は有効');
    const oob = PdfLayoutTools.clampDrawImageSource(90, 70, 40, 40, 100, 80);
    assert(oob.sw === 10 && oob.sh === 10, 'キャンバス外は切り詰める');
    const scaled = PdfLayoutTools.scaleToFitMaxEdge(4000, 3000, 10, 8192);
    assert(scaled < 10, '巨大ラスタはスケールを落とす');
    const px = PdfLayoutTools.floorCanvasSize(100.9, 50.2);
    assert(px.width === 100 && px.height === 50, 'キャンバスは整数化');

    console.log('OK layout tools');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
