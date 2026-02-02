const VERSION = "v4.1.5";
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

  homeView: $("#homeView"),
  homeGrid: $("#homeGrid"),
  homeEmpty: $("#homeEmpty"),

  seriesView: $("#seriesView"),
  seriesName: $("#seriesName"),
  seriesStats: $("#seriesStats"),
  partSelect: $("#partSelect"),
  partFilter: $("#partFilter"),
  toggleAllTrade: $("#toggleAllTrade"),
  toggleAllReceived: $("#toggleAllReceived"),
  fileImage: $("#fileImage"),
  btnUndo: $("#btnUndo"),
  btnDeletePart: $("#btnDeletePart"),
  btnDeleteSeries: $("#btnDeleteSeries"),

  dropzone: $("#dropzone"),
  seriesLeftcol: $("#seriesLeftcol"),
  btnViewImage: $("#btnViewImage"),

  cardsList: $("#cardsList"),

  dlgNewSeries: $("#dlgNewSeries"),
  newSeriesName: $("#newSeriesName"),

  dlgConfirm: $("#dlgConfirm"),
  confirmTitle: $("#confirmTitle"),
  confirmText: $("#confirmText"),
  confirmOk: $("#confirmOk"),

  dlgImageViewer: $("#dlgImageViewer"),
  viewerStage: $("#viewerStage"),
  viewerImage: $("#viewerImage"),
  viewerClose: $("#viewerClose"),

  dlgCoverPos: $("#dlgCoverPos"),
  coverFrame: $("#coverFrame"),
  coverFrameImage: $("#coverFrameImage"),
  coverReset: $("#coverReset"),
  coverCancel: $("#coverCancel"),
  coverSave: $("#coverSave"),

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

  image: null,
  imageURL: null,
  imageScale: 1,
  highlightCardId: null,
  focusCardId: null,
  focusUntil: 0,

  drag: { active:false, startX:0, startY:0, curX:0, curY:0 },
  imageByPart: new Map(),
  coverEditor: {
    seriesId: null,
    pos: {x:50, y:50},
    dragging: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    maxX: 0,
    maxY: 0,
    url: null,
  },
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
function getSeriesCoverPos(series){
  const rawX = Number(series?.coverPos?.x);
  const rawY = Number(series?.coverPos?.y);
  return {
    x: clamp(Number.isFinite(rawX) ? rawX : 50, 0, 100),
    y: clamp(Number.isFinite(rawY) ? rawY : 50, 0, 100),
  };
}
function applyCoverPosition(img, series){
  const pos = getSeriesCoverPos(series);
  img.style.objectPosition = `${pos.x}% ${pos.y}%`;
}

