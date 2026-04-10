import { env } from '$env/dynamic/private';
import {
	getResearchGatePublicationInfo,
	normalizeSourceTypeLabel,
	type CitationSourceContext,
	type SourceType
} from './source-metadata';

const SEMANTIC_SCHOLAR_BASE_URL = 'https://api.semanticscholar.org/graph/v1';
const SEMANTIC_SCHOLAR_TIMEOUT_MS = 8_000;
const SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS = 1_000;
const SEMANTIC_SCHOLAR_MAX_RETRIES = 3;
const DOI_PATTERN = /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+\b/i;
const YEAR_PATTERN = /\b(19|20)\d{2}\b/;

const PAPER_FIELDS = [
	'title',
	'authors',
	'year',
	'venue',
	'journal',
	'publicationDate',
	'publicationTypes',
	'externalIds',
	'url',
	'openAccessPdf'
].join(',');

export type SemanticScholarCitation = {
	sourceText: string;
	sourceName: string;
	sourceType: SourceType;
	confidence: number;
	missingFields: string[];
	warnings: string[];
	plainExplanation: string;
	inTextCitation: string;
	referenceCitation: string;
};

export type SemanticScholarRetryEvent = {
	attempt: number;
	maxRetries: number;
	countdownSeconds: number;
	reason: string;
	url: string;
};

type SemanticScholarAuthor = {
	name?: string;
};

type SemanticScholarJournal = {
	name?: string;
	volume?: string;
	pages?: string;
};

type SemanticScholarOpenAccessPdf = {
	url?: string;
};

type SemanticScholarPaper = {
	paperId?: string;
	title?: string;
	authors?: SemanticScholarAuthor[];
	year?: number;
	venue?: string;
	journal?: SemanticScholarJournal;
	publicationDate?: string;
	publicationTypes?: string[];
	externalIds?: Record<string, string | number | null>;
	url?: string;
	openAccessPdf?: SemanticScholarOpenAccessPdf;
};

type SemanticScholarSearchResponse = {
	data?: SemanticScholarPaper[];
};

type CitationStyle = 'APA' | 'MLA' | 'Chicago' | 'IEEE' | 'RMIT Harvard';

type MatchCandidate = {
	paper: SemanticScholarPaper;
	score: number;
	matchedBy: 'doi' | 'url' | 'title';
};

type ParsedAuthor = {
	given: string;
	family: string;
	full: string;
};

const toTrimmedString = (value: unknown): string =>
	typeof value === 'string' ? value.trim() : '';

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const toSentenceCase = (value: string): string => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return normalized;
	}

	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const toRmitSentenceCase = (value: string): string => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return normalized;
	}

	let wordIndex = 0;
	return normalized.replace(/[A-Za-z][A-Za-z0-9-]*/g, (word) => {
		const isFirstWord = wordIndex === 0;
		wordIndex += 1;

		const hasDigit = /\d/.test(word);
		const isAcronym = /^[A-Z]{2,}$/.test(word);
		const hasInnerUppercase = /[A-Z]/.test(word.slice(1)) && /[a-z]/.test(word);
		if (hasDigit || isAcronym || hasInnerUppercase) {
			return word;
		}

		if (isFirstWord) {
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		}

		return word.toLowerCase();
	});
};

const formatDateForHarvard = (date: Date): string => {
	const day = String(date.getDate()).padStart(2, '0');
	const month = date.toLocaleString('en-AU', { month: 'long' });
	const year = date.getFullYear();
	return `${day} ${month} ${year}`;
};

const parseAuthorName = (name: string): ParsedAuthor => {
	const normalized = compactWhitespace(name);
	if (!normalized) {
		return { given: '', family: '', full: '' };
	}

	if (normalized.includes(',')) {
		const [familyPart, ...givenParts] = normalized.split(',');
		return {
			given: compactWhitespace(givenParts.join(' ')),
			family: compactWhitespace(familyPart),
			full: normalized
		};
	}

	const parts = normalized.split(' ').filter(Boolean);
	if (parts.length === 1) {
		return {
			given: '',
			family: parts[0],
			full: normalized
		};
	}

	return {
		given: parts.slice(0, -1).join(' '),
		family: parts.at(-1) ?? '',
		full: normalized
	};
};

const parseAuthors = (authors: SemanticScholarAuthor[] | undefined): ParsedAuthor[] => {
	if (!Array.isArray(authors)) {
		return [];
	}

	return authors
		.map((author) => parseAuthorName(toTrimmedString(author.name)))
		.filter((author) => author.full);
};

const toInitials = (givenName: string): string => {
	const tokens = compactWhitespace(givenName)
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) {
		return '';
	}

	return tokens
		.map((token) => `${token.charAt(0).toUpperCase()}.`)
		.join(' ')
		.trim();
};

