type FetchLike = typeof fetch;

export type NormalizedUrlInfo = {
	rawUrl: string;
	normalizedUrl: string;
	hostname: string;
	pathname: string;
	search: string;
};

export type PageFetchResult = {
	ok: boolean;
	status?: number;
	html?: string;
	finalUrl?: string;
	warnings: string[];
};

export type BookClues = {
	isbn10?: string;
	isbn13?: string;
	olid?: string;
	openLibraryUrl?: string;
	title?: string;
	subtitle?: string;
	authors?: string[];
	publisher?: string;
	publishYear?: string;
	confidence: number;
	clues: string[];
	warnings: string[];
};

export type NormalizedBookAuthor = {
	full: string;
	given: string;
	family: string;
};

export type NormalizedBookMetadata = {
	sourceType: 'book';
	title: string;
	subtitle: string;
	authors: NormalizedBookAuthor[];
	publisher: string;
	publishDate: string;
	year: string;
	isbn10: string;
	isbn13: string;
	olid: string;
	editionOlid: string;
	workOlid: string;
	openLibraryUrl: string;
	sourceUrl: string;
	confidence: number;
	warnings: string[];
};

export type OpenLibraryLookupResult = {
	candidates: NormalizedBookMetadata[];
	warnings: string[];
};

export type RankedBookCandidate = {
	candidate: NormalizedBookMetadata;
	score: number;
	reasons: string[];
};

export type RankedBookCandidates = {
	bestMatch: RankedBookCandidate | null;
	scoredCandidates: RankedBookCandidate[];
	warnings: string[];
};

export type BookResolveMethod = 'isbn' | 'olid' | 'title-author' | 'title-only' | 'none';

export type DetectResolveBookResult = {
	found: boolean;
	sourceType: 'book' | 'unknown';
	confidence: number;
	method: BookResolveMethod;
	metadata: NormalizedBookMetadata;
	clues: BookClues;
	warnings: string[];
};

export type BookResolverOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;

const TRACKING_QUERY_PREFIXES = ['utm_', 'mc_', 'ga_'] as const;
const TRACKING_QUERY_KEYS = new Set([
	'fbclid',
	'gclid',
	'igshid',
	'mkt_tok',
	'ref',
	'ref_src',
	'source',
	'cmpid',
	'campaignid',
	'yclid',
	'_hsenc',
	'_hsmi'
]);

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const TITLE_TAG_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const OPEN_LIBRARY_BOOK_PATTERN = /\/books\/(OL\d+M)(?:\/|$)/i;
const OPEN_LIBRARY_WORK_PATTERN = /\/works\/(OL\d+W)(?:\/|$)/i;
const OPEN_LIBRARY_ISBN_PATTERN = /\/isbn\/([0-9Xx\-]{10,20})(?:\/|$)/i;
const OPEN_LIBRARY_GENERIC_OLID_PATTERN = /\b(OL\d+[MW])\b/i;

const YEAR_PATTERN = /\b(1[5-9]\d{2}|20\d{2}|2100)\b/;
const ISBN_TEXT_PATTERN = /\b(?:ISBN(?:-1[03])?:?\s*)?([0-9Xx][0-9Xx\-\s]{8,22}[0-9Xx])\b/g;

const clampConfidence = (value: number): number =>
	Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));

const toTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const normalized = compactWhitespace(value);
		if (!normalized) {
			continue;
		}

		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		result.push(normalized);
	}

	return result;
};

const decodeHtmlEntities = (value: string): string =>
	value
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&nbsp;/gi, ' ');

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
	for (const value of values) {
		const normalized = toTrimmedString(value);
		if (normalized) {
			return normalized;
		}
	}

	return '';
};

const normalizeCompareText = (value: string): string =>
	compactWhitespace(decodeHtmlEntities(value))
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const splitTokens = (value: string): string[] => {
	const normalized = normalizeCompareText(value);
	if (!normalized) {
		return [];
	}

	return normalized.split(' ').filter(Boolean);
};

const scoreTitleSimilarity = (left: string, right: string): number => {
	const a = normalizeCompareText(left);
	const b = normalizeCompareText(right);

	if (!a || !b) {
		return 0;
	}

	if (a === b) {
		return 1;
	}

	if (a.includes(b) || b.includes(a)) {
		const minLength = Math.min(a.length, b.length);
		const maxLength = Math.max(a.length, b.length);
		return minLength / maxLength;
	}

	const aTokens = new Set(splitTokens(a));
	const bTokens = new Set(splitTokens(b));
	if (aTokens.size === 0 || bTokens.size === 0) {
		return 0;
	}

	let overlap = 0;
	for (const token of aTokens) {
		if (bTokens.has(token)) {
			overlap += 1;
		}
	}

	const union = aTokens.size + bTokens.size - overlap;
	if (union === 0) {
		return 0;
	}

	return overlap / union;
};

const parseTagAttributes = (tagSource: string): Record<string, string> => {
	const attributes: Record<string, string> = {};
	for (const match of tagSource.matchAll(ATTRIBUTE_PATTERN)) {
		const key = toTrimmedString(match[1]).toLowerCase();
		const value = firstNonEmpty(match[3], match[4], match[5]);
		if (!key || !value) {
			continue;
		}

		attributes[key] = decodeHtmlEntities(value);
	}

	return attributes;
};

const parseMetaTagsSafely = (html: string): Map<string, string[]> => {
	const map = new Map<string, string[]>();

	for (const tag of html.match(META_TAG_PATTERN) ?? []) {
		const attributes = parseTagAttributes(tag);
		const key = firstNonEmpty(
			attributes.name,
			attributes.property,
			attributes.itemprop,
			attributes['http-equiv']
		)
			.toLowerCase()
			.trim();
		const content = compactWhitespace(firstNonEmpty(attributes.content, attributes.value));
		if (!key || !content) {
			continue;
		}

		const existing = map.get(key) ?? [];
		existing.push(content);
		map.set(key, existing);
	}

	return map;
};

const parseCanonicalUrlSafely = (html: string): string => {
	for (const tag of html.match(LINK_TAG_PATTERN) ?? []) {
		const attributes = parseTagAttributes(tag);
		const rel = toTrimmedString(attributes.rel).toLowerCase();
		if (!rel.includes('canonical')) {
			continue;
		}

		const href = toTrimmedString(attributes.href);
		if (href) {
			return href;
		}
	}

	return '';
};

const parseTitleTagSafely = (html: string): string => {
	const match = html.match(TITLE_TAG_PATTERN);
	if (!match?.[1]) {
		return '';
	}

	return compactWhitespace(decodeHtmlEntities(match[1]));
};

