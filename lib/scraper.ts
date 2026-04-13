import axios from 'axios';
import * as cheerio from 'cheerio';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

export async function fetchPage(url: string, timeout = 20000): Promise<string> {
  const res = await axios.get(url, { headers: HEADERS, timeout, maxRedirects: 8, validateStatus: s => s < 500 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.data;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const cleanText = (s: string | undefined) => (s ? s.replace(/\s+/g, ' ').trim() : '');

export function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

export function extractEmails(text: string): string[] {
  const raw = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(raw.filter(e => !/\.(png|jpg|gif|svg|webp|css|js)$/i.test(e)))];
}

export function extractPhones(text: string): string[] {
  const patterns = [
    /\+57[\s\-.]?3\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}/g,
    /\b3[0-9]{2}[\s\-.]?[0-9]{3}[\s\-.]?[0-9]{4}\b/g,
    /\b60[1-8][\s\-.]?[0-9]{7}\b/g,
    /\([0-9]{1,3}\)[\s\-.]?[0-9]{3,4}[\s\-.]?[0-9]{4}/g,
  ];
  const found = new Set<string>();
  for (const re of patterns) (text.match(re) || []).forEach(m => found.add(m.trim()));
  return [...found];
}

export async function detectPagination(baseUrl: string, html: string, onLog?: (m: string) => void): Promise<string[]> {
  const $ = cheerio.load(html);
  const urls = new Set([baseUrl]);

  $('a.page-numbers, .pagination a, .wp-pagenavi a, nav.navigation a, [class*="pagination"] a').each((_, el) => {
    const r = resolveUrl($(el).attr('href'), baseUrl);
    if (r) urls.add(r);
  });

  let maxPage = 1;
  $('a.page-numbers, [class*="pagination"] a').each((_, el) => {
    const n = parseInt(cleanText($(el).text()), 10);
    if (!isNaN(n) && n > maxPage) maxPage = n;
  });

  if (maxPage > 1) {
    const cleanBase = baseUrl.replace(/\/page\/\d+\/?/, '').replace(/[?&]paged?=\d+/, '').replace(/\/$/, '');
    const usesQuery = [...urls].some(u => /[?&]paged?=\d+/.test(u));
    for (let i = 2; i <= maxPage; i++) {
      if (usesQuery) {
        const u = new URL(cleanBase); u.searchParams.set('page', String(i)); urls.add(u.href);
      } else {
        urls.add(`${cleanBase}/page/${i}/`);
      }
    }
  }

  const result = [...urls];
  if (onLog && result.length > 1) onLog(`📄 ${result.length} páginas detectadas`);
  return result;
}

export async function detectFilters(baseUrl: string, html: string, onLog?: (m: string) => void) {
  const $ = cheerio.load(html);
  const groups: Record<string, { label: string; url: string }[]> = {};

  $('.widget_layered_nav, [class*="layered-nav"]').each((_, widget) => {
    const name = cleanText($(widget).find('.widgettitle, .widget-title, h2, h3, h4').first().text()) || 'filter';
    $(widget).find('li a').each((__, a) => {
      const url = resolveUrl($(a).attr('href'), baseUrl);
      const label = cleanText($(a).text()).replace(/\(\d+\)/, '').trim();
      if (url && label) { if (!groups[name]) groups[name] = []; groups[name].push({ label, url }); }
    });
  });

  $('select').each((_, sel) => {
    const name = cleanText($(sel).attr('name') || $(sel).attr('id') || '');
    if (!name) return;
    $(sel).find('option[value]').each((__, opt) => {
      const val = $(opt).attr('value'); const label = cleanText($(opt).text());
      if (!val || !label) return;
      try { const u = new URL(baseUrl); u.searchParams.set(name, val); if (!groups[name]) groups[name] = []; groups[name].push({ label, url: u.href }); } catch {}
    });
  });

  for (const key of Object.keys(groups)) {
    const seen = new Set<string>();
    groups[key] = groups[key].filter(({ url }) => { if (seen.has(url)) return false; seen.add(url); return true; });
    if (!groups[key].length) delete groups[key];
  }

  if (onLog) { const t = Object.values(groups).flat().length; if (t) onLog(`🔎 ${t} opciones de filtro`); }
  return groups;
}