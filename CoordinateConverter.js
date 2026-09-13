/**
 * CoordinateConverter.js
 * PDFポイント座標 ⇄ 画面ピクセル座標 変換
 */
if (typeof window.CoordinateConverter === 'undefined') {
    window.CoordinateConverter = class CoordinateConverter {
        constructor() { 
            this.pageWidthPoints = 0; 
            this.pageHeightPoints = 0; 
            this.canvasWidthPixels = 0; 
            this.canvasHeightPixels = 0; 
            this.zoomLevel = 1.0; 
            this.containerElement = null; 
            this.ptToPxRatio = 1.0; 
        }

        setPageContext(ptW, ptH, container) { 
            this.pageWidthPoints = ptW; 
            this.pageHeightPoints = ptH; 
            this.containerElement = container; 
            this.canvasWidthPixels = this.pageWidthPoints * this.ptToPxRatio; 
            this.canvasHeightPixels = this.pageHeightPoints * this.ptToPxRatio; 
        }

        setZoom(level) { 
            this.zoomLevel = level; 
        }

        screenPixelsToPdfPoints(screenX, screenY, ptW = 0, ptH = 0, isLine = false) {
            const pxX = screenX / this.zoomLevel;
            const pxY = screenY / this.zoomLevel;
            const ptX = pxX / this.ptToPxRatio;
            const ptY = pxY / this.ptToPxRatio;
            
            if (isLine) {
                return { x: ptX, y: this.pageHeightPoints - ptY };
            }
            return { x: ptX, y: this.pageHeightPoints - ptY - ptH };
        }

        pdfPointsToScreenPixels(pdfX, pdfY, ptW = 0, ptH = 0, isLine = false) {
            const ptX = pdfX;
            let ptY;
            if (isLine) {
                ptY = this.pageHeightPoints - pdfY;
                return { 
                    x: ptX * this.zoomLevel, 
                    y: ptY * this.zoomLevel, 
                    width: ptW * this.zoomLevel, 
                    height: -ptH * this.zoomLevel 
                };
            } else {
                ptY = this.pageHeightPoints - (pdfY + ptH);
                return { 
                    x: ptX * this.zoomLevel, 
                    y: ptY * this.zoomLevel, 
                    width: ptW * this.zoomLevel, 
                    height: ptH * this.zoomLevel 
                };
            }
        }
    };
}
