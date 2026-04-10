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
const URL_PATTERN = /(https?:\/\/[^\s<>"'`]+)/i;
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const TITLE_TAG_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const DOI_PATTERN = /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+\b/i;
const ISBN_PATTERN = /\b(?:97[89][\-\s]?)?[0-9][0-9\-\s]{8,20}[0-9X]\b/i;
const ISSN_PATTERN = /\b\d{4}-\d{3}[\dX]\b/i;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 1_800_000;

export const SOURCE_TYPE_VALUES = [
	'Websites & Webpage',
	'Newspaper & Magazine Articles',
	'Journal Articles',
	'Government Report',
	'Organization Report',
	'Conference Papers',
	'Blog/Blog Post',
	'Social Media Post',
	'Books',
	'Theses & Dissertations',
	'Standards & Patents',
	'Film, Movie, or TV',
	'Podcast',
	'YouTube',
	'Dataset'
] as const;

export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

type JsonLdAuthor = {
	name: string;
	corporate: boolean;
};

type JsonLdExtraction = {
	types: Set<string>;
	titles: string[];
	siteNames: string[];
	containerTitles: string[];
	authors: JsonLdAuthor[];
	publisherNames: string[];
	organizationNames: string[];
	publicationDates: string[];
	updatedDates: string[];
	descriptions: string[];
	dois: string[];
	isbns: string[];
	issns: string[];
	volumes: string[];
	issues: string[];
	pages: string[];
};

export type NormalizedSourceAuthor = {
	given: string;
	family: string;
	full: string;
	corporate: boolean;
};

export type NormalizedSourceMetadata = {
	sourceType: SourceType;
	title: string;
	subtitle: string;
	authors: NormalizedSourceAuthor[];
	containerTitle: string;
	siteName: string;
	publisher: string;
	organization: string;
	publicationDate: string;
	updatedDate: string;
	accessDate: string;
	year: string;
	month: string;
	day: string;
	volume: string;
	issue: string;
	pages: string;
	edition: string;
	doi: string;
	isbn: string;
	issn: string;
	url: string;
	canonicalUrl: string;
	language: string;
	description: string;
	confidence: number;
};

export type CitationSourceContext = {
	sourceText: string;
	sourceName: string;
	sourceType: SourceType;
	confidence: number;
	reasoningShort: string;
	missingFields: string[];
	warnings: string[];
	metadata: NormalizedSourceMetadata;
};

type FetchedDocument = {
	inputUrl: string;
	finalUrl: string;
	html: string;
	contentType: string;
	status: number;
};

type SourceTypeDecision = {
	sourceType: SourceType;
	reasoningShort: string;
	confidence: number;
};

export type ResearchGatePublicationInfo = {
	isPublication: boolean;
	candidateTitle: string;
	normalizedUrl: string;
};

const toTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const normalizeSourceTypeLabel = (value: string): SourceType => {
	const normalized = compactWhitespace(value).toLowerCase();

	if (!normalized) {
		return 'Websites & Webpage';
	}

	const exact = SOURCE_TYPE_VALUES.find((item) => item.toLowerCase() === normalized);
	if (exact) {
		return exact;
	}

	if (normalized.includes('youtube')) {
		return 'YouTube';
	}

	if (normalized.includes('podcast')) {
		return 'Podcast';
	}

	if (normalized.includes('dataset') || normalized.includes('data set')) {
		return 'Dataset';
	}

	if (normalized.includes('thesis') || normalized.includes('dissertation')) {
		return 'Theses & Dissertations';
	}

	if (normalized.includes('standard') || normalized.includes('patent')) {
		return 'Standards & Patents';
	}

	if (
		normalized.includes('film') ||
		normalized.includes('movie') ||
		normalized.includes('tv') ||
		normalized.includes('video')
	) {
		return 'Film, Movie, or TV';
	}

	if (normalized.includes('social')) {
		return 'Social Media Post';
	}

	if (normalized.includes('book')) {
		return 'Books';
	}

	if (normalized.includes('conference')) {
		return 'Conference Papers';
	}

	if (normalized.includes('government') || normalized.includes('gov')) {
		return 'Government Report';
	}

	if (
		normalized.includes('organization') ||
		normalized.includes('organisation') ||
		normalized.includes('ngo') ||
		normalized.includes('institutional')
	) {
		return 'Organization Report';
	}

	if (normalized.includes('journal') || normalized.includes('preprint') || normalized.includes('scholarly')) {
		return 'Journal Articles';
	}

	if (
		normalized.includes('newspaper') ||
		normalized.includes('magazine') ||
		normalized.includes('news')
	) {
		return 'Newspaper & Magazine Articles';
	}

	if (normalized.includes('blog')) {
		return 'Blog/Blog Post';
	}

	return 'Websites & Webpage';
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

const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>();
	const deduped: string[] = [];

	for (const value of values) {
		const normalized = value.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		deduped.push(value);
	}

	return deduped;
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
	for (const value of values) {
		const normalized = toTrimmedString(value);
		if (normalized) {
			return normalized;
		}
	}

	return '';
};

const toIsoDate = (value: string): string => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return '';
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return normalized;
	}

	if (/^\d{4}$/.test(normalized)) {
		return `${normalized}-01-01`;
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return '';
	}

	return parsed.toISOString().slice(0, 10);
};

