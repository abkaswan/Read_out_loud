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

// Comic Reader UI
const chapterCounter = document.getElementById('chapter-counter');
const pageCounter = document.getElementById('page-counter');
const panelCounter = document.getElementById('panel-counter');
const overallProgressBar = document.getElementById('overall-progress');
const panelProgressBar = document.getElementById('panel-progress');
const comicPanelSelectionPrompt = document.getElementById('comic-panel-selection-prompt');
const comicProgressCard = document.querySelector('.comic-progress-card');
const selectPanelBtn = document.getElementById('select-panel-btn');
const reselectPanelBtn = document.getElementById('reselect-panel-btn');
const readingProgress = document.getElementById('reading-progress');


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
    const selects = [document.getElementById("voiceSelect"), document.getElementById("pdf-voiceSelect")];

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
    } else if (message.action === 'updateComicProgress') {
        updateComicProgress(message.progress);
    } else if (message.action === 'updateDownloadButton') {
        const btn = message.isPdf ? pdfDownloadBtn : downloadBtn;
        btn.disabled = !message.enabled;
        btn.textContent = message.enabled ? 'Download MP3' : 'Cannot Download';
    }
});

function updateComicProgress(progress) {
    const format = (num) => (num > 0 ? String(num).padStart(2, '0') : '--');

    if (chapterCounter) chapterCounter.textContent = format(progress.chapter);
    if (pageCounter) pageCounter.textContent = format(progress.page);
    if (panelCounter) panelCounter.textContent = format(progress.panel);

    if (overallProgressBar) {
        const overallPercentage = progress.totalPages > 0 && progress.page > 0 ? ((progress.page / progress.totalPages) * 100) : 0;
        overallProgressBar.style.width = `${overallPercentage}%`;
    }

    if (panelProgressBar) {
        const panelPercentage = progress.totalPanelsInPage > 0 && progress.panel > 0 ? ((progress.panel / progress.totalPanelsInPage) * 100) : 0;
        panelProgressBar.style.width = `${panelPercentage}%`;
    }
}

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
                    updateComicProgress(state);
                }
                const comicPanelsFound = document.getElementById('comic-panels-found');
                comicPanelsFound.textContent = state.totalPanels;
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

function updateComicProgress(progress) {
    const { chapter, panel, totalPanels } = progress;

    if (chapterCounter) chapterCounter.textContent = `${chapter > 0 ? chapter : '--'}`;
    if (panelCounter) panelCounter.textContent = `${panel > 0 ? panel : '--'}/${totalPanels > 0 ? totalPanels : '--'}`;

    if (readingProgress) {
        const percentage = totalPanels > 0 && panel > 0 ? (panel / totalPanels) * 100 : 0;
        readingProgress.style.width = `${percentage}%`;
    }
}




