// popup.js

let scrapedData = null;
let catalogItems = [];
let catalogNextUrl = null;
let catalogPageNum = 1;
let catalogTitle = '';

const $ = id => document.getElementById(id);

function showState(name) {
  document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
  $('state-' + name).classList.add('active');
}

function showError(msg) {
  $('error-text').textContent = msg;
  showState('error');
}

function setStep(n) {
  for (let i = 1; i <= 5; i++) {
    const el = $('step-' + i);
    el.className = 'step' + (i < n ? ' done' : i === n ? ' active' : '');
  }
}

// ─── Вариант D: редактирование скрапленных данных ────────────────
function specsToText(specs) {
  return (specs || []).map(g =>
    `= ${g.group} =\n` + (g.items || []).map(i => `${i.key}: ${i.value}`).join('\n')
  ).join('\n\n');
}

function parseSpecsText(text) {
  const groups = [];
  let cur = { group: 'Характеристики', items: [] };
  text.split('\n').forEach(line => {
    const l = line.trim();
    if (!l) return;
    const grp = l.match(/^=\s*(.+?)\s*=$/);
    if (grp) {
      if (cur.items.length) groups.push(cur);
      cur = { group: grp[1], items: [] };
    } else {
      const idx = l.indexOf(':');
      if (idx > 0) {
        cur.items.push({ key: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() });
      }
    }
  });
  if (cur.items.length) groups.push(cur);
  return groups;
}

// ─── Динамические строки доп. позиций ───────────────────────────
function addExtraRow(listId) {
  const row = document.createElement('div');
  row.className = 'extra-row';
  row.innerHTML =
    '<input class="en" type="text" placeholder="Наименование">' +
    '<input class="ep" type="number" placeholder="₽" min="0">' +
    '<button class="btn-del" title="Удалить">×</button>';
  row.querySelector('.btn-del').addEventListener('click', () => row.remove());
  $(listId).appendChild(row);
}

function getExtraRows(listId) {
  return [...$(listId).querySelectorAll('.extra-row')].map(row => ({
    name:  row.querySelector('.en').value.trim(),
    price: parseFloat(row.querySelector('.ep').value) || 0
  })).filter(r => r.name);
}

$('btn-add-good').addEventListener('click', () => addExtraRow('extra-goods-list'));
$('btn-add-service').addEventListener('click', () => addExtraRow('extra-services-list'));

// ─── Загрузить менеджеров ────────────────────────────────────────
async function loadManagers(selectId) {
  const id = selectId || 'manager-select';
  const { managers = [] } = await chrome.storage.sync.get('managers');
  const sel = $(id);
  if (!sel) return managers;
  sel.innerHTML = '<option value="">— выберите менеджера —</option>';
  managers.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  return managers;
}

// ─── Инициализация — только скрапинг, без AI ────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.startsWith('http')) {
    showState('nopage');
    return;
  }

  showState('loading');

  chrome.runtime.sendMessage(
    { type: 'SCRAPE_PAGE', tabId: tab.id },
    response => {
      if (chrome.runtime.lastError) {
        showError('Ошибка связи с расширением: ' + chrome.runtime.lastError.message);
        return;
      }
      if (response.error) {
        showError(response.error);
        return;
      }

      if (response.pageType === 'catalog') {
        fillCatalogForm(response.items, response.nextPageUrl, response.catalogTitle || '');
      } else {
        scrapedData = response.scraped;
        fillForm(scrapedData);
      }
    }
  );
}

// ─── Каталог: заполнить форму прайс-листа ────────────────────────
function fillCatalogForm(items, nextPageUrl, title) {
  catalogItems = items || [];
  catalogNextUrl = nextPageUrl || null;
  catalogPageNum = 1;
  catalogTitle = title || '';

  $('catalog-title').textContent = `Каталог: найдено ${catalogItems.length} товаров`;

  if (catalogNextUrl) {
    $('catalog-progress').style.display = 'block';
    $('catalog-progress-text').textContent = 'Загружаю страницы каталога…';
    $('catalog-progress-bar').style.width = '15%';
  }

  loadManagers('cat-manager-select').then(() => {
    showState('catalog');
    updateCatalogBtn();
    if (catalogNextUrl) loadNextCatalogPage();
    else finalizeCatalogLoad();
  });
}

function finalizeCatalogLoad() {
  const prog = $('catalog-progress');
  if (prog) prog.style.display = 'none';
  const titleEl = $('catalog-title');
  if (titleEl) titleEl.textContent = `Каталог: ${catalogItems.length} товаров`;
  fillCatalogItemsList(catalogItems);
  updateCatalogBtn();
}

