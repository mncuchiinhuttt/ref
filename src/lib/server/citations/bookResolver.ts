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
	title?: string;
	subtitle?: string;
	authors?: string[];
	publisher?: string;
	publishedDate?: string;
	googleBooksId?: string;
	confidence: number;
	clues: string[];
	warnings: string[];
};

export type NormalizedBookAuthor = {
	full: string;
	given: string;
	family: string;
};

export type BookProvider = 'googleBooks' | 'openLibrary' | 'none';

export type NormalizedBookMetadata = {
	sourceType: 'book';
	title: string;
	subtitle: string;
	authors: NormalizedBookAuthor[];
	publisher: string;
	publishedDate: string;
	year: string;
	isbn10: string;
	isbn13: string;
	googleBooksId: string;
	openLibraryId: string;
	sourceUrl: string;
	canonicalBookUrl: string;
	confidence: number;
	provider: BookProvider;
	warnings: string[];
};

export type RankedBookCandidate = {
	candidate: NormalizedBookMetadata;
	score: number;
	reasons: string[];
};

export type RankedGoogleBooksCandidates = {
	bestMatch: RankedBookCandidate | null;
	scoredCandidates: RankedBookCandidate[];
};

export type GoogleBooksSearchMethod = 'isbn' | 'title-author' | 'title-only' | 'author-only' | 'none';

export type GoogleBooksSearchResult = {
	method: GoogleBooksSearchMethod;
	bestMatch: RankedBookCandidate | null;
	scoredCandidates: RankedBookCandidate[];
	warnings: string[];
};

export type OpenLibraryFallbackResult = {
	bestMatch: RankedBookCandidate | null;
	scoredCandidates: RankedBookCandidate[];
	warnings: string[];
};

export type ResolveBookMethod = 'isbn' | 'title-author' | 'title-only' | 'fallback' | 'none';

export type ResolveBookFromUrlResult = {
	found: boolean;
	provider: BookProvider;
	sourceType: 'book' | 'unknown';
	confidence: number;
	method: ResolveBookMethod;
	metadata: NormalizedBookMetadata;
	clues: BookClues;
	warnings: string[];
};

export type BookResolverOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
	googleApiKey?: string;
	fallbackToOpenLibrary?: boolean;
	pageHtml?: string;
	finalUrl?: string;
};

type JsonLdBookEntry = {
	title: string;
	subtitle: string;
	authors: string[];
	publisher: string;
	publishedDate: string;
	isbn10: string;
	isbn13: string;
};

type ParsedGoogleVolume = {
	metadata: NormalizedBookMetadata;
	printType: string;
};

type OpenLibrarySearchMethod = 'isbn' | 'title-author' | 'title-only' | 'none';

type OpenLibrarySearchResult = {
	method: OpenLibrarySearchMethod;
	candidates: NormalizedBookMetadata[];
	warnings: string[];
};

const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const GOOGLE_STRONG_SCORE = 85;
const OPEN_LIBRARY_STRONG_SCORE = 78;

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
const JSON_LD_SCRIPT_PATTERN =
	/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const STRIP_TAG_PATTERN = /<[^>]+>/g;
const ISBN_TEXT_PATTERN = /\b(?:ISBN(?:-1[03])?:?\s*)?([0-9Xx][0-9Xx\-\s]{8,22}[0-9Xx])\b/g;
const YEAR_PATTERN = /\b(1[5-9]\d{2}|20\d{2}|2100)\b/;

const BOOKISH_DOMAIN_SIGNAL =
	/(^|\.)(books\.google|openlibrary|goodreads|barnesandnoble|bookshop|booktopia|bookdepository|waterstones)\./;

const STORE_DOMAIN_SIGNAL =
	/(^|\.)(amazon|walmart|target|ebay|bestbuy|shopify|etsy|rakuten)\./;

const GOOGLE_BOOKS_ID_PARAM_KEYS = ['id', 'vid', 'volumeid'];

const GOOGLE_CANDIDATE_PRINT_TYPE = new Map<string, string>();

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

const clampConfidence = (value: number): number =>
	Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));

const clampScore = (value: number): number => Math.max(0, Math.min(200, Math.round(value)));

const extractYear = (value: string): string => {
	const match = value.match(YEAR_PATTERN);
	return match?.[1] ?? '';
};

const safeDecode = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
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

const toNormalizedBookAuthors = (authors: string[]): NormalizedBookAuthor[] =>
	authors.map((author) => {
		const split = splitAuthorName(author);
		return {
			full: author,
			given: split.given,
			family: split.family
		};
	});

const normalizeCompareText = (value: string): string =>
	compactWhitespace(decodeHtmlEntities(value))
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const normalizeIsbnRaw = (value: string): string => value.toUpperCase().replace(/[^0-9X]/g, '');

const isValidIsbn10 = (isbn10: string): boolean => {
	if (!/^\d{9}[\dX]$/.test(isbn10)) {
		return false;
	}

	let sum = 0;
	for (let index = 0; index < 10; index += 1) {
		const char = isbn10[index];
		const numeric = char === 'X' ? 10 : Number(char);
		sum += numeric * (10 - index);
	}

	return sum % 11 === 0;
};

const isValidIsbn13 = (isbn13: string): boolean => {
	if (!/^\d{13}$/.test(isbn13)) {
		return false;
	}

	let sum = 0;
	for (let index = 0; index < 12; index += 1) {
		const numeric = Number(isbn13[index]);
		sum += numeric * (index % 2 === 0 ? 1 : 3);
	}

	const checkDigit = (10 - (sum % 10)) % 10;
	return checkDigit === Number(isbn13[12]);
};

const normalizeIsbn = (value: string): { isbn10?: string; isbn13?: string } => {
	const raw = normalizeIsbnRaw(value);
	if (!raw) {
		return {};
	}

	if (raw.length === 10 && isValidIsbn10(raw)) {
		return { isbn10: raw };
	}

	if (raw.length === 13 && isValidIsbn13(raw)) {
		return { isbn13: raw };
	}

	return {};
};

