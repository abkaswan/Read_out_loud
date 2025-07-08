let voices = [];
let currentUtterance = null;
let currentText = '';
let currentIndex = 0;
let currentRate = 1.0;
let currentVoice = null; // Store the SpeechSynthesisVoice object

// Function to get voices and ensure they are loaded
function loadVoices() {
    return new Promise((resolve) => {
        // Check if voices are already loaded
        if (speechSynthesis.getVoices().length > 0) {
            voices = speechSynthesis.getVoices();
            console.log("Offscreen: Voices already available.");
            resolve(voices);
            return;
        }
        // If not, wait for the event
        console.log("Offscreen: No voices found, waiting for voiceschanged event.");
        speechSynthesis.onvoiceschanged = () => {
             console.log("Offscreen: voiceschanged event fired.");
            voices = speechSynthesis.getVoices();
            // Check again inside the handler
             if (voices.length > 0) {
                resolve(voices);
            } else {
                 console.warn("Offscreen: voiceschanged fired, but still no voices?");
                 // Potentially retry or handle error state
                 resolve([]); // Resolve with empty array if still failing
            }
        };
        // Fallback timeout in case event never fires (e.g., browser bug)
        setTimeout(() => {
             if (voices.length === 0) {
                 console.warn("Offscreen: Voice loading timed out after 3 seconds.");
                 // Try one last time
                 voices = speechSynthesis.getVoices();
                 resolve(voices); // Resolve with whatever we have (might be empty)
             }
        }, 3000); // 3 second timeout
    });
}


