// docx-gen.js — генерация DOCX без внешних зависимостей
/* global chrome */

// ─── Минимальный ZIP-писатель (stored mode, без компрессии) ──────
const MiniZip = {
  _enc: new TextEncoder(),

  _u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  },
  _u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  },

  _crc32(data) {
    const table = MiniZip._crcTable || (MiniZip._crcTable = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },

  _concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  },

  build(files) {
    const enc = MiniZip._enc;
    let offset = 0;
    const localHeaders = [];
    const centralDirs = [];

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : enc.encode(file.data);
      const crc = MiniZip._crc32(data);
      const size = data.length;

      const lh = MiniZip._concat(
        new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
        MiniZip._u16(20), MiniZip._u16(0), MiniZip._u16(0),
        MiniZip._u16(0),  MiniZip._u16(0),
        MiniZip._u32(crc), MiniZip._u32(size), MiniZip._u32(size),
        MiniZip._u16(nameBytes.length), MiniZip._u16(0),
        nameBytes, data
      );

      const cd = MiniZip._concat(
        new Uint8Array([0x50, 0x4B, 0x01, 0x02]),
        MiniZip._u16(20), MiniZip._u16(20), MiniZip._u16(0), MiniZip._u16(0),
        MiniZip._u16(0),  MiniZip._u16(0),
        MiniZip._u32(crc), MiniZip._u32(size), MiniZip._u32(size),
        MiniZip._u16(nameBytes.length), MiniZip._u16(0), MiniZip._u16(0),
        MiniZip._u16(0),  MiniZip._u16(0), MiniZip._u32(0),
        MiniZip._u32(offset), nameBytes
      );

      localHeaders.push(lh);
      centralDirs.push(cd);
      offset += lh.length;
    }

    const cdStart = offset;
    const cdSize = centralDirs.reduce((s, c) => s + c.length, 0);
    const eocd = MiniZip._concat(
      new Uint8Array([0x50, 0x4B, 0x05, 0x06]),
      MiniZip._u16(0), MiniZip._u16(0),
      MiniZip._u16(files.length), MiniZip._u16(files.length),
      MiniZip._u32(cdSize), MiniZip._u32(cdStart), MiniZip._u16(0)
    );

    return MiniZip._concat(...localHeaders, ...centralDirs, eocd);
  }
};

// ─── Утилиты ──────────────────────────────────────────────────────
function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fmt(n) {
  if (!n) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

const MM = 36000; // 1мм в EMU

// ─── Загрузка изображений ─────────────────────────────────────────
async function fetchImgData(url) {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    const ext = ct.includes('png') ? 'png' : 'jpeg';
    return { arr: new Uint8Array(buf), ext };
  } catch {
    return null;
  }
}

function getImgDims(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
    setTimeout(() => resolve({ w: 800, h: 600 }), 5000);
  });
}

function fitImg(origW, origH, maxWmm, maxHmm) {
  if (!origW || !origH) return { wMm: maxWmm, hMm: maxHmm || Math.round(maxWmm * 0.75) };
  const aspect = origH / origW;
  let wMm = maxWmm;
  let hMm = Math.round(wMm * aspect);
  if (maxHmm && hMm > maxHmm) {
    hMm = maxHmm;
    wMm = Math.round(hMm / aspect);
  }
  return { wMm, hMm };
}

