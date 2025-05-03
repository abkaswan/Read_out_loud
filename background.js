const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenDocument = null; // Promise

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
    // Use a switch statement for clarity
    switch (message.action) {
        case 'startReading':
            console.log("Background: Received startReading");
            handleStartReading(message.text, message.rate, message.voice);
            sendResponse({ success: true });
            break;

        case 'stopReading':
            console.log("Background: Received stopReading");
            handleStopReading();
            sendResponse({ success: true });
            break;

        case 'updateSpeechSettings':
             console.log("Background: Received updateSpeechSettings");
             handleUpdateSettings(message.rate, message.voice);
             sendResponse({ success: true });
             break;

        // Messages potentially coming FROM the offscreen document (optional)
        case 'speechEnded':
            console.log("Background: Speech ended message from offscreen.");
            // Maybe close the offscreen document after a delay?
            // closeOffscreenDocument(); // Or manage lifecycle differently
            break;
        case 'speechError':
            console.error("Background: Speech error message from offscreen:", message.error);
             // Maybe close the offscreen document?
            // closeOffscreenDocument();
            break;

        default:
            console.warn("Background: Received unknown message action:", message.action);
            sendResponse({ success: false, error: "Unknown action" });
    }

    // Return true to indicate you might send a response asynchronously
    // (although in this setup, responses are sent synchronously)
    return true;
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
    });
    console.log("Background: Sent 'speak' message to offscreen.");
}

async function handleStopReading() {
    // Don't necessarily close the document immediately, just stop speech
    if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
             action: 'stop',
             target: 'offscreen'
        });
        console.log("Background: Sent 'stop' message to offscreen.");
        // Decide if you want to close the offscreen doc now or later
        // closeOffscreenDocument();
    } else {
        console.log("Background: Cannot stop, no offscreen document.");
    }
}


async function handleUpdateSettings(rate, voice) {
     if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
             action: 'updateSettings',
             rate: rate,
             voice: voice,
             target: 'offscreen'
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