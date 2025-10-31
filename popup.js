// --- UI Elements ---
const webReaderContainer = document.getElementById('web-reader-container');
const pdfReaderContainer = document.getElementById('pdf-reader-container');

// Web Reader UI
const playPauseBtn = document.getElementById("playPauseBtn");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");
const refreshBtn = document.getElementById("refreshBtn");
const voiceSelect = document.getElementById("voiceSelect");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");

// PDF Reader UI
const pdfLoadingView = document.getElementById('pdf-loading-view');
const pdfReaderView = document.getElementById('pdf-reader-view');
const pdfPlayPauseBtn = document.getElementById("pdf-playPauseBtn");
const pdfPlayIcon = document.getElementById("pdf-play-icon");
const pdfPauseIcon = document.getElementById("pdf-pause-icon");
const pdfPrevBtn = document.getElementById('pdf-prevBtn');
const pdfNextBtn = document.getElementById('pdf-nextBtn');
const pdfCurrentPageInput = document.getElementById('pdf-current-page-input');
const pageByPageBtn = document.getElementById('page-by-page-btn');
const continuousBtn = document.getElementById('continuous-btn');
const readingProgressBar = document.getElementById('reading-progress-bar');
const readingProgressPercent = document.getElementById('reading-progress-percent');
const pdfTotalPagesInfo = document.getElementById('pdf-total-pages-info');
const pdfReadTime = document.getElementById('pdf-read-time');
const pdfCurrentPageInfo = document.getElementById('pdf-current-page-info');
const bookmarkBtn = document.getElementById('bookmark-btn');
const bookmarkedPagesList = document.getElementById('bookmarked-pages-list');
const pdfVoiceSelect = document.getElementById('pdf-voiceSelect');
const pdfSpeedRange = document.getElementById('pdf-speedRange');
const pdfSpeedValue = document.getElementById('pdf-speedValue');
const pdfRefreshBtn = document.getElementById('pdf-refreshBtn');

// --- Comic Reader UI ---
const chapterCounter = document.getElementById('chapter-counter');
const panelCounter = document.getElementById('panel-counter');
const readingProgress = document.getElementById('reading-progress');
const comicPanelSelectionPrompt = document.getElementById('comic-panel-selection-prompt');
const comicProgressCard = document.querySelector('.comic-progress-card');
const selectPanelBtn = document.getElementById('select-panel-btn');
const reselectPanelBtn = document.getElementById('reselect-panel-btn');

// New Comic Settings UI
const directionLRBtn = document.getElementById('direction-lr');
const directionRLBtn = document.getElementById('direction-rl');
const autoAdvanceToggle = document.getElementById('auto-advance-toggle');
const panelDelaySlider = document.getElementById('panel-delay-slider');
const panelDelayValue = document.getElementById('panel-delay-value');
const continuousChapterToggle = document.getElementById('continuous-chapter-toggle');
const comicPlayPauseBtn = document.getElementById('comic-playPauseBtn');
const comicPlayIcon = document.getElementById('comic-play-icon');
const comicPauseIcon = document.getElementById('comic-pause-icon');
const comicRefreshBtn = document.getElementById('comic-refreshBtn');
const comicVoiceSelect = document.getElementById('comic-voiceSelect');
const comicSpeedRange = document.getElementById('comic-speedRange');
const comicSpeedValue = document.getElementById('comic-speedValue');
const comicOcrModeSelect = document.getElementById('comic-ocr-mode');

let comicSettings = {};

// --- Comic Settings Management ---
const defaultComicSettings = {
    readingDirection: 'lr',
    autoAdvance: false,
    panelDelay: 3,
    continuousChapter: false,
    isPlaying: false,
    voice: null,
    rate: 1.0
};

async function loadComicSettings() {
    const data = await chrome.storage.local.get('comicSettings');
    comicSettings = { ...defaultComicSettings, ...data.comicSettings };
    // If no voice is saved, try to set a default one
    if (!comicSettings.voice && uniqueVoices.length > 0) {
        const defaultVoice = uniqueVoices.find(v => v.default) || uniqueVoices[0];
        comicSettings.voice = { name: defaultVoice.name, lang: defaultVoice.lang };
    }
    applyComicSettingsToUI();
}

function saveComicSettings() {
    chrome.storage.local.set({ comicSettings });
}