// ─── OOXML: inline drawing ────────────────────────────────────────
function drawing(rId, wMm, hMm, id) {
  const cx = Math.round(wMm * MM);
  const cy = Math.round(hMm * MM);
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="img${id}"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr>` +
    `<pic:cNvPr id="${id}" name="img${id}"/>` +
    `<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>` +
    `</pic:nvPicPr><pic:blipFill>` +
    `<a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill><pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing>`
  );
}

// ─── OOXML: параграфы ─────────────────────────────────────────────
function para(text, opts = {}) {
  const sz = opts.sz !== undefined ? opts.sz : 20;
  const font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
  const bold = opts.bold ? '<w:b/><w:bCs/>' : '';
  const color = opts.color ? `<w:color w:val="${opts.color}"/>` : '';
  const szXml = `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;

  const after = opts.spaceAfter !== undefined ? opts.spaceAfter : 120;
  const before = opts.spaceBefore !== undefined ? opts.spaceBefore : 0;
  const pp = [`<w:spacing w:after="${after}" w:before="${before}"/>`];
  if (opts.align) pp.push(`<w:jc w:val="${opts.align}"/>`);
  if (opts.indent) pp.push(`<w:ind w:left="${opts.indent}"/>`);
  if (opts.bgColor) pp.push(`<w:shd w:val="clear" w:color="auto" w:fill="${opts.bgColor}"/>`);
  if (opts.borderBottom) {
    const bc = opts.borderColor || 'E6E6E6';
    const bsz = opts.borderSz || 6;
    pp.push(`<w:pBdr><w:bottom w:val="single" w:sz="${bsz}" w:space="4" w:color="${bc}"/></w:pBdr>`);
  }

  const pPr = `<w:pPr>${pp.join('')}</w:pPr>`;
  const drawXml = opts.drawing || '';
  if (!text && !opts.drawing) return `<w:p>${pPr}</w:p>`;
  const textXml = text
    ? `<w:r><w:rPr>${font}${bold}${szXml}${color}</w:rPr><w:t xml:space="preserve">${xmlEsc(String(text))}</w:t></w:r>`
    : '';
  return `<w:p>${pPr}${textXml}${drawXml}</w:p>`;
}

function imgPara(rId, wMm, hMm, id, align) {
  return para('', {
    align: align || 'center',
    spaceAfter: 0, spaceBefore: 0,
    drawing: `<w:r>${drawing(rId, wMm, hMm, id)}</w:r>`
  });
}

function rule(color) {
  const c = color || 'E6E6E6';
  return `<w:p><w:pPr><w:spacing w:after="0" w:before="0"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${c}"/></w:pBdr></w:pPr></w:p>`;
}

function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// ─── OOXML: таблицы ───────────────────────────────────────────────
function tc(content, opts) {
  const o = opts || {};
  const pr = [];
  if (o.w !== undefined) pr.push(`<w:tcW w:w="${o.w}" w:type="dxa"/>`);
  if (o.span) pr.push(`<w:gridSpan w:val="${o.span}"/>`);
  if (o.bgColor) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.bgColor}"/>`);
  if (o.vAlign) pr.push(`<w:vAlign w:val="${o.vAlign}"/>`);

  const none = 'w:val="none" w:sz="0" w:color="auto"';
  if (o.leftBorder || o.noBorders) {
    const top    = `<w:top ${o.noBorders ? none : 'w:val="none" w:sz="0" w:color="auto"'}/>`;
    const left   = o.leftBorder
      ? `<w:left w:val="single" w:sz="${o.leftBorder}" w:space="0" w:color="${o.leftColor || 'E31E24'}"/>`
      : `<w:left ${none}/>`;
    const bottom = `<w:bottom ${o.noBorders ? none : 'w:val="none" w:sz="0" w:color="auto"'}/>`;
    const right  = `<w:right ${none}/>`;
    pr.push(`<w:tcBorders>${top}${left}${bottom}${right}</w:tcBorders>`);
  }

  pr.push('<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>');
  const tcPr = pr.length ? `<w:tcPr>${pr.join('')}</w:tcPr>` : '';
  return `<w:tc>${tcPr}${content}</w:tc>`;
}

