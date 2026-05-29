// generate-pricelist.js — заполняет прайс-лист и запускает PDF + DOCX
/* global downloadPricelistDocx */

const sessionKey = new URLSearchParams(location.search).get('session');
const ROWS_PER_PAGE = 6;

// ─── Утилиты ─────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '—';
}

function sanitizeFilename(str) {
  return (str || 'Прайс').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

const PF_LABELS = {
  cash:  'Наличный расчет',
  usn:   'Безналичный расчет (УСН)',
  nds5:  'Безналичный расчет НДС 5%',
  nds22: 'Безналичный расчет НДС 22%'
};

function pfLabel(pf) {
  return PF_LABELS[pf] || PF_LABELS.nds22;
}

// ─── Вставить заголовок в каждую страницу ────────────────────────
function injectHeaders() {
  const tpl = document.getElementById('tpl-head');
  document.querySelectorAll('.page').forEach(page => {
    const h = tpl.content.cloneNode(true);
    page.insertBefore(h, page.firstChild);
  });
}

// ─── Заполнить обложку ────────────────────────────────────────────
function fillCover(data) {
  const title = data.catalog_title ? `ПРАЙС-ЛИСТ · ${data.catalog_title}` : 'ПРАЙС-ЛИСТ';
  set('p1-eyebrow', title);
  if (data.client_name) {
    set('p1-client-name', data.client_name);
    document.getElementById('p1-client-block').style.display = 'block';
  }
  set('p1-date', data.date || new Date().toLocaleDateString('ru-RU'));
  set('p1-manager-name', data.manager_name);
  set('p1-manager-email', data.manager_email);
}

function qrUrl(url) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=60x60&margin=2&data=' + encodeURIComponent(url);
}

// ─── Pre-fetch QR кодов как data URI (не более 10 параллельно) ───
async function fetchQRCodes(items) {
  const map = new Map();
  const urls = items.filter(item => item.url).map(item => item.url);
  const CHUNK = 10;
  for (let i = 0; i < urls.length; i += CHUNK) {
    await Promise.all(
      urls.slice(i, i + CHUNK).map(async url => {
        try {
          const resp = await fetch(qrUrl(url), { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) return;
          const blob = await resp.blob();
          const dataUri = await new Promise(res => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.readAsDataURL(blob);
          });
          map.set(url, dataUri);
        } catch { /* продолжаем без QR */ }
      })
    );
  }
  return map;
}

// ─── Страницы с таблицей товаров ─────────────────────────────────
function buildProductPages(data, qrMap) {
  const items = data.items || [];
  const pf = data.payment_form || 'nds22';
  const pfText = pfLabel(pf);
  const chunks = [];
  for (let i = 0; i < items.length; i += ROWS_PER_PAGE) {
    chunks.push(items.slice(i, i + ROWS_PER_PAGE));
  }

  const stack = document.querySelector('.stack');
  const tplHead = document.getElementById('tpl-head');
  const contactsHtml = `
    <div class="pl-contacts-bar">
      <div class="cc"><div class="ck">Телефон</div><div class="cv">8 800 600 6649</div></div>
      <div class="cc"><div class="ck">E-mail</div><div class="cv">${esc(data.manager_email || 'info@arbq.ru')}</div></div>
      <div class="cc"><div class="ck">Сайт</div><div class="cv">arbq.ru</div></div>
      <div class="cc"><div class="ck">Менеджер</div><div class="cv">${esc(data.manager_name || '—')}</div></div>
    </div>`;

  chunks.forEach((chunk, ci) => {
    const page = document.createElement('section');
    page.className = 'page';
    page.appendChild(tplHead.content.cloneNode(true));

    const rows = chunk.map((item, i) => `
      <tr class="pl-tr">
        <td class="pl-td pl-num">${ci * ROWS_PER_PAGE + i + 1}</td>
        <td class="pl-td pl-img-cell">
          ${item.image ? `<img class="pl-img" src="${esc(item.image)}" alt="" crossorigin="anonymous">` : ''}
        </td>
        <td class="pl-td">
          <div class="pl-name">${esc(item.title)}</div>
        </td>
        <td class="pl-td pl-qr-cell">
          ${item.url ? `<img class="pl-qr-img" src="${(qrMap && qrMap.get(item.url)) || qrUrl(item.url)}" alt="QR">` : ''}
        </td>
        <td class="pl-td pl-price">
          ${item.price ? fmt(item.price) + '&nbsp;₽' : 'По запросу'}
        </td>
      </tr>
    `).join('');

    page.insertAdjacentHTML('beforeend', `
      <div class="body">
        <div class="section-head">
          <div class="small">Прайс-лист${data.catalog_title ? ' · ' + esc(data.catalog_title) : ''} · ${ci === 0 ? items.length + ' позиций' : 'продолжение'}</div>
          <div class="big">${data.catalog_title ? esc(data.catalog_title).toUpperCase() : 'КАТАЛОГ ТОВАРОВ'}</div>
        </div>
        <table class="pl-table" style="margin-top:4mm;">
          <thead>
            <tr>
              <th class="pl-th" style="width:8mm;">№</th>
              <th class="pl-th" style="width:28mm;">Фото</th>
              <th class="pl-th">Наименование</th>
              <th class="pl-th" style="width:22mm;">QR</th>
              <th class="pl-th" style="width:28mm;text-align:right;">Цена</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="pl-footer-row">
              <td colspan="5">Стоимость указана за ${esc(pfText)}</td>
            </tr>
          </tfoot>
        </table>
        ${contactsHtml}
      </div>
    `);

    stack.appendChild(page);
  });
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
    setTimeout(resolve, 8000);
  });
}

