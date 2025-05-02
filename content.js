// Function to get selected text
function getSelectedText() {
  const text = window.getSelection().toString().trim();
  return text ? text : getVisibleText();
}

// Fallback to get all visible text on the page if no text is selected
function getVisibleText() {
  const elements = document.querySelectorAll('p, h1, h2, h3, span');
  const visibleText = [...elements].reduce((acc, el) => {
    if (el.offsetParent !== null) {
      acc += el.textContent.trim() + ' ';
    }
    return acc;
  }, '');
  return visibleText.trim();
}
console.log('Tesseract:', typeof Tesseract);

if (typeof Tesseract === 'undefined') {
  console.error('Tesseract is not defined');
} else {
  // Initialize Tesseract
  let worker;

  (async () => {
    try {
      const { createWorker } = Tesseract; // Destructure createWorker
      worker = await createWorker({
        logger: (m) => console.log(m),
        langPath: 'libs/tessdata',
        corePath: 'libs/tesseract-core.wasm',
        workerPath: 'libs/tesseract.min.js',
      });
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      console.log('Tesseract initialized successfully');
    } catch (err) {
      console.error('Tesseract initialization failed:', err);
    }
  })();
}
// Handle messages from the popup
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  try {
    if (request.action === 'getText') {
      sendResponse({ text: getSelectedText() });
    } else if (request.action === 'extractImageText' && worker) {
      const images = document.querySelectorAll('img');
      const textPromises = [...images].map(async (img) => {
        if (!img.complete || img.naturalWidth === 0) return ''; 

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL();

        try {
          const result = await worker.recognize(dataURL, 'eng');
          return result.data.text;
        } catch (error) {
          console.error('OCR Error:', error);
          return '';
        }
      });

      const results = await Promise.all(textPromises);
      sendResponse({ text: results.filter(Boolean).join(' ') });
    }
    return true;
  } catch (error) {
    sendResponse({ error: error.message });
  }
});