function tbl(rows, opts) {
  const o = opts || {};
  const w = o.w !== undefined ? o.w : 9350;
  let bXml;
  if (o.borders === false) {
    bXml = '<w:tblBorders><w:top w:val="none" w:sz="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:color="auto"/></w:tblBorders>';
  } else {
    const bc = o.borderColor || 'E6E6E6';
    bXml = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="${bc}"/><w:left w:val="single" w:sz="4" w:color="${bc}"/><w:bottom w:val="single" w:sz="4" w:color="${bc}"/><w:right w:val="single" w:sz="4" w:color="${bc}"/><w:insideH w:val="single" w:sz="4" w:color="${bc}"/><w:insideV w:val="single" w:sz="4" w:color="${bc}"/></w:tblBorders>`;
  }
  const cols = (o.cols || [w]).map(c => `<w:gridCol w:w="${c}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/>${bXml}</w:tblPr><w:tblGrid>${cols}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

// ─── Блок преимуществ (2×2) ───────────────────────────────────────
function benefitsGrid(benefits) {
  const H = 4675;
  const rows = [];
  for (let i = 0; i < 4; i += 2) {
    const cells = [benefits[i], benefits[i + 1]].map(b => {
      if (!b) return tc('<w:p/>', { w: H, leftBorder: 18, noBorders: true });
      const content =
        para(b.title || '', { bold: true, sz: 22, color: '15171a', spaceAfter: 40, spaceBefore: 0 }) +
        para(b.desc  || '', { sz: 20, spaceAfter: 0, spaceBefore: 0 });
      return tc(content, { w: H, leftBorder: 18, noBorders: true });
    });
    rows.push(`<w:tr>${cells.join('')}</w:tr>`);
  }
  return tbl(rows, { w: 9350, cols: [H, H], borders: false });
}

// ─── Группа характеристик ─────────────────────────────────────────
function specsGroup(group) {
  const C1 = 5610, C2 = 3740;
  const hdr = para(group.group || '', { bold: true, sz: 20, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0 });
  const rows = [`<w:tr>${tc(hdr, { w: 9350, span: 2, bgColor: 'E31E24' })}</w:tr>`];
  (group.items || []).forEach((item, i) => {
    const bg = i % 2 === 0 ? 'FFFFFF' : 'F5F5F5';
    rows.push(
      `<w:tr>` +
      tc(para(item.key   || '', { sz: 18, spaceAfter: 0, spaceBefore: 0 }), { w: C1, bgColor: bg }) +
      tc(para(item.value || '', { sz: 18, spaceAfter: 0, spaceBefore: 0 }), { w: C2, bgColor: bg }) +
      `</w:tr>`
    );
  });
  return tbl(rows, { w: 9350, cols: [C1, C2] }) + para('', { spaceAfter: 160, spaceBefore: 0 });
}

// ─── Галерея изображений ──────────────────────────────────────────
function galleryGrid(urls, imgMap) {
  const valid = (urls || []).filter(u => imgMap[u]);
  if (!valid.length) return '';
  const COLS = valid.length === 1 ? 1 : 2;
  const cellW = Math.floor(9350 / COLS);
  const imgMaxW = Math.floor(cellW * 25.4 / 1440) - 4;

  const rows = [];
  for (let i = 0; i < valid.length; i += COLS) {
    const cells = [];
    for (let j = 0; j < COLS; j++) {
      const url = valid[i + j];
      if (!url) { cells.push(tc('<w:p/>', { w: cellW, noBorders: true })); continue; }
      const info = imgMap[url];
      const { wMm, hMm } = fitImg(info.origW, info.origH, imgMaxW, imgMaxW * 1.2);
      cells.push(tc(imgPara(info.rId, wMm, hMm, info.id, 'center'), { w: cellW, noBorders: true }));
    }
    rows.push(`<w:tr>${cells.join('')}</w:tr>`);
  }
  return tbl(rows, { w: 9350, cols: Array(COLS).fill(cellW), borders: false });
}

// ─── Документ (все страницы) ──────────────────────────────────────
function buildDocumentXml(data, imgMap) {
  const NS = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
  ].join(' ');

  const price = data.price;
  const pf    = data.payment_form || 'nds22';
  const pfRowLabels = {
    cash:  'Стоимость товара (Наличный расчет)',
    usn:   'Стоимость товара (Безналичный расчет, УСН)',
    nds5:  'Стоимость товара (включая НДС 5%)',
    nds22: 'Стоимость товара (включая НДС 22%)'
  };
  const pfNames = {
    cash:  'Наличный расчет',
    usn:   'Безналичный расчет (УСН)',
    nds5:  'Безналичный расчет НДС 5%',
    nds22: 'Безналичный расчет НДС 22%'
  };
  const priceRowLabel = pfRowLabels[pf] || pfRowLabels.nds22;
  const pfName = pfNames[pf] || pfNames.nds22;
  const vatRate = pf === 'nds5' ? 5 : pf === 'nds22' ? 22 : 0;
  const vat = (price && vatRate) ? Math.round(price * vatRate / (100 + vatRate)) : null;
  const deliveryTermsText = data.delivery_terms || 'Оборудование полностью проверено и готово к эксплуатации';

  // — Главное фото —
  const mainUrl  = (data.images || [])[0];
  const mainInfo = mainUrl && imgMap[mainUrl];
  const mainImgXml = mainInfo
    ? (() => {
        const { wMm, hMm } = fitImg(mainInfo.origW, mainInfo.origH, 170, 110);
        return imgPara(mainInfo.rId, wMm, hMm, mainInfo.id, 'center') +
               para('', { spaceAfter: 160, spaceBefore: 0 });
      })()
    : '';

  // — QR-код —
  const qrTarget = data.video_url || data.product_url;
  const qrUrl  = qrTarget
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrTarget)}&color=15171a&bgcolor=ffffff`
    : null;
  const qrInfo = qrUrl && imgMap[qrUrl];
  const qrBlock = qrInfo
    ? imgPara(qrInfo.rId, 28, 28, qrInfo.id, 'left') +
      para(data.video_url ? 'Отсканируйте QR-код для просмотра видео' : 'Отсканируйте QR-код для перехода на сайт',
           { sz: 16, color: '7a8088', spaceAfter: 80 })
    : '';

  // — Характеристики —
  const specsXml = (data.specs || []).map(specsGroup).join('');

  // — Таблица цен —
  function prRow(label, val, isTotal) {
    const bg = isTotal ? 'E31E24' : 'FFFFFF';
    const col = isTotal ? 'FFFFFF' : '15171a';
    return (
      `<w:tr>` +
      tc(para(label, { sz: 20, bold: !!isTotal, color: col, spaceAfter: 0, spaceBefore: 0 }), { w: 6560, bgColor: bg }) +
      tc(para(val,   { sz: 20, bold: !!isTotal, color: col, spaceAfter: 0, spaceBefore: 0, align: 'right' }), { w: 2790, bgColor: bg }) +
      `</w:tr>`
    );
  }
  const priceHdr =
    `<w:tr>` +
    tc(para('Наименование', { bold: true, sz: 20, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0 }), { w: 6560, bgColor: 'E31E24' }) +
    tc(para('Сумма',        { bold: true, sz: 20, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0, align: 'right' }), { w: 2790, bgColor: 'E31E24' }) +
    `</w:tr>`;
  const extraGoods    = data.extra_goods    || [];
  const extraServices = data.extra_services || [];
  const deliveryPrice = data.delivery_price || 0;
  const extraTotal = extraGoods.reduce((s, i) => s + (i.price || 0), 0)
    + extraServices.reduce((s, i) => s + (i.price || 0), 0)
    + deliveryPrice;
  const totalPrice = (price || 0) + extraTotal;

  const extraRows = [
    ...extraGoods.map(i => prRow(i.name, i.price ? fmt(i.price) + ' ₽' : 'По запросу')),
    ...extraServices.map(i => prRow(i.name, i.price ? fmt(i.price) + ' ₽' : 'По запросу')),
    ...(deliveryPrice > 0 ? [prRow('Доставка', fmt(deliveryPrice) + ' ₽')] : [])
  ];

  const vatRows = vat
    ? [prRow(`в т.ч. НДС ${vatRate}%`, fmt(vat) + ' ₽')]
    : [];
  const priceTable = tbl([
    priceHdr,
    prRow(priceRowLabel, price ? fmt(price) + ' ₽' : 'По запросу'),
    ...extraRows,
    ...vatRows,
    prRow('ИТОГО к оплате', totalPrice ? fmt(totalPrice) + ' ₽' : 'По запросу', true)
  ], { w: 9350, cols: [6560, 2790] });

  // — Галерея —
  const galleryXml = galleryGrid((data.images || []).slice(0, 5), imgMap);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}>
<w:body>

${para('ARBQ.RU', { bold: true, sz: 56, color: 'E31E24', align: 'center', spaceAfter: 0 })}
${para('Промышленное оборудование', { sz: 24, color: '7a8088', align: 'center', spaceAfter: 200 })}
${rule('E31E24')}
${para('', { spaceAfter: 120 })}
${para('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', { bold: true, sz: 40, color: '15171a', align: 'center', spaceAfter: 80 })}
${data.client_name ? para('для ' + data.client_name, { sz: 28, color: '7a8088', align: 'center', spaceAfter: 60 }) : ''}
${para((data.product_short || data.product_name || '').toUpperCase(), { bold: true, sz: 30, color: 'E31E24', align: 'center', spaceAfter: 240 })}
${rule()}
${para('', { spaceAfter: 80 })}
${para('Дата: ' + (data.date || new Date().toLocaleDateString('ru-RU')), { sz: 20, color: '7a8088', spaceAfter: 40 })}
${para('Менеджер: ' + (data.manager_name  || ''), { sz: 20, spaceAfter: 40 })}
${para('E-mail: '   + (data.manager_email || ''), { sz: 20, spaceAfter: 200 })}
${rule()}
${para('', { spaceAfter: 80 })}
${para('О компании', { bold: true, sz: 28, color: '15171a', spaceAfter: 80 })}
${para('ARBQ.RU — одна из крупнейших компаний России по поставкам промышленного оборудования, КГШ, систем переработки материалов и запасных частей для спецтехники. Работаем с 2008 года.', { sz: 20, spaceAfter: 80 })}
${para('• 16+ лет на рынке   • 1500+ довольных клиентов   • 2700+ позиций в наличии   • Собственный сервисный центр', { sz: 20, color: 'E31E24', spaceAfter: 0 })}
${pageBreak()}

${para(data.product_name || '—', { bold: true, sz: 32, color: '15171a', spaceAfter: 120 })}
${mainImgXml}
${para(data.description || '', { sz: 21, spaceAfter: 200 })}
${rule('E31E24')}
${para('', { spaceAfter: 80 })}
${para('ПРЕИМУЩЕСТВА', { bold: true, sz: 24, color: 'E31E24', spaceAfter: 120 })}
${benefitsGrid(data.benefits || [])}
${para('', { spaceAfter: 120 })}
${qrBlock}
${pageBreak()}

${para('ФОТОГАЛЕРЕЯ', { bold: true, sz: 36, color: 'E31E24', spaceAfter: 40 })}
${para(data.product_name || '', { bold: true, sz: 24, color: '15171a', spaceAfter: 160 })}
${galleryXml || para('Фотографии уточняются', { sz: 20, color: '7a8088' })}
${pageBreak()}

${para('ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ', { bold: true, sz: 36, color: 'E31E24', spaceAfter: 40 })}
${para(data.product_name || '', { bold: true, sz: 24, color: '15171a', spaceAfter: 160 })}
${specsXml || para('Характеристики уточняются у менеджера', { sz: 20, color: '7a8088' })}
${pageBreak()}

${para('РАСЧЁТ СТОИМОСТИ', { bold: true, sz: 36, color: 'E31E24', spaceAfter: 40 })}
${para(data.product_name || '', { bold: true, sz: 24, color: '15171a', spaceAfter: 160 })}
${priceTable}
${para('', { spaceAfter: 80 })}
${para('Условия поставки: ' + deliveryTermsText, { sz: 20, color: '7a8088', spaceAfter: 80 })}
${para('Форма оплаты: ' + pfName, { sz: 20, color: '7a8088', spaceAfter: 200 })}
${rule()}
${para('', { spaceAfter: 80 })}
${para('ГАРАНТИЯ И СЕРВИС', { bold: true, sz: 28, color: '15171a', spaceAfter: 80 })}
${para('• Гарантийный срок: ' + (data.warranty_months || 12) + ' месяцев или ' + fmt(data.warranty_hours || 1000) + ' моточасов', { sz: 20, spaceAfter: 40 })}
${para('• Склад запчастей: 2 700+ позиций в Москве, доставка по России и СНГ', { sz: 20, spaceAfter: 40 })}
${para('• Выезд инженера: в течение 48 часов в пределах региона', { sz: 20, spaceAfter: 40 })}
${para('• Обучение персонала при необходимости', { sz: 20, spaceAfter: 200 })}
${rule()}
${para('', { spaceAfter: 80 })}
${para('КОНТАКТЫ', { bold: true, sz: 28, color: '15171a', spaceAfter: 80 })}
${para('Телефон: 8 800 600 6649 (бесплатно по России)', { sz: 21, spaceAfter: 40 })}
${para('E-mail: '    + (data.manager_email || ''), { sz: 21, spaceAfter: 40 })}
${para('Сайт: arbq.ru', { sz: 21, spaceAfter: 40 })}
${para('Менеджер: '  + (data.manager_name  || ''), { sz: 21, bold: true, spaceAfter: 200 })}
${rule()}
${para('', { spaceAfter: 80 })}
${para('Коммерческое предложение не является публичной офертой · arbq.ru', { sz: 16, color: '7a8088', align: 'center' })}

<w:sectPr>
  <w:headerReference w:type="default" r:id="rId2"/>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/>
</w:sectPr>
</w:body>
</w:document>`;
}

