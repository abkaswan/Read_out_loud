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
        NodeFilter.SHOW_TEXT,
        { // Filter function
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

     console.log(`Content Script: Extracted ${textNodeMap.length} text nodes. Total chars: ${fullText.length}`);
    return fullText.trim();
}

// Function to get selected text (fallback to extracting all)
function getTextToSend() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        console.log("Content Script: Using selected text.");
        // For selected text, highlighting is harder as we don't have the node map easily.
        // For simplicity, we won't highlight selected text in this version.
        // Clear any previous node map if switching from full-page reading.
        textNodeMap = [];
        return selectedText;
    } else {
        console.log("Content Script: No selection, extracting all visible text.");
        // Extract text and build the node map for highlighting
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
        // console.log("Highlight: No textNodeMap available (likely reading selected text). Cannot highlight.");
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
        console.warn(`Highlight: Could not find node for charIndex ${charIndex}`);
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
        console.warn(`Highlight: Invalid word boundaries calculated (Start: ${wordStart}, End: ${wordEnd}) for index ${indexWithinNode} in text:`, text);
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
        span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    } catch (e) {
        console.error(`Highlight: Error creating/applying range (Start: ${wordStart}, End: ${wordEnd}, Index: ${indexWithinNode})`, e);
        // Clear any potentially broken state
        clearHighlight();
    }
}


// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.action === 'getText') {
            const text = getTextToSend(); // This now potentially builds textNodeMap
            console.log("Content Script: Sending text:", text.substring(0, 100) + "...");
            sendResponse({ text: text });
        } else if (request.action === 'highlightCharacterIndex') {
            // console.log("Content Script: Received highlight request for index:", request.charIndex); // Verbose log
            highlightWordAtCharIndex(request.charIndex);
            // No response needed for highlight commands
        } else if (request.action === 'clearHighlight') {
            console.log("Content Script: Received request to clear highlight.");
            clearHighlight();
            // No response needed
        }
        else {
            console.log("Content Script: Unknown action", request.action);
        }
    } catch (error) {
        console.error("Content Script: Error processing message:", request.action, error);
        // Don't send response for highlight/clear errors, just log
        if (request.action === 'getText') {
             sendResponse({ error: error.message });
        }
    }
    // Return true only for async potential (getText might be considered async if extraction is slow)
    return request.action === 'getText';
});

console.log("Content script loaded (with highlighting).");
