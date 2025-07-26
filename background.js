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
    isPlaying: false,
    readingMode: 'page-by-page', // 'page-by-page' or 'continuous'
    bookmarks: []
};


// --- Offscreen Document Management ---

async function hasOffscreenDocument() {
    const matchedClients = await clients.matchAll();
    return matchedClients.some(
        (c) => c.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
    );
}

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
    }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isFromOffscreen = sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

    if (isFromOffscreen) {
        switch (message.action) {
            case 'speechBoundary':
                if (activeSpeechTabId !== null) {
                    chrome.tabs.sendMessage(activeSpeechTabId, {
                        action: 'highlightCharacterIndex',
                        charIndex: message.charIndex
                    }).catch(err => {
                         clearActiveSpeechTab();
                    });
                }
                break;
            case 'speechStopped':
                 clearActiveSpeechTab();
                 chrome.runtime.sendMessage({ action: 'speechStopped' });
                 if (pdfState.isPlaying && pdfState.readingMode === 'continuous') {
                     playNextPdfPage();
                 }
                break;
            
            case 'pdfPageTextExtracted':
                pdfState.text_pages[message.pageNumber - 1] = message.text;
                break;
            case 'pdfProcessingComplete':
                chrome.runtime.sendMessage({
                    action: 'pdfProcessingComplete',
                    totalPages: message.totalPages
                });
                break;
            case 'bubbleDetectionResult':
                console.log('[Background Script] Received bubble detection result.');
                handleReadBubbleImages(message.imageUrls);
                break;
        }
    } else {
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
                handleUpdateSettings(message.rate, message.voice, message.isPdf);
                sendResponse({ success: true });
                break;

            case 'getUiState':
                if (message.isPdf) {
                    sendResponse({
                        isPlaying: pdfState.isPlaying,
                        voice: lastVoice,
                        rate: lastRate,
                        currentPage: pdfState.currentPage + 1,
                        totalPages: pdfState.text_pages.length,
                        readingMode: pdfState.readingMode,
                        bookmarks: pdfState.bookmarks,
                        isPdf: true
                    });
                } else {
                    sendResponse({ isPlaying: activeSpeechTabId !== null, voice: lastVoice, rate: lastRate });
                }
                break;

            case 'refreshState':
                if (message.isPdf) {
                    handleStopPdfReading();
                } else {
                    handleStopReading();
                }
                sendResponse({ success: true });
                break;

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
            case 'setPdfReadingMode':
                pdfState.readingMode = message.mode;
                sendResponse({ success: true });
                break;
            case 'toggleBookmark':
                handleToggleBookmark();
                sendResponse({ success: true });
                break;
            case 'jumpToPage':
                handleChangePdfPage(message.page - 1);
                sendResponse({ success: true });
                break;
            case 'readImageText':
                console.log('[Background Script] Received image URL:', message.imageUrl);
                // Fetch the image here in the background script to bypass CORS issues in the content script.
                fetch(message.imageUrl)
                    .then(response => response.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const base64data = reader.result;
                            console.log('[Background Script] Image converted to base64. Forwarding to offscreen.');
                            setupOffscreenDocument().then(() => {
                                chrome.runtime.sendMessage({
                                    target: 'offscreen',
                                    action: 'readImageText',
                                    imageUrl: base64data,
                                    rate: lastRate || 1.0,
                                    voice: lastVoice || null
                                });
                            });
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(error => {
                        console.error('[Background Script] Error fetching image:', error);
                    });
                sendResponse({ success: true }); // Acknowledge the message immediately
                break;
            case 'readBubbleImages':
                console.log('[Background Script] Received bubble images. Starting OCR process.');
                handleReadBubbleImages(message.imageUrls);
                sendResponse({ success: true });
                break;
            case 'processImageForBubbles':
                console.log('[Background Script] Received processImageForBubbles request. Forwarding to offscreen.');
                setupOffscreenDocument().then(() => {
                    chrome.runtime.sendMessage({
                        target: 'offscreen',
                        action: 'findBubblesAndCrop',
                        imageUrl: message.imageUrl
                    });
                });
                sendResponse({ success: true });
                break;
        }
    }
    return true;
});

async function handleReadBubbleImages(imageUrls) {
    console.log(`[Background Script] Processing ${imageUrls.length} bubble images.`);
    let combinedText = '';
    for (const imageUrl of imageUrls) {
        const text = await new Promise((resolve, reject) => {
            const messageListener = (message) => {
                if (message.action === 'ocrResult') {
                    console.log('[Background Script] Received OCR result for a bubble.');
                    chrome.runtime.onMessage.removeListener(messageListener);
                    resolve(message.text);
                }
            };
            chrome.runtime.onMessage.addListener(messageListener);
            setupOffscreenDocument().then(() => {
                chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'readImageText',
                    imageUrl: imageUrl,
                    rate: lastRate || 1.0,
                    voice: lastVoice || null,
                    returnOcrResult: true // Special flag for this handler
                });
            });
        });
        if (text) {
            combinedText += text + ' ';
        }
    }
    console.log('[Background Script] All bubbles processed. Final text:', combinedText);
    handleStartReading(combinedText.trim(), lastRate, lastVoice);
}