// ─── Header XML ───────────────────────────────────────────────────
function buildHeaderXml(hasLogo) {
  const NS = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
  ].join(' ');
  const logoRun = hasLogo ? `<w:r>${drawing('rId1', 8, 8, 200)}</w:r>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}>
  <w:p>
    <w:pPr>
      <w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs>
      <w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="E31E24"/></w:pBdr>
      <w:spacing w:before="0" w:after="120"/>
    </w:pPr>
    ${logoRun}
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:tab/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:b/><w:bCs/><w:color w:val="E31E24"/></w:rPr><w:t>ARBQ.RU</w:t></w:r>
  </w:p>
</w:hdr>`;
}

// ─── Styles XML ───────────────────────────────────────────────────
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
      <w:sz w:val="20"/><w:szCs w:val="20"/>
      <w:lang w:val="ru-RU"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="120" w:before="0"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
</w:styles>`;
}

// ─── ZIP-метаданные ───────────────────────────────────────────────
function buildContentTypes(imgMap, hasLogo) {
  const exts = new Set(hasLogo ? ['png'] : []);
  Object.values(imgMap).forEach(i => exts.add(i.ext));
  const extMime = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const defaults = [...exts].map(e => `<Default Extension="${e}" ContentType="${extMime[e] || 'image/jpeg'}"/>`).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${defaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function buildDocumentRels(imgMap) {
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
  ];
  Object.values(imgMap).forEach(info => {
    rels.push(`<Relationship Id="${info.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${info.id}.${info.ext}"/>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`;
}

function buildHeaderRels(hasLogo) {
  const rel = hasLogo
    ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rel}
</Relationships>`;
}

