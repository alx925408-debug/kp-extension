// content-arbq.js — скрапер для arbq.ru

(function () {

  function getPrice() {
    // Актуальный селектор цены (после редизайна микроразметки)
    const el = document.querySelector('.product-item-detail-price-current');
    if (el) {
      const num = parseFloat(el.textContent.replace(/[^\d]/g, ''));
      if (num > 0) return num;
    }
    // Скрытый input с ценой (используется JS-калькулятором услуг)
    const inp = document.querySelector('input[name="product_price"]');
    if (inp) {
      const num = parseFloat(inp.value);
      if (num > 0) return num;
    }
    // Fallback: текст с ₽ на странице
    const m = document.body.textContent.match(/([\d\s]{4,})\s*₽/);
    if (m) {
      const num = parseFloat(m[1].replace(/\s/g, ''));
      if (num > 1000) return num;
    }
    return null;
  }

  function getImages() {
    function abs(src) {
      if (!src) return null;
      try { return new URL(src, location.href).href; } catch { return null; }
    }
    function imgSrc(img) {
      return abs(img.dataset.src || img.dataset.originalSrc || img.src);
    }
    function ok(src) {
      return src && !src.includes('no_photo') && !src.includes('icon') && !src.includes('logo');
    }

    const result = [];
    const seen = new Set();
    function add(src) {
      const clean = src.replace(/\?.*$/, '');
      if (ok(clean) && !seen.has(clean)) { seen.add(clean); result.push(clean); }
    }

    // Основной слайдер товара — active-слайд первым
    const activeImg = document.querySelector('.product-item-detail-slider-image.active img');
    if (activeImg) { const s = imgSrc(activeImg); if (s) add(s); }

    // Остальные слайды галереи (исключаем .section_products — «Смотрите также»)
    document.querySelectorAll('.product-item-detail-slider-image img').forEach(img => {
      if (!img.closest('.section_products')) { const s = imgSrc(img); if (s) add(s); }
    });

    // Fallback: все img > 300px вне блока «Смотрите также»
    if (result.length < 2) {
      document.querySelectorAll('img').forEach(img => {
        if (img.closest('.section_products')) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w > 300 && h > 200) { const s = imgSrc(img); if (s) add(s); }
      });
    }

    return result.slice(0, 5);
  }

  function getDescription() {
    // Вкладка «Описание» (itemprop="description", data-value="description")
    const el = document.querySelector('[data-value="description"][itemprop="description"], [itemprop="description"]');
    if (el) {
      const text = el.textContent.trim();
      if (text.length > 30) return text.slice(0, 1500);
    }
    // Fallback: старые Bitrix-селекторы
    for (const sel of ['.catalog-element-description', '.catalog-element-detail-text', '.product-detail-description']) {
      const el2 = document.querySelector(sel);
      if (el2 && el2.textContent.trim().length > 30) return el2.textContent.trim().slice(0, 1500);
    }
    return '';
  }

  function getSpecsStructured() {
    const groups = [];

    // Актуальная разметка: product-item-detail-properties-tab-item
    // Вкладка скрыта через display:none → обязательно textContent, не innerText
    const items = [];
    document.querySelectorAll('.product-item-detail-properties-tab-item').forEach(row => {
      const key = row.querySelector('.product-item-detail-properties-tab-title')?.textContent.trim();
      const val = row.querySelector('.product-item-detail-properties-tab-value')?.textContent.trim();
      if (key && val && key !== val && key.length < 80) items.push({ key, value: val });
    });
    if (items.length > 0) {
      // Сгруппировать по заголовкам групп
      const grouped = new Map();
      document.querySelectorAll('.product-item-detail-properties-group').forEach(group => {
        const title = group.querySelector('.product-item-detail-properties-group-title')?.textContent.trim() || 'Характеристики';
        const groupItems = [];
        group.querySelectorAll('.product-item-detail-properties-tab-item').forEach(row => {
          const k = row.querySelector('.product-item-detail-properties-tab-title')?.textContent.trim();
          const v = row.querySelector('.product-item-detail-properties-tab-value')?.textContent.trim();
          if (k && v && k !== v) groupItems.push({ key: k, value: v });
        });
        if (groupItems.length) grouped.set(title, groupItems);
      });

      if (grouped.size > 0) {
        grouped.forEach((groupItems, title) => groups.push({ group: title, items: groupItems }));
      } else {
        groups.push({ group: 'Характеристики', items });
      }
      return groups;
    }

    // Fallback: div-блоки Bitrix (старая разметка)
    const containers = document.querySelectorAll(
      '.catalog-element-properties, .catalog-element-specifications, ' +
      '.bx_catalog_element_props, .product-detail-properties, #bx_props'
    );
    for (const container of containers) {
      const fallbackItems = [];
      const rows = container.querySelectorAll(
        '.catalog-element-property-item, .catalog-element-property, .prop-item, .property-row, .param, li'
      );
      rows.forEach(row => {
        const ch = [...row.children];
        if (ch.length >= 2) {
          const key = ch[0].textContent.trim().replace(/:$/, '');
          const val = ch[ch.length - 1].textContent.trim();
          if (key && val && key !== val && key.length < 80) fallbackItems.push({ key, value: val });
        }
      });
      if (fallbackItems.length > 1) {
        groups.push({ group: 'Характеристики', items: fallbackItems });
        return groups;
      }
    }

    // Fallback: таблицы (не в шапке/подвале)
    document.querySelectorAll('table').forEach(table => {
      if (table.closest('header, nav, footer, .header, .nav, .footer, .menu, .section_products')) return;
      const tableItems = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const key = cells[0].textContent.trim();
          const val = cells[1].textContent.trim();
          if (key && val && key.length < 80) tableItems.push({ key, value: val });
        }
      });
      if (tableItems.length > 1) groups.push({ group: 'Характеристики', items: tableItems });
    });

    return groups;
  }

  function getVideoUrl() {
    // [data-value="video"] есть дважды: таб-кнопка (li) и контент-контейнер (div).
    // Нужен именно контент — data-entity="tab-container"
    const videoContainer = document.querySelector('[data-entity="tab-container"][data-value="video"]');
    if (!videoContainer) return null;
    const link = videoContainer.querySelector('a[href*="vkvideo.ru"], a[href*="vk.com/video"]');
    return link ? link.href : null;
  }

  const h1 = document.querySelector('h1')?.textContent.trim() || document.title;
  const price = getPrice();
  const images = getImages();
  const lang = document.documentElement.lang || 'ru';
  const video_url = getVideoUrl();

  let description = getDescription();
  if (!description) {
    description = (document.querySelector('main, article, #content, .container-detail-element')
      ?.textContent?.trim() || '').slice(0, 800);
  }

  return {
    title: h1,
    price,
    images,
    description,
    specs: getSpecsStructured(),
    lang,
    url: location.href,
    video_url
  };
})();
