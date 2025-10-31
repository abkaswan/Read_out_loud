let voices = [];
let currentUtterance = null;
let currentText = '';
let currentIndex = 0;
let currentRate = 1.0;
let currentVoice = null; // Store the SpeechSynthesisVoice object

// --- PP-OCR Diagnostics and Feature Flags ---
const PPOCR_FLAGS = {
    enabled: true,   // Feature flag to gate PP-OCR path later
    debug: true,     // Verbose logs
    fallbackTesseract: false, // Try Tesseract when PP-OCR returns no text (boxes>0)
    recognizerMode: 'ppocr' // 'ppocr' | 'tesseract' | 'hybrid'
};
function ppocrLog(...a) { if (PPOCR_FLAGS.debug) console.log('[Offscreen][PP-OCR]', ...a); }

// Quick quality heuristic: prefer mostly alphabetic content with reasonable length
function evaluateLinesQuality(lines) {
    const text = Array.isArray(lines) ? lines.join(' ').trim() : (lines || '').toString();
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const digits = (text.match(/[0-9]/g) || []).length;
    const symbols = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
    const total = letters + digits + symbols;
    const alphaRatio = total > 0 ? (letters / total) : 0;
    const length = text.length;
    return { text, letters, digits, symbols, total, alphaRatio, length };
}

async function loadPpocrFlags() {
    try {
        const stored = await chrome.storage?.local.get(['ppocr_enabled', 'debug_ppocr', 'ppocr_fallback_tesseract', 'ppocr_recognizer_mode']);
        if (typeof stored.ppocr_enabled === 'boolean') PPOCR_FLAGS.enabled = stored.ppocr_enabled;
        if (typeof stored.debug_ppocr === 'boolean') PPOCR_FLAGS.debug = stored.debug_ppocr;
        if (typeof stored.ppocr_fallback_tesseract === 'boolean') PPOCR_FLAGS.fallbackTesseract = stored.ppocr_fallback_tesseract;
        if (typeof stored.ppocr_recognizer_mode === 'string') PPOCR_FLAGS.recognizerMode = stored.ppocr_recognizer_mode;
        ppocrLog('Flags loaded', { recognizerMode: PPOCR_FLAGS.recognizerMode, fallbackTesseract: PPOCR_FLAGS.fallbackTesseract });
    } catch (e) {
        // ignore
    }
}

let ppocrEngine = null;
async function ensurePpocrEngine() {
    await loadPpocrFlags();
    if (!PPOCR_FLAGS.enabled) {
        ppocrLog('PP-OCR disabled by flag.');
        throw new Error('PP-OCR disabled');
    }
    if (!ppocrEngine) {
        ppocrLog('Creating PPOCREngine instance...');
        try {
            // Allow model overrides from storage for multilingual support
            const stored = await chrome.storage?.local.get(['ppocr_rec_model', 'ppocr_rec_dict', 'ppocr_det_model']);
            const detModelPath = (stored && stored.ppocr_det_model) || 'models/ppocr/det/en_ppocrv3_det.onnx';
            const recModelPath = (stored && stored.ppocr_rec_model) || 'models/ppocr/rec/en_ppocrv3_rec.onnx';
            const dictPath = (stored && stored.ppocr_rec_dict) || 'models/ppocr/rec/en_dict.txt';
            ppocrLog('Engine model paths:', { detModelPath, recModelPath, dictPath });
            ppocrEngine = new PPOCREngine({ detModelPath, recModelPath, dictPath, debug: PPOCR_FLAGS.debug });
        } catch (e) {
            console.error('[Offscreen][PP-OCR] Failed to create engine:', e);
            throw e;
        }
    }
    return ppocrEngine;
}

