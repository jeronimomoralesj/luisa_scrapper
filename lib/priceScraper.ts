import * as cheerio from 'cheerio';
import { fetchPage, cleanText, detectPagination, sleep, resolveUrl } from './scraper';

export interface Product {
  name: string; price: string; oldPrice: string; currency: string;
  sku: string; brand: string; category: string; badge: string;
  link: string; image: string; sourcePage: string;
}

type OnProgress = (evt: object) => void;

const CARD_SELECTORS = ['li.product', '.product-item', 'article.product', '.woocommerce-loop-product', '.product-grid-item', '.product-card'];

function extractPrice(s: string) {
  const m = s.replace(/\./g, '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

function extractProducts($: cheerio.CheerioAPI, pageUrl: string): Product[] {
  const items: Product[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $cards: cheerio.Cheerio<any> = $([]);
  for (const sel of CARD_SELECTORS) { const f = $(sel); if (f.length > 0) { $cards = f; break; } }

  $cards.each((_, el) => {
    const $el = $(el);
    const name = cleanText($el.find('.woocommerce-loop-product__title, h2.product-title, h3.product-title, h2, h3').first().text());
    if (!name) return;

    const $ins = $el.find('.price ins .woocommerce-Price-amount');
    const priceRaw = $ins.length ? cleanText($ins.text()) : cleanText($el.find('.price .woocommerce-Price-amount, .woocommerce-Price-amount, [class*="price"]').first().text());
    const oldRaw = cleanText($el.find('.price del .woocommerce-Price-amount, del .amount').first().text());

    const img = $el.find('img').first();
    items.push({
      name,
      price: extractPrice(priceRaw),
      oldPrice: extractPrice(oldRaw),
      currency: cleanText($el.find('.woocommerce-Price-currencySymbol').first().text()) || '$',
      sku: cleanText($el.find('.sku, [class*="sku"]').first().text()),
      brand: cleanText($el.find('[class*="brand"], [class*="marca"]').first().text()),
      category: cleanText($el.find('[class*="category"], [class*="categoria"]').first().text()),
      badge: cleanText($el.find('.onsale, [class*="badge"], [class*="sale-tag"]').first().text()),
      link: resolveUrl($el.find('a').first().attr('href'), pageUrl) || '',
      image: img.attr('data-src') || img.attr('src') || '',
      sourcePage: pageUrl,
    });
  });
  return items;
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