const toInitialsWithoutDots = (givenName: string): string =>
	toInitials(givenName).replaceAll('.', '').trim();

const formatAuthorRmitHarvard = (author: ParsedAuthor): string => {
	if (!author.family && !author.given) {
		return author.full;
	}

	const initials = toInitialsWithoutDots(author.given);
	if (!author.family) {
		return initials || author.full;
	}

	return initials ? `${author.family}, ${initials}` : author.family;
};

const formatAuthorRmitHarvardJournal = (author: ParsedAuthor): string => {
	if (!author.family && !author.given) {
		return author.full;
	}

	const initials = toInitialsWithoutDots(author.given);
	if (!author.family) {
		return initials || author.full;
	}

	return initials ? `${author.family} ${initials}` : author.family;
};

const joinRmitAuthors = (authors: ParsedAuthor[]): string => {
	const names = authors.map(formatAuthorRmitHarvard).filter(Boolean);
	if (names.length === 0) {
		return '';
	}
	if (names.length === 1) {
		return names[0];
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}

	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

const joinRmitJournalAuthors = (authors: ParsedAuthor[]): string => {
	const names = authors.map(formatAuthorRmitHarvardJournal).filter(Boolean);
	if (names.length === 0) {
		return '';
	}
	if (names.length === 1) {
		return names[0];
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}

	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

const formatAuthorAPA = (author: ParsedAuthor): string => {
	if (!author.family && !author.given) {
		return author.full;
	}

	const initials = toInitials(author.given);
	if (!author.family) {
		return initials || author.full;
	}

	return initials ? `${author.family}, ${initials}` : author.family;
};

const formatAuthorIEEE = (author: ParsedAuthor): string => {
	const initials = toInitials(author.given);
	if (author.family && initials) {
		return `${initials} ${author.family}`;
	}
	if (author.family) {
		return author.family;
	}
	return author.full;
};

const formatAuthorLastFirst = (author: ParsedAuthor): string => {
	if (author.family && author.given) {
		return `${author.family}, ${author.given}`;
	}
	return author.full;
};

const formatAuthorFirstLast = (author: ParsedAuthor): string => {
	if (author.family && author.given) {
		return `${author.given} ${author.family}`;
	}
	return author.full;
};

const joinWithAnd = (items: string[]): string => {
	if (items.length === 0) {
		return '';
	}
	if (items.length === 1) {
		return items[0];
	}
	if (items.length === 2) {
		return `${items[0]} & ${items[1]}`;
	}

	return `${items.slice(0, -1).join(', ')}, & ${items.at(-1)}`;
};

const joinWithAndWord = (items: string[]): string => {
	if (items.length === 0) {
		return '';
	}
	if (items.length === 1) {
		return items[0];
	}
	if (items.length === 2) {
		return `${items[0]} and ${items[1]}`;
	}

	return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const stripTrailingPeriod = (value: string): string => value.replace(/[.\s]+$/g, '').trim();

const italicizeMarkdown = (value: string): string => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return '';
	}

	if (/^\*.*\*$/.test(normalized)) {
		return normalized;
	}

	return `*${normalized}*`;
};

const normalizeDoi = (value: string): string => {
	const normalized = compactWhitespace(value).replace(/^doi:\s*/i, '');
	if (!normalized) {
		return '';
	}

	if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
		const match = normalized.match(DOI_PATTERN);
		return match?.[0] ?? normalized;
	}

	return normalized;
};

const getDomain = (value: string): string => {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return '';
	}
};

const isLikelyScholarlySource = (context: CitationSourceContext): boolean => {
	const doi = extractDoiFromContext(context);
	if (doi) {
		return true;
	}

	if (
		context.sourceType === 'Journal Articles' ||
		context.sourceType === 'Conference Papers' ||
		context.sourceType === 'Theses & Dissertations' ||
		context.sourceType === 'Dataset' ||
		context.sourceType === 'Books'
	) {
		return true;
	}

	const combined = `${context.sourceText} ${context.metadata.title} ${context.metadata.containerTitle}`.toLowerCase();
	if (/(arxiv|doi|journal|conference|proceedings|thesis|dissertation|dataset|preprint)/.test(combined)) {
		return true;
	}

	const domain = getDomain(context.metadata.canonicalUrl || context.metadata.url);
	return /arxiv\.org|acm\.org|ieeexplore\.ieee\.org|nature\.com|sciencedirect\.com|springer\.com|wiley\.com|tandfonline\.com|link\.springer\.com|jstor\.org|openreview\.net|ssrn\.com|biorxiv\.org|medrxiv\.org/.test(
		domain
	);
};

