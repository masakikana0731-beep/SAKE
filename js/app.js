import * as db from './db.js';
import * as im from './correct.js';
import * as cam from './camera.js';
import * as lookup from './lookup.js';
import { PREFS, OTHER_ORIGINS, CATEGORIES, TYPES, TEMPS, TASTE_AXES, BADGES } from './data.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const state = {
  records: [],
  urls: new Map(),
  draft: null,
  editId: null,
  detailId: null,
  favOnly: false,
  formUrl: null,
  detailUrl: null,
  lastField: null,
};

// ---------------------------------------------------------------- UI helpers
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function busy(on, msg = '処理中…') {
  $('#busy').hidden = !on;
  $('#busy-msg').textContent = msg;
}

// confirm() はアプリ内ブラウザ等で使えない場合があるため自前のダイアログ
function ask(msg, yes = 'OK') {
  return new Promise((resolve) => {
    $('#dialog-msg').textContent = msg;
    $('#dialog-yes').textContent = yes;
    $('#dialog').hidden = false;
    const done = (v) => {
      $('#dialog').hidden = true;
      resolve(v);
    };
    $('#dialog-yes').onclick = () => done(true);
    $('#dialog-no').onclick = () => done(false);
  });
}

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

// ---------------------------------------------------------------- navigation
const VIEWS = ['list', 'capture', 'crop', 'adjust', 'form', 'detail', 'stats'];
const RENDER = {
  list: () => renderList(),
  capture: () => openCamera(),
  crop: () => renderCrop(),
  adjust: () => renderAdjust(),
  detail: () => renderDetail(),
  stats: () => renderStats(),
};

function go(view, push = true) {
  if ((view === 'crop' || view === 'adjust') && !state.draft?.src) view = 'list';
  if (view === 'adjust' && !state.draft?.warped) view = 'list';
  if (view === 'form' && !state.draft?.blob && !state.editId) view = 'list';
  if (view === 'detail' && !state.records.some((r) => r.id === state.detailId)) view = 'list';

  for (const v of VIEWS) $('#view-' + v).hidden = v !== view;
  const tab = view === 'stats' ? 'stats' : ['capture', 'crop', 'adjust', 'form'].includes(view) && !state.editId ? 'capture' : 'list';
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
  if (view !== 'capture') cam.stop();
  if (push) history.pushState({ view }, '', '#' + view);
  window.scrollTo(0, 0);
  RENDER[view]?.();
}

window.addEventListener('popstate', (e) => go(e.state?.view || 'list', false));
$$('.tab').forEach((b) => (b.onclick = () => {
  if (b.dataset.view === 'capture') state.editId = null;
  go(b.dataset.view);
}));

// ---------------------------------------------------------------- data
async function reload() {
  for (const u of state.urls.values()) URL.revokeObjectURL(u);
  state.urls.clear();
  state.records = await db.all();
  $('#count').textContent = `${state.records.length} 本`;
}

function thumbUrl(r) {
  let u = state.urls.get(r.id);
  if (!u) {
    u = URL.createObjectURL(r.thumb || r.image);
    state.urls.set(r.id, u);
  }
  return u;
}

const earnedBadges = (rs) => BADGES.filter((b) => b.test(rs)).map((b) => b.name);

// ---------------------------------------------------------------- list
function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const cat = $('#filter-cat').value;
  const sort = $('#sort').value;
  let list = state.records.filter((r) =>
    (!cat || r.category === cat) &&
    (!state.favOnly || r.fav) &&
    (!q || [r.name, r.brewery, r.type, r.pref, r.rice, r.notes, r.place, r.pairing].join(' ').toLowerCase().includes(q)));

  const byDate = (r) => r.date || new Date(r.createdAt).toISOString().slice(0, 10);
  const cmp = {
    new: (a, b) => byDate(b).localeCompare(byDate(a)) || b.createdAt - a.createdAt,
    old: (a, b) => byDate(a).localeCompare(byDate(b)) || a.createdAt - b.createdAt,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.createdAt - a.createdAt,
    name: (a, b) => a.name.localeCompare(b.name, 'ja'),
  }[sort];
  list = list.sort(cmp);

  $('#grid').innerHTML = list.map((r) => `
    <button class="card" data-id="${esc(r.id)}">
      <img src="${thumbUrl(r)}" alt="" loading="lazy">
      ${r.fav ? '<span class="fav">♥</span>' : ''}
      <span class="card-body">
        <b>${esc(r.name)}</b>
        <span class="stars">${stars(r.rating)}</span>
        <small>${esc([r.pref, r.type || r.category].filter(Boolean).join(' · '))}</small>
      </span>
    </button>`).join('');

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!list.length && state.records.length) {
    empty.innerHTML = '<p class="big-emoji">🔍</p><p>条件に合うお酒がありません。</p>';
  } else if (!state.records.length) {
    empty.innerHTML = '<p class="big-emoji">🍶</p><p>まだ記録がありません。<br>下の <b>＋撮影</b> からラベルを撮ってみましょう。</p>';
  }
}