function updateCatalogProgress() {
  const bar = $('catalog-progress-bar');
  const text = $('catalog-progress-text');
  if (bar) bar.style.width = Math.min(92, 15 + catalogPageNum * 10) + '%';
  if (text) text.textContent = `Загружено страниц: ${catalogPageNum}, товаров: ${catalogItems.length}`;
}

function loadNextCatalogPage() {
  if (!catalogNextUrl) {
    finalizeCatalogLoad();
    return;
  }
  const url = catalogNextUrl;
  chrome.runtime.sendMessage({ type: 'SCRAPE_CATALOG_PAGE', url }, response => {
    if (chrome.runtime.lastError || response?.error) {
      finalizeCatalogLoad();
      return;
    }
    catalogItems = catalogItems.concat(response.items || []);
    catalogNextUrl = response.nextPageUrl || null;
    catalogPageNum++;
    updateCatalogProgress();
    loadNextCatalogPage();
  });
}

function getCheckedItems() {
  if (!$('cat-items-list')) return catalogItems;
  const checked = [...$('cat-items-list').querySelectorAll('input[type=checkbox]:checked')];
  return checked.map(cb => catalogItems[parseInt(cb.dataset.idx)]).filter(Boolean);
}

function updateCatalogSelectedCount() {
  const countEl = $('cat-selected-count');
  if (!countEl) return;
  const total = $('cat-items-list') ? $('cat-items-list').querySelectorAll('input[type=checkbox]').length : catalogItems.length;
  const checked = $('cat-items-list') ? $('cat-items-list').querySelectorAll('input[type=checkbox]:checked').length : catalogItems.length;
  countEl.textContent = `${checked} из ${total}`;
}

function updateCatalogBtn() {
  const sel = $('cat-manager-select');
  const btn = $('btn-generate-pricelist');
  if (!btn) return;
  const hasManager = sel && sel.value !== '';
  const hasItems = getCheckedItems().length > 0;
  btn.disabled = !hasManager || !hasItems;
}

function fillCatalogItemsList(items) {
  const section = $('cat-items-section');
  const list = $('cat-items-list');
  if (!section || !list) return;

  list.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid #f5f5f5;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.idx = idx;
    cb.checked = true;
    cb.style.cssText = 'flex-shrink:0;accent-color:#e31e24;cursor:pointer;';
    cb.addEventListener('change', () => { updateCatalogSelectedCount(); updateCatalogBtn(); });

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'flex:1;font-size:12px;line-height:1.4;color:#1a1a1a;';
    titleSpan.textContent = item.title || '—';

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.value = item.price || '';
    priceInput.placeholder = '—';
    priceInput.style.cssText = 'width:68px;font-size:11px;border:1px solid #ddd;border-radius:3px;padding:2px 4px;text-align:right;color:#333;background:#fafafa;flex-shrink:0;';
    priceInput.addEventListener('input', () => {
      const val = parseFloat(priceInput.value);
      catalogItems[idx].price = val > 0 ? val : null;
    });

    const rub = document.createElement('span');
    rub.style.cssText = 'font-size:11px;color:#888;flex-shrink:0;';
    rub.textContent = '₽';

    row.appendChild(cb);
    row.appendChild(titleSpan);
    row.appendChild(priceInput);
    row.appendChild(rub);
    list.appendChild(row);
  });

  section.style.display = 'block';
  updateCatalogSelectedCount();

  const toggleBtn = $('cat-toggle-all');
  if (toggleBtn) {
    toggleBtn.textContent = 'Снять все';
    toggleBtn.onclick = () => {
      const checkboxes = list.querySelectorAll('input[type=checkbox]');
      const allChecked = [...checkboxes].every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      toggleBtn.textContent = allChecked ? 'Выбрать все' : 'Снять все';
      updateCatalogSelectedCount();
      updateCatalogBtn();
    };
  }
}

if ($('cat-manager-select')) {
  $('cat-manager-select').addEventListener('change', updateCatalogBtn);
}