const getPaperDoi = (paper: SemanticScholarPaper): string => {
	const fromExternal = normalizeDoi(String(paper.externalIds?.DOI ?? ''));
	if (fromExternal) {
		return fromExternal;
	}

	const url = toTrimmedString(paper.url);
	const urlDoi = normalizeDoi(url.match(DOI_PATTERN)?.[0] ?? '');
	return urlDoi;
};

const extractDoiFromContext = (context: CitationSourceContext): string => {
	const fromMetadata = normalizeDoi(context.metadata.doi);
	if (fromMetadata) {
		return fromMetadata;
	}

	const researchGateInfo = getResearchGatePublicationInfo(
		context.metadata.canonicalUrl || context.metadata.url
	);
	if (researchGateInfo.isPublication) {
		return '';
	}

	const match = context.sourceText.match(DOI_PATTERN)?.[0] ?? '';
	return normalizeDoi(match);
};

const addWarningOnce = (context: CitationSourceContext, warning: string): void => {
	if (context.warnings.some((item) => item.toLowerCase() === warning.toLowerCase())) {
		return;
	}

	context.warnings.push(warning);
};

const toYearString = (paper: SemanticScholarPaper): string => {
	if (typeof paper.year === 'number' && Number.isFinite(paper.year)) {
		return String(paper.year);
	}

	const publicationDate = toTrimmedString(paper.publicationDate);
	if (publicationDate) {
		const match = publicationDate.match(YEAR_PATTERN)?.[0] ?? '';
		if (match) {
			return match;
		}
	}

	return 'n.d.';
};

const hasValue = (value: string): boolean => compactWhitespace(value).length > 0;

const toArxivAbsUrl = (link: string, doi: string): string => {
	const normalizedLink = compactWhitespace(link);
	const normalizedDoi = compactWhitespace(doi);

	const directLinkMatch = normalizedLink.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
	if (directLinkMatch) {
		return `https://arxiv.org/abs/${directLinkMatch[1]}`;
	}

	const doiArxivMatch = normalizedDoi.match(/arxiv[.:/]?(\d{4}\.\d{4,5}(?:v\d+)?)/i);
	if (doiArxivMatch) {
		return `https://arxiv.org/abs/${doiArxivMatch[1]}`;
	}

	const linkArxivMatch = normalizedLink.match(/arxiv[.:/]?(\d{4}\.\d{4,5}(?:v\d+)?)/i);
	if (linkArxivMatch) {
		return `https://arxiv.org/abs/${linkArxivMatch[1]}`;
	}

	return normalizedLink;
};

const toUrlOrDoi = (paper: SemanticScholarPaper, fallbackUrl: string): string => {
	const doi = getPaperDoi(paper);
	if (doi) {
		return `https://doi.org/${doi}`;
	}

	const paperUrl = compactWhitespace(toTrimmedString(paper.url));
	if (paperUrl) {
		return paperUrl;
	}

	const oaPdf = compactWhitespace(toTrimmedString(paper.openAccessPdf?.url));
	if (oaPdf) {
		return oaPdf;
	}

	return compactWhitespace(fallbackUrl);
};

const mapPaperSourceType = (paper: SemanticScholarPaper): SourceType => {
	const publicationTypes = (paper.publicationTypes ?? []).map((value) =>
		compactWhitespace(value).toLowerCase().replace(/[\s_-]+/g, '')
	);
	const publicationHint = `${publicationTypes.join(' ')} ${toTrimmedString(paper.venue)} ${toTrimmedString(
		paper.journal?.name
	)}`.toLowerCase();

	if (publicationTypes.some((value) => value.includes('dataset'))) {
		return 'Dataset';
	}
	if (publicationTypes.some((value) => value.includes('conference'))) {
		return 'Conference Papers';
	}
	if (publicationTypes.some((value) => value.includes('book'))) {
		return 'Books';
	}
	if (/thesis|dissertation/.test(publicationHint)) {
		return 'Theses & Dissertations';
	}
	if (publicationTypes.some((value) => value.includes('journal'))) {
		return 'Journal Articles';
	}

	return normalizeSourceTypeLabel('Journal Articles');
};

const tokenize = (value: string): string[] =>
	compactWhitespace(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((token) => token.length > 2);

const titleSimilarityScore = (left: string, right: string): number => {
	const a = new Set(tokenize(left));
	const b = new Set(tokenize(right));
	if (a.size === 0 || b.size === 0) {
		return 0;
	}

	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) {
			intersection += 1;
		}
	}

	return intersection / Math.max(a.size, b.size);
};

const getStyle = (value: string): CitationStyle => {
	if (value === 'MLA' || value === 'Chicago' || value === 'IEEE' || value === 'RMIT Harvard') {
		return value;
	}
	return 'APA';
};