$('#grid').onclick = (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  state.detailId = card.dataset.id;
  go('detail');
};
$('#q').oninput = renderList;
$('#filter-cat').onchange = renderList;
$('#sort').onchange = renderList;
$('#fav-only').onclick = (e) => {
  state.favOnly = !state.favOnly;
  e.currentTarget.setAttribute('aria-pressed', state.favOnly);
  renderList();
};

// ---------------------------------------------------------------- camera
async function openCamera() {
  const msg = $('#cam-msg');
  msg.textContent = 'カメラを起動中…';
  $('#shutter').disabled = true;
  $('#torch').hidden = true;
  try {
    await cam.start($('#video'));
    msg.textContent = '';
    $('#shutter').disabled = false;
    $('#torch').hidden = !cam.hasTorch();
  } catch (err) {
    console.warn(err);
    msg.innerHTML = `<label class="btn primary big">📷 撮影 / 写真を選ぶ<input type="file" accept="image/*" hidden></label>
      <br><small>出てきたメニューで「カメラ」を選ぶと撮影できます。<br>カメラが出ない場合は、先にスマホのカメラで撮ってから写真を選んでください。</small>`;
    $('input', msg).onchange = onFile;
  }
}

$('#shutter').onclick = () => {
  const frame = cam.capture($('#video'));
  startDraft(im.scaleDown(frame, 2400), 0.12);
};
$('#torch').onclick = () => cam.toggleTorch().catch(() => toast('ライトを切り替えられません'));

async function onFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  busy(true, '画像を読み込み中…');
  try {
    startDraft(await im.blobToCanvas(f), 0.06);
  } catch (err) {
    toast(err.message);
  } finally {
    busy(false);
  }
}
$('#file-pick').onchange = onFile;
$('#file-cam').onchange = onFile;

function defaultQuad(w, h, i) {
  return [[w * i, h * i], [w * (1 - i), h * i], [w * (1 - i), h * (1 - i)], [w * i, h * (1 - i)]];
}

function startDraft(src, inset) {
  state.editId = null;
  state.draft = { src, inset, quad: defaultQuad(src.width, src.height, inset), rot: 0, warped: null, blob: null, thumb: null };
  $('#adj-auto').checked = true;
  $('#adj-sharp').checked = false;
  $('#adj-bright').value = 0;
  $('#adj-contrast').value = 0;
  $('#adj-sat').value = 0;
  go('crop');
}

// ---------------------------------------------------------------- crop (四隅)
const cropSvg = $('#crop-svg');
let dragIndex = -1;

function renderCrop() {
  const { src } = state.draft;
  const c = $('#crop-canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  cropSvg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
  drawQuad();
}

function drawQuad() {
  const { src, quad } = state.draft;
  const W = src.width, H = src.height;
  const r = Math.max(W, H) * 0.02;
  const pts = quad.map((p) => p.join(',')).join(' ');
  cropSvg.innerHTML = `
    <path class="mask" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${quad.map((p) => p.join(' ')).join(' L')}Z"/>
    <polygon class="quad" points="${pts}" style="stroke-width:${r * 0.3}"/>
    ${quad.map((p, i) => `<circle class="handle${i === dragIndex ? ' active' : ''}" cx="${p[0]}" cy="${p[1]}" r="${r}" style="stroke-width:${r * 0.3}"/>`).join('')}`;
}

function svgPoint(e) {
  const pt = cropSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(cropSvg.getScreenCTM().inverse());
}

function drawLoupe(p) {
  const loupe = $('#loupe');
  const { src } = state.draft;
  const size = Math.max(src.width, src.height) * 0.08;
  const ctx = loupe.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 120, 120);
  ctx.drawImage(src, p.x - size / 2, p.y - size / 2, size, size, 0, 0, 120, 120);
  ctx.strokeStyle = '#d9a441';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(60, 0); ctx.lineTo(60, 120); ctx.moveTo(0, 60); ctx.lineTo(120, 60);
  ctx.stroke();
  // 指で隠れないよう、触っている側と反対の上隅に表示
  loupe.classList.toggle('right', p.x < src.width / 2);
  loupe.hidden = false;
}

