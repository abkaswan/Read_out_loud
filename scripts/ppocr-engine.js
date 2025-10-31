// PP-OCR engine scaffold: initializes ORT and warms up detection/recognition models.
(() => {
  class PPOCREngine {
    constructor(opts = {}) {
      this.opts = opts;
      this.detModelPath = opts.detModelPath || 'models/ppocr/det/en_ppocrv3_det.onnx';
      this.recModelPath = opts.recModelPath || 'models/ppocr/rec/en_ppocrv3_rec.onnx';
      this.dictPath = opts.dictPath || 'models/ppocr/rec/en_dict.txt';
      this.provider = 'wasm'; // WebGPU can be added if runtime bundle supports it

      this.detSession = null;
      this.recSession = null;
      this.inited = false;
      this.warmed = false;
      this.debug = !!opts.debug;

      // Rec resources
      this.dict = null;
      this.detInputSize = 640;
      this.recImgH = 48;
      this.recImgW = 320;
  this.minRecConf = opts.minRecConf || 0.35;  // drop low-confidence lines (slightly permissive)
  this.minLineLen = opts.minLineLen || 2;     // ignore single-char noise
  this.tryRotate = opts.tryRotate !== false;  // try 90° rotation for tall text (vertical speech bubbles)

      // Reusable canvases
      this._workCanvas = null;
      this._workCtx = null;
      this._origCanvas = null;
      this._origCtx = null;
    }

    log(...a) { if (this.debug) console.log('[PPOCR]', ...a); }

    async init() {
      if (this.inited) return;
      if (!self.ort) throw new Error('onnxruntime-web (ort) not found');

      try {
        // Point ORT at our libs directory explicitly (helps with dynamic imports in MV3)
        const baseLibs = chrome?.runtime?.getURL ? chrome.runtime.getURL('libs/') : 'libs/';
        ort.env.wasm.wasmPaths = baseLibs;

        const canThreads = typeof SharedArrayBuffer !== 'undefined' && (self.crossOriginIsolated === true);
        const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2)));
        this.log('Configuring ORT WASM env', { baseLibs, canThreads, cores, crossOriginIsolated: self.crossOriginIsolated });
        ort.env.wasm.numThreads = canThreads ? cores : 1;
        ort.env.wasm.simd = true;
      } catch (e) {
        this.log('ORT env config skipped:', e?.message);
      }

      const detUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL(this.detModelPath) : this.detModelPath;
      const recUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL(this.recModelPath) : this.recModelPath;

      this.log('Creating ORT sessions...', { detUrl, recUrl, provider: this.provider });
      const sessionOpts = { executionProviders: [this.provider], graphOptimizationLevel: 'all' };

      try {
        this.detSession = await ort.InferenceSession.create(detUrl, sessionOpts);
        this.recSession = await ort.InferenceSession.create(recUrl, sessionOpts);
      } catch (e) {
        console.error('[PPOCR] Session creation failed:', e);
        // If the error references a missing jsep module, fallback to single-thread (avoids jsep path)
        const msg = String(e?.message || e);
        const isJsepMissing = /jsep\.mjs/.test(msg);
        if (isJsepMissing) {
          this.log('Falling back to non-threaded WASM (numThreads=1) to avoid JSEP path.');
          try {
            ort.env.wasm.numThreads = 1;
            this.detSession = await ort.InferenceSession.create(detUrl, sessionOpts);
            this.recSession = await ort.InferenceSession.create(recUrl, sessionOpts);
          } catch (e2) {
            console.error('[PPOCR] Fallback session creation failed:', e2);
            console.warn('[PPOCR] To use threaded WASM, also add ort-wasm-simd-threaded.jsep.mjs and ort-wasm-simd-threaded.jsep.wasm to libs/.');
            throw e2;
          }
        } else {
          // Provide actionable hint for common MV3 packaging issue
          console.warn('[PPOCR] If error mentions missing ".mjs" like ort-wasm-simd-threaded.mjs, copy required ort*.mjs files into libs/ and expose via web_accessible_resources.');
          throw e;
        }
      }
      this.inited = true;

      this.log('Sessions ready.', {
        detInputs: this.detSession.inputNames,
        detOutputs: this.detSession.outputNames,
        recInputs: this.recSession.inputNames,
        recOutputs: this.recSession.outputNames
      });

      await this._ensureDict();
    }

    async warmup() {
      if (this.warmed) return;
      await this.init();
      try {
        this.log('Warmup: preparing dummy inputs');
        // Detection warmup
        const detInputName = this.detSession.inputNames[0];
        const detMeta = this.detSession.inputMetadata[detInputName];
        const detShape = Array.isArray(detMeta?.dimensions) && detMeta.dimensions.every(n => Number.isInteger(n))
          ? detMeta.dimensions
          : [1, 3, 640, 640];
        const detSize = detShape.reduce((a, b) => a * (b > 0 ? b : 1), 1);
        const detTensor = new ort.Tensor('float32', new Float32Array(detSize), detShape);
        this.log('Warmup: running det dummy', detShape);
        await this.detSession.run({ [detInputName]: detTensor });

        // Recognition warmup
        const recInputName = this.recSession.inputNames[0];
        const recMeta = this.recSession.inputMetadata[recInputName];
        const recShape = Array.isArray(recMeta?.dimensions) && recMeta.dimensions.every(n => Number.isInteger(n))
          ? recMeta.dimensions
          : [1, 3, 48, 320];
        const recSize = recShape.reduce((a, b) => a * (b > 0 ? b : 1), 1);
        const recTensor = new ort.Tensor('float32', new Float32Array(recSize), recShape);
        this.log('Warmup: running rec dummy', recShape);
        await this.recSession.run({ [recInputName]: recTensor });

        this.warmed = true;
        this.log('Warmup complete.');
      } catch (e) {
        console.warn('[PPOCR] Warmup failed (will still proceed):', e);
      }
    }

    async health() {
      // Returns engine/session metadata for diagnostics
      await this.init().catch(() => {});
      const env = {
        wasmPaths: ort?.env?.wasm?.wasmPaths,
        numThreads: ort?.env?.wasm?.numThreads,
        simd: ort?.env?.wasm?.simd,
        crossOriginIsolated: self.crossOriginIsolated === true
      };
      const det = this.detSession ? {
        inputs: this.detSession.inputNames,
        outputs: this.detSession.outputNames,
        inputShapes: this.detSession.inputNames.map(n => this.detSession.inputMetadata[n]?.dimensions || null)
      } : null;
      const rec = this.recSession ? {
        inputs: this.recSession.inputNames,
        outputs: this.recSession.outputNames,
        inputShapes: this.recSession.inputNames.map(n => this.recSession.inputMetadata[n]?.dimensions || null)
      } : null;
      return { provider: this.provider, env, det, rec, inited: this.inited, warmed: this.warmed };
    }

    async prefetch(imageUrl) {
      await this.warmup();
      const { IdbCache, hashDataUrl, sha1Hex } = self.PPOCR_IdbCache || {};
      const cache = IdbCache ? new IdbCache() : null;
      const img = await this._loadImage(imageUrl);
      const hash = await this._contentHash(imageUrl, img.blob);
      if (cache) {
        const hit = await cache.get(hash).catch(() => null);
        if (hit && hit.version === 'ppocr-v2') { this.log('Prefetch cache hit', { hash }); return { ok: true, cached: true }; }
      }
      const res = await this._ocrBitmap(img.bitmap, img.width, img.height).catch(e => { this.log('Prefetch OCR failed', e); return null; });
      if (res && Array.isArray(res.lines) && res.lines.length > 0 && cache) {
        await cache.set({ hash, ts: Date.now(), version: 'ppocr-v2', lines: res.lines, boxes: res.boxes }).catch(() => {});
      } else if (res && (!res.lines || res.lines.length === 0)) {
        this.log('Prefetch: OCR produced no lines; not caching.', { hash });
      }
      return { ok: true, cached: !!res };
    }

    async recognize(imageUrl) {
      await this.warmup();
      const { IdbCache } = self.PPOCR_IdbCache || {};
      const cache = IdbCache ? new IdbCache() : null;
      const img = await this._loadImage(imageUrl);
      const hash = await this._contentHash(imageUrl, img.blob);
      if (cache) {
        const hit = await cache.get(hash).catch(() => null);
        if (hit && hit.version === 'ppocr-v2' && hit.lines && hit.boxes) {
          this.log('Recognize cache hit', { hash });
          return { lines: hit.lines, boxes: hit.boxes };
        }
      }
      const res = await this._ocrBitmap(img.bitmap, img.width, img.height);
      if (cache && res && Array.isArray(res.lines) && res.lines.length > 0) {
        await cache.set({ hash, ts: Date.now(), version: 'ppocr-v2', lines: res.lines, boxes: res.boxes }).catch(() => {});
      } else if (res && (!res.lines || res.lines.length === 0)) {
        this.log('Recognize: OCR produced no lines; not caching.', { hash });
      }
      return res || { lines: [], boxes: [] };
    }

    // --- OCR pipeline ---
    async _ensureDict() {
      if (this.dict) return;
      const url = chrome?.runtime?.getURL ? chrome.runtime.getURL(this.dictPath) : this.dictPath;
      const res = await fetch(url);
      const text = await res.text();
      // Paddle dict: one token per line
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      this.dict = lines;
    }

    _ensureCanvases() {
      if (!this._workCanvas) {
        this._workCanvas = document.createElement('canvas');
        this._workCtx = this._workCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (!this._origCanvas) {
        this._origCanvas = document.createElement('canvas');
        this._origCtx = this._origCanvas.getContext('2d', { willReadFrequently: true });
      }
    }

    async _loadImage(url) {
      const response = await fetch(url);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return { blob, bitmap, width: bitmap.width, height: bitmap.height };
    }

    async _contentHash(url, blob) {
      // Prefer content hash when possible
      try {
        const buf = await blob.arrayBuffer();
        const hex = await (self.PPOCR_IdbCache?.sha1Hex?.(buf));
        if (hex) return `b:${hex}`;
      } catch {}
      if (url.startsWith('data:') && self.PPOCR_IdbCache?.hashDataUrl) return await self.PPOCR_IdbCache.hashDataUrl(url);
      return `u:${url}`;
    }

    _letterbox(bitmap, target) {
      // Resize into square with padding, track scale and offset
      const iw = bitmap.width, ih = bitmap.height;
      const scale = Math.min(target / iw, target / ih);
      const nw = Math.round(iw * scale);
      const nh = Math.round(ih * scale);
      const padX = Math.floor((target - nw) / 2);
      const padY = Math.floor((target - nh) / 2);
      this._ensureCanvases();
      this._workCanvas.width = target;
      this._workCanvas.height = target;
      const ctx = this._workCtx;
      ctx.clearRect(0, 0, target, target);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, target, target);
      ctx.drawImage(bitmap, 0, 0, iw, ih, padX, padY, nw, nh);
      const imageData = ctx.getImageData(0, 0, target, target);
      return { imageData, scale, padX, padY };
    }

    _toCHWFloat(imageData, mean = [0.485,0.456,0.406], std=[0.229,0.224,0.225]) {
      const { data, width, height } = imageData;
      const size = width * height;
      const out = new Float32Array(size * 3);
      for (let i = 0; i < size; i++) {
        const r = data[i*4] / 255;
        const g = data[i*4+1] / 255;
        const b = data[i*4+2] / 255;
        out[i] = (r - mean[0]) / std[0];
        out[i + size] = (g - mean[1]) / std[1];
        out[i + size*2] = (b - mean[2]) / std[2];
      }
      return out;
    }

    async _runDet(bitmap) {
      const T = this.detInputSize;
      const { imageData, scale, padX, padY } = this._letterbox(bitmap, T);
      const chw = this._toCHWFloat(imageData);
      const inputName = this.detSession.inputNames[0];
      const inputShape = [1,3,T,T];
      const input = new ort.Tensor('float32', chw, inputShape);
      const out = await this.detSession.run({ [inputName]: input });
      const first = out[this.detSession.outputNames[0]];
      // Expect [1,1,H,W]
      let H, W, probs;
      if (first.dims.length === 4) {
        H = first.dims[2]; W = first.dims[3]; probs = first.data;
      } else if (first.dims.length === 3) {
        H = first.dims[1]; W = first.dims[2]; probs = first.data; // [1,H,W]
      } else {
        throw new Error('Unexpected det output shape ' + JSON.stringify(first.dims));
      }
  // Threshold to mask (raise slightly to reduce false positives on blank/low-contrast regions)
  const thr = 0.35;
      const mask = new Uint8Array(H*W);
      for (let i=0;i<H*W;i++) mask[i] = probs[i] > thr ? 1 : 0;
      // Connected components to AABB boxes
  const boxes = this._maskToBoxes(mask, W, H, 40);
      // Map to original coords
      const mapped = boxes.map(b => ({
        minX: Math.max(0, Math.round((b.minX - padX) / scale)),
        minY: Math.max(0, Math.round((b.minY - padY) / scale)),
        maxX: Math.max(0, Math.round((b.maxX - padX) / scale)),
        maxY: Math.max(0, Math.round((b.maxY - padY) / scale))
      }));
      return mapped;
    }

    _maskToBoxes(mask, W, H, minArea=16) {
      const visited = new Uint8Array(mask.length);
      const boxes = [];
      const qx = new Uint16Array(W*H);
      const qy = new Uint16Array(W*H);
      for (let y=0; y<H; y++) {
        for (let x=0; x<W; x++) {
          const idx = y*W + x;
          if (mask[idx]===0 || visited[idx]) continue;
          let head=0, tail=0;
          qx[tail]=x; qy[tail]=y; tail++;
          visited[idx]=1;
          let minX=x, minY=y, maxX=x, maxY=y, area=0;
          while (head<tail) {
            const cx=qx[head], cy=qy[head]; head++;
            area++;
            if (cx<minX) minX=cx; if (cx>maxX) maxX=cx;
            if (cy<minY) minY=cy; if (cy>maxY) maxY=cy;
            // 4-neighbors
            const nb = [ [cx+1,cy], [cx-1,cy], [cx,cy+1], [cx,cy-1] ];
            for (let k=0;k<4;k++) {
              const nx=nb[k][0], ny=nb[k][1];
              if (nx<0||ny<0||nx>=W||ny>=H) continue;
              const nidx = ny*W + nx;
              if (mask[nidx] && !visited[nidx]) {
                visited[nidx]=1; qx[tail]=nx; qy[tail]=ny; tail++;
              }
            }
          }
          if (area>=minArea) boxes.push({minX, minY, maxX, maxY});
        }
      }
      // Merge overlapping boxes lightly
      return this._mergeOverlaps(boxes, 0.2);
    }

    _mergeOverlaps(boxes, iouThr=0.2) {
      if (boxes.length<=1) return boxes;
      const res=[]; const used=new Array(boxes.length).fill(false);
      const iou=(a,b)=>{
        const x1=Math.max(a.minX,b.minX), y1=Math.max(a.minY,b.minY);
        const x2=Math.min(a.maxX,b.maxX), y2=Math.min(a.maxY,b.maxY);
        const inter=Math.max(0,x2-x1+1)*Math.max(0,y2-y1+1);
        const areaA=(a.maxX-a.minX+1)*(a.maxY-a.minY+1);
        const areaB=(b.maxX-b.minX+1)*(b.maxY-b.minY+1);
        return inter/Math.max(1, areaA+areaB-inter);
      };
      for (let i=0;i<boxes.length;i++){
        if (used[i]) continue; let cur={...boxes[i]}; used[i]=true;
        for (let j=i+1;j<boxes.length;j++){
          if (used[j]) continue; if (iou(cur, boxes[j])>=iouThr){
            cur.minX=Math.min(cur.minX, boxes[j].minX);
            cur.minY=Math.min(cur.minY, boxes[j].minY);
            cur.maxX=Math.max(cur.maxX, boxes[j].maxX);
            cur.maxY=Math.max(cur.maxY, boxes[j].maxY);
            used[j]=true; j=i; // restart merge
          }
        }
        res.push(cur);
      }
      return res;
    }

  async _runRecOnCrop(origBitmap, box) {
      // Crop box from original bitmap and prepare rec input
      this._ensureCanvases();
      const iw = origBitmap.width, ih = origBitmap.height;
      const x = Math.max(0, box.minX), y = Math.max(0, box.minY);
      const w = Math.max(1, box.maxX - box.minX + 1);
      const h = Math.max(1, box.maxY - box.minY + 1);

      // Draw original to orig canvas once if size changed
      if (this._origCanvas.width !== iw || this._origCanvas.height !== ih) {
        this._origCanvas.width = iw; this._origCanvas.height = ih;
        this._origCtx.clearRect(0,0,iw,ih);
        this._origCtx.drawImage(origBitmap, 0, 0);
      }

      const crop = this._origCtx.getImageData(x,y,w,h);

      const runOnce = async (imgData) => {
        // Resize to recImgH height while preserving aspect, pad to recImgW
        const ih = imgData.height, iw = imgData.width;
        const scale = this.recImgH / ih;
        const rw = Math.min(this.recImgW, Math.max(1, Math.round(iw * scale)));
        // Paint resized on work canvas
        this._workCanvas.width = this.recImgW;
        this._workCanvas.height = this.recImgH;
        const ctx = this._workCtx;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,this.recImgW,this.recImgH);
        // Put image data to a temp canvas for high-quality resize
        const tmp = document.createElement('canvas');
        tmp.width = iw; tmp.height = ih;
        tmp.getContext('2d').putImageData(imgData, 0, 0);
        ctx.drawImage(tmp, 0,0,iw,ih, 0,0,rw,this.recImgH);
        const norm = this._toCHWFloat(ctx.getImageData(0,0,this.recImgW,this.recImgH), [0.5,0.5,0.5], [0.5,0.5,0.5]);
        const inputName = this.recSession.inputNames[0];
        const input = new ort.Tensor('float32', norm, [1,3,this.recImgH,this.recImgW]);
        const out = await this.recSession.run({ [inputName]: input });
        const first = out[this.recSession.outputNames[0]];
        return this._ctcGreedyDecode(first);
      };

      // Try original orientation
      let best = await runOnce(crop);

      // If very tall (likely vertical text), optionally try 90° rotation and take better confidence
      if (this.tryRotate && h > w * 1.2) {
        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = h; rotCanvas.height = w;
        const rctx = rotCanvas.getContext('2d');
        // draw rotated -90° (to make vertical text horizontal)
        rctx.translate(0, w);
        rctx.rotate(-Math.PI/2);
        const tmpSrc = document.createElement('canvas');
        tmpSrc.width = w; tmpSrc.height = h;
        tmpSrc.getContext('2d').putImageData(crop, 0, 0);
        rctx.drawImage(tmpSrc, 0, 0);
        const rotData = rctx.getImageData(0,0,rotCanvas.width, rotCanvas.height);
        const candidate = await runOnce(rotData);
        if ((candidate.conf || 0) > (best.conf || 0)) best = candidate;
      }

      return best;
    }

  _ctcGreedyDecode(tensor) {
      // Expect [1, T, C] or [T, C] or [1, C, T]
      const dims = tensor.dims;
      let T, C, getter;
      if (dims.length===3 && dims[0]===1) { // [1,T,C]
        T = dims[1]; C = dims[2];
        getter = (t,c)=> tensor.data[t*C + c];
      } else if (dims.length===2) { // [T,C]
        T = dims[0]; C = dims[1];
        getter = (t,c)=> tensor.data[t*C + c];
      } else if (dims.length===3 && dims[0]===1 && dims[1]!==dims[2]) { // maybe [1,C,T]
        C = dims[1]; T = dims[2];
        getter = (t,c)=> tensor.data[c*T + t];
      } else {
        this.log('Unexpected rec output dims', dims);
        return { text: '', conf: 0 };
      }
      // PaddleOCR CTC convention: class 0 is the blank. Classes 1..C-1 map to dict[0..dict.length-1].
      const blank = 0;
      let last = -1; let chars=[]; let confs=[];
      for (let t=0;t<T;t++){
        let maxI=0, maxV=-1e9, secondV=-1e9;
        for (let c=0;c<C;c++){ const v=getter(t,c); if (v>maxV){ secondV=maxV; maxV=v; maxI=c; } else if (v>secondV){ secondV=v; } }
        if (maxI!==blank && maxI!==last){
          // Shift by -1 to map CTC class index to dict index
          const dictIdx = maxI - 1;
          const ch = (dictIdx>=0 && dictIdx< (this.dict?.length||0)) ? this.dict[dictIdx] : '';
          if (ch) {
            // Convert margin to a [0,1] confidence proxy (sigmoid of margin)
            const margin = maxV - (secondV === -1e9 ? maxV - 10 : secondV);
            const conf = 1 / (1 + Math.exp(-margin));
            chars.push(ch); confs.push(conf);
          }
        }
        last = maxI;
      }
      const text = chars.join('');
      const conf = confs.length? confs.reduce((a,b)=>a+b,0)/confs.length : 0;
      return { text, conf };
    }

    async _ocrBitmap(bitmap, w, h) {
      // 1) detect boxes
      let boxes = [];
      try {
        boxes = await this._runDet(bitmap);
      } catch (e) {
        this.log('Detection failed, fallback to full image', e);
        // Do not fallback to full image; treat as no text to avoid false positives on blank panels
        boxes = [];
      }
      if (!boxes.length) return { lines: [], boxes: [] };
      // 2) recognize per box
      const lines=[]; const results=[];
      for (const b of boxes){
        try {
          const { text, conf } = await this._runRecOnCrop(bitmap, b);
          const t = (text || '').trim();
          if (t && t.length >= this.minLineLen && conf >= this.minRecConf) {
            lines.push(t);
            results.push({ box: b, text: t, conf });
          }
        } catch (e) {
          this.log('Recognition failed for box', b, e);
        }
      }
      // return both raw boxes and lines array
      return { lines, boxes };
    }
  }

  self.PPOCREngine = PPOCREngine;
})();