const splitName = (fullName: string): { given: string; family: string } => {
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

const looksCorporateName = (name: string): boolean => {
	const normalized = name.toLowerCase();
	return /(university|department|ministry|agency|organization|organisation|foundation|institute|office|government|committee|council|association|society|commission|ngo|inc\.?|ltd\.?)/.test(
		normalized
	);
};

const normalizeAuthor = (name: string, corporateHint = false): NormalizedSourceAuthor | null => {
	const full = compactWhitespace(name);
	if (!full) {
		return null;
	}

	const corporate = corporateHint || looksCorporateName(full);
	if (corporate) {
		return {
			given: '',
			family: '',
			full,
			corporate: true
		};
	}

	const split = splitName(full);
	return {
		given: split.given,
		family: split.family,
		full,
		corporate: false
	};
};

const splitPotentialAuthorList = (value: string): string[] => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return [];
	}

	const chunks = normalized
		.split(/\s+(?:and|và|&)\s+|\s*[;|/]\s*|\s+-\s+/i)
		.map((part) => compactWhitespace(part))
		.filter(Boolean);

	if (chunks.length <= 1) {
		return [normalized];
	}

	return chunks;
};

const stripDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const tokenizeAuthorName = (value: string): string[] =>
	stripDiacritics(compactWhitespace(value))
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);

const toAuthorSignal = (author: NormalizedSourceAuthor): {
	significantTokens: Set<string>;
	initialTokens: Set<string>;
} => {
	const tokens = tokenizeAuthorName(author.full);
	const significantTokens = new Set(tokens.filter((token) => token.length > 1));
	const initialTokens = new Set(tokens.filter((token) => token.length === 1));

	return {
		significantTokens,
		initialTokens
	};
};

const isSubset = <T>(left: Set<T>, right: Set<T>): boolean => {
	for (const value of left) {
		if (!right.has(value)) {
			return false;
		}
	}

	return true;
};

const areLikelySameAuthor = (left: NormalizedSourceAuthor, right: NormalizedSourceAuthor): boolean => {
	if (left.corporate || right.corporate) {
		return compactWhitespace(left.full).toLowerCase() === compactWhitespace(right.full).toLowerCase();
	}

	const leftSignal = toAuthorSignal(left);
	const rightSignal = toAuthorSignal(right);

	if (leftSignal.significantTokens.size === 0 || rightSignal.significantTokens.size === 0) {
		return compactWhitespace(left.full).toLowerCase() === compactWhitespace(right.full).toLowerCase();
	}

	if (
		leftSignal.significantTokens.size === rightSignal.significantTokens.size &&
		isSubset(leftSignal.significantTokens, rightSignal.significantTokens)
	) {
		return true;
	}

	const leftSubsetRight = isSubset(leftSignal.significantTokens, rightSignal.significantTokens);
	const rightSubsetLeft = isSubset(rightSignal.significantTokens, leftSignal.significantTokens);
	if (!leftSubsetRight && !rightSubsetLeft) {
		return false;
	}

	const bigger = leftSubsetRight ? rightSignal : leftSignal;
	const smaller = leftSubsetRight ? leftSignal : rightSignal;

	const extraInitials = Array.from(bigger.significantTokens)
		.filter((token) => !smaller.significantTokens.has(token))
		.map((token) => token.charAt(0));

	if (extraInitials.length === 0) {
		return true;
	}

	for (const initial of extraInitials) {
		if (!smaller.initialTokens.has(initial)) {
			return false;
		}
	}

	return true;
};

const looksLikeDomainAuthor = (value: string): boolean => {
	const normalized = compactWhitespace(value).toLowerCase();
	return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized);
};

const normalizeHostForCompare = (value: string): string =>
	compactWhitespace(value).toLowerCase().replace(/^www\./, '');

const shouldDropAuthor = (author: NormalizedSourceAuthor, siteName: string, urlValue: string): boolean => {
	const full = compactWhitespace(author.full);
	if (!full) {
		return true;
	}

	const normalizedFull = normalizeHostForCompare(full);
	const normalizedSite = normalizeHostForCompare(siteName);
	const domain = normalizeHostForCompare(getDomain(urlValue));

	if (looksLikeDomainAuthor(normalizedFull)) {
		return true;
	}

	if (normalizedSite && normalizedFull === normalizedSite) {
		return true;
	}

	if (domain && normalizedFull === domain) {
		return true;
	}

	return false;
};

const authorQualityScore = (author: NormalizedSourceAuthor): number => {
	const tokens = tokenizeAuthorName(author.full);
	const significantTokenCount = tokens.filter((token) => token.length > 1).length;
	const initialTokenCount = tokens.filter((token) => token.length === 1).length;
	return (
		(author.corporate ? 1 : 10) +
		significantTokenCount * 5 +
		compactWhitespace(author.full).length -
		initialTokenCount * 4
	);
};

const dedupeAuthors = (authors: NormalizedSourceAuthor[]): NormalizedSourceAuthor[] => {
	const result: NormalizedSourceAuthor[] = [];

	for (const author of authors) {
		const duplicateIndex = result.findIndex((existing) => areLikelySameAuthor(existing, author));
		if (duplicateIndex === -1) {
			result.push(author);
			continue;
		}

		if (authorQualityScore(author) > authorQualityScore(result[duplicateIndex])) {
			result[duplicateIndex] = author;
		}
	}

	return result;
};

const normalizeUrlValue = (value: string): string => {
	const raw = toTrimmedString(value);
	if (!raw) {
		return '';
	}

	try {
		const parsed = new URL(raw);
		parsed.hash = '';

		for (const key of Array.from(parsed.searchParams.keys())) {
			const normalized = key.toLowerCase();
			if (
				TRACKING_QUERY_KEYS.has(normalized) ||
				TRACKING_QUERY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
			) {
				parsed.searchParams.delete(key);
			}
		}

		return parsed.toString();
	} catch {
		return raw;
	}
};