cropSvg.addEventListener('pointerdown', (e) => {
  const p = svgPoint(e);
  const { quad, src } = state.draft;
  let best = -1, bestD = Infinity;
  quad.forEach((q, i) => {
    const d = Math.hypot(q[0] - p.x, q[1] - p.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (bestD > Math.max(src.width, src.height) * 0.15) return;
  dragIndex = best;
  cropSvg.setPointerCapture(e.pointerId);
  drawQuad();
  drawLoupe(p);
});
cropSvg.addEventListener('pointermove', (e) => {
  if (dragIndex < 0) return;
  const p = svgPoint(e);
  const { src, quad } = state.draft;
  quad[dragIndex] = [Math.min(src.width, Math.max(0, p.x)), Math.min(src.height, Math.max(0, p.y))];
  drawQuad();
  drawLoupe(p);
});
const endDrag = () => {
  dragIndex = -1;
  $('#loupe').hidden = true;
  if (state.draft) drawQuad();
};
cropSvg.addEventListener('pointerup', endDrag);
cropSvg.addEventListener('pointercancel', endDrag);

$('#crop-reset').onclick = () => {
  const d = state.draft;
  d.quad = defaultQuad(d.src.width, d.src.height, d.inset);
  drawQuad();
};
$('#crop-full').onclick = () => {
  const d = state.draft;
  d.quad = defaultQuad(d.src.width, d.src.height, 0);
  drawQuad();
};
$('#crop-next').onclick = async () => {
  const d = state.draft;
  if (!im.isConvex(d.quad)) {
    toast('四隅が交差しています。左上→右上→右下→左下の順に合わせてください');
    return;
  }
  busy(true, '台形補正中…');
  await nextFrame();
  try {
    d.warped = im.warp(d.src, d.quad, 1800);
    go('adjust');
  } catch (err) {
    toast(err.message);
  } finally {
    busy(false);
  }
};

// ---------------------------------------------------------------- adjust (色)
const adjOpts = () => ({
  auto: $('#adj-auto').checked,
  sharpen: $('#adj-sharp').checked,
  bright: +$('#adj-bright').value,
  contrast: +$('#adj-contrast').value,
  sat: +$('#adj-sat').value,
});

function processImage(base, o) {
  const c = im.clone(base);
  if (o.auto) im.autoLevels(c);
  im.adjust(c, o.bright, o.contrast, o.sat);
  if (o.sharpen) im.sharpen(c);
  return c;
}

function paint(canvas, img) {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
}

let adjRaf = 0;
function renderAdjust() {
  const d = state.draft;
  d.previewBase = im.scaleDown(im.rotate(d.warped, d.rot), 900);
  drawAdjustPreview();
}
function drawAdjustPreview() {
  cancelAnimationFrame(adjRaf);
  adjRaf = requestAnimationFrame(() => paint($('#adj-canvas'), processImage(state.draft.previewBase, adjOpts())));
}

['#adj-auto', '#adj-sharp', '#adj-bright', '#adj-contrast', '#adj-sat'].forEach((s) => ($(s).oninput = drawAdjustPreview));
$('#adj-rotate').onclick = () => {
  state.draft.rot = (state.draft.rot + 1) % 4;
  renderAdjust();
};
$('#adj-back').onclick = () => history.back();
const origBtn = $('#adj-orig');
origBtn.onpointerdown = () => paint($('#adj-canvas'), state.draft.previewBase);
origBtn.onpointerup = origBtn.onpointerleave = origBtn.onpointercancel = drawAdjustPreview;

$('#adj-next').onclick = async () => {
  const d = state.draft;
  busy(true, '仕上げ中…');
  await nextFrame();
  try {
    const full = processImage(im.rotate(d.warped, d.rot), adjOpts());
    d.blob = await im.toBlob(full, 'image/jpeg', 0.9);
    d.thumb = await im.toBlob(im.scaleDown(full, 480), 'image/jpeg', 0.82);
    fillForm(null);
    go('form');
  } finally {
    busy(false);
  }
};

// ---------------------------------------------------------------- form
function buildForm() {
  $('#filter-cat').insertAdjacentHTML('beforeend', CATEGORIES.map((c) => `<option>${c}</option>`).join(''));
  $('#f-category').innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
  $('#brand-list').innerHTML = lookup.brandNames().map((n) => `<option value="${n}">`).join('');
  $('#type-list').innerHTML = TYPES.map((t) => `<option value="${t}">`).join('');
  $('#f-pref').innerHTML = '<option value="">—</option>' +
    [...PREFS, ...OTHER_ORIGINS].map((p) => `<option>${p}</option>`).join('');
  $('#rating').innerHTML = [1, 2, 3, 4, 5].map((v) => `<button type="button" data-v="${v}" aria-label="${v}つ星">★</button>`).join('');
  $('#temps').innerHTML = TEMPS.map((t) => `<label class="chip"><input type="checkbox" value="${t}">${t}</label>`).join('');
  $('#taste').innerHTML = TASTE_AXES.map((a) => `
    <label class="slider">${a.label}<input type="range" min="0" max="5" step="1" value="3" data-key="${a.key}"><output>3</output></label>`).join('');

  $('#rating').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = +b.dataset.v;
    setRating($('#rating').dataset.value == v ? 0 : v);
  };
  $('#taste').oninput = (e) => {
    if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value;
  };
  $$('#f-name, #f-brewery, #f-type, #f-rice, #f-place, #f-pairing, #f-notes')
    .forEach((el) => el.addEventListener('focus', () => (state.lastField = el)));
}

function setRating(v) {
  $('#rating').dataset.value = v;
  $$('#rating button').forEach((b) => b.classList.toggle('on', +b.dataset.v <= v));
}

function fillForm(rec) {
  const r = rec || {};
  $('#form').reset();
  $('#form-title').textContent = rec ? '記録を編集' : '③ 記録する';
  if (state.formUrl) URL.revokeObjectURL(state.formUrl);
  state.formUrl = URL.createObjectURL(rec ? rec.image : state.draft.blob);
  $('#form-img').src = state.formUrl;

  $('#f-name').value = r.name || '';
  $('#f-brewery').value = r.brewery || '';
  $('#f-category').value = r.category || '日本酒';
  $('#f-type').value = r.type || '';
  $('#f-pref').value = r.pref || '';
  $('#f-rice').value = r.rice || '';
  $('#f-polish').value = r.polish ?? '';
  $('#f-abv').value = r.abv ?? '';
  $('#f-price').value = r.price ?? '';
  $('#f-date').value = r.date || today();
  $('#f-place').value = r.place || '';
  $('#f-pairing').value = r.pairing || '';
  $('#f-notes').value = r.notes || '';
  $('#f-fav').checked = !!r.fav;
  setRating(r.rating || 0);
  $$('#temps input').forEach((i) => (i.checked = (r.temps || []).includes(i.value)));
  $$('#taste input').forEach((i) => {
    i.value = r.taste?.[i.dataset.key] ?? 3;
    i.nextElementSibling.textContent = i.value;
  });
  $('#ocr-out').innerHTML = '';
  $('#ocr-status').textContent = '';
  $('#wiki-out').innerHTML = '';
  setAssist('');
  delete $('#f-category').dataset.touched;
  $$('#form .autofilled').forEach((el) => el.classList.remove('autofilled'));
  updateAssistLinks();
  state.lastField = $('#f-name');
}

const num = (s) => (s.value === '' ? null : +s.value);

function readForm() {
  return {
    name: $('#f-name').value.trim(),
    brewery: $('#f-brewery').value.trim(),
    category: $('#f-category').value,
    type: $('#f-type').value.trim(),
    pref: $('#f-pref').value,
    rice: $('#f-rice').value.trim(),
    polish: num($('#f-polish')),
    abv: num($('#f-abv')),
    price: num($('#f-price')),
    date: $('#f-date').value,
    place: $('#f-place').value.trim(),
    pairing: $('#f-pairing').value.trim(),
    notes: $('#f-notes').value.trim(),
    fav: $('#f-fav').checked,
    rating: +($('#rating').dataset.value || 0),
    temps: $$('#temps input:checked').map((i) => i.value),
    taste: Object.fromEntries($$('#taste input').map((i) => [i.dataset.key, +i.value])),
  };
}

$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const v = readForm();
  if (!v.name) {
    toast('銘柄を入力してください');
    $('#f-name').focus();
    return;
  }
  const before = earnedBadges(state.records);
  let rec;
  if (state.editId) {
    const old = await db.get(state.editId);
    rec = { ...old, ...v, updatedAt: Date.now() };
  } else {
    rec = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), image: state.draft.blob, thumb: state.draft.thumb, ...v };
  }
  try {
    await db.put(rec);
  } catch (err) {
    console.error(err);
    toast('保存に失敗しました（空き容量を確認してください）');
    return;
  }
  const wasEdit = !!state.editId;
  state.draft = null;
  state.editId = null;
  await reload();
  const gained = earnedBadges(state.records).filter((b) => !before.includes(b));
  toast(gained.length ? `🏅 バッジ獲得：${gained.join('、')}` : wasEdit ? '更新しました' : '🍶 記録しました！');
  state.detailId = rec.id;
  history.replaceState({ view: 'list' }, '', '#list');
  go('detail');
};

