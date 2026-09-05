'use strict';

const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { TtlCache } = require('../../utils/cache');
const { ValidationError, requireLanguage } = require('../../utils/validation');

/**
 * Wikipedia access built on the official Wikimedia REST APIs:
 *   - /w/rest.php/v1/search/page          (search)
 *   - /api/rest_v1/page/summary/{title}   (article summary)
 *   - /api/rest_v1/page/related/{title}   (related pages)
 *   - /api/rest_v1/page/random/summary    (random article)
 *
 * No HTML scraping anywhere. Responses are cached in-process to stay a polite
 * API citizen, and every request carries a descriptive User-Agent as the
 * Wikimedia API etiquette asks for.
 */

const REQUEST_TIMEOUT_MS = 8000;

const cache = new TtlCache({ ttlMs: config.wikipedia.cacheTtlMs, max: 400 });

class WikipediaError extends Error {
  constructor(message, { code = 'API_ERROR', status, hint } = {}) {
    super(message);
    this.name = 'WikipediaError';
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.userFacing = true;
  }
}

function userAgent() {
  return `m5rcels-tool-doggy/${config.branding.version} (${config.wikipedia.contact}) node/${process.versions.node}`;
}

async function request(url, { signalTimeout = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalTimeout);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent(),
        Accept: 'application/json',
        'Accept-Language': '*',
        'Api-User-Agent': userAgent(),
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (response.status === 404) {
      throw new WikipediaError('That article does not exist on this Wikipedia.', { code: 'NOT_FOUND', status: 404 });
    }
    if (response.status === 429) {
      throw new WikipediaError('Wikipedia is rate limiting us right now — please try again in a moment.', {
        code: 'RATE_LIMITED',
        status: 429,
      });
    }
    if (!response.ok) {
      throw new WikipediaError(`Wikipedia replied with HTTP ${response.status}.`, {
        code: 'HTTP_ERROR',
        status: response.status,
      });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof WikipediaError) throw error;
    if (error.name === 'AbortError') {
      throw new WikipediaError('Wikipedia took too long to answer.', { code: 'TIMEOUT' });
    }
    logger.warn('Wikipedia request failed', { url: String(url).split('?')[0], error });
    throw new WikipediaError('The doggy could not reach Wikipedia right now.', { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
}

function apiBase(language) {
  return `https://${language}.wikipedia.org`;
}

/** Search excerpts come back with <span class="searchmatch"> markup. */
function stripHtml(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function articleUrl(language, title) {
  return `${apiBase(language)}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

/**
 * Full-text search.
 * @returns {Promise<{ language: string, query: string, results: Array }>}
 */
async function search(query, { language, limit = 5 } = {}) {
  const lang = requireLanguage(language, config.wikipedia.defaultLanguage);
  const text = String(query ?? '').trim();
  if (!text) throw new ValidationError('Tell the doggy what to search for.');
  if (text.length > 300) throw new ValidationError('That search query is too long.');

  const count = Math.min(10, Math.max(1, limit));
  const url = `${apiBase(lang)}/w/rest.php/v1/search/page?q=${encodeURIComponent(text)}&limit=${count}`;
  const key = `search:${lang}:${count}:${text.toLowerCase()}`;

  const payload = await cache.wrap(key, () => request(url));
  const results = (payload.pages || []).map((page) => ({
    id: page.id,
    key: page.key,
    title: page.title,
    description: page.description || null,
    excerpt: page.excerpt ? stripHtml(page.excerpt) : null,
    thumbnail: page.thumbnail?.url ? normaliseProtocol(page.thumbnail.url) : null,
    url: articleUrl(lang, page.key || page.title),
  }));

  return { language: lang, query: text, results };
}

/** Wikimedia often returns protocol-relative thumbnail URLs. */
function normaliseProtocol(url) {
  return String(url).startsWith('//') ? `https:${url}` : String(url);
}

/**
 * Article summary. Disambiguation pages are reported rather than pretended away.
 * @returns {Promise<object>}
 */
async function article(title, { language } = {}) {
  const lang = requireLanguage(language, config.wikipedia.defaultLanguage);
  const text = String(title ?? '').trim();
  if (!text) throw new ValidationError('Tell the doggy which article to fetch.');
  if (text.length > 300) throw new ValidationError('That title is too long.');

  const encoded = encodeURIComponent(text.replace(/ /g, '_'));
  const url = `${apiBase(lang)}/api/rest_v1/page/summary/${encoded}?redirect=true`;
  const key = `summary:${lang}:${text.toLowerCase()}`;

  let payload;
  try {
    payload = await cache.wrap(key, () => request(url));
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      // Fall back to search so the user gets suggestions instead of a dead end.
      const fallback = await search(text, { language: lang, limit: 5 }).catch(() => ({ results: [] }));
      const notFound = new WikipediaError(`No article titled **${text}** on the ${lang} Wikipedia.`, {
        code: 'NOT_FOUND',
      });
      notFound.suggestions = fallback.results;
      throw notFound;
    }
    throw error;
  }

  return shapeSummary(payload, lang);
}

/** Random article summary — never cached, that would defeat the point. */
async function random({ language } = {}) {
  const lang = requireLanguage(language, config.wikipedia.defaultLanguage);
  const payload = await request(`${apiBase(lang)}/api/rest_v1/page/random/summary`);
  return shapeSummary(payload, lang);
}

/** Titles for the `/wiki article` autocomplete, via the OpenSearch endpoint. */
async function suggestTitles(prefix, { language, limit = 10 } = {}) {
  const lang = requireLanguage(language, config.wikipedia.defaultLanguage);
  const text = String(prefix ?? '').trim();
  if (text.length < 2) return [];
  const url =
    `${apiBase(lang)}/w/api.php?action=opensearch&format=json&limit=${Math.min(10, limit)}` +
    `&namespace=0&search=${encodeURIComponent(text)}`;
  const key = `suggest:${lang}:${text.toLowerCase()}`;
  try {
    const payload = await cache.wrap(key, () => request(url, { signalTimeout: 2500 }), 60000);
    return Array.isArray(payload?.[1]) ? payload[1] : [];
  } catch {
    return []; // Autocomplete must never surface an error to the user.
  }
}

function shapeSummary(payload, language) {
  const isDisambiguation = payload.type === 'disambiguation';
  return {
    language,
    type: payload.type || 'standard',
    isDisambiguation,
    title: payload.titles?.normalized || payload.title,
    displayTitle: stripHtml(payload.titles?.display || payload.title),
    description: payload.description || null,
    extract: payload.extract || null,
    thumbnail: payload.thumbnail?.source ? normaliseProtocol(payload.thumbnail.source) : null,
    image: payload.originalimage?.source ? normaliseProtocol(payload.originalimage.source) : null,
    url: payload.content_urls?.desktop?.page || articleUrl(language, payload.title),
    mobileUrl: payload.content_urls?.mobile?.page || null,
    lastModified: payload.timestamp || null,
    coordinates: payload.coordinates || null,
    pageId: payload.pageid ?? null,
  };
}

function stats() {
  return { cacheSize: cache.size };
}

module.exports = { search, article, random, suggestTitles, WikipediaError, stats, stripHtml, cache };
