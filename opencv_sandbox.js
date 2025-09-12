console.log("OpenCV Sandbox JS: Script loaded.");

let bubbleDetectorUrl = null;
let __initialized = false;

function finalizeInit() {
    if (__initialized) return;
    __initialized = true;
    try {
        if (typeof cv === 'undefined') throw new Error('cv not defined');
        // Ensure ORT single-thread to avoid warnings in non crossOriginIsolated contexts
        if (self.ort && self.ort.env && self.ort.env.wasm) {
            try { self.ort.env.wasm.numThreads = 1; } catch(e) {}
        }
        console.log("OpenCV.js initialization complete. Setting up message listener and signaling ready.");
        window.cv = self.cv;
        window.parent.postMessage({ action: 'opencvReady' }, '*');
        setupMessageListener();
    } catch (e) {
        console.error('Finalize init failed:', e);
    }
}

function waitForCvReady() {
    try {
        if (typeof cv !== 'undefined' && cv) {
            if (typeof cv.Mat !== 'undefined' || typeof cv.getBuildInformation === 'function') {
                return finalizeInit();
            }
            if (!cv.__initHookSet) {
                cv.__initHookSet = true;
                cv['onRuntimeInitialized'] = () => finalizeInit();
            }
        }
    } catch (e) {}
    setTimeout(waitForCvReady, 50);
}

function setupMessageListener() {
    window.addEventListener('message', async (event) => {
        const message = event.data;
        if (!message || !message.action) return;
        
        console.log("OpenCV Sandbox: Received message:", message.action);

        if (message.action === 'initialize') {
            bubbleDetectorUrl = message.bubbleDetectorUrl;
            return; // Initialization is complete
        }

        try {
            if (message.action === 'processImageForBubbles') {
                const { imageBitmap } = message;
                if (!self.ort) throw new Error('onnxruntime-web (ort) not loaded');
                const { BubbleDetector } = await import(bubbleDetectorUrl);

                const canvas = document.getElementById('processingCanvas');
                canvas.width = imageBitmap.width;
                canvas.height = imageBitmap.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(imageBitmap, 0, 0);

                const src = cv.imread(canvas);

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const detector = new BubbleDetector('models/bubble_detector.onnx');
                await detector.init();
                const boxes = await detector.detect(imgData);

                const croppedImageUrls = [];
                for (const bubble of boxes) {
                    const x = Math.max(0, Math.floor(bubble.minX));
                    const y = Math.max(0, Math.floor(bubble.minY));
                    const w = Math.max(1, Math.floor(bubble.maxX - bubble.minX));
                    const h = Math.max(1, Math.floor(bubble.maxY - bubble.minY));
                    const rect = new cv.Rect(x, y, Math.min(w, src.cols - x), Math.min(h, src.rows - y));
                    const croppedMat = src.roi(rect);

                    // Use HTMLCanvasElement for cv.imshow target
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = croppedMat.cols;
                    cropCanvas.height = croppedMat.rows;
                    cv.imshow(cropCanvas, croppedMat);
                    const croppedBlob = await new Promise((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => reader.error ? reject(reader.error) : resolve(reader.result);
                        reader.readAsDataURL(croppedBlob);
                    });
                    croppedImageUrls.push(dataUrl);
                    croppedMat.delete();
                }
                src.delete();

                window.parent.postMessage({ action: 'bubbleDetectionResult', imageUrls: croppedImageUrls, boxes }, '*');

            } else if (message.action === 'preprocessImageForOCR') {
                const { imageBitmap } = message;
                
                const canvas = document.getElementById('processingCanvas');
                canvas.width = imageBitmap.width;
                canvas.height = imageBitmap.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(imageBitmap, 0, 0);

                let src = cv.imread(canvas);
                let gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 3));
                let tophat = new cv.Mat();
                cv.morphologyEx(gray, tophat, cv.MORPH_TOPHAT, kernel);
                cv.add(gray, tophat, gray);
                kernel.delete();
                tophat.delete();

                let blurred = new cv.Mat();
                cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
                let sharpKernel = cv.matFromArray(3, 3, cv.CV_32F, [-1, -1, -1, -1, 9, -1, -1, -1, -1]);
                let sharpened = new cv.Mat();
                cv.filter2D(blurred, sharpened, cv.CV_8U, sharpKernel);
                cv.addWeighted(gray, 0.5, sharpened, 0.5, 0, gray);
                blurred.delete();
                sharpened.delete();
                sharpKernel.delete();

                cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 5);
                let smallKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
                cv.morphologyEx(gray, gray, cv.MORPH_OPEN, smallKernel);
                smallKernel.delete();

                // Use HTMLCanvasElement for output
                const outCanvas = document.createElement('canvas');
                outCanvas.width = gray.cols;
                outCanvas.height = gray.rows;
                cv.imshow(outCanvas, gray);
                const processedBlob = await new Promise((resolve) => outCanvas.toBlob(resolve, 'image/png'));
                const processedImageUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(processedBlob);
                });

                src.delete();
                gray.delete();

                window.parent.postMessage({ action: 'imagePreprocessed', processedImageUrl: processedImageUrl }, '*');
            }
        } catch (error) {
            console.error("OpenCV Sandbox: Error processing image:", error);
            window.parent.postMessage({
                action: 'error',
                originalAction: message.action,
                error: error.message || 'Unknown error occurred'
            }, '*');
        }
    });
}

// Kick off readiness watcher
waitForCvReady();