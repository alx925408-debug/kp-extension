// background.js — service worker
// Координирует скрапинг, Ollama API, генерацию PDF

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'qwen2.5:7b';
const SEARCH_URL = 'http://localhost:11435';

let currentController = null; // активный AbortController

// ─── Предзаполнение менеджеров при первой установке ──────────────
const DEFAULT_MANAGERS = [
  { id: '1', name: 'Воронкин Александр', email: 'voronkin@arbq.ru' },
  { id: '2', name: 'Баранов Дмитрий',    email: 'baranov@arbq.ru'  },
  { id: '3', name: 'Шеин Александр',     email: 'sa@arbq.ru'       }
];

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  chrome.storage.sync.get('managers', ({ managers }) => {
    if (!managers || managers.length === 0) {
      chrome.storage.sync.set({ managers: DEFAULT_MANAGERS });
    }
  });
});

// ─── Поиск доп. данных о товаре (опционально) ────────────────────
async function fetchSearchContext(title) {
  try {
    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(9000)
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    return (data.text || '').trim();
  } catch {
    return ''; // search_helper не запущен — продолжаем без поиска
  }
}

// ─── Ollama: сгенерировать описание и преимущества ───────────────
async function generateMarketingCopy(scraped) {
  // Compact specs summary (first group, up to 7 items)
  const specsContext = (() => {
    const group = (scraped.specs || [])[0];
    if (!group || !group.items?.length) return '';
    const lines = group.items.slice(0, 7).map(i => `- ${i.key}: ${i.value}`).join('\n');
    return `\nХарактеристики:\n${lines}`;
  })();

  // Доп. контекст из интернета (если search_helper запущен)
  const searchContext = await fetchSearchContext(scraped.title);
  const searchSection = searchContext
    ? `\nДанные из интернета о товаре:\n${searchContext}`
    : '';

  const prompt = `Ты пишешь маркетинговый текст ИСКЛЮЧИТЕЛЬНО на русском языке. Никаких английских слов, никакого транслита — только русский язык.

Товар: ${scraped.title}
Описание со страницы: ${(scraped.description || '').slice(0, 1000)}${specsContext}${searchSection}

Задача: выбери РОВНО 4 самых сильных преимущества этого товара.
- Изучи всё описание и характеристики выше.
- Если описание короткое или слабое — опирайся на своё знание о данном типе оборудования/товара и выдели реальные конкурентные преимущества.
- Каждое преимущество: конкретный заголовок (3-5 слов) + одно точное предложение с цифрами или фактом.
- Не повторяй одно и то же разными словами.
- Не используй общие фразы вроде «высокое качество» или «надёжность».
- ВСЕ поля — только на русском языке, без единого английского слова.

Верни ТОЛЬКО JSON (без markdown, без пояснений):
{
  "description": "2-3 предложения — продающее описание товара на основе реальных характеристик",
  "benefits": [
    {"title": "заголовок преимущества", "desc": "одно конкретное предложение с фактом или цифрой"},
    {"title": "...", "desc": "..."},
    {"title": "...", "desc": "..."},
    {"title": "...", "desc": "..."}
  ]
}`;

  const controller = new AbortController();
  currentController = controller;
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0.4, num_predict: 600 },
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Отменено');
    throw e;
  } finally {
    clearTimeout(timeout);
    currentController = null;
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const text = (result.message?.content || '').trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, text];
  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    // Fallback: пустые преимущества если модель вернула невалидный JSON
    return { description: '', benefits: [] };
  }
}

// ─── Собрать данные КП из скрапинга + Ollama ─────────────────────
async function extractProductData(scraped) {
  const copy = await generateMarketingCopy(scraped);

  // product_short: слова до года (2020+), включая модельный код вида DH-50
  const words = (scraped.title || '').split(/\s+/);
  const shortWords = [];
  for (const w of words.slice(0, 7)) {
    if (/^20\d{2}$/.test(w)) break;          // стоп на годе
    shortWords.push(w);
    if (/^[A-Z]{1,4}-?\d+/i.test(w)) break;  // стоп после модельного кода
  }
  const product_short = shortWords.join(' ') || words.slice(0, 4).join(' ');

  return {
    product_name: scraped.title || '',
    product_short,
    description: copy.description || '',
    benefits: copy.benefits || [],
    specs: scraped.specs || [],
    price: scraped.price || null,
    images: scraped.images || [],
    product_url: scraped.url || '',
    video_url: scraped.video_url || null
  };
}