const parseJsonLdSafely = (html: string): unknown[] => {
	const nodes: unknown[] = [];

	for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
		const raw = toTrimmedString(match[1]);
		if (!raw) {
			continue;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			nodes.push(parsed);
		} catch {
			continue;
		}
	}

	return nodes;
};

const flattenJsonLdNodes = (node: unknown, bucket: Record<string, unknown>[]): void => {
	if (!node) {
		return;
	}

	if (Array.isArray(node)) {
		for (const item of node) {
			flattenJsonLdNodes(item, bucket);
		}
		return;
	}

	if (typeof node !== 'object') {
		return;
	}

	const record = node as Record<string, unknown>;
	if (Array.isArray(record['@graph'])) {
		flattenJsonLdNodes(record['@graph'], bucket);
	}

	bucket.push(record);
};

const isBookSchemaNode = (node: Record<string, unknown>): boolean => {
	const typeValue = node['@type'];
	if (typeof typeValue === 'string') {
		return typeValue.toLowerCase().includes('book');
	}

	if (Array.isArray(typeValue)) {
		return typeValue.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes('book'));
	}

	return false;
};

const extractYear = (value: string): string => {
	const match = value.match(YEAR_PATTERN);
	return match?.[1] ?? '';
};

const splitAuthorName = (fullName: string): { given: string; family: string } => {
	const normalized = compactWhitespace(fullName);
	if (!normalized) {
		return { given: '', family: '' };
	}

	if (normalized.includes(',')) {
		const [familyPart, ...givenParts] = normalized.split(',');
		return {
			given: compactWhitespace(givenParts.join(' ')),
			family: compactWhitespace(familyPart)
		};
	}

	const parts = normalized.split(' ').filter(Boolean);
	if (parts.length === 1) {
		return { given: '', family: parts[0] };
	}

	return {
		given: parts.slice(0, -1).join(' '),
		family: parts.at(-1) ?? ''
	};
};

const isLikelyIdentifierKey = (key: string): boolean =>
	/isbn|olid|openlibrary|book|work|edition|id|sku|asin|product/.test(key.toLowerCase());

const safeDecode = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const sanitizeIsbnRaw = (value: string): string => value.toUpperCase().replace(/[^0-9X]/g, '');

const isValidIsbn10 = (isbn10: string): boolean => {
	if (!/^\d{9}[\dX]$/.test(isbn10)) {
		return false;
	}

	let sum = 0;
	for (let index = 0; index < 10; index += 1) {
		const char = isbn10[index];
		const value = char === 'X' ? 10 : Number(char);
		sum += value * (10 - index);
	}

	return sum % 11 === 0;
};

const isValidIsbn13 = (isbn13: string): boolean => {
	if (!/^\d{13}$/.test(isbn13)) {
		return false;
	}

	let sum = 0;
	for (let index = 0; index < 12; index += 1) {
		const value = Number(isbn13[index]);
		sum += value * (index % 2 === 0 ? 1 : 3);
	}

	const checkDigit = (10 - (sum % 10)) % 10;
	return checkDigit === Number(isbn13[12]);
};

const normalizeIsbn = (value: string): { isbn10?: string; isbn13?: string } => {
	const sanitized = sanitizeIsbnRaw(value);
	if (!sanitized) {
		return {};
	}

	if (sanitized.length === 10 && isValidIsbn10(sanitized)) {
		return { isbn10: sanitized };
	}

	if (sanitized.length === 13 && isValidIsbn13(sanitized)) {
		return { isbn13: sanitized };
	}

	return {};
};

const extractISBNFromText = (value: string): { isbn10?: string; isbn13?: string; all: string[] } => {
	const matches = Array.from(value.matchAll(ISBN_TEXT_PATTERN));
	const isbn10s: string[] = [];
	const isbn13s: string[] = [];

	for (const match of matches) {
		const raw = toTrimmedString(match[1]);
		if (!raw) {
			continue;
		}

		const normalized = normalizeIsbn(raw);
		if (normalized.isbn10) {
			isbn10s.push(normalized.isbn10);
		}
		if (normalized.isbn13) {
			isbn13s.push(normalized.isbn13);
		}
	}

	const unique10 = uniqueStrings(isbn10s);
	const unique13 = uniqueStrings(isbn13s);
	return {
		isbn10: unique10[0],
		isbn13: unique13[0],
		all: [...unique13, ...unique10]
	};
};

const extractOpenLibraryIds = (value: string): {
	olid?: string;
	editionOlid?: string;
	workOlid?: string;
	isbn?: string;
} => {
	const editionMatch = value.match(OPEN_LIBRARY_BOOK_PATTERN);
	const workMatch = value.match(OPEN_LIBRARY_WORK_PATTERN);
	const isbnMatch = value.match(OPEN_LIBRARY_ISBN_PATTERN);
	const genericOlidMatch = value.match(OPEN_LIBRARY_GENERIC_OLID_PATTERN);

	const editionOlid = toTrimmedString(editionMatch?.[1]).toUpperCase();
	const workOlid = toTrimmedString(workMatch?.[1]).toUpperCase();
	const genericOlid = toTrimmedString(genericOlidMatch?.[1]).toUpperCase();
	const isbnRaw = toTrimmedString(isbnMatch?.[1]);
	const isbn = firstNonEmpty(normalizeIsbn(isbnRaw).isbn13, normalizeIsbn(isbnRaw).isbn10);

	const bestOlid = firstNonEmpty(editionOlid, workOlid, genericOlid);

	return {
		olid: bestOlid,
		editionOlid,
		workOlid,
		isbn
	};
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
	if (Array.isArray(value)) {
		return value;
	}
	if (value == null) {
		return [];
	}
	return [value];
};

const normalizeAuthorNames = (value: unknown): string[] => {
	const authors: string[] = [];
	const pushAuthor = (name: string): void => {
		const normalized = compactWhitespace(name);
		if (normalized) {
			authors.push(normalized);
		}
	};

	for (const item of asArray(value)) {
		if (typeof item === 'string') {
			pushAuthor(item);
			continue;
		}

		if (!item || typeof item !== 'object') {
			continue;
		}

		const record = item as Record<string, unknown>;
		const name = firstNonEmpty(
			toTrimmedString(record.name),
			toTrimmedString((record.author as Record<string, unknown> | undefined)?.name)
		);
		if (name) {
			pushAuthor(name);
		}
	}

	return uniqueStrings(authors);
};

const toNormalizedBookAuthors = (authors: string[]): NormalizedBookAuthor[] =>
	authors.map((author) => {
		const split = splitAuthorName(author);
		return {
			full: author,
			given: split.given,
			family: split.family
		};
	});

