// content-catalog.js — скрапер каталога (список товаров)

(function () {
  function abs(href) {
    if (!href) return null;
    try { return new URL(href, location.href).href; } catch { return null; }
  }

  function scrapeArbqItems() {
    // Текущая разметка arbq.ru: .catalog-section-item > .product-card
    const cards = document.querySelectorAll('.product-card');
    const items = [];
    cards.forEach(card => {
      const titleEl = card.querySelector('.product-title');
      const title = titleEl ? titleEl.textContent.trim() : null;
      if (!title) return;

      const priceEl = card.querySelector('.price-row, [class*="price-current"], [class*="price_value"]');
      let price = null;
      if (priceEl) {
        const num = parseFloat(priceEl.textContent.replace(/[^\d]/g, ''));
        if (num > 0) price = num;
      }

      const imgEl = card.querySelector('.product-image.active, .product-image');
      const imgSrc = imgEl ? abs(imgEl.getAttribute('src') || imgEl.dataset.src || imgEl.dataset.originalSrc) : null;

      const linkEl = card.querySelector('a[href*="/catalog/"]');
      const url = linkEl ? abs(linkEl.getAttribute('href')) : null;

      items.push({ title, price, image: imgSrc, url });
    });
    return items;
  }

  function scrapeGenericItems() {
    // Schema.org microdata
    const cards = document.querySelectorAll('[itemtype*="Product"]');
    if (cards.length >= 2) {
      const items = [];
      cards.forEach(card => {
        const titleEl = card.querySelector('[itemprop="name"]');
        const title = titleEl ? titleEl.textContent.trim() : null;
        if (!title) return;

        const priceEl = card.querySelector('[itemprop="price"]');
        let price = null;
        if (priceEl) {
          const val = priceEl.getAttribute('content') || priceEl.textContent;
          const num = parseFloat(val.replace(/[^\d.]/g, ''));
          if (num > 0) price = num;
        }

        const imgEl = card.querySelector('img');
        const imgSrc = imgEl ? abs(imgEl.dataset.src || imgEl.src) : null;

        const linkEl = card.querySelector('a');
        const url = linkEl ? abs(linkEl.getAttribute('href')) : null;

        items.push({ title, price, image: imgSrc, url });
      });
      if (items.length) return items;
    }

    // JSON-LD ItemList
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const list = data['@type'] === 'ItemList' ? data : null;
        if (list && list.itemListElement && list.itemListElement.length >= 2) {
          return list.itemListElement.map(el => {
            const item = el.item || el;
            return {
              title: item.name || null,
              price: item.offers?.price ? parseFloat(item.offers.price) : null,
              image: typeof item.image === 'string' ? item.image : (item.image?.url || null),
              url: item.url || null
            };
          }).filter(i => i.title);
        }
      } catch (_) { /* ignore */ }
    }

    return [];
  }

  function detectNextPage() {
    // 1. rel="next"
    const relNext = document.querySelector('a[rel="next"]');
    if (relNext) return abs(relNext.getAttribute('href'));

    // 2. Текст-кнопка «следующая / далее / next / »»
    const nextTexts = ['следующая', 'далее', 'next', '»', '>'];
    const pagLinks = document.querySelectorAll('.pagination a, [class*="pagination"] a');
    for (const a of pagLinks) {
      const t = a.textContent.trim().toLowerCase();
      if (nextTexts.some(n => t === n || t.includes(n))) {
        const href = a.getAttribute('href');
        if (href) return abs(href);
      }
    }

    // 3. Bootstrap-стиль: .page-item.active → следующий .page-item с ссылкой (arbq.ru)
    const activeItem = document.querySelector('.page-item.active');
    if (activeItem) {
      let sib = activeItem.nextElementSibling;
      while (sib) {
        const a = sib.querySelector('a.page-link[href], a[href]');
        if (a) return abs(a.getAttribute('href'));
        sib = sib.nextElementSibling;
      }
    }

    // 4. Bitrix pagination next
    const bxNext = document.querySelector('.bx-pagination-next a');
    if (bxNext) return abs(bxNext.getAttribute('href'));

    // 5. Active in .bx-pagination → next sibling a
    const bxActive = document.querySelector('.bx-pagination .bx-active');
    if (bxActive) {
      let sib = bxActive.nextElementSibling;
      while (sib) {
        const a = sib.tagName === 'A' ? sib : sib.querySelector('a');
        if (a) return abs(a.getAttribute('href'));
        sib = sib.nextElementSibling;
      }
    }

    return null;
  }

  const isArbq = location.hostname.includes('arbq.ru');
  const items = isArbq ? scrapeArbqItems() : scrapeGenericItems();
  const nextPageUrl = detectNextPage();
  const catalogTitle = document.querySelector('h1')?.textContent?.trim() || '';

  return { pageType: 'catalog', items, nextPageUrl, catalogTitle };
})();
