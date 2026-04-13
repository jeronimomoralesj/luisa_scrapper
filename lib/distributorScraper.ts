import * as cheerio from 'cheerio';
import {
  fetchPage,
  cleanText,
  detectPagination,
  detectFilters,
  sleep,
  resolveUrl,
  extractEmails,
  extractPhones,
} from './scraper';

export interface Distributor {
  name: string;
  address: string;
  city: string;
  department: string;
  phone: string;
  email: string;
  website: string;
  schedule: string;
  extra: string;
  sourcePage: string;
}

type OnProgress = (evt: object) => void;

const CARD_SELECTORS = [
  '.distribuidor',
  '.distributor',
  '.store-item',
  '.location-item',
  '[class*="distribuidor"]',
  '[class*="distributor"]',
  '[class*="store"]',
  '[class*="dealer"]',
  '[class*="branch"]',
  '[class*="sucursal"]',
  '.card',
  'article',
  '.entry',
  'li.item',
  'tr',
];

function extractDistributors(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): Distributor[] {
  const items: Distributor[] = [];

  // First try: structured cards
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $cards: cheerio.Cheerio<any> = $([]);
  for (const sel of CARD_SELECTORS) {
    const found = $(sel);
    if (found.length >= 2) {
      $cards = found;
      break;
    }
  }

  if ($cards.length === 0) {
    // Fallback: grab the whole body text for contact info
    const bodyText = $.text();
    const emails = extractEmails(bodyText);
    const phones = extractPhones(bodyText);
    if (emails.length || phones.length) {
      items.push({
        name: cleanText($('h1, h2').first().text()) || 'Página principal',
        address: '',
        city: '',
        department: '',
        phone: phones.join(', '),
        email: emails.join(', '),
        website: '',
        schedule: '',
        extra: '',
        sourcePage: pageUrl,
      });
    }
    return items;
  }

  $cards.each((_, el) => {
    const $el = $(el);
    const text = $el.text();

    const name = cleanText(
      $el.find('h2, h3, h4, h5, .title, .name, [class*="name"], [class*="title"], strong').first().text(),
    );
    if (!name || name.length < 2) return;

    const addressEl = $el.find(
      '.address, [class*="address"], [class*="direccion"], [class*="ubicacion"]',
    );
    const address = cleanText(addressEl.text()) || '';

    const cityEl = $el.find('[class*="city"], [class*="ciudad"]');
    const city = cleanText(cityEl.text()) || '';

    const deptEl = $el.find(
      '[class*="department"], [class*="departamento"], [class*="region"]',
    );
    const department = cleanText(deptEl.text()) || '';

    const phoneEl = $el.find(
      '.phone, [class*="phone"], [class*="telefono"], [class*="tel"], a[href^="tel:"]',
    );
    let phone = cleanText(phoneEl.text());
    if (!phone) {
      const phones = extractPhones(text);
      phone = phones.join(', ');
    }

    const emailEl = $el.find(
      '.email, [class*="email"], [class*="correo"], a[href^="mailto:"]',
    );
    let email = cleanText(emailEl.text());
    if (!email) {
      const emails = extractEmails(text);
      email = emails.join(', ');
    }

    const link = $el.find('a[href^="http"]').first();
    const website =
      resolveUrl(
        link.attr('href'),
        pageUrl,
      ) || '';

    const scheduleEl = $el.find(
      '[class*="schedule"], [class*="horario"], [class*="hours"]',
    );
    const schedule = cleanText(scheduleEl.text()) || '';

    // Grab any remaining text snippets not already captured
    const extras: string[] = [];
    $el.find('p, span, div').each((__, child) => {
      const t = cleanText($(child).text());
      if (
        t &&
        t.length > 3 &&
        t.length < 200 &&
        t !== name &&
        t !== address &&
        t !== phone &&
        t !== email &&
        t !== schedule &&
        !extras.includes(t)
      ) {
        extras.push(t);
      }
    });

    items.push({
      name,
      address,
      city,
      department,
      phone,
      email,
      website,
      schedule,
      extra: extras.slice(0, 5).join(' | '),
      sourcePage: pageUrl,
    });
  });

  return items;
}

