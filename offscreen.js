let voices = [];
let currentUtterance = null;
let currentText = '';
let currentIndex = 0;
let currentRate = 1.0;
let currentVoice = null; // Store the SpeechSynthesisVoice object

let opencvSandboxIframe = null;
let opencvSandboxReadyPromise = null;
let opencvSandboxResolvers = {}; // To store resolve/reject for messages to sandbox

async function initOpenCVSandbox() {
    console.log('[Offscreen] initOpenCVSandbox: Starting initialization.');
    if (opencvSandboxIframe) {
        console.log('[Offscreen] initOpenCVSandbox: Iframe already exists, returning existing promise.');
        return opencvSandboxReadyPromise;
    }

    opencvSandboxIframe = document.createElement('iframe');
    opencvSandboxIframe.src = chrome.runtime.getURL('opencv_sandbox.html');
    opencvSandboxIframe.style.display = 'none';
    document.body.appendChild(opencvSandboxIframe);

    opencvSandboxReadyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('OpenCV Sandbox initialization timed out after 15 seconds.'));
        }, 15000);

        opencvSandboxResolvers['opencvReady'] = () => {
            clearTimeout(timeout);
            console.log('[Offscreen] "opencvReady" message received. Sandbox is fully initialized.');
            // Now that the sandbox is ready, send it the required data.
            opencvSandboxIframe.contentWindow.postMessage({
                action: 'initialize',
                bubbleDetectorUrl: chrome.runtime.getURL('scripts/bubble-detector.js')
            }, '*');
            resolve();
        };
    });

    // This listener primarily handles results, but also the initial 'opencvReady'
    window.addEventListener('message', (event) => {
        if (!opencvSandboxIframe || event.source !== opencvSandboxIframe.contentWindow) {
            return;
        }
        const message = event.data;
        console.log('[Offscreen] Received message from sandbox:', message);

        if (message.action && opencvSandboxResolvers[message.action]) {
            opencvSandboxResolvers[message.action](message);
        } else if (message.action === 'bubbleDetectionResult' && opencvSandboxResolvers.processImageForBubbles) {
            opencvSandboxResolvers.processImageForBubbles.resolve(message);
        } else if (message.action === 'imagePreprocessed' && opencvSandboxResolvers.imagePreprocessed) {
            opencvSandboxResolvers.imagePreprocessed(message);
        } else if (message.action === 'error' && opencvSandboxResolvers.processImageForBubbles) {
            console.error('[Offscreen] Received error from sandbox:', message.error);
            opencvSandboxResolvers.processImageForBubbles.reject(new Error(message.error));
        }
    });
    
    console.log('[Offscreen] initOpenCVSandbox: Initialization setup complete. Waiting for opencvReady message.');
    return opencvSandboxReadyPromise;
}

// --- PDF Parsing Logic ---
async function processPdf(pdfUrl) {
    try {
        if (typeof pdfjsLib === 'undefined') {
            console.error("pdf.js library not loaded in offscreen document.");
            throw new Error("PDF library failed to load.");
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdfjs/pdf.worker.min.js');

        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            
            // Send each page's text back to the background script
            chrome.runtime.sendMessage({
                action: 'pdfPageTextExtracted',
                pageNumber: i,
                text: pageText
            });
        }

        // Signal completion
        chrome.runtime.sendMessage({
            action: 'pdfProcessingComplete',
            totalPages: numPages
        });

    } catch (error) {
        console.error('Error processing PDF in offscreen:', error);
        chrome.runtime.sendMessage({
            action: 'pdfProcessingFailed',
            error: error.message
        });
    }
}