// ─── Скрапинг страницы ───────────────────────────────────────────
async function scrapePage(tabId, tabUrl) {
  const isArbq = tabUrl.includes('arbq.ru');
  const scriptFile = isArbq ? 'content-arbq.js' : 'content-generic.js';

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: [scriptFile]
  });

  return results[0]?.result || null;
}

// ─── Генерация PDF через chrome.debugger ─────────────────────────
async function generatePDF(tabId, filename) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }

      chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
        landscape: false,
        displayHeaderFooter: false,
        printBackground: true,
        scale: 1,
        paperWidth: 8.2677,
        paperHeight: 11.6929,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        preferCSSPageSize: true
      }, (result) => {
        chrome.debugger.detach({ tabId }, () => {});

        if (chrome.runtime.lastError || !result) {
          return reject(chrome.runtime.lastError || new Error('PDF generation failed'));
        }

        // base64 → Blob URL → download
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
          url,
          filename: filename + '.pdf',
          saveAs: false
        }, () => {
          URL.revokeObjectURL(url);
          resolve();
        });
      });
    });
  });
}

// ─── Обработка сообщений ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Отмена текущего запроса
  if (msg.type === 'CANCEL') {
    chrome.storage.local.set({ kp_cancelled: true });
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    sendResponse({ ok: true });
    return;
  }

  // Popup запрашивает быстрый скрапинг (без AI)
  if (msg.type === 'SCRAPE_PAGE') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        const scraped = await scrapePage(msg.tabId, tab.url);
        if (!scraped) {
          sendResponse({ error: 'Не удалось прочитать страницу' });
          return;
        }
        sendResponse({ ok: true, scraped });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // Popup запускает генерацию КП (AI запускается здесь)
  if (msg.type === 'GENERATE_KP') {
    (async () => {
      try {
        await chrome.storage.local.set({ kp_cancelled: false });

        const data = await extractProductData(msg.scraped);

        const { kp_cancelled } = await chrome.storage.local.get('kp_cancelled');
        if (kp_cancelled) {
          sendResponse({ error: 'Отменено пользователем' });
          return;
        }

        if (msg.price !== null && msg.price !== undefined) data.price = msg.price;
        data.manager_name    = msg.manager_name;
        data.manager_email   = msg.manager_email;
        data.date            = msg.date;
        data.client_name     = msg.client_name     || null;
        data.delivery_price  = msg.delivery_price  || null;
        data.warranty_months = msg.warranty_months || 12;
        data.warranty_hours  = msg.warranty_hours  || 1000;
        data.extra_goods     = msg.extra_goods     || [];
        data.extra_services  = msg.extra_services  || [];

        const sessionKey = 'kp_' + Date.now();
        await chrome.storage.local.set({ [sessionKey]: data });

        const tab = await chrome.tabs.create({
          url: chrome.runtime.getURL('generate.html') + '?session=' + sessionKey,
          active: true
        });

        sendResponse({ ok: true, tabId: tab.id });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // generate.html сообщает: страница готова к PDF
  if (msg.type === 'READY_FOR_PDF') {
    (async () => {
      try {
        const tabId = sender.tab.id;
        const safe = msg.filename.replace(/[\\/:*?"<>|]/g, '_');
        await generatePDF(tabId, safe);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // Повторная генерация PDF после ручного редактирования
  if (msg.type === 'REGENERATE_PDF') {
    (async () => {
      try {
        const tabId = sender.tab.id;
        const safe = msg.filename.replace(/[\\/:*?"<>|]/g, '_');
        await generatePDF(tabId, safe);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // Закрыть вкладку по запросу из generate.html
  if (msg.type === 'CLOSE_TAB') {
    chrome.tabs.remove(sender.tab.id);
    sendResponse({ ok: true });
    return;
  }
});