const cleanTitle = (title: string): string => {
	const normalized = compactWhitespace(title);
	if (!normalized) {
		return '';
	}

	const separators = [' | ', ' - ', ' — ', ' · '];
	for (const separator of separators) {
		const parts = normalized.split(separator).map((part) => compactWhitespace(part));
		if (parts.length < 2) {
			continue;
		}

		const [first] = parts;
		if (first.split(' ').length >= 3) {
			return first;
		}
	}

	return normalized;
};

const withTimeout = async <T>(
	promiseFactory: () => Promise<T>,
	timeoutMs: number,
	errorMessage: string
): Promise<T> => {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(errorMessage));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promiseFactory(), timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
};

const buildOpenLibraryUrl = (pathOrUrl: string): string => {
	if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
		return pathOrUrl;
	}

	if (!pathOrUrl.startsWith('/')) {
		return `${OPEN_LIBRARY_BASE_URL}/${pathOrUrl}`;
	}

	return `${OPEN_LIBRARY_BASE_URL}${pathOrUrl}`;
};

const fetchJson = async (
	url: string,
	options: BookResolverOptions,
	warnings: string[],
	label: string
): Promise<unknown | null> => {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	try {
		const response = await withTimeout(
			() =>
				fetchImpl(url, {
					headers: {
						accept: 'application/json,text/plain;q=0.9,*/*;q=0.8'
					}
				}),
			timeoutMs,
			`${label} request timed out`
		);

		if (!response.ok) {
			warnings.push(`${label} request failed (${response.status}).`);
			return null;
		}

		const contentType = toTrimmedString(response.headers.get('content-type')).toLowerCase();
		if (!contentType.includes('json')) {
			warnings.push(`${label} returned non-JSON content.`);
		}

		return (await response.json()) as unknown;
	} catch (error) {
		warnings.push(
			error instanceof Error ? `${label} request error: ${error.message}` : `${label} request error.`
		);
		return null;
	}
};

const normalizeOlid = (value: string): string => {
	const match = value.toUpperCase().match(/OL\d+[MW]/);
	return match?.[0] ?? '';
};

const mergeWarnings = (...warningSets: string[][]): string[] => uniqueStrings(warningSets.flat());

const chooseBestIsbn = (source: {
	isbn10?: string;
	isbn13?: string;
	identifiers?: Record<string, unknown>;
	isbn?: unknown;
}): { isbn10: string; isbn13: string } => {
	const isbn10Candidates: string[] = [];
	const isbn13Candidates: string[] = [];

	const fromDirect = [source.isbn10, source.isbn13].filter(Boolean) as string[];
	for (const item of fromDirect) {
		const normalized = normalizeIsbn(item);
		if (normalized.isbn10) {
			isbn10Candidates.push(normalized.isbn10);
		}
		if (normalized.isbn13) {
			isbn13Candidates.push(normalized.isbn13);
		}
	}

	for (const item of asArray(source.isbn)) {
		if (typeof item !== 'string') {
			continue;
		}
		const normalized = normalizeIsbn(item);
		if (normalized.isbn10) {
			isbn10Candidates.push(normalized.isbn10);
		}
		if (normalized.isbn13) {
			isbn13Candidates.push(normalized.isbn13);
		}
	}

	const identifiers = source.identifiers ?? {};
	for (const key of Object.keys(identifiers)) {
		const keyLower = key.toLowerCase();
		if (!keyLower.includes('isbn')) {
			continue;
		}

		for (const item of asArray(identifiers[key])) {
			if (typeof item !== 'string') {
				continue;
			}
			const normalized = normalizeIsbn(item);
			if (normalized.isbn10) {
				isbn10Candidates.push(normalized.isbn10);
			}
			if (normalized.isbn13) {
				isbn13Candidates.push(normalized.isbn13);
			}
		}
	}

	return {
		isbn10: uniqueStrings(isbn10Candidates)[0] ?? '',
		isbn13: uniqueStrings(isbn13Candidates)[0] ?? ''
	};
};

export const normalizeBookMetadata = (source: {
	title?: unknown;
	subtitle?: unknown;
	authors?: unknown;
	author_name?: unknown;
	publisher?: unknown;
	publishers?: unknown;
	publishDate?: unknown;
	publish_date?: unknown;
	first_publish_year?: unknown;
	identifiers?: Record<string, unknown>;
	isbn10?: string;
	isbn13?: string;
	isbn?: unknown;
	olid?: unknown;
	editionOlid?: unknown;
	workOlid?: unknown;
	key?: unknown;
	url?: unknown;
	openLibraryUrl?: unknown;
	sourceUrl?: unknown;
	confidence?: unknown;
	warnings?: unknown;
}): NormalizedBookMetadata => {
	const title = cleanTitle(toTrimmedString(source.title));
	const subtitle = compactWhitespace(toTrimmedString(source.subtitle));
	const authors = normalizeAuthorNames(firstNonEmpty('', '') ? [] : source.authors ?? source.author_name);

	const publisherCandidates: string[] = [];
	for (const value of asArray(source.publisher)) {
		if (typeof value === 'string') {
			publisherCandidates.push(value);
		}
	}
	for (const value of asArray(source.publishers)) {
		if (typeof value === 'string') {
			publisherCandidates.push(value);
			continue;
		}
		if (value && typeof value === 'object') {
			const name = toTrimmedString((value as Record<string, unknown>).name);
			if (name) {
				publisherCandidates.push(name);
			}
		}
	}

	const publishDate = compactWhitespace(
		firstNonEmpty(
			toTrimmedString(source.publishDate),
			toTrimmedString(source.publish_date),
			toTrimmedString(source.first_publish_year)
		)
	);
	const year = extractYear(publishDate);

	const isbn = chooseBestIsbn({
		isbn10: source.isbn10,
		isbn13: source.isbn13,
		identifiers: source.identifiers,
		isbn: source.isbn
	});

	const keyValue = toTrimmedString(source.key);
	const keyIds = extractOpenLibraryIds(keyValue);
	const directOlid = normalizeOlid(toTrimmedString(source.olid));
	const editionOlid = normalizeOlid(firstNonEmpty(toTrimmedString(source.editionOlid), keyIds.editionOlid));
	const workOlid = normalizeOlid(firstNonEmpty(toTrimmedString(source.workOlid), keyIds.workOlid));
	const olid = normalizeOlid(firstNonEmpty(directOlid, editionOlid, workOlid, keyIds.olid));

	const openLibraryUrl = firstNonEmpty(
		toTrimmedString(source.openLibraryUrl),
		toTrimmedString(source.url),
		editionOlid ? `${OPEN_LIBRARY_BASE_URL}/books/${editionOlid}` : '',
		workOlid ? `${OPEN_LIBRARY_BASE_URL}/works/${workOlid}` : '',
		olid ? `${OPEN_LIBRARY_BASE_URL}/books/${olid}` : ''
	);

	const confidenceInput =
		typeof source.confidence === 'number' && Number.isFinite(source.confidence)
			? source.confidence
			: title
				? 0.5
				: 0;
	const confidence = clampConfidence(confidenceInput);

	const warnings = toStringArray(source.warnings);

	return {
		sourceType: 'book',
		title,
		subtitle,
		authors: toNormalizedBookAuthors(authors),
		publisher: uniqueStrings(publisherCandidates)[0] ?? '',
		publishDate,
		year,
		isbn10: isbn.isbn10,
		isbn13: isbn.isbn13,
		olid,
		editionOlid,
		workOlid,
		openLibraryUrl,
		sourceUrl: toTrimmedString(source.sourceUrl),
		confidence,
		warnings
	};
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.map((item) => toTrimmedString(item)).filter(Boolean);
};