// ─── Генерация DOCX прайс-листа ──────────────────────────────────
async function generatePricelistDocx(data) {
  const enc = new TextEncoder();
  const items = data.items || [];

  const pfNames = {
    cash:  'Наличный расчет',
    usn:   'Безналичный расчет (УСН)',
    nds5:  'Безналичный расчет НДС 5%',
    nds22: 'Безналичный расчет НДС 22%'
  };
  const pfName = pfNames[data.payment_form || 'nds22'] || pfNames.nds22;

  function plRow(num, name, price) {
    return `<w:tr>
      ${tc(para(String(num), { sz: 18, spaceAfter: 0, spaceBefore: 0, align: 'center' }), { w: 800 })}
      ${tc(para(name, { sz: 18, spaceAfter: 0, spaceBefore: 0 }), { w: 6200 })}
      ${tc(para(price, { sz: 18, spaceAfter: 0, spaceBefore: 0, align: 'right' }), { w: 2350 })}
    </w:tr>`;
  }

  const hdr = `<w:tr>
    ${tc(para('№', { sz: 18, bold: true, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0, align: 'center' }), { w: 800, bgColor: 'E31E24' })}
    ${tc(para('Наименование', { sz: 18, bold: true, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0 }), { w: 6200, bgColor: 'E31E24' })}
    ${tc(para('Цена', { sz: 18, bold: true, color: 'FFFFFF', spaceAfter: 0, spaceBefore: 0, align: 'right' }), { w: 2350, bgColor: 'E31E24' })}
  </w:tr>`;

  const rows = items.map((item, i) =>
    plRow(i + 1, item.title || '—', item.price ? fmt(item.price) + ' ₽' : 'По запросу')
  );

  const table = tbl([hdr, ...rows], { w: 9350, cols: [800, 6200, 2350] });

  const NS = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
  ].join(' ');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>
