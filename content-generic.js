// content-generic.js — универсальный скрапер для любых сайтов

(function () {
  function getPrice() {
    // Ищем microdata
    const microdata = document.querySelector('[itemprop="price"]');
    if (microdata) {
      const val = microdata.getAttribute('content') || microdata.textContent;
      const num = parseFloat(val.replace(/[^\d.]/g, ''));
      if (num > 0) return num;
    }

    // Ищем JSON-LD
    const jsonLds = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLds) {
      try {
        const data = JSON.parse(script.textContent);
        const price = data.offers?.price || data.price;
        if (price) return parseFloat(price);
      } catch (_) { /* ignore */ }
    }

    // Ищем числа с ₽/руб рядом
    const pricePattern = /[\d\s]{4,}(?:\.\d{2})?\s*(?:₽|руб|RUB|р\.)/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent;
      const match = text.match(pricePattern);
      if (match) {
        const num = parseFloat(match[0].replace(/[^\d.]/g, ''));
        if (num > 1000) return num;
      }
    }

    return null;
  }

  function getImages() {
    const urls = new Set();

    // Open Graph
    document.querySelectorAll('meta[property="og:image"]').forEach(m => {
      if (m.content) urls.add(m.content);
    });

    // JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const imgs = [].concat(data.image || []);
        imgs.forEach(i => typeof i === 'string' ? urls.add(i) : i.url && urls.add(i.url));
      } catch (_) { /* ignore */ }
    });

    // Gallery images (крупнее 300px)
    document.querySelectorAll('img').forEach(img => {
      const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
      const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
      if (w > 300 && h > 200) {
        const raw = img.dataset.srcset?.split(',')[0]?.trim().split(' ')[0]
          || img.dataset.src
          || img.dataset.lazySrc
          || img.src;
        try {
          const src = new URL(raw, location.href).href;
          if (!src.includes('logo') && !src.includes('icon')) urls.add(src);
        } catch (_) { /* ignore */ }
      }
    });

    return [...urls].slice(0, 5);
  }

  function getMainText() {
    // Убираем nav, footer, header, script, style
    const skip = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 'NOSCRIPT', 'IFRAME']);
    const texts = [];

    function walk(node) {
      if (skip.has(node.tagName)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t.length > 20) texts.push(t);
      } else {
        node.childNodes.forEach(walk);
      }
    }

    // Ищем главный контентный блок
    const main = document.querySelector('main, article, [role="main"], .product, .product-detail, #content')
      || document.body;
    walk(main);

    return texts.join(' ').slice(0, 8000);
  }

  function getTitle() {
    return document.querySelector('h1')?.textContent?.trim()
      || document.querySelector('[itemprop="name"]')?.textContent?.trim()
      || document.title?.trim()
      || '';
  }

  function getMetaDescription() {
    return document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content
      || '';
  }

  const title = getTitle();
  const price = getPrice();
  const images = getImages();
  const mainText = getMainText();
  const meta = getMetaDescription();
  const lang = document.documentElement.lang
    || document.querySelector('meta[http-equiv="content-language"]')?.content
    || 'unknown';

  // Структурированные характеристики из таблиц/dl
  function getSpecsStructured() {
    const groups = [];
    document.querySelectorAll('table').forEach(table => {
      const items = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const key = cells[0].textContent.trim();
          const val = cells[1].textContent.trim();
          if (key && val && key.length < 80) items.push({ key, value: val });
        }
      });
      if (items.length > 1) groups.push({ group: 'Характеристики', items });
    });
    return groups;
  }

  // Короткий текст для Ollama — только описание, не весь текст страницы
  const descriptionText = (meta + '\n' + mainText.slice(0, 1200)).trim();

  const ogType = document.querySelector('meta[property="og:type"]')?.content?.toLowerCase() || '';
  const isDefinitelyProduct = ogType === 'product' || !!document.querySelector('[itemtype*="Product"]:not([itemtype*="ItemList"]) [itemprop="description"]');

  const isCatalog = !isDefinitelyProduct && (
    document.querySelectorAll('[itemtype*="Product"]').length >= 3 ||
    document.querySelectorAll('[class*="catalog-item"],[class*="product-card"],[class*="product-tile"]').length >= 3
  );

  return {
    title,
    price,
    images,
    description: descriptionText,
    specs: getSpecsStructured(),
    lang,
    url: location.href,
    pageType: isCatalog ? 'catalog' : 'product'
  };
})();