const addClueConfidence = (confidence: number, increment: number): number => clampConfidence(confidence + increment);

export const normalizeUrl = (url: string): NormalizedUrlInfo => {
	const rawUrl = url;
	const trimmed = url.trim();
	if (!trimmed) {
		return {
			rawUrl,
			normalizedUrl: '',
			hostname: '',
			pathname: '',
			search: ''
		};
	}

	const candidates = trimmed.startsWith('http://') || trimmed.startsWith('https://')
		? [trimmed]
		: [`https://${trimmed}`, `http://${trimmed}`];

	let parsed: URL | null = null;
	for (const candidate of candidates) {
		try {
			parsed = new URL(candidate);
			break;
		} catch {
			continue;
		}
	}

	if (!parsed) {
		return {
			rawUrl,
			normalizedUrl: '',
			hostname: '',
			pathname: '',
			search: ''
		};
	}

	const cleaned = new URL(parsed.toString());
	const keptParams = new URLSearchParams();

	for (const [key, value] of cleaned.searchParams.entries()) {
		const lowerKey = key.toLowerCase();
		const isTracking = TRACKING_QUERY_KEYS.has(lowerKey) || TRACKING_QUERY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
		const identifierLike = isLikelyIdentifierKey(lowerKey) || !!extractISBNFromText(value).isbn13 || !!extractISBNFromText(value).isbn10 || !!normalizeOlid(value);

		if (isTracking && !identifierLike) {
			continue;
		}

		keptParams.append(key, safeDecode(value));
	}

	cleaned.search = keptParams.toString() ? `?${keptParams.toString()}` : '';
	cleaned.hash = '';

	return {
		rawUrl,
		normalizedUrl: cleaned.toString(),
		hostname: cleaned.hostname.toLowerCase(),
		pathname: safeDecode(cleaned.pathname),
		search: cleaned.search
	};
};

export const fetchPage = async (
	url: string,
	options: BookResolverOptions = {}
): Promise<PageFetchResult> => {
	const warnings: string[] = [];
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	try {
		const response = await withTimeout(
			() =>
				fetchImpl(url, {
					redirect: 'follow',
					headers: {
						accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'user-agent': 'book-url-resolver/1.0'
					}
				}),
			timeoutMs,
			'Page fetch timed out'
		);

		const status = response.status;
		if ([401, 403, 429, 503].includes(status)) {
			warnings.push(`Page appears blocked (${status}).`);
		}

		const contentType = toTrimmedString(response.headers.get('content-type')).toLowerCase();
		const html = (await response.text()).slice(0, MAX_HTML_BYTES);

		const looksHtml =
			contentType.includes('text/html') ||
			html.toLowerCase().includes('<html') ||
			html.toLowerCase().includes('<head');
		if (!looksHtml) {
			warnings.push('Fetched content is not HTML.');
		}

		if (/attention required|access denied|captcha|cloudflare/i.test(html)) {
			warnings.push('Page content indicates bot protection.');
		}

		return {
			ok: response.ok && looksHtml,
			status,
			html,
			finalUrl: toTrimmedString(response.url),
			warnings
		};
	} catch (error) {
		warnings.push(error instanceof Error ? error.message : 'Page fetch failed.');
		return {
			ok: false,
			warnings
		};
	}
};

