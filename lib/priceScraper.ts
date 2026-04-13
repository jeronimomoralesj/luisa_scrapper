import * as cheerio from 'cheerio';
import { fetchPage, cleanText, detectPagination, sleep, resolveUrl } from './scraper';

export interface Product {
  name: string; price: string; oldPrice: string; currency: string;
  sku: string; brand: string; category: string; badge: string;
  link: string; image: string; sourcePage: string;
}

type OnProgress = (evt: object) => void;

function extractPrice(s: string) {
  const m = s.replace(/\./g, '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

/**
 * Extract products from GTM data attributes (e.g. virtualllantas.com).
 * Links with .gtm_product_click have data-name, data-price, data-brand, data-sku, data-category.
 */
function extractFromGtmLinks($: cheerio.CheerioAPI, pageUrl: string): Product[] {
  const items: Product[] = [];
  const seen = new Set<string>();

  $('a.gtm_product_click[data-name][data-price]').each((_, el) => {
    const $a = $(el);
    const dataName = cleanText($a.attr('data-name') || '');
    const dataBrand = cleanText($a.attr('data-brand') || '');
    const dataSku = cleanText($a.attr('data-sku') || '');
    const dataPrice = $a.attr('data-price') || '';
    const dataCategory = cleanText($a.attr('data-category') || '');
    const href = resolveUrl($a.attr('href'), pageUrl) || '';

    // Deduplicate by SKU or name (multiple links per product)
    const key = dataSku || dataName;
    if (!key || seen.has(key)) return;
    seen.add(key);

    const name = dataBrand ? `${dataBrand} ${dataName}` : dataName;
    if (!name) return;

    // Find the product card container to extract prices and image
    const $card = $a.closest('.llanta, .contorno_llanta, .recommend-contenedor, .columnas').first();
    const $priceBlock = $card.length ? $card : $a.parent().parent();

    // Current price: .despues text (sale price)
    const despues = cleanText($priceBlock.find('.despues').first().text());
    // Old price: strike inside .antes
    const antes = cleanText($priceBlock.find('.antes strike, strike').first().text());

    const currentPrice = extractPrice(despues) || extractPrice(dataPrice);
    const oldPrice = extractPrice(antes);

    // Image
    const img = $card.find('img.figure-result, img[src*="catalog/product"]').first();
    const image = img.attr('data-src') || img.attr('src') || '';

    // Badge (discount %)
    const badge = cleanText($card.find('.etiqueta_descuento .busqueda').first().text());

    items.push({
      name,
      price: currentPrice,
      oldPrice,
      currency: '$',
      sku: dataSku,
      brand: dataBrand,
      category: dataCategory,
      badge: badge ? `${badge} DCTO` : '',
      link: href,
      image,
      sourcePage: pageUrl,
    });
  });

  return items;
}

/**
 * Extract products from WooCommerce-style product cards.
 */
function extractFromWooCommerce($: cheerio.CheerioAPI, pageUrl: string): Product[] {
  const CARD_SELECTORS = [
    'li.product', '.product-item', 'article.product',
    '.woocommerce-loop-product', '.product-grid-item', '.product-card',
  ];
  const items: Product[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $cards: cheerio.Cheerio<any> = $([]);
  for (const sel of CARD_SELECTORS) { const f = $(sel); if (f.length > 0) { $cards = f; break; } }

  $cards.each((_, el) => {
    const $el = $(el);
    const name = cleanText($el.find('.woocommerce-loop-product__title, h2.product-title, h3.product-title, h2, h3').first().text());
    if (!name) return;

    // Price extraction: handle macrollantas "Precio Público" / "Valor" pattern
    const $valorDiv = $el.find('.precio.valor .woocommerce-Price-amount');
    const $publicoDiv = $el.find('.precio.public .woocommerce-Price-amount');
    const $ins = $el.find('.price ins .woocommerce-Price-amount');
    let priceRaw: string;
    let oldRaw: string;
    if ($valorDiv.length) {
      // macrollantas pattern: "Valor" is current, "Precio Público" is old
      priceRaw = cleanText($valorDiv.first().text());
      oldRaw = $publicoDiv.length ? cleanText($publicoDiv.first().text()) : '';
    } else if ($ins.length) {
      priceRaw = cleanText($ins.text());
      oldRaw = cleanText($el.find('.price del .woocommerce-Price-amount, del .amount').first().text());
    } else {
      priceRaw = cleanText($el.find('.price .woocommerce-Price-amount, .woocommerce-Price-amount, [class*="price"]').first().text());
      oldRaw = cleanText($el.find('.price del .woocommerce-Price-amount, del .amount').first().text());
    }

    // Product image (skip brand logos)
    const productImg = $el.find('img.attachment-woocommerce_thumbnail, img.wp-post-image, img[src*="product"]').first();
    const img = productImg.length ? productImg : $el.find('img').not('.marcaImagen').first();

    // Brand: try text, then brand logo alt, then filename
    let brand = cleanText($el.find('[class*="brand"]').not('.marca').first().text());
    if (!brand) {
      const brandImg = $el.find('img.marcaImagen, .marca img').first();
      const brandAlt = cleanText(brandImg.attr('alt') || '');
      if (brandAlt) {
        brand = brandAlt.replace(/^llantas?\s*/i, '').replace(/\s*llantas?$/i, '');
      } else {
        // Extract brand from image filename: Logo-Dunlop-llantas.png -> Dunlop
        const src = brandImg.attr('src') || '';
        const fname = src.split('/').pop()?.split('.')[0] || '';
        const cleaned = fname
          .replace(/[-_]?logo[-_]?/gi, ' ').replace(/[-_]?Logo[-_]?/g, ' ')
          .replace(/[-_\s]*macrollantas/i, '').replace(/[-_\s]*llantas/i, '')
          .replace(/[-_\s]*eyd/i, '') // random prefixes
          .replace(/[-_]?\d+$/g, '')
          .replace(/[-_]/g, ' ').trim();
        if (cleaned.length > 1 && cleaned.length < 30) brand = cleaned;
      }
    }

    items.push({
      name,
      price: extractPrice(priceRaw),
      oldPrice: extractPrice(oldRaw),
      currency: cleanText($el.find('.woocommerce-Price-currencySymbol').first().text()) || '$',
      sku: cleanText($el.find('.sku, [class*="sku"]').first().text()),
      brand,
      category: cleanText($el.find('[class*="category"], [class*="categoria"]').first().text()),
      badge: cleanText($el.find('.onsale, [class*="badge"], [class*="sale-tag"]').first().text()),
      link: resolveUrl($el.find('a').first().attr('href'), pageUrl) || '',
      image: img.attr('data-src') || img.attr('src') || '',
      sourcePage: pageUrl,
    });
  });
  return items;
}

/**
 * Generic fallback: find any repeated elements with an h3/h4 title and a price-like text.
 */
function extractGenericProducts($: cheerio.CheerioAPI, pageUrl: string): Product[] {
  const items: Product[] = [];
  const GENERIC_SELECTORS = [
    '.llanta', '.contorno_llanta', '.product-card', '.product-item',
    '.card', 'article', '.item',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $cards: cheerio.Cheerio<any> = $([]);
  for (const sel of GENERIC_SELECTORS) {
    const f = $(sel);
    if (f.length >= 2) { $cards = f; break; }
  }
  if ($cards.length === 0) return items;

  $cards.each((_, el) => {
    const $el = $(el);
    const name = cleanText($el.find('h2, h3, h4, .title, [class*="title"]').first().text());
    if (!name || name.length < 3) return;

    const text = $el.text();
    // Try to find a price pattern like $1.234.567 or $1234567
    const priceMatch = text.match(/\$\s*([\d.,]+)/);
    const price = priceMatch ? extractPrice(priceMatch[1]) : '';

    const oldMatch = $el.find('strike, del, .old-price, .antes').first().text();
    const oldPrice = oldMatch ? extractPrice(oldMatch) : '';

    const link = resolveUrl($el.find('a[href]').first().attr('href'), pageUrl) || '';
    const img = $el.find('img').first();

    if (price || link) {
      items.push({
        name,
        price,
        oldPrice,
        currency: '$',
        sku: '',
        brand: '',
        category: '',
        badge: '',
        link,
        image: img.attr('data-src') || img.attr('src') || '',
        sourcePage: pageUrl,
      });
    }
  });
  return items;
}

function extractProducts($: cheerio.CheerioAPI, pageUrl: string): Product[] {
  // 1. Try GTM data attributes (virtualllantas.com and similar)
  const gtmItems = extractFromGtmLinks($, pageUrl);
  if (gtmItems.length > 0) return gtmItems;

  // 2. Try WooCommerce selectors
  const wooItems = extractFromWooCommerce($, pageUrl);
  if (wooItems.length > 0) return wooItems;

  // 3. Generic fallback
  return extractGenericProducts($, pageUrl);
}

export async function scrapePrices(startUrl: string, onProgress: OnProgress, signal?: AbortSignal, maxItems?: number): Promise<Product[]> {
  const all: Product[] = [];
  const seenUrls = new Set<string>();
  const seenKeys = new Set<string>();

  onProgress({ type: 'log', message: `🔍 Iniciando: ${startUrl}` });
  const firstHtml = await fetchPage(startUrl);

  const pages = await detectPagination(startUrl, firstHtml, m => onProgress({ type: 'log', message: m }));
  onProgress({ type: 'log', message: `📋 ${pages.length} página(s)` });

  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) break;
    if (maxItems && all.length >= maxItems) break;
    const url = pages[i];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    onProgress({ type: 'log', message: `🛒 Página ${i + 1}/${pages.length}: ${url}` });
    onProgress({ type: 'progress', current: i + 1, total: pages.length });

    try {
      const html = url === startUrl ? firstHtml : await fetchPage(url);
      const $ = cheerio.load(html);
      const items = extractProducts($, url);
      let added = 0;
      for (const p of items) {
        if (maxItems && all.length >= maxItems) break;
        const key = `${p.name.toLowerCase()}::${p.price}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); all.push(p); added++; }
      }
      onProgress({ type: 'log', message: `  ✓ ${items.length} productos (${added} nuevos)` });
      onProgress({ type: 'count', count: all.length });
    } catch (e: any) {
      onProgress({ type: 'log', message: `  ⚠️ ${e.message}` });
    }
    if (i < pages.length - 1) await sleep(600 + Math.random() * 400);
  }

  if (maxItems && all.length > maxItems) all.length = maxItems;
  onProgress({ type: 'log', message: `✅ ${all.length} productos${maxItems ? ` (límite: ${maxItems})` : ''}` });
  return all;
}
