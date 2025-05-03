let voices = [];
let voicesLoaded = false;
// Remove global state related to speech playback:
// let currentUtterance = null;
// let currentText = '';
// let currentIndex = 0;

// Initialize voice selection - KEEP THIS for the UI
function loadVoices() {
    voices = speechSynthesis.getVoices();
    const select = document.getElementById("voiceSelect");

    // Filter voices for uniqueness if needed, sometimes duplicates appear
    const uniqueVoices = voices.filter((voice, index, self) =>
        index === self.findIndex((v) => v.name === voice.name && v.lang === voice.lang)
    );


    if (!voicesLoaded && uniqueVoices.length > 0) {
        select.innerHTML = ''; // Clear previous options
        uniqueVoices.forEach((voice, index) => {
            const option = document.createElement("option");
            // Store essential details needed by the offscreen script
            option.value = JSON.stringify({ name: voice.name, lang: voice.lang });
            option.textContent = `${voice.name} (${voice.lang})`;
            select.appendChild(option);
        });
        voicesLoaded = true; // Mark as loaded
        console.log("Popup: Voices loaded into dropdown.");

        // Initialize Select2 after options are populated
         $('#voiceSelect').select2();

    } else if (uniqueVoices.length === 0 && !voicesLoaded) {
        console.log("Popup: Voices not loaded yet. Retrying in 500ms.");
        // Use setTimeout to avoid blocking if voices aren't ready immediately
        setTimeout(loadVoices, 500);
    }
}

// Add event listener for voiceschanged
// Use 'once' to avoid multiple rapid calls if the event fires often initially
speechSynthesis.addEventListener('voiceschanged', loadVoices, { once: true });


// Directly load voices on initialization as fallback
loadVoices();


// Helper function to get selected voice details
function getSelectedVoiceDetails() {
    const select = document.getElementById("voiceSelect");
    try {
        // Parse the stored JSON string
        return JSON.parse(select.value);
    } catch (e) {
        console.error("Popup: Could not parse selected voice value:", select.value, e);
        // Fallback logic: maybe return the first voice's details?
        if (voices.length > 0) {
             return { name: voices[0].name, lang: voices[0].lang };
        }
        return null; // Or handle error appropriately
    }
}

// Handle voice change - Send update message to background
document.getElementById("voiceSelect").addEventListener("change", (e) => {
    // No need to check speechSynthesis.speaking here.
    // Just send the update request to the background script.
    // The background/offscreen will decide if it's relevant.
    const rate = parseFloat(document.getElementById("speedRange").value);
    const voiceDetails = getSelectedVoiceDetails();
    if (voiceDetails) {
        chrome.runtime.sendMessage({
            action: "updateSpeechSettings",
            rate: rate,
            voice: voiceDetails
        });
        console.log("Popup: Sent update settings (voice change) to background.");
    }
});

// Handle speed change
const speedRange = document.getElementById("speedRange");
const speedInput = document.getElementById("speedInput");
const speedValue = document.getElementById("speedValue");

function handleSpeedChange(newValue) {
    const rate = parseFloat(newValue);
    if (isNaN(rate)) return;

    const clampedRate = Math.min(Math.max(rate, 0.5), 2); // Clamp
    const formattedRate = clampedRate.toFixed(1);

    // Update both controls and display
    speedRange.value = formattedRate;
    speedInput.value = formattedRate;
    speedValue.textContent = `${formattedRate}x`;

    // Send update message to background
    const voiceDetails = getSelectedVoiceDetails();
     if (voiceDetails) {
        chrome.runtime.sendMessage({
            action: "updateSpeechSettings",
            rate: clampedRate,
            voice: voiceDetails
        });
         console.log("Popup: Sent update settings (speed change) to background.");
    }
}

// Update numeric input and display when slider changes
speedRange.addEventListener("input", (e) => {
    handleSpeedChange(e.target.value);
});

// Update slider and display when numeric input changes
speedInput.addEventListener("input", (e) => {
    handleSpeedChange(e.target.value);
});


// REMOVE restartReading function - background handles updates

// REMOVE startReadingText function - background handles starting