const decodeUrlSegment = (value: string): string => {
	if (!value) {
		return '';
	}

	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const normalizeResearchGateSlugTitle = (value: string): string =>
	compactWhitespace(
		decodeUrlSegment(value)
			.replace(/\+/g, ' ')
			.replace(/[_-]+/g, ' ')
	);

export const getResearchGatePublicationInfo = (urlValue: string): ResearchGatePublicationInfo => {
	const normalizedUrl = normalizeUrlValue(urlValue);
	if (!normalizedUrl) {
		return {
			isPublication: false,
			candidateTitle: '',
			normalizedUrl: ''
		};
	}

	try {
		const parsed = new URL(normalizedUrl);
		const host = parsed.hostname.toLowerCase();
		const isResearchGateHost = host === 'researchgate.net' || host.endsWith('.researchgate.net');
		if (!isResearchGateHost) {
			return {
				isPublication: false,
				candidateTitle: '',
				normalizedUrl
			};
		}

		const path = parsed.pathname;
		if (!/^\/publication\//i.test(path)) {
			return {
				isPublication: false,
				candidateTitle: '',
				normalizedUrl
			};
		}

		const publicationSegment = path.split('/').filter(Boolean)[1] ?? '';
		const slugWithOptionalPrefix = publicationSegment.replace(/^\d+_/, '');
		const candidateTitle = normalizeResearchGateSlugTitle(slugWithOptionalPrefix);

		return {
			isPublication: true,
			candidateTitle,
			normalizedUrl
		};
	} catch {
		return {
			isPublication: false,
			candidateTitle: '',
			normalizedUrl
		};
	}
};

export const isResearchGatePublicationUrl = (urlValue: string): boolean =>
	getResearchGatePublicationInfo(urlValue).isPublication;

const extractUrlFromSourceLine = (sourceLine: string): string | null => {
	const match = sourceLine.match(URL_PATTERN);
	if (!match?.[0]) {
		return null;
	}

	const candidate = normalizeUrlValue(match[0]);
	if (!candidate) {
		return null;
	}

	try {
		new URL(candidate);
		return candidate;
	} catch {
		return null;
	}
};

const parseTagAttributes = (tagSource: string): Record<string, string> => {
	const attributes: Record<string, string> = {};
	for (const match of tagSource.matchAll(ATTRIBUTE_PATTERN)) {
		const key = match[1]?.toLowerCase();
		const value = firstNonEmpty(match[3], match[4], match[5]);
		if (!key || !value) {
			continue;
		}

		attributes[key] = decodeHtmlEntities(value);
	}

	return attributes;
};

const collectMetaMap = (html: string): Map<string, string[]> => {
	const map = new Map<string, string[]>();
	for (const tag of html.match(META_TAG_PATTERN) ?? []) {
		const attributes = parseTagAttributes(tag);
		const key = firstNonEmpty(
			attributes.name,
			attributes.property,
			attributes['http-equiv'],
			attributes.itemprop
		).toLowerCase();
		const content = compactWhitespace(firstNonEmpty(attributes.content, attributes.value));

		if (!key || !content) {
			continue;
		}

		const bucket = map.get(key) ?? [];
		bucket.push(content);
		map.set(key, bucket);
	}

	return map;
};

const collectCanonicalUrl = (html: string): string => {
	for (const tag of html.match(LINK_TAG_PATTERN) ?? []) {
		const attributes = parseTagAttributes(tag);
		const rel = toTrimmedString(attributes.rel).toLowerCase();
		if (!rel.includes('canonical')) {
			continue;
		}

		const href = normalizeUrlValue(attributes.href ?? '');
		if (href) {
			return href;
		}
	}

	return '';
};

const collectTitle = (html: string): string => {
	const match = html.match(TITLE_TAG_PATTERN);
	if (!match?.[1]) {
		return '';
	}

	return compactWhitespace(decodeHtmlEntities(match[1]));
};

const createEmptyJsonLdExtraction = (): JsonLdExtraction => ({
	types: new Set<string>(),
	titles: [],
	siteNames: [],
	containerTitles: [],
	authors: [],
	publisherNames: [],
	organizationNames: [],
	publicationDates: [],
	updatedDates: [],
	descriptions: [],
	dois: [],
	isbns: [],
	issns: [],
	volumes: [],
	issues: [],
	pages: []
});

const pushIfPresent = (target: string[], value: unknown): void => {
	const normalized = compactWhitespace(toTrimmedString(value));
	if (normalized) {
		target.push(normalized);
	}
};

const collectJsonLdAuthor = (target: JsonLdAuthor[], value: unknown): void => {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectJsonLdAuthor(target, item);
		}
		return;
	}

	if (typeof value === 'string') {
		const normalized = compactWhitespace(value);
		if (normalized) {
			target.push({
				name: normalized,
				corporate: looksCorporateName(normalized)
			});
		}
		return;
	}

	if (!value || typeof value !== 'object') {
		return;
	}

	const record = value as Record<string, unknown>;
	const name = compactWhitespace(
		firstNonEmpty(
			record.name as string,
			record.alternateName as string,
			record.legalName as string
		)
	);
	if (!name) {
		return;
	}

	const rawType = String(record['@type'] ?? '').toLowerCase();
	target.push({
		name,
		corporate:
			rawType.includes('organization') ||
			rawType.includes('governmentorganization') ||
			rawType.includes('newsmediaorganization') ||
			looksCorporateName(name)
	});
};

const extractIdentifiersFromValue = (value: unknown, extraction: JsonLdExtraction): void => {
	if (typeof value === 'string') {
		const normalized = compactWhitespace(value);
		if (!normalized) {
			return;
		}

		const doi = normalized.match(DOI_PATTERN)?.[0] ?? '';
		const isbn = normalized.match(ISBN_PATTERN)?.[0] ?? '';
		const issn = normalized.match(ISSN_PATTERN)?.[0] ?? '';
		if (doi) {
			extraction.dois.push(doi);
		}
		if (isbn) {
			extraction.isbns.push(isbn.replace(/\s+/g, ''));
		}
		if (issn) {
			extraction.issns.push(issn.toUpperCase());
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			extractIdentifiersFromValue(item, extraction);
		}
		return;
	}

	if (!value || typeof value !== 'object') {
		return;
	}

	const record = value as Record<string, unknown>;
	extractIdentifiersFromValue(record.value, extraction);
	extractIdentifiersFromValue(record.identifier, extraction);
	extractIdentifiersFromValue(record.name, extraction);
};

