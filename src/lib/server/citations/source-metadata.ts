import { env } from '$env/dynamic/private';
import { mapWithConcurrency } from './async-utils';
import { resolveBookFromUrl } from './bookResolver';
import { detectSourceType } from './source-type-detection';
import {
	SOURCE_TYPE_VALUES,
	isReportOrDatasetSourceType,
	normalizeSourceTypeLabel,
	type SourceType
} from './source-types';

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
const HEADING_TAG_PATTERN = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const STRIP_TAG_PATTERN = /<[^>]+>/g;
const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const DOI_PATTERN = /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+\b/i;
const ISBN_PATTERN = /\b(?:97[89][\-\s]?)?[0-9][0-9\-\s]{8,20}[0-9X]\b/i;
const ISSN_PATTERN = /\b\d{4}-\d{3}[\dX]\b/i;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 1_800_000;

export { SOURCE_TYPE_VALUES, normalizeSourceTypeLabel };
export type { SourceType };

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

export type ResearchGatePublicationInfo = {
	isPublication: boolean;
	candidateTitle: string;
	normalizedUrl: string;
};

const toTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

const collectStrongestHeading = (html: string): string => {
	const candidates: Array<{ text: string; score: number; index: number }> = [];
	let index = 0;

	for (const match of html.matchAll(HEADING_TAG_PATTERN)) {
		const level = Number(match[1] ?? 3);
		const rawHeading = match[2] ?? '';
		const text = compactWhitespace(decodeHtmlEntities(rawHeading.replace(STRIP_TAG_PATTERN, ' ')));
		if (!text) {
			continue;
		}

		const wordCount = text.split(/\s+/).filter(Boolean).length;
		if (wordCount < 2) {
			continue;
		}

		const reportKeywordBoost =
			/\b(report|market|industry|forecast|size|share|growth|opportunit(?:y|ies)|trend|dataset|statistics|white\s*paper|annual report)\b/i.test(
				text
			)
				? 8
				: 0;
		const levelScore = Math.max(0, 4 - Math.min(3, level)) * 10;
		const lengthScore = Math.min(14, wordCount);

		candidates.push({
			text,
			score: levelScore + lengthScore + reportKeywordBoost,
			index
		});

		index += 1;
	}

	if (candidates.length === 0) {
		return '';
	}

	candidates.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.index - right.index;
	});

	return candidates[0].text;
};

const extractTitleFromUrlPath = (urlValue: string): string => {
	try {
		const parsed = new URL(urlValue);
		const segments = parsed.pathname.split('/').filter(Boolean);
		const candidate = segments.at(-1) ?? '';
		if (!candidate) {
			return '';
		}

		const decoded = decodeURIComponent(candidate.replace(/\.[a-z0-9]{2,6}$/i, ''));
		return compactWhitespace(
			decodeHtmlEntities(decoded)
				.replace(/[\-_+]+/g, ' ')
				.replace(/\b(pdf|html?|aspx?)\b/gi, ' ')
		);
	} catch {
		return '';
	}
};