$('#form-cancel').onclick = () => {
  state.editId = null;
  history.back();
};

// ---------------------------------------------------------------- OCR（任意・ネット接続時のみ）
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('OCRライブラリを読み込めません（オフライン？）'));
    document.head.appendChild(s);
  });
}

$('#ocr-btn').onclick = async () => {
  const status = $('#ocr-status');
  const btn = $('#ocr-btn');
  const source = state.editId ? state.records.find((r) => r.id === state.editId)?.image : state.draft?.blob;
  if (!source) return;
  btn.disabled = true;
  try {
    status.textContent = 'OCRを準備中…（初回は辞書のダウンロードに時間がかかります）';
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    const langs = $('#ocr-vert').checked ? 'jpn_vert+jpn' : 'jpn+eng';
    const worker = await window.Tesseract.createWorker(langs, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') status.textContent = `読み取り中… ${Math.round(m.progress * 100)}%`;
      },
    });
    const { data } = await worker.recognize(source);
    await worker.terminate();
    const lines = [...new Set(data.text.split(/\n+/).map((s) => s.replace(/\s+/g, '')).filter((s) => s.length >= 2))];
    $('#ocr-out').innerHTML = lines.map((l) => `<button type="button" class="chip">${esc(l)}</button>`).join('');
    const brand = lookup.findBrandInText(data.text);
    const filled = applyFields({ ...(brand || {}), ...lookup.parseLabelText(data.text) });
    status.textContent = (filled.length ? `✅ ラベルから入力：${filled.join('・')}。` : '') + (lines.length
      ? '候補をタップすると、最後に選んだ入力欄（初期は銘柄）に入ります。'
      : '文字を検出できませんでした。手入力してください。');
    if (brand || filled.includes('銘柄')) updateAssistLinks();
  } catch (err) {
    console.warn(err);
    status.textContent = err.message || '読み取りに失敗しました';
  } finally {
    btn.disabled = false;
  }
};
$('#ocr-out').onclick = (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const field = state.lastField || $('#f-name');
  field.value = field.value ? field.value + ' ' + chip.textContent : chip.textContent;
  field.focus();
};

