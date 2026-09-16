# 同梱ライブラリ

`file://` で ZIP を直接開いたとき、Edge のトラッキング防止が CDN スクリプトのストレージを遮断し、同一 HTML を iframe として読み込もうとしてエラーになるのを避けるため、次を同梱しています。

| ファイル | 由来 |
|---|---|
| `pdf-lib.min.js` | pdf-lib 1.17.1 |
| `fontkit.umd.min.js` | @pdf-lib/fontkit 1.1.1 |
| `pdf.min.js` / `pdf.worker.min.js` | pdf.js 3.11.174 |
| `Sortable.min.js` | SortableJS 1.15.2 |

`pdf.worker.min.js` はメインスレッドでも読み込み、`file://` 固有オリジンで Worker が作れない場合に備えます。