${para('ПРАЙС-ЛИСТ ARBQ.RU', { bold: true, sz: 56, color: 'E31E24', align: 'center', spaceAfter: 80 })}
${data.client_name ? para('для ' + data.client_name, { sz: 24, color: '7a8088', align: 'center', spaceAfter: 40 }) : ''}
${para((data.date || '') + (data.manager_name ? ' · ' + data.manager_name : ''), { sz: 20, color: '7a8088', align: 'center', spaceAfter: 200 })}
${table}
${para('', { spaceAfter: 160 })}
${para('Менеджер: ' + (data.manager_name || '') + ' · ' + (data.manager_email || ''), { sz: 18, color: '7a8088', spaceAfter: 40 })}
${para('Форма оплаты: ' + pfName, { sz: 18, color: '7a8088', spaceAfter: 40 })}
${para('ARBQ.RU · 8 800 600 6649 · arbq.ru', { sz: 18, color: '7a8088', spaceAfter: 40 })}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml',          data: enc.encode(contentTypes) },
    { name: '_rels/.rels',                  data: enc.encode(rootRels) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(wordRels) },
    { name: 'word/document.xml',            data: enc.encode(docXml) },
    { name: 'word/styles.xml',              data: enc.encode(buildStylesXml()) }
  ];

  const zipBytes = MiniZip.build(files);
  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