const normalizeForTitleComparison = (value: string): string =>
	compactWhitespace(decodeHtmlEntities(value))
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const isWeakOrGenericTitle = (title: string, siteName: string): boolean => {
	const normalizedTitle = normalizeForTitleComparison(title);
	if (!normalizedTitle) {
		return true;
	}

	const normalizedSiteName = normalizeForTitleComparison(siteName);
	if (normalizedSiteName && normalizedTitle === normalizedSiteName) {
		return true;
	}

	if (
		/^(home|homepage|index|welcome|overview|research|reports?|market research|untitled|page not found|forbidden|error)$/.test(
			normalizedTitle
		)
	) {
		return true;
	}

	const wordCount = normalizedTitle.split(/\s+/).filter(Boolean).length;
	const hasStrongKeyword =
		/\b(report|dataset|statistics|analysis|forecast|market|industry|white paper|whitepaper|annual report)\b/.test(
			normalizedTitle
		);

	return wordCount <= 2 && !hasStrongKeyword;
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
	strongestHeading: string;
	contentType: string;
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

	const structuredTitle = firstNonEmpty(
		getMetaFirst(meta, 'citation_title', 'og:title', 'twitter:title', 'dc.title', 'title'),
		jsonLd.titles[0]
	);
	const htmlTitle = compactWhitespace(args.htmlTitle);
	const urlDerivedTitle = extractTitleFromUrlPath(args.finalUrl || args.inputUrl);
	const headingTitle = compactWhitespace(args.strongestHeading);
	const preferHtmlTitleForReportDataset =
		isReportOrDatasetSourceType(args.sourceType) && !!htmlTitle;
	const shouldPreferHeadingTitle =
		!!headingTitle &&
		(!structuredTitle || isWeakOrGenericTitle(structuredTitle, siteName)) &&
		/\b(report|market|industry|forecast|size|share|growth|opportunit(?:y|ies)|trend|dataset|statistics|white\s*paper|annual report)\b/i.test(
			headingTitle
		);

	const titleCandidate = preferHtmlTitleForReportDataset
		? firstNonEmpty(htmlTitle, headingTitle, structuredTitle, urlDerivedTitle)
		: shouldPreferHeadingTitle
			? firstNonEmpty(headingTitle, structuredTitle, htmlTitle, urlDerivedTitle)
			: firstNonEmpty(structuredTitle, htmlTitle, urlDerivedTitle, headingTitle);
	let title = removeDuplicatedSiteName(titleCandidate, siteName);

	if (!title && args.contentType.includes('application/pdf')) {
		title = urlDerivedTitle;
	}

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

	const citationFirstPage = firstNonEmpty(getMetaFirst(meta, 'citation_firstpage'));
	const citationLastPage = firstNonEmpty(getMetaFirst(meta, 'citation_lastpage'));
	const citationPageRange =
		citationFirstPage && citationLastPage
			? citationFirstPage === citationLastPage
				? citationFirstPage
				: `${citationFirstPage}-${citationLastPage}`
			: firstNonEmpty(citationFirstPage, citationLastPage);

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
			citationPageRange,
			getMetaFirst(meta, 'pages', 'page'),
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
	const finalUrlValue = fetched?.finalUrl || sourceUrl;
	const metaMap = collectMetaMap(html);
	const jsonLd = collectJsonLd(html);
	const canonicalFromLink = collectCanonicalUrl(html);
	const htmlTitle = collectTitle(html);
	const strongestHeading = collectStrongestHeading(html);
	const researchGateInfo = getResearchGatePublicationInfo(finalUrlValue);
	const descriptionSignal = firstNonEmpty(
		getMetaFirst(metaMap, 'description', 'og:description', 'twitter:description'),
		jsonLd.descriptions[0]
	);
	const titleSignal = firstNonEmpty(
		getMetaFirst(metaMap, 'citation_title', 'og:title', 'twitter:title', 'dc.title', 'title'),
		jsonLd.titles[0],
		htmlTitle,
		strongestHeading
	);
	const metadataSignalCount =
		(metaMap.size > 0 ? 1 : 0) +
		(jsonLd.types.size > 0 ? 1 : 0) +
		(titleSignal ? 1 : 0) +
		(firstNonEmpty(getMetaFirst(metaMap, 'citation_doi', 'doi'), jsonLd.dois[0]) ? 1 : 0) +
		((fetched?.contentType ?? '').includes('application/pdf') ? 1 : 0);

	if (researchGateInfo.isPublication) {
		warnings.push(
			'ResearchGate publication URL detected; marked as scholarlyCandidate for Semantic Scholar title reconciliation.'
		);
		if (researchGateInfo.candidateTitle) {
			warnings.push('Recovered candidate publication title from ResearchGate URL slug.');
		}
	}

	const preliminarySourceType = detectSourceType({
		domain: getDomain(finalUrlValue),
		pathname: getPathname(finalUrlValue),
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
		title: firstNonEmpty(
			getMetaFirst(metaMap, 'citation_title', 'og:title', 'twitter:title', 'dc.title'),
			jsonLd.titles[0],
			htmlTitle,
			strongestHeading
		),
		description: descriptionSignal,
		headingTitle: strongestHeading,
		metadataSignalCount,
		authors: jsonLd.authors
			.map((author) => normalizeAuthor(author.name, author.corporate))
			.filter((author): author is NormalizedSourceAuthor => author !== null),
		siteName: firstNonEmpty(getMetaFirst(metaMap, 'og:site_name'), jsonLd.siteNames[0])
	});
	let resolvedSourceType = normalizeSourceTypeLabel(preliminarySourceType.sourceType);
	let reasoningShort = preliminarySourceType.reasoningShort;

	const hasBookSignalFromMetadata =
		Boolean(firstNonEmpty(getMetaFirst(metaMap, 'citation_isbn', 'isbn', 'book:isbn'), jsonLd.isbns[0])) ||
		Array.from(jsonLd.types).some((type) => type.includes('book')) ||
		/\b(book|edition|isbn|hardcover|paperback)\b/i.test(
			`${titleSignal} ${descriptionSignal} ${getPathname(finalUrlValue)}`
		) ||
		/(books\.google\.|openlibrary|goodreads|amazon\.)/i.test(getDomain(finalUrlValue));

	let bookResolution: Awaited<ReturnType<typeof resolveBookFromUrl>> | null = null;
	if (resolvedSourceType !== 'Journal Articles' && hasBookSignalFromMetadata) {
		bookResolution = await resolveBookFromUrl(finalUrlValue, {
			fetchImpl: fetch,
			timeoutMs: FETCH_TIMEOUT_MS,
			googleApiKey: toTrimmedString(env.GOOGLE_BOOKS_API_KEY),
			fallbackToOpenLibrary: true,
			pageHtml: html || undefined,
			finalUrl: finalUrlValue
		});

		warnings.push(...bookResolution.warnings);

		if (bookResolution.found && bookResolution.sourceType === 'book') {
			resolvedSourceType = 'Books';
			reasoningShort = `Book metadata resolved via ${bookResolution.provider} (${bookResolution.method}).`;
		}
	}

	const metadata = buildNormalizedMetadata({
		sourceType: resolvedSourceType,
		metaMap,
		jsonLd,
		htmlTitle,
		strongestHeading,
		contentType: fetched?.contentType ?? '',
		inputUrl: sourceUrl,
		finalUrl: finalUrlValue
	});

	metadata.canonicalUrl = normalizeUrlValue(
		firstNonEmpty(canonicalFromLink, getMetaFirst(metaMap, 'og:url', 'twitter:url'), metadata.url)
	);

	if (bookResolution?.found && bookResolution.sourceType === 'book') {
		const resolvedPublicationDate = toIsoDate(bookResolution.metadata.publishedDate);
		const resolvedYear = resolvedPublicationDate.slice(0, 4);
		const resolvedAuthors = bookResolution.metadata.authors
			.map((author) => normalizeAuthor(author.full, false))
			.filter((author): author is NormalizedSourceAuthor => author !== null);

		metadata.sourceType = 'Books';
		metadata.title = firstNonEmpty(bookResolution.metadata.title, metadata.title);
		metadata.subtitle = firstNonEmpty(bookResolution.metadata.subtitle, metadata.subtitle);
		metadata.authors = resolvedAuthors.length > 0 ? resolvedAuthors : metadata.authors;
		metadata.publisher = firstNonEmpty(bookResolution.metadata.publisher, metadata.publisher);
		metadata.publicationDate = firstNonEmpty(resolvedPublicationDate, metadata.publicationDate);
		metadata.year = firstNonEmpty(resolvedYear, metadata.year);
		metadata.isbn = firstNonEmpty(
			bookResolution.metadata.isbn13,
			bookResolution.metadata.isbn10,
			metadata.isbn
		);
		metadata.canonicalUrl = normalizeUrlValue(
			firstNonEmpty(bookResolution.metadata.canonicalBookUrl, metadata.canonicalUrl, metadata.url)
		);

		warnings.push(
			`Book resolver selected ${bookResolution.provider} via ${bookResolution.method} with confidence ${bookResolution.confidence.toFixed(2)}.`
		);
	}

	const structuredSignals =
		(metaMap.size > 0 ? 2 : 0) +
		(jsonLd.types.size > 0 ? 2 : 0) +
		(metadata.authors.length > 0 ? 1 : 0) +
		(metadata.publicationDate ? 1 : 0) +
		(metadata.doi || metadata.isbn ? 1 : 0);

	const baseConfidence =
		bookResolution?.found && bookResolution.sourceType === 'book'
			? Math.max(preliminarySourceType.confidence, bookResolution.confidence)
			: preliminarySourceType.confidence;

	metadata.confidence = calculateConfidence({
		baseConfidence,
		title: metadata.title,
		authorCount: metadata.authors.length,
		publicationDate: metadata.publicationDate,
		structuredSignals,
		fetchFailed
	});

	if (bookResolution?.found && bookResolution.sourceType === 'book') {
		metadata.confidence = Math.max(metadata.confidence, Math.min(0.99, bookResolution.confidence));
	}

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
		reasoningShort,
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
