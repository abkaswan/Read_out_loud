export class BubbleDetector {
    constructor(modelPath = 'models/bubble_detector.onnx') {
        this.modelPath = modelPath;
        this.session = null;
        this.modelInputShape = [1, 3, 640, 640];
        this.mean = [0, 0, 0];
        this.std = [255, 255, 255];
        this.scoreThreshold = 0.25;
        this.iouThreshold = 0.45;
    }

    async init() {
        try {
            const modelUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL(this.modelPath) : this.modelPath;
            this.session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            if (this.session && this.session.inputNames?.length) {
                console.log('[BubbleDetector] session ready. inputs:', this.session.inputNames, 'outputs:', this.session.outputNames);
            } else {
                console.log('[BubbleDetector] session ready.');
            }
        } catch (e) {
            console.error(`[BubbleDetector] Failed to create ONNX session: ${e}`);
        }
    }

    async detect(imageData) {
        if (!this.session) {
            console.error('[BubbleDetector] ONNX session is not initialized.');
            return [];
        }

        const modelW = this.modelInputShape[3];
        const modelH = this.modelInputShape[2];
        const { width, height } = imageData;

        const allBubbles = [];
        const stride = Math.floor(modelH * 0.75); // 25% overlap

        for (let y = 0; y < height; y += stride) {
            const chunkHeight = Math.min(modelH, height - y);
            if (chunkHeight < Math.floor(stride / 2) && y + chunkHeight < height) continue;

            const { tensor, meta } = this.preprocess(imageData, 0, y, width, chunkHeight);
            const inputName = this.session.inputNames[0];
            const feeds = { [inputName]: tensor };
            const results = await this.session.run(feeds);
            const bubblesInChunk = this.postprocess(results, meta);

            bubblesInChunk.forEach(b => {
                allBubbles.push({
                    ...b,
                    minY: b.minY + y,
                    maxY: b.maxY + y
                });
            });
        }

        const finalBubbles = this.nonMaxSuppression(allBubbles, this.iouThreshold);
        console.log(`[BubbleDetector] Final bubbles: ${finalBubbles.length}`);
        return finalBubbles;
    }

    preprocess(fullImageData, cropX, cropY, cropWidth, cropHeight) {
        const dstW = this.modelInputShape[3];
        const dstH = this.modelInputShape[2];

        const srcCanvas = new OffscreenCanvas(fullImageData.width, fullImageData.height);
        const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
        sctx.putImageData(fullImageData, 0, 0);

        const cropCanvas = new OffscreenCanvas(cropWidth, cropHeight);
        const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });
        cctx.drawImage(srcCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        // Letterbox fit
        const scale = Math.min(dstW / cropWidth, dstH / cropHeight);
        const newW = Math.round(cropWidth * scale);
        const newH = Math.round(cropHeight * scale);
        const dx = Math.floor((dstW - newW) / 2);
        const dy = Math.floor((dstH - newH) / 2);

        const inputCanvas = new OffscreenCanvas(dstW, dstH);
        const ictx = inputCanvas.getContext('2d', { willReadFrequently: true });
        ictx.fillStyle = '#000';
        ictx.fillRect(0, 0, dstW, dstH);
        ictx.drawImage(cropCanvas, 0, 0, cropWidth, cropHeight, dx, dy, newW, newH);

        const { data } = ictx.getImageData(0, 0, dstW, dstH);

        // HWC RGBA -> CHW float32 normalized
        const chw = new Float32Array(3 * dstH * dstW);
        for (let y = 0; y < dstH; y++) {
            for (let x = 0; x < dstW; x++) {
                const idx = (y * dstW + x) * 4;
                const r = (data[idx + 0] - this.mean[0]) / this.std[0];
                const g = (data[idx + 1] - this.mean[1]) / this.std[1];
                const b = (data[idx + 2] - this.mean[2]) / this.std[2];
                const p = y * dstW + x;
                chw[0 * dstH * dstW + p] = r;
                chw[1 * dstH * dstW + p] = g;
                chw[2 * dstH * dstW + p] = b;
            }
        }

        const tensor = new ort.Tensor('float32', chw, this.modelInputShape);
        const meta = { scale, dx, dy, iw: cropWidth, ih: cropHeight, dstW, dstH };
        return { tensor, meta };
    }

    postprocess(results, meta) {
        const { scale, dx, dy, iw, ih, dstW, dstH } = meta;
        const outName = this.session.outputNames[0];
        const output = results[outName];
        const data = output.data;
        const dims = output.dims; // Expect something like [1, 5, N] or [1, 84, N]
        const numDetections = dims[dims.length - 1];

        const bubbles = [];
        for (let i = 0; i < numDetections; i++) {
            const x_center = data[0 * numDetections + i];
            const y_center = data[1 * numDetections + i];
            const width = data[2 * numDetections + i];
            const height = data[3 * numDetections + i];
            const score = data[4 * numDetections + i];

            if (score < this.scoreThreshold) continue;

            // Undo letterbox: first in model space (dstW/dstH), remove padding then unscale
            const x_c = (x_center - dx) / scale;
            const y_c = (y_center - dy) / scale;
            const w_c = width / scale;
            const h_c = height / scale;

            const x1 = x_c - w_c / 2;
            const y1 = y_c - h_c / 2;
            const x2 = x_c + w_c / 2;
            const y2 = y_c + h_c / 2;

            bubbles.push({
                minX: Math.max(0, Math.min(iw, x1)),
                minY: Math.max(0, Math.min(ih, y1)),
                maxX: Math.max(0, Math.min(iw, x2)),
                maxY: Math.max(0, Math.min(ih, y2)),
                score
            });
        }
        return this.nonMaxSuppression(bubbles, this.iouThreshold);
    }

    calculateIoU(a, b) {
        const x1 = Math.max(a.minX, b.minX);
        const y1 = Math.max(a.minY, b.minY);
        const x2 = Math.min(a.maxX, b.maxX);
        const y2 = Math.min(a.maxY, b.maxY);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
        const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
        const union = areaA + areaB - inter + 1e-6;
        return inter / union;
    }

    nonMaxSuppression(bubbles, iouThreshold = 0.5) {
        const sorted = [...bubbles].sort((a, b) => b.score - a.score);
        const result = [];
        const suppressed = new Array(sorted.length).fill(false);

        for (let i = 0; i < sorted.length; i++) {
            if (suppressed[i]) continue;
            result.push(sorted[i]);
            for (let j = i + 1; j < sorted.length; j++) {
                if (suppressed[j]) continue;
                if (this.calculateIoU(sorted[i], sorted[j]) > iouThreshold) {
                    suppressed[j] = true;
                }
            }
        }
        return result;
    }
}