function applyComicSettingsToUI() {
    // Reading Direction
    if (comicSettings.readingDirection === 'lr') {
        directionLRBtn.classList.add('active');
        directionRLBtn.classList.remove('active');
    } else {
        directionRLBtn.classList.add('active');
        directionLRBtn.classList.remove('active');
    }
    // Auto Advance
    autoAdvanceToggle.checked = comicSettings.autoAdvance;
    // Panel Delay
    panelDelaySlider.value = comicSettings.panelDelay;
    panelDelayValue.textContent = `${comicSettings.panelDelay}s`;
    // Continuous Chapter
    continuousChapterToggle.checked = comicSettings.continuousChapter;
    // Play/Pause State
    setComicButtonState(comicSettings.isPlaying);

    // Voice and Speed
    comicSpeedRange.value = comicSettings.rate;
    comicSpeedValue.textContent = `${comicSettings.rate.toFixed(1)}x`;

    if (comicSettings.voice) {
        const checkVoicesLoadedInterval = setInterval(() => {
            if (voicesLoaded && $(comicVoiceSelect).data('select2')) {
                clearInterval(checkVoicesLoadedInterval);
                const voiceValue = JSON.stringify({ name: comicSettings.voice.name, lang: comicSettings.voice.lang });
                if ($(comicVoiceSelect).find(`option[value='${voiceValue}']`).length) {
                    $(comicVoiceSelect).val(voiceValue).trigger('change.select2');
                }
            }
        }, 50);
    }

    // OCR Recognizer dropdown (stored independently in chrome.storage)
    loadRecognizerMode();
}

function setComicButtonState(playing) {
    comicSettings.isPlaying = playing;
    if (playing) {
        comicPlayIcon.classList.add("hidden");
        comicPauseIcon.classList.remove("hidden");
    } else {
        comicPlayIcon.classList.remove("hidden");
        comicPauseIcon.classList.add("hidden");
    }
}

// --- Comic Event Listeners ---
directionLRBtn.addEventListener('click', () => {
    comicSettings.readingDirection = 'lr';
    applyComicSettingsToUI();
    saveComicSettings();
});

directionRLBtn.addEventListener('click', () => {
    comicSettings.readingDirection = 'rl';
    applyComicSettingsToUI();
    saveComicSettings();
});

autoAdvanceToggle.addEventListener('change', () => {
    comicSettings.autoAdvance = autoAdvanceToggle.checked;
    saveComicSettings();
});

panelDelaySlider.addEventListener('input', () => {
    panelDelayValue.textContent = `${panelDelaySlider.value}s`;
});

panelDelaySlider.addEventListener('change', () => {
    comicSettings.panelDelay = parseInt(panelDelaySlider.value, 10);
    saveComicSettings();
});

continuousChapterToggle.addEventListener('change', () => {
    comicSettings.continuousChapter = continuousChapterToggle.checked;
    saveComicSettings();
});

comicPlayPauseBtn.addEventListener('click', () => {
    setComicButtonState(!comicSettings.isPlaying); // Toggle UI immediately
    saveComicSettings();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        // Pass the entire settings object to the content script
        chrome.tabs.sendMessage(tabs[0].id, {
            action: comicSettings.isPlaying ? 'startComicReading' : 'stopComicReading',
            settings: comicSettings
        });
        // Also update the background script's last known settings
        if (comicSettings.isPlaying) {
            chrome.runtime.sendMessage({
                action: "updateSpeechSettings",
                rate: comicSettings.rate,
                voice: comicSettings.voice
            });
        }
    });
});

comicRefreshBtn.addEventListener('click', () => {
    comicSettings = { ...defaultComicSettings };
    applyComicSettingsToUI();
    saveComicSettings();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: 'stopComicReading'
        });
    });
});

comicVoiceSelect.addEventListener('change', () => {
    try {
        comicSettings.voice = JSON.parse(comicVoiceSelect.value);
        saveComicSettings();
    } catch(e) {
        console.error("Error parsing comic voice details", e);
    }
});

comicSpeedRange.addEventListener('input', () => {
    const rate = parseFloat(comicSpeedRange.value);
    comicSpeedValue.textContent = `${rate.toFixed(1)}x`;
    comicSettings.rate = rate;
    saveComicSettings();
});

// Recognizer dropdown persistence
async function loadRecognizerMode() {
    try {
        const data = await chrome.storage.local.get('ppocr_recognizer_mode');
        const mode = data.ppocr_recognizer_mode || 'ppocr';
        if (comicOcrModeSelect) {
            comicOcrModeSelect.value = mode;
        }
    } catch (e) {}
}

