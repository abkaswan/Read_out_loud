let textNodeMap = []; // Stores { node: TextNode, text: string, startCharIndex: number }
let currentHighlightElement = null;
const highlightClassName = 'tts-highlight';

// --- Text Extraction using TreeWalker ---
function extractVisibleTextAndNodes() {
    textNodeMap = []; // Reset the map
    let fullText = '';
    let charCounter = 0;
    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A']); // Tags to ignore content within

    // Function to check if an element or its ancestors should be ignored
    function isIgnored(node) {
        let parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        while (parent && parent !== document.body) {
            if (ignoredTags.has(parent.tagName)) {
                return true;
            }
            // Basic visibility check (can be improved)
            if (parent.offsetParent === null && parent.tagName !== 'BODY') {
                // Check computed style as offsetParent can be null for fixed/sticky
                const style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return true;
                }
            }
            parent = parent.parentElement;
        }
        return false;
    }

    // Use TreeWalker to find all text nodes within the body
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT, { // Filter function
            acceptNode: function(node) {
                // Basic checks: non-empty, parent exists, not ignored, parent visible
                if (node.nodeValue.trim().length > 0 && node.parentElement && !isIgnored(node)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        },
        // false // Kept for legacy reasons, fourth argument deprecated
    );

    let node;
    while (node = walker.nextNode()) {
        const nodeText = node.nodeValue; // Get text content of the node
        // Add a space between nodes if the combined text doesn't already end/start with space
        const separator = (fullText.length > 0 && !/\s$/.test(fullText) && !/^\s/.test(nodeText)) ? ' ' : '';
        const processedText = separator + nodeText;

        textNodeMap.push({
            node: node,
            text: processedText, // Store the text content from this node
            startCharIndex: charCounter // Store where this node's text starts in fullText
        });
        fullText += processedText;
        charCounter += processedText.length;
    }

    return fullText.trim();
}

// Function to get selected text (fallback to extracting all)
function getTextToSend() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        textNodeMap = [];
        return selectedText;
    } else {
        return extractVisibleTextAndNodes();
    }
}

// --- Highlighting Logic ---
function clearHighlight() {
    if (currentHighlightElement) {
        try {
            // Check if parent exists before attempting removal
            if (currentHighlightElement.parentNode) {
                const parent = currentHighlightElement.parentNode;
                const textNode = document.createTextNode(currentHighlightElement.textContent);
                parent.replaceChild(textNode, currentHighlightElement);
                parent.normalize(); // Merges adjacent text nodes (optional but good practice)
            }
        } catch (e) {
            console.error("Error clearing highlight:", e);
        } finally {
            currentHighlightElement = null;
        }
    }
}

function highlightWordAtCharIndex(charIndex) {
    clearHighlight(); // Remove previous highlight first

    if (textNodeMap.length === 0) {
        return; // Can't highlight if we don't have the map
    }

    // Find the node and the relative index within that node
    let targetEntry = null;
    let indexWithinNode = -1;

    for (const entry of textNodeMap) {
        const entryEndIndex = entry.startCharIndex + entry.text.length;
        if (charIndex >= entry.startCharIndex && charIndex < entryEndIndex) {
            targetEntry = entry;
            indexWithinNode = charIndex - entry.startCharIndex;
            break;
        }
    }

    if (!targetEntry || indexWithinNode === -1) {
        return;
    }

    const node = targetEntry.node;
    const text = node.nodeValue; // Use the current nodeValue, not the stored one (DOM might change slightly)

    // Find word boundaries around the indexWithinNode
    // Start from indexWithinNode and go left/right until whitespace or punctuation boundary
    let wordStart = indexWithinNode;
    while (wordStart > 0 && !/\s|[.,!?;:]/.test(text[wordStart - 1])) {
        wordStart--;
    }
    // Adjust start if it landed on punctuation/space just before the word
    if (/\s|[.,!?;:]/.test(text[wordStart])) {
        wordStart++;
    }


    let wordEnd = indexWithinNode;
    while (wordEnd < text.length && !/\s|[.,!?;:]/.test(text[wordEnd])) {
        wordEnd++;
    }

    // Basic validation: ensure start <= end and indices are valid
    if (wordStart < 0 || wordEnd > text.length || wordStart >= wordEnd) {
        return; // Don't highlight if boundaries are weird
    }

    // Create a Range and highlight
    try {
        const range = document.createRange();
        range.setStart(node, wordStart);
        range.setEnd(node, wordEnd);

        const span = document.createElement('span');
        span.className = highlightClassName;
        range.surroundContents(span); // This modifies the DOM, wrapping the word

        currentHighlightElement = span; // Store reference to the new span

        // Scroll into view if needed (optional)
        span.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });

    } catch (e) {
        console.error(`Highlight: Error creating/applying range (Start: ${wordStart}, End: ${wordEnd}, Index: ${indexWithinNode})`, e);
        // Clear any potentially broken state
        clearHighlight();
    }
}


// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Use an async IIFE to handle async logic in the listener
    (async () => {
        try {
            if (request.action === 'getText') {
                const text = getTextToSend();
                sendResponse({
                    text: text
                });
            } else if (request.action === 'highlightCharacterIndex') {
                highlightWordAtCharIndex(request.charIndex);
            } else if (request.action === 'clearHighlight') {
                clearHighlight();
            } else if (request.action === 'getImages') {
                const images = Array.from(document.getElementsByTagName('img'));
                const imageUrls = images.map(img => img.src);
                sendResponse({
                    imageUrls: imageUrls
                });
            } else if (request.action === 'getComicState') {
                getComicState().then(state => sendResponse({
                    comicState: state
                }));
            } else if (request.action === 'startPanelSelection') {
                startPanelSelection();
            } else if (request.action === 'startComicReading') {
                startComicReading(request.settings);
            } else if (request.action === 'stopComicReading') {
                stopComicReading();
            }
        } catch (error) {
            console.error("Content Script Error:", error);
            // Handle potential errors in async operations
            sendResponse({
                error: error.message
            });
        }
    })();

    // Return true to indicate that the response will be sent asynchronously.
    return true;
});

// --- Comic Mode Logic ---

let comicState = {
    selectionNeeded: true,
    selector: null,
    totalPanels: 0,
    chapter: 0,
    panel: 0,
    isPlaying: false,
    readingDirection: 'lr',
    panelDelay: 3,
    continuousChapter: false,
};
let autoAdvanceInterval = null;


const getSelectorForHost = async (hostname) => {
    const key = `selector_${hostname}`;
    const data = await chrome.storage.local.get(key);
    return data[key];
};

const saveSelectorForHost = async (hostname, selector) => {
    const key = `selector_${hostname}`;
    await chrome.storage.local.set({
        [key]: selector
    });
};

async function getComicState() {
    const hostname = window.location.hostname;
    const selector = await getSelectorForHost(hostname);

    comicState.selector = selector;
    comicState.chapter = findChapterNumber(window.location.href);

    if (!selector) {
        comicState.selectionNeeded = true;
        comicState.totalPanels = 0;
        comicState.panel = 0;
    } else {
        const panelElements = document.querySelectorAll(selector);
        comicState.selectionNeeded = false;
        comicState.totalPanels = panelElements.length;
        // Initial scroll check to set the correct panel number on load
        handleScroll();
    }
    return comicState;
}

function findChapterNumber(url) {
    // Tries a series of robust regex patterns to find the chapter number.
    const patterns = [
        /(?:chapter|ch)[\/-](\d+(?:\.\d+)?)/i, // Matches chapter-123, ch/123, etc.
        /\/(\d+(?:\.\d+)?)(?:[^\d]|$)/, // Matches /123/ or /123 followed by non-digit or end
        /(\d+(?:\.\d+)?)/ // Last resort: matches any number
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
    }

    return 0; // Return 0 if no chapter number is found
}

// --- Panel Selection Mode ---

let isSelectionModeActive = false;
let highlightOverlay = null;

function createOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.backgroundColor = 'rgba(137, 247, 254, 0.4)';
    overlay.style.border = '2px solid #89f7fe';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '999999';
    overlay.style.transition = 'all 0.1s ease';
    document.body.appendChild(overlay);
    return overlay;
}

function updateOverlay(element) {
    if (!highlightOverlay) highlightOverlay = createOverlay();
    const rect = element.getBoundingClientRect();
    highlightOverlay.style.left = `${rect.left + window.scrollX}px`;
    highlightOverlay.style.top = `${rect.top + window.scrollY}px`;
    highlightOverlay.style.width = `${rect.width}px`;
    highlightOverlay.style.height = `${rect.height}px`;
}

function handleMouseOver(e) {
    updateOverlay(e.target);
}

function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const selector = generateSelector(element);
    if (selector) {
        saveSelectorForHost(window.location.hostname, selector);
        // Inform popup that selection is done
        chrome.runtime.sendMessage({
            action: 'panelSelectionComplete'
        });
    }
    stopPanelSelection();
}

function generateSelector(el) {
    if (!el) return null;
    // Simple strategy: use the class list. Can be improved.
    if (el.className) {
        const classSelector = el.className.trim().split(/\s+/).map(c => `.${c}`).join('');
        // Check if this selector is reasonably specific
        const matches = document.querySelectorAll(classSelector);
        if (matches.length > 0 && matches.length < 200) { // Avoid overly generic selectors
            return `${el.tagName.toLowerCase()}${classSelector}`;
        }
    }
    // Fallback to just tag name if no good class found
    return el.tagName.toLowerCase();
}

function startPanelSelection() {
    if (isSelectionModeActive) return;
    isSelectionModeActive = true;
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('click', handleClick, true); // Use capture to prevent page navigation
}

function stopPanelSelection() {
    if (!isSelectionModeActive) return;
    isSelectionModeActive = false;
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('click', handleClick, true);
    if (highlightOverlay) {
        highlightOverlay.remove();
        highlightOverlay = null;
    }
}