/** Generate all filter combination URLs (cartesian product). */
function filterCombinations(
  groups: Record<string, { label: string; url: string }[]>,
): string[] {
  const keys = Object.keys(groups);
  if (!keys.length) return [];

  const combos: string[][] = [[]];
  for (const key of keys) {
    const next: string[][] = [];
    for (const prev of combos) {
      for (const opt of groups[key]) {
        next.push([...prev, opt.url]);
      }
    }
    combos.length = 0;
    combos.push(...next);
  }

  // Merge query params from each URL in the combo
  const results = new Set<string>();
  for (const urls of combos) {
    if (urls.length === 0) continue;
    try {
      const base = new URL(urls[0]);
      for (let i = 1; i < urls.length; i++) {
        const u = new URL(urls[i]);
        u.searchParams.forEach((v, k) => base.searchParams.set(k, v));
      }
      results.add(base.href);
    } catch {
      urls.forEach((u) => results.add(u));
    }
  }
  return [...results];
}

export async function scrapeDistributors(
  startUrl: string,
  onProgress: OnProgress,
  signal?: AbortSignal,
  maxItems?: number,
): Promise<Distributor[]> {
  const all: Distributor[] = [];
  const seenUrls = new Set<string>();
  const seenKeys = new Set<string>();

  onProgress({ type: 'log', message: `🔍 Iniciando: ${startUrl}` });
  const firstHtml = await fetchPage(startUrl);

  // Detect filters and build all combo URLs
  const filters = await detectFilters(startUrl, firstHtml, (m) =>
    onProgress({ type: 'log', message: m }),
  );
  const filterUrls = filterCombinations(filters);
  const startingUrls = [startUrl, ...filterUrls.filter((u) => u !== startUrl)];

  onProgress({
    type: 'log',
    message: `🗂️ ${startingUrls.length} URL(s) base (incluye combinaciones de filtros)`,
  });

  // For each starting URL, detect pagination and scrape all pages
  const allPages: string[] = [];
  for (const baseUrl of startingUrls) {
    if (signal?.aborted) break;
    try {
      const html =
        baseUrl === startUrl ? firstHtml : await fetchPage(baseUrl);
      const pages = await detectPagination(baseUrl, html, (m) =>
        onProgress({ type: 'log', message: m }),
      );
      for (const p of pages) {
        if (!seenUrls.has(p)) allPages.push(p);
      }
    } catch (e: any) {
      onProgress({ type: 'log', message: `⚠️ Error en ${baseUrl}: ${e.message}` });
    }
    if (startingUrls.length > 1) await sleep(400);
  }

  // Deduplicate
  const uniquePages = [...new Set(allPages)];
  onProgress({ type: 'log', message: `📋 ${uniquePages.length} página(s) total` });

  for (let i = 0; i < uniquePages.length; i++) {
    if (signal?.aborted) break;
    if (maxItems && all.length >= maxItems) break;
    const url = uniquePages[i];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    onProgress({
      type: 'log',
      message: `📍 Página ${i + 1}/${uniquePages.length}: ${url}`,
    });
    onProgress({ type: 'progress', current: i + 1, total: uniquePages.length });

    try {
      const html = url === startUrl ? firstHtml : await fetchPage(url);
      const $ = cheerio.load(html);
      const items = extractDistributors($, url);
      let added = 0;
      for (const d of items) {
        if (maxItems && all.length >= maxItems) break;
        const key = `${d.name.toLowerCase()}::${d.phone}::${d.email}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          all.push(d);
          added++;
        }
      }
      onProgress({
        type: 'log',
        message: `  ✓ ${items.length} distribuidores (${added} nuevos)`,
      });
      onProgress({ type: 'count', count: all.length });
    } catch (e: any) {
      onProgress({ type: 'log', message: `  ⚠️ ${e.message}` });
    }
    if (i < uniquePages.length - 1) await sleep(600 + Math.random() * 400);
  }

  if (maxItems && all.length > maxItems) all.length = maxItems;
  onProgress({ type: 'log', message: `✅ ${all.length} distribuidores${maxItems ? ` (límite: ${maxItems})` : ''}` });
  return all;
}