const walkJsonLdNode = (value: unknown, extraction: JsonLdExtraction, depth = 0): void => {
	if (depth > 10 || value == null) {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			walkJsonLdNode(item, extraction, depth + 1);
		}
		return;
	}

	if (typeof value !== 'object') {
		return;
	}

	const node = value as Record<string, unknown>;
	const typeValue = node['@type'];
	if (typeof typeValue === 'string') {
		extraction.types.add(typeValue.toLowerCase());
	} else if (Array.isArray(typeValue)) {
		for (const item of typeValue) {
			if (typeof item === 'string') {
				extraction.types.add(item.toLowerCase());
			}
		}
	}

	pushIfPresent(extraction.titles, node.headline);
	pushIfPresent(extraction.titles, node.name);
	pushIfPresent(extraction.titles, node.title);
	pushIfPresent(extraction.siteNames, node.alternativeHeadline);
	pushIfPresent(extraction.containerTitles, node.isPartOf && (node.isPartOf as Record<string, unknown>).name);
	pushIfPresent(extraction.publisherNames, node.publisher && (node.publisher as Record<string, unknown>).name);
	pushIfPresent(extraction.organizationNames, node.sourceOrganization && (node.sourceOrganization as Record<string, unknown>).name);
	pushIfPresent(extraction.publicationDates, node.datePublished);
	pushIfPresent(extraction.updatedDates, node.dateModified);
	pushIfPresent(extraction.updatedDates, node.dateUpdated);
	pushIfPresent(extraction.descriptions, node.description);
	pushIfPresent(extraction.dois, node.doi);
	pushIfPresent(extraction.isbns, node.isbn);
	pushIfPresent(extraction.issns, node.issn);
	pushIfPresent(extraction.volumes, node.volumeNumber);
	pushIfPresent(extraction.issues, node.issueNumber);
	pushIfPresent(extraction.pages, node.pagination);
	pushIfPresent(extraction.pages, node.pageStart);

	collectJsonLdAuthor(extraction.authors, node.author);
	collectJsonLdAuthor(extraction.authors, node.creator);
	collectJsonLdAuthor(extraction.authors, node.accountablePerson);
	extractIdentifiersFromValue(node.identifier, extraction);

	for (const nestedValue of Object.values(node)) {
		if (nestedValue && typeof nestedValue === 'object') {
			walkJsonLdNode(nestedValue, extraction, depth + 1);
		}
	}
};

const collectJsonLd = (html: string): JsonLdExtraction => {
	const extraction = createEmptyJsonLdExtraction();

	for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
		const raw = toTrimmedString(match[1]);
		if (!raw) {
			continue;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			walkJsonLdNode(parsed, extraction);
		} catch {
			continue;
		}
	}

	extraction.titles = uniqueStrings(extraction.titles.map(compactWhitespace).filter(Boolean));
	extraction.siteNames = uniqueStrings(extraction.siteNames.map(compactWhitespace).filter(Boolean));
	extraction.containerTitles = uniqueStrings(extraction.containerTitles.map(compactWhitespace).filter(Boolean));
	extraction.publisherNames = uniqueStrings(extraction.publisherNames.map(compactWhitespace).filter(Boolean));
	extraction.organizationNames = uniqueStrings(
		extraction.organizationNames.map(compactWhitespace).filter(Boolean)
	);
	extraction.publicationDates = uniqueStrings(extraction.publicationDates.map(compactWhitespace).filter(Boolean));
	extraction.updatedDates = uniqueStrings(extraction.updatedDates.map(compactWhitespace).filter(Boolean));
	extraction.descriptions = uniqueStrings(extraction.descriptions.map(compactWhitespace).filter(Boolean));
	extraction.dois = uniqueStrings(extraction.dois.map(compactWhitespace).filter(Boolean));
	extraction.isbns = uniqueStrings(extraction.isbns.map(compactWhitespace).filter(Boolean));
	extraction.issns = uniqueStrings(extraction.issns.map(compactWhitespace).filter(Boolean));
	extraction.volumes = uniqueStrings(extraction.volumes.map(compactWhitespace).filter(Boolean));
	extraction.issues = uniqueStrings(extraction.issues.map(compactWhitespace).filter(Boolean));
	extraction.pages = uniqueStrings(extraction.pages.map(compactWhitespace).filter(Boolean));
	extraction.authors = extraction.authors.filter((item) => item.name);

	return extraction;
};

const getMetaFirst = (metaMap: Map<string, string[]>, ...keys: string[]): string => {
	for (const key of keys) {
		const value = metaMap.get(key.toLowerCase())?.[0];
		if (value) {
			return compactWhitespace(value);
		}
	}

	return '';
};

const getMetaAll = (metaMap: Map<string, string[]>, ...keys: string[]): string[] => {
	const values: string[] = [];
	for (const key of keys) {
		const bucket = metaMap.get(key.toLowerCase());
		if (!bucket) {
			continue;
		}
		for (const value of bucket) {
			const normalized = compactWhitespace(value);
			if (normalized) {
				values.push(normalized);
			}
		}
	}

	return uniqueStrings(values);
};

const removeDuplicatedSiteName = (title: string, siteName: string): string => {
	const normalizedTitle = compactWhitespace(title);
	const normalizedSite = compactWhitespace(siteName);
	if (!normalizedTitle || !normalizedSite) {
		return normalizedTitle;
	}

	const separators = [' | ', ' - ', ' — ', ' · '];
	for (const separator of separators) {
		const suffix = `${separator}${normalizedSite}`.toLowerCase();
		if (normalizedTitle.toLowerCase().endsWith(suffix)) {
			return normalizedTitle.slice(0, -suffix.length).trim();
		}
	}

	return normalizedTitle;
};

