// Function to get selected text
function getSelectedText() {
  const text = window.getSelection().toString().trim();
  // If text is selected, return it directly. Otherwise, get all visible text.
  return text ? text : getVisibleText();
}

// Fallback to get all visible text on the page if no text is selected
function getVisibleText() {
  // Consider a more robust selector or method if needed
  const elements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div, li, td, th, article, main, section');
  let visibleText = '';
  const MAX_LENGTH = 10000; // Limit extracted text length to prevent performance issues

  for (const el of elements) {
      // Check if element is visible (basic check)
      if (el.offsetParent !== null && !el.closest('nav, header, footer, script, style, noscript')) {
          const textContent = el.textContent?.trim();
          if (textContent) {
            visibleText += textContent + ' ';
          }
      }
      if (visibleText.length > MAX_LENGTH) {
          console.warn("Content Script: Truncating visible text due to length limit.");
          break; // Stop processing if too long
      }
  }
  return visibleText.trim();
}

// --- Tesseract OCR Setup ---
let worker = null; // Make worker accessible in the listener scope
let tesseractReady = false;
let tesseractInitializing = false;

// Function to initialize Tesseract worker
async function initializeTesseract() {
    // Prevent multiple initializations
    if (tesseractReady || tesseractInitializing) {
        console.log("Tesseract: Already ready or initializing.");
        return worker;
    }
    tesseractInitializing = true;
    console.log('Tesseract: Initializing...');

    // Ensure Tesseract library is loaded
    if (typeof Tesseract === 'undefined') {
        console.error('Tesseract library is not defined. Ensure tesseract.min.js is loaded.');
        tesseractInitializing = false;
        return null;
    }

    try {
        const { createWorker } = Tesseract;
        // Construct full URLs for resources needed by the worker
        const corePath = chrome.runtime.getURL('libs/tesseract-core.wasm');
        const langPath = chrome.runtime.getURL('libs/tessdata'); // Path to the *directory*
        // Note: workerPath might not be strictly needed if tesseract.min.js is already loaded globally,
        // but specifying it can sometimes help resolve worker loading issues.
        // const workerPath = chrome.runtime.getURL('libs/tesseract.min.js'); // Usually not needed here

        console.log(`Tesseract paths: core=${corePath}, lang=${langPath}`);


        worker = await createWorker({
             logger: m => console.log(`Tesseract Log: ${m.status} (${(m.progress * 100).toFixed(2)}%)`),
             // Explicitly provide paths using chrome.runtime.getURL
             corePath: corePath,
             langPath: langPath,
             // workerPath: workerPath, // Often not needed if loaded via content_scripts
        });

        console.log("Tesseract: Worker created. Loading language...");
        await worker.loadLanguage('eng');
        console.log("Tesseract: Language loaded. Initializing...");
        await worker.initialize('eng');
        console.log('Tesseract initialized successfully');
        tesseractReady = true;
        tesseractInitializing = false;
        return worker;
    } catch (err) {
        console.error('Tesseract initialization failed:', err);
        tesseractReady = false;
        tesseractInitializing = false;
        worker = null; // Reset worker on failure
        return null;
    }
}

// Initialize Tesseract when the script loads (or lazily when needed)
// initializeTesseract(); // Option 1: Initialize eagerly
// Option 2 (lazy): Will initialize on first OCR request below

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => { // Wrap in async IIFE to use await
        try {
            if (request.action === 'getText') {
                const text = getSelectedText();
                 console.log("Content Script: Sending text:", text.substring(0,100)+"...");
                sendResponse({ text: text });

            } else if (request.action === 'extractImageText') {
                 console.log("Content Script: Received extractImageText request.");
                // Ensure Tesseract is initialized (Lazy initialization)
                if (!worker && !tesseractInitializing) {
                    await initializeTesseract();
                } else if (tesseractInitializing) {
                     console.log("Content Script: Waiting for Tesseract initialization...");
                     // Basic wait loop (better with Promises/events if complex)
                     while(tesseractInitializing) {
                         await new Promise(resolve => setTimeout(resolve, 100));
                     }
                     console.log("Content Script: Tesseract initialized, proceeding.");
                }


                if (!worker || !tesseractReady) {
                     console.error("Content Script: Tesseract worker not available for OCR.");
                    sendResponse({ error: "OCR engine not ready. Please try again." });
                    return; // Exit early
                }

                const images = document.querySelectorAll('img');
                console.log(`Content Script: Found ${images.length} images.`);
                const textPromises = [];

                for (const img of images) {
                     // Basic visibility and size check
                    if (!img.complete || img.naturalWidth < 50 || img.naturalHeight < 50 || img.offsetParent === null) {
                         // console.log("Content Script: Skipping small, incomplete, or hidden image:", img.src);
                        continue;
                    }

                    // Use a try-catch for canvas operations which can fail (e.g., CORS)
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        // Draw image onto canvas - this can throw CORS errors
                        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

                        // Get data URL - this can also fail for tainted canvases
                        const dataURL = canvas.toDataURL('image/png'); // Specify format

                        // Add promise to recognize text
                        textPromises.push(
                            worker.recognize(dataURL, 'eng')
                                .then(result => {
                                     console.log("Content Script: OCR Result for image:", img.src.substring(0,50)+"...", result.data.text.substring(0,50)+"...");
                                    return result.data.text;
                                })
                                .catch(error => {
                                    console.error('Content Script: OCR Error for image:', img.src, error);
                                    return ''; // Return empty string on error for this image
                                })
                        );
                    } catch (canvasError) {
                        console.warn('Content Script: Skipping image due to canvas error (likely CORS):', img.src, canvasError);
                         // If drawImage or toDataURL fails, skip this image
                        continue;
                    }
                } // End image loop


                const results = await Promise.all(textPromises);
                const combinedText = results.filter(Boolean).join(' \n\n '); // Add spacing between results
                 console.log("Content Script: Sending combined OCR text:", combinedText.substring(0,100)+"...");
                sendResponse({ text: combinedText });

            } else {
                console.log("Content Script: Unknown action", request.action);
            }

        } catch (error) {
            console.error("Content Script: Error processing message:", request.action, error);
            sendResponse({ error: error.message });
        }
    })(); // Immediately invoke the async function

    return true; // Indicate asynchronous response handling
});