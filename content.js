// Function to get selected text
function getSelectedText() {
  const text = window.getSelection().toString().trim();
  // If text is selected, return it directly. Otherwise, get all visible text.
  return text ? text : getVisibleText();
}

// Fallback to get all visible text on the page if no text is selected
function getVisibleText() {
  // Consider a more robust selector or method if needed
  const elements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div, li, td, th, article, main, section');
  let visibleText = '';
  const MAX_LENGTH = 10000; // Limit extracted text length to prevent performance issues

  for (const el of elements) {
      // Check if element is visible (basic check)
      if (el.offsetParent !== null && !el.closest('nav, header, footer, script, style, noscript')) {
          const textContent = el.textContent?.trim();
          if (textContent) {
            visibleText += textContent + ' ';
          }
      }
      if (visibleText.length > MAX_LENGTH) {
          console.warn("Content Script: Truncating visible text due to length limit.");
          break; // Stop processing if too long
      }
  }
  return visibleText.trim();
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // No need for async IIFE if only sync operations remain
  try {
      if (request.action === 'getText') {
          const text = getSelectedText();
          console.log("Content Script: Sending text:", text.substring(0,100)+"...");
          sendResponse({ text: text });

      // Removed 'extractImageText' handler

      } else {
          console.log("Content Script: Unknown action", request.action);
           // Optional: Send back an error for unknown actions
           // sendResponse({ error: `Unknown action: ${request.action}` });
      }

  } catch (error) {
      console.error("Content Script: Error processing message:", request.action, error);
      sendResponse({ error: error.message });
  }

  // Return true only if you might respond asynchronously later.
  // Since getText is synchronous, returning true isn't strictly needed here,
  // but it doesn't hurt and is good practice if you might add async handlers later.
  return true;
});

console.log("Content script loaded and listener added."); // Added log