async function downloadPricelistDocx(data) {
  const blob = await generatePricelistDocx(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const clientPart = data.client_name ? '_' + (data.client_name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) : '';
  const firstTitle = (data.items && data.items[0]?.title) || 'каталог';
  a.download = `Прайс_${firstTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)}${clientPart}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ─── Основная функция генерации DOCX ─────────────────────────────
async function generateDocx(data) {
  const enc = new TextEncoder();

  const logoUrl = (typeof chrome !== 'undefined' && chrome.runtime)
    ? chrome.runtime.getURL('icons/logo_arbq_icon.png') : null;
  const logoData = logoUrl ? await fetchImgData(logoUrl) : null;

  const galleryUrls = (data.images || []).slice(0, 5);
  const qrTarget = data.video_url || data.product_url;
  const qrUrl = qrTarget
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrTarget)}&color=15171a&bgcolor=ffffff`
    : null;
  const allUrls = [...new Set([...galleryUrls, qrUrl].filter(Boolean))];

  const imgMap = {};
  let nextRId = 10;
  let nextId  = 1;
  for (const url of allUrls) {
    const imgData = await fetchImgData(url);
    if (!imgData) continue;
    const dims = await getImgDims(url);
    imgMap[url] = {
      rId: `rId${nextRId}`, id: nextId,
      arr: imgData.arr, ext: imgData.ext,
      origW: dims.w, origH: dims.h
    };
    nextRId++;
    nextId++;
  }

  const files = [
    { name: '[Content_Types].xml',          data: buildContentTypes(imgMap, !!logoData) },
    { name: '_rels/.rels',                  data: buildRootRels() },
    { name: 'word/document.xml',            data: buildDocumentXml(data, imgMap) },
    { name: 'word/_rels/document.xml.rels', data: buildDocumentRels(imgMap) },
    { name: 'word/styles.xml',              data: buildStylesXml() },
    { name: 'word/header1.xml',             data: buildHeaderXml(!!logoData) },
    { name: 'word/_rels/header1.xml.rels',  data: buildHeaderRels(!!logoData) }
  ];

  if (logoData) files.push({ name: `word/media/logo.${logoData.ext}`, data: logoData.arr });

  for (const [_url, info] of Object.entries(imgMap)) {
    files.push({ name: `word/media/img${info.id}.${info.ext}`, data: info.arr });
  }

  const zipBytes = MiniZip.build(files.map(f => ({
    name: f.name,
    data: f.data instanceof Uint8Array ? f.data : enc.encode(f.data)
  })));

  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}