if ($('btn-generate-pricelist')) $('btn-generate-pricelist').addEventListener('click', async () => {
  const managerId = $('cat-manager-select').value;
  if (!managerId) return;

  const { managers = [] } = await chrome.storage.sync.get('managers');
  const manager = managers.find(m => m.id === managerId);
  if (!manager) return;

  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const selectedItems = getCheckedItems();
  if (!selectedItems.length) return;

  const sortVal = $('cat-sort') ? $('cat-sort').value : 'none';
  let sortedItems = [...selectedItems];
  if (sortVal === 'price-asc') {
    sortedItems.sort((a, b) => {
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    });
  } else if (sortVal === 'price-desc') {
    sortedItems.sort((a, b) => {
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return b.price - a.price;
    });
  } else if (sortVal === 'name-asc') {
    sortedItems.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  }

  showState('generating');

  chrome.runtime.sendMessage(
    {
      type:          'GENERATE_PRICELIST',
      items:         sortedItems,
      manager_name:  manager.name,
      manager_email: manager.email,
      date:          dateStr,
      client_name:   $('cat-client-name').value.trim() || null,
      payment_form:  $('cat-payment-form').value,
      catalog_title: catalogTitle || ''
    },
    response => {
      if (chrome.runtime.lastError || response?.error) {
        showError(response?.error || chrome.runtime.lastError?.message);
        return;
      }
      setTimeout(() => window.close(), 3000);
    }
  );
});


function fillForm(data) {
  $('product-name-preview').textContent = data.title || '—';

  // Заполнить поля редактирования (Вариант D)
  $('edit-product-name').value = data.title || '';
  $('edit-specs').value = specsToText(data.specs || []);

  // Обновлять превью при изменении названия
  $('edit-product-name').addEventListener('input', () => {
    const v = $('edit-product-name').value.trim();
    if (v) $('product-name-preview').textContent = v;
  });

  loadManagers().then(() => {
    showState('form');
    updateGenerateBtn();
  });
}

function updateGenerateBtn() {
  $('btn-generate').disabled = $('manager-select').value === '';
}

$('manager-select').addEventListener('change', updateGenerateBtn);

// ─── Генерация КП ────────────────────────────────────────────────
$('btn-generate').addEventListener('click', async () => {
  const managerId = $('manager-select').value;
  if (!managerId) return;

  const { managers = [] } = await chrome.storage.sync.get('managers');
  const manager = managers.find(m => m.id === managerId);
  if (!manager) return;

  const price = parseFloat($('price-input').value) || null;
  const paymentForm   = $('payment-form').value;
  const deliveryTerms = $('delivery-terms').value.trim() || null;

  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const clientName     = $('client-name').value.trim();
  const deliveryPrice  = parseFloat($('delivery-price').value) || 0;
  const warrantyMonths = parseInt($('warranty-months').value) || 12;
  const warrantyHours  = parseInt($('warranty-hours').value)  || 1000;
  const extraGoods     = getExtraRows('extra-goods-list');
  const extraServices  = getExtraRows('extra-services-list');

  // Применить правки из секции "Исправить данные товара" (Вариант D)
  const editedScraped = Object.assign({}, scrapedData);
  const editedName = $('edit-product-name').value.trim();
  if (editedName) editedScraped.title = editedName;
  const editedSpecsText = $('edit-specs').value.trim();
  if (editedSpecsText) editedScraped.specs = parseSpecsText(editedSpecsText);

  showState('generating');
  setStep(1);

  chrome.runtime.sendMessage(
    {
      type: 'GENERATE_KP',
      scraped: editedScraped,
      manager_name:    manager.name,
      manager_email:   manager.email,
      date:            dateStr,
      price,
      client_name:     clientName     || null,
      delivery_price:  deliveryPrice  || null,
      warranty_months: warrantyMonths,
      warranty_hours:  warrantyHours,
      extra_goods:     extraGoods,
      extra_services:  extraServices,
      payment_form:    paymentForm,
      delivery_terms:  deliveryTerms
    },
    response => {
      if (chrome.runtime.lastError || response?.error) {
        showError(response?.error || chrome.runtime.lastError?.message);
        return;
      }
      setStep(2);
      setTimeout(() => setStep(3), 1500);
      setTimeout(() => setStep(4), 3000);
      setTimeout(() => setStep(5), 5000);
      setTimeout(() => window.close(), 8000);
    }
  );
});

// ─── Кнопки ──────────────────────────────────────────────────────
function openOptions() { chrome.runtime.openOptionsPage(); }

$('open-options').addEventListener('click', e => { e.preventDefault(); openOptions(); });
$('open-options-3').addEventListener('click', e => { e.preventDefault(); openOptions(); });

$('btn-retry').addEventListener('click', () => {
  scrapedData = null;
  showState('loading');
  init();
});

$('btn-cancel').addEventListener('click', () => {
  $('btn-cancel').disabled = true;
  $('btn-cancel').textContent = 'Отменяю…';
  chrome.runtime.sendMessage({ type: 'CANCEL' }, () => {
    showError('Отменено. Нажмите «Попробовать снова».');
  });
});

document.addEventListener('click', e => {
  if (e.target.id === 'open-options-2') { e.preventDefault(); openOptions(); }
});

// ─── Старт ───────────────────────────────────────────────────────
init();