const toDateParts = (isoDate: string): { year: string; month: string; day: string } => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
		return { year: '', month: '', day: '' };
	}

	return {
		year: isoDate.slice(0, 4),
		month: isoDate.slice(5, 7),
		day: isoDate.slice(8, 10)
	};
};

const getDomain = (urlValue: string): string => {
	try {
		return new URL(urlValue).hostname.toLowerCase();
	} catch {
		return '';
	}
};

const getPathname = (urlValue: string): string => {
	try {
		return new URL(urlValue).pathname.toLowerCase();
	} catch {
		return '';
	}
};

const hasNewsDomainSignal = (domain: string): boolean => {
	return /(nytimes|bbc|cnn|reuters|theguardian|washingtonpost|forbes|bloomberg|aljazeera|apnews|nbcnews|abcnews|usatoday|wsj|latimes|nypost|nydailynews|chicagotribune|bostonglobe|inquirer|seattletimes|startribune|newsday|denverpost|houstonchronicle|tampabay|dallasnews|ocregister|post-gazette|sfchronicle|ajc|miamiherald|freep|azcentral|stltoday|kansascity|charlotteobserver|cleveland|oregonlive|sacbee|baltimoresun|courant|reviewjournal|jsonline|vnexpress|vietnamnet|vietnamnews|vietnamplus|dantri|baomoi|vietbao|tienphong|baodautu|dautu|sggp|nhandan|tuoitre|thanhnien|laodong|hanoimoi|vneconomy|bongda|qdnd|nld|anninhthudo|plo|cand|suckhoedoisong|giadinhxahoi|phunuonline|danviet|nongnghiep|baogiaothong|nguoiduatin|baochinhphu|znews|vov|vietnambiz|cafef)/.test(
		domain
	);
};

const hasAcademicDomainSignal = (domain: string): boolean => {
	return /arxiv\.org|ssrn\.com|biorxiv\.org|medrxiv\.org|acm\.org|ieeexplore\.ieee\.org|sciencedirect\.com|nature\.com|springer\.com|link\.springer\.com|wiley\.com|tandfonline\.com|jstor\.org|openreview\.net|semanticscholar\.org|plos\.org|frontiersin\.org/.test(
		domain
	);
};

const hasSocialDomainSignal = (domain: string): boolean => {
	return /(x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|reddit\.com|tiktok\.com|threads\.net)/.test(
		domain
	);
};

const hasYoutubeDomainSignal = (domain: string): boolean => {
	return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(domain);
};

const hasStandardsOrPatentDomainSignal = (domain: string): boolean => {
	return /(wipo|uspto|espacenet|patents\.google|iso\.org|iec\.ch|ansi\.org|astm\.org|standards?)/.test(
		domain
	);
};

const hasGovDomain = (domain: string): boolean => {
	return /(^|\.)gov(\.|$)/.test(domain);
};

const hasOrgDomain = (domain: string): boolean => {
	return /\.org$/.test(domain);
};

const hasEduDomain = (domain: string): boolean => {
	return /\.edu$/.test(domain);
};