const buildHeaders = (): Record<string, string> => {
	const key = toTrimmedString(
		env.SEMANTIC_SCHOLAR_API_KEY || env.SEMANTICSCHOLAR_API_KEY || env.S2_API_KEY
	);
	if (!key) {
		return {
			accept: 'application/json'
		};
	}

	return {
		accept: 'application/json',
		'x-api-key': key
	};
};

const wait = async (milliseconds: number): Promise<void> => {
	if (milliseconds <= 0) {
		return;
	}

	await new Promise<void>((resolve) => {
		setTimeout(resolve, milliseconds);
	});
};

const fetchSemanticScholar = async <T>(
	url: string,
	onRetry?: (event: SemanticScholarRetryEvent) => void
): Promise<T | null> => {
	for (let attempt = 1; attempt <= SEMANTIC_SCHOLAR_MAX_RETRIES; attempt += 1) {
		await wait(SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), SEMANTIC_SCHOLAR_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: buildHeaders(),
				signal: controller.signal
			});

			if (response.ok) {
				return (await response.json()) as T;
			}

			if (response.status === 404) {
				return null;
			}

			const shouldRetry = response.status === 429 || response.status >= 500;
			if (!shouldRetry || attempt >= SEMANTIC_SCHOLAR_MAX_RETRIES) {
				return null;
			}

			onRetry?.({
				attempt,
				maxRetries: SEMANTIC_SCHOLAR_MAX_RETRIES,
				countdownSeconds: Math.ceil(SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS / 1000),
				reason: `HTTP ${response.status}`,
				url
			});
		} catch (error) {
			if (attempt >= SEMANTIC_SCHOLAR_MAX_RETRIES) {
				return null;
			}

			const reason =
				error instanceof Error && error.name
					? error.name
					: 'network error';

			onRetry?.({
				attempt,
				maxRetries: SEMANTIC_SCHOLAR_MAX_RETRIES,
				countdownSeconds: Math.ceil(SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS / 1000),
				reason,
				url
			});
		} finally {
			clearTimeout(timer);
		}
	}

	return null;
};

const fetchPaperById = async (
	paperId: string,
	onRetry?: (event: SemanticScholarRetryEvent) => void
): Promise<SemanticScholarPaper | null> => {
	const endpoint = `${SEMANTIC_SCHOLAR_BASE_URL}/paper/${encodeURIComponent(paperId)}?fields=${encodeURIComponent(
		PAPER_FIELDS
	)}`;

	return fetchSemanticScholar<SemanticScholarPaper>(endpoint, onRetry);
};

const searchPaperByTitle = async (
	query: string,
	onRetry?: (event: SemanticScholarRetryEvent) => void
): Promise<SemanticScholarPaper[]> => {
	const normalizedQuery = compactWhitespace(query);
	if (!normalizedQuery) {
		return [];
	}

	const endpoint = `${SEMANTIC_SCHOLAR_BASE_URL}/paper/search?query=${encodeURIComponent(
		normalizedQuery
	)}&limit=3&fields=${encodeURIComponent(PAPER_FIELDS)}`;
	const payload = await fetchSemanticScholar<SemanticScholarSearchResponse>(endpoint, onRetry);
	if (!payload || !Array.isArray(payload.data)) {
		return [];
	}

	return payload.data.filter((paper) => hasValue(toTrimmedString(paper.title)));
};

