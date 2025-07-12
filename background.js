const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenDocument = null; // Promise
let activeSpeechTabId = null; // <--- STORE THE TAB ID FOR CURRENT SPEECH
let lastVoice = null;
let lastRate = 1.0;

// --- PDF Reading State ---
let pdfState = {
    url: null,
    text_pages: [],
    currentPage: 0,
    isPlaying: false
};


// --- Offscreen Document Management ---

// Function to check if an offscreen document exists
async function hasOffscreenDocument() {
    const matchedClients = await clients.matchAll();
    return matchedClients.some(
        (c) => c.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
    );
}


// Function to create the offscreen document
async function setupOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        if (creatingOffscreenDocument) {
            await creatingOffscreenDocument;
        } else {
            creatingOffscreenDocument = chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
                justification: 'Needed for text-to-speech and PDF processing',
            });
            await creatingOffscreenDocument;
            creatingOffscreenDocument = null;
        }
         console.log("Background: Offscreen document created.");
    } else {
         console.log("Background: Offscreen document already exists.");
    }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isFromOffscreen = sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

    if (isFromOffscreen) {
        // Handle messages FROM Offscreen
        switch (message.action) {
            case 'speechBoundary':
                if (activeSpeechTabId !== null) {
                    chrome.tabs.sendMessage(activeSpeechTabId, {
                        action: 'highlightCharacterIndex',
                        charIndex: message.charIndex
                    }).catch(err => {
                         console.warn(`Background: Failed to send highlight to tab ${activeSpeechTabId}: ${err.message}. Clearing tab ID.`);
                         clearActiveSpeechTab();
                    });
                }
                break;
            case 'speechStopped':
                 console.log("Background: Received speechStopped from offscreen.", message.error ? `Error: ${message.error}` : "");
                 clearActiveSpeechTab();
                 chrome.runtime.sendMessage({ action: 'speechStopped' }).catch(err => console.warn("Could not inform popup of speech stop:", err.message));
                break;
            
            // PDF processing messages from offscreen
            case 'pdfPageTextExtracted':
                pdfState.text_pages[message.pageNumber - 1] = message.text;
                // Optional: Could add more granular progress here if needed
                break;
            case 'pdfProcessingComplete':
                chrome.runtime.sendMessage({
                    action: 'pdfProcessingComplete',
                    totalPages: message.totalPages
                });
                break;
            case 'pdfProcessingFailed':
                chrome.runtime.sendMessage({
                    action: 'pdfProcessingFailed',
                    error: message.error
                });
                handleStopPdfReading(); // Clean up
                break;

             default:
                 console.warn("Background: Received unknown message action from Offscreen:", message.action);
        }
    } else {
        // Handle messages FROM Popup or Content Script
        switch (message.action) {
            case 'startReading':
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs && tabs.length > 0 && tabs[0].id) {
                        activeSpeechTabId = tabs[0].id;
                        lastVoice = message.voice;
                        lastRate = message.rate;
                        handleStartReading(message.text, message.rate, message.voice);
                        sendResponse({ success: true });
                    } else {
                        console.error("Background: Could not get active tab ID for startReading.");
                        activeSpeechTabId = null;
                        sendResponse({ success: false, error: "Could not identify active tab" });
                    }
                });
                return true;

            case 'stopReading':
                handleStopReading();
                sendResponse({ success: true });
                break;

            case 'updateSpeechSettings':
                handleUpdateSettings(message.rate, message.voice);
                sendResponse({ success: true });
                break;

            case 'getUiState':
                sendResponse({ isPlaying: activeSpeechTabId !== null, voice: lastVoice, rate: lastRate });
                break;

            case 'refreshState':
                handleStopReading();
                handleStopPdfReading();
                lastVoice = null;
                lastRate = 1.0;
                sendResponse({ success: true });
                break;

            // --- PDF Actions ---
            case 'readPdf':
                handleReadPdf(message.url);
                sendResponse({ success: true });
                break;
            case 'togglePdfPlayPause':
                handleTogglePdfPlayPause();
                sendResponse({ success: true });
                break;
            case 'pdfPrevPage':
                handleChangePdfPage(pdfState.currentPage - 1);
                sendResponse({ success: true });
                break;
            case 'pdfNextPage':
                handleChangePdfPage(pdfState.currentPage + 1);
                sendResponse({ success: true });
                break;
            case 'stopPdfReading':
                handleStopPdfReading();
                sendResponse({ success: true });
                break;

            default:
                console.warn("Background: Received unknown message action from Popup/Content:", message.action);
                sendResponse({ success: false, error: "Unknown action" });
        }
    }
    return true; // Keep channel open for async responses
});


// --- Action Handlers ---

async function handleStartReading(text, rate, voice) {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({
        action: 'speak',
        text: text,
        rate: rate,
        voice: voice,
        target: 'offscreen'
    }).catch(err => {
        console.error("Background: Error sending 'speak' message to offscreen:", err);
        clearActiveSpeechTab();
    });
}