// Function to get voices and ensure they are loaded
function loadVoices() {
    return new Promise((resolve) => {
        // Check if voices are already loaded
        if (speechSynthesis.getVoices().length > 0) {
            voices = speechSynthesis.getVoices();
            console.log("Offscreen: Voices already available.");
            resolve(voices);
            return;
        }
        // If not, wait for the event
        console.log("Offscreen: No voices found, waiting for voiceschanged event.");
        speechSynthesis.onvoiceschanged = () => {
             console.log("Offscreen: voiceschanged event fired.");
            voices = speechSynthesis.getVoices();
            // Check again inside the handler
             if (voices.length > 0) {
                resolve(voices);
            } else {
                 console.warn("Offscreen: voiceschanged fired, but still no voices?");
                 // Potentially retry or handle error state
                 resolve([]); // Resolve with empty array if still failing
            }
        };
        // Fallback timeout in case event never fires (e.g., browser bug)
        setTimeout(() => {
             if (voices.length === 0) {
                 console.warn("Offscreen: Voice loading timed out after 3 seconds.");
                 // Try one last time
                 voices = speechSynthesis.getVoices();
                 resolve(voices); // Resolve with whatever we have (might be empty)
             }
        }, 3000); // 3 second timeout
    });
}


// Find the specific voice object based on name and lang sent from popup/background
async function findVoice(voiceDetails) {
    if (!voiceDetails || !voiceDetails.name || !voiceDetails.lang) {
        return null; // Not enough info
    }
    if (voices.length === 0) {
        console.log("Offscreen: findVoice called, but voices not loaded. Loading now...");
        await loadVoices(); // Ensure voices are loaded
        if (voices.length === 0) {
             console.error("Offscreen: Failed to load voices for findVoice.");
             return null; // Still no voices after attempting load
        }
         console.log("Offscreen: Voices loaded within findVoice.");
    }
    return voices.find(v => v.name === voiceDetails.name && v.lang === voiceDetails.lang) || null;
}