const detectSourceType = (args: {
	domain: string;
	pathname: string;
	contentType: string;
	jsonLdTypes: Set<string>;
	researchGatePublication: boolean;
	doi: string;
	isbn: string;
	containerTitle: string;
	publicationDate: string;
	title: string;
	authors: NormalizedSourceAuthor[];
	siteName: string;
}): SourceTypeDecision => {
	const types = args.jsonLdTypes;
	const lowerTitle = args.title.toLowerCase();
	const lowerPath = args.pathname;
	const lowerContainer = args.containerTitle.toLowerCase();
	const lowerCombined = `${lowerTitle} ${lowerContainer} ${lowerPath} ${Array.from(types).join(' ')}`;
	const isPdf = args.contentType.includes('application/pdf') || lowerPath.endsWith('.pdf');
	const hasType = (needle: string): boolean => Array.from(types).some((type) => type.includes(needle));
	const hasScholarlyTypeSignal = hasType('scholarlyarticle') || hasType('medicalscholarlyarticle');
	const hasNewsTypeSignal = hasType('newsarticle');
	const hasJournalContainerSignal = /\b(journal|transactions|preprint|arxiv|ssrn|biorxiv|medrxiv)\b/.test(
		lowerContainer
	);
	const hasAcademicPathSignal =
		/\/doi\//.test(lowerPath) ||
		/\/abs\/\d{4}\.\d{4,5}(?:v\d+)?/.test(lowerPath) ||
		/\/article\//.test(lowerPath);
	const hasAcademicDomain = hasAcademicDomainSignal(args.domain);

	if (hasType('dataset') || /dataset/.test(lowerCombined)) {
		return { sourceType: 'Dataset', reasoningShort: 'Dataset metadata signal was detected.', confidence: 0.91 };
	}

	if (hasType('thesis') || hasType('dissertation') || /thesis|dissertation/.test(lowerCombined)) {
		return {
			sourceType: 'Theses & Dissertations',
			reasoningShort: 'Thesis or dissertation cues were detected.',
			confidence: 0.9
		};
	}

	if (hasYoutubeDomainSignal(args.domain)) {
		return {
			sourceType: 'YouTube',
			reasoningShort: 'YouTube domain identified from source URL.',
			confidence: 0.95
		};
	}

	if (hasType('podcastepisode') || hasType('audioobject') || /podcast/.test(lowerCombined)) {
		return {
			sourceType: 'Podcast',
			reasoningShort: 'Podcast-specific metadata markers are present.',
			confidence: 0.89
		};
	}

	if (hasSocialDomainSignal(args.domain) || hasType('socialmediaposting') || /social/.test(lowerCombined)) {
		return {
			sourceType: 'Social Media Post',
			reasoningShort: 'Social platform domain or schema signal found.',
			confidence: 0.9
		};
	}

	if (
		hasStandardsOrPatentDomainSignal(args.domain) ||
		hasType('patent') ||
		hasType('legislation') ||
		/standard|patent|iso\b|iec\b|ansi\b|astm\b/.test(lowerCombined)
	) {
		return {
			sourceType: 'Standards & Patents',
			reasoningShort: 'Standards or patent indicators were detected.',
			confidence: 0.9
		};
	}

	if (
		hasType('videoobject') ||
		hasType('movie') ||
		hasType('tvseries') ||
		/film|movie|tv\b|series|video/.test(lowerCombined)
	) {
		return {
			sourceType: 'Film, Movie, or TV',
			reasoningShort: 'Video or film-related metadata appears on page.',
			confidence: 0.82
		};
	}

	if (/conference|proceedings|symposium|workshop/.test(lowerCombined)) {
		return {
			sourceType: 'Conference Papers',
			reasoningShort: 'Conference proceedings markers were identified.',
			confidence: 0.9
		};
	}

	if (
		hasScholarlyTypeSignal ||
		(args.doi && (hasScholarlyTypeSignal || !!args.containerTitle || hasAcademicDomain || hasAcademicPathSignal)) ||
		(hasAcademicDomain && (args.doi || hasJournalContainerSignal || hasAcademicPathSignal)) ||
		(hasJournalContainerSignal && (args.doi || args.authors.length > 0 || !!args.publicationDate))
	) {
		return {
			sourceType: 'Journal Articles',
			reasoningShort: 'Scholarly metadata indicators suggest an academic journal article.',
			confidence: 0.92
		};
	}

	if (/(arxiv\.org|ssrn\.com|biorxiv\.org|medrxiv\.org)/.test(args.domain)) {
		return {
			sourceType: 'Journal Articles',
			reasoningShort: 'Preprint repository mapped to scholarly article type.',
			confidence: 0.88
		};
	}

	if (args.researchGatePublication) {
		return {
			sourceType: 'Journal Articles',
			reasoningShort:
				'ResearchGate publication URL detected; classified as scholarlyCandidate pending Semantic Scholar match.',
			confidence: 0.76
		};
	}

	if (args.isbn || hasType('book')) {
		return { sourceType: 'Books', reasoningShort: 'ISBN or Book schema was detected.', confidence: 0.92 };
	}

	if (hasGovDomain(args.domain)) {
		return {
			sourceType: 'Government Report',
			reasoningShort: 'Government domain matched report/document source.',
			confidence: isPdf || /report|publication|document|brief/.test(lowerCombined) ? 0.9 : 0.84
		};
	}

	if (
		(isPdf || /report|whitepaper|publication|brief|document/.test(lowerCombined)) &&
		(hasOrgDomain(args.domain) || hasEduDomain(args.domain) || args.authors.every((author) => author.corporate))
	) {
		return {
			sourceType: 'Organization Report',
			reasoningShort: 'Institutional report-style indicators were detected.',
			confidence: 0.84
		};
	}

	if (
		(!hasScholarlyTypeSignal && hasNewsTypeSignal) ||
		hasNewsDomainSignal(args.domain) ||
		(/magazine|newspaper|news|editorial/.test(lowerCombined) && !hasAcademicDomain && !args.doi)
	) {
		return {
			sourceType: 'Newspaper & Magazine Articles',
			reasoningShort: 'News or magazine publication cues are present.',
			confidence: 0.86
		};
	}

	if (hasType('blogposting') || /\/blog\//.test(lowerPath) || /blog/.test(args.domain)) {
		return {
			sourceType: 'Blog/Blog Post',
			reasoningShort: 'Blog URL or blog schema indicators detected.',
			confidence: 0.82
		};
	}

	if (args.title || args.siteName) {
		return {
			sourceType: 'Websites & Webpage',
			reasoningShort: 'General webpage metadata available for this source.',
			confidence: 0.68
		};
	}

	return {
		sourceType: 'Websites & Webpage',
		reasoningShort: 'Insufficient evidence for a narrower source category.',
		confidence: 0.45
	};
};

const calculateConfidence = (args: {
	baseConfidence: number;
	title: string;
	authorCount: number;
	publicationDate: string;
	structuredSignals: number;
	fetchFailed: boolean;
}): number => {
	let score = args.baseConfidence;

	if (args.title) {
		score += 0.08;
	}
	if (args.authorCount > 0) {
		score += 0.06;
	}
	if (args.publicationDate) {
		score += 0.06;
	}
	score += Math.min(0.12, args.structuredSignals * 0.02);

	if (args.fetchFailed) {
		score = Math.min(score, 0.6);
	}

	return Math.max(0.2, Math.min(0.99, Math.round(score * 100) / 100));
};

const fetchDocument = async (inputUrl: string): Promise<FetchedDocument> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(inputUrl, {
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
				'user-agent': 'ref-citation-bot/1.0 (+https://example.invalid)'
			}
		});

		const contentType = toTrimmedString(response.headers.get('content-type')).toLowerCase();
		const body = (await response.text()).slice(0, MAX_HTML_BYTES);

		return {
			inputUrl,
			finalUrl: normalizeUrlValue(response.url || inputUrl),
			html: body,
			contentType,
			status: response.status
		};
	} finally {
		clearTimeout(timer);
	}
};

