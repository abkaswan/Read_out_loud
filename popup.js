let voices = [];
let voicesLoaded = false;
let currentUtterance = null;
let currentText = '';
let currentIndex = 0;

// Initialize voice selection
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const select = document.getElementById("voiceSelect");
  
  if (!voicesLoaded && voices.length > 0) {
    select.innerHTML = '';
    voices.forEach((voice, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = `${voice.name} (${voice.lang})`;
      select.appendChild(option);
    });
    voicesLoaded = true; // Mark as loaded
  } else if (voices.length === 0) {
    console.log("Voices not loaded yet. Retrying in 500ms.");
    setTimeout(loadVoices, 500);
  }
}

// Add event listener for voiceschanged
speechSynthesis.onvoiceschanged = loadVoices;

// Directly load voices on initialization as fallback
loadVoices();

// Handle voice change
document.getElementById("voiceSelect").addEventListener("change", (e) => {
  if (speechSynthesis.speaking) {
    const rate = currentUtterance.rate;
    restartReading(rate);
  }
});

// Handle speed change
const speedRange = document.getElementById("speedRange");
const speedInput = document.getElementById("speedInput");
const speedValue = document.getElementById("speedValue");

// Update numeric input and display when slider changes
speedRange.addEventListener("input", (e) => {
  const rate = parseFloat(e.target.value);
  speedInput.value = rate.toFixed(1);
  speedValue.textContent = `${rate.toFixed(1)}x`;
  if (speechSynthesis.speaking) {
    restartReading(rate);
  }
});

// Update slider and display when numeric input changes
speedInput.addEventListener("input", (e) => {
  let rate = parseFloat(e.target.value);
  if (isNaN(rate)) return;
  rate = Math.min(Math.max(rate, 0.5), 2); // Clamp between 0.5 and 2
  speedRange.value = rate.toFixed(1);
  speedValue.textContent = `${rate.toFixed(1)}x`;
  if (speechSynthesis.speaking) {
    restartReading(rate);
  }
});

// Restart reading with new voice or speed
function restartReading(rate) {
  
  //...create new utterance with updated rate/voice ...
  if (!currentText) return; //no more text or no current text
  const newText = currentText.slice(currentIndex);
  const utterance = new SpeechSynthesisUtterance(newText);

  // Get selected voice index
  const select = document.getElementById("voiceSelect");
  const selectedIndex = select.value;

  // Validate voice index
  const selectedVoice = voices[selectedIndex];
  utterance.voice = selectedVoice || voices[0]; // Fallback to default voice

  utterance.rate = rate || 1;
  utterance.onboundary = (event) => {
    const newCharindex = event.charIndex + event.charLength;
    if(newCharindex>currentIndex){
      currentIndex = newCharindex;
    }
  };
  
  currentUtterance = utterance;
  speechSynthesis.cancel();//cancel current speech
  speechSynthesis.speak(utterance);
}

// Main reading function
function startReadingText(text) {
  if (voices.length === 0) {
    alert("Voices are still loading. Please wait a moment.");
    return;
  }
  speechSynthesis.cancel();
  currentText = text;
  currentIndex = 0;
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Validate voice selection
  const select = document.getElementById("voiceSelect");
  const selectedIndex = select.value;
  const selectedVoice = voices[selectedIndex];
  utterance.voice = selectedVoice || voices[0]; // Fallback

  utterance.rate = parseFloat(document.getElementById("speedRange").value);
  utterance.onboundary = (event) => {
    const newCharindex = event.charIndex + event.charLength;
    if(newCharindex>currentIndex){
      currentIndex = newCharindex;
    }
  };
  
  // Error handling
  utterance.onerror = (event) => {
    const errors = {
        "voice-unavailable": "Selected voice unavailable.",
        "synthesis-failed": "Speech synthesis failed.",
    }
    if(event.error==='interrupted'){
      console.log("Speech interrupted internationally");
    }
    else{
      alert(`Error: ${errors[event.error] || event.error}`);
    }
  }; 

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

// Stop button
document.getElementById("stopText").addEventListener("click", () => {
  speechSynthesis.cancel();
  currentUtterance = null;
  currentIndex = 0;
});

// Read selected text
document.getElementById("readText").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            alert("No active tab found.");
            return;
        }
        const tab = tabs[0];
        if (tab.url.startsWith("chrome://")) {
            alert("This extension cannot work on chrome:// pages.");
            return;
        }
        const tabId = tab.id;
      
      // Inject content script if not already loaded
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      }, () => {
        if (chrome.runtime.lastError) {
          alert("Error: " + chrome.runtime.lastError.message);
          return;
        }
        
        // Send message after injection
        chrome.tabs.sendMessage(tabId, { action: "getText" }, (response) => {
          if (response && response.text) {
            startReadingText(response.text);
          }
          if(chrome.runtime.lastError) {
            console.error("Error: " + chrome.runtime.lastError.message);
            alert("Unable to connect. Please try refreshing the page.");
          }
        });
      });
    });
});

// Read images via OCR
document.getElementById("readImages").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "extractImageText" }, (response) => {
      if (response && response.text) {
        startReadingText(response.text);
      }
    });
  });
});