if (comicOcrModeSelect) {
    comicOcrModeSelect.addEventListener('change', async () => {
        const mode = comicOcrModeSelect.value || 'ppocr';
        await chrome.storage.local.set({ ppocr_recognizer_mode: mode });
        // Proactively notify offscreen to switch mode immediately
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'ppocrSetRecognizerMode', mode });
        console.log('[Popup] Recognizer mode set to', mode);
    });
}





let voices = [];
let voicesLoaded = false;
let uniqueVoices = []; // Make uniqueVoices accessible for fallback

// Initialize voice selection - KEEP THIS for the UI
function loadVoices() {
    // Reset voicesLoaded flag if voices array becomes empty
    if (speechSynthesis.getVoices().length === 0 && voices.length > 0) { // Only reset if it *was* populated
        voicesLoaded = false;
        voices = [];
        uniqueVoices = [];
    }

    voices = speechSynthesis.getVoices();
    const selects = [voiceSelect, pdfVoiceSelect, comicVoiceSelect];

    uniqueVoices = voices.filter((voice, index, self) =>
        index === self.findIndex((v) => v.name === voice.name && v.lang === voice.lang)
    );

    if (!voicesLoaded && uniqueVoices.length > 0) {
        selects.forEach(select => {
            if (select) {
                if ($(select).data('select2')) {
                    $(select).select2('destroy');
                    select.innerHTML = '';
                } else {
                    select.innerHTML = '';
                }

                uniqueVoices.forEach((voice) => {
                    const option = document.createElement("option");
                    option.value = JSON.stringify({ name: voice.name, lang: voice.lang });
                    option.textContent = `${voice.name} (${voice.lang})`;
                    select.appendChild(option);
                });

                try {
                    $(select).select2();
                } catch (e) {
                    console.error("Popup: Error initializing Select2:", e);
                }
            }
        });
        voicesLoaded = true;
    } else if (uniqueVoices.length === 0 && !voicesLoaded) {
        setTimeout(loadVoices, 500);
    }
}

// Use addEventListener for robust handling
speechSynthesis.addEventListener('voiceschanged', loadVoices);

// Directly load voices on initialization
loadVoices();


// Helper function to get selected voice details
function getSelectedVoiceDetails(isPdf = false) {
    const select = document.getElementById(isPdf ? "pdf-voiceSelect" : "voiceSelect");
    if (!select || select.value === null || select.value === undefined || select.value === "") {
        if (uniqueVoices.length > 0) {
             return { name: uniqueVoices[0].name, lang: uniqueVoices[0].lang };
        }
        return null;
    }
    try {
        return JSON.parse(select.value);
    } catch (e) {
        if (uniqueVoices.length > 0) {
             return { name: uniqueVoices[0].name, lang: uniqueVoices[0].lang };
        }
        return null;
    }
}


$(document).ready(function() {
    $('#voiceSelect, #pdf-voiceSelect').on('change', function(e) {
        const isPdf = this.id === 'pdf-voiceSelect';
        const rate = parseFloat(document.getElementById(isPdf ? "pdf-speedRange" : "speedRange").value);
        const voiceDetails = getSelectedVoiceDetails(isPdf);

        if (voiceDetails) {
            chrome.runtime.sendMessage({
                action: "updateSpeechSettings",
                rate: rate,
                voice: voiceDetails,
                isPdf: isPdf
            });
        }
    });
});


// Handle speed change
function handleSpeedChange(newValue, isPdf = false) {
    const rate = parseFloat(newValue);
    if (isNaN(rate)) return;
    const clampedRate = Math.min(Math.max(rate, 0.5), 2);
    const formattedRate = clampedRate.toFixed(1);
    const speedRangeEl = document.getElementById(isPdf ? "pdf-speedRange" : "speedRange");
    const speedValueEl = document.getElementById(isPdf ? "pdf-speedValue" : "speedValue");
    speedRangeEl.value = formattedRate;
    speedValueEl.textContent = `${formattedRate}x`;
    const voiceDetails = getSelectedVoiceDetails(isPdf);
    if (voiceDetails) {
        chrome.runtime.sendMessage({
            action: "updateSpeechSettings",
            rate: clampedRate,
            voice: voiceDetails,
            isPdf: isPdf
        });
    }
}

speedRange.addEventListener("input", (e) => handleSpeedChange(e.target.value));
pdfSpeedRange.addEventListener("input", (e) => handleSpeedChange(e.target.value, true));