// --- Action Handlers ---

async function handleStartReading(text, rate, voice) {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({
        action: 'speak',
        text: text,
        rate: rate,
        voice: voice,
        target: 'offscreen'
    });
}

async function handleStopReading() {
    if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
             action: 'stop',
             target: 'offscreen'
        });
    }
    clearActiveSpeechTab();
}

function clearActiveSpeechTab() {
    if (activeSpeechTabId !== null) {
        chrome.tabs.sendMessage(activeSpeechTabId, { action: 'clearHighlight' })
            .catch(err => {});
        activeSpeechTabId = null;
    }
}

async function handleUpdateSettings(rate, voice, isPdf = false) {
    lastRate = rate;
    lastVoice = voice;
     if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
             action: 'updateSettings',
             rate: rate,
             voice: voice,
             target: 'offscreen'
        });
    }
}

// --- PDF Handling Logic ---

async function handleReadPdf(url) {
    if (pdfState.url === url && pdfState.text_pages.length > 0) {
        updatePdfUi();
        return;
    }

    await setupOffscreenDocument();
    chrome.runtime.sendMessage({ action: 'pdfProcessingStarted' });

    pdfState.url = url;
    pdfState.isPlaying = false;
    pdfState.currentPage = 0;
    pdfState.text_pages = [];
    pdfState.bookmarks = [];
    pdfState.readingMode = 'page-by-page';

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
    updatePdfUi();
}

function handleChangePdfPage(newPage) {
    if (newPage >= 0 && newPage < pdfState.text_pages.length) {
        pdfState.currentPage = newPage;
        if (pdfState.isPlaying) {
            playCurrentPdfPage();
        }
        updatePdfUi();
    }
}

function playCurrentPdfPage() {
    const text = pdfState.text_pages[pdfState.currentPage];
    if (text) {
        handleStartReading(text, lastRate, lastVoice);
    }
}

function playNextPdfPage() {
    if (pdfState.currentPage < pdfState.text_pages.length - 1) {
        handleChangePdfPage(pdfState.currentPage + 1);
    } else {
        pdfState.isPlaying = false;
        updatePdfUi();
    }
}

function handleToggleBookmark() {
    const page = pdfState.currentPage + 1;
    const index = pdfState.bookmarks.indexOf(page);
    if (index > -1) {
        pdfState.bookmarks.splice(index, 1);
    } else {
        pdfState.bookmarks.push(page);
        pdfState.bookmarks.sort((a, b) => a - b);
    }
    updatePdfUi();
}

function handleStopPdfReading() {
    handleStopReading();
    pdfState.url = null;
    pdfState.text_pages = [];
    pdfState.currentPage = 0;
    pdfState.isPlaying = false;
    pdfState.bookmarks = [];
    pdfState.readingMode = 'page-by-page';
    updatePdfUi();
}

function updatePdfUi() {
    chrome.runtime.sendMessage({
        action: 'updatePdfUiState',
        state: {
            isPlaying: pdfState.isPlaying,
            currentPage: pdfState.currentPage + 1,
            totalPages: pdfState.text_pages.length,
            bookmarks: pdfState.bookmarks,
            readingMode: pdfState.readingMode
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
function isComicMode(tabId, callback) {
    sendMessageToContentScript(tabId, { action: "getComicState" }, (response) => {
        if (response && response.comicState && !response.comicState.selectionNeeded) {
            callback(true, response.comicState);
        } else {
            callback(false, null);
        }
    });
}

chrome.commands.onCommand.addListener((command, tab) => {
    switch (command) {
        case "toggle-play-pause":
            isComicMode(tab.id, (isComic, comicState) => {
                if (isComic) {
                    // Toggle comic reading
                    const action = comicState.isPlaying ? 'stopComicReading' : 'startComicReading';
                    sendMessageToContentScript(tab.id, { action: action, settings: comicState });
                } else if (pdfState.url && pdfState.text_pages.length > 0) {
                    // Toggle PDF reading
                    handleTogglePdfPlayPause();
                } else {
                    // Toggle web page reading
                    if (activeSpeechTabId !== null) {
                        handleStopReading();
                    } else {
                        if (tab.id) {
                            sendMessageToContentScript(tab.id, { action: "getText" }, (response) => {
                                if (response && response.text && response.text.length > 0) {
                                    activeSpeechTabId = tab.id;
                                    handleStartReading(response.text, lastRate || 1.0, lastVoice || null);
                                    chrome.runtime.sendMessage({ action: 'speechStarted' });
                                }
                            });
                        }
                    }
                }
            });
            break;
        case "refresh-state":
            handleStopReading();
            handleStopPdfReading();
            sendMessageToContentScript(tab.id, { action: "stopComicReading" });
            lastVoice = null;
            lastRate = 1.0;
            chrome.runtime.sendMessage({ action: 'speechStopped' });
            break;
    }
});

function sendMessageToContentScript(tabId, message, callback) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            }).then(() => {
                chrome.tabs.sendMessage(tabId, message, callback);
            }).catch(err => {
                if (callback) {
                    callback({ error: `Failed to inject script: ${err.message}` });
                }
            });
        } else {
            if (callback) {
                callback(response);
            }
        }
    });
}