export const extractISBN = (text: string): { isbn10?: string; isbn13?: string; all: string[] } => {
	const isbn10s: string[] = [];
	const isbn13s: string[] = [];

	for (const match of text.matchAll(ISBN_TEXT_PATTERN)) {
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

export const normalizeTitle = (text: string): string => {
	const normalized = compactWhitespace(decodeHtmlEntities(text));
	if (!normalized) {
		return '';
	}

	const stripped = normalized
		.toLowerCase()
		.replace(/\[[^\]]*\]/g, ' ')
		.replace(/\([^)]*\)/g, ' ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return stripped;
};

export const scoreTitleMatch = (left: string, right: string): number => {
	const a = normalizeTitle(left);
	const b = normalizeTitle(right);
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

	const aTokens = new Set(a.split(' ').filter(Boolean));
	const bTokens = new Set(b.split(' ').filter(Boolean));
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

export const parseMetaTags = (html: string): Map<string, string[]> => {
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

const parseCanonicalUrl = (html: string): string => {
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

const parseTitleTag = (html: string): string => {
	const match = html.match(TITLE_TAG_PATTERN);
	if (!match?.[1]) {
		return '';
	}

	return compactWhitespace(decodeHtmlEntities(match[1].replace(STRIP_TAG_PATTERN, ' ')));
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

const normalizeAuthorNames = (value: unknown): string[] => {
	const authors: string[] = [];

	const pushAuthor = (name: string): void => {
		const normalized = compactWhitespace(name);
		if (normalized) {
			authors.push(normalized);
		}
	};

	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === 'string') {
				pushAuthor(item);
				continue;
			}

			if (!item || typeof item !== 'object') {
				continue;
			}

			const record = item as Record<string, unknown>;
			pushAuthor(firstNonEmpty(toTrimmedString(record.name), toTrimmedString(record.author as string)));
		}
	} else if (typeof value === 'string') {
		pushAuthor(value);
	} else if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		pushAuthor(toTrimmedString(record.name));
	}

	return uniqueStrings(authors);
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.map((item) => toTrimmedString(item)).filter(Boolean);
};

export const parseJsonLdBook = (html: string): JsonLdBookEntry[] => {
	const parsedNodes: unknown[] = [];
	for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
		const raw = toTrimmedString(match[1]);
		if (!raw) {
			continue;
		}

		try {
			parsedNodes.push(JSON.parse(raw) as unknown);
		} catch {
			continue;
		}
	}

	const flatNodes: Record<string, unknown>[] = [];
	for (const node of parsedNodes) {
		flattenJsonLdNodes(node, flatNodes);
	}

	const books: JsonLdBookEntry[] = [];
	for (const node of flatNodes) {
		const typeValue = node['@type'];
		const types = Array.isArray(typeValue)
			? typeValue.map((value) => toTrimmedString(value).toLowerCase())
			: [toTrimmedString(typeValue).toLowerCase()];

		if (!types.some((value) => value.includes('book'))) {
			continue;
		}

		const title = firstNonEmpty(toTrimmedString(node.name), toTrimmedString(node.headline));
		const subtitle = firstNonEmpty(
			toTrimmedString(node.alternativeHeadline),
			toTrimmedString(node.subtitle)
		);
		const publisher = firstNonEmpty(
			toTrimmedString((node.publisher as Record<string, unknown> | undefined)?.name),
			toTrimmedString(node.publisher)
		);
		const publishedDate = firstNonEmpty(toTrimmedString(node.datePublished), toTrimmedString(node.dateCreated));
		const authors = normalizeAuthorNames(node.author);
		const isbnSignals = extractISBN(
			`${toTrimmedString(node.isbn)} ${toTrimmedString(node.identifier)} ${toTrimmedString(node.sku)}`
		);

		books.push({
			title,
			subtitle,
			authors,
			publisher,
			publishedDate,
			isbn10: isbnSignals.isbn10 ?? '',
			isbn13: isbnSignals.isbn13 ?? ''
		});
	}

	return books;
};

