console.log("OpenCV Sandbox JS: Script loaded.");

let bubbleDetectorUrl = null;

// Wait for OpenCV.js to be fully loaded
self.Module = {
    onRuntimeInitialized: function() {
        console.log("OpenCV.js initialization complete. Setting up message listener and signaling ready.");
        window.cv = self.cv;

        // Signal that the sandbox and OpenCV are fully ready
        window.parent.postMessage({ action: 'opencvReady' }, '*');

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
                    const { findBubbles } = await import(bubbleDetectorUrl);

                    const canvas = document.getElementById('processingCanvas');
                    canvas.width = imageBitmap.width;
                    canvas.height = imageBitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(imageBitmap, 0, 0);

                    const src = cv.imread(canvas);
                    const bubbles = await findBubbles(src, canvas.width, canvas.height);
                    const croppedImageUrls = [];

                    for (const bubble of bubbles) {
                        const rect = new cv.Rect(bubble.minX, bubble.minY, bubble.maxX - bubble.minX, bubble.maxY - bubble.minY);
                        const croppedMat = src.roi(rect);

                        const cropCanvas = new OffscreenCanvas(croppedMat.cols, croppedMat.rows);
                        cv.imshow(cropCanvas, croppedMat);
                        const croppedBlob = await cropCanvas.convertToBlob();
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => reader.error ? reject(reader.error) : resolve(reader.result);
                            reader.readAsDataURL(croppedBlob);
                        });
                        croppedImageUrls.push(dataUrl);
                        croppedMat.delete();
                    }
                    src.delete();

                    window.parent.postMessage({ action: 'bubbleDetectionResult', imageUrls: croppedImageUrls }, '*');

                } else if (message.action === 'preprocessImageForOCR') {
                    const { imageBitmap } = message;
                    
                    const canvas = document.getElementById('processingCanvas');
                    canvas.width = imageBitmap.width;
                    canvas.height = imageBitmap.height;
                    const ctx = canvas.getContext('2d');
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

                    const outCanvas = new OffscreenCanvas(gray.cols, gray.rows);
                    cv.imshow(outCanvas, gray);
                    const processedBlob = await outCanvas.convertToBlob();
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
};