let voices = [];
let voicesLoaded = false;

// Initialize voice selection - KEEP THIS for the UI
function loadVoices() {
    // Reset voicesLoaded flag if voices array becomes empty (e.g., browser issue)
    if (speechSynthesis.getVoices().length === 0) {
      voicesLoaded = false;
      console.log("Popup: Voices array empty, resetting loaded flag.");
    }

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

// Helper function to attempt sending a message, with injection fallback for content.js
function sendMessageToContentScript(tabId, message, callback) {
  console.log(`Popup: Attempting to send message (action: ${message.action}) to tab ${tabId}`);
  chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError &&
          chrome.runtime.lastError.message.includes("Receiving end does not exist"))
      {
          console.warn(`Popup: Initial sendMessage failed ('Receiving end does not exist'). Attempting to inject content script for tab ${tabId}.`);
          // Inject ONLY content.js
          chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ["content.js"] // Only inject content.js now
          }).then(() => {
              console.log(`Popup: Content script potentially injected for tab ${tabId}. Retrying sendMessage.`);
              // Retry sending the message
              chrome.tabs.sendMessage(tabId, message, callback);
          }).catch(injectionError => {
              console.error(`Popup: Failed to inject content script for tab ${tabId}:`, injectionError);
              const lastError = chrome.runtime.lastError; // Store potential error from failed send before callback
              callback({ error: `Failed to inject content script: ${injectionError.message}` });
          });
      } else {
           console.log(`Popup: Initial sendMessage to tab ${tabId} completed.`);
          callback(response); // Call original callback if no specific error or different error
      }
  });
}

// Read selected text Button
document.getElementById("readText").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0]) { console.error("Popup: No active tab found."); alert("No active tab found."); return; }
      const tab = tabs[0];
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) { alert("This extension cannot work on browser internal pages."); return; }
      if (!tab.id) { console.error("Popup: Active tab has no ID."); alert("Cannot access this tab."); return; }
      const tabId = tab.id;

      sendMessageToContentScript(tabId, { action: "getText" }, (response) => {
           if (chrome.runtime.lastError) {
              console.error("Popup: Error receiving 'getText' response:", chrome.runtime.lastError.message);
              alert("Could not get text from the page. Please try refreshing the page. Error: " + chrome.runtime.lastError.message);
              return;
          }

          if (response && typeof response.text === 'string') { // Check if text exists and is a string
              if (response.text.length > 0) {
                  console.log("Popup: Received text from content script:", response.text.substring(0, 100) + "...");
                  const rate = parseFloat(document.getElementById("speedRange").value);
                  const voiceDetails = getSelectedVoiceDetails();
                  if (voiceDetails) {
                      chrome.runtime.sendMessage({
                          action: "startReading",
                          text: response.text,
                          rate: rate,
                          voice: voiceDetails
                      }, bgResponse => {
                           if (chrome.runtime.lastError) {
                              console.error("Popup: Error sending startReading to background:", chrome.runtime.lastError.message);
                           } else {
                              console.log("Popup: Sent 'startReading' message to background.");
                           }
                      });
                  } else {
                      console.error("Popup: No voice selected, cannot start reading.");
                      alert("Please select a voice first.");
                  }
              } else {
                   console.log("Popup: Received empty text string from content script.");
                   alert("No text found on the page or in the selection.");
              }
          } else if (response && response.error) {
              console.error("Popup: Error reported by content script:", response.error);
              alert("Error getting text from page: " + response.error);
          } else {
              console.log("Popup: No text or unexpected response received from content script for 'getText'. Response:", response);
               alert("Could not retrieve text from the page. Please ensure the page is fully loaded.");
          }
      });
  });
});


// Read images via OCR Button - SIMPLIFIED
document.getElementById("readImages").addEventListener("click", () => {
console.log("Popup: 'Read Text from Images' clicked.");
alert("Reading text from images is under development.");
// No communication needed with content/background scripts for now
});


// Stop button - Send stop message to background
document.getElementById("stopText").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stopReading" }, response => {
      if (chrome.runtime.lastError) {
          console.error("Popup: Error sending stopReading to background:", chrome.runtime.lastError.message);
      } else {
          console.log("Popup: Sent 'stopReading' message to background.");
      }
  });
});