// ─── Тулбар ──────────────────────────────────────────────────────
let _plFilename = '';

function showEditToolbar(filename) {
  _plFilename = filename;
  document.getElementById('edit-toolbar').classList.add('active');
  document.querySelector('.stack').style.paddingTop = '50px';
}

// ─── Режим редактирования ────────────────────────────────────────
const EDIT_TARGETS = [
  '.pl-name',
  '.pl-price',
  '.section-head .small',
  '.section-head .big',
  '#p1-eyebrow',
  '#p1-client-name',
  '#p1-date',
  '#p1-manager-name',
  '#p1-manager-email',
  '.lede',
  '.p1-stamp'
].join(', ');

let _editMode = false;

document.getElementById('btn-edit-mode').addEventListener('click', () => {
  _editMode = !_editMode;
  const btn = document.getElementById('btn-edit-mode');
  document.body.classList.toggle('edit-mode', _editMode);
  document.querySelectorAll(EDIT_TARGETS).forEach(el => {
    el.contentEditable = _editMode ? 'true' : 'inherit';
  });
  btn.textContent = _editMode ? '✓ Готово' : '✎ Редактировать';
  btn.classList.toggle('active', _editMode);
  document.getElementById('toolbar-status').textContent = _editMode
    ? 'Режим редактирования — кликните на текст'
    : 'Готово к сохранению';
});

document.getElementById('btn-save-pdf').addEventListener('click', () => {
  // Выйти из режима редактирования перед печатью
  if (_editMode) document.getElementById('btn-edit-mode').click();

  const btn = document.getElementById('btn-save-pdf');
  const statusEl = document.getElementById('toolbar-status');
  btn.disabled = true;
  btn.textContent = 'Генерирую…';
  statusEl.textContent = 'Генерирую PDF…';
  chrome.runtime.sendMessage({ type: 'REGENERATE_PDF', filename: _plFilename }, resp => {
    btn.disabled = false;
    btn.textContent = '↓ Сохранить PDF';
    const err = chrome.runtime.lastError?.message || resp?.error;
    if (err) console.error('[PDF] ошибка:', err);
    statusEl.textContent = resp?.ok ? '✓ PDF сохранён' : `✗ ${err || 'Ошибка'}`;
  });
});

document.getElementById('btn-close-tab').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
});

// ─── Главная функция ──────────────────────────────────────────────
async function main() {
  if (!sessionKey) { document.body.innerHTML = '<p>Ошибка: нет ключа сессии</p>'; return; }

  const storage = await chrome.storage.local.get(sessionKey);
  const data = storage[sessionKey];
  if (!data) { document.body.innerHTML = '<p>Ошибка: данные не найдены</p>'; return; }

  chrome.storage.local.remove(sessionKey);

  injectHeaders();
  fillCover(data);
  const qrMap = await fetchQRCodes(data.items || []);
  buildProductPages(data, qrMap);

  await document.fonts.ready;
  await waitForImages();
  await new Promise(r => setTimeout(r, 800));

  const catalogPart = sanitizeFilename(data.catalog_title || (data.items?.[0]?.title) || 'каталог');
  const clientPart = data.client_name ? ` для ${sanitizeFilename(data.client_name)}` : '';
  const filename = `Прайс-лист ${catalogPart}${clientPart}`;

  showEditToolbar(filename);
  document.getElementById('toolbar-status').textContent = 'Готово — нажмите «Сохранить PDF»';
}

main();