const buildNormalizedMetadata = (args: {
	sourceType: SourceType;
	metaMap: Map<string, string[]>;
	jsonLd: JsonLdExtraction;
	htmlTitle: string;
	inputUrl: string;
	finalUrl: string;
}): NormalizedSourceMetadata => {
	const meta = args.metaMap;
	const jsonLd = args.jsonLd;
	const siteName = firstNonEmpty(
		getMetaFirst(meta, 'og:site_name', 'application-name', 'twitter:site'),
		jsonLd.siteNames[0],
		getDomain(args.finalUrl || args.inputUrl)
	);

	const titleCandidate = firstNonEmpty(
		getMetaFirst(meta, 'citation_title', 'og:title', 'twitter:title', 'dc.title', 'title'),
		jsonLd.titles[0],
		args.htmlTitle
	);
	let title = removeDuplicatedSiteName(titleCandidate, siteName);

	const researchGateInfo = getResearchGatePublicationInfo(args.finalUrl || args.inputUrl);
	const hasTemporaryUnavailableTitle = /researchgate\s*-\s*temporarily unavailable|temporarily unavailable/i.test(
		title
	);
	if (researchGateInfo.isPublication && researchGateInfo.candidateTitle) {
		if (!title || hasTemporaryUnavailableTitle) {
			title = researchGateInfo.candidateTitle;
		}
	}

	const metaAuthors = getMetaAll(
		meta,
		'citation_author',
		'author',
		'article:author',
		'dc.creator',
		'dc.contributor'
	);
	const expandedMetaAuthors = metaAuthors.flatMap((name) => splitPotentialAuthorList(name));
	const jsonLdAuthors = jsonLd.authors.map((item) => normalizeAuthor(item.name, item.corporate)).filter(Boolean) as NormalizedSourceAuthor[];
	const normalizedMetaAuthors = expandedMetaAuthors
		.map((name) => normalizeAuthor(name))
		.filter((author): author is NormalizedSourceAuthor => author !== null);

	const authors = dedupeAuthors(
		[...normalizedMetaAuthors, ...jsonLdAuthors].filter(
			(author) => !shouldDropAuthor(author, siteName, args.finalUrl || args.inputUrl)
		)
	);

	const publicationDate = toIsoDate(
		firstNonEmpty(
			getMetaFirst(
				meta,
				'citation_publication_date',
				'article:published_time',
				'og:published_time',
				'dc.date',
				'publish_date',
				'date'
			),
			jsonLd.publicationDates[0]
		)
	);

	const updatedDate = toIsoDate(
		firstNonEmpty(
			getMetaFirst(meta, 'article:modified_time', 'og:updated_time', 'last-modified', 'modified_time'),
			jsonLd.updatedDates[0]
		)
	);

	const bestDate = publicationDate || updatedDate;
	const dateParts = toDateParts(bestDate);

	const doi = firstNonEmpty(
		getMetaFirst(meta, 'citation_doi', 'dc.identifier', 'doi'),
		jsonLd.dois[0],
		title.match(DOI_PATTERN)?.[0] ?? '',
		getMetaFirst(meta, 'description').match(DOI_PATTERN)?.[0] ?? ''
	);

	const isbn = firstNonEmpty(
		getMetaFirst(meta, 'citation_isbn', 'isbn'),
		jsonLd.isbns[0],
		title.match(ISBN_PATTERN)?.[0] ?? ''
	);

	const issn = firstNonEmpty(
		getMetaFirst(meta, 'citation_issn', 'issn'),
		jsonLd.issns[0],
		title.match(ISSN_PATTERN)?.[0] ?? ''
	);

	return {
		sourceType: args.sourceType,
		title,
		subtitle: firstNonEmpty(getMetaFirst(meta, 'subtitle'), ''),
		authors,
		containerTitle: firstNonEmpty(
			getMetaFirst(meta, 'citation_journal_title', 'citation_conference_title', 'article:section'),
			jsonLd.containerTitles[0]
		),
		siteName,
		publisher: firstNonEmpty(getMetaFirst(meta, 'publisher', 'citation_publisher'), jsonLd.publisherNames[0]),
		organization: firstNonEmpty(getMetaFirst(meta, 'organization', 'dc.publisher'), jsonLd.organizationNames[0]),
		publicationDate,
		updatedDate,
		accessDate: new Date().toISOString().slice(0, 10),
		year: dateParts.year,
		month: dateParts.month,
		day: dateParts.day,
		volume: firstNonEmpty(getMetaFirst(meta, 'citation_volume', 'volume'), jsonLd.volumes[0]),
		issue: firstNonEmpty(getMetaFirst(meta, 'citation_issue', 'issue'), jsonLd.issues[0]),
		pages: firstNonEmpty(
			getMetaFirst(meta, 'citation_firstpage', 'citation_lastpage', 'pages', 'page'),
			jsonLd.pages[0]
		),
		edition: getMetaFirst(meta, 'citation_edition', 'edition'),
		doi: doi.toLowerCase().startsWith('http') ? doi : doi.replace(/^doi:\s*/i, ''),
		isbn: isbn.replace(/\s+/g, ''),
		issn: issn.toUpperCase(),
		url: normalizeUrlValue(args.finalUrl || args.inputUrl),
		canonicalUrl: normalizeUrlValue(
			firstNonEmpty(getMetaFirst(meta, 'og:url', 'twitter:url'), args.finalUrl || args.inputUrl)
		),
		language: firstNonEmpty(getMetaFirst(meta, 'og:locale', 'language', 'dc.language')),
		description: firstNonEmpty(getMetaFirst(meta, 'description', 'og:description'), jsonLd.descriptions[0]),
		confidence: 0
	};
};

const mapWithConcurrency = async <T, TResult>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> => {
	if (items.length === 0) {
		return [];
	}

	const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TResult>(items.length);
	let cursor = 0;

	await Promise.all(
		Array.from({ length: safeConcurrency }, async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await mapper(items[index], index);
			}
		})
	);

	return results;
};

