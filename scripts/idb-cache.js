// Minimal IndexedDB cache scaffold for PP-OCR results
(() => {
  class IdbCache {
    constructor(name = 'ppocr-cache', version = 1) {
      this.name = name;
      this.version = version;
      this.db = null;
    }

    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('results')) {
            db.createObjectStore('results', { keyPath: 'hash' });
          }
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    }

    async get(hash) {
      await this.open();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const req = store.get(hash);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async set(entry) {
      await this.open();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('results', 'readwrite');
        const store = tx.objectStore('results');
        const req = store.put(entry);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
  }

  // Simple debug hash for data URLs
  async function hashDataUrl(url) {
    try {
      let h = 0;
      for (let i = 0; i < url.length; i++) {
        h = (h << 5) - h + url.charCodeAt(i);
        h |= 0;
      }
      return `du:${h}`;
    } catch (e) {
      console.warn('[IDB-Cache] hashDataUrl failed', e);
      return `du:${Date.now()}`;
    }
  }

  async function sha1Hex(buffer) {
    try {
      const dig = await crypto.subtle.digest('SHA-1', buffer);
      const bytes = new Uint8Array(dig);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback: naive hash on bytes
      const arr = new Uint8Array(buffer);
      let h = 0;
      for (let i = 0; i < arr.length; i++) { h = (h << 5) - h + arr[i]; h |= 0; }
      return `x${(h >>> 0).toString(16)}`;
    }
  }

  self.PPOCR_IdbCache = { IdbCache, hashDataUrl, sha1Hex };

  self.PPOCR_IdbCache = { IdbCache, hashDataUrl };
})();
