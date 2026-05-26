// popup.js

let scrapedData = null;

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
async function loadManagers() {
  const { managers = [] } = await chrome.storage.sync.get('managers');
  const sel = $('manager-select');
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

      scrapedData = response.scraped;
      fillForm(scrapedData);
    }
  );
}

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

  if (!data.price) {
    $('price-field').classList.add('visible');
  }

  loadManagers().then(() => {
    showState('form');
    updateGenerateBtn();
  });
}

function updateGenerateBtn() {
  const managerOk = $('manager-select').value !== '';
  const priceOk = !$('price-field').classList.contains('visible') ||
                  $('price-input').value.trim() !== '';
  $('btn-generate').disabled = !(managerOk && priceOk);
}

$('manager-select').addEventListener('change', updateGenerateBtn);
$('price-input').addEventListener('input', updateGenerateBtn);

// ─── Генерация КП ────────────────────────────────────────────────
$('btn-generate').addEventListener('click', async () => {
  const managerId = $('manager-select').value;
  if (!managerId) return;

  const { managers = [] } = await chrome.storage.sync.get('managers');
  const manager = managers.find(m => m.id === managerId);
  if (!manager) return;

  const price = $('price-field').classList.contains('visible')
    ? (parseFloat($('price-input').value) || null)
    : null;

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
      extra_services:  extraServices
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