// ---------------------------------------------------------------- 自動入力（AIなし：辞書・ルール解析・Wikipedia）
const FIELD_MAP = {
  name: ['#f-name', '銘柄'], brewery: ['#f-brewery', '酒蔵'], category: ['#f-category', 'カテゴリ'],
  type: ['#f-type', '種類'], pref: ['#f-pref', '産地'], rice: ['#f-rice', '原料米'],
  polish: ['#f-polish', '精米歩合'], abv: ['#f-abv', '度数'],
};

/** 空いている欄だけを埋め、埋めた項目名を返す（ユーザーの入力は上書きしない） */
function applyFields(data) {
  const filled = [];
  for (const [key, [sel, label]] of Object.entries(FIELD_MAP)) {
    const v = data[key];
    if (v === undefined || v === null || v === '') continue;
    const el = $(sel);
    const empty = key === 'category' ? !el.dataset.touched && el.value !== String(v) : el.value === '';
    if (!empty) continue;
    el.value = v;
    if (el.value !== String(v)) continue; // 選択肢にない値
    el.classList.add('autofilled');
    filled.push(label);
  }
  return filled;
}

function updateAssistLinks() {
  const name = $('#f-name').value.trim();
  const g = $('#google-link');
  g.href = lookup.googleUrl(name);
  g.classList.toggle('disabled', !name);
  $('#wiki-btn').disabled = !name;
}

