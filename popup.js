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
        console.log("Popup: Voices array became empty, resetting loaded flag.");
    }

    voices = speechSynthesis.getVoices();
    const select = document.getElementById("voiceSelect");

    // Ensure select exists before proceeding
    if (!select) {
        console.error("Popup: voiceSelect element not found during loadVoices.");
        return;
    }

    uniqueVoices = voices.filter((voice, index, self) =>
        index === self.findIndex((v) => v.name === voice.name && v.lang === voice.lang)
    );

    if (!voicesLoaded && uniqueVoices.length > 0) {
        // Check if Select2 is already initialized, destroy if needed before re-populating
        if ($(select).data('select2')) {
             console.log("Popup: Destroying existing Select2 instance before reloading voices.");
            $(select).select2('destroy');
            select.innerHTML = ''; // Clear options after destroying
        } else {
             select.innerHTML = ''; // Clear options if not initialized
        }


        uniqueVoices.forEach((voice, index) => {
            const option = document.createElement("option");
            option.value = JSON.stringify({ name: voice.name, lang: voice.lang });
            option.textContent = `${voice.name} (${voice.lang})`;
            select.appendChild(option);
        });
        voicesLoaded = true;
        console.log("Popup: Voices loaded into dropdown.");
        try {
            // Initialize Select2 *after* options are populated
            $(select).select2();
            console.log("Popup: Select2 initialized.");
        } catch(e) {
            console.error("Popup: Error initializing Select2:", e);
        }
    } else if (uniqueVoices.length === 0 && !voicesLoaded) {
        console.log("Popup: Voices not loaded yet. Retrying in 500ms.");
        setTimeout(loadVoices, 500);
    } else if (voicesLoaded && uniqueVoices.length > 0) {
         // Voices already loaded, maybe Select2 needs re-initialization?
         // This path might be hit if voiceschanged fires again after initial load.
         // Consider if re-init is necessary or if the current state is fine.
         // console.log("Popup: Voices already loaded, skipping re-population.");
    }
}

// Use addEventListener for robust handling
speechSynthesis.addEventListener('voiceschanged', loadVoices);

// Directly load voices on initialization
loadVoices();


// Helper function to get selected voice details
function getSelectedVoiceDetails() {
    const select = document.getElementById("voiceSelect");
    if (!select || select.value === null || select.value === undefined || select.value === "") {
        console.error("Popup: Voice select element not ready or has no value.");
        // Fallback to first available unique voice if possible
        if (uniqueVoices.length > 0) {
             console.log("Popup: Falling back to first unique voice.");
             return { name: uniqueVoices[0].name, lang: uniqueVoices[0].lang };
        }
        return null; // No fallback possible
    }
    try {
        return JSON.parse(select.value);
    } catch (e) {
        console.error("Popup: Could not parse selected voice value:", select.value, e);
        if (uniqueVoices.length > 0) {
            console.log("Popup: Falling back to first unique voice after parse error.");
             return { name: uniqueVoices[0].name, lang: uniqueVoices[0].lang };
        }
        return null;
    }
}


// --- DELETED OLD VANILLA JS event listener ---
// document.getElementById("voiceSelect").addEventListener("change", (e) => { ... });


// --- ADDED jQuery/Select2 event listener ---
// Ensure this runs after the DOM is ready and Select2 might be initialized
$(document).ready(function() {
    // Use jQuery to select the element and attach the 'change' event listener
    // This works correctly with Select2
    $('#voiceSelect').on('change', function(e) {
        console.log("Popup: Voice select change event detected (via jQuery)."); // New log
        const rate = parseFloat(document.getElementById("speedRange").value);
        const voiceDetails = getSelectedVoiceDetails();

        if (voiceDetails) {
            chrome.runtime.sendMessage({
                action: "updateSpeechSettings",
                rate: rate,
                voice: voiceDetails
            }, response => { // Optional: Check response/lastError from background
                if (chrome.runtime.lastError) {
                     console.error("Popup: Error sending updateSpeechSettings (voice):", chrome.runtime.lastError.message);
                } else {
                     // This log should now appear
                     console.log("Popup: Sent update settings (voice change) to background.");
                }
            });
        } else {
            // Added logging if voiceDetails fails
            console.error("Popup: Could not get voice details on change event. Message not sent.");
        }
    });
});


// Handle speed change
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");

function handleSpeedChange(newValue) {
    const rate = parseFloat(newValue);
    if (isNaN(rate)) return;
    const clampedRate = Math.min(Math.max(rate, 0.5), 2);
    const formattedRate = clampedRate.toFixed(1);
    speedRange.value = formattedRate;
    speedValue.textContent = `${formattedRate}x`;
    const voiceDetails = getSelectedVoiceDetails(); // Get current voice for context
    if (voiceDetails) {
        chrome.runtime.sendMessage({
            action: "updateSpeechSettings",
            rate: clampedRate, // Send the new rate
            voice: voiceDetails // Send the *current* voice
        }, response => {
             if (chrome.runtime.lastError) {
                 console.error("Popup: Error sending updateSpeechSettings (speed):", chrome.runtime.lastError.message);
             } else {
                 console.log("Popup: Sent update settings (speed change) to background.");
             }
        });
    } else {
         console.error("Popup: Cannot send speed update, failed to get current voice details.");
    }
}