export const extractGoogleBooksId = (urlValue: string): string => {
	try {
		const parsed = new URL(urlValue);
		const hostname = parsed.hostname.toLowerCase();

		for (const key of GOOGLE_BOOKS_ID_PARAM_KEYS) {
			const value = toTrimmedString(parsed.searchParams.get(key));
			if (value && /^[A-Za-z0-9_-]{6,}$/.test(value)) {
				return value;
			}
		}

		if (/books\.google\./.test(hostname)) {
			const editionMatch = parsed.pathname.match(/\/books\/edition\/[^/]+\/([^/?#]+)/i);
			if (editionMatch?.[1]) {
				return safeDecode(editionMatch[1]);
			}
		}

		if (/googleapis\.com$/.test(hostname)) {
			const volumeMatch = parsed.pathname.match(/\/volumes\/([^/?#]+)/i);
			if (volumeMatch?.[1]) {
				return safeDecode(volumeMatch[1]);
			}
		}
	} catch {
		return '';
	}

	return '';
};

const isIdentifierLikeQueryKey = (key: string): boolean =>
	/isbn|book|volume|id|olid|title|author|q/.test(key.toLowerCase());

export const normalizeUrl = (url: string): NormalizedUrlInfo => {
	const rawUrl = url;
	const trimmed = toTrimmedString(url);
	if (!trimmed) {
		return {
			rawUrl,
			normalizedUrl: '',
			hostname: '',
			pathname: '',
			search: ''
		};
	}

	const parseCandidates = trimmed.startsWith('http://') || trimmed.startsWith('https://')
		? [trimmed]
		: [`https://${trimmed}`, `http://${trimmed}`];

	let parsed: URL | null = null;
	for (const candidate of parseCandidates) {
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
		const isTracking =
			TRACKING_QUERY_KEYS.has(lowerKey) ||
			TRACKING_QUERY_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));

		const isbnSignal = extractISBN(value);
		const googleIdSignal = extractGoogleBooksId(value);
		const importantValue = isbnSignal.all.length > 0 || Boolean(googleIdSignal);
		const importantKey = isIdentifierLikeQueryKey(lowerKey);

		if (isTracking && !importantKey && !importantValue) {
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

const withTimeout = async <T>(promiseFactory: () => Promise<T>, timeoutMs: number): Promise<T> => {
	const abortController = new AbortController();
	const timer = setTimeout(() => abortController.abort(), timeoutMs);

	try {
		return await promiseFactory();
	} finally {
		clearTimeout(timer);
	}
};

const buildFetchInit = (signal: AbortSignal, acceptHeader: string): RequestInit => ({
	redirect: 'follow',
	signal,
	headers: {
		accept: acceptHeader,
		'user-agent': 'book-resolver/1.0'
	}
});

export const fetchPage = async (url: string, options: BookResolverOptions = {}): Promise<PageFetchResult> => {
	const warnings: string[] = [];
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	try {
		const abortController = new AbortController();
		const response = await withTimeout(
			() =>
				fetchImpl(
					url,
					buildFetchInit(abortController.signal, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
				),
			timeoutMs
		);

		const html = (await response.text()).slice(0, MAX_HTML_BYTES);
		const contentType = toTrimmedString(response.headers.get('content-type')).toLowerCase();
		const status = response.status;

		if ([401, 403, 429, 503].includes(status)) {
			warnings.push(`Page appears blocked (${status}).`);
		}

		if (/captcha|attention required|access denied|cloudflare|forbidden/i.test(html)) {
			warnings.push('Page content appears protected by anti-bot controls.');
		}

		const looksHtml =
			contentType.includes('text/html') ||
			html.toLowerCase().includes('<html') ||
			html.toLowerCase().includes('<head');

		if (!looksHtml) {
			warnings.push('Fetched content is not HTML.');
		}

		return {
			ok: response.ok && looksHtml,
			status,
			html,
			finalUrl: toTrimmedString(response.url),
			warnings
		};
	} catch (error) {
		warnings.push(error instanceof Error ? error.message : 'Failed to fetch page metadata.');
		return {
			ok: false,
			warnings
		};
	}
};

const scoreBookishDomainSignal = (hostname: string): number => {
	if (BOOKISH_DOMAIN_SIGNAL.test(hostname)) {
		return 0.2;
	}
	if (STORE_DOMAIN_SIGNAL.test(hostname)) {
		return 0.08;
	}
	return 0;
};

const splitAuthorList = (value: string): string[] => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return [];
	}

	const chunks = normalized
		.split(/\s+(?:and|&)\s+|\s*[;|/]\s*|\s*,\s*(?=[A-Z][a-z])/)
		.map((item) => compactWhitespace(item))
		.filter(Boolean);

	if (chunks.length === 0) {
		return [];
	}

	return uniqueStrings(chunks);
};

const getMetaFirst = (metaMap: Map<string, string[]>, ...keys: string[]): string => {
	for (const key of keys) {
		const entry = metaMap.get(key.toLowerCase());
		if (!entry || entry.length === 0) {
			continue;
		}

		const first = toTrimmedString(entry[0]);
		if (first) {
			return first;
		}
	}

	return '';
};

const dedupeBookCandidates = (candidates: NormalizedBookMetadata[]): NormalizedBookMetadata[] => {
	const deduped: NormalizedBookMetadata[] = [];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const key = [
			candidate.provider,
			candidate.googleBooksId,
			candidate.openLibraryId,
			candidate.isbn13,
			candidate.isbn10,
			normalizeTitle(candidate.title),
			normalizeCompareText(candidate.authors[0]?.full ?? '')
		]
			.filter(Boolean)
			.join('|');

		if (!key || seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(candidate);
	}

	return deduped;
};

export const extractBookClues = (urlInfo: NormalizedUrlInfo, html = ''): BookClues => {
	let confidence = 0;
	const clues: string[] = [];
	const warnings: string[] = [];

	let isbn10 = '';
	let isbn13 = '';
	let title = '';
	let subtitle = '';
	const authors: string[] = [];
	let publisher = '';
	let publishedDate = '';
	let googleBooksId = '';

	const pathSignals = `${urlInfo.pathname} ${urlInfo.search}`;
	const urlIsbn = extractISBN(pathSignals);
	isbn10 = firstNonEmpty(isbn10, urlIsbn.isbn10);
	isbn13 = firstNonEmpty(isbn13, urlIsbn.isbn13);
	if (urlIsbn.all.length > 0) {
		confidence = clampConfidence(confidence + 0.35);
		clues.push('ISBN token detected in URL path or query.');
	}

	googleBooksId = firstNonEmpty(googleBooksId, extractGoogleBooksId(urlInfo.normalizedUrl));
	if (googleBooksId) {
		confidence = clampConfidence(confidence + 0.4);
		clues.push('Google Books ID detected in URL.');
	}

	const domainBoost = scoreBookishDomainSignal(urlInfo.hostname);
	if (domainBoost > 0) {
		confidence = clampConfidence(confidence + domainBoost);
		clues.push('URL hostname matches a known book/store domain.');
	}

	if (html) {
		const metaMap = parseMetaTags(html);
		const titleTag = parseTitleTag(html);
		const canonical = parseCanonicalUrl(html);
		const canonicalUrlInfo = canonical ? normalizeUrl(canonical) : null;

		if (canonicalUrlInfo?.normalizedUrl) {
			const canonicalGoogleId = extractGoogleBooksId(canonicalUrlInfo.normalizedUrl);
			if (canonicalGoogleId) {
				googleBooksId = firstNonEmpty(googleBooksId, canonicalGoogleId);
				confidence = clampConfidence(confidence + 0.2);
				clues.push('Google Books ID detected in canonical URL.');
			}

			const canonicalIsbn = extractISBN(canonicalUrlInfo.normalizedUrl);
			isbn10 = firstNonEmpty(isbn10, canonicalIsbn.isbn10);
			isbn13 = firstNonEmpty(isbn13, canonicalIsbn.isbn13);
			if (canonicalIsbn.all.length > 0) {
				confidence = clampConfidence(confidence + 0.2);
				clues.push('ISBN token detected in canonical URL.');
			}
		}

		const ogType = getMetaFirst(metaMap, 'og:type', 'twitter:card').toLowerCase();
		if (ogType.includes('book')) {
			confidence = clampConfidence(confidence + 0.15);
			clues.push('OpenGraph metadata reports a book type.');
		}

		title = firstNonEmpty(
			title,
			getMetaFirst(metaMap, 'citation_title', 'book:title', 'og:title', 'twitter:title', 'dc.title'),
			titleTag
		);
		subtitle = firstNonEmpty(subtitle, getMetaFirst(metaMap, 'book:subtitle', 'subtitle'));

		for (const authorValue of [
			...toStringArray(metaMap.get('author')),
			...toStringArray(metaMap.get('book:author')),
			...toStringArray(metaMap.get('citation_author')),
			...toStringArray(metaMap.get('dc.creator'))
		]) {
			authors.push(...splitAuthorList(authorValue));
		}

		publisher = firstNonEmpty(
			publisher,
			getMetaFirst(metaMap, 'publisher', 'book:publisher', 'citation_publisher', 'dc.publisher')
		);
		publishedDate = firstNonEmpty(
			publishedDate,
			getMetaFirst(metaMap, 'citation_publication_date', 'book:release_date', 'article:published_time', 'dc.date')
		);

		const description = firstNonEmpty(
			getMetaFirst(metaMap, 'description', 'og:description', 'twitter:description'),
			html.slice(0, 800)
		);
		const metadataIsbnSignals = extractISBN(
			[
				getMetaFirst(metaMap, 'isbn', 'book:isbn', 'citation_isbn', 'dc.identifier'),
				description,
				title
			]
				.filter(Boolean)
				.join(' ')
		);
		isbn10 = firstNonEmpty(isbn10, metadataIsbnSignals.isbn10);
		isbn13 = firstNonEmpty(isbn13, metadataIsbnSignals.isbn13);
		if (metadataIsbnSignals.all.length > 0) {
			confidence = clampConfidence(confidence + 0.28);
			clues.push('ISBN extracted from page metadata.');
		}

		const jsonLdBooks = parseJsonLdBook(html);
		if (jsonLdBooks.length > 0) {
			confidence = clampConfidence(confidence + 0.45);
			clues.push('schema.org Book JSON-LD detected.');

			const primaryBook = jsonLdBooks[0];
			title = firstNonEmpty(title, primaryBook.title);
			subtitle = firstNonEmpty(subtitle, primaryBook.subtitle);
			authors.push(...primaryBook.authors);
			publisher = firstNonEmpty(publisher, primaryBook.publisher);
			publishedDate = firstNonEmpty(publishedDate, primaryBook.publishedDate);
			isbn10 = firstNonEmpty(isbn10, primaryBook.isbn10);
			isbn13 = firstNonEmpty(isbn13, primaryBook.isbn13);
		}
	}

	const dedupedAuthors = uniqueStrings(authors);
	if (title && dedupedAuthors.length > 0 && scoreBookishDomainSignal(urlInfo.hostname) > 0) {
		confidence = clampConfidence(confidence + 0.2);
		clues.push('Title and author present on a likely book/store page.');
	}

	if (title && publisher && extractYear(publishedDate)) {
		confidence = clampConfidence(confidence + 0.08);
		clues.push('Title, publisher, and publication date signals are present.');
	}

	if (!title) {
		warnings.push('Could not extract a reliable title from metadata.');
	}

	const strongSignalCount = [isbn10, isbn13, googleBooksId].filter(Boolean).length;
	if (strongSignalCount === 0 && (!title || dedupedAuthors.length === 0)) {
		confidence = Math.min(confidence, 0.24);
		warnings.push('Low-confidence book candidate: missing strong ISBN/ID/title-author signals.');
	}

	return {
		isbn10: isbn10 || undefined,
		isbn13: isbn13 || undefined,
		title: title || undefined,
		subtitle: subtitle || undefined,
		authors: dedupedAuthors.length > 0 ? dedupedAuthors : undefined,
		publisher: publisher || undefined,
		publishedDate: publishedDate || undefined,
		googleBooksId: googleBooksId || undefined,
		confidence: clampConfidence(confidence),
		clues: uniqueStrings(clues),
		warnings: uniqueStrings(warnings)
	};
};

const normalizePublishedDate = (value: string): string => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return '';
	}

	if (/^\d{4}$/.test(normalized)) {
		return `${normalized}-01-01`;
	}

	if (/^\d{4}-\d{2}$/.test(normalized)) {
		return `${normalized}-01`;
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return normalized;
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return normalized;
	}

	return parsed.toISOString().slice(0, 10);
};

type BookMetadataInput = {
	title?: unknown;
	subtitle?: unknown;
	authors?: unknown;
	publisher?: unknown;
	publishedDate?: unknown;
	industryIdentifiers?: unknown;
	isbn10?: unknown;
	isbn13?: unknown;
	googleBooksId?: unknown;
	openLibraryId?: unknown;
	sourceUrl?: unknown;
	canonicalBookUrl?: unknown;
	provider?: unknown;
	confidence?: unknown;
	warnings?: unknown;
};

const parseIndustryIdentifiers = (value: unknown): { isbn10: string; isbn13: string } => {
	if (!Array.isArray(value)) {
		return { isbn10: '', isbn13: '' };
	}

	let isbn10 = '';
	let isbn13 = '';
	for (const item of value) {
		if (!item || typeof item !== 'object') {
			continue;
		}

		const record = item as Record<string, unknown>;
		const type = toTrimmedString(record.type).toUpperCase();
		const identifier = toTrimmedString(record.identifier);
		if (!identifier) {
			continue;
		}

		const normalized = normalizeIsbn(identifier);
		if (!isbn13 && (type.includes('ISBN_13') || normalized.isbn13)) {
			isbn13 = normalized.isbn13 ?? isbn13;
		}
		if (!isbn10 && (type.includes('ISBN_10') || normalized.isbn10)) {
			isbn10 = normalized.isbn10 ?? isbn10;
		}
	}

	return { isbn10, isbn13 };
};

const normalizeProvider = (value: unknown): BookProvider => {
	const normalized = toTrimmedString(value);
	if (normalized === 'googleBooks' || normalized === 'openLibrary') {
		return normalized;
	}
	return 'none';
};

const normalizeConfidence = (value: unknown, fallback = 0): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return clampConfidence(fallback);
	}

	return clampConfidence(value);
};

export const normalizeBookMetadata = (source: BookMetadataInput): NormalizedBookMetadata => {
	const title = compactWhitespace(toTrimmedString(source.title));
	const subtitle = compactWhitespace(toTrimmedString(source.subtitle));
	const publisher = compactWhitespace(toTrimmedString(source.publisher));
	const publishedDate = normalizePublishedDate(toTrimmedString(source.publishedDate));
	const year = extractYear(publishedDate);
	const provider = normalizeProvider(source.provider);

	const industry = parseIndustryIdentifiers(source.industryIdentifiers);
	const explicit10 = normalizeIsbn(toTrimmedString(source.isbn10)).isbn10;
	const explicit13 = normalizeIsbn(toTrimmedString(source.isbn13)).isbn13;
	const isbn10 = firstNonEmpty(explicit10, industry.isbn10);
	const isbn13 = firstNonEmpty(explicit13, industry.isbn13);

	const authorValues = Array.isArray(source.authors)
		? source.authors
		: typeof source.authors === 'string'
			? splitAuthorList(source.authors)
			: [];
	const normalizedAuthors = uniqueStrings(
		authorValues
			.map((value) => {
				if (typeof value === 'string') {
					return value;
				}
				if (!value || typeof value !== 'object') {
					return '';
				}
				return toTrimmedString((value as Record<string, unknown>).full ?? (value as Record<string, unknown>).name);
			})
			.filter(Boolean)
	);

	const confidenceFallback = title ? 0.55 : 0;
	const confidence = normalizeConfidence(source.confidence, confidenceFallback);

	return {
		sourceType: 'book',
		title,
		subtitle,
		authors: toNormalizedBookAuthors(normalizedAuthors),
		publisher,
		publishedDate,
		year,
		isbn10,
		isbn13,
		googleBooksId: compactWhitespace(toTrimmedString(source.googleBooksId)),
		openLibraryId: compactWhitespace(toTrimmedString(source.openLibraryId)),
		sourceUrl: compactWhitespace(toTrimmedString(source.sourceUrl)),
		canonicalBookUrl: compactWhitespace(toTrimmedString(source.canonicalBookUrl)),
		confidence,
		provider,
		warnings: uniqueStrings(toStringArray(source.warnings))
	};
};

const getFetchImpl = (options: BookResolverOptions): FetchLike => options.fetchImpl ?? fetch;

const getTimeout = (options: BookResolverOptions): number => options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

const fetchJson = async (
	url: string,
	options: BookResolverOptions,
	warnings: string[],
	label: string
): Promise<unknown | null> => {
	const fetchImpl = getFetchImpl(options);
	const timeoutMs = getTimeout(options);
	try {
		const abortController = new AbortController();
		const response = await withTimeout(
			() =>
				fetchImpl(
					url,
					buildFetchInit(abortController.signal, 'application/json,text/plain;q=0.9,*/*;q=0.8')
				),
			timeoutMs
		);

		if (!response.ok) {
			warnings.push(`${label} request failed (${response.status}).`);
			return null;
		}

		return (await response.json()) as unknown;
	} catch (error) {
		warnings.push(error instanceof Error ? `${label} request error: ${error.message}` : `${label} request failed.`);
		return null;
	}
};

const candidateKey = (candidate: NormalizedBookMetadata): string =>
	[
		candidate.provider,
		candidate.googleBooksId,
		candidate.openLibraryId,
		candidate.isbn13,
		candidate.isbn10,
		normalizeTitle(candidate.title),
		normalizeCompareText(candidate.authors[0]?.full ?? '')
	]
		.filter(Boolean)
		.join('|');

const scoreAuthorMatch = (clueAuthors: string[], candidateAuthors: NormalizedBookAuthor[]): {
	score: number;
	reason?: string;
} => {
	if (clueAuthors.length === 0 || candidateAuthors.length === 0) {
		return { score: 0 };
	}

	const normalizedClues = clueAuthors.map((author) => normalizeCompareText(author));
	const normalizedCandidates = candidateAuthors.map((author) => normalizeCompareText(author.full));

	for (const clueAuthor of normalizedClues) {
		if (normalizedCandidates.includes(clueAuthor)) {
			return { score: 34, reason: 'Exact author match.' };
		}
	}

	for (const clueAuthor of normalizedClues) {
		const family = splitAuthorName(clueAuthor).family;
		if (!family) {
			continue;
		}

		for (const candidateAuthor of candidateAuthors) {
			const candidateFamily = splitAuthorName(candidateAuthor.full).family;
			if (
				candidateFamily &&
				normalizeCompareText(candidateFamily) === normalizeCompareText(family)
			) {
				return { score: 16, reason: 'Author family-name overlap.' };
			}
		}
	}

	return { score: -24, reason: 'Author mismatch penalty.' };
};

const scoreBookCandidateAgainstClues = (
	candidate: NormalizedBookMetadata,
	clues: BookClues,
	provider: BookProvider
): { score: number; reasons: string[] } => {
	let score = Math.round(candidate.confidence * 50);
	const reasons: string[] = [];

	if (clues.isbn13 && candidate.isbn13 && clues.isbn13 === candidate.isbn13) {
		score += 110;
		reasons.push('Exact ISBN-13 match.');
	}

	if (clues.isbn10 && candidate.isbn10 && clues.isbn10 === candidate.isbn10) {
		score += 100;
		reasons.push('Exact ISBN-10 match.');
	}

	if (clues.title && candidate.title) {
		const similarity = scoreTitleMatch(clues.title, candidate.title);
		if (similarity >= 0.995) {
			score += 54;
			reasons.push('Exact normalized title match.');
		} else if (similarity >= 0.9) {
			score += 38;
			reasons.push('Strong title similarity.');
		} else if (similarity >= 0.75) {
			score += 20;
			reasons.push('Moderate title similarity.');
		} else if (similarity < 0.45) {
			score -= 30;
			reasons.push('Very different title penalty.');
		}
	}

	const authorScore = scoreAuthorMatch(clues.authors ?? [], candidate.authors);
	score += authorScore.score;
	if (authorScore.reason) {
		reasons.push(authorScore.reason);
	}

	if (clues.publisher && candidate.publisher) {
		const cluePublisher = normalizeCompareText(clues.publisher);
		const candidatePublisher = normalizeCompareText(candidate.publisher);
		if (
			cluePublisher &&
			candidatePublisher &&
			(cluePublisher.includes(candidatePublisher) || candidatePublisher.includes(cluePublisher))
		) {
			score += 10;
			reasons.push('Publisher match boost.');
		}
	}

	const clueYear = extractYear(clues.publishedDate ?? '');
	if (clueYear && candidate.year) {
		if (clueYear === candidate.year) {
			score += 10;
			reasons.push('Publication year match boost.');
		} else {
			score -= 6;
			reasons.push('Publication year mismatch penalty.');
		}
	}

	if (provider === 'googleBooks') {
		const printType = GOOGLE_CANDIDATE_PRINT_TYPE.get(candidateKey(candidate));
		if (printType === 'BOOK') {
			score += 14;
			reasons.push('Google printType=BOOK boost.');
		} else if (printType) {
			score -= 10;
			reasons.push(`Google printType=${printType} penalty.`);
		}
	}

	if (!candidate.title) {
		score -= 24;
		reasons.push('Missing title penalty.');
	}

	if (candidate.authors.length === 0) {
		score -= 8;
		reasons.push('Missing author penalty.');
	}

	return {
		score: clampScore(score),
		reasons
	};
};

export const rankGoogleBooksCandidates = (
	candidates: NormalizedBookMetadata[],
	clues: BookClues
): RankedGoogleBooksCandidates => {
	const ranked = candidates
		.map((candidate) => {
			const scored = scoreBookCandidateAgainstClues(candidate, clues, 'googleBooks');
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
		scoredCandidates: ranked
	};
};

const rankOpenLibraryCandidates = (candidates: NormalizedBookMetadata[], clues: BookClues): RankedBookCandidate[] =>
	candidates
		.map((candidate) => {
			const scored = scoreBookCandidateAgainstClues(candidate, clues, 'openLibrary');
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

const parseGoogleVolumeCandidate = (item: unknown, sourceUrl: string): ParsedGoogleVolume | null => {
	if (!item || typeof item !== 'object') {
		return null;
	}

	const record = item as Record<string, unknown>;
	const volumeInfo = (record.volumeInfo ?? {}) as Record<string, unknown>;
	const printType = toTrimmedString(volumeInfo.printType).toUpperCase();
	const canonicalVolumeLink = firstNonEmpty(
		toTrimmedString(volumeInfo.canonicalVolumeLink),
		toTrimmedString(record.selfLink)
	);

	const metadata = normalizeBookMetadata({
		title: volumeInfo.title,
		subtitle: volumeInfo.subtitle,
		authors: volumeInfo.authors,
		publisher: volumeInfo.publisher,
		publishedDate: volumeInfo.publishedDate,
		industryIdentifiers: volumeInfo.industryIdentifiers,
		googleBooksId: toTrimmedString(record.id),
		sourceUrl,
		canonicalBookUrl: canonicalVolumeLink,
		provider: 'googleBooks',
		confidence:
			0.66 +
			(printType === 'BOOK' ? 0.12 : 0) +
			(toTrimmedString(volumeInfo.title) ? 0.08 : 0) +
			(Array.isArray(volumeInfo.authors) && volumeInfo.authors.length > 0 ? 0.06 : 0),
		warnings: []
	});

	return {
		metadata,
		printType
	};
};

const buildGoogleBooksQueryUrl = (query: string, maxResults: number, apiKey?: string): string => {
	const params = new URLSearchParams();
	params.set('q', query);
	params.set('maxResults', String(maxResults));
	if (apiKey) {
		params.set('key', apiKey);
	}

	return `${GOOGLE_BOOKS_BASE_URL}?${params.toString()}`;
};

const cleanGoogleCandidates = (candidates: ParsedGoogleVolume[]): NormalizedBookMetadata[] => {
	const normalized = dedupeBookCandidates(candidates.map((candidate) => candidate.metadata));
	for (const parsed of candidates) {
		if (!parsed.metadata.googleBooksId) {
			continue;
		}
		GOOGLE_CANDIDATE_PRINT_TYPE.set(candidateKey(parsed.metadata), parsed.printType);
	}
	return normalized;
};

export const searchGoogleBooksByISBN = async (
	isbn: string,
	options: BookResolverOptions = {}
): Promise<GoogleBooksSearchResult> => {
	const warnings: string[] = [];
	const normalized = normalizeIsbn(isbn);
	const normalizedIsbn = firstNonEmpty(normalized.isbn13, normalized.isbn10);
	if (!normalizedIsbn) {
		return {
			method: 'none',
			bestMatch: null,
			scoredCandidates: [],
			warnings: ['Invalid ISBN input for Google Books lookup.']
		};
	}

	const queryUrl = buildGoogleBooksQueryUrl(`isbn:${normalizedIsbn}`, 5, options.googleApiKey);
	const payload = await fetchJson(queryUrl, options, warnings, 'Google Books ISBN');
	if (!payload || typeof payload !== 'object') {
		return { method: 'isbn', bestMatch: null, scoredCandidates: [], warnings };
	}

	const items = Array.isArray((payload as Record<string, unknown>).items)
		? ((payload as Record<string, unknown>).items as unknown[])
		: [];
	const parsedCandidates = items
		.map((item) => parseGoogleVolumeCandidate(item, queryUrl))
		.filter((item): item is ParsedGoogleVolume => item !== null);

	const candidates = cleanGoogleCandidates(parsedCandidates);
	const clues: BookClues = {
		isbn10: normalized.isbn10,
		isbn13: normalized.isbn13,
		confidence: 0,
		clues: [],
		warnings: []
	};
	const ranked = rankGoogleBooksCandidates(candidates, clues);

	return {
		method: 'isbn',
		bestMatch: ranked.bestMatch,
		scoredCandidates: ranked.scoredCandidates,
		warnings
	};
};

export const searchGoogleBooksByTitleAuthor = async (
	title: string,
	authors: string[] = [],
	options: BookResolverOptions = {}
): Promise<GoogleBooksSearchResult> => {
	const warnings: string[] = [];
	const cleanTitle = compactWhitespace(title);
	const cleanAuthors = uniqueStrings(authors.map((author) => compactWhitespace(author)));
	if (!cleanTitle && cleanAuthors.length === 0) {
		return {
			method: 'none',
			bestMatch: null,
			scoredCandidates: [],
			warnings: ['Title and author are both missing for Google Books search.']
		};
	}

	const queries: Array<{ query: string; method: GoogleBooksSearchMethod }> = [];
	if (cleanTitle && cleanAuthors.length > 0) {
		queries.push({
			query: `intitle:"${cleanTitle}"+inauthor:"${cleanAuthors[0]}"`,
			method: 'title-author'
		});
	}
	if (cleanTitle) {
		queries.push({ query: `intitle:"${cleanTitle}"`, method: 'title-only' });
	}
	if (cleanAuthors.length > 0) {
		queries.push({ query: `inauthor:"${cleanAuthors[0]}"`, method: 'author-only' });
	}

	let methodUsed: GoogleBooksSearchMethod = 'none';
	const parsedCandidates: ParsedGoogleVolume[] = [];
	for (const strategy of queries) {
		const queryUrl = buildGoogleBooksQueryUrl(strategy.query, 5, options.googleApiKey);
		const payload = await fetchJson(queryUrl, options, warnings, `Google Books ${strategy.method}`);
		if (!payload || typeof payload !== 'object') {
			continue;
		}

		const items = Array.isArray((payload as Record<string, unknown>).items)
			? ((payload as Record<string, unknown>).items as unknown[])
			: [];
		for (const item of items) {
			const parsed = parseGoogleVolumeCandidate(item, queryUrl);
			if (parsed) {
				parsedCandidates.push(parsed);
			}
		}

		if (items.length > 0 && methodUsed === 'none') {
			methodUsed = strategy.method;
		}
	}

	const candidates = cleanGoogleCandidates(parsedCandidates);
	const clues: BookClues = {
		title: cleanTitle || undefined,
		authors: cleanAuthors.length > 0 ? cleanAuthors : undefined,
		confidence: 0,
		clues: [],
		warnings: []
	};
	const ranked = rankGoogleBooksCandidates(candidates, clues);

	return {
		method: methodUsed,
		bestMatch: ranked.bestMatch,
		scoredCandidates: ranked.scoredCandidates,
		warnings
	};
};

const parseOpenLibraryId = (value: string): string => {
	const match = value.toUpperCase().match(/OL\d+[A-Z]/);
	return match?.[0] ?? '';
};

const searchOpenLibraryByIsbn = async (
	isbn: string,
	options: BookResolverOptions
): Promise<OpenLibrarySearchResult> => {
	const warnings: string[] = [];
	const normalized = normalizeIsbn(isbn);
	const normalizedIsbn = firstNonEmpty(normalized.isbn13, normalized.isbn10);
	if (!normalizedIsbn) {
		return { method: 'none', candidates: [], warnings: ['Invalid ISBN input for Open Library fallback.'] };
	}

	const queryUrl = `${OPEN_LIBRARY_BASE_URL}/api/books?bibkeys=ISBN:${encodeURIComponent(normalizedIsbn)}&jscmd=data&format=json`;
	const payload = await fetchJson(queryUrl, options, warnings, 'Open Library ISBN fallback');
	if (!payload || typeof payload !== 'object') {
		return { method: 'isbn', candidates: [], warnings };
	}

	const key = `ISBN:${normalizedIsbn}`;
	const record = (payload as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
	if (!record) {
		return { method: 'isbn', candidates: [], warnings };
	}

	const url = toTrimmedString(record.url);
	const openLibraryId = parseOpenLibraryId(url);
	const metadata = normalizeBookMetadata({
		title: record.title,
		subtitle: record.subtitle,
		authors: (record.authors as Array<Record<string, unknown>> | undefined)?.map((author) =>
			toTrimmedString(author.name)
		),
		publisher: (record.publishers as Array<Record<string, unknown>> | undefined)?.[0]?.name,
		publishedDate: record.publish_date,
		industryIdentifiers: record.identifiers,
		isbn10: normalized.isbn10,
		isbn13: normalized.isbn13,
		openLibraryId,
		sourceUrl: queryUrl,
		canonicalBookUrl: url ? `${OPEN_LIBRARY_BASE_URL}${url}` : '',
		provider: 'openLibrary',
		confidence: 0.8,
		warnings: []
	});

	return {
		method: 'isbn',
		candidates: [metadata],
		warnings
	};
};

const searchOpenLibraryByTitleAuthor = async (
	title: string,
	authors: string[],
	options: BookResolverOptions
): Promise<OpenLibrarySearchResult> => {
	const warnings: string[] = [];
	const cleanTitle = compactWhitespace(title);
	const cleanAuthors = uniqueStrings(authors.map((author) => compactWhitespace(author)));
	if (!cleanTitle && cleanAuthors.length === 0) {
		return {
			method: 'none',
			candidates: [],
			warnings: ['Title and author are both missing for Open Library fallback search.']
		};
	}

	const params = new URLSearchParams();
	params.set('limit', '5');
	params.set('fields', 'key,title,subtitle,author_name,publisher,first_publish_year,isbn,edition_key');

	let method: OpenLibrarySearchMethod = 'none';
	if (cleanTitle && cleanAuthors.length > 0) {
		params.set('title', cleanTitle);
		params.set('author', cleanAuthors[0]);
		method = 'title-author';
	} else if (cleanTitle) {
		params.set('title', cleanTitle);
		method = 'title-only';
	} else {
		params.set('author', cleanAuthors[0]);
		method = 'title-author';
	}

	const queryUrl = `${OPEN_LIBRARY_BASE_URL}/search.json?${params.toString()}`;
	const payload = await fetchJson(queryUrl, options, warnings, 'Open Library title-author fallback');
	if (!payload || typeof payload !== 'object') {
		return { method, candidates: [], warnings };
	}

	const docs = Array.isArray((payload as Record<string, unknown>).docs)
		? ((payload as Record<string, unknown>).docs as Array<Record<string, unknown>>)
		: [];

	const candidates = docs.slice(0, 5).map((doc) => {
		const openLibraryId = parseOpenLibraryId(
			firstNonEmpty(
				toTrimmedString(Array.isArray(doc.edition_key) ? doc.edition_key[0] : doc.edition_key),
				toTrimmedString(doc.key)
			)
		);

		return normalizeBookMetadata({
			title: doc.title,
			subtitle: doc.subtitle,
			authors: Array.isArray(doc.author_name) ? doc.author_name : [],
			publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
			publishedDate: doc.first_publish_year,
			isbn13: Array.isArray(doc.isbn)
				? firstNonEmpty(
					...doc.isbn
						.map((value) => toTrimmedString(value))
						.map((value) => normalizeIsbn(value).isbn13 ?? '')
				)
				: '',
			isbn10: Array.isArray(doc.isbn)
				? firstNonEmpty(
					...doc.isbn
						.map((value) => toTrimmedString(value))
						.map((value) => normalizeIsbn(value).isbn10 ?? '')
				)
				: '',
			openLibraryId,
			sourceUrl: queryUrl,
			canonicalBookUrl: openLibraryId ? `${OPEN_LIBRARY_BASE_URL}/books/${openLibraryId}` : '',
			provider: 'openLibrary',
			confidence: 0.68,
			warnings: []
		});
	});

	return {
		method,
		candidates: dedupeBookCandidates(candidates),
		warnings
	};
};

const combineWarnings = (...values: string[][]): string[] => uniqueStrings(values.flat());

export const searchOpenLibraryFallback = async (
	clues: BookClues,
	options: BookResolverOptions = {}
): Promise<OpenLibraryFallbackResult> => {
	const warnings: string[] = [];
	let candidates: NormalizedBookMetadata[] = [];

	if (clues.isbn13 || clues.isbn10) {
		const isbnResult = await searchOpenLibraryByIsbn(clues.isbn13 ?? clues.isbn10 ?? '', options);
		warnings.push(...isbnResult.warnings);
		candidates = [...candidates, ...isbnResult.candidates];
	}

	if (candidates.length === 0 && clues.title) {
		const titleAuthorResult = await searchOpenLibraryByTitleAuthor(
			clues.title,
			clues.authors ?? [],
			options
		);
		warnings.push(...titleAuthorResult.warnings);
		candidates = [...candidates, ...titleAuthorResult.candidates];
	}

	const deduped = dedupeBookCandidates(candidates);
	const ranked = rankOpenLibraryCandidates(deduped, clues);

	return {
		bestMatch: ranked[0] ?? null,
		scoredCandidates: ranked,
		warnings: uniqueStrings(warnings)
	};
};

const shouldAttemptResolverFromClues = (clues: BookClues): boolean => {
	if (clues.isbn10 || clues.isbn13 || clues.googleBooksId) {
		return true;
	}
	if ((clues.title && (clues.authors?.length ?? 0) > 0) || clues.confidence >= 0.34) {
		return true;
	}
	return false;
};

const chooseBetterCandidate = (
	googleBest: RankedBookCandidate | null,
	openLibraryBest: RankedBookCandidate | null
): { provider: BookProvider; chosen: RankedBookCandidate | null } => {
	if (!googleBest && !openLibraryBest) {
		return { provider: 'none', chosen: null };
	}

	if (googleBest && !openLibraryBest) {
		return { provider: 'googleBooks', chosen: googleBest };
	}

	if (!googleBest && openLibraryBest) {
		return { provider: 'openLibrary', chosen: openLibraryBest };
	}

	const googleComposite = (googleBest?.score ?? 0) / 200 + (googleBest?.candidate.confidence ?? 0);
	const openLibraryComposite =
		(openLibraryBest?.score ?? 0) / 200 + (openLibraryBest?.candidate.confidence ?? 0);

	if (googleComposite >= openLibraryComposite) {
		return { provider: 'googleBooks', chosen: googleBest ?? null };
	}

	return { provider: 'openLibrary', chosen: openLibraryBest ?? null };
};

const createEmptyMetadata = (sourceUrl: string, canonicalBookUrl: string, warnings: string[]): NormalizedBookMetadata =>
	normalizeBookMetadata({
		title: '',
		subtitle: '',
		authors: [],
		publisher: '',
		publishedDate: '',
		isbn10: '',
		isbn13: '',
		googleBooksId: '',
		openLibraryId: '',
		sourceUrl,
		canonicalBookUrl,
		provider: 'none',
		confidence: 0,
		warnings
	});

export const resolveBookFromUrl = async (
	url: string,
	options: BookResolverOptions = {}
): Promise<ResolveBookFromUrlResult> => {
	const normalizedUrl = normalizeUrl(url);
	const warnings: string[] = [];

	if (!normalizedUrl.normalizedUrl) {
		const invalidWarning = 'Invalid URL format.';
		const clues: BookClues = {
			confidence: 0,
			clues: [],
			warnings: [invalidWarning]
		};
		return {
			found: false,
			provider: 'none',
			sourceType: 'unknown',
			confidence: 0,
			method: 'none',
			metadata: createEmptyMetadata('', '', [invalidWarning]),
			clues,
			warnings: [invalidWarning]
		};
	}

	const pageResult: PageFetchResult = options.pageHtml
		? {
				ok: true,
				status: 200,
				html: options.pageHtml,
				finalUrl: options.finalUrl ?? normalizedUrl.normalizedUrl,
				warnings: []
			}
		: await fetchPage(normalizedUrl.normalizedUrl, options);
	warnings.push(...pageResult.warnings);

	const clues = extractBookClues(normalizedUrl, pageResult.html ?? '');
	warnings.push(...clues.warnings);

	if (!shouldAttemptResolverFromClues(clues)) {
		warnings.push('No strong book clues found; skipping external catalog lookup.');
		return {
			found: false,
			provider: 'none',
			sourceType: 'unknown',
			confidence: clampConfidence(clues.confidence * 0.6),
			method: 'none',
			metadata: createEmptyMetadata(normalizedUrl.normalizedUrl, normalizedUrl.normalizedUrl, warnings),
			clues,
			warnings: uniqueStrings(warnings)
		};
	}

	let googleBest: RankedBookCandidate | null = null;
	let googleMethod: ResolveBookMethod = 'none';
	let googleWarnings: string[] = [];

	if (clues.isbn13 || clues.isbn10) {
		const isbnResult = await searchGoogleBooksByISBN(clues.isbn13 ?? clues.isbn10 ?? '', options);
		googleWarnings = [...googleWarnings, ...isbnResult.warnings];
		if (isbnResult.bestMatch) {
			googleBest = isbnResult.bestMatch;
			googleMethod = 'isbn';
		}
	}

	if (!googleBest || googleBest.score < GOOGLE_STRONG_SCORE) {
		const titleAuthorResult = await searchGoogleBooksByTitleAuthor(
			clues.title ?? '',
			clues.authors ?? [],
			options
		);
		googleWarnings = [...googleWarnings, ...titleAuthorResult.warnings];
		if (titleAuthorResult.bestMatch) {
			if (!googleBest || titleAuthorResult.bestMatch.score > googleBest.score) {
				googleBest = titleAuthorResult.bestMatch;
				googleMethod =
					titleAuthorResult.method === 'title-author'
						? 'title-author'
						: titleAuthorResult.method === 'title-only'
							? 'title-only'
							: googleMethod;
			}
		}
	}

	warnings.push(...googleWarnings);

	let openLibraryBest: RankedBookCandidate | null = null;
	let openLibraryWarnings: string[] = [];
	const shouldTryOpenLibrary = options.fallbackToOpenLibrary !== false;
	if (shouldTryOpenLibrary && (!googleBest || googleBest.score < GOOGLE_STRONG_SCORE)) {
		const fallbackResult = await searchOpenLibraryFallback(clues, options);
		openLibraryBest = fallbackResult.bestMatch;
		openLibraryWarnings = fallbackResult.warnings;
	}
	warnings.push(...openLibraryWarnings);

	const selected = chooseBetterCandidate(googleBest, openLibraryBest);
	const chosen = selected.chosen;
	if (!chosen) {
		warnings.push('No strong match found in Google Books or Open Library.');
		return {
			found: false,
			provider: 'none',
			sourceType: 'unknown',
			confidence: clampConfidence(clues.confidence * 0.7),
			method: 'none',
			metadata: createEmptyMetadata(
				normalizedUrl.normalizedUrl,
				normalizedUrl.normalizedUrl,
				uniqueStrings(warnings)
			),
			clues,
			warnings: uniqueStrings(warnings)
		};
	}

	const method: ResolveBookMethod =
		selected.provider === 'googleBooks'
			? googleMethod
			: selected.provider === 'openLibrary'
				? 'fallback'
				: 'none';

	const scoreThreshold = selected.provider === 'googleBooks' ? GOOGLE_STRONG_SCORE : OPEN_LIBRARY_STRONG_SCORE;
	const found = chosen.score >= scoreThreshold || chosen.candidate.confidence >= 0.7;

	const enrichedWarnings = combineWarnings(chosen.candidate.warnings, warnings, chosen.reasons);
	const metadata = normalizeBookMetadata({
		...chosen.candidate,
		sourceUrl: firstNonEmpty(chosen.candidate.sourceUrl, normalizedUrl.normalizedUrl),
		canonicalBookUrl: firstNonEmpty(chosen.candidate.canonicalBookUrl, normalizedUrl.normalizedUrl),
		provider: selected.provider,
		confidence: clampConfidence((chosen.score / 200 + chosen.candidate.confidence + clues.confidence) / 3),
		warnings: enrichedWarnings
	});

	return {
		found,
		provider: found ? selected.provider : 'none',
		sourceType: found ? 'book' : 'unknown',
		confidence: metadata.confidence,
		method: found ? method : 'none',
		metadata,
		clues,
		warnings: uniqueStrings(enrichedWarnings)
	};
};

/*
Sample usage:

const result = await resolveBookFromUrl('https://books.google.com/books?id=8X8mAQAAQBAJ');
// {
//   found: true,
//   provider: 'googleBooks',
//   sourceType: 'book',
//   confidence: 0.89,
//   method: 'isbn' | 'title-author' | 'title-only' | 'fallback',
//   metadata: { ...normalized book fields... },
//   clues: { ...detected page clues... },
//   warnings: []
// }
*/