const fallbackContextFromPlainText = (sourceText: string): CitationSourceContext => {
	const normalizedText = compactWhitespace(sourceText);
	const missingFields = ['author', 'publicationDate'];

	return {
		sourceText: normalizedText,
		sourceName: normalizedText,
		sourceType: 'Websites & Webpage',
		confidence: 0.38,
		reasoningShort: 'No URL metadata was available for extraction.',
		missingFields,
		warnings: ['No URL was found in source text. Metadata could not be fetched automatically.'],
		metadata: {
			sourceType: 'Websites & Webpage',
			title: normalizedText,
			subtitle: '',
			authors: [],
			containerTitle: '',
			siteName: '',
			publisher: '',
			organization: '',
			publicationDate: '',
			updatedDate: '',
			accessDate: '',
			year: '',
			month: '',
			day: '',
			volume: '',
			issue: '',
			pages: '',
			edition: '',
			doi: '',
			isbn: '',
			issn: '',
			url: '',
			canonicalUrl: '',
			language: '',
			description: '',
			confidence: 0.38
		}
	};
};

const extractContextForSourceLine = async (sourceLine: string): Promise<CitationSourceContext> => {
	const sourceText = compactWhitespace(sourceLine);
	const sourceUrl = extractUrlFromSourceLine(sourceText);

	if (!sourceUrl) {
		return fallbackContextFromPlainText(sourceText);
	}

	const warnings: string[] = [];
	let fetched: FetchedDocument | null = null;
	let fetchFailed = false;

	try {
		fetched = await fetchDocument(sourceUrl);
		if (fetched.status >= 400) {
			warnings.push(`Fetched URL returned HTTP ${fetched.status}.`);
		}
	} catch (error) {
		fetchFailed = true;
		warnings.push(
			error instanceof Error
				? `Failed to fetch URL metadata: ${error.message}`
				: 'Failed to fetch URL metadata.'
		);
	}

	const html = fetched?.html ?? '';
	const metaMap = collectMetaMap(html);
	const jsonLd = collectJsonLd(html);
	const canonicalFromLink = collectCanonicalUrl(html);
	const htmlTitle = collectTitle(html);
	const researchGateInfo = getResearchGatePublicationInfo(fetched?.finalUrl || sourceUrl);

	if (researchGateInfo.isPublication) {
		warnings.push(
			'ResearchGate publication URL detected; marked as scholarlyCandidate for Semantic Scholar title reconciliation.'
		);
		if (researchGateInfo.candidateTitle) {
			warnings.push('Recovered candidate publication title from ResearchGate URL slug.');
		}
	}

	const preliminarySourceType = detectSourceType({
		domain: getDomain(fetched?.finalUrl || sourceUrl),
		pathname: getPathname(fetched?.finalUrl || sourceUrl),
		contentType: fetched?.contentType ?? '',
		jsonLdTypes: jsonLd.types,
		researchGatePublication: researchGateInfo.isPublication,
		doi: firstNonEmpty(getMetaFirst(metaMap, 'citation_doi', 'doi'), jsonLd.dois[0]),
		isbn: firstNonEmpty(getMetaFirst(metaMap, 'citation_isbn', 'isbn'), jsonLd.isbns[0]),
		containerTitle: firstNonEmpty(
			getMetaFirst(metaMap, 'citation_journal_title', 'citation_conference_title', 'article:section'),
			jsonLd.containerTitles[0]
		),
		publicationDate: firstNonEmpty(
			getMetaFirst(metaMap, 'citation_publication_date', 'article:published_time', 'dc.date'),
			jsonLd.publicationDates[0]
		),
		title: firstNonEmpty(getMetaFirst(metaMap, 'citation_title', 'og:title'), jsonLd.titles[0], htmlTitle),
		authors: jsonLd.authors
			.map((author) => normalizeAuthor(author.name, author.corporate))
			.filter((author): author is NormalizedSourceAuthor => author !== null),
		siteName: firstNonEmpty(getMetaFirst(metaMap, 'og:site_name'), jsonLd.siteNames[0])
	});
	const resolvedSourceType = normalizeSourceTypeLabel(preliminarySourceType.sourceType);

	const metadata = buildNormalizedMetadata({
		sourceType: resolvedSourceType,
		metaMap,
		jsonLd,
		htmlTitle,
		inputUrl: sourceUrl,
		finalUrl: fetched?.finalUrl || sourceUrl
	});

	metadata.canonicalUrl = normalizeUrlValue(
		firstNonEmpty(canonicalFromLink, getMetaFirst(metaMap, 'og:url', 'twitter:url'), metadata.url)
	);

	const structuredSignals =
		(metaMap.size > 0 ? 2 : 0) +
		(jsonLd.types.size > 0 ? 2 : 0) +
		(metadata.authors.length > 0 ? 1 : 0) +
		(metadata.publicationDate ? 1 : 0) +
		(metadata.doi || metadata.isbn ? 1 : 0);

	metadata.confidence = calculateConfidence({
		baseConfidence: preliminarySourceType.confidence,
		title: metadata.title,
		authorCount: metadata.authors.length,
		publicationDate: metadata.publicationDate,
		structuredSignals,
		fetchFailed
	});

	const sourceName = firstNonEmpty(metadata.title, metadata.siteName, sourceText);
	const missingFields = ['title', 'author', 'publicationDate']
		.filter((field) => {
			if (field === 'title') {
				return !metadata.title;
			}
			if (field === 'author') {
				return metadata.authors.length === 0;
			}
			return !metadata.publicationDate;
		});

	if (!metadata.title) {
		warnings.push('Page title could not be confidently extracted from metadata.');
	}

	return {
		sourceText,
		sourceName,
		sourceType: resolvedSourceType,
		confidence: metadata.confidence,
		reasoningShort: preliminarySourceType.reasoningShort,
		missingFields,
		warnings,
		metadata
	};
};

export const buildSourceContexts = async (sourceLines: string[]): Promise<CitationSourceContext[]> => {
	const normalizedSourceLines = sourceLines.map((line) => compactWhitespace(line)).filter(Boolean);
	if (normalizedSourceLines.length === 0) {
		return [];
	}

	return mapWithConcurrency(normalizedSourceLines, 4, async (sourceLine) => extractContextForSourceLine(sourceLine));
};