async function handleStopReading() {
    if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
             action: 'stop',
             target: 'offscreen'
        }).catch(err => console.error("Background: Error sending 'stop' message to offscreen:", err));
    } else {
        clearActiveSpeechTab();
    }
}

function clearActiveSpeechTab() {
    if (activeSpeechTabId !== null) {
        chrome.tabs.sendMessage(activeSpeechTabId, { action: 'clearHighlight' })
            .catch(err => console.warn(`Background: Failed to send clearHighlight to tab ${activeSpeechTabId}: ${err.message}.`));
        activeSpeechTabId = null;
    }
}

async function handleUpdateSettings(rate, voice) {
    lastRate = rate;
    lastVoice = voice;
     if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
             action: 'updateSettings',
             rate: rate,
             voice: voice,
             target: 'offscreen'
        }).catch(err => console.error("Background: Error sending 'updateSettings' message to offscreen:", err));
    }
}

// --- PDF Handling Logic ---

async function handleReadPdf(url) {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({ action: 'pdfProcessingStarted' });

    pdfState.url = url;
    pdfState.isPlaying = false;
    pdfState.currentPage = 0;
    pdfState.text_pages = [];

    chrome.runtime.sendMessage({
        action: 'processPdf',
        url: url,
        target: 'offscreen'
    });
}

function handleTogglePdfPlayPause() {
    pdfState.isPlaying = !pdfState.isPlaying;
    if (pdfState.isPlaying) {
        playCurrentPdfPage();
    } else {
        handleStopReading();
    }
}

function handleChangePdfPage(newPage) {
    if (newPage >= 0 && newPage < pdfState.text_pages.length) {
        pdfState.currentPage = newPage;
        chrome.runtime.sendMessage({ action: 'pdfPageUpdate', currentPage: newPage + 1 });
        if (pdfState.isPlaying) {
            playCurrentPdfPage();
        }
    }
}

function playCurrentPdfPage() {
    const text = pdfState.text_pages[pdfState.currentPage];
    if (text) {
        handleStartReading(text, lastRate, lastVoice);
    }
}

function handleStopPdfReading() {
    handleStopReading();
    pdfState.url = null;
    pdfState.text_pages = [];
    pdfState.currentPage = 0;
    pdfState.isPlaying = false;
}

// Helper function to send a message to the content script, injecting it if necessary.
function sendMessageToContentScript(tabId, message, callback) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
        // Check for the specific error indicating the content script is not injected.
        if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
            console.warn(`Background: Content script not found in tab ${tabId}. Attempting to inject.`);
            // Inject the content script programmatically.
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            }).then(() => {
                console.log(`Background: Injected content script into tab ${tabId}. Retrying message.`);
                // After injecting, retry sending the message.
                chrome.tabs.sendMessage(tabId, message, callback);
            }).catch(err => {
                console.error(`Background: Failed to inject content script into tab ${tabId}:`, err);
                if (callback) {
                    callback({ error: `Failed to inject script: ${err.message}` });
                }
            });
        } else {
            // If there was no error or a different error, pass the response to the callback.
            if (callback) {
                callback(response);
            }
        }
    });
}


// --- Cleanup Listeners ---
chrome.tabs.onRemoved.addListener(tabId => {
    if (tabId === activeSpeechTabId) {
        handleStopReading();
        if (pdfState.url) {
            handleStopPdfReading();
        }
    }
});

// --- Command Listener for Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command, tab) => {
    console.log(`Command received: ${command}`);
    switch (command) {
        case "toggle-play-pause":
            // Check if it's a PDF first
            if (pdfState.url && pdfState.text_pages.length > 0) {
                handleTogglePdfPlayPause();
            } else {
                // Standard web page toggle
                if (activeSpeechTabId !== null) {
                    handleStopReading();
                } else {
                    // This is the "play" part, which needs to get text from the content script
                    if (tab.id) {
                        sendMessageToContentScript(tab.id, { action: "getText" }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("Error sending getText message after injection attempt:", chrome.runtime.lastError.message);
                                return;
                            }
                            if (response && response.text && response.text.length > 0) {
                                activeSpeechTabId = tab.id; // Set active tab
                                // Use last known settings or defaults
                                handleStartReading(response.text, lastRate || 1.0, lastVoice || null);
                                // Inform the popup to update its state
                                chrome.runtime.sendMessage({ action: 'speechStarted' }).catch(e => {});
                            } else if (response && response.error) {
                                console.error("Received an error from content script:", response.error);
                            } else {
                                console.log("No text found or received to read.");
                            }
                        });
                    }
                }
            }
            break;
        case "refresh-state":
            handleStopReading();
            handleStopPdfReading();
            lastVoice = null;
            lastRate = 1.0;
            // Inform the popup to update its state
            chrome.runtime.sendMessage({ action: 'speechStopped' }).catch(e => {});
            console.log("State refreshed via command.");
            break;
        default:
            console.warn(`Unhandled command: ${command}`);
    }
});