export const extractBookClues = (urlInfo: NormalizedUrlInfo, html = ''): BookClues => {
	let confidence = 0;
	const clues: string[] = [];
	const warnings: string[] = [];
	const authors: string[] = [];

	let isbn10 = '';
	let isbn13 = '';
	let olid = '';
	let openLibraryUrl = '';
	let title = '';
	let subtitle = '';
	let publisher = '';
	let publishYear = '';

	const urlIdSignals = extractOpenLibraryIds(urlInfo.normalizedUrl);
	if (urlIdSignals.isbn) {
		const normalized = normalizeIsbn(urlIdSignals.isbn);
		isbn10 = firstNonEmpty(isbn10, normalized.isbn10);
		isbn13 = firstNonEmpty(isbn13, normalized.isbn13);
		confidence = addClueConfidence(confidence, 0.55);
		clues.push('ISBN found in URL path.');
	}

	if (urlIdSignals.olid) {
		olid = firstNonEmpty(olid, urlIdSignals.olid);
		confidence = addClueConfidence(confidence, 0.5);
		clues.push('Open Library ID found in URL path.');
	}

	if (/openlibrary\.org$/i.test(urlInfo.hostname)) {
		openLibraryUrl = urlInfo.normalizedUrl;
		confidence = addClueConfidence(confidence, 0.2);
		clues.push('URL points to Open Library domain.');
	}

	const urlIsbnSignals = extractISBNFromText(`${urlInfo.pathname} ${urlInfo.search}`);
	isbn10 = firstNonEmpty(isbn10, urlIsbnSignals.isbn10);
	isbn13 = firstNonEmpty(isbn13, urlIsbnSignals.isbn13);
	if (urlIsbnSignals.all.length > 0) {
		confidence = addClueConfidence(confidence, 0.2);
		clues.push('ISBN-like token detected in URL components.');
	}

	if (html) {
		const metaMap = parseMetaTagsSafely(html);
		const titleTag = parseTitleTagSafely(html);
		const canonicalRaw = parseCanonicalUrlSafely(html);
		const canonicalInfo = canonicalRaw ? normalizeUrl(canonicalRaw) : null;
		const jsonLdRawNodes = parseJsonLdSafely(html);
		const jsonLdNodes: Record<string, unknown>[] = [];
		for (const node of jsonLdRawNodes) {
			flattenJsonLdNodes(node, jsonLdNodes);
		}

		if (canonicalInfo?.normalizedUrl) {
			const canonicalIds = extractOpenLibraryIds(canonicalInfo.normalizedUrl);
			if (canonicalIds.isbn) {
				const normalized = normalizeIsbn(canonicalIds.isbn);
				isbn10 = firstNonEmpty(isbn10, normalized.isbn10);
				isbn13 = firstNonEmpty(isbn13, normalized.isbn13);
				confidence = addClueConfidence(confidence, 0.22);
				clues.push('ISBN found in canonical URL.');
			}
			if (canonicalIds.olid) {
				olid = firstNonEmpty(olid, canonicalIds.olid);
				confidence = addClueConfidence(confidence, 0.22);
				clues.push('Open Library ID found in canonical URL.');
			}

			if (/openlibrary\.org$/i.test(canonicalInfo.hostname)) {
				openLibraryUrl = firstNonEmpty(openLibraryUrl, canonicalInfo.normalizedUrl);
				confidence = addClueConfidence(confidence, 0.1);
				clues.push('Canonical URL points to Open Library.');
			}
		}

		let hasBookSchema = false;
		for (const node of jsonLdNodes) {
			if (!isBookSchemaNode(node)) {
				continue;
			}

			hasBookSchema = true;
			confidence = addClueConfidence(confidence, 0.4);
			clues.push('JSON-LD schema.org type Book detected.');

			title = firstNonEmpty(title, toTrimmedString(node.name), toTrimmedString(node.headline));
			subtitle = firstNonEmpty(subtitle, toTrimmedString(node.alternativeHeadline), toTrimmedString(node.subtitle));
			publisher = firstNonEmpty(
				publisher,
				toTrimmedString((node.publisher as Record<string, unknown> | undefined)?.name),
				toTrimmedString(node.publisher)
			);
			publishYear = firstNonEmpty(publishYear, extractYear(toTrimmedString(node.datePublished)));

			for (const authorName of normalizeAuthorNames(node.author)) {
				authors.push(authorName);
			}

			const isbnSignal = extractISBNFromText(
				`${toTrimmedString(node.isbn)} ${toTrimmedString(node.identifier)}`
			);
			isbn10 = firstNonEmpty(isbn10, isbnSignal.isbn10);
			isbn13 = firstNonEmpty(isbn13, isbnSignal.isbn13);
		}

		const ogType = firstNonEmpty(
			(metaMap.get('og:type') ?? [])[0],
			(metaMap.get('twitter:card') ?? [])[0]
		).toLowerCase();
		if (ogType.includes('book')) {
			confidence = addClueConfidence(confidence, 0.2);
			clues.push('Open Graph metadata indicates a book page.');
		}

		const metaTitle = firstNonEmpty(
			(metaMap.get('citation_title') ?? [])[0],
			(metaMap.get('og:title') ?? [])[0],
			(metaMap.get('twitter:title') ?? [])[0],
			titleTag
		);
		title = firstNonEmpty(title, cleanTitle(metaTitle));
		subtitle = firstNonEmpty(subtitle, (metaMap.get('subtitle') ?? [])[0]);
		publisher = firstNonEmpty(
			publisher,
			(metaMap.get('publisher') ?? [])[0],
			(metaMap.get('book:publisher') ?? [])[0]
		);
		publishYear = firstNonEmpty(
			publishYear,
			extractYear((metaMap.get('citation_publication_date') ?? [])[0] ?? ''),
			extractYear((metaMap.get('article:published_time') ?? [])[0] ?? ''),
			extractYear((metaMap.get('date') ?? [])[0] ?? '')
		);

		for (const authorName of normalizeAuthorNames(
			(metaMap.get('author') ?? []).concat(metaMap.get('book:author') ?? []).concat(metaMap.get('citation_author') ?? [])
		)) {
			authors.push(authorName);
		}

		const description = firstNonEmpty(
			(metaMap.get('description') ?? [])[0],
			(metaMap.get('og:description') ?? [])[0],
			(metaMap.get('twitter:description') ?? [])[0]
		);

		const metaIsbnSignal = extractISBNFromText(
			[
				(metaMap.get('isbn') ?? [])[0],
				(metaMap.get('book:isbn') ?? [])[0],
				(metaMap.get('citation_isbn') ?? [])[0],
				(metaMap.get('dc.identifier') ?? [])[0],
				description,
				titleTag
			]
				.map((value) => toTrimmedString(value))
				.join(' ')
		);
		isbn10 = firstNonEmpty(isbn10, metaIsbnSignal.isbn10);
		isbn13 = firstNonEmpty(isbn13, metaIsbnSignal.isbn13);
		if (metaIsbnSignal.all.length > 0) {
			confidence = addClueConfidence(confidence, 0.28);
			clues.push('ISBN extracted from page metadata.');
		}

		if (hasBookSchema && title && authors.length > 0 && publisher) {
			confidence = addClueConfidence(confidence, 0.18);
			clues.push('Book schema with title, author, and publisher metadata found.');
		}
	}

	if (!title) {
		warnings.push('No reliable title found in URL or metadata.');
	}

	const uniqueAuthors = uniqueStrings(authors);
	const strongSignals = [isbn10, isbn13, olid].filter(Boolean).length + (title ? 1 : 0);
	if (strongSignals === 0) {
		confidence = Math.min(confidence, 0.2);
		warnings.push('No strong book-specific signals detected.');
	}

	return {
		isbn10: isbn10 || undefined,
		isbn13: isbn13 || undefined,
		olid: olid || undefined,
		openLibraryUrl: openLibraryUrl || undefined,
		title: title || undefined,
		subtitle: subtitle || undefined,
		authors: uniqueAuthors.length > 0 ? uniqueAuthors : undefined,
		publisher: publisher || undefined,
		publishYear: publishYear || undefined,
		confidence: clampConfidence(confidence),
		clues: uniqueStrings(clues),
		warnings: uniqueStrings(warnings)
	};
};