// Persistent Tesseract worker state for speed
let tessWorker = null;
let tessJobHandlers = new Map();
let tessReady = null;
function ensureTesseractWorker() {
    if (tessReady) return tessReady;
    tessReady = new Promise((resolve, reject) => {
        try {
            const workerPath = chrome.runtime.getURL('libs/worker.min.js');
            tessWorker = new Worker(workerPath);

            tessWorker.onmessage = (e) => {
                const { jobId, status, data } = e.data || {};
                if (!jobId) return;
                const handler = tessJobHandlers.get(jobId);
                if (!handler) return;
                if (status === 'resolve') { handler.resolve(data); tessJobHandlers.delete(jobId); }
                else if (status === 'reject') { handler.reject(data); tessJobHandlers.delete(jobId); }
                else if (status === 'progress') {
                    const s = (data && data.status) || 'progress';
                    const p = (data && data.progress) != null ? data.progress : 0;
                    console.log(`[Tesseract] ${s}: ${Math.round(p * 100)}%`);
                }
            };

            const send = (action, payload, transfer=[]) => new Promise((resolve2, reject2) => {
                const jobId = `job-${Math.random()}`;
                tessJobHandlers.set(jobId, { resolve: resolve2, reject: reject2 });
                tessWorker.postMessage({ workerId: 'manual', jobId, action, payload }, transfer);
            });

            (async () => {
                await send('load', { options: { 
                    corePath: chrome.runtime.getURL('libs/tesseract-core.wasm.js'),
                    workerPath,
                    logging: { debug: false, info: false, warn: false, error: false }
                } });
                await send('loadLanguage', { langs: 'eng', options: { langPath: chrome.runtime.getURL('libs/'), gzip: true } });
                await send('initialize', { langs: 'eng', oem: 1 });
                await send('setParameters', { params: { tessedit_pageseg_mode: '6' } });
                resolve({ send });
            })().catch(reject);
        } catch (err) {
            reject(err);
        }
    });
    return tessReady;
}

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
                // Use the existing onnx detector module we ship
                bubbleDetectorUrl: chrome.runtime.getURL('scripts/onnx-bubble-detector.js')
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

        if (message.action === 'opencvReady' && typeof opencvSandboxResolvers['opencvReady'] === 'function') {
            opencvSandboxResolvers['opencvReady']();
            opencvSandboxResolvers['opencvReady'] = null;
            return;
        }

        if (message.action === 'bubbleDetectionResult' && opencvSandboxResolvers.processImageForBubbles) {
            try { opencvSandboxResolvers.processImageForBubbles.resolve(message); } finally { opencvSandboxResolvers.processImageForBubbles = null; }
            return;
        }

        if (message.action === 'imagePreprocessed' && opencvSandboxResolvers.imagePreprocessed) {
            try { opencvSandboxResolvers.imagePreprocessed.resolve(message); } finally { opencvSandboxResolvers.imagePreprocessed = null; }
            return;
        }

        if (message.action === 'error') {
            console.error('[Offscreen] Received error from sandbox:', message.error);
            if (message.originalAction === 'processImageForBubbles' && opencvSandboxResolvers.processImageForBubbles) {
                try { opencvSandboxResolvers.processImageForBubbles.reject(new Error(message.error)); } finally { opencvSandboxResolvers.processImageForBubbles = null; }
            } else if (message.originalAction === 'preprocessImageForOCR' && opencvSandboxResolvers.imagePreprocessed) {
                try { opencvSandboxResolvers.imagePreprocessed.reject(new Error(message.error)); } finally { opencvSandboxResolvers.imagePreprocessed = null; }
            }
            return;
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
async function recognizeAndSpeak(imageUrl, rate, voiceDetails, returnOcrResult = false, isBubble = false) {
    console.log('[Offscreen] Starting OCR process.', isBubble ? '(bubble crop)' : '(full image)');

    try {
        let processedImageUrl = null;

        if (!isBubble) {
            // For full images, run preprocessing in the sandbox
            await initOpenCVSandbox();
            console.log('[Offscreen] Sandbox is ready. Sending image for preprocessing.');
            const fetched = await fetch(imageUrl);
            const blob = await fetched.blob();
            const imageBitmap = await createImageBitmap(blob);
            const preprocessPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (opencvSandboxResolvers.imagePreprocessed) {
                        opencvSandboxResolvers.imagePreprocessed = null;
                    }
                    reject(new Error('Image preprocessing timed out.'));
                }, 30000);
                opencvSandboxResolvers.imagePreprocessed = {
                    resolve: (message) => { clearTimeout(timeout); opencvSandboxResolvers.imagePreprocessed = null; resolve(message.processedImageUrl); },
                    reject: (err) => { clearTimeout(timeout); opencvSandboxResolvers.imagePreprocessed = null; reject(err); }
                };
                opencvSandboxIframe.contentWindow.postMessage({ action: 'preprocessImageForOCR', imageBitmap }, '*', [imageBitmap]);
            });
            processedImageUrl = await preprocessPromise;
        } else {
            // Bubble crops are already small; skip extra preprocessing for speed
            processedImageUrl = imageUrl;
        }

        if (!processedImageUrl) throw new Error('No image available for OCR');

        // Ensure Tesseract worker is ready (loaded once, reused)
        const { send } = await ensureTesseractWorker();

        console.log('[Offscreen] Sending "recognize" to Tesseract worker.');
        const imgUint8 = await imageUrlToUint8Array(processedImageUrl);
        const { text } = await send('recognize', { image: imgUint8, options: {}, output: { debug: false } }, [imgUint8.buffer]);

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
        case 'ppocrHealth':
            (async () => {
                try {
                    const engine = await ensurePpocrEngine();
                    const info = await engine.health();
                    ppocrLog('Health info:', info);
                    sendResponse({ success: true, info });
                } catch (err) {
                    console.error('[Offscreen] ppocrHealth failed:', err);
                    sendResponse({ success: false, error: err?.message });
                }
            })();
            return true;
        // --- PP-OCR controls ---
        case 'ppocrWarmup':
            (async () => {
                try {
                    const engine = await ensurePpocrEngine();
                    ppocrLog('Warmup requested...');
                    await engine.warmup();
                    sendResponse({ success: true });
                } catch (err) {
                    console.error('[Offscreen] ppocrWarmup failed:', err);
                    sendResponse({ success: false, error: err?.message });
                }
            })();
            return true;

        case 'prefetchPanel':
            (async () => {
                try {
                    const engine = await ensurePpocrEngine();
                    await engine.prefetch(message.imageUrl);
                    sendResponse({ success: true });
                } catch (err) {
                    console.error('[Offscreen] prefetchPanel failed:', err?.name || err, err?.message || '');
                    sendResponse({ success: false, error: err?.message });
                }
            })();
            return true;

        case 'recognizePanel':
            (async () => {
                try {
                    const engine = await ensurePpocrEngine();
                    // Always detect with PP-OCR
                    const { boxes, image } = await engine.detect(message.imageUrl, true);
                    let lines = [];
                    const mode = PPOCR_FLAGS.recognizerMode || 'ppocr';
                    ppocrLog('recognizePanel: using recognizer mode', mode);

                    if (mode === 'tesseract') {
                        // Recognize each detected box with Tesseract using rectangle option (no canvas)
                        if (boxes.length) {
                            const { send } = await ensureTesseractWorker();
                            const u8Full = await imageUrlToUint8Array(message.imageUrl);
                            for (const b of boxes) {
                                const w = Math.max(1, b.maxX - b.minX + 1), h = Math.max(1, b.maxY - b.minY + 1);
                                const rect = { left: b.minX, top: b.minY, width: w, height: h };
                                try {
                                    const { text } = await send('recognize', { image: u8Full, options: { rectangle: rect }, output: { debug: false } });
                                    const t = (text || '').trim();
                                    if (t) lines.push(t);
                                } catch {}
                            }
                        }
                    } else if (mode === 'hybrid') {
                        // PP-OCR first
                        const pp = await engine.recognizeBoxesPpocr(image, boxes);
                        lines = pp.lines || [];
                        const q = evaluateLinesQuality(lines);
                        const low = lines.length === 0 || q.alphaRatio < 0.5 || q.letters < 5;
                        if (low && boxes.length) {
                            const { send } = await ensureTesseractWorker();
                            const u8Full = await imageUrlToUint8Array(message.imageUrl);
                            const tessLines = [];
                            for (const b of boxes) {
                                const w = Math.max(1, b.maxX - b.minX + 1), h = Math.max(1, b.maxY - b.minY + 1);
                                const rect = { left: b.minX, top: b.minY, width: w, height: h };
                                try {
                                    const { text } = await send('recognize', { image: u8Full, options: { rectangle: rect }, output: { debug: false } });
                                    const t = (text || '').trim();
                                    if (t) tessLines.push(t);
                                } catch {}
                            }
                            const tq = evaluateLinesQuality(tessLines);
                            if (tq.letters > q.letters || tq.alphaRatio > q.alphaRatio + 0.1) {
                                lines = tessLines;
                                ppocrLog('Hybrid: chose Tesseract per-box result.');
                            } else {
                                ppocrLog('Hybrid: kept PP-OCR per-box result.');
                            }
                        }
                    } else {
                        // Default: PP-OCR per box
                        const pp = await engine.recognizeBoxesPpocr(image, boxes);
                        lines = pp.lines || [];
                    }

                    ppocrLog('RecognizePanel meta:', { boxes: boxes.length, lines: lines.length, recognizer: mode });
                    // Optional global fallback in ppocr mode
                    if (mode === 'ppocr' && PPOCR_FLAGS.fallbackTesseract) {
                        const q = evaluateLinesQuality(lines);
                        const need = (lines.length === 0 && boxes.length) || (q.alphaRatio < 0.5 || q.letters < 5);
                        if (need) {
                            try {
                                const { send } = await ensureTesseractWorker();
                                const u8 = await imageUrlToUint8Array(message.imageUrl);
                                const { text } = await send('recognize', { image: u8, options: {}, output: { debug: false } }, [u8.buffer]);
                                const t = (text || '').trim();
                                if (t) lines = [t];
                            } catch {}
                        }
                    }

                    ppocrLog('RecognizePanel result:', { linesCount: (lines||[]).length, sample: (lines||[])[0] || '' });
                    chrome.runtime.sendMessage({ action: 'panelOcrReady', imageUrl: message.imageUrl, lines, boxes });
                    sendResponse({ success: true });
                } catch (err) {
                    console.error('[Offscreen] recognizePanel failed:', err?.name || err, err?.message || '');
                    sendResponse({ success: false, error: err?.message });
                }
            })();
            return true;
        case 'ppocrSetRecognizerMode':
            // Immediate in-memory switch from popup; still persisted in storage there
            if (typeof message.mode === 'string') {
                PPOCR_FLAGS.recognizerMode = message.mode;
                ppocrLog('Recognizer mode updated via message:', message.mode);
                sendResponse({ success: true });
                return false;
            } else {
                sendResponse({ success: false, error: 'Invalid mode' });
                return false;
            }

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
            recognizeAndSpeak(message.imageUrl, message.rate, message.voice, message.returnOcrResult, message.isBubble === true);
            sendResponse({ success: true });
            return false;

        case 'findBubblesAndCrop':
            findBubblesAndCrop(message.imageUrl, message.imageId);
            sendResponse({ success: true });
            return false;

        default:
            console.warn("Offscreen: Unknown message action:", message.action);
            sendResponse({ success: false, error: "Unknown action" });
            return false; // Synchronous
    }
});