const resolvePaper = async (
	context: CitationSourceContext,
	onRetry?: (event: SemanticScholarRetryEvent) => void,
	minTitleMatchScore = 0.62
): Promise<MatchCandidate | null> => {
	const researchGateInfo = getResearchGatePublicationInfo(
		context.metadata.canonicalUrl || context.metadata.url
	);
	const expectedTitle = compactWhitespace(
		researchGateInfo.candidateTitle || context.metadata.title || context.sourceName || context.sourceText
	);
	const doi = extractDoiFromContext(context);
	if (doi) {
		const byDoi = await fetchPaperById(`DOI:${doi}`, onRetry);
		if (byDoi?.title) {
			return {
				paper: byDoi,
				score: 1,
				matchedBy: 'doi'
			};
		}
	}

	if (researchGateInfo.isPublication) {
		if (!expectedTitle) {
			addWarningOnce(
				context,
				'ResearchGate scholarlyCandidate has no recoverable title; forwarding candidate URL to fallback.'
			);
			return null;
		}

		const candidates = await searchPaperByTitle(expectedTitle, onRetry);
		if (candidates.length === 0) {
			addWarningOnce(
				context,
				'No high-confidence Semantic Scholar match found for ResearchGate scholarlyCandidate; fallback will use candidate title and URL only.'
			);
			return null;
		}

		let best: MatchCandidate | null = null;
		for (const paper of candidates) {
			const candidateTitle = toTrimmedString(paper.title);
			if (!candidateTitle) {
				continue;
			}

			const score = titleSimilarityScore(expectedTitle, candidateTitle);
			if (!best || score > best.score) {
				best = {
					paper,
					score,
					matchedBy: 'title'
				};
			}
		}

		if (!best || best.score < 0.86) {
			addWarningOnce(
				context,
				'ResearchGate scholarlyCandidate did not reach high-confidence Semantic Scholar title match threshold.'
			);
			return null;
		}

		return best;
	}

	const canonicalUrl = compactWhitespace(context.metadata.canonicalUrl || context.metadata.url);
	if (canonicalUrl) {
		const byUrl = await fetchPaperById(`URL:${canonicalUrl}`, onRetry);
		if (byUrl?.title) {
			return {
				paper: byUrl,
				score: 0.96,
				matchedBy: 'url'
			};
		}
	}

	if (!expectedTitle) {
		return null;
	}

	const candidates = await searchPaperByTitle(expectedTitle, onRetry);
	if (candidates.length === 0) {
		return null;
	}

	let best: MatchCandidate | null = null;
	for (const paper of candidates) {
		const candidateTitle = toTrimmedString(paper.title);
		if (!candidateTitle) {
			continue;
		}

		const score = titleSimilarityScore(expectedTitle, candidateTitle);
		if (!best || score > best.score) {
			best = {
				paper,
				score,
				matchedBy: 'title'
			};
		}
	}

	if (!best) {
		return null;
	}

	if (best.score < minTitleMatchScore) {
		return null;
	}

	return best;
};

const formatInTextAPA = (authors: ParsedAuthor[], year: string): string => {
	if (authors.length === 0) {
		return `(${year})`;
	}
	if (authors.length === 1) {
		return `(${authors[0].family || authors[0].full}, ${year})`;
	}
	if (authors.length === 2) {
		return `(${authors[0].family || authors[0].full} & ${authors[1].family || authors[1].full}, ${year})`;
	}

	return `(${authors[0].family || authors[0].full} et al., ${year})`;
};

const formatInTextMLA = (authors: ParsedAuthor[]): string => {
	if (authors.length === 0) {
		return '("No author")';
	}
	if (authors.length === 1) {
		return `(${authors[0].family || authors[0].full})`;
	}
	return `(${authors[0].family || authors[0].full} et al.)`;
};

const formatInTextChicagoHarvard = (authors: ParsedAuthor[], year: string): string => {
	if (authors.length === 0) {
		return `(${year})`;
	}
	if (authors.length === 1) {
		return `(${authors[0].family || authors[0].full} ${year})`;
	}
	return `(${authors[0].family || authors[0].full} et al. ${year})`;
};

