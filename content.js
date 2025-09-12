if (typeof window.contentScriptLoaded === 'undefined') {
    window.contentScriptLoaded = true;

    // Define comic state early to prevent reference errors
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

    let textNodeMap = []; // Stores { node: TextNode, text: string, startCharIndex: number }
    let currentHighlightElement = null;
    const highlightClassName = 'tts-highlight';

    // --- Bubble overlay state ---
    let bubbleOverlayState = { imageId: null, imageUrl: null, hostEl: null, boxes: [], boxEls: [] };

    function findImageElByUrl(url) {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.find(img => img.src === url) || null;
    }

    function ensureOverlayHostForImage(imgEl) {
        let wrapper = imgEl.closest('.bubble-overlay-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'bubble-overlay-wrapper';
            const style = getComputedStyle(imgEl);
            wrapper.style.position = 'relative';
            wrapper.style.display = style.display === 'block' ? 'block' : 'inline-block';
            wrapper.style.width = imgEl.width + 'px';
            wrapper.style.height = imgEl.height + 'px';
            imgEl.parentNode.insertBefore(wrapper, imgEl);
            wrapper.appendChild(imgEl);
        }
        return wrapper;
    }

    function setupBubbleOverlays(imageUrl, imageId, boxes) {
        const imgEl = findImageElByUrl(imageUrl);
        if (!imgEl) return;

        const wrapper = ensureOverlayHostForImage(imgEl);
        wrapper.querySelectorAll('.bubble-box').forEach(el => el.remove());

        const scaleX = imgEl.clientWidth / imgEl.naturalWidth;
        const scaleY = imgEl.clientHeight / imgEl.naturalHeight;

        const els = boxes.map((b, idx) => {
            const box = document.createElement('div');
            box.className = 'bubble-box';
            box.style.position = 'absolute';
            box.style.left = `${b.minX * scaleX}px`;
            box.style.top = `${b.minY * scaleY}px`;
            box.style.width = `${(b.maxX - b.minX) * scaleX}px`;
            box.style.height = `${(b.maxY - b.minY) * scaleY}px`;
            box.dataset.index = idx;
            wrapper.appendChild(box);
            return box;
        });

        bubbleOverlayState = { imageId, imageUrl, hostEl: wrapper, boxes, boxEls: els };
    }

    function highlightBubbleIndex(index) {
        if (!bubbleOverlayState.hostEl) return;
        bubbleOverlayState.boxEls.forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
        const el = bubbleOverlayState.boxEls[index];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    function clearBubbleOverlays() {
        if (bubbleOverlayState.hostEl) {
            bubbleOverlayState.hostEl.querySelectorAll('.bubble-box').forEach(el => el.remove());
        }
        bubbleOverlayState = { imageId: null, imageUrl: null, hostEl: null, boxes: [], boxEls: [] };
    }

    // --- Text Extraction using TreeWalker ---
    function extractVisibleTextAndNodes() {
        textNodeMap = []; // Reset the map
        let fullText = '';
        let charCounter = 0;
        const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A']);

        function isIgnored(node) {
            let parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            while (parent && parent !== document.body) {
                if (ignoredTags.has(parent.tagName)) return true;
                if (parent.offsetParent === null && parent.tagName !== 'BODY') {
                    const style = window.getComputedStyle(parent);
                    if (style.display === 'none' || style.visibility === 'hidden') return true;
                }
                parent = parent.parentElement;
            }
            return false;
        }

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT, { 
                acceptNode: function(node) {
                    if (node.nodeValue.trim().length > 0 && node.parentElement && !isIgnored(node)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            },
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const nodeText = node.nodeValue;
            const separator = (fullText.length > 0 && !/\s$/.test(fullText) && !/^\s/.test(nodeText)) ? ' ' : '';
            const processedText = separator + nodeText;

            textNodeMap.push({ node: node, text: processedText, startCharIndex: charCounter });
            fullText += processedText;
            charCounter += processedText.length;
        }

        return fullText.trim();
    }

    function getTextToSend() {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            textNodeMap = [];
            return selectedText;
        } else {
            return extractVisibleTextAndNodes();
        }
    }

    function clearHighlight() {
        if (currentHighlightElement) {
            try {
                if (currentHighlightElement.parentNode) {
                    const parent = currentHighlightElement.parentNode;
                    const textNode = document.createTextNode(currentHighlightElement.textContent);
                    parent.replaceChild(textNode, currentHighlightElement);
                    parent.normalize();
                }
            } catch (e) {
                console.error("Error clearing highlight:", e);
            } finally {
                currentHighlightElement = null;
            }
        }
    }

    function highlightWordAtCharIndex(charIndex) {
        clearHighlight();
        if (textNodeMap.length === 0) return;
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
        if (!targetEntry || indexWithinNode === -1) return;
        const node = targetEntry.node;
        const text = node.nodeValue;
        let wordStart = indexWithinNode;
        while (wordStart > 0 && !/\s|[.,!?;:]/.test(text[wordStart - 1])) { wordStart--; }
        if (/\s|[.,!?;:]/.test(text[wordStart])) { wordStart++; }
        let wordEnd = indexWithinNode;
        while (wordEnd < text.length && !/\s|[.,!?;:]/.test(text[wordEnd])) { wordEnd++; }
        if (wordStart < 0 || wordEnd > text.length || wordStart >= wordEnd) return;
        try {
            const range = document.createRange();
            range.setStart(node, wordStart);
            range.setEnd(node, wordEnd);
            const span = document.createElement('span');
            span.className = highlightClassName;
            range.surroundContents(span);
            currentHighlightElement = span;
            span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch (e) {
            console.error(`Highlight: Error creating/applying range (Start: ${wordStart}, End: ${wordEnd}, Index: ${indexWithinNode})`, e);
            clearHighlight();
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        (async () => {
            try {
                if (request.action === 'getText') {
                    sendResponse({ text: getTextToSend() });
                } else if (request.action === 'highlightCharacterIndex') {
                    highlightWordAtCharIndex(request.charIndex);
                    sendResponse({ ok: true });
                } else if (request.action === 'clearHighlight') {
                    clearHighlight();
                    sendResponse({ ok: true });
                } else if (request.action === 'getImages') {
                    const images = Array.from(document.getElementsByTagName('img'));
                    const imageUrls = images.map(img => img.src);
                    sendResponse({ imageUrls: imageUrls });
                } else if (request.action === 'getComicState') {
                    getComicState().then(state => sendResponse({ comicState: state }));
                } else if (request.action === 'startPanelSelection') {
                    startPanelSelection();
                    sendResponse({ ok: true });
                } else if (request.action === 'startComicReading') {
                    startComicReading(request.settings);
                    sendResponse({ ok: true });
                } else if (request.action === 'stopComicReading') {
                    stopComicReading();
                    sendResponse({ ok: true });
                } else if (request.action === 'setupBubbleHighlights') {
                    setupBubbleOverlays(request.imageUrl, request.imageId, request.boxes);
                    sendResponse({ ok: true });
                } else if (request.action === 'highlightBubbleIndex') {
                    highlightBubbleIndex(request.index);
                    sendResponse({ ok: true });
                } else if (request.action === 'clearBubbleHighlights') {
                    clearBubbleOverlays();
                    sendResponse({ ok: true });
                } else if (request.action === 'advancePanel') {
                    advanceToNextPanel();
                    sendResponse({ ok: true });
                }
            } catch (error) {
                console.error("Content Script Error:", error);
                sendResponse({ error: error.message });
            }
        })();
        return true;
    });

    // --- Bridge In-Page Script Injection ---
    let scriptsInjected = false;
    function injectScripts() {
        if (scriptsInjected) return;
        console.log('Injecting Tesseract and Bridge scripts into the main world...');
        const tesseractScript = document.createElement('script');
        tesseractScript.src = chrome.runtime.getURL('libs/tesseract.min.js');
        (document.head || document.documentElement).appendChild(tesseractScript);

        const bridgeScript = document.createElement('script');
        bridgeScript.src = chrome.runtime.getURL('scripts/tesseract-bridge.js');
        (document.head || document.documentElement).appendChild(bridgeScript);

        scriptsInjected = true;
    }

    const ocrPromises = new Map();

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        const { type, text, error, nonce } = event.data;
        if ((type === 'OCR_RESULT' || type === 'OCR_ERROR') && ocrPromises.has(nonce)) {
            const { resolve, reject } = ocrPromises.get(nonce);
            ocrPromises.delete(nonce);
            if (type === 'OCR_RESULT') resolve(text);
            else reject(new Error(error));
        }
    });

    function performOcrViaBridge(imageUrl) {
        return new Promise((resolve, reject) => {
            const nonce = Math.random().toString(36).substring(2, 12);
            ocrPromises.set(nonce, { resolve, reject });
            window.postMessage({ type: 'PERFORM_OCR', imageUrl, nonce }, '*');
            setTimeout(() => {
                if (ocrPromises.has(nonce)) {
                    ocrPromises.delete(nonce);
                    reject(new Error('OCR request timed out.'));
                }
            }, 60000);
        });
    }

    const getSelectorForHost = async (hostname) => {
        const key = `selector_${hostname}`;
        const data = await chrome.storage.local.get(key);
        return data[key];
    };

    const saveSelectorForHost = async (hostname, selector) => {
        const key = `selector_${hostname}`;
        await chrome.storage.local.set({ [key]: selector });
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
            handleScroll();
        }
        return comicState;
    }

    function findChapterNumber(url) {
        const patterns = [
            /(?:chapter|ch)[\/-](\d+(?:\.\d+)?)/i,
            /\/(\d+(?:\.\d+)?)(?:[^\d]|$)/,
            /(\d+(?:\.\d+)?)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) return parseFloat(match[1]);
        }
        return 0;
    }

    let isSelectionModeActive = false;
    let highlightOverlay = null;

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: absolute; background-color: rgba(137, 247, 254, 0.4); border: 2px solid #89f7fe; pointer-events: none; z-index: 999999; transition: all 0.1s ease;';
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

    function handleMouseOver(e) { updateOverlay(e.target); }

    function handleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const element = e.target;
        const selector = generateSelector(element);
        if (selector) {
            saveSelectorForHost(window.location.hostname, selector);
            chrome.runtime.sendMessage({ action: 'panelSelectionComplete' });
        }
        stopPanelSelection();
    }

    function generateSelector(el) {
        if (!el) return null;
        if (el.className) {
            const classSelector = el.className.trim().split(/\s+/).map(c => `.${c}`).join('');
            const matches = document.querySelectorAll(classSelector);
            if (matches.length > 0 && matches.length < 200) {
                return `${el.tagName.toLowerCase()}${classSelector}`;
            }
        }
        return el.tagName.toLowerCase();
    }

    function startPanelSelection() {
        if (isSelectionModeActive) return;
        isSelectionModeActive = true;
        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('click', handleClick, true);
    }

    function stopPanelSelection() {
        if (!isSelectionModeActive) return;
        isSelectionModeActive = false;
        document.removeEventListener('mouseover', handleMouseOver);
        document.removeEventListener('click', handleClick, true);
        if (highlightOverlay) { highlightOverlay.remove(); highlightOverlay = null; }
    }

    async function readCurrentPanel() {
        console.log('[Content Script] Reading current panel via bubble pipeline...');
        injectScripts();
        const panelElements = document.querySelectorAll(comicState.selector);
        if (!panelElements || panelElements.length === 0) {
            console.error('[Content Script] Cannot find panel elements with selector:', comicState.selector);
            return;
        }
        // Ensure we have a valid panel index (1-based). If not, compute from visibility.
        if (!comicState.panel || comicState.panel < 1 || comicState.panel > panelElements.length) {
            // Determine visible panel similar to handleScroll
            let currentPanel = 1;
            for (let i = 0; i < panelElements.length; i++) {
                const rect = panelElements[i].getBoundingClientRect();
                if (rect.top < (window.innerHeight * 0.5)) currentPanel = i + 1; else break;
            }
            comicState.panel = currentPanel;
            chrome.runtime.sendMessage({ action: 'updateComicState', state: comicState });
        }
        const currentPanelElement = panelElements[comicState.panel - 1];
        if (!currentPanelElement) { console.error('[Content Script] Cannot find current panel element at index:', comicState.panel - 1); return; }
        const imageElement = (currentPanelElement.tagName === 'IMG') ? currentPanelElement : currentPanelElement.querySelector('img');
        if (!imageElement || !imageElement.src) {
            console.error('[Content Script] No image found in the current panel.');
            if (comicState.isPlaying && comicState.autoAdvance) setTimeout(advanceToNextPanel, 1000);
            return;
        }
        try {
            const imageId = `${imageElement.src}#${Date.now()}`;
            chrome.runtime.sendMessage({ action: 'processImageForBubbles', imageUrl: imageElement.src, imageId });
        } catch (error) {
            console.error('[Content Script] Bubble pipeline failed:', error);
            if (comicState.isPlaying && comicState.autoAdvance) advanceToNextPanel();
        }
    }

    function startComicReading(settings) {
        if (autoAdvanceInterval) clearInterval(autoAdvanceInterval);
        comicState = { ...comicState, ...settings, isPlaying: true };
        readCurrentPanel();
        // Background advances panel after bubbles finished
        chrome.runtime.sendMessage({ action: 'updateComicState', state: comicState });
    }

    function stopComicReading() {
        if (autoAdvanceInterval) clearInterval(autoAdvanceInterval);
        autoAdvanceInterval = null;
        comicState.isPlaying = false;
        chrome.runtime.sendMessage({ action: 'stopReading' });
        chrome.runtime.sendMessage({ action: 'updateComicState', state: comicState });
    }

    function advanceToNextPanel() {
        const panelElements = document.querySelectorAll(comicState.selector);
        if (!panelElements || panelElements.length === 0) { stopComicReading(); return; }
        let nextPanelIndex = comicState.panel; // 1-based current panel
        if (comicState.readingDirection === 'rl') nextPanelIndex = comicState.totalPanels - comicState.panel;
        // nextPanelIndex here is 1-based current; move to next zero-based index for array access
        let targetIdx = nextPanelIndex; // zero-based index of next panel
        if (targetIdx >= panelElements.length) {
            if (comicState.continuousChapter) { navigateToNextChapter(); }
            else { stopComicReading(); }
            return;
        }
        // Update state BEFORE reading to avoid race with handleScroll
        comicState.panel = targetIdx + 1; // maintain 1-based
        chrome.runtime.sendMessage({ action: 'updateComicState', state: comicState });
        panelElements[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(readCurrentPanel, 500);
    }

    function navigateToNextChapter() {
        const currentUrl = window.location.href;
        const chapterNum = findChapterNumber(currentUrl);
        if (chapterNum > 0) {
            const nextChapterNum = chapterNum + 1;
            const nextUrl = currentUrl.replace(chapterNum.toString(), nextChapterNum.toString());
            if (nextUrl !== currentUrl) { window.location.href = nextUrl; }
            else { stopComicReading(); }
        } else { stopComicReading(); }
    }

    function throttle(func, limit) {
        let inThrottle; return function() { const args = arguments; const context = this; if (!inThrottle) { func.apply(context, args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } } }

    function handleScroll() {
        if (!comicState.selector || comicState.totalPanels === 0) return;
        const panelElements = document.querySelectorAll(comicState.selector);
        if (panelElements.length === 0) return;
        let currentPanel = 1;
        for (let i = 0; i < panelElements.length; i++) {
            const panel = panelElements[i];
            const rect = panel.getBoundingClientRect();
            if (rect.top < (window.innerHeight * 0.5)) currentPanel = i + 1; else break;
        }
        if (comicState.panel !== currentPanel) {
            comicState.panel = currentPanel;
            chrome.runtime.sendMessage({ action: 'updateComicState', state: comicState });
        }
    }

    window.addEventListener('scroll', throttle(handleScroll, 100));
}