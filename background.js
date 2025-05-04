const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenDocument = null; // Promise
let activeSpeechTabId = null; // <--- STORE THE TAB ID FOR CURRENT SPEECH

// --- Offscreen Document Management ---

// Function to check if an offscreen document exists
async function hasOffscreenDocument() {
    // Check all windows controlled by the service worker to see if one exists
    // Filter documents by path to prevent conflicts with other offscreen documents.
    const matchedClients = await clients.matchAll();
    return matchedClients.some(
        (c) => c.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
    );
}


// Function to create the offscreen document
async function setupOffscreenDocument() {
    // If we don't have an offscreen document, create one.
    if (!(await hasOffscreenDocument())) {
        // Create the document
        if (creatingOffscreenDocument) {
            await creatingOffscreenDocument;
        } else {
            creatingOffscreenDocument = chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK], // Or just AUDIO_PLAYBACK if USER_MEDIA isn't needed
                justification: 'Needed for text-to-speech synthesis',
            });
            await creatingOffscreenDocument;
            creatingOffscreenDocument = null;
        }
         console.log("Background: Offscreen document created.");
    } else {
         console.log("Background: Offscreen document already exists.");
    }
}

// Function to close the offscreen document
async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        console.log("Background: No offscreen document to close.");
        return;
    }
    await chrome.offscreen.closeDocument();
    console.log("Background: Offscreen document closed.");
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check if message is from offscreen document or elsewhere (e.g., popup)
    const isFromOffscreen = sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

    if (isFromOffscreen) {
        // Handle messages FROM Offscreen
        switch (message.action) {
            case 'speechBoundary':
                // Relay to content script if we know the active tab
                if (activeSpeechTabId !== null) {
                    // console.log(`Background: Relaying boundary index ${message.charIndex} to tab ${activeSpeechTabId}`); // Verbose
                    chrome.tabs.sendMessage(activeSpeechTabId, {
                        action: 'highlightCharacterIndex',
                        charIndex: message.charIndex
                    }).catch(err => { // Catch error if tab is closed
                         console.warn(`Background: Failed to send highlight to tab ${activeSpeechTabId}: ${err.message}. Clearing tab ID.`);
                         clearActiveSpeechTab(); // Clear if tab is gone
                    });
                }
                break;
            case 'speechStopped':
                 console.log("Background: Received speechStopped from offscreen.", message.error ? `Error: ${message.error}` : "");
                 // Tell content script to clear highlight and clear our tracked tab ID
                 clearActiveSpeechTab();
                break;
             // We don't expect other actions from offscreen currently
             default:
                 console.warn("Background: Received unknown message action from Offscreen:", message.action);
        }
         // No response needed for messages from offscreen
    } else {
        // Handle messages FROM Popup or Content Script
        switch (message.action) {
            case 'startReading':
                console.log("Background: Received startReading");
                // Store the tab ID from the sender (popup gets it via query)
                // We assume the popup message originates from interaction with the active tab
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs && tabs.length > 0 && tabs[0].id) {
                        activeSpeechTabId = tabs[0].id; // Store the tab ID
                        console.log(`Background: Stored active speech tab ID: ${activeSpeechTabId}`);
                        handleStartReading(message.text, message.rate, message.voice);
                        sendResponse({ success: true });
                    } else {
                        console.error("Background: Could not get active tab ID for startReading.");
                         activeSpeechTabId = null; // Ensure it's cleared
                        sendResponse({ success: false, error: "Could not identify active tab" });
                    }
                });
                return true; // Indicate async response due to tabs.query

            case 'stopReading':
                console.log("Background: Received stopReading from popup");
                 // Don't clear activeSpeechTabId here, let the 'speechStopped' message from offscreen handle it
                 // after cancel() propagates. Just send the stop command.
                handleStopReading();
                sendResponse({ success: true });
                break;

            case 'updateSpeechSettings':
                console.log("Background: Received updateSpeechSettings");
                // No need to update tab ID, just forward settings
                handleUpdateSettings(message.rate, message.voice);
                sendResponse({ success: true });
                break;

            default:
                console.warn("Background: Received unknown message action from Popup/Content:", message.action);
                sendResponse({ success: false, error: "Unknown action" });
        }
    }

    // Return true for async responses (like startReading)
     return message.action === 'startReading' && !isFromOffscreen;
});

// --- Action Handlers ---

async function handleStartReading(text, rate, voice) {
    await setupOffscreenDocument(); // Ensure offscreen document is ready
    // Send message to the offscreen document to start speaking
    await chrome.runtime.sendMessage({
        action: 'speak',
        text: text,
        rate: rate,
        voice: voice, // Send voice details (name, lang)
        target: 'offscreen' // Optional: target hint for clarity
    }).catch(err => {
        console.error("Background: Error sending 'speak' message to offscreen:", err);
        clearActiveSpeechTab(); // clear tab if we can't even start
    });
    console.log("Background: Sent 'speak' message to offscreen.");
}

async function handleStopReading() {
    // Don't necessarily close the document immediately, just stop speech
    if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
             action: 'stop',
             target: 'offscreen'
        }).catch(err => {
            console.error("Background: Error sending 'stop' message to offscreen:", err);
        });
        console.log("Background: Sent 'stop' message to offscreen.");
        // Don't clear activeSpeechTabId here, wait for confirmation via 'speechStopped'
    } else {
        console.log("Background: Cannot stop, no offscreen document.");
        // If no offscreen doc, we assume speech isn't happening, clear the tab ID
        clearActiveSpeechTab();
    }
}

// --- Helper to clear highlighting and tab ID ---
function clearActiveSpeechTab() {
    if (activeSpeechTabId !== null) {
        console.log(`Background: Clearing highlight and active tab ID: ${activeSpeechTabId}`);
        chrome.tabs.sendMessage(activeSpeechTabId, { action: 'clearHighlight' })
            .catch(err => console.warn(`Background: Failed to send clearHighlight to tab ${activeSpeechTabId}: ${err.message}. Tab might be closed.`));
        activeSpeechTabId = null; // Clear the stored ID
    }
}

async function handleUpdateSettings(rate, voice) {
     if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
             action: 'updateSettings',
             rate: rate,
             voice: voice,
             target: 'offscreen'
        }).catch(err => {
            console.error("Background: Error sending 'updateSettings' message to offscreen:", err);
        });
        console.log("Background: Sent 'updateSettings' message to offscreen.");
    } else {
        console.log("Background: Cannot update settings, no offscreen document.");
    }
}


// Optional: Add listeners for cleanup, e.g., when the extension is updated/disabled
chrome.runtime.onSuspend.addListener(() => {
  console.log("Background: Extension suspending.");
  closeOffscreenDocument(); // Clean up on suspension
});
// Add listener for tab closure to potentially clear state
chrome.tabs.onRemoved.addListener(tabId => {
    if (tabId === activeSpeechTabId) {
        console.log(`Background: Active speech tab ${tabId} closed. Stopping speech and clearing state.`);
        handleStopReading(); //Attempt to stop offscreen speech
        //clearActiveSpeechTab();  // handleStopReading should trigger this via speechStopped
    }
});