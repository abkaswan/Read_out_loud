const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenDocument = null; // Promise
let activeSpeechTabId = null; // <--- STORE THE TAB ID FOR CURRENT SPEECH
let lastVoice = null;
let lastRate = 1.0;

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
                 // Also notify the popup to reset its button state
                 chrome.runtime.sendMessage({ action: 'speechStopped' }).catch(err => console.warn("Could not inform popup of speech stop:", err.message));
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
                        lastVoice = message.voice; // Store settings
                        lastRate = message.rate;
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

            case 'getUiState':
                sendResponse({ isPlaying: activeSpeechTabId !== null, voice: lastVoice, rate: lastRate });
                break;

            case 'refreshState':
                console.log("Background: Received refreshState. Stopping any active speech.");
                handleStopReading(); // This will trigger the full cleanup via speechStopped
                // Reset stored settings
                lastVoice = null;
                lastRate = 1.0;
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

// --- Keyboard Shortcut Commands ---
chrome.commands.onCommand.addListener((command) => {
    console.log(`Background: Command received: ${command}`);
    switch (command) {
        case 'toggle-play-pause':
            // This logic needs to be smart: if playing, stop; if not playing, start.
            // We can check `activeSpeechTabId` to know the state.
            if (activeSpeechTabId !== null) {
                console.log("Background: Command toggling to PAUSE.");
                handleStopReading();
            } else {
                console.log("Background: Command toggling to PLAY.");
                // To play, we need the text from the content script.
                // This is tricky because we don't have the popup's context.
                // We'll message the content script of the *active* tab.
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs && tabs.length > 0 && tabs[0].id) {
                        const tabId = tabs[0].id;
                        // We need to inject content.js if it's not there
                        chrome.tabs.sendMessage(tabId, { action: "getText" }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.warn("Background: Failed to get text for play command, maybe content script not injected.", chrome.runtime.lastError.message);
                                // Attempt to inject and retry
                                chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    files: ["content.js"]
                                }).then(() => {
                                    chrome.tabs.sendMessage(tabId, { action: "getText" }, (response) => {
                                        if (response && typeof response.text === 'string' && response.text.length > 0) {
                                            handleStartReading(response.text, lastRate, lastVoice);
                                        } else {
                                            console.error("Background: Failed to get text even after injection.");
                                        }
                                    });
                                }).catch(err => console.error("Background: Failed to inject content script on command:", err));
                                return;
                            }

                            if (response && typeof response.text === 'string' && response.text.length > 0) {
                                activeSpeechTabId = tabId; // Set the active tab
                                handleStartReading(response.text, lastRate, lastVoice);
                            } else {
                                console.log("Background: No text received from content script for play command.");
                            }
                        });
                    }
                });
            }
            break;
        case 'refresh-state':
            console.log("Background: Command to REFRESH state.");
            handleStopReading();
            lastVoice = null;
            lastRate = 1.0;
            // Also notify the popup if it's open
            chrome.runtime.sendMessage({ action: 'refreshState' }).catch(err => {});
            break;
    }
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
    lastRate = rate;
    lastVoice = voice;
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