const VERSION = "v4.1.7";
// Collection Tracker v4
// - Home page with series cards + progress (received/total)
// - Series page: multiple images per series (Часть N)
// - Single shared card list across parts; filter by status and by part
// - Notes per card
// - "Показать" switches to correct part and highlights the rect
// - In-app confirm dialogs, no browser confirm
// - Series name optional -> auto "Коллекция N"
// - Service worker tuned to avoid stale cache

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

        if (!db.objectStoreNames.contains("parts")) {
          const p = db.createObjectStore("parts", { keyPath: "id" });
          p.createIndex("seriesId", "seriesId", { unique:false });
          p.createIndex("seriesId_index", ["seriesId","index"], { unique:false });
          p.createIndex("updatedAt", "updatedAt", { unique:false });
        }

        if (!db.objectStoreNames.contains("cards")) {
          const c = db.createObjectStore("cards", { keyPath: "id" });
          c.createIndex("seriesId", "seriesId", { unique:false });
          c.createIndex("partId", "partId", { unique:false });
          c.createIndex("updatedAt", "updatedAt", { unique:false });
        } else {
          const c = req.transaction.objectStore("cards");
          if (!c.indexNames.contains("seriesId")) c.createIndex("seriesId","seriesId",{unique:false});
          if (!c.indexNames.contains("partId")) c.createIndex("partId","partId",{unique:false});
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

const db = new DB("collection_tracker_v1", 2);

/* ---------- UI refs ---------- */
const els = {
  btnHome: $("#btnHome"),
  btnHomeBrand: $("#btnHomeBrand"),
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

  seriesView: $("#seriesView"),
  seriesName: $("#seriesName"),
  seriesStats: $("#seriesStats"),
  partSelect: $("#partSelect"),
  partFilter: $("#partFilter"),
  masterTrade: $("#masterTrade"),
  masterReceived: $("#masterReceived"),
  fileImage: $("#fileImage"),
  btnUndo: $("#btnUndo"),
  btnDeletePart: $("#btnDeletePart"),
  btnDeleteSeries: $("#btnDeleteSeries"),

  dropzone: $("#dropzone"),
  seriesLeftcol: $("#seriesLeftcol"),

  cardsList: $("#cardsList"),

  dlgNewSeries: $("#dlgNewSeries"),
  newSeriesName: $("#newSeriesName"),

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

  canvas: $("#canvas"),
};

let state = {
  series: [],
  activeSeriesId: null,
  parts: [],
  activePartId: null,
  cards: [],

  statusFilter: "all",
  partFilter: "all",
  seriesSearch: "",
  homeSortKey: "updated",
  homeSortDir: "desc",

  image: null,
  imageURL: null,
  imageScale: 1,
  hoverCardId: null,
  listHoverCardId: null,
  selectedCardId: null,
  imageViewer: null,
  viewerImage: null,
  openImageButton: null,
  focusCardId: null,
  focusUntil: 0,
  focusStart: 0,
  focusAnimationId: null,

  drag: { active:false, startX:0, startY:0, curX:0, curY:0 },
  imageByPart: new Map(),
  coverCache: new Map(),
  thumbEdit: null,
  coverEdit: null,
};

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
function limitText(value, max){
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

const CROP_ZOOM_MIN = 1;
const CROP_ZOOM_MAX = 3;
const CROP_ZOOM_STEP = 0.05;

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

function clampCropPosition(pos, overflowX, overflowY){
  return {
    x: overflowX ? clamp(Number(pos?.x) || 50, 0, 100) : 50,
    y: overflowY ? clamp(Number(pos?.y) || 50, 0, 100) : 50,
  };
}

function applyCropToImage(editState, frameEl, imgEl){
  if (!editState || !frameEl || !imgEl) return;
  const rect = frameEl.getBoundingClientRect();
  const frameW = rect.width || 1;
  const frameH = rect.height || 1;
  const imgW = editState.imgW || imgEl.naturalWidth || imgEl.width || 1;
  const imgH = editState.imgH || imgEl.naturalHeight || imgEl.height || 1;
  editState.zoom = clampZoom(editState.zoom || 1);
  const { scaledW, scaledH, overflowX, overflowY } = getCropMetrics(imgW, imgH, frameW, frameH, editState.zoom);
  editState.pos = clampCropPosition(editState.pos || {x:50, y:50}, overflowX, overflowY);
  const offsetX = overflowX ? (editState.pos.x / 100) * overflowX : 0;
  const offsetY = overflowY ? (editState.pos.y / 100) * overflowY : 0;
  imgEl.style.width = `${scaledW}px`;
  imgEl.style.height = `${scaledH}px`;
  imgEl.style.left = `${-offsetX}px`;
  imgEl.style.top = `${-offsetY}px`;
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
    const { scaledW, scaledH, overflowX, overflowY } = getCropMetrics(imgW, imgH, frameW, frameH, safeZoom);
    const nextPos = clampCropPosition(pos || {x:50, y:50}, overflowX, overflowY);
    const offsetX = overflowX ? (nextPos.x / 100) * overflowX : 0;
    const offsetY = overflowY ? (nextPos.y / 100) * overflowY : 0;
    imgEl.style.width = `${scaledW}px`;
    imgEl.style.height = `${scaledH}px`;
    imgEl.style.left = `${-offsetX}px`;
    imgEl.style.top = `${-offsetY}px`;
  };
  if (imgEl.complete) {
    apply();
  } else {
    imgEl.addEventListener("load", apply, { once: true });
  }
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
function setPartFilter(filter){
  state.partFilter = filter;
  renderPartFilter();
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
  for (const s of allSeries){
    const parts = await db.getAllByIndex("parts","seriesId", s.id);
    const cards = await db.getAllByIndex("cards","seriesId", s.id);

    const hasLegacyImage = !!s.imageBlob;
    const hasParts = parts.length > 0;

    if (!hasParts && hasLegacyImage){
      const partId = uid("part");
      await db.put("parts", {
        id: partId,
        seriesId: s.id,
        index: 1,
        title: "Часть 1",
        imageBlob: s.imageBlob,
        imageW: s.imageW || null,
        imageH: s.imageH || null,
        createdAt: s.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      for (const c of cards){
        c.partId = partId;
        if (c.note === undefined) c.note = "";
        c.updatedAt = Date.now();
        await db.put("cards", c);
      }
      delete s.imageBlob; delete s.imageW; delete s.imageH;
      s.updatedAt = Date.now();
      await db.put("series", s);
    } else {
      const sortedParts = parts.slice().sort((a,b)=>a.index-b.index);
      const fallbackPartId = sortedParts[0]?.id || null;
      for (const c of cards){
        let changed = false;
        if (c.note === undefined){ c.note = ""; changed = true; }
        if (!c.partId && fallbackPartId){ c.partId = fallbackPartId; changed = true; }
        if (changed){ c.updatedAt = Date.now(); await db.put("cards", c); }
      }
    }
  }
}

/* ---------- Views ---------- */
function showHome(){
  els.seriesView.classList.add("hidden");
  els.homeView.classList.remove("hidden");
  state.activeSeriesId = null;
  state.activePartId = null;
  localStorage.removeItem("ct_last_series");
  renderSeriesList();
  renderHome();
}
function showSeries(){
  els.homeView.classList.add("hidden");
  els.seriesView.classList.remove("hidden");
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
    const cachedCover = state.coverCache.get(s.id);
    if (cachedCover?.url){
      const img = new Image();
      img.src = cachedCover.url;
      thumb.appendChild(img);
      applyCropPreview(img, thumb, cachedCover.pos, cachedCover.zoom);
    } else {
      thumb.innerHTML = `<div style="font-weight:900;color:rgba(255,255,255,0.65)">✦</div>`;
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

    // Async: thumbnail
    (async () => {
      const cover = await getSeriesCover(s.id);
      if (!cover.blob) return;
      const cached = state.coverCache.get(s.id);
      const needsUrl = !cached || cached.partId !== cover.partId;
      if (needsUrl){
        setCoverCache(s.id, cover);
      } else if (!cached){
        setCoverCache(s.id, cover);
      } else if (cached.pos.x !== cover.pos.x || cached.pos.y !== cover.pos.y || cached.zoom !== cover.zoom){
        state.coverCache.set(s.id, { ...cached, pos: cover.pos, zoom: cover.zoom, partId: cover.partId });
      }
      const url = state.coverCache.get(s.id)?.url;
      if (!url) return;
      const img = new Image();
      img.src = url;
      thumb.innerHTML = "";
      thumb.appendChild(img);
      applyCropPreview(img, thumb, cover.pos, cover.zoom);
    })();

    // Async: progress text (received/total)
    (async () => {
      const cards = await db.getAllByIndex("cards","seriesId", s.id);
      const total = cards.length;
      const received = cards.reduce((acc,c)=>acc + (c.received ? 1 : 0), 0);
      badge.textContent = `${received}/${total}`;
      badge.classList.toggle("dim", total === 0);
    })();
  }
}

function escapeHtml(str){
  return (str ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function getSeriesCover(seriesId){
  const series = state.series.find(s => s.id === seriesId);
  const parts = (await db.getAllByIndex("parts","seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  if (!parts.length){
    return { blob: null, pos: {x:50, y:50}, zoom: 1, partId: null };
  }
  const coverPartId = series?.coverPartId;
  const part = parts.find(p => p.id === coverPartId) || parts[0];
  const rawPos = series?.coverPos || {x:50, y:50};
  const rawZoom = series?.coverZoom ?? 1;
  const pos = {
    x: clamp(Number(rawPos.x) || 50, 0, 100),
    y: clamp(Number(rawPos.y) || 50, 0, 100),
  };
  const zoom = clampZoom(rawZoom);
  return { blob: part?.imageBlob || null, pos, zoom, partId: part?.id || null };
}

function clearCoverCache(seriesId){
  const cached = state.coverCache.get(seriesId);
  if (cached?.url) URL.revokeObjectURL(cached.url);
  state.coverCache.delete(seriesId);
}

function setCoverCache(seriesId, cover){
  const cached = state.coverCache.get(seriesId);
  if (cached?.url) URL.revokeObjectURL(cached.url);
  if (!cover?.blob) return null;
  const url = URL.createObjectURL(cover.blob);
  state.coverCache.set(seriesId, { url, pos: cover.pos, zoom: cover.zoom, partId: cover.partId });
  return url;
}

/* ---------- Home ---------- */
async function renderHome(){
  els.homeGrid.innerHTML = "";
  if (!state.series.length){
    els.homeEmpty.classList.remove("hidden");
    return;
  }
  els.homeEmpty.classList.add("hidden");

  const seriesStats = await Promise.all(state.series.map(async (s) => {
    const cards = await db.getAllByIndex("cards","seriesId", s.id);
    const progress = computeProgress(cards);
    return {
      series: s,
      cards,
      progress,
      total: cards.length,
      completion: progress.pct,
      title: seriesDisplayName(s.name).toLowerCase(),
    };
  }));

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
    btnRefresh.setAttribute("aria-label", "Обновить обложку");
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

    const cachedCover = state.coverCache.get(s.id);
    if (cachedCover?.url){
      const img = new Image();
      img.src = cachedCover.url;
      thumb.classList.add("has-cover");
      thumb.innerHTML = "";
      thumb.appendChild(img);
      thumb.appendChild(actions);
      applyCropPreview(img, thumb, cachedCover.pos, cachedCover.zoom);
    }

    (async () => {
      const cover = await getSeriesCover(s.id);
      if (!cover.blob) return;
      const cached = state.coverCache.get(s.id);
      const needsUrl = !cached || cached.partId !== cover.partId;
      if (needsUrl){
        setCoverCache(s.id, cover);
      } else if (!cached){
        setCoverCache(s.id, cover);
      } else if (cached.pos.x !== cover.pos.x || cached.pos.y !== cover.pos.y || cached.zoom !== cover.zoom){
        state.coverCache.set(s.id, { ...cached, pos: cover.pos, zoom: cover.zoom, partId: cover.partId });
      }
      const url = state.coverCache.get(s.id)?.url;
      if (!url) return;
      const img = new Image();
      img.src = url;
      thumb.classList.add("has-cover");
      thumb.innerHTML = "";
      thumb.appendChild(img);
      thumb.appendChild(actions);
      applyCropPreview(img, thumb, cover.pos, cover.zoom);
    })();

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

/* ---------- Open series ---------- */
async function openSeries(seriesId){
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;

  state.activeSeriesId = seriesId;
  localStorage.setItem("ct_last_series", seriesId);
  showSeries();
  renderSeriesList();

  state.parts = (await db.getAllByIndex("parts","seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  state.cards = (await db.getAllByIndex("cards","seriesId", seriesId)).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));

  setStatusFilter("all");
  setPartFilter("all");
  state.selectedCardId = null;
  state.hoverCardId = null;
  state.listHoverCardId = null;

  els.seriesName.value = s.name || "";

  if (!state.parts.length){
    state.activePartId = null;
  } else {
    const last = localStorage.getItem("ct_last_part_"+seriesId);
    state.activePartId = (last && state.parts.some(p=>p.id===last)) ? last : state.parts[0].id;
    localStorage.setItem("ct_last_part_"+seriesId, state.activePartId);
  }

  updatePartsUIVisibility();
  updateDropzoneVisibility();
  renderPartSelect();
  renderPartFilter();
  await loadActivePartImage();
  refreshStatsAndRender();
  resizeCanvasAndRedraw();
  window.scrollTo({top:0, behavior:"smooth"});
}

/* ---------- Parts controls ---------- */
function renderPartSelect(){
  els.partSelect.innerHTML = "";
  if (!state.parts.length){
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "—";
    els.partSelect.appendChild(o);
    els.partSelect.disabled = true;
    return;
  }
  els.partSelect.disabled = false;
  for (const p of state.parts){
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `Часть ${p.index}`;
    els.partSelect.appendChild(o);
  }
  els.partSelect.value = state.activePartId || state.parts[0].id;
}
function renderPartFilter(){
  els.partFilter.innerHTML = "";
  if (!state.parts.length){
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "—";
    els.partFilter.appendChild(o);
    els.partFilter.disabled = true;
    return;
  }
  els.partFilter.disabled = false;
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "Все";
  els.partFilter.appendChild(all);
  for (const p of state.parts){
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `Часть ${p.index}`;
    els.partFilter.appendChild(o);
  }
  if (state.partFilter !== "all" && !state.parts.some(p=>p.id===state.partFilter)){
    state.partFilter = "all";
  }
  els.partFilter.value = state.partFilter;
}

function updatePartsUIVisibility(){
  const hide = state.parts.length <= 1;
  els.seriesView.classList.toggle("parts-hidden", hide);
  els.btnDeletePart.disabled = state.parts.length === 0;
  els.btnDeletePart.classList.toggle("hidden", state.parts.length === 0);
}

function updateDropzoneVisibility(){
  const empty = state.parts.length === 0;
  els.seriesLeftcol.classList.toggle("leftcol--empty", empty);
  updateOpenImageButtonState();
}

function updateOpenImageButtonState(){
  if (!state.openImageButton) return;
  const canOpen = !!state.image && !!state.imageURL;
  state.openImageButton.disabled = !canOpen;
  state.openImageButton.classList.toggle("hidden", !canOpen);
}

function setupImageViewer(){
  if (state.imageViewer) return;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog image-viewer";
  dialog.innerHTML = `
    <div class="dialog-card dialog-image">
      <button type="button" class="image-close" aria-label="Закрыть">×</button>
      <img class="viewer-image" alt="Изображение серии" />
    </div>
  `;
  dialog.addEventListener("click", (evt) => {
    if (evt.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);
  const closeBtn = dialog.querySelector(".image-close");
  closeBtn.addEventListener("click", () => dialog.close());
  state.imageViewer = dialog;
  state.viewerImage = dialog.querySelector(".viewer-image");

  const canvasWrap = document.querySelector(".canvas-wrap");
  if (canvasWrap){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "open-image-btn";
    btn.title = "Открыть изображение";
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none">
      <path d="M4 5h16v14H4z" stroke="currentColor" stroke-width="1.6" />
      <path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    btn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (!state.imageViewer || !state.viewerImage || !state.imageURL) return;
      state.viewerImage.src = state.imageURL;
      state.imageViewer.showModal();
    });
    canvasWrap.appendChild(btn);
    state.openImageButton = btn;
    updateOpenImageButtonState();
  }
}

async function loadActivePartImage(){
  if (state.imageURL){
    URL.revokeObjectURL(state.imageURL);
    state.imageURL = null;
  }
  state.image = null;
  updateOpenImageButtonState();
  if (!state.activePartId) return;

  const p = state.parts.find(x=>x.id===state.activePartId);
  if (!p || !p.imageBlob) return;
  const { img, url } = await loadImageFromBlob(p.imageBlob);
  state.imageURL = url;
  state.image = img;
  updateOpenImageButtonState();
}

async function addPartFromFile(file){
  if (!file || !state.activeSeriesId) return;
  const nextIdx = state.parts.length ? Math.max(...state.parts.map(p=>p.index)) + 1 : 1;

  const { img, url } = await loadImageFromBlob(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  URL.revokeObjectURL(url);

  const part = {
    id: uid("part"),
    seriesId: state.activeSeriesId,
    index: nextIdx,
    title: `Часть ${nextIdx}`,
    imageBlob: file,
    imageW: w,
    imageH: h,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("parts", part);

  state.parts.push(part);
  state.parts.sort((a,b)=>a.index-b.index);

  state.activePartId = part.id;
  localStorage.setItem("ct_last_part_"+state.activeSeriesId, state.activePartId);

  updatePartsUIVisibility();
  updateDropzoneVisibility();

  const series = state.series.find(s => s.id === state.activeSeriesId);
  if (series && !series.coverPartId){
    series.coverPartId = part.id;
    series.coverPos = {x:50, y:50};
    series.coverZoom = 1;
    series.updatedAt = Date.now();
    await db.put("series", series);
  }

  await touchSeriesUpdated();
  renderPartSelect();
  renderPartFilter();
  await loadActivePartImage();
  resizeCanvasAndRedraw();
  draw();
}

async function addPartsFromFiles(files){
  const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  if (!list.length) return;
  for (const file of list){
    await addPartFromFile(file);
  }
  updatePartsUIVisibility();
  updateDropzoneVisibility();
}

async function deletePart(partId){
  if (!partId) return;
  const part = state.parts.find(p=>p.id===partId);
  if (!part) return;
  const ok = await confirmDialog(
    "Удалить часть?",
    `Часть ${part.index} и все её открытки будут удалены.`,
    "Удалить"
  );
  if (!ok) return;

  const cardsToDelete = state.cards.filter(c=>c.partId===partId);
  for (const c of cardsToDelete) await db.delete("cards", c.id);
  await db.delete("parts", partId);

  state.cards = state.cards.filter(c=>c.partId!==partId);
  const removedIndex = state.parts.findIndex(p=>p.id===partId);
  state.parts = state.parts.filter(p=>p.id!==partId);
  state.parts.sort((a,b)=>a.index-b.index);

  for (let i=0; i<state.parts.length; i++){
    const p = state.parts[i];
    const nextIndex = i + 1;
    if (p.index !== nextIndex || p.title !== `Часть ${nextIndex}`){
      p.index = nextIndex;
      p.title = `Часть ${nextIndex}`;
      p.updatedAt = Date.now();
      await db.put("parts", p);
    }
  }

  const series = state.series.find(s => s.id === state.activeSeriesId);
  if (series && series.coverPartId === partId){
    series.coverPartId = state.parts[0]?.id || null;
    series.coverPos = {x:50, y:50};
    series.coverZoom = 1;
    series.updatedAt = Date.now();
    await db.put("series", series);
    clearCoverCache(series.id);
  }

  if (state.activePartId === partId){
    if (state.parts.length){
      const next = state.parts[Math.min(removedIndex, state.parts.length-1)];
      state.activePartId = next?.id || null;
    } else {
      state.activePartId = null;
    }
    if (state.activeSeriesId){
      if (state.activePartId){
        localStorage.setItem("ct_last_part_"+state.activeSeriesId, state.activePartId);
      } else {
        localStorage.removeItem("ct_last_part_"+state.activeSeriesId);
      }
    }
  }

  updatePartsUIVisibility();
  updateDropzoneVisibility();
  await touchSeriesUpdated();
  renderPartSelect();
  renderPartFilter();
  await loadActivePartImage();
  refreshStatsAndRender();
  resizeCanvasAndRedraw();
}

/* ---------- Stats + list ---------- */
function renderStats(){
  const { total, trade, received, pending } = humanStats(state.cards);
  els.seriesStats.textContent = total ? `Всего: ${total} • Обмен найден: ${trade} • Получено: ${received} • Жду: ${pending}` : `Пока нет выделенных открыток`;
}

function filterCards(cards){
  let out = cards;
  if (state.partFilter !== "all") out = out.filter(c=>c.partId===state.partFilter);
  if (state.statusFilter === "trade") out = out.filter(c=>c.foundTrade);
  else if (state.statusFilter === "received") out = out.filter(c=>c.received);
  else if (state.statusFilter === "pending") out = out.filter(c=>c.foundTrade && !c.received);
  else if (state.statusFilter === "notfound") out = out.filter(c=>!c.foundTrade && !c.received);
  return out;
}

function cardLabel(idx){ return `Открытка ${String(idx+1).padStart(2,"0")}`; }

async function ensurePartImagesCache(){
  state.imageByPart = new Map();
  for (const p of state.parts){
    if (!p.imageBlob) continue;
    const url = URL.createObjectURL(p.imageBlob);
    const img = new Image();
    img.src = url;
    await img.decode().catch(()=>{});
    URL.revokeObjectURL(url);
    state.imageByPart.set(p.id, img);
  }
}

function miniPreviewDataURL(card){
  const img = state.imageByPart.get(card.partId);
  if (!img) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100">
      <rect width="140" height="100" rx="14" fill="rgba(255,255,255,0.06)"/>
      <text x="70" y="58" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.8)">✦</text>
    </svg>`);
  }
  const oc = document.createElement("canvas");
  // Keep aspect ratio to avoid squished previews
  const maxW = 320, maxH = 240;
  const ratio = Math.max(1, card.w) / Math.max(1, card.h);
  let ow = maxW;
  let oh = Math.round(ow / ratio);
  if (oh > maxH){
    oh = maxH;
    ow = Math.round(oh * ratio);
  }
  oc.width = ow;
  oc.height = oh;
  const cctx = oc.getContext("2d");
  cctx.imageSmoothingEnabled = true;
  cctx.clearRect(0,0,ow,oh);
  cctx.drawImage(img, Math.max(0,card.x), Math.max(0,card.y), Math.max(1,card.w), Math.max(1,card.h), 0,0,ow,oh);
  return oc.toDataURL("image/jpeg", 0.78);
}

async function renderCardsList(){
  await ensurePartImagesCache();
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
    img.src = miniPreviewDataURL(c);
    const pos = c.thumbPos || {x:50, y:50};
    const zoom = clampZoom(c.thumbZoom ?? 1);
    applyCropPreview(img, mini, pos, zoom);
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
    const parttag = document.createElement("div");
    parttag.className = "parttag";
    const part = state.parts.find(p=>p.id===c.partId);
    parttag.textContent = part ? `Часть ${part.index}` : "Часть —";
    row1.append(label, parttag);

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
      if (state.selectedCardId === c.id) state.selectedCardId = null;
      if (state.listHoverCardId === c.id) state.listHoverCardId = null;
      if (state.hoverCardId === c.id) state.hoverCardId = null;
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    actions.append(btnDel);

    meta.append(row1, checks, noteWrap, actions);
    wrap.append(mini, meta);

    wrap.addEventListener("mouseenter", () => { state.listHoverCardId = c.id; draw(); });
    wrap.addEventListener("mouseleave", () => { state.listHoverCardId = null; draw(); });

    els.cardsList.appendChild(wrap);
  });
}

async function showCardOnCanvas(card){
  await setActivePart(card.partId);
  els.canvas.scrollIntoView({behavior:"smooth", block:"center"});
  startFocusPulse(card.id);
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
      draw();
      return;
    }
    draw();
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

function refreshStatsAndRender(){
  renderStats();
  renderPartFilter();
  renderCardsList();
  draw();
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

async function setActivePart(partId){
  if (!partId || partId === state.activePartId) return;
  state.activePartId = partId;
  state.selectedCardId = null;
  state.hoverCardId = null;
  state.listHoverCardId = null;
  localStorage.setItem("ct_last_part_"+state.activeSeriesId, partId);
  renderPartSelect();
  await loadActivePartImage();
  resizeCanvasAndRedraw();
  draw();
  updateMasterCheckboxes();
}

function highlightCardInList(cardId){
  const cardEl = els.cardsList.querySelector(`[data-card-id="${cardId}"]`);
  if (!cardEl) return;
  cardEl.classList.remove("pulse-highlight");
  void cardEl.offsetWidth;
  cardEl.classList.add("pulse-highlight");
  cardEl.scrollIntoView({behavior:"smooth", block:"center"});
  setTimeout(() => cardEl.classList.remove("pulse-highlight"), 1500);
}

async function focusCardInList(card){
  let needsRender = false;
  if (state.statusFilter !== "all"){
    setStatusFilter("all");
    needsRender = true;
  }
  if (state.partFilter !== "all"){
    state.partFilter = "all";
    needsRender = true;
  }
  if (needsRender){
    renderPartFilter();
  }
  await renderCardsList();
  requestAnimationFrame(() => highlightCardInList(card.id));
}

function updateMasterCheckboxes(){
  const partCards = state.activePartId ? state.cards.filter(c=>c.partId===state.activePartId) : [];
  if (!els.masterTrade || !els.masterReceived) return;
  if (!partCards.length){
    els.masterTrade.checked = false;
    els.masterTrade.indeterminate = false;
    els.masterTrade.disabled = true;
    els.masterReceived.checked = false;
    els.masterReceived.indeterminate = false;
    els.masterReceived.disabled = true;
    return;
  }
  const tradeCount = partCards.filter(c=>c.foundTrade).length;
  const receivedCount = partCards.filter(c=>c.received).length;
  els.masterTrade.disabled = false;
  els.masterReceived.disabled = false;
  els.masterTrade.checked = tradeCount === partCards.length;
  els.masterTrade.indeterminate = tradeCount > 0 && tradeCount < partCards.length;
  els.masterReceived.checked = receivedCount === partCards.length;
  els.masterReceived.indeterminate = receivedCount > 0 && receivedCount < partCards.length;
}

async function setAllFoundTrade(value){
  if (!state.activePartId) return;
  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  if (!partCards.length) return;
  for (const c of partCards){
    applyFoundTrade(c, value);
    c.updatedAt = Date.now();
    await db.put("cards", c);
  }
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

async function setAllReceived(value){
  if (!state.activePartId) return;
  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  if (!partCards.length) return;
  for (const c of partCards){
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
  const parts = await db.getAllByIndex("parts","seriesId", id);
  for (const p of parts) await db.delete("parts", p.id);
  await db.delete("series", id);
  clearCoverCache(id);

  state.series = state.series.filter(x=>x.id!==id);
  if (state.activeSeriesId === id){
    state.parts = [];
    state.cards = [];
    state.activeSeriesId = null;
    state.activePartId = null;
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
  const parts = await db.getAll("parts");
  const cards = await db.getAll("cards");

  const partsPortable = [];
  for (const p of parts){
    const copy = {...p};
    if (copy.imageBlob){
      copy.imageBase64 = await blobToDataURL(copy.imageBlob);
      delete copy.imageBlob;
    }
    partsPortable.push(copy);
  }
  const payload = { version: 4, exportedAt: new Date().toISOString(), series, parts: partsPortable, cards };
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
  if (!data || !Array.isArray(data.series) || !Array.isArray(data.parts) || !Array.isArray(data.cards)){
    alert("Файл не похож на экспорт Collection Tracker.");
    return;
  }
  const ok = await confirmDialog("Импорт данных?", "Импорт заменит текущие данные на этом устройстве.", "Импортировать");
  if (!ok) return;

  await db.clear("cards");
  await db.clear("parts");
  await db.clear("series");

  for (const s of data.series) await db.put("series", s);
  for (const p of data.parts){
    const copy = {...p};
    if (copy.imageBase64){
      copy.imageBlob = dataURLToBlob(copy.imageBase64);
      delete copy.imageBase64;
    }
    await db.put("parts", copy);
  }
  for (const c of data.cards){
    if (c.note === undefined) c.note = "";
    if (c.thumbZoom === undefined) c.thumbZoom = 1;
    await db.put("cards", c);
  }
  await loadAll();
}

/* ---------- Canvas ---------- */
const canvas = els.canvas;
const ctx = canvas.getContext("2d");

if (!ctx.roundRect){
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

function computeImageScale(){
  if (!state.image){ state.imageScale = 1; return; }
  const sx = canvas.width / state.image.width;
  const sy = canvas.height / state.image.height;
  state.imageScale = Math.min(sx, sy);
}
function imageDrawRect(){
  if (!state.image) return {dx:0, dy:0, dw: canvas.width, dh: canvas.height};
  const dw = Math.floor(state.image.width * state.imageScale);
  const dh = Math.floor(state.image.height * state.imageScale);
  const dx = Math.floor((canvas.width - dw) / 2);
  const dy = Math.floor((canvas.height - dh) / 2);
  return {dx, dy, dw, dh};
}
function isPointInsideImage(cx, cy){
  if (!state.image) return false;
  const {dx,dy,dw,dh} = imageDrawRect();
  return cx>=dx && cx<=dx+dw && cy>=dy && cy<=dy+dh;
}
function pointerPos(evt){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * devicePixelRatio,
    y: (evt.clientY - rect.top) * devicePixelRatio
  };
}
function canvasToImageCoords(cx, cy){
  const {dx,dy} = imageDrawRect();
  const x = (cx - dx) / state.imageScale;
  const y = (cy - dy) / state.imageScale;
  return { x: clamp(x,0,state.image.width), y: clamp(y,0,state.image.height) };
}
function imageToCanvasCoords(ix, iy){
  const {dx,dy} = imageDrawRect();
  return { cx: dx + ix*state.imageScale, cy: dy + iy*state.imageScale };
}

function findCardAtPoint(ix, iy){
  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  let best = null;
  let bestArea = Infinity;
  for (const c of partCards){
    if (ix < c.x || ix > c.x + c.w || iy < c.y || iy > c.y + c.h) continue;
    const area = Math.max(1, c.w) * Math.max(1, c.h);
    if (area < bestArea){
      bestArea = area;
      best = c;
    }
  }
  return best;
}

function resizeCanvasAndRedraw(){
  const parent = canvas.parentElement;
  if (!parent) return;
  const cssW = parent.clientWidth;
  const cssH = Math.min(Math.max(420, window.innerHeight - 260), 700);

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = devicePx(cssW);
  canvas.height = devicePx(cssH);

  computeImageScale();
  draw();
}

function draw(){
  ctx.clearRect(0,0,canvas.width, canvas.height);

  if (!state.image){
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `${Math.floor(16*devicePixelRatio)}px system-ui`;
    const msg = state.parts.length ? "Выбери часть и загрузи изображение, чтобы выделять открытки." : "Нажми “＋ Добавить изображение”, чтобы начать (Часть 1).";
    ctx.fillText(msg, devicePx(18), devicePx(28));
    ctx.restore();
    return;
  }

  const r = imageDrawRect();
  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.drawImage(state.image, r.dx, r.dy, r.dw, r.dh);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0,0,canvas.width, r.dy);
  ctx.fillRect(0, r.dy+r.dh, canvas.width, canvas.height-(r.dy+r.dh));
  ctx.fillRect(0, r.dy, r.dx, r.dh);
  ctx.fillRect(r.dx+r.dw, r.dy, canvas.width-(r.dx+r.dw), r.dh);
  ctx.restore();

  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  const focusActive = state.focusCardId && state.focusUntil && (Date.now() < state.focusUntil);
  const visibleIds = new Set();
  if (state.hoverCardId) visibleIds.add(state.hoverCardId);
  if (state.listHoverCardId) visibleIds.add(state.listHoverCardId);
  if (state.selectedCardId) visibleIds.add(state.selectedCardId);
  if (focusActive && state.focusCardId) visibleIds.add(state.focusCardId);

  for (const c of partCards){
    if (!visibleIds.has(c.id)) continue;
    const {cx:x1, cy:y1} = imageToCanvasCoords(c.x, c.y);
    const {cx:x2, cy:y2} = imageToCanvasCoords(c.x+c.w, c.y+c.h);
    const rr = rectNormalize(x1,y1,x2,y2);

    const isFocus = focusActive && c.id === state.focusCardId;
    const isHi = isFocus || state.hoverCardId===c.id || state.listHoverCardId===c.id || state.selectedCardId===c.id;
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

  if (state.drag.active){
    const rr = rectNormalize(state.drag.startX, state.drag.startY, state.drag.curX, state.drag.curY);
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

async function onPointerDown(evt){
  if (!state.image || !state.activePartId) return;
  canvas.setPointerCapture(evt.pointerId);
  const {x,y} = pointerPos(evt);
  if (!isPointInsideImage(x,y)) return;
  state.drag.active = true;
  state.hoverCardId = null;
  state.drag.startX = x; state.drag.startY = y;
  state.drag.curX = x; state.drag.curY = y;
  draw();
}
function onPointerMove(evt){
  const {x,y} = pointerPos(evt);
  if (state.drag.active){
    state.drag.curX = x; state.drag.curY = y;
    draw();
    return;
  }
  if (!state.image) return;
  if (!isPointInsideImage(x,y)){
    if (state.hoverCardId){
      state.hoverCardId = null;
      draw();
    }
    return;
  }
  const {x:ix, y:iy} = canvasToImageCoords(x, y);
  const hit = findCardAtPoint(ix, iy);
  const nextId = hit ? hit.id : null;
  if (nextId !== state.hoverCardId){
    state.hoverCardId = nextId;
    draw();
  }
}
async function onPointerUp(evt){
  if (!state.drag.active) return;
  state.drag.active = false;

  const rr = rectNormalize(state.drag.startX, state.drag.startY, state.drag.curX, state.drag.curY);
  if (!rectValid(rr)){
    if (evt){
      const {x, y} = canvasToImageCoords(state.drag.curX, state.drag.curY);
      const hit = findCardAtPoint(x, y);
      if (hit){
        await setActivePart(hit.partId);
        await focusCardInList(hit);
        state.selectedCardId = hit.id;
        draw();
        return;
      }
    }
    state.selectedCardId = null;
    draw();
    return;
  }

  const p1 = canvasToImageCoords(rr.x, rr.y);
  const p2 = canvasToImageCoords(rr.x+rr.w, rr.y+rr.h);
  const ir = rectNormalize(p1.x, p1.y, p2.x, p2.y);

  const existing = state.cards.filter(c=>c.partId===state.activePartId);
  if (bestOverlap(ir, existing) > 0.82){ draw(); return; }

  const card = {
    id: uid("card"),
    seriesId: state.activeSeriesId,
    partId: state.activePartId,
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

  await db.put("cards", card);
  state.cards.push(card);
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

async function undoLastInActivePart(){
  if (!state.activePartId) return;
  const partCards = state.cards.filter(c=>c.partId===state.activePartId).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if (!partCards.length) return;
  const last = partCards[partCards.length-1];
  const ok = await confirmDialog("Убрать последнее выделение?", "Удалить последнюю добавленную открытку в текущей части?", "Удалить");
  if (!ok) return;
  await db.delete("cards", last.id);
  state.cards = state.cards.filter(x=>x.id!==last.id);
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

async function openThumbEditor(card){
  const pos = card.thumbPos ? {...card.thumbPos} : {x:50, y:50};
  const zoom = clampZoom(card.thumbZoom ?? 1);
  const img = new Image();
  img.src = miniPreviewDataURL(card);
  await img.decode().catch(()=>{});
  state.thumbEdit = {
    card,
    pos,
    zoom,
    imgW: img.width || 1,
    imgH: img.height || 1,
    isDragging: false,
    startX: 0,
    startY: 0,
    startPos: {...pos},
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
  const { blob, pos, zoom, partId } = await getSeriesCover(seriesId);
  if (!blob || !partId) return;
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
    partId,
    pos: {...pos},
    zoom: clampZoom(zoom ?? 1),
    imgW: img.width || 1,
    imgH: img.height || 1,
    isDragging: false,
    startX: 0,
    startY: 0,
    startPos: {...pos},
    imageUrl,
  };
  els.coverImage.src = imageUrl;
  els.dlgCoverPos.showModal();
  requestAnimationFrame(() => {
    applyCropToImage(state.coverEdit, els.coverFrame, els.coverImage);
    updateZoomUI(state.coverEdit, els.coverZoom, els.coverZoomValue);
  });
}

function updateCropPositionFromDrag(editState, frameEl, imgEl, deltaX, deltaY){
  if (!editState) return;
  const frameRect = frameEl.getBoundingClientRect();
  const frameW = frameRect.width || 1;
  const frameH = frameRect.height || 1;
  const { imgW, imgH } = editState;
  const zoom = clampZoom(editState.zoom || 1);
  const { overflowX, overflowY } = getCropMetrics(imgW, imgH, frameW, frameH, zoom);
  const startPos = editState.startPos || {x:50, y:50};
  const startOffsetX = overflowX ? (startPos.x / 100) * overflowX : 0;
  const startOffsetY = overflowY ? (startPos.y / 100) * overflowY : 0;
  const nextOffsetX = clamp(startOffsetX - deltaX, 0, overflowX);
  const nextOffsetY = clamp(startOffsetY - deltaY, 0, overflowY);
  editState.pos.x = overflowX ? (nextOffsetX / overflowX) * 100 : 50;
  editState.pos.y = overflowY ? (nextOffsetY / overflowY) * 100 : 50;
  applyCropToImage(editState, frameEl, imgEl);
}

async function refreshSeriesCover(seriesId){
  const series = state.series.find(s => s.id === seriesId);
  if (!series) return;
  const parts = (await db.getAllByIndex("parts", "seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  if (!parts.length) return;
  series.coverPartId = parts[0].id;
  series.coverPos = {x:50, y:50};
  series.coverZoom = 1;
  series.updatedAt = Date.now();
  await db.put("series", series);
  clearCoverCache(seriesId);
  state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderSeriesList();
  await renderHome();
}

/* ---------- Events ---------- */
function initEvents(){
  setupImageViewer();
  els.btnHome.addEventListener("click", showHome);
  els.btnHomeBrand.addEventListener("click", showHome);

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

  els.partSelect.addEventListener("change", async () => {
    const id = els.partSelect.value;
    if (!id || id === state.activePartId) return;
    await setActivePart(id);
  });

  els.partFilter.addEventListener("change", async () => {
    const id = els.partFilter.value;
    if (!id || id === state.partFilter) return;
    state.partFilter = id;
    await renderCardsList();
  });

  $$(".chip").forEach(ch => {
    ch.addEventListener("click", async () => {
      setStatusFilter(ch.dataset.filter);
      await renderCardsList();
    });
  });

  els.fileImage.addEventListener("change", async () => {
    if (!els.fileImage.files?.length) return;
    await addPartsFromFiles(els.fileImage.files);
    els.fileImage.value = "";
  });
  els.dropzone.addEventListener("click", () => {
    if (state.parts.length !== 0) return;
    els.fileImage.click();
  });

  els.btnUndo.addEventListener("click", undoLastInActivePart);
  els.btnDeletePart.addEventListener("click", async () => {
    if (!state.activePartId) return;
    await deletePart(state.activePartId);
  });
  els.btnDeleteSeries.addEventListener("click", deleteActiveSeries);

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
    state.thumbEdit.startPos = {...state.thumbEdit.pos};
    els.thumbFrame.setPointerCapture(evt.pointerId);
  });
  els.thumbFrame.addEventListener("pointermove", (evt) => {
    if (!state.thumbEdit?.isDragging) return;
    updateCropPositionFromDrag(state.thumbEdit, els.thumbFrame, els.thumbImage, evt.clientX - state.thumbEdit.startX, evt.clientY - state.thumbEdit.startY);
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
    if (evt?.pointerId) els.thumbFrame.releasePointerCapture(evt.pointerId);
  };
  els.thumbFrame.addEventListener("pointerup", endThumbDrag);
  els.thumbFrame.addEventListener("pointercancel", endThumbDrag);
  els.thumbFrame.addEventListener("pointerleave", endThumbDrag);
  els.thumbReset.addEventListener("click", () => {
    if (!state.thumbEdit) return;
    state.thumbEdit.pos = {x:50, y:50};
    state.thumbEdit.startPos = {x:50, y:50};
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
    state.coverEdit.startPos = {...state.coverEdit.pos};
    els.coverFrame.setPointerCapture(evt.pointerId);
  });
  els.coverFrame.addEventListener("pointermove", (evt) => {
    if (!state.coverEdit?.isDragging) return;
    updateCropPositionFromDrag(state.coverEdit, els.coverFrame, els.coverImage, evt.clientX - state.coverEdit.startX, evt.clientY - state.coverEdit.startY);
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
    if (evt?.pointerId) els.coverFrame.releasePointerCapture(evt.pointerId);
  };
  els.coverFrame.addEventListener("pointerup", endCoverDrag);
  els.coverFrame.addEventListener("pointercancel", endCoverDrag);
  els.coverFrame.addEventListener("pointerleave", endCoverDrag);
  els.coverReset.addEventListener("click", () => {
    if (!state.coverEdit) return;
    state.coverEdit.pos = {x:50, y:50};
    state.coverEdit.startPos = {x:50, y:50};
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
      state.coverEdit.series.coverPartId = state.coverEdit.partId;
      state.coverEdit.series.updatedAt = Date.now();
      await db.put("series", state.coverEdit.series);
      const cached = state.coverCache.get(state.coverEdit.series.id);
      if (cached){
        state.coverCache.set(state.coverEdit.series.id, {
          ...cached,
          pos: {...state.coverEdit.pos},
          zoom: clampZoom(state.coverEdit.zoom || 1),
          partId: state.coverEdit.partId,
        });
      }
      state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      renderSeriesList();
      await renderHome();
    }
    if (state.coverEdit.imageUrl){
      URL.revokeObjectURL(state.coverEdit.imageUrl);
    }
    state.coverEdit = null;
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    if (state.hoverCardId){
      state.hoverCardId = null;
      draw();
    }
  });

  window.addEventListener("resize", () => resizeCanvasAndRedraw());

  let dragDepth = 0;
  const handleDragEnter = (evt) => {
    if (!evt.dataTransfer?.types?.includes("Files")) return;
    evt.preventDefault();
    dragDepth += 1;
    if (state.parts.length === 0){
      els.seriesLeftcol.classList.add("is-dragover");
    }
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
    await addPartsFromFiles(evt.dataTransfer.files);
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
  renderSeriesList();
  await renderHome();

  const last = localStorage.getItem("ct_last_series");
  if (last && state.series.some(s=>s.id===last)){
    await openSeries(last);
  } else {
    showHome();
  }
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
