let voices = [];
let currentUtterance = null;
let currentText = '';
let currentIndex = 0;
let currentRate = 1.0;
let currentVoice = null; // Store the SpeechSynthesisVoice object

// Function to get voices and ensure they are loaded
function loadVoices() {
    return new Promise((resolve) => {
        voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            resolve(voices);
        } else {
            speechSynthesis.onvoiceschanged = () => {
                voices = speechSynthesis.getVoices();
                resolve(voices);
            };
        }
    });
}

// Find the specific voice object based on name and lang sent from popup/background
async function findVoice(voiceDetails) {
    if (!voiceDetails || !voiceDetails.name || !voiceDetails.lang) {
        return null; // Not enough info
    }
    if (voices.length === 0) {
        await loadVoices(); // Ensure voices are loaded
    }
    return voices.find(v => v.name === voiceDetails.name && v.lang === voiceDetails.lang) || null;
}

// Start or restart speech
async function speak(text, rate, voiceDetails) {
    speechSynthesis.cancel(); // Stop any current speech

    if (!text) {
        console.log("Offscreen: No text to speak.");
        currentText = '';
        currentIndex = 0;
        currentUtterance = null;
        return;
    }

    currentText = text;
    currentIndex = 0; // Always start from the beginning for a new speak call
    currentRate = rate;
    currentVoice = await findVoice(voiceDetails); // Find the voice object

    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.rate = currentRate;

    if (currentVoice) {
        utterance.voice = currentVoice;
    } else {
        console.warn("Offscreen: Could not find requested voice, using default.");
        // Let the browser use the default if not found or not specified
    }

    utterance.onboundary = (event) => {
        // Estimate current index based on boundary events
        // Note: charIndex might not be perfectly accurate across all engines/pauses
        if (event.charIndex !== undefined) {
            // A simple heuristic: assume boundary marks progress
             currentIndex = event.charIndex + (event.charLength || 1);
        }
        // console.log(`Boundary: charIndex=${event.charIndex}, current=${currentIndex}`);
    };

    utterance.onend = () => {
        console.log("Offscreen: Speech finished.");
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
        // Optional: Send message back to background script if needed
        // chrome.runtime.sendMessage({ action: "speechEnded" });
    };

    utterance.onerror = (event) => {
        console.error("Offscreen: SpeechSynthesis Error:", event.error);
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
         // Optional: Send message back to background script
        // chrome.runtime.sendMessage({ action: "speechError", error: event.error });
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
    console.log("Offscreen: Speaking started.");
}

// Update ongoing speech with new settings
async function updateSpeechSettings(rate, voiceDetails) {
    if (!speechSynthesis.speaking || !currentUtterance || !currentText) {
        console.log("Offscreen: Cannot update, not speaking.");
        return;
    }

    const remainingText = currentText.slice(currentIndex);
    console.log(`Offscreen: Updating speech. Remaining chars: ${remainingText.length}, Current index: ${currentIndex}`);

    if (!remainingText) {
        console.log("Offscreen: No remaining text to speak.");
        speechSynthesis.cancel();
        currentUtterance = null;
        return;
    }

    // Update rate and voice for the *next* utterance
    currentRate = rate;
    currentVoice = await findVoice(voiceDetails);

    // Create a new utterance for the remaining text
    const newUtterance = new SpeechSynthesisUtterance(remainingText);
    newUtterance.rate = currentRate;
    if (currentVoice) {
        newUtterance.voice = currentVoice;
    }

    // Copy event listeners
    newUtterance.onboundary = currentUtterance.onboundary;
    newUtterance.onend = currentUtterance.onend;
    newUtterance.onerror = currentUtterance.onerror;

    // Cancel current and speak new one immediately
    currentUtterance = newUtterance; // Update the reference
    speechSynthesis.cancel();
    speechSynthesis.speak(newUtterance);
    console.log("Offscreen: Speech settings updated.");
}

// Stop speech
function stop() {
    console.log("Offscreen: Stopping speech.");
    speechSynthesis.cancel();
    currentUtterance = null;
    currentText = '';
    currentIndex = 0;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Offscreen received message:", message);
    if (message.action === 'speak') {
        speak(message.text, message.rate, message.voice);
        sendResponse({ success: true });
    } else if (message.action === 'stop') {
        stop();
        sendResponse({ success: true });
    } else if (message.action === 'updateSettings') {
        updateSpeechSettings(message.rate, message.voice);
        sendResponse({ success: true });
    } else {
        console.warn("Offscreen: Unknown message action:", message.action);
        sendResponse({ success: false, error: "Unknown action" });
    }
    // Return true to indicate asynchronous response if needed, though not strictly necessary here
    return true;
});

// Initial load of voices when the script starts
loadVoices().then(() => {
    console.log("Offscreen: Voices loaded initially.", voices.length);
});