async function readCurrentPanel() {
    console.log('[Content Script] Reading current panel...');
    const panelElements = document.querySelectorAll(comicState.selector);
    if (!panelElements || panelElements.length === 0) {
        console.error('[Content Script] Cannot find panel elements with selector:', comicState.selector);
        return;
    }

    const currentPanelElement = panelElements[comicState.panel - 1];
    if (!currentPanelElement) {
        console.error('[Content Script] Cannot find current panel element at index:', comicState.panel - 1);
        return;
    }

    let imageElement = null;
    if (currentPanelElement.tagName === 'IMG') {
        imageElement = currentPanelElement;
    } else {
        imageElement = currentPanelElement.querySelector('img');
    }

    if (!imageElement || !imageElement.src) {
        console.error("[Content Script] No image found in the current panel.");
        return;
    }

    // Send the image URL to the background script for bubble detection and OCR.
    // This avoids CORS issues with canvas in the content script.
    console.log('[Content Script] Sending image URL to background for bubble detection:', imageElement.src);
    try {
        chrome.runtime.sendMessage({
            action: 'processImageForBubbles',
            imageUrl: imageElement.src
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Content Script] Error sending message to background:', chrome.runtime.lastError.message);
            } else {
                console.log('[Content Script] Message sent to background script successfully.');
            }
        });
    } catch (error) {
        console.error('[Content Script] Caught error sending message:', error);
    }
}


// --- Comic Reading Control ---
function startComicReading(settings) {
    if (autoAdvanceInterval) clearInterval(autoAdvanceInterval);

    comicState.isPlaying = true;
    comicState.readingDirection = settings.readingDirection;
    comicState.panelDelay = settings.panelDelay;
    comicState.continuousChapter = settings.continuousChapter;

    readCurrentPanel(); // Read the first panel immediately

    if (settings.autoAdvance) {
        autoAdvanceInterval = setInterval(advanceToNextPanel, settings.panelDelay * 1000);
    }

    // Send an update to the popup to confirm the state
    chrome.runtime.sendMessage({
        action: 'updateComicState',
        state: comicState
    });
}

function stopComicReading() {
    if (autoAdvanceInterval) clearInterval(autoAdvanceInterval);
    autoAdvanceInterval = null;
    comicState.isPlaying = false;
    chrome.runtime.sendMessage({
        action: 'stop',
        target: 'offscreen'
    });
    // Send an update to the popup to confirm the state
    chrome.runtime.sendMessage({
        action: 'updateComicState',
        state: comicState
    });
}

function advanceToNextPanel() {
    const panelElements = document.querySelectorAll(comicState.selector);
    if (!panelElements || panelElements.length === 0) {
        stopComicReading();
        return;
    }

    let nextPanelIndex = comicState.panel; // It's 1-based, so index is panel - 1

    if (comicState.readingDirection === 'rl') {
        // This is a simplification. True RL would depend on the site's HTML structure.
        // For now, we just go backwards through the querySelectorAll result.
        nextPanelIndex = comicState.totalPanels - comicState.panel;
    }

    if (nextPanelIndex >= panelElements.length) {
        // Reached the end of the chapter
        if (comicState.continuousChapter) {
            navigateToNextChapter();
        } else {
            stopComicReading();
        }
        return;
    }

    panelElements[nextPanelIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
    // We need to wait for the scroll to finish before reading. A timeout is a simple way.
    setTimeout(readCurrentPanel, 500);
}

function navigateToNextChapter() {
    // This is highly dependent on the website's URL structure.
    // We'll try a simple number increment first.
    const currentUrl = window.location.href;
    const chapterNum = findChapterNumber(currentUrl);
    if (chapterNum > 0) {
        const nextChapterNum = chapterNum + 1;
        // Try to replace the chapter number in the URL
        const nextUrl = currentUrl.replace(chapterNum.toString(), nextChapterNum.toString());
        if (nextUrl !== currentUrl) {
            window.location.href = nextUrl;
        } else {
            stopComicReading(); // Can't figure out next chapter URL
        }
    } else {
        stopComicReading(); // No chapter number found
    }
}


// --- Scroll Tracking ---

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function handleScroll() {
    if (!comicState.selector || comicState.totalPanels === 0) {
        return;
    }

    const panelElements = document.querySelectorAll(comicState.selector);
    if (panelElements.length === 0) return;

    let currentPanel = 1; // Default to the first panel

    // Find the last panel whose top is above the viewport's vertical center.
    for (let i = 0; i < panelElements.length; i++) {
        const panel = panelElements[i];
        const rect = panel.getBoundingClientRect();

        if (rect.top < (window.innerHeight * 0.5)) {
            currentPanel = i + 1;
        } else {
            break;
        }
    }

    if (comicState.panel !== currentPanel) {
        comicState.panel = currentPanel;
        chrome.runtime.sendMessage({
            action: 'updateComicState',
            state: comicState
        });
    }
}

// Attach the throttled scroll handler
window.addEventListener('scroll', throttle(handleScroll, 100));