function setAssist(msg) {
  $('#assist-status').textContent = msg;
}

$('#f-name').addEventListener('input', updateAssistLinks);
$('#f-name').addEventListener('change', () => {
  const brand = lookup.findBrand($('#f-name').value);
  if (!brand) return;
  const filled = applyFields({ brewery: brand.brewery, pref: brand.pref, category: brand.category, type: brand.type });
  setAssist(filled.length
    ? `📖 内蔵辞書から入力：${filled.join('・')}（参考データです。違っていたら直してください）`
    : `📖 内蔵辞書：${brand.name}（${brand.brewery}・${brand.pref}）`);
});
$('#f-category').addEventListener('change', (e) => (e.target.dataset.touched = '1'));
$('#form').addEventListener('input', (e) => e.target.classList?.remove('autofilled'));

$('#wiki-btn').onclick = async () => {
  const name = $('#f-name').value.trim();
  if (!name) return;
  const out = $('#wiki-out');
  const btn = $('#wiki-btn');
  btn.disabled = true;
  setAssist('🌐 Wikipedia を検索中…');
  out.innerHTML = '';
  try {
    const page = await lookup.searchWikipedia(name, $('#f-category').value);
    if (!page) {
      setAssist('見つかりませんでした。「Googleで検索」も試してください。');
      return;
    }
    const parsed = lookup.parseLabelText(page.extract);
    delete parsed.polish; // 記事の数値は特定の商品のものとは限らない
    delete parsed.abv;
    const found = Object.keys(parsed).map((k) => FIELD_MAP[k]?.[1]).filter(Boolean);
    setAssist('');
    out.innerHTML = `
      <div class="wiki-card">
        <b>${esc(page.title)}</b>
        <p>${esc(page.extract.slice(0, 220))}${page.extract.length > 220 ? '…' : ''}</p>
        <small class="muted">出典：<a href="${esc(page.url)}" target="_blank" rel="noopener">Wikipedia</a>（同名の別の記事の場合があります）</small>
        ${found.length ? `<button type="button" class="btn primary" id="wiki-apply">読み取れた項目を反映（${esc(found.join('・'))}）</button>` : '<small class="muted">自動で反映できる項目はありませんでした</small>'}
      </div>`;
    $('#wiki-apply')?.addEventListener('click', () => {
      const filled = applyFields(parsed);
      setAssist(filled.length ? `🌐 Wikipedia から入力：${filled.join('・')}` : '空いている欄がないため、反映しませんでした');
      out.innerHTML = '';
    });
  } catch (err) {
    console.warn(err);
    setAssist('ネット検索できませんでした（オフライン、または通信が制限された環境です）。「Googleで検索」を使ってください。');
  } finally {
    btn.disabled = !$('#f-name').value.trim();
  }
};

// ---------------------------------------------------------------- detail
function radar(taste = {}, size = 260, cls = '') {
  const n = TASTE_AXES.length, cx = size / 2, cy = size / 2, R = size / 2 - 36;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * (R * v) / 5, cy + Math.sin(a) * (R * v) / 5];
  };
  const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const rings = [1, 2, 3, 4, 5].map((v) => `<polygon class="ring" points="${poly(Array(n).fill(v))}"/>`).join('');
  const axes = TASTE_AXES.map((_, i) => {
    const [x, y] = pt(i, 5);
    return `<line class="axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
  }).join('');
  const labels = TASTE_AXES.map((a, i) => {
    const [x, y] = pt(i, 6.3);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${a.label}</text>`;
  }).join('');
  const vals = TASTE_AXES.map((a) => taste[a.key] ?? 0);
  return `<svg viewBox="0 0 ${size} ${size}" class="radar ${cls}" role="img" aria-label="味わいチャート">
    ${rings}${axes}<polygon class="data" points="${poly(vals)}"/>${labels}</svg>`;
}