export const searchOpenLibraryByISBN = async (
	isbn: string,
	options: BookResolverOptions = {}
): Promise<OpenLibraryLookupResult> => {
	const warnings: string[] = [];
	const normalized = normalizeIsbn(isbn);
	const normalizedIsbn = firstNonEmpty(normalized.isbn13, normalized.isbn10);
	if (!normalizedIsbn) {
		return { candidates: [], warnings: ['Invalid ISBN for Open Library lookup.'] };
	}

	const candidates: NormalizedBookMetadata[] = [];

	const apiBooksUrl = `${OPEN_LIBRARY_BASE_URL}/api/books?bibkeys=ISBN:${encodeURIComponent(normalizedIsbn)}&jscmd=data&format=json`;
	const apiBooksJson = await fetchJson(apiBooksUrl, options, warnings, 'Open Library ISBN books API');
	if (apiBooksJson && typeof apiBooksJson === 'object') {
		const key = `ISBN:${normalizedIsbn}`;
		const record = (apiBooksJson as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
		if (record) {
			candidates.push(
				normalizeBookMetadata({
					title: record.title,
					subtitle: record.subtitle,
					authors: record.authors,
					publishers: record.publishers,
					publish_date: record.publish_date,
					identifiers: record.identifiers as Record<string, unknown> | undefined,
					isbn13: normalized.isbn13,
					isbn10: normalized.isbn10,
					openLibraryUrl: toTrimmedString(record.url),
					sourceUrl: apiBooksUrl,
					confidence: 0.95
				})
			);
		}
	}

	if (candidates.length === 0) {
		const isbnPathUrl = `${OPEN_LIBRARY_BASE_URL}/isbn/${encodeURIComponent(normalizedIsbn)}.json`;
		const isbnJson = await fetchJson(isbnPathUrl, options, warnings, 'Open Library ISBN path API');
		if (isbnJson && typeof isbnJson === 'object') {
			const record = isbnJson as Record<string, unknown>;
			const key = toTrimmedString(record.key);
			const ids = extractOpenLibraryIds(key);
			candidates.push(
				normalizeBookMetadata({
					title: record.title,
					subtitle: record.subtitle,
					publishers: record.publishers,
					publish_date: record.publish_date,
					isbn13: normalized.isbn13,
					isbn10: normalized.isbn10,
					editionOlid: ids.editionOlid,
					workOlid: ids.workOlid,
					openLibraryUrl: key ? `${OPEN_LIBRARY_BASE_URL}${key}` : '',
					sourceUrl: isbnPathUrl,
					confidence: 0.86,
					warnings: ['ISBN path result has limited metadata.']
				})
			);
		}
	}

	return {
		candidates: dedupeBookCandidates(candidates),
		warnings: uniqueStrings(warnings)
	};
};

const fetchAuthorNameByKey = async (
	authorKey: string,
	options: BookResolverOptions,
	warnings: string[]
): Promise<string> => {
	const normalizedKey = toTrimmedString(authorKey);
	if (!normalizedKey) {
		return '';
	}

	const authorJson = await fetchJson(buildOpenLibraryUrl(`${normalizedKey}.json`), options, warnings, 'Open Library author');
	if (!authorJson || typeof authorJson !== 'object') {
		return '';
	}

	return toTrimmedString((authorJson as Record<string, unknown>).name);
};

export const searchOpenLibraryByOLID = async (
	olid: string,
	options: BookResolverOptions = {}
): Promise<OpenLibraryLookupResult> => {
	const warnings: string[] = [];
	const normalizedOlid = normalizeOlid(olid);
	if (!normalizedOlid) {
		return { candidates: [], warnings: ['Invalid Open Library ID for lookup.'] };
	}

	const candidates: NormalizedBookMetadata[] = [];

	const apiBooksUrl = `${OPEN_LIBRARY_BASE_URL}/api/books?bibkeys=OLID:${encodeURIComponent(normalizedOlid)}&jscmd=data&format=json`;
	const apiBooksJson = await fetchJson(apiBooksUrl, options, warnings, 'Open Library OLID books API');
	if (apiBooksJson && typeof apiBooksJson === 'object') {
		const key = `OLID:${normalizedOlid}`;
		const record = (apiBooksJson as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
		if (record) {
			candidates.push(
				normalizeBookMetadata({
					title: record.title,
					subtitle: record.subtitle,
					authors: record.authors,
					publishers: record.publishers,
					publish_date: record.publish_date,
					identifiers: record.identifiers as Record<string, unknown> | undefined,
					editionOlid: normalizedOlid.endsWith('M') ? normalizedOlid : undefined,
					workOlid: normalizedOlid.endsWith('W') ? normalizedOlid : undefined,
					openLibraryUrl: toTrimmedString(record.url),
					sourceUrl: apiBooksUrl,
					confidence: 0.93
				})
			);
		}
	}

	if (normalizedOlid.endsWith('M')) {
		const editionJson = await fetchJson(
			`${OPEN_LIBRARY_BASE_URL}/books/${encodeURIComponent(normalizedOlid)}.json`,
			options,
			warnings,
			'Open Library edition API'
		);

		if (editionJson && typeof editionJson === 'object') {
			const record = editionJson as Record<string, unknown>;
			const workKey = toTrimmedString((asArray(record.works)[0] as Record<string, unknown> | undefined)?.key);
			const workOlid = normalizeOlid(workKey);
			candidates.push(
				normalizeBookMetadata({
					title: record.title,
					subtitle: record.subtitle,
					publishers: record.publishers,
					publish_date: record.publish_date,
					identifiers: record.identifiers as Record<string, unknown> | undefined,
					editionOlid: normalizedOlid,
					workOlid,
					openLibraryUrl: `${OPEN_LIBRARY_BASE_URL}/books/${normalizedOlid}`,
					sourceUrl: `${OPEN_LIBRARY_BASE_URL}/books/${normalizedOlid}.json`,
					confidence: 0.88,
					warnings: ['Edition lookup may miss author names without additional author requests.']
				})
			);
		}
	}

	if (normalizedOlid.endsWith('W')) {
		const workJson = await fetchJson(
			`${OPEN_LIBRARY_BASE_URL}/works/${encodeURIComponent(normalizedOlid)}.json`,
			options,
			warnings,
			'Open Library work API'
		);

		if (workJson && typeof workJson === 'object') {
			const record = workJson as Record<string, unknown>;
			const authorNames: string[] = [];
			for (const item of asArray(record.authors).slice(0, 3)) {
				if (!item || typeof item !== 'object') {
					continue;
				}
				const authorKey = toTrimmedString((item as Record<string, unknown>).author && ((item as Record<string, unknown>).author as Record<string, unknown>).key);
				if (!authorKey) {
					continue;
				}

				const authorName = await fetchAuthorNameByKey(authorKey, options, warnings);
				if (authorName) {
					authorNames.push(authorName);
				}
			}

			candidates.push(
				normalizeBookMetadata({
					title: record.title,
					subtitle: record.subtitle,
					authors: authorNames,
					publish_date: record.first_publish_date,
					workOlid: normalizedOlid,
					openLibraryUrl: `${OPEN_LIBRARY_BASE_URL}/works/${normalizedOlid}`,
					sourceUrl: `${OPEN_LIBRARY_BASE_URL}/works/${normalizedOlid}.json`,
					confidence: 0.84,
					warnings:
						authorNames.length === 0
							? ['Work lookup returned without resolved author names.']
							: []
				})
			);
		}
	}

	return {
		candidates: dedupeBookCandidates(candidates),
		warnings: uniqueStrings(warnings)
	};
};

export const searchOpenLibraryByTitleAuthor = async (
	title?: string,
	authors?: string[],
	options: BookResolverOptions = {}
): Promise<OpenLibraryLookupResult> => {
	const warnings: string[] = [];
	const titleValue = cleanTitle(toTrimmedString(title));
	const authorValue = uniqueStrings((authors ?? []).map((name) => compactWhitespace(name)))[0] ?? '';

	if (!titleValue && !authorValue) {
		return {
			candidates: [],
			warnings: ['Title and author are both missing for Open Library search.']
		};
	}

	const params = new URLSearchParams();
	params.set('limit', '5');
	params.set('fields', 'key,title,subtitle,author_name,publisher,first_publish_year,isbn,edition_key');

	if (titleValue && authorValue) {
		params.set('title', titleValue);
		params.set('author', authorValue);
	} else if (titleValue) {
		params.set('title', titleValue);
	} else {
		params.set('author', authorValue);
		warnings.push('Author-only search can be noisy and lower confidence.');
	}

	const searchUrl = `${OPEN_LIBRARY_BASE_URL}/search.json?${params.toString()}`;
	const searchJson = await fetchJson(searchUrl, options, warnings, 'Open Library search API');
	if (!searchJson || typeof searchJson !== 'object') {
		return { candidates: [], warnings: uniqueStrings(warnings) };
	}

	const docs = Array.isArray((searchJson as Record<string, unknown>).docs)
		? ((searchJson as Record<string, unknown>).docs as Array<Record<string, unknown>>)
		: [];

	const candidates = docs.slice(0, 5).map((doc) =>
		normalizeBookMetadata({
			title: doc.title,
			subtitle: doc.subtitle,
			author_name: doc.author_name,
			publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
			first_publish_year: doc.first_publish_year,
			isbn: doc.isbn,
			editionOlid: Array.isArray(doc.edition_key) ? doc.edition_key[0] : '',
			workOlid: toTrimmedString(doc.key),
			openLibraryUrl: toTrimmedString(doc.key) ? `${OPEN_LIBRARY_BASE_URL}${toTrimmedString(doc.key)}` : '',
			sourceUrl: searchUrl,
			confidence: 0.72
		})
	);

	return {
		candidates: dedupeBookCandidates(candidates),
		warnings: uniqueStrings(warnings)
	};
};

const dedupeBookCandidates = (candidates: NormalizedBookMetadata[]): NormalizedBookMetadata[] => {
	const seen = new Set<string>();
	const deduped: NormalizedBookMetadata[] = [];

	for (const candidate of candidates) {
		const key = firstNonEmpty(
			candidate.isbn13,
			candidate.isbn10,
			candidate.editionOlid,
			candidate.workOlid,
			`${normalizeCompareText(candidate.title)}|${normalizeCompareText(candidate.authors[0]?.full ?? '')}`
		);
		if (!key) {
			continue;
		}

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(candidate);
	}

	return deduped;
};

const computeAuthorOverlapScore = (clueAuthors: string[], candidateAuthors: NormalizedBookAuthor[]): {
	score: number;
	reason?: string;
} => {
	if (clueAuthors.length === 0 || candidateAuthors.length === 0) {
		return { score: 0 };
	}

	const normalizedClueAuthors = clueAuthors.map((author) => normalizeCompareText(author));
	const normalizedCandidateAuthors = candidateAuthors.map((author) => normalizeCompareText(author.full));

	for (const clueAuthor of normalizedClueAuthors) {
		if (normalizedCandidateAuthors.includes(clueAuthor)) {
			return { score: 22, reason: 'Exact author match.' };
		}
	}

	for (const clueAuthor of normalizedClueAuthors) {
		const clueFamily = splitAuthorName(clueAuthor).family;
		if (!clueFamily) {
			continue;
		}

		for (const candidateAuthor of candidateAuthors) {
			const candidateFamily = splitAuthorName(candidateAuthor.full).family;
			if (candidateFamily && normalizeCompareText(candidateFamily) === normalizeCompareText(clueFamily)) {
				return { score: 12, reason: 'Author family-name overlap.' };
			}
		}
	}

	return { score: -12, reason: 'Author mismatch penalty.' };
};

const scoreCandidate = (candidate: NormalizedBookMetadata, clues: BookClues): { score: number; reasons: string[] } => {
	let score = Math.round(clampConfidence(candidate.confidence) * 30);
	const reasons: string[] = [];

	if (clues.isbn13 && candidate.isbn13 && clues.isbn13 === candidate.isbn13) {
		score += 70;
		reasons.push('Exact ISBN-13 match.');
	}

	if (clues.isbn10 && candidate.isbn10 && clues.isbn10 === candidate.isbn10) {
		score += 65;
		reasons.push('Exact ISBN-10 match.');
	}

	if (clues.olid) {
		const clueOlid = normalizeOlid(clues.olid);
		if (clueOlid && [candidate.olid, candidate.editionOlid, candidate.workOlid].includes(clueOlid)) {
			score += 60;
			reasons.push('Exact Open Library ID match.');
		}
	}

	if (clues.title && candidate.title) {
		const titleSimilarity = scoreTitleSimilarity(clues.title, candidate.title);
		if (titleSimilarity >= 0.99) {
			score += 35;
			reasons.push('Exact title match.');
		} else if (titleSimilarity >= 0.9) {
			score += 24;
			reasons.push('Strong title similarity.');
		} else if (titleSimilarity >= 0.75) {
			score += 14;
			reasons.push('Moderate title similarity.');
		} else if (titleSimilarity < 0.45) {
			score -= 8;
			reasons.push('Weak title similarity penalty.');
		}
	}

	const authorOverlap = computeAuthorOverlapScore(clues.authors ?? [], candidate.authors);
	score += authorOverlap.score;
	if (authorOverlap.reason) {
		reasons.push(authorOverlap.reason);
	}

	if (clues.publisher && candidate.publisher) {
		const cluePublisher = normalizeCompareText(clues.publisher);
		const candidatePublisher = normalizeCompareText(candidate.publisher);
		if (cluePublisher && candidatePublisher && (cluePublisher.includes(candidatePublisher) || candidatePublisher.includes(cluePublisher))) {
			score += 8;
			reasons.push('Publisher support signal.');
		}
	}

	if (clues.publishYear && candidate.year) {
		if (clues.publishYear === candidate.year) {
			score += 8;
			reasons.push('Publication year support signal.');
		} else {
			score -= 4;
			reasons.push('Publication year mismatch penalty.');
		}
	}

	if (!candidate.title) {
		score -= 20;
		reasons.push('Missing title penalty.');
	}

	return {
		score: Math.max(0, Math.min(100, score)),
		reasons
	};
};

export const rankBookCandidates = (
	candidates: NormalizedBookMetadata[],
	clues: BookClues
): RankedBookCandidates => {
	const ranked = candidates
		.map((candidate) => {
			const scored = scoreCandidate(candidate, clues);
			return {
				candidate,
				score: scored.score,
				reasons: scored.reasons
			};
		})
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return right.candidate.confidence - left.candidate.confidence;
		});

	return {
		bestMatch: ranked[0] ?? null,
		scoredCandidates: ranked,
		warnings: ranked.length === 0 ? ['No Open Library candidates available to rank.'] : []
	};
};