// Read selected text Button
document.getElementById("readText").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0 || !tabs[0]) {
            console.error("Popup: No active tab found.");
            alert("No active tab found.");
            return;
        }
        const tab = tabs[0];
        if (tab.url && tab.url.startsWith("chrome://")) {
            alert("This extension cannot work on chrome:// pages.");
            return;
        }
        if (!tab.id) {
             console.error("Popup: Active tab has no ID.");
             alert("Cannot access this tab.");
             return;
        }
        const tabId = tab.id;

        // Ensure content script is injected before sending message
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"] // Assuming tesseract is already injected via manifest
        }).then(() => {
            console.log("Popup: Content script ensured/injected.");
            // Send message to content script to get text
            chrome.tabs.sendMessage(tabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Popup: Error sending 'getText' message:", chrome.runtime.lastError.message);
                    // Attempt to reload the extension or ask user to refresh page?
                     alert("Could not communicate with the page. Please refresh the page and try again.");
                    return;
                }

                if (response && response.text) {
                    console.log("Popup: Received text from content script:", response.text.substring(0, 100) + "...");
                    // Send text to background script to start reading
                    const rate = parseFloat(document.getElementById("speedRange").value);
                    const voiceDetails = getSelectedVoiceDetails();
                     if (voiceDetails) {
                        chrome.runtime.sendMessage({
                            action: "startReading",
                            text: response.text,
                            rate: rate,
                            voice: voiceDetails // Send voice details
                        });
                         console.log("Popup: Sent 'startReading' message to background.");
                    } else {
                         console.error("Popup: No voice selected, cannot start reading.");
                         alert("Please select a voice first.");
                    }
                } else if (response && response.error) {
                     console.error("Popup: Error from content script:", response.error);
                     alert("Error getting text from page: " + response.error);
                } else {
                     console.log("Popup: No text received from content script.");
                    // Optionally inform the user, or just don't start reading
                    // alert("No text found on the page or in selection.");
                }
            });
        }).catch(err => {
            console.error("Popup: Error injecting content script:", err);
            alert("Error setting up connection with the page: " + err.message);
        });
    });
});


// Read images via OCR Button
document.getElementById("readImages").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0 || !tabs[0] || !tabs[0].id) {
            console.error("Popup: No active tab found for OCR.");
             alert("No active tab found.");
            return;
        }
         const tabId = tabs[0].id;

          // Ensure content script is injected before sending message (important for OCR setup)
        chrome.scripting.executeScript({
            target: { tabId: tabId },
             // Make sure both are listed if needed, though manifest usually handles this
            files: ["libs/tesseract.min.js", "content.js"]
        }).then(() => {
             console.log("Popup: Content script ensured/injected for OCR.");
             chrome.tabs.sendMessage(tabId, { action: "extractImageText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Popup: Error sending 'extractImageText' message:", chrome.runtime.lastError.message);
                     alert("Could not communicate with the page for OCR. Please refresh the page and try again.");
                    return;
                }

                if (response && response.text) {
                    console.log("Popup: Received image text from content script:", response.text.substring(0, 100) + "...");
                    // Send text to background script to start reading
                    const rate = parseFloat(document.getElementById("speedRange").value);
                    const voiceDetails = getSelectedVoiceDetails();
                     if (voiceDetails) {
                        chrome.runtime.sendMessage({
                            action: "startReading",
                            text: response.text,
                            rate: rate,
                            voice: voiceDetails // Send voice details
                        });
                         console.log("Popup: Sent 'startReading' (image text) message to background.");
                    } else {
                         console.error("Popup: No voice selected, cannot start reading image text.");
                         alert("Please select a voice first.");
                    }
                } else if (response && response.error) {
                    console.error("Popup: Error from content script OCR:", response.error);
                    alert("Error extracting text from images: " + response.error);
                } else {
                    console.log("Popup: No text received from image OCR.");
                    alert("No text found in images on the page.");
                }
            });
        }).catch(err => {
            console.error("Popup: Error injecting script for OCR:", err);
            alert("Error setting up connection for image reading: " + err.message);
        });
    });
});


// Stop button - Send stop message to background
document.getElementById("stopText").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "stopReading" });
    console.log("Popup: Sent 'stopReading' message to background.");
});


// Initialize Select2 (moved inside loadVoices to ensure options exist first)
// $(document).ready(function() {
//     $('#voiceSelect').select2();
// });