function renderDetail() {
  const r = state.records.find((x) => x.id === state.detailId);
  if (state.detailUrl) URL.revokeObjectURL(state.detailUrl);
  state.detailUrl = URL.createObjectURL(r.image);
  const spec = [
    ['カテゴリ', r.category], ['種類', r.type], ['産地', r.pref], ['原料米', r.rice],
    ['精米歩合', r.polish != null ? r.polish + '%' : ''], ['度数', r.abv != null ? r.abv + '%' : ''],
    ['価格', r.price != null ? r.price.toLocaleString() + '円' : ''], ['飲んだ日', r.date], ['場所', r.place],
    ['飲み方', (r.temps || []).join('、')], ['料理', r.pairing],
  ].filter(([, v]) => v);
  $('#detail').innerHTML = `
    <img class="detail-img" src="${state.detailUrl}" alt="${esc(r.name)}のラベル">
    <div class="detail-head">
      <h2>${esc(r.name)}</h2>
      <p class="muted">${esc(r.brewery)}</p>
      <div class="stars big">${stars(r.rating)}</div>
    </div>
    ${radar(r.taste)}
    ${r.notes ? `<blockquote class="notes">${esc(r.notes)}</blockquote>` : ''}
    <dl class="specs">${spec.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="row">
      <button class="btn" data-act="fav">${r.fav ? '♥ お気に入り' : '♡ お気に入り'}</button>
      <button class="btn" data-act="share">📤 シェア</button>
      <button class="btn" data-act="edit">✏️ 編集</button>
      <button class="btn danger" data-act="del">🗑 削除</button>
    </div>`;
}

$('#detail').onclick = async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const r = state.records.find((x) => x.id === state.detailId);
  if (act === 'edit') {
    state.editId = r.id;
    fillForm(r);
    go('form');
  } else if (act === 'fav') {
    r.fav = !r.fav;
    await db.put(r);
    renderDetail();
  } else if (act === 'share') {
    shareRecord(r);
  } else if (act === 'del' && await ask(`「${r.name}」を削除しますか？`, '削除する')) {
    await db.del(r.id);
    await reload();
    toast('削除しました');
    history.replaceState({ view: 'list' }, '', '#list');
    go('list', false);
  }
};

async function shareRecord(r) {
  const text = `${r.name}${r.brewery ? `（${r.brewery}）` : ''} ${stars(r.rating)}\n${r.notes || ''}\n#酒ラベル帳`.trim();
  const file = new File([r.image], `${r.name}.jpg`, { type: 'image/jpeg' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: r.name, text });
    else if (navigator.share) await navigator.share({ title: r.name, text });
    else {
      await navigator.clipboard.writeText(text);
      toast('テキストをコピーしました');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('シェアできませんでした');
  }
}

// ---------------------------------------------------------------- stats
function tasteProfile(rs) {
  const liked = rs.filter((r) => (r.rating || 0) >= 4 && r.taste);
  if (!liked.length) return null;
  const avg = Object.fromEntries(TASTE_AXES.map((a) => [a.key, liked.reduce((s, r) => s + (r.taste[a.key] ?? 3), 0) / liked.length]));
  const top = [...TASTE_AXES].sort((a, b) => avg[b.key] - avg[a.key])[0].key;
  const label = {
    aroma: '🌸 華やか香り派', sweet: '🍑 ふくよか甘口派', acid: '🍋 爽やか酸味派',
    umami: '🍚 旨口じっくり派', dry: '⚔️ 辛口キレ派', body: '🪵 濃醇コク派',
  }[top];
  const spread = Math.max(...Object.values(avg)) - Math.min(...Object.values(avg));
  return { avg, label: spread < 0.8 ? '⚖️ バランス派' : label, n: liked.length };
}

