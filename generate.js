// generate.js — заполняет шаблон КП и запускает генерацию PDF + DOCX
/* global generateDocx */

const sessionKey = new URLSearchParams(location.search).get('session');

// ─── Утилиты ─────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '—';
}
function html(id, markup) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = markup;
}

// ─── Заголовки на каждой странице ────────────────────────────────
function injectHeaders() {
  const tpl = document.getElementById('tpl-head');
  document.querySelectorAll('.page').forEach(page => {
    const h = tpl.content.cloneNode(true);
    page.insertBefore(h, page.firstChild);
  });
}

// ─── Заполнение страниц ───────────────────────────────────────────
function fillPage1(data) {
  set('p1-eyebrow', 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ — ' + (data.product_short || data.product_name || ''));
  if (data.client_name) {
    set('p1-client-name', data.client_name);
    document.getElementById('p1-client-block').style.display = 'block';
  }
  set('p1-date', data.date || new Date().toLocaleDateString('ru-RU'));
  set('p1-manager-name', data.manager_name);
  set('p1-manager-email', data.manager_email);
}

function fillPage2(data) {
  set('p2-product-name', data.product_name);

  // Главное фото
  if (data.images && data.images[0]) {
    html('p2-main-image', `<img src="${data.images[0]}" alt="${esc(data.product_name)}" crossorigin="anonymous">`);
  }

  // QR-код: видео приоритетнее, иначе — карточка товара
  const qrTarget = data.video_url || data.product_url;
  const qrCaption = data.video_url
    ? 'Отсканируйте QR-код на мобильном устройстве, чтобы посмотреть подробное видео'
    : 'Отсканируйте QR-код на мобильном устройстве, чтобы перейти на сайт';
  if (qrTarget) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrTarget)}&color=15171a&bgcolor=ffffff`;
    html('p2-qr', `<img src="${qrUrl}" alt="QR" width="88" height="88" crossorigin="anonymous">`);
    set('p2-product-url', qrCaption);
  }

  // Преимущества
  const benefits = (data.benefits || []).slice(0, 4);
  const icons = ['★', '⚡', '✓', '◆'];
  const benefitsHtml = benefits.map((b, i) => `
    <div class="bn-it">
      <span class="ic">${icons[i] || (i + 1)}</span>
      <div>
        <div class="ttl">${esc(b.title)}</div>
        <div class="desc">${esc(b.desc)}</div>
      </div>
    </div>
  `).join('');
  html('p2-benefits', benefitsHtml);
}

const GALLERY_CONFIGS = {
  1: { cols: '1fr',              rows: '1fr',              areas: '"a"',                                               slots: ['ga'] },
  2: { cols: '1fr 1fr',          rows: '1fr',              areas: '"a b"',                                             slots: ['ga', 'gb'] },
  3: { cols: 'repeat(3,1fr)',    rows: '1fr 1fr',          areas: '"a a b" "a a c"',                                   slots: ['ga', 'gb', 'gc'] },
  4: { cols: 'repeat(2,1fr)',    rows: '1fr 1fr',          areas: '"a b" "c d"',                                       slots: ['ga', 'gb', 'gc', 'gd'] },
  5: { cols: 'repeat(6,1fr)',    rows: 'repeat(4,1fr)',    areas: '"a a a a b b" "a a a a b b" "a a a a c c" "d d e e e e"', slots: ['ga', 'gb', 'gc', 'gd', 'ge'] }
};

function applyGalleryGrid(galleryEl, images, offset) {
  const count = images.length;
  if (!count) { galleryEl.innerHTML = ''; return; }
  const cfg = GALLERY_CONFIGS[count] || GALLERY_CONFIGS[5];
  galleryEl.style.gridTemplateColumns = cfg.cols;
  galleryEl.style.gridTemplateRows    = cfg.rows;
  galleryEl.style.gridTemplateAreas   = cfg.areas;
  galleryEl.innerHTML = images.map((src, i) => `
    <div class="g-img ${cfg.slots[i]}">
      <img src="${src}" alt="Фото ${offset + i + 1}" crossorigin="anonymous">
    </div>
  `).join('');
}

function fillPage3(data) {
  set('p3-product-name', data.product_name);
  const allImages = data.images || [];
  const galleryEl = document.getElementById('p3-gallery');

  if (!allImages.length) {
    galleryEl.innerHTML = '';
    return;
  }

  // Первые 5 — на страницу 3
  applyGalleryGrid(galleryEl, allImages.slice(0, 5), 0);

  // Если изображений больше 5 — все остальные на одну доп. страницу
  const extra = allImages.slice(5);
  if (!extra.length) return;

  const cols = extra.length <= 6 ? 3 : extra.length <= 8 ? 4 : extra.length <= 9 ? 3 : extra.length <= 12 ? 4 : 5;
  const rows = Math.ceil(extra.length / cols);

  const tpl   = document.getElementById('tpl-head');
  const page4 = document.getElementById('page-4');

  const extraPage = document.createElement('section');
  extraPage.className = 'page';
  extraPage.appendChild(tpl.content.cloneNode(true));

  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = `
    <div class="section-head">
      <div class="small">Дополнительные изображения (продолжение)</div>
      <div class="big">${esc(data.product_name)}</div>
    </div>
  `;

  const extraGallery = document.createElement('div');
  extraGallery.className = 'gallery';
  extraGallery.style.gridTemplateAreas   = 'none';
  extraGallery.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  extraGallery.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;
  extraGallery.innerHTML = extra.map((src, i) => `
    <div class="g-img">
      <img src="${src}" alt="Фото ${6 + i}" crossorigin="anonymous">
    </div>
  `).join('');

  body.appendChild(extraGallery);
  extraPage.appendChild(body);
  page4.before(extraPage);
}

function buildSpecsHtml(specs) {
  return specs.map(group => `
    <div class="spec-group">
      <div class="h">${esc(group.group)}</div>
      <div class="spec-table">
        ${(group.items || []).map(item => `
          <div class="spec-row">
            <span class="k">${esc(item.key)}</span>
            <span class="v">${esc(item.value)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function fillPage4(data) {
  set('p4-product-name', data.product_name);
  const specs = data.specs || [];

  if (!specs.length) {
    html('p4-specs', '<div style="color:#aaa;padding:10mm 0;text-align:center;">Характеристики уточняются</div>');
    return;
  }

  html('p4-specs', buildSpecsHtml(specs));
  await new Promise(r => setTimeout(r, 60));

  const bodyEl = document.querySelector('#page-4 .body');
  const specsEl = document.getElementById('p4-specs');

  if (specsEl.getBoundingClientRect().bottom <= bodyEl.getBoundingClientRect().bottom) return;

  // Характеристики не влезают — найти точку разрыва по группам
  const bodyBottom = bodyEl.getBoundingClientRect().bottom;
  const groupEls = [...specsEl.querySelectorAll('.spec-group')];
  let cutIdx = groupEls.findIndex(g => g.getBoundingClientRect().bottom > bodyBottom);
  if (cutIdx <= 0) cutIdx = 1;

  html('p4-specs', buildSpecsHtml(specs.slice(0, cutIdx)));

  // Создать дополнительные страницы для оставшихся групп
  let remaining = specs.slice(cutIdx);
  let extraNum = 1;
  const tpl = document.getElementById('tpl-head');

  while (remaining.length > 0) {
    const extraPage = document.createElement('section');
    extraPage.className = 'page';
    extraPage.appendChild(tpl.content.cloneNode(true));
    extraPage.insertAdjacentHTML('beforeend', `
      <div class="body">
        <div class="section-head">
          <div class="small">Технические характеристики (продолжение)</div>
          <div class="big">${esc(data.product_name)}</div>
        </div>
        <div class="specs" id="specs-extra-${extraNum}">${buildSpecsHtml(remaining)}</div>
      </div>
    `);
    document.getElementById('page-5').before(extraPage);

    await new Promise(r => setTimeout(r, 60));

    const extraBody = extraPage.querySelector('.body');
    const extraSpecs = document.getElementById(`specs-extra-${extraNum}`);
    const extraBottom = extraBody.getBoundingClientRect().bottom;

    if (extraSpecs.getBoundingClientRect().bottom <= extraBottom) break;

    const extraGroups = [...extraSpecs.querySelectorAll('.spec-group')];
    let extraCut = extraGroups.findIndex(g => g.getBoundingClientRect().bottom > extraBottom);
    if (extraCut <= 0) extraCut = 1;

    extraSpecs.innerHTML = buildSpecsHtml(remaining.slice(0, extraCut));
    remaining = remaining.slice(extraCut);
    extraNum++;
  }
}

function fillPage5(data) {
  set('p5-product-name', data.product_name);

  const priceStr = data.price ? fmt(data.price) : 'По запросу';
  set('p5-price',   priceStr);
  set('p5-price-2', priceStr);

  // Форма оплаты
  const pf = data.payment_form || 'nds22';
  const pfLabels = {
    cash:  'Наличный расчет',
    usn:   'Безналичный расчет (УСН)',
    nds5:  'Безналичный расчет НДС 5%',
    nds22: 'Безналичный расчет НДС 22%'
  };
  const pfLabel = pfLabels[pf] || pfLabels.nds22;
  set('p5-payment-form', pfLabel);

  const priceRowLabels = {
    cash:  'Стоимость товара (Наличный расчет)',
    usn:   'Стоимость товара (Безналичный расчет, УСН)',
    nds5:  'Стоимость товара (включая НДС 5%)',
    nds22: 'Стоимость товара (включая НДС 22%)'
  };
  set('p5-price-label', priceRowLabels[pf] || priceRowLabels.nds22);

  // НДС
  const vatRow = document.getElementById('p5-vat-row');
  if (data.price && (pf === 'nds5' || pf === 'nds22')) {
    const vatRate = pf === 'nds5' ? 5 : 22;
    set('p5-vat-label', `в т.ч. НДС ${vatRate}%`);
    set('p5-vat', fmt(Math.round(data.price * vatRate / (100 + vatRate))) + ' ₽');
    if (vatRow) vatRow.style.display = '';
  } else {
    if (vatRow) vatRow.style.display = 'none';
  }

  // Условия поставки
  const deliveryTerms = data.delivery_terms || 'Оборудование полностью проверено и готово к эксплуатации';
  set('p5-delivery-terms', deliveryTerms);

  // Доп. товары, услуги, доставка
  const extraGoods    = data.extra_goods    || [];
  const extraServices = data.extra_services || [];
  const deliveryPrice = data.delivery_price || 0;

  const extraRowsHtml = [
    ...extraGoods.map(i => `<div class="row"><span class="k">${esc(i.name)}</span><span class="v">${i.price ? fmt(i.price) + ' ₽' : 'По запросу'}</span></div>`),
    ...extraServices.map(i => `<div class="row"><span class="k">${esc(i.name)}</span><span class="v">${i.price ? fmt(i.price) + ' ₽' : 'По запросу'}</span></div>`),
    deliveryPrice > 0 ? `<div class="row"><span class="k">Доставка</span><span class="v">${fmt(deliveryPrice)} ₽</span></div>` : ''
  ].filter(Boolean).join('');
  html('p5-extra-rows', extraRowsHtml);

  // Итого
  const extraTotal = extraGoods.reduce((s, i) => s + (i.price || 0), 0)
    + extraServices.reduce((s, i) => s + (i.price || 0), 0)
    + deliveryPrice;
  const total = (data.price || 0) + extraTotal;
  set('p5-total', total ? fmt(total) : 'По запросу');

  set('p5-email',   data.manager_email);
  set('p5-manager', data.manager_name);

  // Опции (если есть в данных)
  const optionsEl = document.getElementById('p5-options');
  if (data.options && data.options.length) {
    optionsEl.innerHTML = `
      <div class="opt-h"><span>Дополнительные опции</span><span>Отметьте необходимое</span></div>
      ${data.options.map(o => `
        <div class="opt-row">
          <span class="box" aria-hidden="true"></span>
          <span class="name">${esc(o.name)}</span>
          <span class="price">${o.price ? '+' + fmt(o.price) + ' ₽' : 'По запросу'}</span>
        </div>
      `).join('')}
    `;
  } else {
    optionsEl.style.display = 'none';
  }
}

function fillPage6(data) {
  set('p6-email',   data.manager_email);
  set('p6-manager', data.manager_name);

  const months = data.warranty_months || 12;
  const hours  = data.warranty_hours  || 1000;
  document.getElementById('p6-warranty-months').innerHTML = `${months}<small> мес</small>`;
  document.getElementById('p6-warranty-hours').textContent = `или ${fmt(hours)} моточасов`;
}

// ─── Ждать загрузки изображений ──────────────────────────────────
function waitForImages() {
  return new Promise(resolve => {
    const imgs = [...document.querySelectorAll('img')];
    if (!imgs.length) return resolve();
    let pending = imgs.length;
    const done = () => { if (--pending <= 0) resolve(); };
    imgs.forEach(img => {
      if (img.complete) done();
      else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
    setTimeout(resolve, 10000); // страховочный таймаут
  });
}

// ─── HTML escape ─────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Скачать DOCX ─────────────────────────────────────────────────
async function downloadDocx(data) {
  const docxBlob = await generateDocx(data);
  const url = URL.createObjectURL(docxBlob);
  const a = document.createElement('a');
  a.href = url;
  const docxClientPart = data.client_name ? `_${sanitizeFilename(data.client_name)}` : '';
  a.download = `КП_${sanitizeFilename(data.product_short || data.product_name)}${docxClientPart}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function sanitizeFilename(str) {
  return (str || 'Товар').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

// ─── Главная функция ──────────────────────────────────────────────
async function main() {
  if (!sessionKey) { document.body.innerHTML = '<p>Ошибка: нет ключа сессии</p>'; return; }

  const storage = await chrome.storage.local.get(sessionKey);
  const data = storage[sessionKey];
  if (!data) { document.body.innerHTML = '<p>Ошибка: данные не найдены</p>'; return; }

  // Очистить сессионные данные
  chrome.storage.local.remove(sessionKey);

  // Заполнить шаблон
  injectHeaders();
  fillPage1(data);
  fillPage2(data);
  fillPage3(data);
  await fillPage4(data);  // async — может создавать дополнительные страницы
  fillPage5(data);
  fillPage6(data);

  // Ждать загрузки шрифтов и изображений
  await document.fonts.ready;
  await waitForImages();
  // Дополнительная пауза для корректного рендера
  await new Promise(r => setTimeout(r, 800));

  // Сигнал фоновому скрипту: готов к PDF
  const clientPart = data.client_name ? `_${sanitizeFilename(data.client_name)}` : '';
  const filename = `КП_${sanitizeFilename(data.product_short || data.product_name)}${clientPart}`;
  // Показать тулбар сразу, не ожидая ответа
  showEditToolbar(filename);
  document.getElementById('toolbar-status').textContent = 'Генерирую PDF…';

  chrome.runtime.sendMessage({ type: 'READY_FOR_PDF', filename }, resp => {
    const err = chrome.runtime.lastError?.message || resp?.error;
    if (err) console.error('[PDF] ошибка:', err);
    document.getElementById('toolbar-status').textContent =
      resp?.ok ? '✓ PDF сохранён' : `✗ ${err || 'Ошибка генерации PDF'}`;
  });
}

main();

// ─── Вариант B: панель редактирования ────────────────────────────
let _editFilename = '';
let _isEditing = false;

const EDITABLES = [
  '.spec-row .k', '.spec-row .v',
  '.bn-it .ttl', '.bn-it .desc',
  '#p2-product-name', '#p3-product-name', '#p4-product-name', '#p5-product-name',
  '.lede', '#p5-price', '#p5-price-2', '#p5-total', '#p5-vat',
  '#p5-delivery-terms', '#p5-payment-form', '#p5-price-label', '#p5-vat-label',
  '.price-vat .row .v',
  '#p6-warranty-months', '#p6-warranty-hours',
  '#p1-eyebrow', '#p1-client-name', '#p1-date',
  '#p1-manager-name', '#p1-manager-email',
  '#p5-email', '#p5-manager', '#p6-email', '#p6-manager'
].join(',');

function showEditToolbar(filename) {
  _editFilename = filename;
  document.getElementById('edit-toolbar').classList.add('active');
  document.querySelector('.stack').style.paddingTop = '50px';
}

function setEditMode(on) {
  _isEditing = on;
  document.querySelectorAll(EDITABLES).forEach(el => {
    el.contentEditable = on ? 'true' : 'false';
  });
  document.body.classList.toggle('editing-mode', on);
  document.getElementById('btn-edit-mode').textContent = on ? '✓ Готово' : '✎ Редактировать';
}

document.getElementById('btn-edit-mode').addEventListener('click', () => {
  setEditMode(!_isEditing);
});

document.getElementById('btn-save-pdf').addEventListener('click', () => {
  if (_isEditing) setEditMode(false);
  const btn = document.getElementById('btn-save-pdf');
  btn.disabled = true;
  btn.textContent = 'Генерирую…';
  chrome.runtime.sendMessage({ type: 'REGENERATE_PDF', filename: _editFilename }, resp => {
    btn.disabled = false;
    btn.textContent = '↓ Сохранить PDF';
    const err = chrome.runtime.lastError?.message || resp?.error;
    if (err) console.error('[PDF] ошибка:', err);
    document.getElementById('toolbar-status').textContent =
      resp?.ok ? '✓ PDF обновлён' : `✗ ${err || 'Ошибка'}`;
  });
});

document.getElementById('btn-close-tab').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
});
