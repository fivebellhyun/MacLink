import { apiMessages } from './locales/api.ts';

export type ApiLocale = 'ko' | 'en';

/** Match supported language ranges by their advertised priority, preserving tie order. */
export function negotiateLocale(acceptLanguage: string | null | undefined): ApiLocale {
  const preferences = (acceptLanguage || '').split(',').map((entry, order) => {
    const [range, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { range, q, order };
  }).filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  for (const { range } of preferences) {
    if (/^en(?:-[a-z0-9]+)*$/.test(range)) return 'en';
    if (range === '*' || /^ko(?:-[a-z0-9]+)*$/.test(range)) return 'ko';
  }
  return 'ko';
}

const koreanMessages = new Map(Object.entries(apiMessages).map(([ko, en]) => [en, ko]));

function translateMessage(message: string, locale: ApiLocale): string {
  if (locale === 'en') return Object.hasOwn(apiMessages, message) ? apiMessages[message] : message;
  return koreanMessages.get(message) ?? message;
}

/** Translate only known product messages at message fields, never names or protocol data. */
export function localizeApiPayload<T>(value: T, locale: ApiLocale): T {
  if (Array.isArray(value)) return value.map(item => localizeApiPayload(item, locale)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    ['error', 'reason', 'warning'].includes(key) && typeof item === 'string'
      ? translateMessage(item, locale)
      : localizeApiPayload(item, locale),
  ])) as T;
}