type CandidateWithMethod = {
	metadata: NormalizedBookMetadata;
	method: Exclude<BookResolveMethod, 'none'>;
};

const findBestMethodForCandidate = (
	best: NormalizedBookMetadata,
	entries: CandidateWithMethod[]
): Exclude<BookResolveMethod, 'none'> => {
	for (const entry of entries) {
		if (
			entry.metadata.isbn13 === best.isbn13 &&
			entry.metadata.isbn10 === best.isbn10 &&
			entry.metadata.olid === best.olid &&
			entry.metadata.title === best.title
		) {
			return entry.method;
		}
	}

	return entries[0]?.method ?? 'title-only';
};

const emptyBookMetadata = (sourceUrl: string, warnings: string[]): NormalizedBookMetadata =>
	normalizeBookMetadata({
		title: '',
		subtitle: '',
		authors: [],
		publisher: '',
		publishDate: '',
		isbn10: '',
		isbn13: '',
		olid: '',
		editionOlid: '',
		workOlid: '',
		openLibraryUrl: '',
		sourceUrl,
		confidence: 0,
		warnings
	});

export const detectAndResolveBookFromUrl = async (
	url: string,
	options: BookResolverOptions = {}
): Promise<DetectResolveBookResult> => {
	const warnings: string[] = [];
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl.normalizedUrl) {
		const invalidWarning = 'Invalid URL format.';
		const metadata = emptyBookMetadata('', [invalidWarning]);
		return {
			found: false,
			sourceType: 'unknown',
			confidence: 0,
			method: 'none',
			metadata,
			clues: {
				confidence: 0,
				clues: [],
				warnings: [invalidWarning]
			},
			warnings: [invalidWarning]
		};
	}

	const candidateEntries: CandidateWithMethod[] = [];
	const directUrlIds = extractOpenLibraryIds(normalizedUrl.normalizedUrl);

	const pushCandidates = (method: Exclude<BookResolveMethod, 'none'>, lookup: OpenLibraryLookupResult): void => {
		warnings.push(...lookup.warnings);
		for (const candidate of lookup.candidates) {
			candidateEntries.push({ metadata: candidate, method });
		}
	};

	if (directUrlIds.isbn) {
		pushCandidates('isbn', await searchOpenLibraryByISBN(directUrlIds.isbn, options));
	}

	if (candidateEntries.length === 0 && directUrlIds.olid) {
		pushCandidates('olid', await searchOpenLibraryByOLID(directUrlIds.olid, options));
	}

	let pageResult: PageFetchResult | null = null;
	if (candidateEntries.length === 0) {
		pageResult = await fetchPage(normalizedUrl.normalizedUrl, options);
		warnings.push(...pageResult.warnings);
	}

	const clues = extractBookClues(normalizedUrl, pageResult?.html ?? '');
	warnings.push(...clues.warnings);

	if (candidateEntries.length === 0 && clues.isbn13) {
		pushCandidates('isbn', await searchOpenLibraryByISBN(clues.isbn13, options));
	}
	if (candidateEntries.length === 0 && clues.isbn10) {
		pushCandidates('isbn', await searchOpenLibraryByISBN(clues.isbn10, options));
	}
	if (candidateEntries.length === 0 && clues.olid) {
		pushCandidates('olid', await searchOpenLibraryByOLID(clues.olid, options));
	}
	if (candidateEntries.length === 0 && clues.title && (clues.authors?.length ?? 0) > 0) {
		pushCandidates('title-author', await searchOpenLibraryByTitleAuthor(clues.title, clues.authors, options));
	}
	if (candidateEntries.length === 0 && clues.title) {
		pushCandidates('title-only', await searchOpenLibraryByTitleAuthor(clues.title, [], options));
	}

	const dedupedCandidates = dedupeBookCandidates(candidateEntries.map((entry) => entry.metadata));
	const ranking = rankBookCandidates(dedupedCandidates, clues);

	if (!ranking.bestMatch) {
		warnings.push('No reliable book match found.');
		const metadata = emptyBookMetadata(normalizedUrl.normalizedUrl, uniqueStrings(warnings));
		return {
			found: false,
			sourceType: 'unknown',
			confidence: clampConfidence(clues.confidence * 0.5),
			method: 'none',
			metadata,
			clues,
			warnings: uniqueStrings(warnings)
		};
	}

	const best = ranking.bestMatch;
	const bestMethod = findBestMethodForCandidate(best.candidate, candidateEntries);
	const confidenceFromScore = clampConfidence(best.score / 100);
	const finalConfidence = clampConfidence((confidenceFromScore + best.candidate.confidence + clues.confidence) / 3);
	const scoreThreshold = bestMethod === 'isbn' || bestMethod === 'olid' ? 42 : 55;
	const found = best.score >= scoreThreshold;

	if (!found) {
		warnings.push('Top candidate score is below confidence threshold.');
	}

	const metadata = normalizeBookMetadata({
		...best.candidate,
		sourceUrl: firstNonEmpty(best.candidate.sourceUrl, normalizedUrl.normalizedUrl),
		confidence: finalConfidence,
		warnings: mergeWarnings(best.candidate.warnings, warnings)
	});

	return {
		found,
		sourceType: found ? 'book' : 'unknown',
		confidence: finalConfidence,
		method: found ? bestMethod : 'none',
		metadata,
		clues,
		warnings: uniqueStrings(warnings)
	};
};