// Start or restart speech
async function speak(text, rate, voiceDetails) {
    speechSynthesis.cancel(); // Stop any current speech

    if (!text) {
        console.log("Offscreen: No text to speak.");
        currentText = '';
        currentIndex = 0;
        currentUtterance = null;
        return;
    }

    // Reset state for new speech
    currentText = text;
    currentIndex = 0;
    currentRate = rate;
    currentVoice = await findVoice(voiceDetails); // Find the voice object

    console.log(`Offscreen: Starting speak. Text length: ${currentText.length}, Rate: ${currentRate}, Voice: ${currentVoice ? currentVoice.name : 'Default'}`);

    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.rate = currentRate;

    if (currentVoice) {
        utterance.voice = currentVoice;
    } else {
        console.warn("Offscreen: Could not find requested voice, using default.");
    }

    utterance.onboundary = (event) => {
        if (event.charIndex !== undefined) {
            // --- Simpler currentIndex update ---
            currentIndex = event.charIndex; //update our internal index tracking
            //send boundary info to background
            chrome.runtime.sendMessage({action:'speechBoundary', charIndex: currentIndex});
            // console.log(`Boundary: charIndex=${event.charIndex}, Updated currentIndex to ${currentIndex}`);
        }
    };

    utterance.onend = () => {
        console.log("Offscreen: Speech finished naturally.");
        chrome.runtime.sendMessage({action:'speechStopped'}); //Tell background speech stopped
        currentUtterance = null;
        // Don't reset currentText/currentIndex here if we want potential resume later?
        // Let's keep resetting for now for simplicity on natural end.
        currentText = '';
        currentIndex = 0;
    };

    utterance.onerror = (event) => {
        // --- Ignore "interrupted" error ---
        if (event.error === 'interrupted') {
            console.log("Offscreen: Speech interrupted (expected during stop/update).");
            return; // Don't treat as a fatal error
        }
        // Log other errors
        console.error("Offscreen: SpeechSynthesis Error:", event.error);
        chrome.runtime.sendMessage({action:'speechStopped', error: event.error});//Report error
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
    console.log("Offscreen: speechSynthesis.speak() called.");
}

// Update ongoing speech with new settings
async function updateSpeechSettings(rate, voiceDetails) {
    // Check speaking state *before* doing anything else
    if (!speechSynthesis.speaking || !currentUtterance || !currentText) {
        console.log("Offscreen: Cannot update, not speaking or no current utterance/text.");
        return;
    }

    // Log state *before* making changes
    console.log(`UpdateSettings: Request received. Current index: ${currentIndex}, Speaking: ${speechSynthesis.speaking}, Utterance exists: ${!!currentUtterance}`);

    // Ensure currentIndex is within bounds of the current text
     if (currentIndex < 0 || currentIndex >= currentText.length) {
         console.warn(`UpdateSettings: Invalid currentIndex (${currentIndex}), resetting to 0.`);
         currentIndex = 0; // Reset if out of bounds
     }

    const remainingText = currentText.slice(currentIndex);
    if (!remainingText) {
        console.log("Offscreen: No remaining text to speak after slicing.");
        // Stop speech cleanly if nothing is left
        speechSynthesis.cancel();
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
        chrome.runtime.sendMessage({action:'speechStopped'});//also clear highlight
        return;
    }

    // Update target rate and voice *before* creating new utterance
    currentRate = rate;
    const newVoice = await findVoice(voiceDetails); // Find the potentially new voice

    console.log(`UpdateSettings: New Rate: ${currentRate}, New Voice: ${newVoice ? newVoice.name : 'Default'}`);

    // Create a new utterance for the remaining text
    const newUtterance = new SpeechSynthesisUtterance(remainingText);
    newUtterance.rate = currentRate;
    if (newVoice) { // Use the newly found voice
        newUtterance.voice = newVoice;
        currentVoice = newVoice; // Update the global reference
    } else if (currentVoice) { // Fallback to the previously used voice if new one not found
         console.warn("UpdateSettings: Could not find newly requested voice, reusing previous one.");
         newUtterance.voice = currentVoice;
    } else {
         console.warn("UpdateSettings: Could not find requested voice and no previous voice, using default.");
         // Let the browser use default if neither new nor previous is available
    }


    // Copy event listeners FROM THE OLD UTTERANCE IS RISKY if its state is bad.
    // Re-assign fresh listeners pointing to our handlers.
    newUtterance.onboundary = (event) => {
         if (event.charIndex !== undefined) {
             // Update based on the NEW utterance's progress
             // Need to adjust charIndex because it's relative to remainingText
             let adjustedIndex = currentIndex + event.charIndex;
             // Clamp adjustedIndex to prevent it going beyond original text length
             adjustedIndex = Math.min(adjustedIndex, currentText.length);
             // Send boundary info to background using the adjusted index
             chrome.runtime.sendMessage({
                action: 'speechBoundary',
                charIndex: adjustedIndex // Send the index relative to the original text
             });
             // Only update if it moves forward
             if(adjustedIndex > currentIndex) {
                currentIndex = adjustedIndex;
                console.log(`Boundary (Update): charIndex=${event.charIndex}, Original currentIndex=${currentIndex - event.charIndex}, Updated currentIndex to ${currentIndex}`);
             } else {
                 // console.log(`Boundary (Update): charIndex=${event.charIndex}, Adjusted index ${adjustedIndex} not greater than current ${currentIndex}. No update.`);
             }
         }
     };

    newUtterance.onend = () => {
        console.log("Offscreen: Speech finished naturally (after update).");
        chrome.runtime.sendMessage({ action: 'speechStopped' });
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    newUtterance.onerror = (event) => {
        if (event.error === 'interrupted') {
            console.log("Offscreen: Speech interrupted (expected during stop/update).");
            // DO NOT send a 'speechStopped' message here, as it's an expected interruption.
            return;
        }
        console.error("Offscreen: SpeechSynthesis Error (after update):", event.error);
        chrome.runtime.sendMessage({ action: 'speechStopped',error: event.error });
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    // --- Critical Part: Cancel OLD, Speak NEW ---
    // Update the global reference *before* speaking
    currentUtterance = newUtterance;

    // Cancel the previous utterance *before* speaking the new one
    speechSynthesis.cancel();

    // Use a tiny delay? Sometimes helps browser engines reset state.
    // await new Promise(resolve => setTimeout(resolve, 50)); // Optional: Test if needed

    // Speak the new utterance
    speechSynthesis.speak(newUtterance);
    console.log("Offscreen: Speech settings updated, speaking remaining text.");
}

// Stop speech
function stop() {
    console.log("Offscreen: Stopping speech.");
    speechSynthesis.cancel(); // This will trigger onerror('interrupted') which sends speechStopped
    // Clear state on explicit stop
    currentUtterance = null;
    currentText = '';
    currentIndex = 0;
    // Send stop message immediately as well
    chrome.runtime.sendMessage({ action: 'speechStopped' });
}

// Helper function to convert a data URL to a Uint8Array
async function imageUrlToUint8Array(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

// --- OCR and Speech ---
// This function has been completely rewritten to manually manage the Tesseract worker,
// bypassing the buggy Tesseract.createWorker() in a Manifest V3 environment.
async function recognizeAndSpeak(imageUrl, rate, voiceDetails, returnOcrResult = false) {
    console.log('[Offscreen] Starting OCR process. Delegating preprocessing to sandbox.');
    let worker;

    try {
        // 1. Initialize the sandbox and wait for it to be ready
        await initOpenCVSandbox();
        console.log('[Offscreen] Sandbox is ready. Sending image for preprocessing.');

        // 2. Send the image to the sandbox for preprocessing and wait for the result
        const preprocessPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Image preprocessing timed out.')), 15000);
            
            opencvSandboxResolvers.imagePreprocessed = (message) => {
                clearTimeout(timeout);
                resolve(message.processedImageUrl);
            };
            
            opencvSandboxIframe.contentWindow.postMessage({
                action: 'preprocessImageForOCR',
                imageUrl: imageUrl
            }, '*');
        });

        const processedImageUrl = await preprocessPromise;
        console.log('[Offscreen] Received preprocessed image from sandbox.');

        if (!processedImageUrl) {
            throw new Error('Sandbox did not return a preprocessed image.');
        }

        // 3. Now, proceed with Tesseract OCR using the processed image
        const workerPath = chrome.runtime.getURL('libs/worker.min.js');
        worker = new Worker(workerPath);

        const doWork = (payload) => new Promise((resolve, reject) => {
            const jobId = `job-${Math.random()}`;
            worker.onerror = (err) => reject(err);
            worker.onmessage = (e) => {
                const { jobId: resJobId, status, data } = e.data;
                if (resJobId === jobId) {
                    if (status === 'resolve') resolve(data);
                    else if (status === 'reject') reject(data);
                    else if (status === 'progress') console.log(`[Tesseract] ${data.status}: ${Math.round(data.progress * 100)}%`);
                }
            };
            worker.postMessage({ workerId: 'manual', jobId, action: payload.action, payload: payload.payload });
        });

        await doWork({ action: 'load', payload: { options: { corePath: chrome.runtime.getURL('libs/tesseract-core.wasm.js'), workerPath } } });
        await doWork({ action: 'loadLanguage', payload: { langs: 'eng', options: { langPath: chrome.runtime.getURL('libs/'), gzip: true } } });
        await doWork({ action: 'initialize', payload: { langs: 'eng', oem: 1 } });

        console.log('[Offscreen] Sending "recognize" message to Tesseract worker.');
        const { text } = await doWork({
            action: 'recognize',
            payload: { image: processedImageUrl, options: { tessedit_pageseg_mode: 3 } }
        });

        console.log('[Offscreen] Tesseract recognized text:', text);

        if (returnOcrResult) {
            chrome.runtime.sendMessage({ action: 'ocrResult', text: text });
        } else if (text && text.trim().length > 0) {
            speak(text, rate, voiceDetails);
        } else {
            chrome.runtime.sendMessage({ action: 'speechStopped' });
        }

    } catch (error) {
        console.error('[Offscreen] Error during OCR process:', error);
        if (returnOcrResult) {
            chrome.runtime.sendMessage({ action: 'ocrResult', text: '' });
        } else {
            chrome.runtime.sendMessage({ action: 'speechStopped', error: error.message || 'Unknown error' });
        }
    } finally {
        if (worker) {
            worker.terminate();
        }
    }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only process messages meant for the offscreen document
    if (message.target !== 'offscreen') {
        return;
    }

    console.log("Offscreen received message:", message);
    switch (message.action) {
        case 'speak':
            (async () => {
                try {
                    await speak(message.text, message.rate, message.voice);
                    sendResponse({ success: true });
                } catch (err) {
                    console.error("Offscreen: Error during speak:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // Indicate async response

        case 'stop':
            stop();
            sendResponse({ success: true });
            return false; // Synchronous

        case 'updateSettings':
            (async () => {
                try {
                    await updateSpeechSettings(message.rate, message.voice);
                    sendResponse({ success: true });
                } catch (err) {
                    console.error("Offscreen: Error during updateSettings:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // Indicate async response

        case 'processPdf':
            processPdf(message.url);
            sendResponse({ success: true });
            return false; // It will send messages back as it processes
        
        case 'readImageText':
            recognizeAndSpeak(message.imageUrl, message.rate, message.voice, message.returnOcrResult);
            sendResponse({ success: true });
            return false;

        case 'findBubblesAndCrop':
            findBubblesAndCrop(message.imageUrl);
            sendResponse({ success: true });
            return false;

        default:
            console.warn("Offscreen: Unknown message action:", message.action);
            sendResponse({ success: false, error: "Unknown action" });
            return false; // Synchronous
    }
});

async function findBubblesAndCrop(imageUrl) {
    console.log('[Offscreen] findBubblesAndCrop: Function called.');
    try {
        console.log('[Offscreen] findBubblesAndCrop: Awaiting sandbox initialization...');
        await initOpenCVSandbox();
        console.log('[Offscreen] findBubblesAndCrop: Sandbox initialized successfully.');

        if (!imageUrl || typeof imageUrl !== 'string') {
            throw new Error('Invalid imageUrl provided');
        }
        
        // Fetch the image here and create an ImageBitmap
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        console.log('[Offscreen] findBubblesAndCrop: Sending "processImageForBubbles" message to sandbox with ImageBitmap.');
        const processBubblesPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Bubble detection timed out.')), 20000);

            opencvSandboxResolvers.processImageForBubbles = {
                resolve: (result) => { clearTimeout(timeout); resolve(result); },
                reject: (error) => { clearTimeout(timeout); reject(error); }
            };
            
            // Post the message and transfer the ImageBitmap to avoid copying
            opencvSandboxIframe.contentWindow.postMessage({
                action: 'processImageForBubbles',
                imageBitmap: imageBitmap
            }, '*', [imageBitmap]);
        });

        const { imageUrls: bubbleImages } = await processBubblesPromise;

        console.log(`[Offscreen] Detected and cropped ${bubbleImages.length} bubbles.`);

        if (bubbleImages.length === 0) {
            console.log('[Offscreen] No bubbles found, falling back to original image.');
            chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: [imageUrl] });
            return;
        }

        chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: bubbleImages });

    } catch (error) {
        console.error('[Offscreen] Error during bubble detection process:', error);
        chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: [imageUrl] });
    }
}

// Initial load of voices when the script starts
loadVoices().then((loadedVoices) => {
    console.log("Offscreen: Voices loaded initially.", loadedVoices.length);
}).catch(err => {
     console.error("Offscreen: Initial voice load failed:", err);
});