// Helper function to attempt sending a message, with injection fallback for content.js
function sendMessageToContentScript(tabId, message, callback) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError &&
            chrome.runtime.lastError.message.includes("Receiving end does not exist"))
        {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["content.js"]
            }).then(() => {
                chrome.tabs.sendMessage(tabId, message, callback);
            }).catch(injectionError => {
                callback({ error: `Failed to inject content script: ${injectionError.message}` });
            });
        } else {
            callback(response);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const instructionsHeaders = document.querySelectorAll(".instructions-header");
    instructionsHeaders.forEach(header => {
        header.addEventListener("click", () => {
            const list = header.nextElementSibling;
            list.classList.toggle("hidden");
        });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && tab.url && tab.url.toLowerCase().endsWith('.pdf')) {
            webReaderContainer.style.display = 'none';
            pdfReaderContainer.style.display = 'flex';
            chrome.runtime.sendMessage({ action: "readPdf", url: tab.url });
        } else {
            webReaderContainer.style.display = 'flex';
            pdfReaderContainer.style.display = 'none';
            chrome.runtime.sendMessage({ action: "getUiState" }, handleUiStateResponse);
        }
    });
});

function handleUiStateResponse(response) {
    if (response) {
        if (response.isPdf) {
            setPdfButtonState(response.isPlaying);
            if (response.rate) {
                pdfSpeedRange.value = response.rate;
                pdfSpeedValue.textContent = `${response.rate.toFixed(1)}x`;
            }
            if (response.voice) {
                const checkVoicesLoadedInterval = setInterval(() => {
                    if (voicesLoaded && $(pdfVoiceSelect).data('select2')) {
                        clearInterval(checkVoicesLoadedInterval);
                        const voiceValue = JSON.stringify({ name: response.voice.name, lang: response.voice.lang });
                        if ($(pdfVoiceSelect).find(`option[value='${voiceValue}']`).length) {
                            $(pdfVoiceSelect).val(voiceValue).trigger('change.select2');
                        }
                    }
                }, 50);
            }
            if(response.totalPages) {
                updatePdfInfo(response.currentPage, response.totalPages, response.bookmarks);
            }
            if (response.readingMode === 'continuous') {
                continuousBtn.style.backgroundColor = 'rgba(192, 132, 255, 0.3)';
                continuousBtn.style.color = '#c084ff';
                continuousBtn.style.borderColor = 'rgba(192, 132, 255, 0.5)';
                pageByPageBtn.style.backgroundColor = 'rgba(71, 85, 105, 0.5)';
                pageByPageBtn.style.color = '#94a3b8';
                pageByPageBtn.style.borderColor = 'transparent';
            } else {
                pageByPageBtn.style.backgroundColor = 'rgba(192, 132, 255, 0.3)';
                pageByPageBtn.style.color = '#c084ff';
                pageByPageBtn.style.borderColor = 'rgba(192, 132, 255, 0.5)';
                continuousBtn.style.backgroundColor = 'rgba(71, 85, 105, 0.5)';
                continuousBtn.style.color = '#94a3b8';
                continuousBtn.style.borderColor = 'transparent';
            }
        } else {
            setButtonState(response.isPlaying);
            if (response.rate) {
                speedRange.value = response.rate;
                speedValue.textContent = `${response.rate.toFixed(1)}x`;
            }
            if (response.voice) {
                const checkVoicesLoadedInterval = setInterval(() => {
                    if (voicesLoaded && $(voiceSelect).data('select2')) {
                        clearInterval(checkVoicesLoadedInterval);
                        const voiceValue = JSON.stringify({ name: response.voice.name, lang: response.voice.lang });
                        if ($(voiceSelect).find(`option[value='${voiceValue}']`).length) {
                            $(voiceSelect).val(voiceValue).trigger('change.select2');
                        }
                    }
                }, 50);
            }
        }
    }
}

let isPlaying = false;

function setButtonState(playing) {
    isPlaying = playing;
    if (playing) {
        playIcon.classList.add("hidden");
        pauseIcon.classList.remove("hidden");
    } else {
        playIcon.classList.remove("hidden");
        pauseIcon.classList.add("hidden");
    }
}

function setPdfButtonState(playing) {
    if (playing) {
        pdfPlayIcon.classList.add("hidden");
        pdfPauseIcon.classList.remove("hidden");
    } else {
        pdfPlayIcon.classList.remove("hidden");
        pdfPauseIcon.classList.add("hidden");
    }
}

