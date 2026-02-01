// Collection Tracker — single-file-ish app
// Data model (IndexedDB):
// db: collection_tracker_v1
// stores:
//  - series: { id, name, createdAt, updatedAt, imageBlob?, imageW?, imageH?, cardsCount? }
//  - cards:  { id, seriesId, x, y, w, h, foundTrade, received, createdAt, updatedAt }
//
// Note: Image blobs stay inside IndexedDB, so it works on GitHub Pages without a backend.

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/** Minimal IndexedDB wrapper (no deps) */
class DB {
  constructor(name, version){ this.name=name; this.version=version; this.db=null; }
  async open(){
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains("series")) {
          const s = db.createObjectStore("series", { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt", { unique:false });
        }
        if (!db.objectStoreNames.contains("cards")) {
          const c = db.createObjectStore("cards", { keyPath: "id" });
          c.createIndex("seriesId", "seriesId", { unique:false });
          c.createIndex("updatedAt", "updatedAt", { unique:false });
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
  async get(store, key){
    await this.open();
    return new Promise((resolve, reject) => {
      const { stores } = this.tx([store], "readonly");
      const req = stores[store].get(key);
      req.onsuccess = () => resolve(req.result);
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
  async clearStore(store){
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

const db = new DB("collection_tracker_v1", 1);

const els = {
  seriesList: $("#seriesList"),
  btnNewSeries: $("#btnNewSeries"),
  btnNewSeries2: $("#btnNewSeries2"),
  dlgNewSeries: $("#dlgNewSeries"),
  newSeriesName: $("#newSeriesName"),
  btnCreateSeries: $("#btnCreateSeries"),

  emptyState: $("#emptyState"),
  seriesView: $("#seriesView"),
  seriesName: $("#seriesName"),
  seriesStats: $("#seriesStats"),
  fileImage: $("#fileImage"),
  btnUndo: $("#btnUndo"),
  btnDeleteSeries: $("#btnDeleteSeries"),

  canvas: $("#canvas"),
  canvasHelp: $("#canvasHelp"),
  cardsList: $("#cardsList"),

  btnExport: $("#btnExport"),
  fileImport: $("#fileImport"),
  btnAbout: $("#btnAbout"),
  dlgAbout: $("#dlgAbout"),
};

let state = {
  series: [],
  activeSeriesId: null,
  cards: [],
  filter: "all",
  image: null,           // HTMLImageElement
  imageURL: null,        // object URL
  imageScale: 1,         // canvas pixels per image pixel (we draw scaled to canvas)
  drawRects: [],         // cached normalized rects
};

function uid(prefix="id"){
  return `${prefix}_${crypto.randomUUID()}`;
}

function fmtDate(ts){
  try{
    const d = new Date(ts);
    return d.toLocaleDateString("ru-RU", {year:"numeric", month:"short", day:"2-digit"});
  }catch{ return ""; }
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function rectNormalize(x1,y1,x2,y2){
  const x = Math.min(x1,x2);
  const y = Math.min(y1,y2);
  const w = Math.abs(x2-x1);
  const h = Math.abs(y2-y1);
  return {x,y,w,h};
}

function rectValid(r){
  return r.w >= 12 && r.h >= 12;
}

function humanStats(cards){
  const total = cards.length;
  const trade = cards.filter(c => c.foundTrade).length;
  const received = cards.filter(c => c.received).length;
  const pending = total - received;
  return { total, trade, received, pending };
}

function filterCards(cards, filter){
  if (filter === "trade") return cards.filter(c => c.foundTrade);
  if (filter === "received") return cards.filter(c => c.received);
  if (filter === "pending") return cards.filter(c => !c.received);
  return cards;
}

async function loadAll(){
  await db.open();
  state.series = (await db.getAll("series"))
    .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  renderSeriesList();
  if (state.series.length){
    // restore last active series if exists
    const last = localStorage.getItem("ct_last_series");
    const exists = last && state.series.some(s => s.id === last);
    await openSeries(exists ? last : state.series[0].id);
  } else {
    showEmpty();
  }
}

function showEmpty(){
  state.activeSeriesId = null;
  els.emptyState.classList.remove("hidden");
  els.seriesView.classList.add("hidden");
}

function showSeries(){
  els.emptyState.classList.add("hidden");
  els.seriesView.classList.remove("hidden");
}

function renderSeriesList(){
  const active = state.activeSeriesId;
  els.seriesList.innerHTML = "";
  for (const s of state.series){
    const item = document.createElement("div");
    item.className = "series-item" + (s.id === active ? " active" : "");
    item.setAttribute("role","listitem");
    item.dataset.id = s.id;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (s.imageBlob){
      const img = document.createElement("img");
      img.alt = "";
      // We don't want to pull blob out for every item (perf), so use a tiny placeholder unless active.
      // We'll show a sparkle thumbnail; active series loads full image.
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
          <defs>
            <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#7c3aed" stop-opacity="0.9"/>
              <stop offset="1" stop-color="#f0abfc" stop-opacity="0.5"/>
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#g)"/>
          <text x="32" y="40" text-anchor="middle" font-size="26" fill="white">✦</text>
        </svg>
      `);
      thumb.appendChild(img);
    } else {
      thumb.textContent = "＋";
      thumb.style.color = "rgba(255,255,255,0.65)";
      thumb.style.fontWeight = "800";
      thumb.style.fontSize = "18px";
    }

    const info = document.createElement("div");
    info.className = "series-info";
    const name = document.createElement("div");
    name.className = "series-name-row";
    name.textContent = s.name || "Без названия";

    const sub = document.createElement("div");
    sub.className = "series-sub";
    const badge1 = document.createElement("span");
    badge1.className = "badge";
    badge1.textContent = `${s.cardsCount || 0} шт.`;
    const badge2 = document.createElement("span");
    badge2.className = "badge";
    badge2.textContent = `обн. ${fmtDate(s.updatedAt || s.createdAt)}`;
    sub.append(badge1, badge2);

    info.append(name, sub);
    item.append(thumb, info);

    item.addEventListener("click", () => openSeries(s.id));
    els.seriesList.appendChild(item);
  }
}

async function openSeries(seriesId){
  const s = state.series.find(x => x.id === seriesId);
  if (!s) return;

  state.activeSeriesId = seriesId;
  localStorage.setItem("ct_last_series", seriesId);
  renderSeriesList();

  showSeries();

  // Load cards
  state.cards = (await db.getAllByIndex("cards","seriesId", seriesId))
    .sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  state.filter = "all";
  $$(".chip").forEach(ch => ch.classList.toggle("active", ch.dataset.filter === "all"));

  // Load image if exists
  if (state.imageURL){
    URL.revokeObjectURL(state.imageURL);
    state.imageURL = null;
  }
  state.image = null;

  els.seriesName.value = s.name || "";
  await loadImageFromSeries(s);

  refreshStatsAndRender();
  resizeCanvasAndRedraw();
}

async function loadImageFromSeries(series){
  if (!series.imageBlob){
    state.image = null;
    state.imageURL = null;
    return;
  }
  const url = URL.createObjectURL(series.imageBlob);
  state.imageURL = url;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode().catch(()=>{});
  state.image = img;
}

function refreshStatsAndRender(){
  // Update cardsCount in series list (cheap)
  const s = state.series.find(x => x.id === state.activeSeriesId);
  if (s){
    s.cardsCount = state.cards.length;
    renderSeriesList();
  }
  renderCardsList();
  renderStats();
  draw();
}

function renderStats(){
  const { total, trade, received, pending } = humanStats(state.cards);
  els.seriesStats.textContent = total
    ? `Всего: ${total} • Нашла обмен: ${trade} • Получено: ${received} • Жду: ${pending}`
    : `Пока нет выделенных открыток`;
}

function cardLabel(idx, card){
  const n = String(idx+1).padStart(2,"0");
  return `Открытка ${n}`;
}

function renderCardsList(){
  const visible = filterCards(state.cards, state.filter);
  els.cardsList.innerHTML = "";
  if (!visible.length){
    const empty = document.createElement("div");
    empty.style.color = "rgba(255,255,255,0.65)";
    empty.style.fontSize = "13px";
    empty.style.padding = "12px";
    empty.innerHTML = state.cards.length
      ? "По фильтру ничего не найдено."
      : "Выдели на изображении открытки рамкой — они появятся здесь.";
    els.cardsList.appendChild(empty);
    return;
  }

  visible.forEach((c) => {
    const idx = state.cards.findIndex(x => x.id === c.id);
    const wrap = document.createElement("div");
    wrap.className = "card";

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
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = cardLabel(idx, c);
    const id = document.createElement("div");
    id.className = "id";
    id.textContent = c.id.split("_").slice(-1)[0].slice(0,8);
    row1.append(label, id);

    const checks = document.createElement("div");
    checks.className = "checks";

    const t1 = document.createElement("label");
    t1.className = "toggle";
    const cb1 = document.createElement("input");
    cb1.type = "checkbox";
    cb1.checked = !!c.foundTrade;
    cb1.addEventListener("change", async () => {
      c.foundTrade = cb1.checked;
      c.updatedAt = Date.now();
      await db.put("cards", c);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });
    const sp1 = document.createElement("span");
    sp1.textContent = "Нашла обмен";
    t1.append(cb1, sp1);

    const t2 = document.createElement("label");
    t2.className = "toggle";
    const cb2 = document.createElement("input");
    cb2.type = "checkbox";
    cb2.checked = !!c.received;
    cb2.addEventListener("change", async () => {
      c.received = cb2.checked;
      // if received, foundTrade often true, but don't force
      c.updatedAt = Date.now();
      await db.put("cards", c);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });
    const sp2 = document.createElement("span");
    sp2.textContent = "Получено";
    t2.append(cb2, sp2);

    checks.append(t1, t2);

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnFocus = document.createElement("button");
    btnFocus.className = "iconbtn";
    btnFocus.type = "button";
    btnFocus.textContent = "Показать";
    btnFocus.addEventListener("click", () => {
      focusCard(c);
    });

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn danger";
    btnDel.type = "button";
    btnDel.textContent = "Удалить";
    btnDel.addEventListener("click", async () => {
      if (!confirm("Удалить эту открытку?")) return;
      await db.delete("cards", c.id);
      state.cards = state.cards.filter(x => x.id !== c.id);
      await touchSeriesUpdated();
      refreshStatsAndRender();
    });

    actions.append(btnFocus, btnDel);

    meta.append(row1, checks, actions);

    wrap.append(mini, meta);

    // clicking selects it on canvas
    wrap.addEventListener("mouseenter", () => { highlightCardId = c.id; draw(); });
    wrap.addEventListener("mouseleave", () => { highlightCardId = null; draw(); });

    els.cardsList.appendChild(wrap);
  });
}

async function touchSeriesUpdated(){
  const s = state.series.find(x => x.id === state.activeSeriesId);
  if (!s) return;
  s.updatedAt = Date.now();
  s.cardsCount = state.cards.length;
  await db.put("series", s);
  // keep series order updated
  state.series.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  renderSeriesList();
}

function miniPreviewDataURL(card){
  // Make a quick preview crop from canvas for consistent display.
  // If image is missing, return a placeholder.
  if (!state.image){
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100">
      <rect width="140" height="100" rx="14" fill="rgba(255,255,255,0.06)"/>
      <text x="70" y="58" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.8)">✦</text>
    </svg>`);
  }

  // Use offscreen canvas
  const oc = document.createElement("canvas");
  const ow = 280, oh = 200;
  oc.width = ow; oc.height = oh;
  const ctx = oc.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  const sx = Math.max(0, card.x);
  const sy = Math.max(0, card.y);
  const sw = Math.max(1, card.w);
  const sh = Math.max(1, card.h);

  ctx.drawImage(state.image, sx, sy, sw, sh, 0, 0, ow, oh);
  return oc.toDataURL("image/jpeg", 0.75);
}

/** Canvas selection & drawing */
const canvas = els.canvas;
const ctx = canvas.getContext("2d");

let drag = {
  active: false,
  startX: 0,
  startY: 0,
  curX: 0,
  curY: 0,
};
let highlightCardId = null;

function devicePx(n){ return Math.round(n * devicePixelRatio); }

function resizeCanvasAndRedraw(){
  const parent = canvas.parentElement;
  if (!parent) return;

  // CSS width is parent width; canvas pixel size should follow DPR
  const cssW = parent.clientWidth;
  // Set a reasonable height depending on screen; if image exists, keep its aspect.
  let cssH = Math.min(Math.max(420, window.innerHeight - 240), 680);

  if (state.image){
    const ar = state.image.height / state.image.width;
    cssH = clamp(cssW * ar, 320, Math.max(380, window.innerHeight - 240));
  }

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = devicePx(cssW);
  canvas.height = devicePx(cssH);

  // scale factor between image pixels and canvas pixels (draw image fitted)
  computeImageScale();

  draw();
}

function computeImageScale(){
  if (!state.image){
    state.imageScale = 1;
    return;
  }
  const cw = canvas.width;
  const ch = canvas.height;
  const sx = cw / state.image.width;
  const sy = ch / state.image.height;
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

function canvasToImageCoords(cx, cy){
  const {dx, dy, dw, dh} = imageDrawRect();
  const x = (cx - dx) / state.imageScale;
  const y = (cy - dy) / state.imageScale;
  return { x: clamp(x, 0, state.image ? state.image.width : 0), y: clamp(y, 0, state.image ? state.image.height : 0) };
}

function imageToCanvasCoords(ix, iy){
  const {dx, dy} = imageDrawRect();
  return { cx: dx + ix * state.imageScale, cy: dy + iy * state.imageScale };
}

function draw(){
  // background
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // draw image centered
  const r = imageDrawRect();

  if (state.image){
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.drawImage(state.image, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  } else {
    // placeholder
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.floor(16*devicePixelRatio)}px system-ui`;
    ctx.fillText("Загрузи изображение серии, чтобы начать выделять открытки.", devicePx(18), devicePx(28));
    ctx.restore();
    return;
  }

  // overlay dim outside image
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0,0,canvas.width, r.dy);
  ctx.fillRect(0, r.dy + r.dh, canvas.width, canvas.height - (r.dy + r.dh));
  ctx.fillRect(0, r.dy, r.dx, r.dh);
  ctx.fillRect(r.dx + r.dw, r.dy, canvas.width - (r.dx + r.dw), r.dh);
  ctx.restore();

  // draw existing rectangles
  for (const c of state.cards){
    const {cx: x1, cy: y1} = imageToCanvasCoords(c.x, c.y);
    const {cx: x2, cy: y2} = imageToCanvasCoords(c.x + c.w, c.y + c.h);
    const rr = rectNormalize(x1,y1,x2,y2);

    const isHi = highlightCardId === c.id;
    const isReceived = !!c.received;
    const isTrade = !!c.foundTrade;

    ctx.save();
    ctx.lineWidth = devicePx(isHi ? 2.5 : 1.5);
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

  // draw active drag rectangle
  if (drag.active){
    const rr = rectNormalize(drag.startX, drag.startY, drag.curX, drag.curY);
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

function isPointInsideImage(cx, cy){
  if (!state.image) return false;
  const {dx, dy, dw, dh} = imageDrawRect();
  return cx >= dx && cx <= dx+dw && cy >= dy && cy <= dy+dh;
}

function pointerPos(evt){
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * devicePixelRatio;
  const y = (evt.clientY - rect.top) * devicePixelRatio;
  return {x,y};
}

function onPointerDown(evt){
  if (!state.image) return;
  canvas.setPointerCapture(evt.pointerId);
  const {x,y} = pointerPos(evt);
  if (!isPointInsideImage(x,y)) return;
  drag.active = true;
  drag.startX = x; drag.startY = y;
  drag.curX = x; drag.curY = y;
  draw();
}

function onPointerMove(evt){
  if (!drag.active) return;
  const {x,y} = pointerPos(evt);
  drag.curX = x; drag.curY = y;
  draw();
}

async function onPointerUp(evt){
  if (!drag.active) return;
  drag.active = false;

  const rr = rectNormalize(drag.startX, drag.startY, drag.curX, drag.curY);
  if (!rectValid(rr)){ draw(); return; }

  // Convert to image coords
  const p1 = canvasToImageCoords(rr.x, rr.y);
  const p2 = canvasToImageCoords(rr.x + rr.w, rr.y + rr.h);
  const ir = rectNormalize(p1.x, p1.y, p2.x, p2.y);

  // Basic dedupe: if overlaps heavily with existing, ignore
  const overlap = bestOverlap(ir);
  if (overlap > 0.82){
    draw();
    return;
  }

  const card = {
    id: uid("card"),
    seriesId: state.activeSeriesId,
    x: Math.round(ir.x),
    y: Math.round(ir.y),
    w: Math.round(ir.w),
    h: Math.round(ir.h),
    foundTrade: false,
    received: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.put("cards", card);
  state.cards.push(card);
  await touchSeriesUpdated();
  refreshStatsAndRender();
}

function rectArea(r){ return Math.max(0,r.w) * Math.max(0,r.h); }
function rectIntersect(a,b){
  const x1 = Math.max(a.x,b.x);
  const y1 = Math.max(a.y,b.y);
  const x2 = Math.min(a.x+a.w, b.x+b.w);
  const y2 = Math.min(a.y+a.h, b.y+b.h);
  const w = Math.max(0, x2-x1);
  const h = Math.max(0, y2-y1);
  return {x:x1, y:y1, w, h};
}
function bestOverlap(r){
  let best = 0;
  const ar = rectArea(r);
  if (!ar) return 0;
  for (const c of state.cards){
    const inter = rectIntersect(r, c);
    const iou = rectArea(inter) / ar;
    best = Math.max(best, iou);
  }
  return best;
}

function focusCard(card){
  // Scroll cards list is already there; we visually highlight on canvas
  highlightCardId = card.id;
  draw();
  // brief pulse
  setTimeout(() => { highlightCardId = null; draw(); }, 1200);
}

/** Image upload */
async function handleImageFile(file){
  if (!file) return;
  if (!state.activeSeriesId) return;

  // Store as blob
  const s = state.series.find(x => x.id === state.activeSeriesId);
  if (!s) return;

  s.imageBlob = file;
  s.updatedAt = Date.now();

  // Load to get dimensions
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode().catch(()=>{});
  s.imageW = img.width;
  s.imageH = img.height;
  URL.revokeObjectURL(url);

  await db.put("series", s);
  // Update local state series object in array
  const idx = state.series.findIndex(x => x.id === s.id);
  state.series[idx] = s;

  // Reload image into view
  await loadImageFromSeries(s);
  resizeCanvasAndRedraw();
  renderSeriesList();
}

/** Series creation / deletion */
async function createSeries(name){
  const s = {
    id: uid("series"),
    name: name.trim() || "Без названия",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cardsCount: 0,
    imageBlob: null,
    imageW: null,
    imageH: null,
  };
  await db.put("series", s);
  state.series.unshift(s);
  renderSeriesList();
  await openSeries(s.id);
}

async function deleteActiveSeries(){
  const id = state.activeSeriesId;
  if (!id) return;
  const s = state.series.find(x => x.id === id);
  if (!s) return;

  if (!confirm(`Удалить серию “${s.name}” и все её открытки?`)) return;

  // Delete cards
  const cards = await db.getAllByIndex("cards", "seriesId", id);
  for (const c of cards){
    await db.delete("cards", c.id);
  }
  await db.delete("series", id);

  state.series = state.series.filter(x => x.id !== id);
  state.cards = [];
  state.activeSeriesId = null;
  renderSeriesList();

  if (state.series.length){
    await openSeries(state.series[0].id);
  } else {
    showEmpty();
  }
}

/** Export / Import */
async function exportData(){
  const series = await db.getAll("series");
  const cards = await db.getAll("cards");

  // Convert blobs to base64 for portability
  const seriesPortable = [];
  for (const s of series){
    const copy = {...s};
    if (copy.imageBlob){
      copy.imageBase64 = await blobToDataURL(copy.imageBlob);
      delete copy.imageBlob;
    }
    seriesPortable.push(copy);
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    series: seriesPortable,
    cards: cards,
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
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.series) || !Array.isArray(data.cards)){
    alert("Файл не похож на экспорт Collection Tracker.");
    return;
  }

  if (!confirm("Импорт заменит текущие данные на этом устройстве. Продолжить?")) return;

  await db.clearStore("cards");
  await db.clearStore("series");

  // Restore series (convert base64 back to blob)
  for (const s of data.series){
    const copy = {...s};
    if (copy.imageBase64){
      copy.imageBlob = dataURLToBlob(copy.imageBase64);
      delete copy.imageBase64;
    }
    await db.put("series", copy);
  }
  for (const c of data.cards){
    await db.put("cards", c);
  }

  await loadAll();
}

function blobToDataURL(blob){
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

/** Events wiring */
function initEvents(){
  els.btnNewSeries.addEventListener("click", () => {
    els.newSeriesName.value = "";
    els.dlgNewSeries.showModal();
    setTimeout(()=>els.newSeriesName.focus(), 50);
  });
  els.btnNewSeries2.addEventListener("click", () => els.btnNewSeries.click());

  els.dlgNewSeries.addEventListener("close", async () => {
    if (els.dlgNewSeries.returnValue !== "ok") return;
    const name = els.newSeriesName.value.trim();
    if (!name) return;
    await createSeries(name);
  });

  els.seriesName.addEventListener("input", async () => {
    const s = state.series.find(x => x.id === state.activeSeriesId);
    if (!s) return;
    s.name = els.seriesName.value;
    s.updatedAt = Date.now();
    await db.put("series", s);
    renderSeriesList();
  });

  els.fileImage.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await handleImageFile(f);
    await touchSeriesUpdated();
    refreshStatsAndRender();
  });

  els.btnUndo.addEventListener("click", async () => {
    if (!state.cards.length) return;
    const last = state.cards[state.cards.length - 1];
    if (!confirm("Убрать последнее выделение?")) return;
    await db.delete("cards", last.id);
    state.cards.pop();
    await touchSeriesUpdated();
    refreshStatsAndRender();
  });

  els.btnDeleteSeries.addEventListener("click", deleteActiveSeries);

  // Canvas pointer events
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", () => { drag.active=false; draw(); });

  // Filters
  $$(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      $$(".chip").forEach(x => x.classList.remove("active"));
      ch.classList.add("active");
      state.filter = ch.dataset.filter;
      renderCardsList();
    });
  });

  // Export / Import
  els.btnExport.addEventListener("click", exportData);
  els.fileImport.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try{
      await importData(f);
    } catch(err){
      console.error(err);
      alert("Не удалось импортировать файл. Возможно он повреждён.");
    }
  });

  els.btnAbout.addEventListener("click", () => els.dlgAbout.showModal());

  window.addEventListener("resize", () => resizeCanvasAndRedraw());
}

/** PWA */
async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./sw.js", {scope:"./"});
  }catch(e){
    console.warn("SW register failed", e);
  }
}

(async function main(){
  initEvents();
  await loadAll();
  resizeCanvasAndRedraw();
  registerSW();
})();