const formatReferenceAPA = (args: {
	authors: ParsedAuthor[];
	year: string;
	title: string;
	sourceType: SourceType;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
}): string => {
	const authorText = joinWithAnd(args.authors.map(formatAuthorAPA));
	const lead = authorText ? `${authorText} (${args.year}).` : `${args.title} (${args.year}).`;
	const safeTitle = stripTrailingPeriod(args.title);
	const safeContainer = stripTrailingPeriod(args.containerTitle);
	const containerItalic = safeContainer ? italicizeMarkdown(safeContainer) : '';
	const link = args.link ? ` ${args.link}` : '';

	if (args.sourceType === 'Conference Papers') {
		const inVenue = containerItalic ? ` In ${containerItalic}.` : '';
		return `${lead} ${safeTitle}.${inVenue}${link}`.trim();
	}

	if (args.sourceType === 'Books') {
		const publisherPart = safeContainer ? ` ${safeContainer}.` : '';
		if (authorText) {
			return `${lead} ${italicizeMarkdown(safeTitle)}.${publisherPart}${link}`.trim();
		}

		return `${italicizeMarkdown(safeTitle)} (${args.year}).${publisherPart}${link}`.trim();
	}

	if (args.sourceType === 'Theses & Dissertations') {
		const institutionPart = safeContainer ? `, ${safeContainer}` : '';
		const thesisPart = `[Thesis${institutionPart}]`;

		if (authorText) {
			return `${authorText} (${args.year}). ${italicizeMarkdown(safeTitle)}. ${thesisPart}.${link}`
				.replace(/\s+/g, ' ')
				.trim();
		}

		return `${italicizeMarkdown(safeTitle)} (${args.year}). ${thesisPart}.${link}`
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (args.sourceType === 'Dataset') {
		const repoPart = containerItalic ? ` ${containerItalic}.` : '';
		return `${lead} ${safeTitle} [Data set].${repoPart}${link}`.trim();
	}

	const volumePages = [args.volume, args.pages].filter(Boolean).join(', ');
	const journalPart = containerItalic ? ` ${containerItalic}` : '';
	const volumePart = volumePages ? `, ${volumePages}` : '';
	return `${lead} ${safeTitle}.${journalPart}${volumePart}.${link}`.trim();
};

const formatReferenceMLA = (args: {
	authors: ParsedAuthor[];
	year: string;
	title: string;
	sourceType: SourceType;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
}): string => {
	const authorText = args.authors.length
		? args.authors.length > 2
			? `${formatAuthorLastFirst(args.authors[0])}, et al.`
			: joinWithAndWord([
				formatAuthorLastFirst(args.authors[0]),
				...args.authors.slice(1).map(formatAuthorFirstLast)
			  ])
		: '';
	const lead = authorText ? `${authorText} ` : '';
	const titleText = `"${stripTrailingPeriod(args.title)}."`;
	const container = stripTrailingPeriod(args.containerTitle);
	const containerItalic = container ? italicizeMarkdown(container) : '';

	if (args.sourceType === 'Conference Papers') {
		const venuePart = containerItalic ? `${containerItalic}, ` : '';
		const linkPart = args.link ? `, ${args.link}` : '';
		return `${lead}${titleText} ${venuePart}${args.year}${linkPart}.`.replace(/\s+/g, ' ').trim();
	}

	if (args.sourceType === 'Books') {
		const publisherPart = container ? `${container}, ` : '';
		return `${lead}${italicizeMarkdown(stripTrailingPeriod(args.title))}. ${publisherPart}${args.year}.`
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (args.sourceType === 'Theses & Dissertations') {
		const institutionPart = container ? `${container}, ` : '';
		const linkPart = args.link ? `, ${args.link}` : '';
		return `${lead}${italicizeMarkdown(stripTrailingPeriod(args.title))}. ${institutionPart}Thesis, ${args.year}${linkPart}.`
			.replace(/\s+/g, ' ')
			.trim();
	}

	const detailBits = [
		containerItalic,
		args.volume ? `vol. ${args.volume}` : '',
		args.pages ? `pp. ${args.pages}` : '',
		args.year,
		args.link
	].filter(Boolean);

	return `${lead}${titleText} ${detailBits.join(', ')}.`.replace(/\s+/g, ' ').trim();
};

const formatReferenceChicago = (args: {
	authors: ParsedAuthor[];
	year: string;
	title: string;
	sourceType: SourceType;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
}): string => {
	const authorText = args.authors.length
		? args.authors.length > 1
			? `${formatAuthorLastFirst(args.authors[0])}, ${args.authors
				.slice(1)
				.map(formatAuthorFirstLast)
				.join(', ')}`
			: formatAuthorLastFirst(args.authors[0])
		: '';
	const lead = authorText ? `${authorText}. ` : '';
	const title = `"${stripTrailingPeriod(args.title)}."`;
	const container = stripTrailingPeriod(args.containerTitle);
	const containerItalic = container ? italicizeMarkdown(container) : '';

	if (args.sourceType === 'Conference Papers') {
		const venue = containerItalic ? ` Paper presented at ${containerItalic},` : '';
		const link = args.link ? ` ${args.link}.` : '';
		return `${lead}${title}${venue} ${args.year}.${link}`.replace(/\s+/g, ' ').trim();
	}

	if (args.sourceType === 'Books') {
		const publisher = container ? `${container}, ` : '';
		return `${lead}${italicizeMarkdown(stripTrailingPeriod(args.title))}. ${publisher}${args.year}.`
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (args.sourceType === 'Theses & Dissertations') {
		const institution = container ? `, ${container}` : '';
		const link = args.link ? ` ${args.link}.` : '';
		return `${lead}${italicizeMarkdown(stripTrailingPeriod(args.title))}. Thesis${institution}, ${args.year}.${link}`
			.replace(/\s+/g, ' ')
			.trim();
	}

	const journal = containerItalic ? ` ${containerItalic}` : '';
	const volume = args.volume ? ` ${args.volume}` : '';
	const pages = args.pages ? `: ${args.pages}` : '';
	const link = args.link ? ` ${args.link}.` : '';
	return `${lead}${title}${journal}${volume} (${args.year})${pages}.${link}`
		.replace(/\s+/g, ' ')
		.trim();
};

const formatReferenceIEEE = (args: {
	authors: ParsedAuthor[];
	year: string;
	title: string;
	sourceType: SourceType;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
	doi: string;
}): string => {
	const authorText = args.authors.length
		? args.authors.map(formatAuthorIEEE).join(', ')
		: 'Unknown author';
	const title = `"${stripTrailingPeriod(args.title)}"`;
	const container = stripTrailingPeriod(args.containerTitle);
	const containerItalic = container ? italicizeMarkdown(container) : '';
	const doiPart = args.doi ? `, doi: ${args.doi}` : '';
	const linkPart = !args.doi && args.link ? `, [Online]. Available: ${args.link}` : '';

	if (args.sourceType === 'Conference Papers') {
		const venue = containerItalic ? `, in ${containerItalic}` : '';
		return `[1] ${authorText}, ${title}${venue}, ${args.year}${doiPart}${linkPart}.`;
	}

	if (args.sourceType === 'Books') {
		const publisher = container ? `${container}, ` : '';
		return `[1] ${authorText}, ${italicizeMarkdown(stripTrailingPeriod(args.title))}. ${publisher}${args.year}${linkPart}.`;
	}

	if (args.sourceType === 'Theses & Dissertations') {
		const institution = container ? `, ${container}` : '';
		return `[1] ${authorText}, ${italicizeMarkdown(stripTrailingPeriod(args.title))}, Thesis${institution}, ${args.year}${doiPart}${linkPart}.`;
	}

	const volume = args.volume ? `, vol. ${args.volume}` : '';
	const pages = args.pages ? `, pp. ${args.pages}` : '';
	const journal = containerItalic ? `, ${containerItalic}` : '';
	return `[1] ${authorText}, ${title}${journal}${volume}${pages}, ${args.year}${doiPart}${linkPart}.`;
};

const formatReferenceRmitHarvard = (args: {
	authors: ParsedAuthor[];
	year: string;
	title: string;
	sourceType: SourceType;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
	doi: string;
	accessedDate: string;
}): string => {
	const isJournalSource = args.sourceType === 'Journal Articles';
	const authorText = isJournalSource ? joinRmitJournalAuthors(args.authors) : joinRmitAuthors(args.authors);
	const lead = isJournalSource
		? authorText
			? `${authorText} (${args.year})`
			: `(${args.year})`
		: authorText
			? `${authorText} ${args.year},`
			: `${args.year},`;
	const title = isJournalSource
		? `'${stripTrailingPeriod(args.title)}'`
		: `'${stripTrailingPeriod(toRmitSentenceCase(args.title))}'`;
	const bookTitle = italicizeMarkdown(stripTrailingPeriod(toRmitSentenceCase(args.title)));
	const isArxivSource = /arxiv/i.test(`${args.containerTitle} ${args.link} ${args.doi}`);
	const container = isArxivSource ? 'arXiv' : stripTrailingPeriod(args.containerTitle);
	const containerItalic = italicizeMarkdown(container);
	const viewedLink = isArxivSource ? toArxivAbsUrl(args.link, args.doi) : args.link;
	const viewed = viewedLink ? `, viewed ${args.accessedDate}, <${viewedLink}>` : '';
	const doiPart = args.doi ? `, doi:${args.doi}` : '';
	const journalLinkPart = !args.doi && viewedLink ? `, <${viewedLink}>` : '';

	if (isJournalSource) {
		const sourcePart = containerItalic ? `, ${containerItalic}` : '';
		return `${lead} ${title}${sourcePart}${doiPart || journalLinkPart}.`
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (args.sourceType === 'Conference Papers') {
		const venue = containerItalic ? ` in ${containerItalic}` : '';
		return `${lead} ${title}${venue}${viewed}${doiPart}.`.replace(/\s+/g, ' ').trim();
	}

	if (args.sourceType === 'Books') {
		const publisher = containerItalic ? `, ${containerItalic}` : '';
		return `${lead} ${bookTitle}${publisher}${viewed}${doiPart}.`
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (isArxivSource) {
		const sourcePart = containerItalic ? `, ${containerItalic}` : '';
		return `${lead} ${title}${sourcePart}${viewed}${doiPart}.`.replace(/\s+/g, ' ').trim();
	}

	const details = [
		containerItalic,
		args.volume ? `vol. ${args.volume}` : '',
		args.pages ? `pp. ${args.pages}` : ''
	].filter(Boolean);
	const detailPart = details.length > 0 ? `, ${details.join(', ')}` : '';
	return `${lead} ${title}${detailPart}${viewed}${doiPart}.`.replace(/\s+/g, ' ').trim();
};

const formatCitationByStyle = (args: {
	style: CitationStyle;
	sourceType: SourceType;
	authors: ParsedAuthor[];
	year: string;
	title: string;
	containerTitle: string;
	volume: string;
	pages: string;
	link: string;
	doi: string;
}): { inTextCitation: string; referenceCitation: string } => {
	if (args.style === 'MLA') {
		return {
			inTextCitation: formatInTextMLA(args.authors),
			referenceCitation: formatReferenceMLA(args)
		};
	}

	if (args.style === 'Chicago') {
		return {
			inTextCitation: formatInTextChicagoHarvard(args.authors, args.year),
			referenceCitation: formatReferenceChicago(args)
		};
	}

	if (args.style === 'IEEE') {
		return {
			inTextCitation: '[1]',
			referenceCitation: formatReferenceIEEE(args)
		};
	}

	if (args.style === 'RMIT Harvard') {
		return {
			inTextCitation: formatInTextChicagoHarvard(args.authors, args.year),
			referenceCitation: formatReferenceRmitHarvard({
				...args,
				doi: args.doi,
				accessedDate: formatDateForHarvard(new Date())
			})
		};
	}

	return {
		inTextCitation: formatInTextAPA(args.authors, args.year),
		referenceCitation: formatReferenceAPA(args)
	};
};

const buildSemanticCitation = (args: {
	context: CitationSourceContext;
	paper: SemanticScholarPaper;
	matchScore: number;
	matchedBy: MatchCandidate['matchedBy'];
	style: CitationStyle;
}): SemanticScholarCitation | null => {
	const title = toSentenceCase(toTrimmedString(args.paper.title));
	if (!title) {
		return null;
	}

	const sourceType = mapPaperSourceType(args.paper);
	const authors = parseAuthors(args.paper.authors);
	const year = toYearString(args.paper);
	const doi = getPaperDoi(args.paper);
	const link = toUrlOrDoi(args.paper, args.context.metadata.canonicalUrl || args.context.metadata.url);
	const containerTitle = compactWhitespace(
		toTrimmedString(args.paper.journal?.name || args.paper.venue || args.context.metadata.containerTitle)
	);
	const volume = compactWhitespace(toTrimmedString(args.paper.journal?.volume || args.context.metadata.volume));
	const pages = compactWhitespace(toTrimmedString(args.paper.journal?.pages || args.context.metadata.pages));

	const formatted = formatCitationByStyle({
		style: args.style,
		sourceType,
		authors,
		year,
		title,
		containerTitle,
		volume,
		pages,
		link,
		doi
	});

	if (!formatted.referenceCitation || !formatted.inTextCitation) {
		return null;
	}

	const missingFields: string[] = [];
	if (authors.length === 0) {
		missingFields.push('author');
	}
	if (year === 'n.d.') {
		missingFields.push('publicationDate');
	}
	if (!containerTitle && sourceType !== 'Websites & Webpage') {
		missingFields.push('containerTitle');
	}
	if (!link && !doi) {
		missingFields.push('url');
	}

	const warnings: string[] = [];
	if (args.matchedBy === 'title' && args.matchScore < 0.75) {
		warnings.push('Semantic Scholar title match confidence is moderate; verify source details.');
	}
	if (missingFields.length > 0) {
		warnings.push('Some citation fields are missing in Semantic Scholar metadata.');
	}

	const confidenceBase = args.matchedBy === 'doi' ? 0.97 : args.matchedBy === 'url' ? 0.94 : 0.78;
	const confidence = Math.max(0.6, Math.min(0.99, Math.round((confidenceBase + args.matchScore * 0.15) * 100) / 100));

	return {
		sourceText: args.context.sourceText,
		sourceName: title,
		sourceType,
		confidence,
		missingFields,
		warnings,
		plainExplanation:
			args.matchedBy === 'doi'
				? 'Citation generated from Semantic Scholar DOI metadata.'
				: 'Citation generated from Semantic Scholar metadata.' +
				  (warnings.length > 0 ? ' Please review missing fields.' : ''),
		inTextCitation: formatted.inTextCitation,
		referenceCitation: formatted.referenceCitation
	};
};

const resolveSemanticCitation = async (
	context: CitationSourceContext,
	style: CitationStyle,
	onRetry?: (event: SemanticScholarRetryEvent) => void,
	attemptAll = false
): Promise<SemanticScholarCitation | null> => {
	if (!attemptAll && !isLikelyScholarlySource(context)) {
		return null;
	}

	const match = await resolvePaper(context, onRetry, attemptAll ? 0.85 : 0.62);
	if (!match) {
		return null;
	}

	return buildSemanticCitation({
		context,
		paper: match.paper,
		matchScore: match.score,
		matchedBy: match.matchedBy,
		style
	});
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

export const resolveCitationsWithSemanticScholar = async (args: {
	style: string;
	sourceContexts: CitationSourceContext[];
	onRetry?: (event: SemanticScholarRetryEvent) => void;
	attemptAll?: boolean;
}): Promise<Array<SemanticScholarCitation | null>> => {
	const style = getStyle(args.style);
	return mapWithConcurrency(args.sourceContexts, 1, async (context) => {
		try {
			return await resolveSemanticCitation(context, style, args.onRetry, Boolean(args.attemptAll));
		} catch {
			return null;
		}
	});
};