playPauseBtn.addEventListener("click", () => {
    if (isPlaying) {
        chrome.runtime.sendMessage({ action: "stopReading" });
        setButtonState(false);
    } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
                alert("This extension cannot work on browser internal pages.");
                return;
            }
            sendMessageToContentScript(tab.id, { action: "getText" }, (response) => {
                if (response && typeof response.text === 'string' && response.text.length > 0) {
                    const rate = parseFloat(speedRange.value);
                    const voiceDetails = getSelectedVoiceDetails();
                    if (voiceDetails) {
                        chrome.runtime.sendMessage({
                            action: "startReading",
                            text: response.text,
                            rate: rate,
                            voice: voiceDetails
                        });
                        setButtonState(true);
                    }
                }
            });
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'panelSelectionComplete') {
        setTimeout(updateComicUI, 100);
        return; // Stop processing here for this message
    }

    const loadingText = pdfLoadingView.querySelector('p');

    if (message.action === "speechStopped") {
        setButtonState(false);
        setPdfButtonState(false);
    } else if (message.action === 'pdfProcessingStarted') {
        pdfReaderView.classList.add('hidden');
        pdfLoadingView.classList.remove('hidden');
        loadingText.textContent = 'Processing PDF...';
    } else if (message.action === 'pdfProcessingProgress') {
        loadingText.textContent = `Processing page ${message.currentPage} of ${message.totalPages}...`;
    } else if (message.action === 'pdfProcessingComplete') {
        pdfLoadingView.classList.add('hidden');
        pdfReaderView.classList.remove('hidden');
        updatePdfInfo(1, message.totalPages, []);
    } else if (message.action === 'pdfProcessingFailed') {
        pdfLoadingView.classList.add('hidden');
        webReaderContainer.style.display = 'flex';
        pdfReaderContainer.style.display = 'none';
        alert(`Failed to process PDF: ${message.error}`);
    } else if (message.action === 'pdfPageUpdate') {
        updatePdfInfo(message.currentPage, message.totalPages, message.bookmarks);
    } else if (message.action === "updatePdfUiState") {
        pdfLoadingView.classList.add('hidden');
        pdfReaderView.classList.remove('hidden');
        handleUiStateResponse({ ...message.state, isPdf: true });
    } else if (message.action === 'updateComicState') {
        if (message.state) {
            if (message.state.isPlaying !== undefined && comicSettings.isPlaying !== message.state.isPlaying) {
                setComicButtonState(message.state.isPlaying);
                saveComicSettings();
            }
            updateComicProgressUI(message.state);
        }
    } else if (message.action === 'updateDownloadButton') {
        const btn = message.isPdf ? pdfDownloadBtn : downloadBtn;
        btn.disabled = !message.enabled;
        btn.textContent = message.enabled ? 'Download MP3' : 'Cannot Download';
    }
});

function updatePdfInfo(currentPage, totalPages, bookmarks) {
    const pdfTotalPagesSpan = document.getElementById('pdf-total-pages');
    if (pdfTotalPagesSpan) pdfTotalPagesSpan.textContent = totalPages;
    if (pdfCurrentPageInput) {
        pdfCurrentPageInput.value = currentPage;
        pdfCurrentPageInput.max = totalPages;
    }
    if (pdfTotalPagesInfo) pdfTotalPagesInfo.textContent = totalPages;
    if (pdfCurrentPageInfo) pdfCurrentPageInfo.textContent = currentPage;
    if (pdfReadTime) pdfReadTime.textContent = Math.round(totalPages * 0.8); 

    const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
    if (readingProgressBar) readingProgressBar.style.width = `${progress}%`;
    if (readingProgressPercent) readingProgressPercent.textContent = `${Math.round(progress)}%`;

    if (bookmarkedPagesList) {
        bookmarkedPagesList.innerHTML = ''; // Clear existing bookmarks
        bookmarks.forEach(page => {
            const bookmarkButton = document.createElement('button');
            bookmarkButton.textContent = page;
            bookmarkButton.className = 'bookmark-page-btn';
            bookmarkButton.style.cssText = 'padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; background-color: rgba(71, 85, 105, 0.5); color: #cbd5e1; transition: all 0.2s; white-space: nowrap; border: none;';
            bookmarkButton.addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: 'jumpToPage', page: page });
            });
            bookmarkedPagesList.appendChild(bookmarkButton);
        });
    }
}

refreshBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "refreshState" });
});

pdfRefreshBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "refreshState", isPdf: true });
});

// --- PDF Reader Event Listeners ---
pdfPlayPauseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'togglePdfPlayPause' });
});

pdfPrevBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pdfPrevPage' });
});

pdfNextBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pdfNextPage' });
});


pdfCurrentPageInput.addEventListener('change', (e) => {
    const page = parseInt(e.target.value, 10);
    const totalPages = parseInt(document.getElementById('pdf-total-pages').textContent, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
        chrome.runtime.sendMessage({ action: 'jumpToPage', page: page });
    }
});

pageByPageBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'setPdfReadingMode', mode: 'page-by-page' });
    pageByPageBtn.style.backgroundColor = 'rgba(192, 132, 255, 0.3)';
    pageByPageBtn.style.color = '#c084ff';
    pageByPageBtn.style.borderColor = 'rgba(192, 132, 255, 0.5)';
    continuousBtn.style.backgroundColor = 'rgba(71, 85, 105, 0.5)';
    continuousBtn.style.color = '#94a3b8';
    continuousBtn.style.borderColor = 'transparent';
});

continuousBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'setPdfReadingMode', mode: 'continuous' });
    continuousBtn.style.backgroundColor = 'rgba(192, 132, 255, 0.3)';
    continuousBtn.style.color = '#c084ff';
    continuousBtn.style.borderColor = 'rgba(192, 132, 255, 0.5)';
    pageByPageBtn.style.backgroundColor = 'rgba(71, 85, 105, 0.5)';
    pageByPageBtn.style.color = '#94a3b8';
    pageByPageBtn.style.borderColor = 'transparent';
});

bookmarkBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'toggleBookmark' });
});

// --- Mode Switching ---
const textModeBtn = document.getElementById('text-mode-btn');
const comicModeBtn = document.getElementById('comic-mode-btn');
const textReaderContent = document.getElementById('text-reader-content');
const comicReaderContainer = document.getElementById('comic-reader-container');

textModeBtn.addEventListener('click', () => {
    textReaderContent.style.display = 'block';
    comicReaderContainer.style.display = 'none';
    textModeBtn.classList.add('active');
    comicModeBtn.classList.remove('active');
});

comicModeBtn.addEventListener('click', () => {
    textReaderContent.style.display = 'none';
    comicReaderContainer.style.display = 'block';
    textModeBtn.classList.remove('active');
    comicModeBtn.classList.add('active');
    loadComicSettings(); // Load settings when switching to comic mode
    loadRecognizerMode();
    updateComicUI();
});

selectPanelBtn.addEventListener('click', startSelection);
reselectPanelBtn.addEventListener('click', startSelection);

function startSelection() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendMessageToContentScript(tabs[0].id, { action: "startPanelSelection" });
        window.close(); // Close the popup so the user can see the page
    });
}

function updateComicUI() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendMessageToContentScript(tabs[0].id, { action: "getComicState" }, (response) => {
            if (response && response.comicState) {
                const state = response.comicState;
                if (state.selectionNeeded) {
                    comicPanelSelectionPrompt.classList.remove('hidden');
                    comicProgressCard.classList.add('hidden');
                    reselectPanelBtn.parentElement.classList.add('hidden'); // Hide reselect card
                } else {
                    comicPanelSelectionPrompt.classList.add('hidden');
                    comicProgressCard.classList.remove('hidden');
                    reselectPanelBtn.parentElement.classList.remove('hidden'); // Show reselect card
                    updateComicProgressUI(state);
                }
                const comicPanelsFound = document.getElementById('comic-panels-found');
                if(comicPanelsFound) comicPanelsFound.textContent = state.totalPanels;
            }
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'panelSelectionComplete') {
        setTimeout(updateComicUI, 100);
        return;
    }
// ... (rest of the listener)
});

function updateComicProgressUI(progress) {
    const { chapter, panel, totalPanels } = progress;

    if (chapterCounter) chapterCounter.textContent = `${chapter > 0 ? chapter : '--'}`;
    if (panelCounter) panelCounter.textContent = `${panel > 0 ? panel : '--'}/${totalPanels > 0 ? totalPanels : '--'}`;

    if (readingProgress) {
        const percentage = totalPanels > 0 && panel > 0 ? (panel / totalPanels) * 100 : 0;
        readingProgress.style.width = `${percentage}%`;
    }
}