function humanStats(cards){
  const total = cards.length;
  const trade = cards.filter(c => c.foundTrade).length;
  const received = cards.filter(c => c.received).length;
  const pending = total - received;
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
  els.seriesList.innerHTML = "";
  for (const s of state.series){
    const item = document.createElement("div");
    item.className = "series-item" + (s.id===active ? " active" : "");
    item.dataset.id = s.id;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.innerHTML = `<div style="font-weight:900;color:rgba(255,255,255,0.65)">✦</div>`;

    const info = document.createElement("div");
    info.className = "series-info";
    const nameRow = document.createElement("div");
    nameRow.className = "series-name-row";
    nameRow.textContent = seriesDisplayName(s.name);

    const sub = document.createElement("div");
    sub.className = "series-sub";
    const badge = document.createElement("span");
    badge.className = "badge progress-badge dim";
    badge.textContent = "0/0";
    sub.appendChild(badge);

    info.append(nameRow, sub);
    const delBtn = document.createElement("button");
    delBtn.className = "series-delete";
    delBtn.type = "button";
    delBtn.title = "Удалить серию";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await deleteSeriesById(s.id);
    });

    item.append(thumb, info, delBtn);

    // Open
    item.addEventListener("click", () => openSeries(s.id));
    els.seriesList.appendChild(item);

    // Async: thumbnail
    (async () => {
      const blob = await seriesPreviewBlob(s.id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
      applyCoverPosition(img, s);
      thumb.innerHTML = "";
      thumb.appendChild(img);
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

async function seriesPreviewBlob(seriesId){
  const parts = (await db.getAllByIndex("parts","seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  if (!parts.length) return null;
  const series = state.series.find(s=>s.id===seriesId);
  let part = null;
  if (series?.coverPartId){
    part = parts.find(p=>p.id===series.coverPartId) || null;
  }
  if (!part) part = parts[0];
  return part?.imageBlob || null;
}

/* ---------- Home ---------- */
async function renderHome(){
  els.homeGrid.innerHTML = "";
  if (!state.series.length){
    els.homeEmpty.classList.remove("hidden");
    return;
  }
  els.homeEmpty.classList.add("hidden");

  for (const s of state.series){
    const cardEl = document.createElement("div");
    cardEl.className = "home-card";
    cardEl.dataset.id = s.id;

    const thumb = document.createElement("div");
    thumb.className = "home-thumb";
    thumb.innerHTML = `<div class="ph">✦</div>`;

    const actions = document.createElement("div");
    actions.className = "home-actions";

    const btnRefresh = document.createElement("button");
    btnRefresh.className = "home-action";
    btnRefresh.type = "button";
    btnRefresh.title = "Обновить обложку (Часть 1)";
    btnRefresh.textContent = "⟳";
    btnRefresh.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await refreshSeriesCover(s.id);
    });

    const btnEdit = document.createElement("button");
    btnEdit.className = "home-action";
    btnEdit.type = "button";
    btnEdit.title = "Позиция обложки";
    btnEdit.textContent = "✎";
    btnEdit.addEventListener("click", async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await openCoverEditor(s.id, thumb);
    });

    actions.append(btnRefresh, btnEdit);
    thumb.appendChild(actions);

    (async () => {
      const blob = await seriesPreviewBlob(s.id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
      applyCoverPosition(img, s);
      thumb.innerHTML = "";
      thumb.appendChild(actions);
      thumb.appendChild(img);
    })();

    const body = document.createElement("div");
    body.className = "home-body";
    const name = document.createElement("div");
    name.className = "home-name";
    name.textContent = seriesDisplayName(s.name);

    const cards = await db.getAllByIndex("cards","seriesId", s.id);
    const { total, received, pct } = computeProgress(cards);

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
}

function updateDropzoneVisibility(){
  const empty = state.parts.length === 0;
  els.seriesLeftcol.classList.toggle("leftcol--empty", empty);
}

async function loadActivePartImage(){
  if (state.imageURL){ URL.revokeObjectURL(state.imageURL); state.imageURL=null; }
  state.image = null;
  if (!state.activePartId){
    updateViewerButtonState();
    return;
  }

  const p = state.parts.find(x=>x.id===state.activePartId);
  if (!p || !p.imageBlob){
    updateViewerButtonState();
    return;
  }
  const url = URL.createObjectURL(p.imageBlob);
  state.imageURL = url;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode().catch(()=>{});
  state.image = img;
  updateViewerButtonState();
}

function updateViewerButtonState(){
  if (!els.btnViewImage) return;
  const hasImage = !!state.image;
  els.btnViewImage.disabled = !hasImage;
  els.btnViewImage.classList.toggle("is-disabled", !hasImage);
}

async function addPartFromFile(file){
  if (!file || !state.activeSeriesId) return;
  const nextIdx = state.parts.length ? Math.max(...state.parts.map(p=>p.index)) + 1 : 1;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode().catch(()=>{});
  const w = img.width, h = img.height;
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

async function refreshSeriesCover(seriesId){
  const parts = (await db.getAllByIndex("parts","seriesId", seriesId)).sort((a,b)=>a.index-b.index);
  const part = parts[0];
  if (!part) return;
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;
  s.coverPartId = part.id;
  s.updatedAt = Date.now();
  await db.put("series", s);
  state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderSeriesList();
  await renderHome();
}

async function openCoverEditor(seriesId, thumbEl){
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;
  const blob = await seriesPreviewBlob(seriesId);
  if (!blob) return;
  const rect = thumbEl?.getBoundingClientRect();
  if (rect?.width && rect?.height){
    els.coverFrame.style.aspectRatio = `${rect.width / rect.height}`;
  } else {
    els.coverFrame.style.aspectRatio = "3 / 1.4";
  }

  if (state.coverEditor.url){
    URL.revokeObjectURL(state.coverEditor.url);
  }
  const url = URL.createObjectURL(blob);
  state.coverEditor.url = url;
  state.coverEditor.seriesId = seriesId;
  state.coverEditor.pos = getSeriesCoverPos(s);
  applyCoverEditorPosition();
  els.coverFrameImage.src = url;
  els.coverFrameImage.onload = () => {
    applyCoverEditorPosition();
    updateCoverEditorBounds();
  };
  if (els.coverFrameImage.complete){
    applyCoverEditorPosition();
    updateCoverEditorBounds();
  }
  els.dlgCoverPos.showModal();
}

function updateCoverEditorBounds(){
  const img = els.coverFrameImage;
  const frameRect = els.coverFrame.getBoundingClientRect();
  const natW = img.naturalWidth || 0;
  const natH = img.naturalHeight || 0;
  if (!frameRect.width || !frameRect.height || !natW || !natH) return;
  const scale = Math.max(frameRect.width / natW, frameRect.height / natH);
  const scaledW = natW * scale;
  const scaledH = natH * scale;
  state.coverEditor.maxX = Math.max(0, scaledW - frameRect.width);
  state.coverEditor.maxY = Math.max(0, scaledH - frameRect.height);
}

function coverPosToOffset(pos, max){
  if (!max) return 0;
  return -max * (pos / 100);
}

function offsetToCoverPos(offset, max){
  if (!max) return 50;
  return clamp((-offset / max) * 100, 0, 100);
}

function applyCoverEditorPosition(){
  els.coverFrameImage.style.objectPosition = `${state.coverEditor.pos.x}% ${state.coverEditor.pos.y}%`;
}

function startCoverDrag(evt){
  if (!state.coverEditor.seriesId) return;
  updateCoverEditorBounds();
  const { maxX, maxY } = state.coverEditor;
  state.coverEditor.dragging = true;
  state.coverEditor.startX = evt.clientX;
  state.coverEditor.startY = evt.clientY;
  state.coverEditor.startOffsetX = coverPosToOffset(state.coverEditor.pos.x, maxX);
  state.coverEditor.startOffsetY = coverPosToOffset(state.coverEditor.pos.y, maxY);
  els.coverFrame.setPointerCapture(evt.pointerId);
}

function moveCoverDrag(evt){
  if (!state.coverEditor.dragging) return;
  const { maxX, maxY } = state.coverEditor;
  const dx = evt.clientX - state.coverEditor.startX;
  const dy = evt.clientY - state.coverEditor.startY;
  const nextOffsetX = clamp(state.coverEditor.startOffsetX + dx, -maxX, 0);
  const nextOffsetY = clamp(state.coverEditor.startOffsetY + dy, -maxY, 0);
  state.coverEditor.pos.x = offsetToCoverPos(nextOffsetX, maxX);
  state.coverEditor.pos.y = offsetToCoverPos(nextOffsetY, maxY);
  applyCoverEditorPosition();
}

function endCoverDrag(evt){
  if (!state.coverEditor.dragging) return;
  state.coverEditor.dragging = false;
  els.coverFrame.releasePointerCapture(evt.pointerId);
}

async function saveCoverEditor(){
  const seriesId = state.coverEditor.seriesId;
  if (!seriesId) return;
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;
  s.coverPos = { x: state.coverEditor.pos.x, y: state.coverEditor.pos.y };
  s.updatedAt = Date.now();
  await db.put("series", s);
  state.series.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderSeriesList();
  await renderHome();
  els.dlgCoverPos.close();
}

function resetCoverEditor(){
  state.coverEditor.pos = {x:50, y:50};
  applyCoverEditorPosition();
}

async function openActiveImageViewer(){
  if (!state.activePartId) return;
  const part = state.parts.find(p=>p.id===state.activePartId);
  if (!part?.imageBlob) return;
  if (viewerState.url){
    URL.revokeObjectURL(viewerState.url);
    viewerState.url = null;
  }
  const url = URL.createObjectURL(part.imageBlob);
  viewerState.url = url;
  els.viewerImage.src = url;
  await els.viewerImage.decode().catch(()=>{});
  els.dlgImageViewer.showModal();
  requestAnimationFrame(() => resetViewer());
}

const viewerState = {
  zoom: 1,
  baseScale: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  url: null,
};

function computeViewerBaseScale(){
  const rect = els.viewerStage.getBoundingClientRect();
  const img = els.viewerImage;
  const natW = img.naturalWidth || 0;
  const natH = img.naturalHeight || 0;
  if (!rect.width || !rect.height || !natW || !natH){
    viewerState.baseScale = 1;
    return;
  }
  const scale = Math.min(rect.width / natW, rect.height / natH);
  viewerState.baseScale = scale;
}

function clampViewerPan(){
  const rect = els.viewerStage.getBoundingClientRect();
  const img = els.viewerImage;
  const natW = img.naturalWidth || 0;
  const natH = img.naturalHeight || 0;
  const scale = viewerState.baseScale * viewerState.zoom;
  const scaledW = natW * scale;
  const scaledH = natH * scale;
  const maxX = Math.max(0, (scaledW - rect.width) / 2);
  const maxY = Math.max(0, (scaledH - rect.height) / 2);
  viewerState.panX = clamp(viewerState.panX, -maxX, maxX);
  viewerState.panY = clamp(viewerState.panY, -maxY, maxY);
}

function updateViewerTransform(){
  const scale = viewerState.baseScale * viewerState.zoom;
  els.viewerImage.style.transform = `translate(${viewerState.panX}px, ${viewerState.panY}px) scale(${scale})`;
  els.viewerStage.classList.toggle("is-zoomed", viewerState.zoom > 1);
}

function resetViewer(){
  computeViewerBaseScale();
  viewerState.zoom = 1;
  viewerState.panX = 0;
  viewerState.panY = 0;
  updateViewerTransform();
}

function onViewerWheel(evt){
  evt.preventDefault();
  const delta = evt.deltaY;
  const factor = delta > 0 ? 0.9 : 1.1;
  viewerState.zoom = clamp(viewerState.zoom * factor, 1, 6);
  clampViewerPan();
  updateViewerTransform();
}

function onViewerPointerDown(evt){
  if (viewerState.zoom <= 1) return;
  evt.preventDefault();
  viewerState.dragging = true;
  viewerState.startX = evt.clientX;
  viewerState.startY = evt.clientY;
  viewerState.startPanX = viewerState.panX;
  viewerState.startPanY = viewerState.panY;
  els.viewerStage.setPointerCapture(evt.pointerId);
}

function onViewerPointerMove(evt){
  if (!viewerState.dragging) return;
  const dx = evt.clientX - viewerState.startX;
  const dy = evt.clientY - viewerState.startY;
  viewerState.panX = viewerState.startPanX + dx;
  viewerState.panY = viewerState.startPanY + dy;
  clampViewerPan();
  updateViewerTransform();
}

function onViewerPointerUp(evt){
  if (!viewerState.dragging) return;
  viewerState.dragging = false;
  els.viewerStage.releasePointerCapture(evt.pointerId);
}

function closeViewer(){
  els.dlgImageViewer.close();
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
  else if (state.statusFilter === "pending") out = out.filter(c=>!c.received);
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

    const mini = document.createElement("div");
    mini.className = "mini";
    const img = document.createElement("img");
    img.alt = "";
    img.src = miniPreviewDataURL(c);
    mini.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "meta";

    const row1 = document.createElement("div");
    row1.className = "row1";
    const label = document.createElement("input");
    label.className = "label title-input";
    label.type = "text";
    label.value = (c.title || "").trim() || cardLabel(idx);
    label.placeholder = cardLabel(idx);
    let titleTmr = null;
    label.addEventListener("input", () => {
      if (titleTmr) clearTimeout(titleTmr);
      titleTmr = setTimeout(async () => {
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

    const btnShow = document.createElement("button");
    btnShow.className = "iconbtn";
    btnShow.type = "button";
    btnShow.textContent = "Показать";
    btnShow.addEventListener("click", async () => showCardOnCanvas(c));

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn danger";
    btnDel.type = "button";
    btnDel.textContent = "Удалить";
    btnDel.addEventListener("click", async () => {
      const ok = await confirmDialog("Удалить открытку?", "Это действие нельзя отменить.", "Удалить");
      if (!ok) return;
      await db.delete("cards", c.id);
      state.cards = state.cards.filter(x=>x.id!==c.id);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    actions.append(btnShow, btnDel);

    meta.append(row1, checks, noteWrap, actions);
    wrap.append(mini, meta);

    wrap.addEventListener("mouseenter", () => { state.highlightCardId = c.id; draw(); });
    wrap.addEventListener("mouseleave", () => { state.highlightCardId = null; draw(); });

    els.cardsList.appendChild(wrap);
  });
}

async function showCardOnCanvas(card){
  await setActivePart(card.partId);
  els.canvas.scrollIntoView({behavior:"smooth", block:"center"});
  state.highlightCardId = card.id;
  state.focusCardId = card.id;
  state.focusUntil = Date.now() + 1400;
  draw();
  setTimeout(()=>{ state.highlightCardId = null; draw(); }, 1200);
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
  localStorage.setItem("ct_last_part_"+state.activeSeriesId, partId);
  renderPartSelect();
  await loadActivePartImage();
  resizeCanvasAndRedraw();
  draw();
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

async function toggleAllFoundTrade(){
  if (!state.activePartId) return;
  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  if (!partCards.length) return;
  const allOn = partCards.every(c=>c.foundTrade);
  const next = !allOn;
  for (const c of partCards){
    applyFoundTrade(c, next);
    c.updatedAt = Date.now();
    await db.put("cards", c);
  }
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

async function toggleAllReceived(){
  if (!state.activePartId) return;
  const partCards = state.cards.filter(c=>c.partId===state.activePartId);
  if (!partCards.length) return;
  const allOn = partCards.every(c=>c.received);
  const next = !allOn;
  for (const c of partCards){
    applyReceived(c, next);
    c.updatedAt = Date.now();
    await db.put("cards", c);
  }
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

/* ---------- Create / Delete series ---------- */
async function createSeries(nameRaw){
  const name = (nameRaw||"").trim() || nextAutoCollectionName();
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
  if (!state.activeSeriesId) return;
  await deleteSeriesById(state.activeSeriesId);
}

async function deleteSeriesById(seriesId){
  const s = state.series.find(x=>x.id===seriesId);
  if (!s) return;

  const ok = await confirmDialog(
    "Удалить серию?",
    `Серия “${seriesDisplayName(s.name)}” будет удалена. Это удалит все части, статусы и заметки для этой серии.`,
    "Удалить"
  );
  if (!ok) return;

  const cards = await db.getAllByIndex("cards","seriesId", seriesId);
  for (const c of cards) await db.delete("cards", c.id);
  const parts = await db.getAllByIndex("parts","seriesId", seriesId);
  for (const p of parts) await db.delete("parts", p.id);
  await db.delete("series", seriesId);

  state.series = state.series.filter(x=>x.id!==seriesId);
  if (state.activeSeriesId === seriesId){
    state.parts = [];
    state.cards = [];
    state.activeSeriesId = null;
    state.activePartId = null;
  }

  await renderHome();
  renderSeriesList();
  if (!state.activeSeriesId) showHome();
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

  let cssH = Math.min(Math.max(420, window.innerHeight - 260), 700);
  if (state.image){
    const ar = state.image.height / state.image.width;
    cssH = clamp(cssW * ar, 320, Math.max(380, window.innerHeight - 260));
  }

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
  for (const c of partCards){
    const {cx:x1, cy:y1} = imageToCanvasCoords(c.x, c.y);
    const {cx:x2, cy:y2} = imageToCanvasCoords(c.x+c.w, c.y+c.h);
    const rr = rectNormalize(x1,y1,x2,y2);

    const isHi = state.highlightCardId===c.id;
    const isReceived = !!c.received;
    const isTrade = !!c.foundTrade;

    ctx.save();
    if (focusActive && c.id !== state.focusCardId){
      ctx.globalAlpha = 0.18;
    }
    ctx.lineWidth = devicePx(isHi ? 2.6 : 1.6);

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
  state.drag.startX = x; state.drag.startY = y;
  state.drag.curX = x; state.drag.curY = y;
  draw();
}
function onPointerMove(evt){
  if (!state.drag.active) return;
  const {x,y} = pointerPos(evt);
  state.drag.curX = x; state.drag.curY = y;
  draw();
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
        state.highlightCardId = hit.id;
        draw();
        return;
      }
    }
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

/* ---------- Events ---------- */
function initEvents(){
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
    s.name = els.seriesName.value;
    s.updatedAt = Date.now();
    await db.put("series", s);
    renderSeriesList();
    await renderHome();
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

  els.btnUndo.addEventListener("click", undoLastInActivePart);
  els.btnDeletePart.addEventListener("click", async () => {
    if (!state.activePartId) return;
    await deletePart(state.activePartId);
  });
  els.btnDeleteSeries.addEventListener("click", deleteActiveSeries);

  els.btnViewImage?.addEventListener("click", async (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    await openActiveImageViewer();
  });

  els.toggleAllTrade.addEventListener("click", toggleAllFoundTrade);
  els.toggleAllReceived.addEventListener("click", toggleAllReceived);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  els.viewerClose?.addEventListener("click", closeViewer);
  els.viewerStage?.addEventListener("wheel", onViewerWheel, { passive: false });
  els.viewerStage?.addEventListener("pointerdown", onViewerPointerDown);
  els.viewerStage?.addEventListener("pointermove", onViewerPointerMove);
  els.viewerStage?.addEventListener("pointerup", onViewerPointerUp);
  els.viewerStage?.addEventListener("pointercancel", onViewerPointerUp);

  els.coverFrame?.addEventListener("pointerdown", (evt) => {
    evt.preventDefault();
    startCoverDrag(evt);
  });
  els.coverFrame?.addEventListener("pointermove", moveCoverDrag);
  els.coverFrame?.addEventListener("pointerup", endCoverDrag);
  els.coverFrame?.addEventListener("pointercancel", endCoverDrag);
  els.coverReset?.addEventListener("click", resetCoverEditor);
  els.coverCancel?.addEventListener("click", () => els.dlgCoverPos.close());
  els.coverSave?.addEventListener("click", saveCoverEditor);

  window.addEventListener("resize", () => {
    resizeCanvasAndRedraw();
    if (els.dlgImageViewer?.open) resetViewer();
    if (els.dlgCoverPos?.open) updateCoverEditorBounds();
  });

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

  updateViewerButtonState();
}

els.dlgImageViewer?.addEventListener("close", () => {
  if (viewerState.url){
    URL.revokeObjectURL(viewerState.url);
    viewerState.url = null;
  }
  resetViewer();
});

els.dlgCoverPos?.addEventListener("close", () => {
  if (state.coverEditor.url){
    URL.revokeObjectURL(state.coverEditor.url);
    state.coverEditor.url = null;
  }
  state.coverEditor.seriesId = null;
  state.coverEditor.dragging = false;
});

/* ---------- Boot ---------- */
async function loadAll(){
  await db.open();
  // NOTE: if you came from v3, we keep compatibility; migration is best-effort.
  try { await migrateIfNeeded(); } catch(e) { /* ignore */ }

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