// Find the specific voice object based on name and lang sent from popup/background
async function findVoice(voiceDetails) {
    if (!voiceDetails || !voiceDetails.name || !voiceDetails.lang) {
        return null; // Not enough info
    }
    if (voices.length === 0) {
        console.log("Offscreen: findVoice called, but voices not loaded. Loading now...");
        await loadVoices(); // Ensure voices are loaded
        if (voices.length === 0) {
             console.error("Offscreen: Failed to load voices for findVoice.");
             return null; // Still no voices after attempting load
        }
         console.log("Offscreen: Voices loaded within findVoice.");
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

    // Reset state for new speech
    currentText = text;
    currentIndex = 0;
    currentRate = rate;
    currentVoice = await findVoice(voiceDetails); // Find the voice object

    console.log(`Offscreen: Starting speak. Text length: ${currentText.length}, Rate: ${currentRate}, Voice: ${currentVoice ? currentVoice.name : 'Default'}`);

    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.rate = currentRate;

    if (currentVoice) {
        utterance.voice = currentVoice;
    } else {
        console.warn("Offscreen: Could not find requested voice, using default.");
    }

    utterance.onboundary = (event) => {
        if (event.charIndex !== undefined) {
            // --- Simpler currentIndex update ---
            currentIndex = event.charIndex; //update our internal index tracking
            //send boundary info to background
            chrome.runtime.sendMessage({action:'speechBoundary', charIndex: currentIndex});
            // console.log(`Boundary: charIndex=${event.charIndex}, Updated currentIndex to ${currentIndex}`);
        }
    };

    utterance.onend = () => {
        console.log("Offscreen: Speech finished naturally.");
        chrome.runtime.sendMessage({action:'speechStopped'}); //Tell background speech stopped
        currentUtterance = null;
        // Don't reset currentText/currentIndex here if we want potential resume later?
        // Let's keep resetting for now for simplicity on natural end.
        currentText = '';
        currentIndex = 0;
    };

    utterance.onerror = (event) => {
        // --- Ignore "interrupted" error ---
        if (event.error === 'interrupted') {
            console.log("Offscreen: Speech interrupted (expected during stop/update).");
            return; // Don't treat as a fatal error
        }
        // Log other errors
        console.error("Offscreen: SpeechSynthesis Error:", event.error);
        chrome.runtime.sendMessage({action:'speechStopped', error: event.error});//Report error
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
    console.log("Offscreen: speechSynthesis.speak() called.");
}

// Update ongoing speech with new settings
async function updateSpeechSettings(rate, voiceDetails) {
    // Check speaking state *before* doing anything else
    if (!speechSynthesis.speaking || !currentUtterance || !currentText) {
        console.log("Offscreen: Cannot update, not speaking or no current utterance/text.");
        return;
    }

    // Log state *before* making changes
    console.log(`UpdateSettings: Request received. Current index: ${currentIndex}, Speaking: ${speechSynthesis.speaking}, Utterance exists: ${!!currentUtterance}`);

    // Ensure currentIndex is within bounds of the current text
     if (currentIndex < 0 || currentIndex >= currentText.length) {
         console.warn(`UpdateSettings: Invalid currentIndex (${currentIndex}), resetting to 0.`);
         currentIndex = 0; // Reset if out of bounds
     }

    const remainingText = currentText.slice(currentIndex);
    if (!remainingText) {
        console.log("Offscreen: No remaining text to speak after slicing.");
        // Stop speech cleanly if nothing is left
        speechSynthesis.cancel();
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
        chrome.runtime.sendMessage({action:'speechStopped'});//also clear highlight
        return;
    }

    // Update target rate and voice *before* creating new utterance
    currentRate = rate;
    const newVoice = await findVoice(voiceDetails); // Find the potentially new voice

    console.log(`UpdateSettings: New Rate: ${currentRate}, New Voice: ${newVoice ? newVoice.name : 'Default'}`);

    // Create a new utterance for the remaining text
    const newUtterance = new SpeechSynthesisUtterance(remainingText);
    newUtterance.rate = currentRate;
    if (newVoice) { // Use the newly found voice
        newUtterance.voice = newVoice;
        currentVoice = newVoice; // Update the global reference
    } else if (currentVoice) { // Fallback to the previously used voice if new one not found
         console.warn("UpdateSettings: Could not find newly requested voice, reusing previous one.");
         newUtterance.voice = currentVoice;
    } else {
         console.warn("UpdateSettings: Could not find requested voice and no previous voice, using default.");
         // Let the browser use default if neither new nor previous is available
    }


    // Copy event listeners FROM THE OLD UTTERANCE IS RISKY if its state is bad.
    // Re-assign fresh listeners pointing to our handlers.
    newUtterance.onboundary = (event) => {
         if (event.charIndex !== undefined) {
             // Update based on the NEW utterance's progress
             // Need to adjust charIndex because it's relative to remainingText
             let adjustedIndex = currentIndex + event.charIndex;
             // Clamp adjustedIndex to prevent it going beyond original text length
             adjustedIndex = Math.min(adjustedIndex, currentText.length);
             // Send boundary info to background using the adjusted index
             chrome.runtime.sendMessage({
                action: 'speechBoundary',
                charIndex: adjustedIndex // Send the index relative to the original text
             });
             // Only update if it moves forward
             if(adjustedIndex > currentIndex) {
                currentIndex = adjustedIndex;
                console.log(`Boundary (Update): charIndex=${event.charIndex}, Original currentIndex=${currentIndex - event.charIndex}, Updated currentIndex to ${currentIndex}`);
             } else {
                 // console.log(`Boundary (Update): charIndex=${event.charIndex}, Adjusted index ${adjustedIndex} not greater than current ${currentIndex}. No update.`);
             }
         }
     };

    newUtterance.onend = () => {
        console.log("Offscreen: Speech finished naturally (after update).");
        chrome.runtime.sendMessage({ action: 'speechStopped' });
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    newUtterance.onerror = (event) => {
        if (event.error === 'interrupted') {
            console.log("Offscreen: Speech interrupted (expected during stop/update).");
            // DO NOT send a 'speechStopped' message here, as it's an expected interruption.
            return;
        }
        console.error("Offscreen: SpeechSynthesis Error (after update):", event.error);
        chrome.runtime.sendMessage({ action: 'speechStopped',error: event.error });
        currentUtterance = null;
        currentText = '';
        currentIndex = 0;
    };

    // --- Critical Part: Cancel OLD, Speak NEW ---
    // Update the global reference *before* speaking
    currentUtterance = newUtterance;

    // Cancel the previous utterance *before* speaking the new one
    speechSynthesis.cancel();

    // Use a tiny delay? Sometimes helps browser engines reset state.
    // await new Promise(resolve => setTimeout(resolve, 50)); // Optional: Test if needed

    // Speak the new utterance
    speechSynthesis.speak(newUtterance);
    console.log("Offscreen: Speech settings updated, speaking remaining text.");
}

// Stop speech
function stop() {
    console.log("Offscreen: Stopping speech.");
    speechSynthesis.cancel(); // This will trigger onerror('interrupted') which sends speechStopped
    // Clear state on explicit stop
    currentUtterance = null;
    currentText = '';
    currentIndex = 0;
    // Send stop message immediately as well
    chrome.runtime.sendMessage({ action: 'speechStopped' });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Offscreen received message:", message);
    if (message.action === 'speak') {
        speak(message.text, message.rate, message.voice)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                 console.error("Offscreen: Error during speak:", err);
                 sendResponse({ success: false, error: err.message });
             });
        return true; // Indicate async response
    } else if (message.action === 'stop') {
        stop();
        sendResponse({ success: true });
         return false; // Synchronous
    } else if (message.action === 'updateSettings') {
        updateSpeechSettings(message.rate, message.voice)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.error("Offscreen: Error during updateSettings:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Indicate async response
    } else {
        console.warn("Offscreen: Unknown message action:", message.action);
        sendResponse({ success: false, error: "Unknown action" });
         return false; // Synchronous
    }
});

// Initial load of voices when the script starts
loadVoices().then((loadedVoices) => {
    console.log("Offscreen: Voices loaded initially.", loadedVoices.length);
}).catch(err => {
     console.error("Offscreen: Initial voice load failed:", err);
});