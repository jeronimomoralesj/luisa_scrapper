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
  tipo: string;
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

/**
 * Extract distributors from Elementor loop items (e.g. reencafe.com).
 * Each `.e-loop-item` has CSS classes like `departamento-*`, `ciudad-*`, `tipo_de_distribuidor-*`.
 * Data is in sequential text-editor widgets after bold labels.
 */
function extractFromElementorLoopItems(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): Distributor[] {
  const items: Distributor[] = [];
  const $cards = $('.e-loop-item');
  if ($cards.length === 0) return items;

  $cards.each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';

    // Name from .elementor-heading-title
    const name = cleanText($el.find('.elementor-heading-title').first().text());
    if (!name || name.length < 2) return;

    // Address: first list item with map-marker icon
    const $listItems = $el.find('.elementor-icon-list-item');
    const address = cleanText($listItems.eq(0).find('.elementor-icon-list-text').text()) || '';

    // Phone: second list item with phone icon
    let phone = cleanText($listItems.eq(1).find('.elementor-icon-list-text').text()) || '';
    phone = phone.replace(/^-\s*/, '').replace(/\s*-\s*$/, '').trim();

    // Extract tipo, departamento, ciudad from CSS classes
    const tipoMatch = classes.match(/tipo_de_distribuidor-([\w-]+)/);
    const deptMatch = classes.match(/departamento-([\w-]+)/);
    const ciudadMatch = classes.match(/ciudad-([\w-]+)/);

    const tipoFromClass = tipoMatch
      ? tipoMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : '';
    const deptFromClass = deptMatch
      ? deptMatch[1].replace(/-/g, ' ').toUpperCase()
      : '';
    const ciudadFromClass = ciudadMatch
      ? ciudadMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : '';

    // Also try to read from the text-editor widgets (more accurate)
    let tipo = '';
    let department = '';
    let city = '';
    const $widgets = $el.find('.elementor-widget-text-editor');
    $widgets.each((__, w) => {
      const $w = $(w);
      const strong = cleanText($w.find('strong').text());
      if (strong.includes('Tipo')) {
        // The next sibling widget has the value
        const nextWidget = $w.next('.elementor-widget-text-editor');
        if (nextWidget.length) tipo = cleanText(nextWidget.find('span').text() || nextWidget.text());
      } else if (strong.includes('Ubicación')) {
        // Next two sibling widgets: department, then city
        const deptWidget = $w.next('.elementor-widget-text-editor');
        if (deptWidget.length) {
          department = cleanText(deptWidget.find('span').text() || deptWidget.text());
          const cityWidget = deptWidget.next('.elementor-widget-text-editor');
          if (cityWidget.length) city = cleanText(cityWidget.find('span').text() || cityWidget.text());
        }
      }
    });

    // Fallback to CSS class values
    if (!department) department = deptFromClass;
    if (!city) city = ciudadFromClass;
    if (!tipo) tipo = tipoFromClass;

    items.push({
      name,
      address,
      city,
      department,
      phone,
      email: '',
      website: '',
      schedule: '',
      tipo,
      extra: '',
      sourcePage: pageUrl,
    });
  });

  return items;
}

/**
 * Extract distributors from data-attribute cards (e.g. tiendaredllantas.co).
 * Each `.divDis` has data-nombres, data-departamento, data-ciudad, data-tipo.
 */
function extractFromDataCards(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): Distributor[] {
  const items: Distributor[] = [];
  const $cards = $('.divDis, [data-nombres]');
  if ($cards.length === 0) return items;

  $cards.each((_, el) => {
    const $el = $(el);

    // Name: prefer data-razon (trade name) if present, else data-nombres, else h5
    const razon = cleanText($el.attr('data-razon') || '');
    const nombres = cleanText($el.attr('data-nombres') || '');
    const h5Name = cleanText($el.find('h5').first().text());
    const name = razon || nombres || h5Name;
    if (!name || name.length < 2) return;

    const department = cleanText($el.attr('data-departamento') || '');
    const city = cleanText($el.attr('data-ciudad') || '');
    const tipo = cleanText($el.attr('data-tipo') || '');

    // Address: first .shop-item-code paragraph (the street)
    const $codes = $el.find('.shop-item-code');
    const address = cleanText($codes.eq(0).text()) || '';

    // Location line: "DEPARTAMENTO - CIUDAD" (second .shop-item-code)
    // Already extracted from data attributes, skip this

    // Schedule: text after "Horarios de atención:"
    let schedule = '';
    $el.find('b').each((__, b) => {
      if ($(b).text().includes('Horarios')) {
        const nextP = $(b).next('p');
        if (nextP.length) schedule = cleanText(nextP.text());
      }
    });

    // Phone: text inside .shop-item-code after "Teléfonos:" bold
    let phone = '';
    $el.find('b').each((__, b) => {
      if ($(b).text().includes('Teléfono') || $(b).text().includes('Telefono')) {
        const nextP = $(b).next('p.shop-item-code');
        if (nextP.length) {
          phone = cleanText(nextP.text())
            .replace(/^-\s*/, '')
            .replace(/\s*-\s*$/, '')
            .replace(/\s*-\s*-\s*/g, ', ')
            .replace(/\s*-\s*/g, ', ')
            .replace(/,\s*,/g, ',')
            .replace(/,\s*$/, '')
            .trim();
        }
      }
    });

    // Email: inside .shop-three-products-price
    const emailRaw = cleanText($el.find('.shop-three-products-price').text());
    const email = emailRaw
      .split(/[,;]\s*/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'))
      .join(', ');

    // Google Maps link
    const mapsLink = $el.find('a[href*="google.com/maps"]').attr('href') || '';

    // Sub-name (razón social shown as <b>)
    const subName = cleanText($el.find('b.shop-three-products-name').text());

    const extras: string[] = [];
    if (subName && subName !== name) extras.push(subName);
    if (mapsLink) extras.push(mapsLink);

    items.push({
      name,
      address,
      city,
      department,
      phone,
      email,
      website: '',
      schedule,
      tipo,
      extra: extras.join(' | '),
      sourcePage: pageUrl,
    });
  });

  return items;
}

function extractDistributors(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): Distributor[] {
  // Try Elementor loop items first (e.g. reencafe.com)
  const elementorItems = extractFromElementorLoopItems($, pageUrl);
  if (elementorItems.length > 0) return elementorItems;

  // Try site-specific data-attribute cards (e.g. tiendaredllantas.co)
  const dataItems = extractFromDataCards($, pageUrl);
  if (dataItems.length > 0) return dataItems;

  const items: Distributor[] = [];

  // Generic card-based extraction
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
        tipo: '',
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
      tipo: '',
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