speedRange.addEventListener("input", (e) => handleSpeedChange(e.target.value));


// Helper function to attempt sending a message, with injection fallback for content.js
function sendMessageToContentScript(tabId, message, callback) {
    // ... (keep existing helper function logic) ...
     console.log(`Popup: Attempting to send message (action: ${message.action}) to tab ${tabId}`);
    chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError &&
            chrome.runtime.lastError.message.includes("Receiving end does not exist"))
        {
            console.warn(`Popup: Initial sendMessage failed ('Receiving end does not exist'). Attempting to inject content script for tab ${tabId}.`);
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["content.js"]
            }).then(() => {
                console.log(`Popup: Content script potentially injected for tab ${tabId}. Retrying sendMessage.`);
                chrome.tabs.sendMessage(tabId, message, callback);
            }).catch(injectionError => {
                console.error(`Popup: Failed to inject content script for tab ${tabId}:`, injectionError);
                const lastError = chrome.runtime.lastError;
                callback({ error: `Failed to inject content script: ${injectionError.message}` });
            });
        } else {
             // console.log(`Popup: Initial sendMessage to tab ${tabId} completed.`); // Less verbose
            callback(response);
        }
    });
}

// Read selected text Button (Keep existing logic using the helper)
document.addEventListener("DOMContentLoaded", () => {
    const instructionsHeader = document.querySelector(".instructions-header");
    const instructionsList = document.querySelector(".instructions-list");

    instructionsHeader.addEventListener("click", () => {
        instructionsList.classList.toggle("hidden");
    });

    // Request the full UI state from the background script
    chrome.runtime.sendMessage({ action: "getUiState" }, (response) => {
        if (response) {
            // Set play/pause button state
            setButtonState(response.isPlaying);

            // Set speed slider
            if (response.rate) {
                const speedRange = document.getElementById("speedRange");
                const speedValue = document.getElementById("speedValue");
                speedRange.value = response.rate;
                speedValue.textContent = `${response.rate.toFixed(1)}x`;
            }

            // Set voice dropdown, but only after voices are loaded
            if (response.voice) {
                const voiceSelect = document.getElementById("voiceSelect");
                const checkVoicesLoadedInterval = setInterval(() => {
                    if (voicesLoaded && $(voiceSelect).data('select2')) {
                        clearInterval(checkVoicesLoadedInterval);
                        const voiceValue = JSON.stringify({ name: response.voice.name, lang: response.voice.lang });
                        // Check if the option exists before trying to select it
                        if ($(voiceSelect).find(`option[value='${voiceValue}']`).length) {
                            $(voiceSelect).val(voiceValue).trigger('change.select2');
                        } else {
                            console.warn("Popup: Stored voice not found in current voice list.", response.voice);
                        }
                    }
                }, 50); // Check every 50ms
            }
        }
    });
});

const playPauseBtn = document.getElementById("playPauseBtn");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");

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

playPauseBtn.addEventListener("click", () => {
    if (isPlaying) {
        chrome.runtime.sendMessage({ action: "stopReading" });
        setButtonState(false);
    } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0 || !tabs[0]) { console.error("Popup: No active tab found."); alert("No active tab found."); return; }
            const tab = tabs[0];
            if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) { alert("This extension cannot work on browser internal pages."); return; }
            if (!tab.id) { console.error("Popup: Active tab has no ID."); alert("Cannot access this tab."); return; }
            const tabId = tab.id;

            sendMessageToContentScript(tabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) { /* ... error handling ... */ return; }

                if (response && typeof response.text === 'string') {
                    if (response.text.length > 0) {
                        const rate = parseFloat(document.getElementById("speedRange").value);
                        const voiceDetails = getSelectedVoiceDetails();
                        if (voiceDetails) {
                            chrome.runtime.sendMessage({
                                action: "startReading",
                                text: response.text,
                                rate: rate,
                                voice: voiceDetails
                            });
                            setButtonState(true);
                        } else { /* ... error handling ... */ }
                    } else { /* ... handle empty text ... */ }
                } else if (response && response.error) { /* ... error handling ... */ }
                else { /* ... error handling ... */ }
            });
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "speechStopped") {
        setButtonState(false);
    }
});

const refreshBtn = document.getElementById("refreshBtn");

refreshBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "refreshState" }, () => {
        // Reset UI elements to their default state
        setButtonState(false);
        const speedRange = document.getElementById("speedRange");
        const speedValue = document.getElementById("speedValue");
        speedRange.value = 1;
        speedValue.textContent = "1.0x";
        // You might need to reload voices or reset the voice selector
        // depending on the desired refresh behavior.
        // For a simple reset, we just update the UI.
        console.log("Popup: Refresh button clicked, state reset.");
    });
});

