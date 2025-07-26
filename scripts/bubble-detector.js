/**
 * Finds speech bubbles in an image using OpenCV.js.
 * @param {cv.Mat} src - The source image Mat.
 * @param {number} imageWidth - The width of the original image.
 * @param {number} imageHeight - The height of the original image.
 * @returns {Array<object>} An array of bounding boxes {minX, minY, maxX, maxY}.
 */
export function findBubbles(src, imageWidth, imageHeight) {
    if (typeof cv === 'undefined' || !src) {
        console.error("OpenCV.js is not loaded or src Mat is invalid.");
        return [];
    }
    
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const bw = new cv.Mat();
    // Adaptive thresholding to handle varying lighting conditions
    cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 5);

    // Morphological closing to fill small gaps in bubble outlines
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, kernel);
    kernel.delete();

    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    const numLabels = cv.connectedComponentsWithStats(bw, labels, stats, centroids, 8, cv.CV_32S);

    const bubbles = [];
    // Start from 1 to skip the background label
    for (let i = 1; i < numLabels; ++i) {
        const area = stats.data32S[i * 5 + cv.CC_STAT_AREA];
        const x = stats.data32S[i * 5 + cv.CC_STAT_LEFT];
        const y = stats.data32S[i * 5 + cv.CC_STAT_TOP];
        const w = stats.data32S[i * 5 + cv.CC_STAT_WIDTH];
        const h = stats.data32S[i * 5 + cv.CC_STAT_HEIGHT];

        // Filter based on area and aspect ratio
        // These values might need tuning based on typical comic bubble sizes
        if (area > 1000 && area < (imageWidth * imageHeight) / 2) { // Avoid very small noise and very large regions (e.g., entire panel)
            const aspectRatio = w / h;
            if (aspectRatio > 0.2 && aspectRatio < 5.0) { // Typical bubble aspect ratios
                bubbles.push({ minX: x, minY: y, maxX: x + w, maxY: y + h });
            }
        }
    }

    // Clean up Mats
    gray.delete();
    bw.delete();
    labels.delete();
    stats.delete();
    centroids.delete();

    return bubbles;
}