async function findBubblesAndCrop(imageUrl, imageId) {
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
            const timeout = setTimeout(() => {
                if (opencvSandboxResolvers.processImageForBubbles) {
                    opencvSandboxResolvers.processImageForBubbles = null;
                }
                reject(new Error('Bubble detection timed out.'));
            }, 90000);

            opencvSandboxResolvers.processImageForBubbles = {
                resolve: (result) => { clearTimeout(timeout); opencvSandboxResolvers.processImageForBubbles = null; resolve(result); },
                reject: (error) => { clearTimeout(timeout); opencvSandboxResolvers.processImageForBubbles = null; reject(error); }
            };
            
            // Post the message and transfer the ImageBitmap to avoid copying
            opencvSandboxIframe.contentWindow.postMessage({
                action: 'processImageForBubbles',
                imageBitmap: imageBitmap
            }, '*', [imageBitmap]);
        });

        const { imageUrls: bubbleImages, boxes } = await processBubblesPromise;

        console.log(`[Offscreen] Detected and cropped ${bubbleImages.length} bubbles.`);

        if (!bubbleImages || bubbleImages.length === 0) {
            console.log('[Offscreen] No bubbles found, falling back to original image.');
            chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: [imageUrl], boxes: [], sourceImageUrl: imageUrl, imageId });
            return;
        }

        chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: bubbleImages, boxes, sourceImageUrl: imageUrl, imageId });

    } catch (error) {
        console.error('[Offscreen] Error during bubble detection process:', error);
        chrome.runtime.sendMessage({ action: 'bubbleDetectionResult', imageUrls: [imageUrl], boxes: [], sourceImageUrl: imageUrl, imageId });
    }
}

// Initial load of voices when the script starts
loadVoices().then((loadedVoices) => {
    console.log("Offscreen: Voices loaded initially.", loadedVoices.length);
}).catch(err => {
     console.error("Offscreen: Initial voice load failed:", err);
});
