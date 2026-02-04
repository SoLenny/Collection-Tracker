const VERSION = "v0.4.3.0";
// Collection Tracker v4.2
// - Series page: multiple images per collection (flat)
// - All images visible on the collection screen
// - Cards belong to images, single list with filters
// - Notes per card, cover + thumbnail cropping
// - In-app confirm dialogs, no browser confirm

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- IndexedDB wrapper ---------- */
class DB {
  constructor(name, version){ this.name=name; this.version=version; this.db=null; }
  async open(){
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains("series")) {
          const s = db.createObjectStore("series", { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const s = req.transaction.objectStore("series");
          if (!s.indexNames.contains("updatedAt")) s.createIndex("updatedAt","updatedAt",{unique:false});
        }

        if (!db.objectStoreNames.contains("images")) {
          const i = db.createObjectStore("images", { keyPath: "id" });
          i.createIndex("seriesId", "seriesId", { unique:false });
          i.createIndex("seriesId_index", ["seriesId","index"], { unique:false });
          i.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const i = req.transaction.objectStore("images");
          if (!i.indexNames.contains("seriesId")) i.createIndex("seriesId","seriesId",{unique:false});
          if (!i.indexNames.contains("seriesId_index")) i.createIndex("seriesId_index",["seriesId","index"],{unique:false});
          if (!i.indexNames.contains("updatedAt")) i.createIndex("updatedAt","updatedAt",{unique:false});
        }

        if (!db.objectStoreNames.contains("cards")) {
          const c = db.createObjectStore("cards", { keyPath: "id" });
          c.createIndex("seriesId", "seriesId", { unique:false });
          c.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const c = req.transaction.objectStore("cards");
          if (!c.indexNames.contains("seriesId")) c.createIndex("seriesId","seriesId",{unique:false});
          if (!c.indexNames.contains("updatedAt")) c.createIndex("updatedAt","updatedAt",{unique:false});
        }

        if (!db.objectStoreNames.contains("collections")) {
          const c = db.createObjectStore("collections", { keyPath: "id" });
          c.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const c = req.transaction.objectStore("collections");
          if (!c.indexNames.contains("updatedAt")) c.createIndex("updatedAt","updatedAt",{unique:false});
        }

        if (!db.objectStoreNames.contains("collectionImages")) {
          const i = db.createObjectStore("collectionImages", { keyPath: "id" });
          i.createIndex("collectionId", "collectionId", { unique:false });
          i.createIndex("collectionId_index", ["collectionId","index"], { unique:false });
          i.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const i = req.transaction.objectStore("collectionImages");
          if (!i.indexNames.contains("collectionId")) i.createIndex("collectionId","collectionId",{unique:false});
          if (!i.indexNames.contains("collectionId_index")) i.createIndex("collectionId_index",["collectionId","index"],{unique:false});
          if (!i.indexNames.contains("updatedAt")) i.createIndex("updatedAt","updatedAt",{unique:false});
        }

        if (!db.objectStoreNames.contains("collectionItems")) {
          const c = db.createObjectStore("collectionItems", { keyPath: "id" });
          c.createIndex("collectionId", "collectionId", { unique:false });
          c.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const c = req.transaction.objectStore("collectionItems");
          if (!c.indexNames.contains("collectionId")) c.createIndex("collectionId","collectionId",{unique:false});
          if (!c.indexNames.contains("updatedAt")) c.createIndex("updatedAt","updatedAt",{unique:false});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }
  tx(storeNames, mode="readonly"){
    const tx = this.db.transaction(storeNames, mode);
    return { tx, stores: Object.fromEntries(storeNames.map(n => [n, tx.objectStore(n)])) };
  }
  async put(store, value){
    await this.open();
    return new Promise((resolve, reject) => {
      const { tx, stores } = this.tx([store], "readwrite");
      const req = stores[store].put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async getAll(store){
    await this.open();
    return new Promise((resolve, reject) => {
      const { stores } = this.tx([store], "readonly");
      const req = stores[store].getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async getAllByIndex(store, indexName, key){
    await this.open();
    return new Promise((resolve, reject) => {
      const { stores } = this.tx([store], "readonly");
      const idx = stores[store].index(indexName);
      const req = idx.getAll(key);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async delete(store, key){
    await this.open();
    return new Promise((resolve, reject) => {
      const { tx, stores } = this.tx([store], "readwrite");
      const req = stores[store].delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async clear(store){
    await this.open();
    return new Promise((resolve, reject) => {
      const { tx, stores } = this.tx([store], "readwrite");
      const req = stores[store].clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

const db = new DB("collection_tracker_v1", 4);

/* ---------- UI refs ---------- */
const els = {
  btnHome: $("#btnHome"),
  btnHomeBrand: $("#btnHomeBrand"),
  btnCollections: $("#btnCollections"),
  btnExport: $("#btnExport"),
  fileImport: $("#fileImport"),
  btnAbout: $("#btnAbout"),
  dlgAbout: $("#dlgAbout"),

  seriesList: $("#seriesList"),
  btnNewSeries: $("#btnNewSeries"),
  btnNewSeries2: $("#btnNewSeries2"),
  btnNewSeries3: $("#btnNewSeries3"),
  seriesSearch: $("#seriesSearch"),

  homeView: $("#homeView"),
  homeGrid: $("#homeGrid"),
  homeEmpty: $("#homeEmpty"),
  homeSortKey: $("#homeSortKey"),
  homeSortDir: $("#homeSortDir"),
  homeCount: $("#homeCount"),

  seriesView: $("#seriesView"),
  seriesName: $("#seriesName"),
  seriesStats: $("#seriesStats"),
  masterTrade: $("#masterTrade"),
  masterReceived: $("#masterReceived"),
  fileImage: $("#fileImage"),
  btnUndo: $("#btnUndo"),
  btnDeleteSeries: $("#btnDeleteSeries"),

  dropzone: $("#dropzone"),
  seriesLeftcol: $("#seriesLeftcol"),
  imageBlocks: $("#imageBlocks"),

  cardsList: $("#cardsList"),

  dlgNewSeries: $("#dlgNewSeries"),
  newSeriesName: $("#newSeriesName"),

  collectionsView: $("#collectionsView"),
  collectionsListView: $("#collectionsListView"),
  collectionsGrid: $("#collectionsGrid"),
  collectionsEmpty: $("#collectionsEmpty"),
  collectionsCount: $("#collectionsCount"),
  btnNewCollection: $("#btnNewCollection"),
  btnNewCollection2: $("#btnNewCollection2"),
  dlgNewCollection: $("#dlgNewCollection"),
  newCollectionName: $("#newCollectionName"),

  collectionDetailView: $("#collectionDetailView"),
  btnBackToCollections: $("#btnBackToCollections"),
  collectionName: $("#collectionName"),
  btnDeleteCollection: $("#btnDeleteCollection"),
  collectionImagesInput: $("#collectionImagesInput"),
  collectionGallery: $("#collectionGallery"),
  collectionItemsGrid: $("#collectionItemsGrid"),
  collectionItemName: $("#collectionItemName"),
  collectionItemStatus: $("#collectionItemStatus"),
  btnAddCollectionItem: $("#btnAddCollectionItem"),

  dlgConfirm: $("#dlgConfirm"),
  confirmTitle: $("#confirmTitle"),
  confirmText: $("#confirmText"),
  confirmOk: $("#confirmOk"),

  dlgThumbPos: $("#dlgThumbPos"),
  thumbFrame: $("#thumbFrame"),
  thumbImage: $("#thumbImage"),
  thumbSave: $("#thumbSave"),
  thumbReset: $("#thumbReset"),
  thumbZoom: $("#thumbZoom"),
  thumbZoomIn: $("#thumbZoomIn"),
  thumbZoomOut: $("#thumbZoomOut"),
  thumbZoomValue: $("#thumbZoomValue"),

  dlgCoverPos: $("#dlgCoverPos"),
  coverFrame: $("#coverFrame"),
  coverImage: $("#coverImage"),
  coverSave: $("#coverSave"),
  coverReset: $("#coverReset"),
  coverZoom: $("#coverZoom"),
  coverZoomIn: $("#coverZoomIn"),
  coverZoomOut: $("#coverZoomOut"),
  coverZoomValue: $("#coverZoomValue"),

};

let state = {
  series: [],
  activeSeriesId: null,
  images: [],
  cards: [],
  allCards: [],
  cardsBySeriesId: new Map(),

  collections: [],
  activeCollectionId: null,
  collectionImages: [],
  collectionItems: [],
  allCollectionItems: [],
  collectionItemsByCollectionId: new Map(),
  collectionImageUrls: new Map(),
  collectionThumbUrls: new Map(),

  statusFilter: "all",
  seriesSearch: "",
  homeSortKey: "updated",
  homeSortDir: "desc",

  imageBlocks: new Map(),
  activeImageId: null,
  listHoverCardId: null,
  selectedCardId: null,
  imageViewer: null,
  viewerImageEl: null,
  viewerZoom: 1,
  viewerTx: 0,
  viewerTy: 0,
  viewerUpdateTransform: null,
  focusCardId: null,
  focusUntil: 0,
  focusStart: 0,
  focusAnimationId: null,

  imageById: new Map(),
  coverCache: new Map(),
  thumbEdit: null,
  coverEdit: null,
};

function buildCardsCache(cards){
  state.allCards = cards;
  state.cardsBySeriesId = new Map();
  for (const card of cards){
    const bucket = state.cardsBySeriesId.get(card.seriesId);
    if (bucket){
      bucket.push(card);
    } else {
      state.cardsBySeriesId.set(card.seriesId, [card]);
    }
  }
}

function buildCollectionItemsCache(items){
  state.allCollectionItems = items;
  state.collectionItemsByCollectionId = new Map();
  for (const item of items){
    const bucket = state.collectionItemsByCollectionId.get(item.collectionId);
    if (bucket){
      bucket.push(item);
    } else {
      state.collectionItemsByCollectionId.set(item.collectionId, [item]);
    }
  }
}

function syncCollectionItemsCacheForCollection(collectionId, items){
  state.allCollectionItems = state.allCollectionItems.filter(item => item.collectionId !== collectionId).concat(items);
  state.collectionItemsByCollectionId.set(collectionId, items);
}

function removeCollectionItemsFromCache(collectionId){
  state.allCollectionItems = state.allCollectionItems.filter(item => item.collectionId !== collectionId);
  state.collectionItemsByCollectionId.delete(collectionId);
}

function getCollectionItemsForCollection(collectionId){
  return state.collectionItemsByCollectionId.get(collectionId) || [];
}

function syncCardsCacheForSeries(seriesId, cards){
  state.allCards = state.allCards.filter(card => card.seriesId !== seriesId).concat(cards);
  state.cardsBySeriesId.set(seriesId, cards);
}

function removeSeriesCardsFromCache(seriesId){
  state.allCards = state.allCards.filter(card => card.seriesId !== seriesId);
  state.cardsBySeriesId.delete(seriesId);
}

function getCardsForSeries(seriesId){
  return state.cardsBySeriesId.get(seriesId) || [];
}

function uid(prefix="id"){ return `${prefix}_${crypto.randomUUID()}`; }
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function rectNormalize(x1,y1,x2,y2){
  const x=Math.min(x1,x2), y=Math.min(y1,y2);
  const w=Math.abs(x2-x1), h=Math.abs(y2-y1);
  return {x,y,w,h};
}
function rectValid(r){ return r.w >= 12 && r.h >= 12; }
function rectArea(r){ return Math.max(0,r.w) * Math.max(0,r.h); }
function rectIntersect(a,b){
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y);
  const x2=Math.min(a.x+a.w, b.x+b.w), y2=Math.min(a.y+a.h, b.y+b.h);
  return {x:x1,y:y1,w:Math.max(0,x2-x1), h:Math.max(0,y2-y1)};
}
function bestOverlap(r, cards){
  let best=0; const ar=rectArea(r); if (!ar) return 0;
  for (const c of cards){ best = Math.max(best, rectArea(rectIntersect(r,c))/ar); }
  return best;
}
function seriesDisplayName(name){ return (name && name.trim()) ? name.trim() : "Без названия"; }
function imageDisplayTitle(image, idx){
  const raw = (image?.title || "").trim();
  return raw ? raw : `Изображение ${idx}`;
}
function limitText(value, max){
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

const CROP_ZOOM_MIN = 1;
const CROP_ZOOM_MAX = 3;
const CROP_ZOOM_STEP = 0.05;

const COVER_PREVIEW_SIZES = {
  small: { width: 120, height: 120, bg: "rgba(255,255,255,0.02)" },
  large: { width: 640, height: 360, bg: "rgba(0,0,0,0.25)" },
};

const CARD_PREVIEW_PLACEHOLDER = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100">
    <rect width="140" height="100" rx="14" fill="rgba(255,255,255,0.06)"/>
    <text x="70" y="58" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.8)">✦</text>
  </svg>`
);

const COLLECTION_STATUS_LABELS = {
  planned: "Запланировано",
  searching: "Ищу",
  owned: "В коллекции",
  duplicate: "Дубликат",
};

function clampZoom(value){
  return clamp(Number(value) || 1, CROP_ZOOM_MIN, CROP_ZOOM_MAX);
}

function waitForImageReady(img){
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth) return resolve();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      ok ? resolve() : reject(new Error("Image load failed"));
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    if (img.decode){
      img.decode().then(() => finish(true)).catch(() => {});
    }
  });
}

async function loadImageFromBlob(blob){
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await waitForImageReady(img).catch(() => {});
  return { img, url };
}

function getCropMetrics(imgW, imgH, frameW, frameH, zoom){
  const baseScale = Math.max(frameW / imgW, frameH / imgH);
  const scale = baseScale * zoom;
  const scaledW = imgW * scale;
  const scaledH = imgH * scale;
  const overflowX = Math.max(0, scaledW - frameW);
  const overflowY = Math.max(0, scaledH - frameH);
  return { scaledW, scaledH, overflowX, overflowY };
}

function getCropFrameMetrics(editState, frameEl, imgEl){
  const rect = frameEl.getBoundingClientRect();
  const frameW = rect.width || 1;
  const frameH = rect.height || 1;
  const imgW = editState?.imgW || imgEl?.naturalWidth || imgEl?.width || 1;
  const imgH = editState?.imgH || imgEl?.naturalHeight || imgEl?.height || 1;
  const zoom = clampZoom(editState?.zoom || 1);
  const { scaledW, scaledH, overflowX, overflowY } = getCropMetrics(imgW, imgH, frameW, frameH, zoom);
  const minTx = Math.min(0, frameW - scaledW);
  const minTy = Math.min(0, frameH - scaledH);
  return {
    frameW,
    frameH,
    imgW,
    imgH,
    zoom,
    scaledW,
    scaledH,
    overflowX,
    overflowY,
    minTx,
    maxTx: 0,
    minTy,
    maxTy: 0,
  };
}

function applyCropTransform(imgEl, metrics, tx, ty){
  if (!imgEl || !metrics) return;
  imgEl.style.width = `${metrics.imgW}px`;
  imgEl.style.height = `${metrics.imgH}px`;
  imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${metrics.scaledW / metrics.imgW})`;
  imgEl.style.transformOrigin = "top left";
}

function clampCropPosition(pos, overflowX, overflowY){
  return {
    x: overflowX ? clamp(Number(pos?.x) || 50, 0, 100) : 50,
    y: overflowY ? clamp(Number(pos?.y) || 50, 0, 100) : 50,
  };
}

function applyCropToImage(editState, frameEl, imgEl){
  if (!editState || !frameEl || !imgEl) return;
  const metrics = getCropFrameMetrics(editState, frameEl, imgEl);
  editState.zoom = metrics.zoom;
  editState.pos = clampCropPosition(editState.pos || {x:50, y:50}, metrics.overflowX, metrics.overflowY);
  const offsetX = metrics.overflowX ? (editState.pos.x / 100) * metrics.overflowX : 0;
  const offsetY = metrics.overflowY ? (editState.pos.y / 100) * metrics.overflowY : 0;
  editState.tx = -offsetX;
  editState.ty = -offsetY;
  applyCropTransform(imgEl, metrics, editState.tx, editState.ty);
}

function applyCropPreview(imgEl, frameEl, pos, zoom){
  if (!imgEl || !frameEl) return;
  const apply = () => {
    const rect = frameEl.getBoundingClientRect();
    const frameW = rect.width || 1;
    const frameH = rect.height || 1;
    if (frameW <= 1 || frameH <= 1){
      requestAnimationFrame(apply);
      return;
    }
    const imgW = imgEl.naturalWidth || imgEl.width || 1;
    const imgH = imgEl.naturalHeight || imgEl.height || 1;
    const safeZoom = clampZoom(zoom || 1);
    const { overflowX, overflowY, scaledW, scaledH } = getCropMetrics(imgW, imgH, frameW, frameH, safeZoom);
    const nextPos = clampCropPosition(pos || {x:50, y:50}, overflowX, overflowY);
    const offsetX = overflowX ? (nextPos.x / 100) * overflowX : 0;
    const offsetY = overflowY ? (nextPos.y / 100) * overflowY : 0;
    const metrics = {
      imgW,
      imgH,
      scaledW,
      scaledH,
    };
    applyCropTransform(imgEl, metrics, -offsetX, -offsetY);
  };
  if (imgEl.complete) {
    apply();
  } else {
    imgEl.addEventListener("load", apply, { once: true });
  }
}

function getCanvasFillColor(el, fallback){
  if (!el) return fallback;
  const style = getComputedStyle(el);
  const token = style.getPropertyValue("--canvas-bg").trim();
  if (token) return token;
  const bg = style.backgroundColor;
  return bg && bg !== "rgba(0, 0, 0, 0)" ? bg : fallback;
}

function renderCoverPreviewFromImage(img, pos, zoom, size){
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = size.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const safeZoom = clampZoom(zoom || 1);
  const { scaledW, scaledH, overflowX, overflowY } = getCropMetrics(
    img.width || 1,
    img.height || 1,
    canvas.width,
    canvas.height,
    safeZoom
  );
  const nextPos = clampCropPosition(pos || { x: 50, y: 50 }, overflowX, overflowY);
  const offsetX = overflowX ? (nextPos.x / 100) * overflowX : 0;
  const offsetY = overflowY ? (nextPos.y / 100) * overflowY : 0;
  ctx.drawImage(img, -offsetX, -offsetY, scaledW, scaledH);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function setCoverPreviewCache(seriesId, payload){
  if (!payload) return;
  state.coverCache.set(seriesId, {
    smallUrl: payload.smallUrl,
    largeUrl: payload.largeUrl,
    imageId: payload.imageId,
    pos: payload.pos,
    zoom: payload.zoom,
  });
}

function updateCoverCacheFromSeries(series){
  if (!series) return;
  if (!series.coverPreviewSmall && !series.coverPreviewLarge) return;
  state.coverCache.set(series.id, {
    smallUrl: series.coverPreviewSmall || null,
    largeUrl: series.coverPreviewLarge || null,
    imageId: series.coverImageId || null,
    pos: series.coverPos || { x: 50, y: 50 },
    zoom: series.coverZoom ?? 1,
  });
}

async function ensureCoverPreviews(seriesId, coverOverride = null){
  const series = state.series.find(s => s.id === seriesId);
  if (!series) return;
  const cover = coverOverride || await getSeriesCover(seriesId);
  if (!cover?.blob) return;
  const cached = state.coverCache.get(seriesId);
  const pos = cover.pos || { x: 50, y: 50 };
  const zoom = clampZoom(cover.zoom ?? 1);
  const isCurrent = cached
    && cached.imageId === cover.imageId
    && cached.zoom === zoom
    && cached.pos?.x === pos.x
    && cached.pos?.y === pos.y
    && cached.smallUrl
    && cached.largeUrl;
  if (isCurrent) return;

  const { img, url } = await loadImageFromBlob(cover.blob);
  const smallUrl = renderCoverPreviewFromImage(img, pos, zoom, COVER_PREVIEW_SIZES.small);
  const largeUrl = renderCoverPreviewFromImage(img, pos, zoom, COVER_PREVIEW_SIZES.large);
  URL.revokeObjectURL(url);

  series.coverPreviewSmall = smallUrl;
  series.coverPreviewLarge = largeUrl;
  await db.put("series", series);
  setCoverPreviewCache(seriesId, { smallUrl, largeUrl, imageId: cover.imageId, pos, zoom });
}

function updateZoomUI(editState, zoomInput, zoomValue){
  if (!editState || !zoomInput) return;
  const zoom = clampZoom(editState.zoom || 1);
  zoomInput.value = String(zoom);
  if (zoomValue){
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }
}

function setCropZoom(editState, frameEl, imgEl, zoomInput, zoomValue, nextZoom){
  if (!editState) return;
  editState.zoom = clampZoom(nextZoom);
  applyCropToImage(editState, frameEl, imgEl);
  updateZoomUI(editState, zoomInput, zoomValue);
}

function nudgeCropZoom(editState, frameEl, imgEl, zoomInput, zoomValue, delta){
  if (!editState) return;
  setCropZoom(editState, frameEl, imgEl, zoomInput, zoomValue, (editState.zoom || 1) + delta);
}

function humanStats(cards){
  const total = cards.length;
  const trade = cards.filter(c => c.foundTrade).length;
  const received = cards.filter(c => c.received).length;
  const pending = cards.filter(c => c.foundTrade && !c.received).length;
  return { total, trade, received, pending };
}
function computeProgress(cards){
  const { total, received } = humanStats(cards);
  const pct = total ? Math.round((received/total)*100) : 0;
  return { total, received, pct };
}
function setStatusFilter(filter){
  state.statusFilter = filter;
  $$(".chip").forEach(x => x.classList.toggle("active", x.dataset.filter === filter));
}
function nextAutoCollectionName(){
  let maxN = 0;
  for (const s of state.series){
    const m = (s.name||"").match(/^\s*Коллекция\s+(\d+)\s*$/i);
    if (m) maxN = Math.max(maxN, parseInt(m[1],10));
  }
  return `Коллекция ${maxN+1}`;
}

/* ---------- Migration ---------- */
async function migrateIfNeeded(){
  const allSeries = await db.getAll("series");
  const hasPartsStore = db.db?.objectStoreNames?.contains("parts");
  for (const s of allSeries){
    const images = await db.getAllByIndex("images","seriesId", s.id);
    const legacyParts = hasPartsStore ? await db.getAllByIndex("parts","seriesId", s.id) : [];
    const cards = await db.getAllByIndex("cards","seriesId", s.id);

    const createdImages = [];
    if (!images.length){
      if (legacyParts.length){
        const sortedParts = legacyParts.slice().sort((a,b)=>a.index-b.index);
        for (let i=0; i<sortedParts.length; i++){
          const p = sortedParts[i];
          const image = {
            id: p.id,
            seriesId: s.id,
            index: p.index || (i + 1),
            imageBlob: p.imageBlob,
            imageW: p.imageW || null,
            imageH: p.imageH || null,
            createdAt: p.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          await db.put("images", image);
          createdImages.push(image);
        }
      } else if (s.imageBlob){
        const image = {
          id: uid("image"),
          seriesId: s.id,
          index: 1,
          imageBlob: s.imageBlob,
          imageW: s.imageW || null,
          imageH: s.imageH || null,
          createdAt: s.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        await db.put("images", image);
        createdImages.push(image);
      }
    }

    const imageList = images.length ? images : createdImages;
    const fallbackImageId = imageList[0]?.id || null;
    for (const c of cards){
      let changed = false;
      if (c.note === undefined){ c.note = ""; changed = true; }
      if (c.thumbZoom === undefined){ c.thumbZoom = 1; changed = true; }
      if (!c.imageId){
        if (c.partId){
          c.imageId = c.partId;
          changed = true;
        } else if (fallbackImageId){
          c.imageId = fallbackImageId;
          changed = true;
        }
      }
      if (c.partId !== undefined){
        delete c.partId;
        changed = true;
      }
      if (changed){ c.updatedAt = Date.now(); await db.put("cards", c); }
    }

    let seriesChanged = false;
    if (s.coverPartId && !s.coverImageId){
      s.coverImageId = s.coverPartId;
      seriesChanged = true;
    }
    if (s.coverPartId !== undefined){ delete s.coverPartId; seriesChanged = true; }
    if (s.imageBlob){
      delete s.imageBlob;
      delete s.imageW;
      delete s.imageH;
      seriesChanged = true;
    }
    if (seriesChanged){
      s.updatedAt = Date.now();
      await db.put("series", s);
    }
  }
  if (hasPartsStore){
    try { await db.clear("parts"); } catch(e) { /* ignore */ }
  }
}

/* ---------- Views ---------- */
function setActiveSection(section){
  localStorage.setItem("ct_active_section", section);
}

function showHome(){
  els.seriesView.classList.add("hidden");
  els.collectionsView.classList.add("hidden");
  els.collectionDetailView.classList.add("hidden");
  els.collectionsListView.classList.remove("hidden");
  els.homeView.classList.remove("hidden");
  state.activeSeriesId = null;
  state.activeImageId = null;
  state.images = [];
  state.activeCollectionId = null;
  state.collectionImages = [];
  state.collectionItems = [];
  clearCollectionGalleryUrls();
  clearImageBlocks();
  localStorage.removeItem("ct_last_series");
  localStorage.removeItem("ct_last_collection");
  setActiveSection("home");
  renderSeriesList();
  renderHome();
}
function showSeries(){
  els.homeView.classList.add("hidden");
  els.collectionsView.classList.add("hidden");
  els.collectionDetailView.classList.add("hidden");
  els.seriesView.classList.remove("hidden");
  clearCollectionGalleryUrls();
  setActiveSection("series");
}

function showCollections(){
  els.homeView.classList.add("hidden");
  els.seriesView.classList.add("hidden");
  els.collectionsView.classList.remove("hidden");
  if (state.activeCollectionId){
    els.collectionsListView.classList.add("hidden");
    els.collectionDetailView.classList.remove("hidden");
  } else {
    els.collectionsListView.classList.remove("hidden");
    els.collectionDetailView.classList.add("hidden");
  }
  setActiveSection("collections");
}

/* ---------- Rendering: sidebar series list ---------- */
function renderSeriesList(){
  const active = state.activeSeriesId;
  const term = state.seriesSearch.trim().toLowerCase();
  els.seriesList.innerHTML = "";
  for (const s of state.series.filter(s => seriesDisplayName(s.name).toLowerCase().includes(term))){
    const item = document.createElement("div");
    item.className = "series-item" + (s.id===active ? " active" : "");
    item.dataset.id = s.id;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    updateCoverCacheFromSeries(s);
    const cachedCover = state.coverCache.get(s.id);
    if (cachedCover?.smallUrl){
      const img = new Image();
      img.src = cachedCover.smallUrl;
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = `<div style="font-weight:900;color:rgba(255,255,255,0.65)">✦</div>`;
      if (s.coverImageId){
        ensureCoverPreviews(s.id);
      }
    }

    const info = document.createElement("div");
    info.className = "series-info";
    const nameRow = document.createElement("div");
    nameRow.className = "series-name-row";
    const displayName = seriesDisplayName(s.name);
    nameRow.textContent = displayName;
    nameRow.title = displayName;

    const sub = document.createElement("div");
    sub.className = "series-sub";
    const badge = document.createElement("span");
    badge.className = "badge progress-badge dim";
    badge.textContent = "0/0";
    sub.appendChild(badge);

    info.append(nameRow, sub);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "series-delete";
    del.setAttribute("aria-label", "Удалить серию");
    del.textContent = "×";
    del.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await deleteSeriesById(s.id);
    });

    item.append(thumb, info, del);

    // Open
    item.addEventListener("click", () => openSeries(s.id));
    els.seriesList.appendChild(item);

    const cards = getCardsForSeries(s.id);
    const total = cards.length;
    const received = cards.reduce((acc,c)=>acc + (c.received ? 1 : 0), 0);
    badge.textContent = `${received}/${total}`;
    badge.classList.toggle("dim", total === 0);
  }
}

function escapeHtml(str){
  return (str ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function getSeriesCover(seriesId){
  const series = state.series.find(s => s.id === seriesId);
  const images = (await db.getAllByIndex("images","seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  if (!images.length){
    return { blob: null, pos: {x:50, y:50}, zoom: 1, imageId: null };
  }
  const coverImageId = series?.coverImageId;
  const image = images.find(p => p.id === coverImageId) || images[0];
  const rawPos = series?.coverPos || {x:50, y:50};
  const rawZoom = series?.coverZoom ?? 1;
  const pos = {
    x: clamp(Number(rawPos.x) || 50, 0, 100),
    y: clamp(Number(rawPos.y) || 50, 0, 100),
  };
  const zoom = clampZoom(rawZoom);
  return { blob: image?.imageBlob || null, pos, zoom, imageId: image?.id || null };
}

function clearCoverCache(seriesId){
  state.coverCache.delete(seriesId);
}

/* ---------- Home ---------- */
async function renderHome(){
  els.homeGrid.innerHTML = "";
  if (els.homeCount){
    els.homeCount.textContent = `Серий: ${state.series.length}`;
  }
  if (!state.series.length){
    els.homeEmpty.classList.remove("hidden");
    return;
  }
  els.homeEmpty.classList.add("hidden");

  const seriesStats = state.series.map((s) => {
    const cards = getCardsForSeries(s.id);
    const progress = computeProgress(cards);
    return {
      series: s,
      cards,
      progress,
      total: cards.length,
      completion: progress.pct,
      title: seriesDisplayName(s.name).toLowerCase(),
    };
  });

  let ordered = seriesStats.slice();
  const dir = state.homeSortDir === "desc" ? -1 : 1;
  if (state.homeSortKey){
    ordered.sort((a,b) => {
      let av = 0;
      let bv = 0;
      if (state.homeSortKey === "created"){
        av = a.series.createdAt || 0;
        bv = b.series.createdAt || 0;
        return (av - bv) * dir;
      }
      if (state.homeSortKey === "updated"){
        av = a.series.updatedAt || 0;
        bv = b.series.updatedAt || 0;
        return (av - bv) * dir;
      }
      if (state.homeSortKey === "completion"){
        av = a.completion || 0;
        bv = b.completion || 0;
        return (av - bv) * dir;
      }
      if (state.homeSortKey === "title"){
        return a.title.localeCompare(b.title, "ru", {sensitivity:"base"}) * dir;
      }
      return 0;
    });
  }

  for (const entry of ordered){
    const s = entry.series;
    const cardEl = document.createElement("div");
    cardEl.className = "home-card";
    cardEl.dataset.id = s.id;

    const thumb = document.createElement("div");
    thumb.className = "home-thumb";
    thumb.innerHTML = `<div class="ph">✦</div>`;

    const actions = document.createElement("div");
    actions.className = "home-thumb-actions";
    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "thumb-action";
    btnEdit.setAttribute("aria-label", "Настроить обложку");
    btnEdit.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">
      <path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M13 5l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    btnEdit.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      openCoverEditor(s.id);
    });
    const btnRefresh = document.createElement("button");
    btnRefresh.type = "button";
    btnRefresh.className = "thumb-action";
    btnRefresh.setAttribute("aria-label", "Сбросить обложку на первое изображение");
    btnRefresh.title = "Сбросить обложку на первое изображение";
    btnRefresh.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">
      <path d="M4 12a8 8 0 0 1 14-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M18 5v4h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M20 12a8 8 0 0 1-14 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    btnRefresh.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await refreshSeriesCover(s.id);
    });
    actions.append(btnEdit, btnRefresh);
    thumb.appendChild(actions);

    updateCoverCacheFromSeries(s);
    const cachedCover = state.coverCache.get(s.id);
    if (cachedCover?.largeUrl){
      const img = new Image();
      img.src = cachedCover.largeUrl;
      thumb.classList.add("has-cover");
      thumb.innerHTML = "";
      thumb.appendChild(img);
      thumb.appendChild(actions);
    } else if (s.coverImageId){
      ensureCoverPreviews(s.id);
    }

    const body = document.createElement("div");
    body.className = "home-body";
    const name = document.createElement("div");
    name.className = "home-name";
    name.textContent = seriesDisplayName(s.name);

    const { total, received, pct } = entry.progress;

    const meta = document.createElement("div");
    meta.className = "home-meta";
    meta.innerHTML = `<span>${received}/${total} получено</span><span>${pct}%</span>`;

    const prog = document.createElement("div");
    prog.className = "progress";
    const bar = document.createElement("div");
    bar.style.width = `${pct}%`;
    prog.appendChild(bar);

    body.append(name, meta, prog);
    cardEl.append(thumb, body);
    cardEl.addEventListener("click", () => openSeries(s.id));
    els.homeGrid.appendChild(cardEl);
  }
}

function clearCollectionThumbs(){
  for (const url of state.collectionThumbUrls.values()){
    URL.revokeObjectURL(url);
  }
  state.collectionThumbUrls.clear();
}

function clearCollectionGalleryUrls(){
  for (const url of state.collectionImageUrls.values()){
    URL.revokeObjectURL(url);
  }
  state.collectionImageUrls.clear();
}

async function getCollectionCoverImage(collectionId){
  const images = (await db.getAllByIndex("collectionImages", "collectionId", collectionId))
    .sort((a,b)=>(a.index||0)-(b.index||0));
  return images[0] || null;
}

async function renderCollectionsGrid(){
  if (!els.collectionsGrid) return;
  clearCollectionThumbs();
  els.collectionsGrid.innerHTML = "";
  if (els.collectionsCount){
    els.collectionsCount.textContent = `Коллекций: ${state.collections.length}`;
  }
  if (!state.collections.length){
    els.collectionsEmpty.classList.remove("hidden");
    return;
  }
  els.collectionsEmpty.classList.add("hidden");

  const ordered = state.collections.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  for (const collection of ordered){
    const cardEl = document.createElement("div");
    cardEl.className = "collection-card";
    cardEl.dataset.id = collection.id;

    const thumb = document.createElement("div");
    thumb.className = "collection-thumb";
    thumb.innerHTML = `<div class="ph">✦</div>`;

    const cover = await getCollectionCoverImage(collection.id);
    if (cover?.imageBlob){
      const url = URL.createObjectURL(cover.imageBlob);
      state.collectionThumbUrls.set(collection.id, url);
      const img = new Image();
      img.src = url;
      thumb.innerHTML = "";
      thumb.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "collection-body";
    const name = document.createElement("div");
    name.className = "collection-name-text";
    name.textContent = seriesDisplayName(collection.name);

    const items = getCollectionItemsForCollection(collection.id);
    const total = items.length;
    const checked = items.reduce((acc, item) => acc + (item.checked ? 1 : 0), 0);

    const meta = document.createElement("div");
    meta.className = "collection-meta";
    meta.innerHTML = `<span>${checked}/${total} отмечено</span><span>${collection.updatedAt ? "обновлено" : "новая"}</span>`;

    body.append(name, meta);
    cardEl.append(thumb, body);
    cardEl.addEventListener("click", () => openCollection(collection.id));
    els.collectionsGrid.appendChild(cardEl);
  }
}

async function renderCollectionGallery(){
  if (!els.collectionGallery) return;
  clearCollectionGalleryUrls();
  els.collectionGallery.innerHTML = "";
  if (!state.collectionImages.length){
    els.collectionGallery.innerHTML = `<div class="hint-small">Добавь изображения коллекции, чтобы увидеть галерею.</div>`;
    return;
  }
  for (const image of state.collectionImages){
    const item = document.createElement("div");
    item.className = "collection-gallery-item";
    const img = new Image();
    if (image.imageBlob){
      const url = URL.createObjectURL(image.imageBlob);
      state.collectionImageUrls.set(image.id, url);
      img.src = url;
    }
    item.appendChild(img);

    const actions = document.createElement("div");
    actions.className = "collection-gallery-actions";
    const del = document.createElement("button");
    del.className = "btn ghost danger";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", "Удалить изображение коллекции");
    del.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await deleteCollectionImage(image.id);
    });
    actions.appendChild(del);
    item.appendChild(actions);
    els.collectionGallery.appendChild(item);
  }
}

function renderCollectionItemsGrid(){
  if (!els.collectionItemsGrid) return;
  els.collectionItemsGrid.innerHTML = "";
  if (!state.collectionItems.length){
    els.collectionItemsGrid.innerHTML = `<div class="hint-small">Добавь предметы, чтобы отмечать их статусы.</div>`;
    return;
  }
  for (const item of state.collectionItems){
    const card = document.createElement("div");
    card.className = "collection-item-card";
    card.dataset.id = item.id;

    const head = document.createElement("div");
    head.className = "collection-item-head";
    const title = document.createElement("div");
    title.className = "collection-item-title";
    title.textContent = item.title || "Без названия";

    const actions = document.createElement("div");
    actions.className = "collection-item-actions";
    const del = document.createElement("button");
    del.className = "btn ghost danger";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", "Удалить предмет");
    del.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await deleteCollectionItem(item.id);
    });
    actions.appendChild(del);
    head.append(title, actions);

    const controls = document.createElement("div");
    controls.className = "collection-item-controls";
    const checkLabel = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(item.checked);
    checkbox.addEventListener("change", async () => {
      item.checked = checkbox.checked;
      item.updatedAt = Date.now();
      await db.put("collectionItems", item);
      syncCollectionItemsCacheForCollection(item.collectionId, state.collectionItems);
      await touchCollectionUpdated();
    });
    const checkText = document.createElement("span");
    checkText.textContent = "Отмечено";
    checkLabel.append(checkbox, checkText);

    const status = document.createElement("select");
    for (const [value, label] of Object.entries(COLLECTION_STATUS_LABELS)){
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      status.appendChild(opt);
    }
    status.value = item.status || "planned";
    status.addEventListener("change", async () => {
      item.status = status.value;
      item.updatedAt = Date.now();
      await db.put("collectionItems", item);
      syncCollectionItemsCacheForCollection(item.collectionId, state.collectionItems);
      await touchCollectionUpdated();
    });

    controls.append(checkLabel, status);

    card.append(head, controls);
    els.collectionItemsGrid.appendChild(card);
  }
}

/* ---------- Open series ---------- */
async function openSeries(seriesId){
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;

  state.activeSeriesId = seriesId;
  localStorage.setItem("ct_last_series", seriesId);
  showSeries();
  renderSeriesList();

  state.images = (await db.getAllByIndex("images","seriesId", seriesId)).sort((a,b)=>(a.index||0)-(b.index||0));
  let imageChanged = false;
  for (let i=0; i<state.images.length; i++){
    const img = state.images[i];
    if (!img.index){
      img.index = i + 1;
      img.updatedAt = Date.now();
      await db.put("images", img);
      imageChanged = true;
    }
  }
  if (imageChanged){
    state.images.sort((a,b)=>(a.index||0)-(b.index||0));
  }
  state.cards = (await db.getAllByIndex("cards","seriesId", seriesId)).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  syncCardsCacheForSeries(seriesId, state.cards);

  setStatusFilter("all");
  state.selectedCardId = null;
  state.listHoverCardId = null;
  state.activeImageId = null;

  els.seriesName.value = s.name || "";

  updateDropzoneVisibility();
  await ensureCardPreviews();
  await renderImageBlocks();
  refreshStatsAndRender();
  window.scrollTo({top:0, behavior:"smooth"});
}

/* ---------- Collections ---------- */
async function openCollection(collectionId){
  const collection = state.collections.find(x=>x.id===collectionId);
  if (!collection) return;
  state.activeCollectionId = collectionId;
  localStorage.setItem("ct_last_collection", collectionId);
  showCollections();
  els.collectionsListView.classList.add("hidden");
  els.collectionDetailView.classList.remove("hidden");

  els.collectionName.value = collection.name || "";

  state.collectionImages = (await db.getAllByIndex("collectionImages","collectionId", collectionId))
    .sort((a,b)=>(a.index||0)-(b.index||0));
  let imageChanged = false;
  for (let i=0; i<state.collectionImages.length; i++){
    const img = state.collectionImages[i];
    if (!img.index){
      img.index = i + 1;
      img.updatedAt = Date.now();
      await db.put("collectionImages", img);
      imageChanged = true;
    }
  }
  if (imageChanged){
    state.collectionImages.sort((a,b)=>(a.index||0)-(b.index||0));
  }

  state.collectionItems = (await db.getAllByIndex("collectionItems","collectionId", collectionId))
    .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  for (const item of state.collectionItems){
    let itemChanged = false;
    if (!item.status){
      item.status = "planned";
      itemChanged = true;
    }
    if (item.checked === undefined){
      item.checked = false;
      itemChanged = true;
    }
    if (itemChanged){
      item.updatedAt = Date.now();
      await db.put("collectionItems", item);
    }
  }
  syncCollectionItemsCacheForCollection(collectionId, state.collectionItems);

  await renderCollectionsGrid();
  await renderCollectionGallery();
  renderCollectionItemsGrid();
  window.scrollTo({top:0, behavior:"smooth"});
}

function closeCollectionDetail(){
  state.activeCollectionId = null;
  state.collectionImages = [];
  state.collectionItems = [];
  clearCollectionGalleryUrls();
  localStorage.removeItem("ct_last_collection");
  els.collectionDetailView.classList.add("hidden");
  els.collectionsListView.classList.remove("hidden");
  renderCollectionsGrid();
}

async function createCollection(name){
  const collection = {
    id: uid("collection"),
    name: limitText(name, 60).trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("collections", collection);
  state.collections.unshift(collection);
  await renderCollectionsGrid();
  await openCollection(collection.id);
}

async function deleteCollectionById(id){
  const collection = state.collections.find(x=>x.id===id);
  if (!collection) return;
  const ok = await confirmDialog("Удалить коллекцию?", `Коллекция “${seriesDisplayName(collection.name)}” и все её данные будут удалены.`, "Удалить");
  if (!ok) return;

  const images = await db.getAllByIndex("collectionImages","collectionId", id);
  for (const img of images) await db.delete("collectionImages", img.id);
  const items = await db.getAllByIndex("collectionItems","collectionId", id);
  for (const item of items) await db.delete("collectionItems", item.id);
  await db.delete("collections", id);

  if (state.activeCollectionId === id){
    closeCollectionDetail();
  }
  state.collections = state.collections.filter(x=>x.id!==id);
  removeCollectionItemsFromCache(id);
  await renderCollectionsGrid();
}

async function addCollectionImagesFromFiles(files){
  if (!state.activeCollectionId) return;
  const startIndex = state.collectionImages.length;
  const added = [];
  for (let i=0; i<files.length; i++){
    const file = files[i];
    const image = {
      id: uid("collection_image"),
      collectionId: state.activeCollectionId,
      index: startIndex + i + 1,
      imageBlob: file,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.put("collectionImages", image);
    added.push(image);
  }
  state.collectionImages = state.collectionImages.concat(added);
  await renderCollectionGallery();
  await touchCollectionUpdated();
}

async function deleteCollectionImage(imageId){
  const image = state.collectionImages.find(img => img.id === imageId);
  if (!image) return;
  await db.delete("collectionImages", imageId);
  state.collectionImages = state.collectionImages.filter(img => img.id !== imageId);
  clearCollectionGalleryUrls();
  await renderCollectionGallery();
  await touchCollectionUpdated();
}

async function addCollectionItem(){
  if (!state.activeCollectionId) return;
  const title = limitText(els.collectionItemName.value, 80).trim();
  if (!title) return;
  const status = els.collectionItemStatus.value || "planned";
  const item = {
    id: uid("collection_item"),
    collectionId: state.activeCollectionId,
    title,
    status,
    checked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("collectionItems", item);
  state.collectionItems.push(item);
  syncCollectionItemsCacheForCollection(state.activeCollectionId, state.collectionItems);
  els.collectionItemName.value = "";
  renderCollectionItemsGrid();
  await touchCollectionUpdated();
}

async function deleteCollectionItem(itemId){
  const item = state.collectionItems.find(x=>x.id===itemId);
  if (!item) return;
  await db.delete("collectionItems", itemId);
  state.collectionItems = state.collectionItems.filter(x=>x.id!==itemId);
  syncCollectionItemsCacheForCollection(item.collectionId, state.collectionItems);
  renderCollectionItemsGrid();
  await touchCollectionUpdated();
}

function updateDropzoneVisibility(){
  const empty = state.images.length === 0;
  els.seriesLeftcol.classList.toggle("leftcol--empty", empty);
  if (!empty){
    els.seriesLeftcol.classList.remove("is-dragover");
  }
}

function clearImageBlocks(){
  for (const block of state.imageBlocks.values()){
    if (block.imageURL) URL.revokeObjectURL(block.imageURL);
  }
  state.imageBlocks.clear();
  if (els.imageBlocks) els.imageBlocks.innerHTML = "";
}

async function renderImageBlocks(){
  clearImageBlocks();
  if (!els.imageBlocks) return;
  if (!state.images.length){
    updateDropzoneVisibility();
    return;
  }
  const ordered = state.images.slice().sort((a,b)=>a.index-b.index);
  let idx = 1;
  for (const image of ordered){
    await createImageBlock(image, idx);
    idx += 1;
  }
  updateDropzoneVisibility();
  requestAnimationFrame(() => resizeAllImageBlocks());
}

async function createImageBlock(image, idx){
  const blockEl = document.createElement("div");
  blockEl.className = "image-block";
  blockEl.dataset.imageId = image.id;

  const head = document.createElement("div");
  head.className = "image-block-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "image-title-wrap";
  const titleText = document.createElement("span");
  titleText.className = "image-title-text";
  titleText.textContent = imageDisplayTitle(image, idx);
  const titleInput = document.createElement("input");
  titleInput.className = "image-title-input";
  titleInput.type = "text";
  titleInput.maxLength = 60;
  titleInput.value = (image.title || "").trim();
  titleInput.placeholder = `Изображение ${idx}`;

  const titleEdit = document.createElement("button");
  titleEdit.type = "button";
  titleEdit.className = "image-title-edit";
  titleEdit.title = "Редактировать название изображения";
  titleEdit.setAttribute("aria-label", "Редактировать название изображения");
  titleEdit.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">
    <path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13 5l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;

  const commitTitle = async () => {
    if (!titleWrap.classList.contains("editing")) return;
    titleWrap.classList.remove("editing");
    const nextTitle = limitText(titleInput.value, 60).trim();
    image.title = nextTitle;
    image.updatedAt = Date.now();
    await db.put("images", image);
    titleText.textContent = imageDisplayTitle(image, idx);
  };

  titleEdit.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    titleWrap.classList.add("editing");
    titleInput.value = (image.title || "").trim();
    titleInput.focus();
    titleInput.select();
  });
  titleInput.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter"){
      evt.preventDefault();
      titleInput.blur();
    }
  });
  titleInput.addEventListener("blur", () => {
    commitTitle();
  });

  titleWrap.append(titleText, titleInput, titleEdit);

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "open-image-btn";
  openBtn.title = "Открыть изображение";
  openBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none">
    <path d="M4 5h16v14H4z" stroke="currentColor" stroke-width="1.6" />
    <path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
  openBtn.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    openImageViewer(image.id);
  });

  head.append(titleWrap, openBtn);

  const wrap = document.createElement("div");
  wrap.className = "image-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  wrap.appendChild(canvas);

  blockEl.append(head, wrap);
  els.imageBlocks.appendChild(blockEl);

  const ctx = canvas.getContext("2d");
  const { img, url } = image.imageBlob ? await loadImageFromBlob(image.imageBlob) : { img: null, url: null };
  const block = {
    imageId: image.id,
    image,
    blockEl,
    canvas,
    ctx,
    imageEl: img,
    imageURL: url,
    imageScale: 1,
    hoverCardId: null,
    drag: { active:false, startX:0, startY:0, curX:0, curY:0 },
  };
  state.imageBlocks.set(image.id, block);
  if (img){
    img.addEventListener("load", () => resizeImageBlock(block), { once: true });
    if (img.complete && img.naturalWidth){
      requestAnimationFrame(() => resizeImageBlock(block));
    }
  }

  canvas.addEventListener("pointerdown", (evt) => onImagePointerDown(evt, block));
  canvas.addEventListener("pointermove", (evt) => onImagePointerMove(evt, block));
  canvas.addEventListener("pointerup", (evt) => onImagePointerUp(evt, block));
  canvas.addEventListener("pointercancel", (evt) => onImagePointerUp(evt, block));
  canvas.addEventListener("pointerleave", () => {
    if (block.hoverCardId){
      block.hoverCardId = null;
      drawImageBlock(block);
    }
  });
  resizeImageBlock(block);
  drawImageBlock(block);
}

function resizeAllImageBlocks(){
  for (const block of state.imageBlocks.values()){
    resizeImageBlock(block);
  }
}

function resizeImageBlock(block){
  const parent = block.canvas.parentElement;
  if (!parent) return;
  const cssW = parent.clientWidth;
  const imgW = block.imageEl?.naturalWidth || block.imageEl?.width || 0;
  const imgH = block.imageEl?.naturalHeight || block.imageEl?.height || 0;
  const ratio = imgW > 0 && imgH > 0 ? imgH / imgW : 0.75;
  const minH = 320;
  const maxH = Math.min(720, Math.max(420, window.innerHeight - 240));
  const cssH = clamp(cssW * ratio, minH, maxH);
  block.canvas.style.width = cssW + "px";
  block.canvas.style.height = cssH + "px";
  block.canvas.width = devicePx(cssW);
  block.canvas.height = devicePx(cssH);
  computeImageScaleFor(block);
  drawImageBlock(block);
}

function computeImageScaleFor(block){
  if (!block.imageEl){ block.imageScale = 1; return; }
  const imgW = block.imageEl.naturalWidth || block.imageEl.width || 1;
  const imgH = block.imageEl.naturalHeight || block.imageEl.height || 1;
  const sx = block.canvas.width / imgW;
  const sy = block.canvas.height / imgH;
  block.imageScale = Math.max(sx, sy);
}
function imageDrawRectFor(block){
  if (!block.imageEl) return {dx:0, dy:0, dw: block.canvas.width, dh: block.canvas.height};
  const imgW = block.imageEl.naturalWidth || block.imageEl.width || 1;
  const imgH = block.imageEl.naturalHeight || block.imageEl.height || 1;
  const dw = Math.ceil(imgW * block.imageScale);
  const dh = Math.ceil(imgH * block.imageScale);
  const dx = Math.floor((block.canvas.width - dw) / 2);
  const dy = Math.floor((block.canvas.height - dh) / 2);
  return {dx, dy, dw, dh};
}
function isPointInsideImage(block, cx, cy){
  if (!block.imageEl) return false;
  const {dx,dy,dw,dh} = imageDrawRectFor(block);
  return cx>=dx && cx<=dx+dw && cy>=dy && cy<=dy+dh;
}
function pointerPos(evt, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * devicePixelRatio,
    y: (evt.clientY - rect.top) * devicePixelRatio
  };
}
function canvasToImageCoords(block, cx, cy){
  const {dx,dy} = imageDrawRectFor(block);
  const x = (cx - dx) / block.imageScale;
  const y = (cy - dy) / block.imageScale;
  return { x: clamp(x,0,block.imageEl.width), y: clamp(y,0,block.imageEl.height) };
}
function imageToCanvasCoords(block, ix, iy){
  const {dx,dy} = imageDrawRectFor(block);
  return { cx: dx + ix*block.imageScale, cy: dy + iy*block.imageScale };
}

function findCardAtPoint(block, ix, iy){
  const imageCards = state.cards.filter(c=>c.imageId===block.imageId);
  let best = null;
  let bestArea = Infinity;
  for (const c of imageCards){
    if (ix < c.x || ix > c.x + c.w || iy < c.y || iy > c.y + c.h) continue;
    const area = Math.max(1, c.w) * Math.max(1, c.h);
    if (area < bestArea){
      bestArea = area;
      best = c;
    }
  }
  return best;
}

function drawImageBlock(block){
  const ctx = block.ctx;
  if (!ctx) return;
  const bg = getCanvasFillColor(block.canvas.parentElement, "rgba(255,255,255,0.04)");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, block.canvas.width, block.canvas.height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, block.canvas.width, block.canvas.height);
  ctx.restore();

  if (!block.imageEl){
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `${Math.floor(16*devicePixelRatio)}px system-ui`;
    const msg = "Добавь изображение, чтобы выделять открытки.";
    ctx.fillText(msg, devicePx(18), devicePx(28));
    ctx.restore();
    return;
  }

  const r = imageDrawRectFor(block);
  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.drawImage(block.imageEl, r.dx, r.dy, r.dw, r.dh);
  ctx.restore();

  const imageCards = state.cards.filter(c=>c.imageId===block.imageId);
  const focusActive = state.focusCardId && state.focusUntil && (Date.now() < state.focusUntil);
  const visibleIds = new Set();
  if (block.hoverCardId) visibleIds.add(block.hoverCardId);
  if (state.listHoverCardId) visibleIds.add(state.listHoverCardId);
  if (state.selectedCardId) visibleIds.add(state.selectedCardId);
  if (focusActive && state.focusCardId) visibleIds.add(state.focusCardId);
  const showAll = block.drag.active;

  for (const c of imageCards){
    if (!showAll && !visibleIds.has(c.id)) continue;
    const {cx:x1, cy:y1} = imageToCanvasCoords(block, c.x, c.y);
    const {cx:x2, cy:y2} = imageToCanvasCoords(block, c.x+c.w, c.y+c.h);
    const rr = rectNormalize(x1,y1,x2,y2);

    const isFocus = focusActive && c.id === state.focusCardId;
    const isHi = isFocus || block.hoverCardId===c.id || state.listHoverCardId===c.id || state.selectedCardId===c.id;
    const isReceived = !!c.received;
    const isTrade = !!c.foundTrade;

    ctx.save();
    let pulseBoost = 1;
    if (isFocus){
      const progress = clamp((Date.now() - state.focusStart) / Math.max(1, state.focusUntil - state.focusStart), 0, 1);
      pulseBoost = 0.9 + Math.sin(progress * Math.PI) * 0.5;
    }
    ctx.lineWidth = devicePx(isHi ? (2.2 * pulseBoost) : 1.6);
    ctx.globalAlpha = isFocus ? 0.95 : 0.85;

    ctx.strokeStyle = isReceived ? "rgba(34,197,94,0.95)"
                  : isTrade ? "rgba(245,158,11,0.95)"
                  : "rgba(167,139,250,0.95)";
    ctx.fillStyle = isReceived ? "rgba(34,197,94,0.12)"
                 : isTrade ? "rgba(245,158,11,0.10)"
                 : "rgba(167,139,250,0.10)";
    ctx.beginPath();
    ctx.roundRect(rr.x, rr.y, rr.w, rr.h, devicePx(10));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (block.drag.active){
    const rr = rectNormalize(block.drag.startX, block.drag.startY, block.drag.curX, block.drag.curY);
    ctx.save();
    ctx.lineWidth = devicePx(2);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.setLineDash([devicePx(8), devicePx(6)]);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.roundRect(rr.x, rr.y, rr.w, rr.h, devicePx(10));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawAllImageBlocks(){
  for (const block of state.imageBlocks.values()){
    drawImageBlock(block);
  }
}

async function onImagePointerDown(evt, block){
  if (!block.imageEl) return;
  block.canvas.setPointerCapture(evt.pointerId);
  const {x,y} = pointerPos(evt, block.canvas);
  if (!isPointInsideImage(block, x, y)) return;
  state.activeImageId = block.imageId;
  block.drag.active = true;
  block.hoverCardId = null;
  block.drag.startX = x; block.drag.startY = y;
  block.drag.curX = x; block.drag.curY = y;
  drawImageBlock(block);
}
function onImagePointerMove(evt, block){
  const {x,y} = pointerPos(evt, block.canvas);
  if (block.drag.active){
    block.drag.curX = x; block.drag.curY = y;
    drawImageBlock(block);
    return;
  }
  if (!block.imageEl) return;
  if (!isPointInsideImage(block, x, y)){
    if (block.hoverCardId){
      block.hoverCardId = null;
      drawImageBlock(block);
    }
    return;
  }
  const {x:ix, y:iy} = canvasToImageCoords(block, x, y);
  const hit = findCardAtPoint(block, ix, iy);
  const nextId = hit ? hit.id : null;
  if (nextId !== block.hoverCardId){
    block.hoverCardId = nextId;
    drawImageBlock(block);
  }
}
async function onImagePointerUp(evt, block){
  if (!block.drag.active) return;
  block.drag.active = false;

  const rr = rectNormalize(block.drag.startX, block.drag.startY, block.drag.curX, block.drag.curY);
  if (!rectValid(rr)){
    if (evt){
      const {x, y} = canvasToImageCoords(block, block.drag.curX, block.drag.curY);
      const hit = findCardAtPoint(block, x, y);
      if (hit){
        await focusCardInList(hit);
        state.selectedCardId = hit.id;
        drawImageBlock(block);
        return;
      }
    }
    state.selectedCardId = null;
    drawImageBlock(block);
    return;
  }

  const p1 = canvasToImageCoords(block, rr.x, rr.y);
  const p2 = canvasToImageCoords(block, rr.x+rr.w, rr.y+rr.h);
  const ir = rectNormalize(p1.x, p1.y, p2.x, p2.y);

  const existing = state.cards.filter(c=>c.imageId===block.imageId);
  if (bestOverlap(ir, existing) > 0.82){ drawImageBlock(block); return; }

  const card = {
    id: uid("card"),
    seriesId: state.activeSeriesId,
    imageId: block.imageId,
    x: Math.round(ir.x),
    y: Math.round(ir.y),
    w: Math.round(ir.w),
    h: Math.round(ir.h),
    foundTrade: false,
    received: false,
    title: "",
    note: "",
    thumbPos: {x:50, y:50},
    thumbZoom: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (block.imageEl){
    card.thumbPreview = renderCardPreviewDataURL(card, block.imageEl);
  }

  await db.put("cards", card);
  state.cards.push(card);
  syncCardsCacheForSeries(state.activeSeriesId, state.cards);
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

async function addImageFromFile(file){
  if (!file || !state.activeSeriesId) return;
  const nextIdx = state.images.length ? Math.max(...state.images.map(p=>p.index)) + 1 : 1;

  const { img, url } = await loadImageFromBlob(file);
  const w = img?.naturalWidth || img?.width || null;
  const h = img?.naturalHeight || img?.height || null;

  const image = {
    id: uid("image"),
    seriesId: state.activeSeriesId,
    index: nextIdx,
    title: "",
    imageBlob: file,
    imageW: w,
    imageH: h,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("images", image);

  state.images.push(image);
  state.images.sort((a,b)=>a.index-b.index);

  const series = state.series.find(s => s.id === state.activeSeriesId);
  if (series && !series.coverImageId){
    series.coverImageId = image.id;
    series.coverPos = {x:50, y:50};
    series.coverZoom = 1;
    series.updatedAt = Date.now();
    await db.put("series", series);
    await ensureCoverPreviews(series.id, {
      blob: file,
      pos: series.coverPos,
      zoom: series.coverZoom,
      imageId: image.id,
    });
  }

  await touchSeriesUpdated();
  if (url) URL.revokeObjectURL(url);
  await renderImageBlocks();
  refreshStatsAndRender();
}

async function addImagesFromFiles(files){
  const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  if (!list.length) return;
  for (const file of list){
    await addImageFromFile(file);
  }
  updateDropzoneVisibility();
}

function setupImageViewer(){
  if (state.imageViewer) return;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog image-viewer";
  dialog.innerHTML = `
    <div class="dialog-card dialog-image">
      <div class="viewer-head">
        <div class="viewer-title">Просмотр изображения</div>
        <div class="viewer-controls">
          <button type="button" class="viewer-zoom-btn viewer-zoom-out" aria-label="Уменьшить">−</button>
          <input type="range" class="viewer-zoom-range" min="1" max="3" step="0.05" value="1" aria-label="Зум" />
          <button type="button" class="viewer-zoom-btn viewer-zoom-in" aria-label="Увеличить">+</button>
          <div class="viewer-zoom-value" aria-live="polite">100%</div>
        </div>
        <button type="button" class="image-close" aria-label="Закрыть">×</button>
      </div>
      <div class="viewer-media">
        <img class="viewer-image" alt="Просмотр изображения" />
      </div>
    </div>
  `;
  dialog.addEventListener("click", (evt) => {
    if (evt.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);
  const closeBtn = dialog.querySelector(".image-close");
  closeBtn.addEventListener("click", () => dialog.close());
  const viewerMedia = dialog.querySelector(".viewer-media");
  const img = dialog.querySelector(".viewer-image");
  const zoomRange = dialog.querySelector(".viewer-zoom-range");
  const zoomValue = dialog.querySelector(".viewer-zoom-value");
  const zoomInBtn = dialog.querySelector(".viewer-zoom-in");
  const zoomOutBtn = dialog.querySelector(".viewer-zoom-out");
  const zoomMin = Number(zoomRange.min);
  const zoomMax = Number(zoomRange.max);
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartTx = 0;
  let dragStartTy = 0;

  const clampViewerTranslation = () => {
    if (!state.viewerImageEl?.naturalWidth) return { tx: 0, ty: 0 };
    const bounds = viewerMedia.getBoundingClientRect();
    const baseScale = Math.min(
      bounds.width / state.viewerImageEl.naturalWidth,
      bounds.height / state.viewerImageEl.naturalHeight
    );
    const scaledW = state.viewerImageEl.naturalWidth * baseScale * state.viewerZoom;
    const scaledH = state.viewerImageEl.naturalHeight * baseScale * state.viewerZoom;
    const maxOffsetX = Math.max(0, (scaledW - bounds.width) / 2);
    const maxOffsetY = Math.max(0, (scaledH - bounds.height) / 2);
    return {
      tx: clamp(state.viewerTx, -maxOffsetX, maxOffsetX),
      ty: clamp(state.viewerTy, -maxOffsetY, maxOffsetY),
    };
  };

  const updateViewerTransform = () => {
    if (!state.viewerImageEl) return;
    const { tx, ty } = clampViewerTranslation();
    state.viewerTx = tx;
    state.viewerTy = ty;
    state.viewerImageEl.style.transform = `translate(${state.viewerTx}px, ${state.viewerTy}px) scale(${state.viewerZoom})`;
    zoomRange.value = String(state.viewerZoom);
    zoomValue.textContent = `${Math.round(state.viewerZoom * 100)}%`;
  };

  const resetViewerState = () => {
    state.viewerZoom = 1;
    state.viewerTx = 0;
    state.viewerTy = 0;
    updateViewerTransform();
  };

  zoomRange.addEventListener("input", () => {
    state.viewerZoom = clamp(Number(zoomRange.value), zoomMin, zoomMax);
    updateViewerTransform();
  });

  zoomInBtn.addEventListener("click", () => {
    state.viewerZoom = clamp(state.viewerZoom + 0.1, zoomMin, zoomMax);
    updateViewerTransform();
  });

  zoomOutBtn.addEventListener("click", () => {
    state.viewerZoom = clamp(state.viewerZoom - 0.1, zoomMin, zoomMax);
    updateViewerTransform();
  });

  viewerMedia.addEventListener("wheel", (evt) => {
    if (!state.viewerImageEl?.naturalWidth) return;
    evt.preventDefault();
    const direction = evt.deltaY > 0 ? -1 : 1;
    const nextZoom = state.viewerZoom + direction * 0.1;
    state.viewerZoom = clamp(nextZoom, zoomMin, zoomMax);
    updateViewerTransform();
  }, { passive: false });

  viewerMedia.addEventListener("pointerdown", (evt) => {
    if (evt.button !== 0) return;
    dragPointerId = evt.pointerId;
    viewerMedia.setPointerCapture(dragPointerId);
    dragStartX = evt.clientX;
    dragStartY = evt.clientY;
    dragStartTx = state.viewerTx;
    dragStartTy = state.viewerTy;
    viewerMedia.classList.add("is-dragging");
  });

  viewerMedia.addEventListener("pointermove", (evt) => {
    if (dragPointerId !== evt.pointerId) return;
    const dx = evt.clientX - dragStartX;
    const dy = evt.clientY - dragStartY;
    state.viewerTx = dragStartTx + dx;
    state.viewerTy = dragStartTy + dy;
    updateViewerTransform();
  });

  const endDrag = (evt) => {
    if (dragPointerId !== evt.pointerId) return;
    viewerMedia.releasePointerCapture(dragPointerId);
    dragPointerId = null;
    viewerMedia.classList.remove("is-dragging");
  };

  viewerMedia.addEventListener("pointerup", endDrag);
  viewerMedia.addEventListener("pointercancel", endDrag);

  img.addEventListener("load", () => {
    updateViewerTransform();
  });

  dialog.addEventListener("close", () => {
    if (state.viewerImageEl){
      state.viewerImageEl.src = "";
    }
    resetViewerState();
  });

  state.imageViewer = dialog;
  state.viewerImageEl = img;
  state.viewerUpdateTransform = updateViewerTransform;
  resetViewerState();
}

function openImageViewer(imageId){
  if (!state.imageViewer) return;
  const block = state.imageBlocks.get(imageId);
  if (!block?.imageEl) return;
  state.viewerZoom = 1;
  state.viewerTx = 0;
  state.viewerTy = 0;
  if (state.viewerImageEl){
    state.viewerImageEl.src = block.imageEl.src;
  }
  state.viewerUpdateTransform?.();
  state.imageViewer.showModal();
}

/* ---------- Stats + list ---------- */
function renderStats(){
  const { total, trade, received, pending } = humanStats(state.cards);
  els.seriesStats.textContent = total ? `Всего: ${total} • Обмен найден: ${trade} • Получено: ${received} • Жду: ${pending}` : `Пока нет выделенных открыток`;
}

function filterCards(cards){
  let out = cards;
  if (state.statusFilter === "trade") out = out.filter(c=>c.foundTrade);
  else if (state.statusFilter === "received") out = out.filter(c=>c.received);
  else if (state.statusFilter === "pending") out = out.filter(c=>c.foundTrade && !c.received);
  else if (state.statusFilter === "missing" || state.statusFilter === "notfound") out = out.filter(c=>!c.foundTrade && !c.received);
  return out;
}

function cardLabel(idx){ return `Открытка ${String(idx+1).padStart(2,"0")}`; }

async function ensureImageCache(){
  const nextCache = new Map(state.imageById);
  const seenIds = new Set();
  const pending = [];
  for (const image of state.images){
    seenIds.add(image.id);
    if (!image.imageBlob){
      nextCache.delete(image.id);
      continue;
    }
    const cached = state.imageById.get(image.id);
    if (cached?.__blob === image.imageBlob){
      nextCache.set(image.id, cached);
      continue;
    }
    const url = URL.createObjectURL(image.imageBlob);
    const img = new Image();
    img.src = url;
    pending.push(
      img.decode()
        .catch(()=>{})
        .then(() => {
          URL.revokeObjectURL(url);
          img.__blob = image.imageBlob;
          nextCache.set(image.id, img);
        })
    );
  }
  await Promise.all(pending);
  for (const id of Array.from(nextCache.keys())){
    if (!seenIds.has(id)) nextCache.delete(id);
  }
  state.imageById = nextCache;
}

function getCardPreviewSize(card){
  const maxW = 320;
  const maxH = 240;
  const ratio = Math.max(1, card.w) / Math.max(1, card.h);
  let width = maxW;
  let height = Math.round(width / ratio);
  if (height > maxH){
    height = maxH;
    width = Math.round(height * ratio);
  }
  return { width, height };
}

function renderCardBasePreviewDataURL(card, img){
  if (!img) return CARD_PREVIEW_PLACEHOLDER;
  const { width, height } = getCardPreviewSize(card);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(
    img,
    Math.max(0, card.x),
    Math.max(0, card.y),
    Math.max(1, card.w),
    Math.max(1, card.h),
    0,
    0,
    width,
    height
  );
  return canvas.toDataURL("image/jpeg", 0.78);
}

function renderCardPreviewDataURL(card, img){
  if (!img) return CARD_PREVIEW_PLACEHOLDER;
  const { width, height } = getCardPreviewSize(card);
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = width;
  baseCanvas.height = height;
  const baseCtx = baseCanvas.getContext("2d");
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.clearRect(0, 0, width, height);
  baseCtx.drawImage(
    img,
    Math.max(0, card.x),
    Math.max(0, card.y),
    Math.max(1, card.w),
    Math.max(1, card.h),
    0,
    0,
    width,
    height
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, width, height);

  const safeZoom = clampZoom(card.thumbZoom ?? 1);
  const { scaledW, scaledH, overflowX, overflowY } = getCropMetrics(width, height, width, height, safeZoom);
  const nextPos = clampCropPosition(card.thumbPos || { x: 50, y: 50 }, overflowX, overflowY);
  const offsetX = overflowX ? (nextPos.x / 100) * overflowX : 0;
  const offsetY = overflowY ? (nextPos.y / 100) * overflowY : 0;
  ctx.drawImage(baseCanvas, -offsetX, -offsetY, scaledW, scaledH);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function cardPreviewSrc(card){
  return card.thumbPreview || CARD_PREVIEW_PLACEHOLDER;
}

async function ensureCardPreviews(){
  await ensureImageCache();
  const updates = [];
  for (const c of state.cards){
    const needsRefresh = !c.thumbPreview
      || (c.thumbZoom ?? 1) !== 1
      || (Number(c.thumbPos?.x) || 50) !== 50
      || (Number(c.thumbPos?.y) || 50) !== 50;
    if (!needsRefresh) continue;
    const img = state.imageById.get(c.imageId);
    if (!img) continue;
    c.thumbPreview = renderCardPreviewDataURL(c, img);
    updates.push(db.put("cards", c));
  }
  await Promise.all(updates);
}

async function renderCardsList(){
  const visible = filterCards(state.cards);
  els.cardsList.innerHTML = "";

  if (!visible.length){
    const empty = document.createElement("div");
    empty.style.color = "rgba(255,255,255,0.65)";
    empty.style.fontSize = "13px";
    empty.style.padding = "12px";
    empty.textContent = state.cards.length ? "По фильтрам ничего нет." : "Добавь изображение, затем выделяй открытки рамкой — они появятся здесь.";
    els.cardsList.appendChild(empty);
    return;
  }

  visible.forEach((c) => {
    const idx = state.cards.findIndex(x=>x.id===c.id);

    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.dataset.cardId = c.id;

    const mini = document.createElement("button");
    mini.type = "button";
    mini.className = "mini";
    const img = document.createElement("img");
    img.alt = "";
    img.src = cardPreviewSrc(c);
    mini.appendChild(img);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "thumb-edit";
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">
      <path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M13 5l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    editBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      openThumbEditor(c);
    });
    mini.appendChild(editBtn);
    mini.addEventListener("click", () => showCardOnCanvas(c));

    const meta = document.createElement("div");
    meta.className = "meta";

    const row1 = document.createElement("div");
    row1.className = "row1";
    const label = document.createElement("input");
    label.className = "label title-input";
    label.type = "text";
    label.maxLength = 60;
    label.value = (c.title || "").trim() || cardLabel(idx);
    label.placeholder = cardLabel(idx);
    let titleTmr = null;
    label.addEventListener("input", () => {
      if (titleTmr) clearTimeout(titleTmr);
      titleTmr = setTimeout(async () => {
        label.value = limitText(label.value, 60);
        c.title = label.value.trim();
        c.updatedAt = Date.now();
        await db.put("cards", c);
        await touchSeriesUpdated();
      }, 250);
    });
    row1.append(label);

    const checks = document.createElement("div");
    checks.className = "checks";

    const t1 = document.createElement("label");
    t1.className = "toggle";
    const cb1 = document.createElement("input");
    cb1.type = "checkbox";
    cb1.checked = !!c.foundTrade;
    t1.append(cb1, Object.assign(document.createElement("span"), {textContent:"Обмен найден"}));

    const t2 = document.createElement("label");
    t2.className = "toggle";
    const cb2 = document.createElement("input");
    cb2.type = "checkbox";
    cb2.checked = !!c.received;
    t2.append(cb2, Object.assign(document.createElement("span"), {textContent:"Получено"}));

    cb1.addEventListener("change", async () => {
      applyFoundTrade(c, cb1.checked);
      cb1.checked = c.foundTrade;
      cb2.checked = c.received;
      c.updatedAt = Date.now();
      await db.put("cards", c);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    cb2.addEventListener("change", async () => {
      applyReceived(c, cb2.checked);
      cb1.checked = c.foundTrade;
      cb2.checked = c.received;
      c.updatedAt = Date.now();
      await db.put("cards", c);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    checks.append(t1,t2);

    const noteWrap = document.createElement("div");
    noteWrap.className = "note";
    const ta = document.createElement("textarea");
    ta.placeholder = "Примечание (например, ссылка/ник/детали обмена)…";
    ta.value = c.note || "";
    ta.maxLength = 300;
    let tmr = null;
    ta.addEventListener("input", () => {
      if (tmr) clearTimeout(tmr);
      tmr = setTimeout(async () => {
        c.note = ta.value;
        c.updatedAt = Date.now();
        await db.put("cards", c);
        await touchSeriesUpdated();
      }, 250);
    });
    noteWrap.appendChild(ta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn danger";
    btnDel.type = "button";
    btnDel.textContent = "Удалить";
    btnDel.addEventListener("click", async () => {
      const ok = await confirmDialog("Удалить открытку?", "Это действие нельзя отменить.", "Удалить");
      if (!ok) return;
      await db.delete("cards", c.id);
      state.cards = state.cards.filter(x=>x.id!==c.id);
      syncCardsCacheForSeries(state.activeSeriesId, state.cards);
      if (state.selectedCardId === c.id) state.selectedCardId = null;
      if (state.listHoverCardId === c.id) state.listHoverCardId = null;
      if (state.hoverCardId === c.id) state.hoverCardId = null;
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    actions.append(btnDel);

    meta.append(row1, checks, noteWrap, actions);
    wrap.append(mini, meta);

    wrap.addEventListener("mouseenter", () => {
      state.listHoverCardId = c.id;
      drawAllImageBlocks();
    });
    wrap.addEventListener("mouseleave", () => {
      state.listHoverCardId = null;
      drawAllImageBlocks();
    });

    els.cardsList.appendChild(wrap);
  });
}

async function showCardOnCanvas(card){
  const block = state.imageBlocks.get(card.imageId);
  if (block?.blockEl){
    block.blockEl.scrollIntoView({behavior:"smooth", block:"center"});
  }
  state.selectedCardId = card.id;
  startFocusPulse(card.id);
  drawAllImageBlocks();
}

function startFocusPulse(cardId){
  state.focusCardId = cardId;
  state.focusStart = Date.now();
  state.focusUntil = state.focusStart + 1500;
  if (state.focusAnimationId){
    cancelAnimationFrame(state.focusAnimationId);
  }
  const tick = () => {
    if (!state.focusCardId || Date.now() > state.focusUntil){
      state.focusCardId = null;
      state.focusUntil = 0;
      state.focusAnimationId = null;
      drawAllImageBlocks();
      return;
    }
    drawAllImageBlocks();
    state.focusAnimationId = requestAnimationFrame(tick);
  };
  state.focusAnimationId = requestAnimationFrame(tick);
}

async function touchSeriesUpdated(){
  const s = state.series.find(x=>x.id===state.activeSeriesId);
  if (!s) return;
  s.updatedAt = Date.now();
  await db.put("series", s);
  state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderSeriesList();
  await renderHome();
}

async function touchCollectionUpdated(){
  const collection = state.collections.find(x=>x.id===state.activeCollectionId);
  if (!collection) return;
  collection.updatedAt = Date.now();
  await db.put("collections", collection);
  state.collections.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  await renderCollectionsGrid();
}

function refreshStatsAndRender(){
  renderStats();
  renderCardsList();
  drawAllImageBlocks();
  updateMasterCheckboxes();
}

function applyFoundTrade(card, value){
  card.foundTrade = value;
  if (!value && card.received) card.received = false;
}

function applyReceived(card, value){
  card.received = value;
  if (value) card.foundTrade = true;
}

function highlightCardInList(cardId){
  const cardEl = els.cardsList.querySelector(`[data-card-id="${cardId}"]`);
  if (!cardEl) return;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  cardEl.scrollIntoView({block:"nearest", inline:"nearest"});
  if (window.scrollX !== prevX || window.scrollY !== prevY){
    window.scrollTo(prevX, prevY);
  }
  cardEl.classList.remove("pulse-highlight");
  void cardEl.offsetWidth;
  cardEl.classList.add("pulse-highlight");
  setTimeout(() => cardEl.classList.remove("pulse-highlight"), 1500);
}

async function focusCardInList(card){
  let needsRender = false;
  if (state.statusFilter !== "all"){
    setStatusFilter("all");
    needsRender = true;
  }
  if (needsRender) {}
  await renderCardsList();
  requestAnimationFrame(() => highlightCardInList(card.id));
}

function updateMasterCheckboxes(){
  if (!els.masterTrade || !els.masterReceived) return;
  if (!state.cards.length){
    els.masterTrade.checked = false;
    els.masterTrade.indeterminate = false;
    els.masterTrade.disabled = true;
    els.masterReceived.checked = false;
    els.masterReceived.indeterminate = false;
    els.masterReceived.disabled = true;
    return;
  }
  const tradeCount = state.cards.filter(c=>c.foundTrade).length;
  const receivedCount = state.cards.filter(c=>c.received).length;
  els.masterTrade.disabled = false;
  els.masterReceived.disabled = false;
  els.masterTrade.checked = tradeCount === state.cards.length;
  els.masterTrade.indeterminate = tradeCount > 0 && tradeCount < state.cards.length;
  els.masterReceived.checked = receivedCount === state.cards.length;
  els.masterReceived.indeterminate = receivedCount > 0 && receivedCount < state.cards.length;
}

async function setAllFoundTrade(value){
  if (!state.cards.length) return;
  for (const c of state.cards){
    applyFoundTrade(c, value);
    c.updatedAt = Date.now();
    await db.put("cards", c);
  }
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

async function setAllReceived(value){
  if (!state.cards.length) return;
  for (const c of state.cards){
    applyReceived(c, value);
    c.updatedAt = Date.now();
    await db.put("cards", c);
  }
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

/* ---------- Create / Delete series ---------- */
async function createSeries(nameRaw){
  const name = limitText((nameRaw||"").trim(), 60) || nextAutoCollectionName();
  const s = {
    id: uid("series"),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("series", s);
  state.series.unshift(s);
  renderSeriesList();
  await renderHome();
  await openSeries(s.id);
}

async function deleteActiveSeries(){
  const id = state.activeSeriesId;
  if (!id) return;
  await deleteSeriesById(id);
}

async function deleteSeriesById(id){
  const s = state.series.find(x=>x.id===id);
  if (!s) return;
  const ok = await confirmDialog("Удалить серию?", `Серия “${seriesDisplayName(s.name)}” и все её данные будут удалены.`, "Удалить");
  if (!ok) return;

  const cards = await db.getAllByIndex("cards","seriesId", id);
  for (const c of cards) await db.delete("cards", c.id);
  const images = await db.getAllByIndex("images","seriesId", id);
  for (const img of images) await db.delete("images", img.id);
  await db.delete("series", id);
  clearCoverCache(id);
  removeSeriesCardsFromCache(id);

  state.series = state.series.filter(x=>x.id!==id);
  if (state.activeSeriesId === id){
    state.images = [];
    state.cards = [];
    state.activeSeriesId = null;
    state.activeImageId = null;
    localStorage.removeItem("ct_last_series");
    showHome();
  }

  await renderHome();
  renderSeriesList();
}

async function confirmDialog(title, text, okText="Ок"){
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOk.textContent = okText;
  els.dlgConfirm.showModal();
  return new Promise((resolve) => {
    const handler = () => {
      els.dlgConfirm.removeEventListener("close", handler);
      resolve(els.dlgConfirm.returnValue === "ok");
    };
    els.dlgConfirm.addEventListener("close", handler);
  });
}

/* ---------- Export / Import ---------- */
async function blobToDataURL(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  const [meta, b64] = dataURL.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type:mime});
}

async function exportData(){
  const series = await db.getAll("series");
  const images = await db.getAll("images");
  const cards = await db.getAll("cards");
  const collections = await db.getAll("collections");
  const collectionImages = await db.getAll("collectionImages");
  const collectionItems = await db.getAll("collectionItems");

  const imagesPortable = [];
  for (const image of images){
    const copy = {...image};
    if (copy.imageBlob){
      copy.imageBase64 = await blobToDataURL(copy.imageBlob);
      delete copy.imageBlob;
    }
    imagesPortable.push(copy);
  }

  const collectionImagesPortable = [];
  for (const image of collectionImages){
    const copy = {...image};
    if (copy.imageBlob){
      copy.imageBase64 = await blobToDataURL(copy.imageBlob);
      delete copy.imageBlob;
    }
    collectionImagesPortable.push(copy);
  }

  const payload = {
    version: 6,
    exportedAt: new Date().toISOString(),
    series,
    images: imagesPortable,
    cards,
    collections,
    collectionImages: collectionImagesPortable,
    collectionItems,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `collection-tracker-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

async function importData(file){
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.series) || !Array.isArray(data.cards)){
    alert("Файл не похож на экспорт Collection Tracker.");
    return;
  }
  const ok = await confirmDialog("Импорт данных?", "Импорт заменит текущие данные на этом устройстве.", "Импортировать");
  if (!ok) return;

  await db.clear("cards");
  await db.clear("images");
  await db.clear("series");
  await db.clear("collectionItems");
  await db.clear("collectionImages");
  await db.clear("collections");

  for (const s of data.series){
    const copy = {...s};
    if (copy.coverPartId && !copy.coverImageId){
      copy.coverImageId = copy.coverPartId;
    }
    if (copy.coverPartId !== undefined) delete copy.coverPartId;
    await db.put("series", copy);
  }
  const incomingImages = Array.isArray(data.images) ? data.images : (Array.isArray(data.parts) ? data.parts : []);
  for (const img of incomingImages){
    const copy = {...img};
    if (copy.imageBase64){
      copy.imageBlob = dataURLToBlob(copy.imageBase64);
      delete copy.imageBase64;
    }
    if (copy.id){
      await db.put("images", copy);
    }
  }
  for (const c of data.cards){
    if (c.note === undefined) c.note = "";
    if (c.thumbZoom === undefined) c.thumbZoom = 1;
    if (!c.imageId && c.partId) c.imageId = c.partId;
    if (c.partId !== undefined) delete c.partId;
    await db.put("cards", c);
  }

  const incomingCollections = Array.isArray(data.collections) ? data.collections : [];
  for (const collection of incomingCollections){
    await db.put("collections", collection);
  }
  const incomingCollectionImages = Array.isArray(data.collectionImages) ? data.collectionImages : [];
  for (const img of incomingCollectionImages){
    const copy = {...img};
    if (copy.imageBase64){
      copy.imageBlob = dataURLToBlob(copy.imageBase64);
      delete copy.imageBase64;
    }
    if (copy.id){
      await db.put("collectionImages", copy);
    }
  }
  const incomingCollectionItems = Array.isArray(data.collectionItems) ? data.collectionItems : [];
  for (const item of incomingCollectionItems){
    if (!item.status) item.status = "planned";
    if (item.checked === undefined) item.checked = false;
    await db.put("collectionItems", item);
  }
  await loadAll();
}

/* ---------- Canvas utilities ---------- */
if (!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    this.beginPath();
    this.moveTo(x+rr, y);
    this.arcTo(x+w, y, x+w, y+h, rr);
    this.arcTo(x+w, y+h, x, y+h, rr);
    this.arcTo(x, y+h, x, y, rr);
    this.arcTo(x, y, x+w, y, rr);
    this.closePath();
    return this;
  };
}

function devicePx(n){ return Math.round(n * devicePixelRatio); }

async function undoLastSelection(){
  if (!state.cards.length) return;
  const ordered = state.cards.slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  const last = ordered[ordered.length-1];
  const ok = await confirmDialog("Убрать последнее выделение?", "Удалить последнюю добавленную открытку в коллекции?", "Удалить");
  if (!ok) return;
  await db.delete("cards", last.id);
  state.cards = state.cards.filter(x=>x.id!==last.id);
  syncCardsCacheForSeries(state.activeSeriesId, state.cards);
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

const HOME_SORT_KEYS = new Set(["updated", "created", "completion", "title"]);

function updateHomeSortControls(){
  if (!els.homeSortKey || !els.homeSortDir) return;
  state.homeSortKey = HOME_SORT_KEYS.has(state.homeSortKey) ? state.homeSortKey : "updated";
  els.homeSortKey.value = state.homeSortKey;
  const isDesc = state.homeSortDir === "desc";
  els.homeSortDir.textContent = isDesc ? "↓" : "↑";
  els.homeSortDir.setAttribute("aria-label", isDesc ? "Сортировка по убыванию" : "Сортировка по возрастанию");
}

function applyHomeSortSetting(key, dir){
  state.homeSortKey = HOME_SORT_KEYS.has(key) ? key : "updated";
  state.homeSortDir = dir;
  localStorage.setItem("ct_home_sort_key", state.homeSortKey);
  localStorage.setItem("ct_home_sort_dir", dir);
  updateHomeSortControls();
  renderHome();
}

async function primeCoverPreviews(){
  for (const s of state.series){
    updateCoverCacheFromSeries(s);
  }
  for (const s of state.series){
    if (!s.coverImageId) continue;
    if (s.coverPreviewSmall && s.coverPreviewLarge) continue;
    await ensureCoverPreviews(s.id);
  }
}

async function openThumbEditor(card){
  const pos = card.thumbPos ? {...card.thumbPos} : {x:50, y:50};
  const zoom = clampZoom(card.thumbZoom ?? 1);
  await ensureImageCache();
  const sourceImg = state.imageById.get(card.imageId);
  const img = new Image();
  img.src = sourceImg ? renderCardBasePreviewDataURL(card, sourceImg) : cardPreviewSrc(card);
  await img.decode().catch(()=>{});
  state.thumbEdit = {
    card,
    pos,
    zoom,
    imgW: img.width || 1,
    imgH: img.height || 1,
    sourceImg,
    isDragging: false,
    startX: 0,
    startY: 0,
    drag: null,
  };
  els.thumbImage.src = img.src;
  els.dlgThumbPos.showModal();
  requestAnimationFrame(() => {
    applyCropToImage(state.thumbEdit, els.thumbFrame, els.thumbImage);
    updateZoomUI(state.thumbEdit, els.thumbZoom, els.thumbZoomValue);
  });
}

async function openCoverEditor(seriesId){
  const series = state.series.find(s => s.id === seriesId);
  if (!series) return;
  const { blob, pos, zoom, imageId } = await getSeriesCover(seriesId);
  if (!blob || !imageId) return;
  const thumbEl = document.querySelector(`.home-card[data-id="${seriesId}"] .home-thumb`);
  if (thumbEl){
    const rect = thumbEl.getBoundingClientRect();
    if (rect.width && rect.height){
      els.coverFrame.style.aspectRatio = `${rect.width} / ${rect.height}`;
    }
  } else {
    els.coverFrame.style.aspectRatio = "16 / 9";
  }
  if (state.coverEdit?.imageUrl){
    URL.revokeObjectURL(state.coverEdit.imageUrl);
  }
  const imageUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.src = imageUrl;
  await img.decode().catch(()=>{});
  state.coverEdit = {
    series,
    imageId,
    blob,
    pos: {...pos},
    zoom: clampZoom(zoom ?? 1),
    imgW: img.width || 1,
    imgH: img.height || 1,
    isDragging: false,
    startX: 0,
    startY: 0,
    drag: null,
    imageUrl,
  };
  els.coverImage.src = imageUrl;
  els.dlgCoverPos.showModal();
  requestAnimationFrame(() => {
    applyCropToImage(state.coverEdit, els.coverFrame, els.coverImage);
    updateZoomUI(state.coverEdit, els.coverZoom, els.coverZoomValue);
  });
}

function updateCropPositionFromDrag(editState, imgEl, currentX, currentY){
  if (!editState) return;
  const drag = editState.drag;
  if (!drag) return;
  const deltaX = currentX - drag.startX;
  const deltaY = currentY - drag.startY;
  const nextTx = clamp(drag.startTx + deltaX, drag.minTx, drag.maxTx);
  const nextTy = clamp(drag.startTy + deltaY, drag.minTy, drag.maxTy);
  editState.tx = nextTx;
  editState.ty = nextTy;
  editState.pos.x = drag.overflowX ? (-nextTx / drag.overflowX) * 100 : 50;
  editState.pos.y = drag.overflowY ? (-nextTy / drag.overflowY) * 100 : 50;
  applyCropTransform(imgEl, drag, nextTx, nextTy);
}

function startCropDrag(editState, frameEl, imgEl, startX, startY){
  if (!editState || !frameEl || !imgEl) return;
  const metrics = getCropFrameMetrics(editState, frameEl, imgEl);
  editState.zoom = metrics.zoom;
  editState.pos = clampCropPosition(editState.pos || {x:50, y:50}, metrics.overflowX, metrics.overflowY);
  const offsetX = metrics.overflowX ? (editState.pos.x / 100) * metrics.overflowX : 0;
  const offsetY = metrics.overflowY ? (editState.pos.y / 100) * metrics.overflowY : 0;
  const startTx = -offsetX;
  const startTy = -offsetY;
  editState.tx = startTx;
  editState.ty = startTy;
  editState.drag = {
    startX,
    startY,
    startTx,
    startTy,
    ...metrics,
  };
}

async function refreshSeriesCover(seriesId){
  const series = state.series.find(s => s.id === seriesId);
  if (!series) return;
  const images = (await db.getAllByIndex("images", "seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  if (!images.length) return;
  series.coverImageId = images[0].id;
  series.coverPos = {x:50, y:50};
  series.coverZoom = 1;
  series.updatedAt = Date.now();
  await db.put("series", series);
  clearCoverCache(seriesId);
  await ensureCoverPreviews(seriesId, {
    blob: images[0].imageBlob,
    pos: series.coverPos,
    zoom: series.coverZoom,
    imageId: images[0].id,
  });
  state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderSeriesList();
  await renderHome();
}

/* ---------- Events ---------- */
function initEvents(){
  setupImageViewer();
  els.btnHome.addEventListener("click", showHome);
  els.btnHomeBrand.addEventListener("click", showHome);
  els.btnCollections.addEventListener("click", () => {
    state.activeCollectionId = null;
    showCollections();
    renderCollectionsGrid();
  });

  const openNewSeries = () => {
    els.newSeriesName.value = "";
    els.dlgNewSeries.showModal();
    setTimeout(()=>els.newSeriesName.focus(), 50);
  };
  els.btnNewSeries.addEventListener("click", openNewSeries);
  els.btnNewSeries2.addEventListener("click", openNewSeries);
  els.btnNewSeries3.addEventListener("click", openNewSeries);

  els.dlgNewSeries.addEventListener("close", async () => {
    if (els.dlgNewSeries.returnValue !== "ok") return;
    await createSeries(els.newSeriesName.value);
  });

  const openNewCollection = () => {
    els.newCollectionName.value = "";
    els.dlgNewCollection.showModal();
    setTimeout(()=>els.newCollectionName.focus(), 50);
  };
  els.btnNewCollection.addEventListener("click", openNewCollection);
  els.btnNewCollection2.addEventListener("click", openNewCollection);

  els.dlgNewCollection.addEventListener("close", async () => {
    if (els.dlgNewCollection.returnValue !== "ok") return;
    await createCollection(els.newCollectionName.value);
  });

  els.btnAbout.addEventListener("click", () => els.dlgAbout.showModal());

  els.btnExport.addEventListener("click", exportData);
  els.fileImport.addEventListener("change", async () => {
    const f = els.fileImport.files?.[0];
    if (!f) return;
    await importData(f);
    els.fileImport.value = "";
  });

  els.seriesName.addEventListener("input", async () => {
    const s = state.series.find(x=>x.id===state.activeSeriesId);
    if (!s) return;
    els.seriesName.value = limitText(els.seriesName.value, 60);
    s.name = els.seriesName.value;
    s.updatedAt = Date.now();
    await db.put("series", s);
    renderSeriesList();
    await renderHome();
  });

  els.collectionName.addEventListener("input", async () => {
    const collection = state.collections.find(x=>x.id===state.activeCollectionId);
    if (!collection) return;
    els.collectionName.value = limitText(els.collectionName.value, 60);
    collection.name = els.collectionName.value;
    collection.updatedAt = Date.now();
    await db.put("collections", collection);
    renderCollectionsGrid();
  });

  els.seriesSearch.addEventListener("input", () => {
    state.seriesSearch = els.seriesSearch.value || "";
    renderSeriesList();
  });

  els.homeSortKey.addEventListener("change", () => {
    applyHomeSortSetting(els.homeSortKey.value, state.homeSortDir);
  });
  els.homeSortDir.addEventListener("click", () => {
    const next = state.homeSortDir === "desc" ? "asc" : "desc";
    applyHomeSortSetting(state.homeSortKey, next);
  });

  $$(".chip").forEach(ch => {
    ch.addEventListener("click", async () => {
      setStatusFilter(ch.dataset.filter);
      await renderCardsList();
    });
  });

  els.fileImage.addEventListener("change", async () => {
    if (!els.fileImage.files?.length) return;
    await addImagesFromFiles(els.fileImage.files);
    els.fileImage.value = "";
  });
  els.dropzone.addEventListener("click", () => {
    els.fileImage.click();
  });

  els.btnUndo.addEventListener("click", undoLastSelection);
  els.btnDeleteSeries.addEventListener("click", deleteActiveSeries);
  els.btnDeleteCollection.addEventListener("click", async () => {
    if (!state.activeCollectionId) return;
    await deleteCollectionById(state.activeCollectionId);
  });
  els.btnBackToCollections.addEventListener("click", () => {
    closeCollectionDetail();
    showCollections();
  });

  els.collectionImagesInput.addEventListener("change", async () => {
    if (!els.collectionImagesInput.files?.length) return;
    await addCollectionImagesFromFiles(els.collectionImagesInput.files);
    els.collectionImagesInput.value = "";
  });

  els.btnAddCollectionItem.addEventListener("click", () => {
    addCollectionItem();
  });
  els.collectionItemName.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter"){
      evt.preventDefault();
      addCollectionItem();
    }
  });

  els.masterTrade.addEventListener("change", () => {
    setAllFoundTrade(els.masterTrade.checked);
  });
  els.masterReceived.addEventListener("change", () => {
    setAllReceived(els.masterReceived.checked);
  });

  els.thumbFrame.addEventListener("pointerdown", (evt) => {
    if (!state.thumbEdit) return;
    evt.preventDefault();
    state.thumbEdit.isDragging = true;
    state.thumbEdit.startX = evt.clientX;
    state.thumbEdit.startY = evt.clientY;
    startCropDrag(state.thumbEdit, els.thumbFrame, els.thumbImage, evt.clientX, evt.clientY);
    els.thumbFrame.setPointerCapture(evt.pointerId);
  });
  els.thumbFrame.addEventListener("pointermove", (evt) => {
    if (!state.thumbEdit?.isDragging) return;
    updateCropPositionFromDrag(state.thumbEdit, els.thumbImage, evt.clientX, evt.clientY);
  });
  els.thumbFrame.addEventListener("wheel", (evt) => {
    if (!state.thumbEdit) return;
    evt.preventDefault();
    const delta = evt.deltaY < 0 ? CROP_ZOOM_STEP : -CROP_ZOOM_STEP;
    nudgeCropZoom(state.thumbEdit, els.thumbFrame, els.thumbImage, els.thumbZoom, els.thumbZoomValue, delta);
  }, { passive: false });
  const endThumbDrag = (evt) => {
    if (!state.thumbEdit) return;
    state.thumbEdit.isDragging = false;
    state.thumbEdit.drag = null;
    if (evt?.pointerId) els.thumbFrame.releasePointerCapture(evt.pointerId);
  };
  els.thumbFrame.addEventListener("pointerup", endThumbDrag);
  els.thumbFrame.addEventListener("pointercancel", endThumbDrag);
  els.thumbFrame.addEventListener("pointerleave", endThumbDrag);
  els.thumbReset.addEventListener("click", () => {
    if (!state.thumbEdit) return;
    state.thumbEdit.pos = {x:50, y:50};
    state.thumbEdit.zoom = 1;
    applyCropToImage(state.thumbEdit, els.thumbFrame, els.thumbImage);
    updateZoomUI(state.thumbEdit, els.thumbZoom, els.thumbZoomValue);
  });
  els.thumbZoom.addEventListener("input", () => {
    if (!state.thumbEdit) return;
    setCropZoom(state.thumbEdit, els.thumbFrame, els.thumbImage, els.thumbZoom, els.thumbZoomValue, els.thumbZoom.value);
  });
  els.thumbZoomIn.addEventListener("click", () => {
    nudgeCropZoom(state.thumbEdit, els.thumbFrame, els.thumbImage, els.thumbZoom, els.thumbZoomValue, CROP_ZOOM_STEP);
  });
  els.thumbZoomOut.addEventListener("click", () => {
    nudgeCropZoom(state.thumbEdit, els.thumbFrame, els.thumbImage, els.thumbZoom, els.thumbZoomValue, -CROP_ZOOM_STEP);
  });
  els.dlgThumbPos.addEventListener("close", async () => {
    if (!state.thumbEdit) return;
    if (els.dlgThumbPos.returnValue === "ok"){
      state.thumbEdit.card.thumbPos = {...state.thumbEdit.pos};
      state.thumbEdit.card.thumbZoom = clampZoom(state.thumbEdit.zoom || 1);
      state.thumbEdit.card.updatedAt = Date.now();
      if (state.thumbEdit.sourceImg){
        state.thumbEdit.card.thumbPreview = renderCardPreviewDataURL(state.thumbEdit.card, state.thumbEdit.sourceImg);
      }
      await db.put("cards", state.thumbEdit.card);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    }
    state.thumbEdit = null;
  });

  els.coverFrame.addEventListener("pointerdown", (evt) => {
    if (!state.coverEdit) return;
    evt.preventDefault();
    state.coverEdit.isDragging = true;
    state.coverEdit.startX = evt.clientX;
    state.coverEdit.startY = evt.clientY;
    startCropDrag(state.coverEdit, els.coverFrame, els.coverImage, evt.clientX, evt.clientY);
    els.coverFrame.setPointerCapture(evt.pointerId);
  });
  els.coverFrame.addEventListener("pointermove", (evt) => {
    if (!state.coverEdit?.isDragging) return;
    updateCropPositionFromDrag(state.coverEdit, els.coverImage, evt.clientX, evt.clientY);
  });
  els.coverFrame.addEventListener("wheel", (evt) => {
    if (!state.coverEdit) return;
    evt.preventDefault();
    const delta = evt.deltaY < 0 ? CROP_ZOOM_STEP : -CROP_ZOOM_STEP;
    nudgeCropZoom(state.coverEdit, els.coverFrame, els.coverImage, els.coverZoom, els.coverZoomValue, delta);
  }, { passive: false });
  const endCoverDrag = (evt) => {
    if (!state.coverEdit) return;
    state.coverEdit.isDragging = false;
    state.coverEdit.drag = null;
    if (evt?.pointerId) els.coverFrame.releasePointerCapture(evt.pointerId);
  };
  els.coverFrame.addEventListener("pointerup", endCoverDrag);
  els.coverFrame.addEventListener("pointercancel", endCoverDrag);
  els.coverFrame.addEventListener("pointerleave", endCoverDrag);
  els.coverReset.addEventListener("click", () => {
    if (!state.coverEdit) return;
    state.coverEdit.pos = {x:50, y:50};
    state.coverEdit.zoom = 1;
    applyCropToImage(state.coverEdit, els.coverFrame, els.coverImage);
    updateZoomUI(state.coverEdit, els.coverZoom, els.coverZoomValue);
  });
  els.coverZoom.addEventListener("input", () => {
    if (!state.coverEdit) return;
    setCropZoom(state.coverEdit, els.coverFrame, els.coverImage, els.coverZoom, els.coverZoomValue, els.coverZoom.value);
  });
  els.coverZoomIn.addEventListener("click", () => {
    nudgeCropZoom(state.coverEdit, els.coverFrame, els.coverImage, els.coverZoom, els.coverZoomValue, CROP_ZOOM_STEP);
  });
  els.coverZoomOut.addEventListener("click", () => {
    nudgeCropZoom(state.coverEdit, els.coverFrame, els.coverImage, els.coverZoom, els.coverZoomValue, -CROP_ZOOM_STEP);
  });
  els.dlgCoverPos.addEventListener("close", async () => {
    if (!state.coverEdit) return;
    if (els.dlgCoverPos.returnValue === "ok"){
      state.coverEdit.series.coverPos = {...state.coverEdit.pos};
      state.coverEdit.series.coverZoom = clampZoom(state.coverEdit.zoom || 1);
      state.coverEdit.series.coverImageId = state.coverEdit.imageId;
      state.coverEdit.series.updatedAt = Date.now();
      await db.put("series", state.coverEdit.series);
      await ensureCoverPreviews(state.coverEdit.series.id, {
        blob: state.coverEdit.blob,
        pos: {...state.coverEdit.pos},
        zoom: clampZoom(state.coverEdit.zoom || 1),
        imageId: state.coverEdit.imageId,
      });
      state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      renderSeriesList();
      await renderHome();
    }
    if (state.coverEdit.imageUrl){
      URL.revokeObjectURL(state.coverEdit.imageUrl);
    }
    state.coverEdit = null;
  });

  window.addEventListener("resize", () => {
    resizeAllImageBlocks();
  });

  let dragDepth = 0;
  const handleDragEnter = (evt) => {
    if (!evt.dataTransfer?.types?.includes("Files")) return;
    evt.preventDefault();
    dragDepth += 1;
    els.seriesLeftcol.classList.add("is-dragover");
  };
  const handleDragLeave = (evt) => {
    if (!evt.dataTransfer?.types?.includes("Files")) return;
    evt.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0){
      els.seriesLeftcol.classList.remove("is-dragover");
    }
  };
  const handleDragOver = (evt) => {
    if (!evt.dataTransfer?.types?.includes("Files")) return;
    evt.preventDefault();
  };
  const handleDrop = async (evt) => {
    if (!evt.dataTransfer?.files?.length) return;
    evt.preventDefault();
    dragDepth = 0;
    els.seriesLeftcol.classList.remove("is-dragover");
    await addImagesFromFiles(evt.dataTransfer.files);
  };
  els.seriesView.addEventListener("dragenter", handleDragEnter);
  els.seriesView.addEventListener("dragleave", handleDragLeave);
  els.seriesView.addEventListener("dragover", handleDragOver);
  els.seriesView.addEventListener("drop", handleDrop);
}

/* ---------- Boot ---------- */
async function loadAll(){
  await db.open();
  // NOTE: if you came from v3, we keep compatibility; migration is best-effort.
  try { await migrateIfNeeded(); } catch(e) { /* ignore */ }

  state.homeSortKey = localStorage.getItem("ct_home_sort_key") || state.homeSortKey;
  state.homeSortDir = localStorage.getItem("ct_home_sort_dir") || state.homeSortDir;
  if (!HOME_SORT_KEYS.has(state.homeSortKey)) state.homeSortKey = "updated";
  updateHomeSortControls();

  state.series = (await db.getAll("series")).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  buildCardsCache(await db.getAll("cards"));
  await primeCoverPreviews();
  renderSeriesList();
  await renderHome();

  state.collections = (await db.getAll("collections")).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  buildCollectionItemsCache(await db.getAll("collectionItems"));
  await renderCollectionsGrid();

  const activeSection = localStorage.getItem("ct_active_section") || "home";
  const lastSeries = localStorage.getItem("ct_last_series");
  const lastCollection = localStorage.getItem("ct_last_collection");
  if (activeSection === "series" && lastSeries && state.series.some(s=>s.id===lastSeries)){
    await openSeries(lastSeries);
    return;
  }
  if (activeSection === "collections" && lastCollection && state.collections.some(c=>c.id===lastCollection)){
    await openCollection(lastCollection);
    return;
  }
  if (activeSection === "collections"){
    showCollections();
    await renderCollectionsGrid();
    return;
  }
  showHome();
}

function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

initEvents();
const _vb = document.getElementById("versionBadge"); if (_vb) _vb.textContent = VERSION;
registerSW();
loadAll();
