// This script runs in the main world (the page's context)

// Listen for messages from the content script
window.addEventListener('message', async (event) => {
    // We only accept messages from ourselves
    if (event.source !== window || !event.data) {
        return;
    }

    const { type, imageUrl, nonce } = event.data;

    if (type === 'PERFORM_OCR') {
        if (!imageUrl) return;

        try {
            // Tesseract is available in this context because tesseract.min.js was also injected.
            const result = await Tesseract.recognize(imageUrl, 'eng');
            // Send the result back to the content script
            window.postMessage({
                type: 'OCR_RESULT',
                text: result.data.text,
                nonce: nonce // Include nonce to match request/response
            }, '*');
        } catch (error) {
            console.error('Tesseract Bridge Error:', error);
            window.postMessage({
                type: 'OCR_ERROR',
                error: error.message,
                nonce: nonce
            }, '*');
        }
    }
}, false);
