// options.js

const $ = id => document.getElementById(id);
let editingId = null;

// ─── Менеджеры ───────────────────────────────────────────────────
async function loadManagers() {
  const { managers = [] } = await chrome.storage.sync.get('managers');
  renderManagers(managers);
}

function renderManagers(managers) {
  const list = $('managers-list');
  if (!managers.length) {
    list.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:10px 0;">Менеджеры не добавлены</div>';
    return;
  }
  list.innerHTML = managers.map(m => `
    <div class="manager-item" data-id="${m.id}">
      <div class="info">
        <div class="name">${escHtml(m.name)}</div>
        <div class="email">${escHtml(m.email)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${m.id}">Изменить</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${m.id}">✕</button>
      </div>
    </div>
  `).join('');
}

$('managers-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const { managers = [] } = await chrome.storage.sync.get('managers');

  if (action === 'delete') {
    const updated = managers.filter(m => m.id !== id);
    await chrome.storage.sync.set({ managers: updated });
    renderManagers(updated);
  }

  if (action === 'edit') {
    const m = managers.find(m => m.id === id);
    if (!m) return;
    editingId = id;
    $('mgr-name').value = m.name;
    $('mgr-email').value = m.email;
    $('add-form').classList.add('visible');
    $('btn-save-manager').textContent = 'Сохранить';
  }
});

$('btn-add-manager').addEventListener('click', () => {
  editingId = null;
  $('mgr-name').value = '';
  $('mgr-email').value = '';
  $('btn-save-manager').textContent = 'Добавить';
  $('add-form').classList.add('visible');
  $('mgr-name').focus();
});

$('btn-cancel-manager').addEventListener('click', () => {
  $('add-form').classList.remove('visible');
  editingId = null;
});

$('btn-save-manager').addEventListener('click', async () => {
  const name = $('mgr-name').value.trim();
  const email = $('mgr-email').value.trim();
  if (!name || !email) { alert('Заполните имя и email'); return; }

  const { managers = [] } = await chrome.storage.sync.get('managers');

  if (editingId) {
    const idx = managers.findIndex(m => m.id === editingId);
    if (idx !== -1) { managers[idx].name = name; managers[idx].email = email; }
  } else {
    managers.push({ id: Date.now().toString(), name, email });
  }

  await chrome.storage.sync.set({ managers });
  renderManagers(managers);
  $('add-form').classList.remove('visible');
  editingId = null;
});

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Обновление расширения (Native Messaging) ────────────────────
const NATIVE_HOST = 'com.arbq.kp_updater';

function setUpdateStatus(state, text) {
  const el = $('update-status');
  el.className = 'update-status' + (state ? ' ' + state : '');
  $('update-status-text').textContent = text;
}

$('btn-update').addEventListener('click', async () => {
  $('btn-update').disabled = true;
  $('btn-update-log-toggle').style.display = 'none';
  $('update-log').classList.remove('visible');
  setUpdateStatus('busy', 'Подключаюсь к компоненту обновления…');

  let port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    setUpdateStatus('err', 'Компонент обновления не установлен. Запустите install.command');
    $('btn-update').disabled = false;
    return;
  }

  port.onMessage.addListener(resp => {
    port.disconnect();
    $('btn-update').disabled = false;
    if (resp.ok) {
      const alreadyLatest = (resp.output || '').includes('Already up to date') ||
                            (resp.output || '').includes('already up-to-date');
      if (alreadyLatest) {
        setUpdateStatus('ok', 'У вас уже последняя версия расширения');
      } else {
        setUpdateStatus('ok', '✓ Обновление установлено! Нажмите ↻ на chrome://extensions');
      }
    } else {
      setUpdateStatus('err', 'Ошибка обновления. Запустите update.command вручную');
    }
    if (resp.output) {
      $('update-log').textContent = resp.output;
      $('btn-update-log-toggle').style.display = 'inline-block';
    }
  });

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      setUpdateStatus('err', 'Компонент не установлен. Запустите install.command');
      $('btn-update').disabled = false;
    }
  });

  setUpdateStatus('busy', 'Проверяю обновления…');
  port.postMessage({ action: 'update' });
});

$('btn-update-log-toggle').addEventListener('click', () => {
  $('update-log').classList.toggle('visible');
});

// ─── Инициализация ───────────────────────────────────────────────
loadManagers();
