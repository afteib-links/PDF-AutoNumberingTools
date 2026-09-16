/**
 * index.dev.html のローカル CSS/JS を index.html にインライン化する。
 * file:// ではファイルごとに別オリジンになるため、単一 HTML にまとめる。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = join(root, 'index.dev.html');
const outPath = join(root, 'index.html');

function escapeInline(text, tag) {
    const close = '</' + tag;
    return text.replaceAll(close, '<\\/' + tag);
}

function inlineLocalAssets(html) {
    let out = html;
    out = out.replace(
        /<link\s+rel="stylesheet"\s+href="([^"]+)">/g,
        (_, href) => {
            if (/^https?:/i.test(href)) return _;
            const css = readFileSync(resolve(root, href), 'utf8');
            return '<style>\n' + escapeInline(css, 'style') + '\n</style>';
        }
    );
    out = out.replace(
        /<script\s+src="([^"]+)"><\/script>/g,
        (_, src) => {
            if (/^https?:/i.test(src)) return _;
            const js = readFileSync(resolve(root, src), 'utf8');
            return '<script>\n' + escapeInline(js, 'script') + '\n</script>';
        }
    );
    if (!out.includes('<!-- standalone-file-origin -->')) {
        out = out.replace(
            '<head>',
            '<head>\n    <!-- standalone-file-origin -->'
        );
    }
    return out;
}

const packed = inlineLocalAssets(readFileSync(srcPath, 'utf8'));
if (packed.includes('src="./vendor/') || packed.includes('href="style.css"')) {
    throw new Error('インライン化に失敗しました');
}
writeFileSync(outPath, packed);
console.log('wrote', outPath, 'bytes=', Buffer.byteLength(packed));