function renderStats() {
  const rs = state.records;
  const prefCounts = {};
  for (const r of rs) if (PREFS.includes(r.pref)) prefCounts[r.pref] = (prefCounts[r.pref] || 0) + 1;
  const visited = Object.keys(prefCounts).length;
  const rated = rs.filter((r) => r.rating);
  const avgRating = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : '—';
  const month = today().slice(0, 7);
  const thisMonth = rs.filter((r) => (r.date || '').startsWith(month)).length;
  const catCounts = CATEGORIES.map((c) => [c, rs.filter((r) => r.category === c).length]).filter(([, n]) => n);
  const maxCat = Math.max(1, ...catCounts.map(([, n]) => n));
  const top = [...rated].sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt).slice(0, 3);
  const profile = tasteProfile(rs);

  $('#stats').innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${rs.length}</b><span>記録した本数</span></div>
      <div class="kpi"><b>${thisMonth}</b><span>今月</span></div>
      <div class="kpi"><b>${avgRating}</b><span>平均評価</span></div>
      <div class="kpi"><b>${visited}<small>/47</small></b><span>都道府県</span></div>
    </div>

    <div class="panel">
      <h3>🎲 今日の一本</h3>
      <p class="muted small">お気に入り・高評価の中からランダムにおすすめします</p>
      <button id="pick" class="btn primary" ${rs.length ? '' : 'disabled'}>おすすめを引く</button>
    </div>

    <div class="panel">
      <h3>あなたの好み</h3>
      ${profile
        ? `<p class="profile">${profile.label}</p>${radar(profile.avg, 240, 'small')}
           <p class="muted small">★4以上の ${profile.n} 本の味わい平均から判定（簡易的な目安です）</p>`
        : '<p class="muted small">★4以上をつけたお酒が増えると、好みの傾向を表示します。</p>'}
    </div>

    <div class="panel">
      <h3>🗾 都道府県めぐり ${visited}/47</h3>
      <div class="prefs">${PREFS.map((p) => `<span class="pref${prefCounts[p] ? ' on' : ''}" title="${p}">${p.replace(/[都府県]$/, '')}${prefCounts[p] ? `<i>${prefCounts[p]}</i>` : ''}</span>`).join('')}</div>
    </div>

    ${catCounts.length ? `<div class="panel"><h3>カテゴリ</h3>
      ${catCounts.map(([c, n]) => `<div class="bar"><span>${c}</span><i style="width:${(n / maxCat) * 100}%"></i><b>${n}</b></div>`).join('')}</div>` : ''}

    ${top.length ? `<div class="panel"><h3>🏆 ベスト3</h3><ol class="best">
      ${top.map((r) => `<li data-id="${esc(r.id)}"><img src="${thumbUrl(r)}" alt=""><span><b>${esc(r.name)}</b><small class="stars">${stars(r.rating)}</small></span></li>`).join('')}</ol></div>` : ''}

    <div class="panel">
      <h3>🏅 バッジ ${earnedBadges(rs).length}/${BADGES.length}</h3>
      <div class="badges">${BADGES.map((b) => `<div class="badge${b.test(rs) ? ' on' : ''}"><span>${b.icon}</span><b>${b.name}</b><small>${b.desc}</small></div>`).join('')}</div>
    </div>`;

  $('#pick')?.addEventListener('click', () => {
    const pool = rs.filter((r) => r.fav || (r.rating || 0) >= 4);
    const list = pool.length ? pool : rs;
    state.detailId = list[Math.floor(Math.random() * list.length)].id;
    go('detail');
  });
  $$('.best li').forEach((li) => (li.onclick = () => {
    state.detailId = li.dataset.id;
    go('detail');
  }));

  navigator.storage?.estimate?.().then(({ usage, quota }) => {
    $('#storage').textContent = `使用量 ${(usage / 1048576).toFixed(1)}MB / 上限の目安 ${(quota / 1048576).toFixed(0)}MB。データはこの端末のブラウザ内に保存されます。機種変更やブラウザのデータ削除に備えて、ときどきバックアップしてください。`;
  });
}

// ---------------------------------------------------------------- backup
const blobToDataUrl = (b) => new Promise((resolve) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.readAsDataURL(b);
});

$('#export').onclick = async () => {
  busy(true, 'バックアップを作成中…');
  try {
    const out = [];
    for (const r of state.records) out.push({ ...r, image: await blobToDataUrl(r.image), thumb: r.thumb ? await blobToDataUrl(r.thumb) : null });
    const blob = new Blob([JSON.stringify({ app: 'sake-label-book', version: 1, records: out })], { type: 'application/json' });
    const filename = `sake-label-book-${today()}.json`;
    // claude.ai の Artifact 上ではページから直接ダウンロードできないため downloads 機能を使う
    const downloads = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (downloads) {
      await downloads.save({ filename, data: blob }).catch((err) => {
        if (err?.code !== 'declined') toast('保存できませんでした');
      });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } finally {
    busy(false);
  }
};

$('#import').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  busy(true, '復元中…');
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.records)) throw new Error('形式が違います');
    for (const r of data.records) {
      r.image = await (await fetch(r.image)).blob();
      r.thumb = r.thumb ? await (await fetch(r.thumb)).blob() : null;
      await db.put(r);
    }
    await reload();
    renderStats();
    toast(`${data.records.length} 件を復元しました`);
  } catch (err) {
    toast('復元に失敗しました：' + err.message);
  } finally {
    busy(false);
  }
};

// ---------------------------------------------------------------- init
(async function init() {
  buildForm();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await reload();
  history.replaceState({ view: 'list' }, '', '#list');
  go('list', false);
})();
