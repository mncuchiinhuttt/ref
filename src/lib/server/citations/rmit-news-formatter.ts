import type {
	CitationSourceContext,
	NormalizedSourceAuthor,
	SourceType
} from './source-metadata';
import { isReportOrDatasetSourceType } from './source-types';

export type NewsCitationStyle = 'APA' | 'MLA' | 'Chicago' | 'IEEE' | 'RMIT Harvard';

type NewsClassification = 'newsWebArticle' | 'magazineWebArticle' | 'other';

type CitationInTextMode = 'paraphrase' | 'quote';

type NewsCitation = {
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

export type NewsFormatterResult = {
	handled: boolean;
	classification: NewsClassification;
	confidence: number;
	missingFields: string[];
	warnings: string[];
	citation: NewsCitation | null;
};

const ARTICLE_PATH_SIGNAL_PATTERN =
	/\/(news|article|articles|story|stories|world|politics|business|economy|markets|tech|technology|science|health|opinion|analysis|feature|features|magazine|latest)\b/i;
const MAGAZINE_SIGNAL_PATTERN = /\b(magazine|weekly|monthly|digest|review)\b/i;
const NEWS_SIGNAL_PATTERN =
	/\b(news|newspaper|times|post|herald|gazette|tribune|telegraph|chronicle|journal|guardian|reuters)\b/i;
const SECTION_LIKE_PATTERN =
	/^(news|world|politics|business|economy|markets|opinion|analysis|sport|sports|tech|technology|science|health|travel|lifestyle|culture|entertainment|video|photos|thoi su|the gioi|kinh te|tai chinh|thi truong|xa hoi|giao duc|giai tri|van hoa|the thao|phap luat|suc khoe|doi song|du lich|cong nghe|xe|oto xe may|ban doc|multimedia)$/i;

const KNOWN_NEWSPAPER_BRAND_KEYS = [
	'vnexpress',
	'vietnamnet',
	'viet nam news',
	'vietnam plus',
	'vietnamplus',
	'dan tri',
	'bao moi',
	'24h com vn',
	'viet bao',
	'tien phong',
	'dau tu',
	'bao dau tu',
	'sai gon giai phong',
	'sggp',
	'nhan dan',
	'tuoi tre',
	'tuoi tre online',
	'thanh nien',
	'lao dong',
	'lao dong online',
	'ha noi moi',
	'thoi bao kinh te viet nam',
	'vneconomy',
	'kinh te do thi',
	'bong da',
	'le courrier du vietnam',
	'quan doi nhan dan',
	'qdnd',
	'nguoi lao dong',
	'nld',
	'an ninh thu do',
	'phap luat thanh pho ho chi minh',
	'phap luat tp hcm',
	'plo',
	'cong an nhan dan',
	'cand',
	'suc khoe doi song',
	'gia dinh xa hoi',
	'phu nu viet nam',
	'phu nu online',
	'dan viet',
	'nong nghiep viet nam',
	'bao giao thong',
	'nguoi dua tin',
	'bao chinh phu',
	'bao dien tu chinh phu',
	'znews',
	'zing news',
	'vov',
	'vov vn',
	'vietnambiz',
	'cafef',
	'petrotimes',
	'usa today',
	'san francisco chronicle',
	'wall street journal',
	'new york times',
	'washington post',
	'los angeles times',
	'new york post',
	'daily news',
	'new york daily news',
	'chicago tribune',
	'boston globe',
	'philadelphia inquirer',
	'seattle times',
	'star tribune',
	'minneapolis star tribune',
	'newsday',
	'denver post',
	'houston chronicle',
	'tampa bay times',
	'dallas morning news',
	'orange county register',
	'pittsburgh post gazette',
	'atlanta journal constitution',
	'miami herald',
	'detroit free press',
	'arizona republic',
	'star ledger',
	'st louis post dispatch',
	'kansas city star',
	'charlotte observer',
	'plain dealer',
	'oregonian',
	'the oregonian',
	'sacramento bee',
	'baltimore sun',
	'hartford courant',
	'new haven register',
	'las vegas review journal',
	'milwaukee journal sentinel',
	'yomiuri shimbun',
	'asahi shimbun',
	'mainichi newspapers',
	'japan times',
	'dainik bhaskar',
	'dainik jagran',
	'malayala manorama',
	'rajasthan patrika',
	'the hindu',
	'china daily',
	'guangzhou daily',
	'nanfang city news',
	'south china morning post',
	'the guardian',
	'daily mail',
	'globe and mail',
	'sydney morning herald',
	'le monde',
	'bild',
	'dawn',
	'new age',
	'daily sun',
	'bangladesh today',
	'vanguard',
	'moscow times'
] as const;

const MONTH_NAMES = [
	'',
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

type PublicationDateInfo = {
	year: string;
	hasFullDate: boolean;
	dayMonthYear: string;
	monthDayYear: string;
	apaDatePart: string;
};

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

const stripTrailingPeriod = (value: string): string => value.replace(/[.\s]+$/g, '').trim();

const stripTrailingUrlPunctuation = (value: string): string => value.replace(/[),.;\]]+$/g, '').trim();

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

const stripDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizeForSectionCompare = (value: string): string =>
	stripDiacritics(compactWhitespace(value).toLowerCase())
		.replace(/[_-]+/g, ' ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const hasNormalizedPhrase = (haystack: string, phrase: string): boolean => {
	if (!haystack || !phrase) {
		return false;
	}

	return (` ${haystack} `).includes(` ${phrase} `);
};

const hasKnownNewspaperBrand = (value: string): boolean => {
	const normalized = normalizeForSectionCompare(value);
	if (!normalized) {
		return false;
	}

	return KNOWN_NEWSPAPER_BRAND_KEYS.some((brand) => hasNormalizedPhrase(normalized, brand));
};

const isKnownSectionTerm = (value: string): boolean => SECTION_LIKE_PATTERN.test(value);

const safeWordCount = (value: string): number =>
	compactWhitespace(value)
		.split(/\s+/)
		.filter(Boolean).length;

const safePathname = (urlValue: string): string => {
	if (!urlValue) {
		return '';
	}

	try {
		return new URL(urlValue).pathname.toLowerCase();
	} catch {
		return '';
	}
};

const isLikelySectionLabel = (value: string): boolean => {
	const normalized = compactWhitespace(value).toLowerCase();
	if (!normalized) {
		return false;
	}

	const normalizedAscii = normalizeForSectionCompare(normalized);
	if (!normalizedAscii) {
		return false;
	}

	if (isKnownSectionTerm(normalized) || isKnownSectionTerm(normalizedAscii)) {
		return true;
	}

	const segments = normalized
		.split(/[|>/,]+/)
		.map((segment) => normalizeForSectionCompare(segment))
		.filter(Boolean);

	if (segments.length > 1 && segments.every((segment) => isKnownSectionTerm(segment))) {
		return true;
	}

	const words = normalizedAscii.split(/\s+/).filter(Boolean);
	return words.length <= 2 && words.every((word) => isKnownSectionTerm(word));
};

const isEquivalentText = (left: string, right: string): boolean =>
	compactWhitespace(left).toLowerCase() === compactWhitespace(right).toLowerCase();

const parseNameFromFull = (fullName: string): { given: string; family: string } => {
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
	if (parts.length <= 1) {
		return {
			given: '',
			family: parts[0] ?? ''
		};
	}

	return {
		given: parts.slice(0, -1).join(' '),
		family: parts.at(-1) ?? ''
	};
};

const familyNameOf = (author: NormalizedSourceAuthor): string => {
	if (author.corporate) {
		return compactWhitespace(author.full);
	}

	const family = compactWhitespace(author.family);
	if (family) {
		return family;
	}

	return parseNameFromFull(author.full).family || compactWhitespace(author.full);
};

const normalizedAuthorIdentity = (author: NormalizedSourceAuthor): string => {
	const full = compactWhitespace(author.full);
	const fallback = compactWhitespace(`${author.given} ${author.family}`);
	const value = full || fallback;
	if (!value) {
		return '';
	}

	return stripDiacritics(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
};

const dedupeNormalizedAuthors = (authors: NormalizedSourceAuthor[]): NormalizedSourceAuthor[] => {
	const deduped: NormalizedSourceAuthor[] = [];
	const seen = new Set<string>();

	for (const author of authors) {
		const key = normalizedAuthorIdentity(author);
		if (!key) {
			continue;
		}

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(author);
	}

	return deduped;
};

const givenNameOf = (author: NormalizedSourceAuthor): string => {
	if (author.corporate) {
		return '';
	}

	const given = compactWhitespace(author.given);
	if (given) {
		return given;
	}

	return parseNameFromFull(author.full).given;
};

const toInitials = (givenName: string, withDots: boolean): string => {
	const initials = compactWhitespace(givenName)
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase())
		.filter(Boolean);

	if (initials.length === 0) {
		return '';
	}

	if (!withDots) {
		return initials.join(' ');
	}

	return initials.map((initial) => `${initial}.`).join(' ');
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

const joinWithAmpersand = (items: string[]): string => {
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

const toDateFromParts = (year: number, month: number, day: number, monthFirst = false): string => {
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return '';
	}

	const monthName = MONTH_NAMES[month];
	if (monthFirst) {
		return `${monthName} ${day}, ${year}`;
	}

	return `${day} ${monthName} ${year}`;
};

const toParsedDateParts = (value: string): { year: number; month: number; day: number } | null => {
	const normalized = compactWhitespace(value);
	if (!normalized) {
		return null;
	}

	const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (isoMatch) {
		return {
			year: Number(isoMatch[1]),
			month: Number(isoMatch[2]),
			day: Number(isoMatch[3])
		};
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return {
		year: parsed.getUTCFullYear(),
		month: parsed.getUTCMonth() + 1,
		day: parsed.getUTCDate()
	};
};

const resolvePublicationDate = (context: CitationSourceContext): PublicationDateInfo => {
	const parsed = toParsedDateParts(context.metadata.publicationDate);
	if (parsed) {
		return {
			year: String(parsed.year),
			hasFullDate: true,
			dayMonthYear: toDateFromParts(parsed.year, parsed.month, parsed.day),
			monthDayYear: toDateFromParts(parsed.year, parsed.month, parsed.day, true),
			apaDatePart: `${parsed.year}, ${MONTH_NAMES[parsed.month]} ${parsed.day}`
		};
	}

	const year = toTrimmedString(context.metadata.year);
	const normalizedYear = /^\d{4}$/.test(year) ? year : 'n.d.';
	return {
		year: normalizedYear,
		hasFullDate: false,
		dayMonthYear: normalizedYear,
		monthDayYear: normalizedYear,
		apaDatePart: normalizedYear
	};
};

const formatAccessDate = (accessDate: string): string => {
	const parsed = toParsedDateParts(accessDate);
	if (!parsed) {
		return '';
	}

	return toDateFromParts(parsed.year, parsed.month, parsed.day);
};

const choosePublicationTitle = (context: CitationSourceContext): string => {
	const title = compactWhitespace(context.metadata.title);
	const containerTitle = compactWhitespace(context.metadata.containerTitle);
	const siteName = compactWhitespace(context.metadata.siteName);
	const containerHasKnownBrand = hasKnownNewspaperBrand(containerTitle);
	const siteHasKnownBrand = hasKnownNewspaperBrand(siteName);

	if (siteHasKnownBrand && !containerHasKnownBrand) {
		return siteName;
	}

	if (containerHasKnownBrand && siteHasKnownBrand) {
		const normalizedContainer = normalizeForSectionCompare(containerTitle);
		const normalizedSite = normalizeForSectionCompare(siteName);
		if (
			normalizedSite &&
			normalizedContainer.includes(normalizedSite) &&
			normalizedContainer !== normalizedSite
		) {
			return siteName;
		}

		return containerTitle;
	}

	if (containerHasKnownBrand && !isEquivalentText(containerTitle, title)) {
		return containerTitle;
	}

	if (
		containerTitle &&
		!isLikelySectionLabel(containerTitle) &&
		!isEquivalentText(containerTitle, title)
	) {
		return containerTitle;
	}

	if (siteName) {
		return siteName;
	}

	return containerTitle;
};

const truncateTitleForInText = (title: string): string => {
	const words = compactWhitespace(title).split(/\s+/).filter(Boolean);
	if (words.length <= 6) {
		return words.join(' ');
	}

	return `${words.slice(0, 6).join(' ')}...`;
};

const formatRmitAuthors = (authors: NormalizedSourceAuthor[]): string => {
	const labels = authors
		.map((author) => {
			const full = compactWhitespace(author.full);
			if (full) {
				return full;
			}

			const family = familyNameOf(author);
			return family;
		})
		.filter(Boolean);

	const dedupedLabels: string[] = [];
	const seen = new Set<string>();
	for (const label of labels) {
		const key = stripDiacritics(label)
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		dedupedLabels.push(label);
	}

	return joinWithAndWord(dedupedLabels);
};

const formatApaAuthors = (authors: NormalizedSourceAuthor[]): string => {
	const labels = authors
		.map((author) => {
			if (author.corporate) {
				return compactWhitespace(author.full);
			}

			const family = familyNameOf(author);
			const initials = toInitials(givenNameOf(author), true);
			if (family && initials) {
				return `${family}, ${initials}`;
			}

			return family || compactWhitespace(author.full);
		})
		.filter(Boolean);

	return joinWithAmpersand(labels);
};

const formatMlaAuthors = (authors: NormalizedSourceAuthor[]): string => {
	if (authors.length === 0) {
		return '';
	}

	const first = authors[0];
	const firstFamily = familyNameOf(first);
	const firstGiven = givenNameOf(first);
	const firstLabel = first.corporate
		? compactWhitespace(first.full)
		: firstFamily && firstGiven
			? `${firstFamily}, ${firstGiven}`
			: firstFamily || compactWhitespace(first.full);

	if (authors.length === 1) {
		return firstLabel;
	}

	if (authors.length >= 3) {
		return `${firstLabel}, et al.`;
	}

	const second = authors[1];
	const secondFamily = familyNameOf(second);
	const secondGiven = givenNameOf(second);
	const secondLabel = second.corporate
		? compactWhitespace(second.full)
		: secondGiven && secondFamily
			? `${secondGiven} ${secondFamily}`
			: secondFamily || compactWhitespace(second.full);

	return `${firstLabel}, and ${secondLabel}`;
};

const formatChicagoAuthors = (authors: NormalizedSourceAuthor[]): string => {
	if (authors.length === 0) {
		return '';
	}

	const formatFirst = (author: NormalizedSourceAuthor): string => {
		if (author.corporate) {
			return compactWhitespace(author.full);
		}

		const family = familyNameOf(author);
		const given = givenNameOf(author);
		if (family && given) {
			return `${family}, ${given}`;
		}

		return family || compactWhitespace(author.full);
	};

	const formatRest = (author: NormalizedSourceAuthor): string => {
		if (author.corporate) {
			return compactWhitespace(author.full);
		}

		const family = familyNameOf(author);
		const given = givenNameOf(author);
		if (family && given) {
			return `${given} ${family}`;
		}

		return family || compactWhitespace(author.full);
	};

	if (authors.length === 1) {
		return formatFirst(authors[0]);
	}

	if (authors.length >= 3) {
		return `${formatFirst(authors[0])}, et al.`;
	}

	return `${formatFirst(authors[0])}, and ${formatRest(authors[1])}`;
};

const formatIeeeAuthors = (authors: NormalizedSourceAuthor[]): string => {
	const labels = authors
		.map((author) => {
			if (author.corporate) {
				return compactWhitespace(author.full);
			}

			const family = familyNameOf(author);
			const initials = toInitials(givenNameOf(author), true);
			if (initials && family) {
				return `${initials} ${family}`;
			}

			return family || compactWhitespace(author.full);
		})
		.filter(Boolean);

	return labels.join(', ');
};

const buildInTextCitation = (args: {
	style: NewsCitationStyle;
	authors: NormalizedSourceAuthor[];
	year: string;
	title: string;
	mode: CitationInTextMode;
	quotePage: string;
}): string => {
	if (args.style === 'IEEE') {
		return '[1]';
	}

	const authorLabels = args.authors
		.map((author) => (author.corporate ? compactWhitespace(author.full) : familyNameOf(author)))
		.filter(Boolean);

	const shortTitle = truncateTitleForInText(args.title);

	if (args.style === 'MLA') {
		let lead = '';
		if (authorLabels.length === 0) {
			lead = `'${shortTitle}'`;
		} else if (authorLabels.length === 1) {
			lead = authorLabels[0];
		} else if (authorLabels.length === 2) {
			lead = `${authorLabels[0]} and ${authorLabels[1]}`;
		} else {
			lead = `${authorLabels[0]} et al.`;
		}

		const quotePart = args.mode === 'quote' && args.quotePage ? ` ${args.quotePage}` : '';
		return `(${lead}${quotePart})`;
	}

	if (args.style === 'APA') {
		let lead = '';
		if (authorLabels.length === 0) {
			lead = `'${shortTitle}'`;
		} else if (authorLabels.length === 1) {
			lead = authorLabels[0];
		} else if (authorLabels.length === 2) {
			lead = `${authorLabels[0]} & ${authorLabels[1]}`;
		} else {
			lead = `${authorLabels[0]} et al.`;
		}

		if (args.mode === 'quote' && args.quotePage) {
			return `(${lead}, ${args.year}, p. ${args.quotePage})`;
		}

		return `(${lead}, ${args.year})`;
	}

	let lead = '';
	if (authorLabels.length === 0) {
		lead = `'${shortTitle}'`;
	} else if (authorLabels.length === 1) {
		lead = authorLabels[0];
	} else if (authorLabels.length === 2) {
		lead = `${authorLabels[0]} and ${authorLabels[1]}`;
	} else {
		lead = `${authorLabels[0]} et al.`;
	}

	if (args.mode === 'quote' && args.quotePage) {
		if (args.style === 'RMIT Harvard') {
			return `(${lead} ${args.year}:${args.quotePage})`;
		}

		return `(${lead} ${args.year}, p. ${args.quotePage})`;
	}

	return `(${lead} ${args.year})`;
};

const inferNewsClassification = (args: {
	context: CitationSourceContext;
	publicationTitle: string;
	title: string;
	authors: NormalizedSourceAuthor[];
	publicationDate: PublicationDateInfo;
	url: string;
}): {
	classification: NewsClassification;
	confidence: number;
	warnings: string[];
} => {
	const pathname = safePathname(args.url);
	const publicationScope = `${args.publicationTitle} ${args.context.metadata.siteName}`.toLowerCase();
	const reasoningScope = `${args.context.reasoningShort} ${args.context.sourceText}`.toLowerCase();
	const hasKnownBrandSignal = hasKnownNewspaperBrand(publicationScope);

	const signals = {
		sourceType: args.context.sourceType === 'Newspaper & Magazine Articles',
		articlePath: ARTICLE_PATH_SIGNAL_PATTERN.test(pathname),
		headline: safeWordCount(args.title) >= 4,
		byline: args.authors.length > 0,
		fullDate: args.publicationDate.hasFullDate,
		publicationTitle: Boolean(args.publicationTitle),
		branding:
			MAGAZINE_SIGNAL_PATTERN.test(publicationScope) ||
			NEWS_SIGNAL_PATTERN.test(publicationScope) ||
			hasKnownBrandSignal,
		reasoning: /\b(news|magazine|article)\b/.test(reasoningScope)
	};

	const signalCount = Object.values(signals).filter(Boolean).length;
	const confidence = Math.max(
		0,
		Math.min(
			0.99,
			Math.round((0.25 + signalCount * 0.09 + args.context.confidence * 0.3 + (signals.sourceType ? 0.08 : 0)) * 100) /
				100
		)
	);

	const warnings: string[] = [];
	const enoughEvidence = signalCount >= 4 || (signals.sourceType && signalCount >= 3);
	if (!enoughEvidence || confidence < 0.65) {
		warnings.push(
			'Source is not confidently classified as newsWebArticle or magazineWebArticle; route this source to another formatter.'
		);
		return {
			classification: 'other',
			confidence,
			warnings
		};
	}

	if (MAGAZINE_SIGNAL_PATTERN.test(publicationScope)) {
		return {
			classification: 'magazineWebArticle',
			confidence,
			warnings
		};
	}

	if (NEWS_SIGNAL_PATTERN.test(publicationScope) || hasKnownBrandSignal || /\/news\//i.test(pathname)) {
		return {
			classification: 'newsWebArticle',
			confidence,
			warnings
		};
	}

	warnings.push('Publication brand is ambiguous; defaulted classification to newsWebArticle.');
	return {
		classification: 'newsWebArticle',
		confidence,
		warnings
	};
};

const formatReferenceByStyle = (args: {
	style: NewsCitationStyle;
	authors: NormalizedSourceAuthor[];
	title: string;
	publicationTitle: string;
	publicationDate: PublicationDateInfo;
	accessedDate: string;
	url: string;
}): string => {
	const title = stripTrailingPeriod(args.title);
	const publicationTitle = stripTrailingPeriod(args.publicationTitle);
	const publicationTitleItalic = publicationTitle ? italicizeMarkdown(publicationTitle) : '';
	const url = stripTrailingUrlPunctuation(args.url);

	if (args.style === 'RMIT Harvard') {
		const authorText = formatRmitAuthors(args.authors);
		const lead = authorText
			? `${authorText} ${args.publicationDate.dayMonthYear} '${title}'`
			: `'${title}' ${args.publicationDate.dayMonthYear}`;
		const detailParts: string[] = [];
		if (publicationTitleItalic) {
			detailParts.push(publicationTitleItalic);
		}
		if (args.accessedDate) {
			detailParts.push(`accessed ${args.accessedDate}`);
		}

		const base = detailParts.length > 0 ? `${lead}, ${detailParts.join(', ')}` : lead;
		return url ? `${compactWhitespace(base)}. ${url}` : compactWhitespace(base);
	}

	if (args.style === 'APA') {
		const authorText = formatApaAuthors(args.authors);
		const lead = authorText
			? `${authorText} (${args.publicationDate.apaDatePart}). ${title}.`
			: `${title}. (${args.publicationDate.apaDatePart}).`;
		const publicationPart = publicationTitleItalic ? ` ${publicationTitleItalic}.` : '';
		const base = `${lead}${publicationPart}`.trim();
		return url ? `${stripTrailingPeriod(base)}. ${url}` : base;
	}

	if (args.style === 'MLA') {
		const authorText = formatMlaAuthors(args.authors);
		const datePart = args.publicationDate.dayMonthYear;
		let base = authorText ? `${authorText}. "${title}."` : `"${title}."`;
		if (publicationTitleItalic) {
			base += ` ${publicationTitleItalic},`;
		}
		if (datePart) {
			base += ` ${datePart}`;
		}

		const normalized = compactWhitespace(base).replace(/[\s,]+$/g, '');
		return url ? `${normalized}, ${url}` : `${normalized}.`;
	}

	if (args.style === 'Chicago') {
		const authorText = formatChicagoAuthors(args.authors);
		const yearPart = args.publicationDate.year;
		const lead = authorText ? `${authorText}. ${yearPart}. "${title}."` : `"${title}." ${yearPart}.`;
		let detail = '';
		if (publicationTitleItalic && args.publicationDate.hasFullDate) {
			detail = ` ${publicationTitleItalic}, ${args.publicationDate.monthDayYear}.`;
		} else if (publicationTitleItalic) {
			detail = ` ${publicationTitleItalic}.`;
		} else if (args.publicationDate.hasFullDate) {
			detail = ` ${args.publicationDate.monthDayYear}.`;
		}

		const base = `${lead}${detail}`.trim();
		return url ? `${stripTrailingPeriod(base)}. ${url}` : base;
	}

	const authorText = formatIeeeAuthors(args.authors);
	const datePart = args.publicationDate.hasFullDate
		? args.publicationDate.monthDayYear
		: args.publicationDate.year;
	let base = '[1]';
	if (authorText) {
		base += ` ${authorText},`;
	}
	base += ` "${title},"`;
	if (publicationTitleItalic) {
		base += ` ${publicationTitleItalic},`;
	}
	if (datePart) {
		base += ` ${datePart}`;
	}

	const normalized = compactWhitespace(base).replace(/[\s,]+$/g, '');
	if (url) {
		return `${normalized}. [Online]. Available: ${url}`;
	}

	return `${normalized}.`;
};

export const formatNewsOrMagazineCitation = (
	context: CitationSourceContext,
	options: {
		style: NewsCitationStyle;
		includeInText?: boolean;
		inTextMode?: CitationInTextMode;
		quotePage?: string;
	} = { style: 'APA' }
): NewsFormatterResult => {
	if (isReportOrDatasetSourceType(context.sourceType)) {
		return {
			handled: false,
			classification: 'other',
			confidence: context.confidence,
			missingFields: [],
			warnings: [],
			citation: null
		};
	}

	const warnings: string[] = [];
	const missingFields: string[] = [];

	const style = options.style;
	const title = compactWhitespace(toTrimmedString(context.metadata.title) || toTrimmedString(context.sourceName));
	if (!title) {
		missingFields.push('title');
		warnings.push('Article title is missing; cannot build a reliable news-style citation.');
	}

	const publicationTitle = choosePublicationTitle(context);
	if (!publicationTitle) {
		missingFields.push('publicationTitle');
		warnings.push('Publication title is missing; cannot confirm newspaper or magazine container.');
	}

	const url = stripTrailingUrlPunctuation(
		compactWhitespace(context.metadata.canonicalUrl || context.metadata.url)
	);
	if (!url) {
		missingFields.push('url');
		warnings.push('URL is missing from metadata.');
	}

	const authors = dedupeNormalizedAuthors(context.metadata.authors);
	if (authors.length === 0) {
		missingFields.push('author');
		warnings.push('No author metadata found; citation starts with the article title.');
	}

	const publicationDate = resolvePublicationDate(context);
	if (publicationDate.year === 'n.d.') {
		missingFields.push('publicationDate');
		warnings.push('Publication date is missing; using n.d.');
	} else if (!publicationDate.hasFullDate) {
		warnings.push('Full publication date is unavailable; using year-only date in reference.');
	}

	const accessedDate = formatAccessDate(context.metadata.accessDate);
	if (style === 'RMIT Harvard' && !accessedDate) {
		missingFields.push('accessedDate');
		warnings.push('Accessed date is missing for this online source.');
	}

	const inferred = inferNewsClassification({
		context,
		publicationTitle,
		title,
		authors,
		publicationDate,
		url
	});

	const forcedNewsClassification =
		inferred.classification === 'other' && context.sourceType === 'Newspaper & Magazine Articles'
			? 'newsWebArticle'
			: inferred.classification;

	if (forcedNewsClassification === 'other') {
		return {
			handled: false,
			classification: 'other',
			confidence: inferred.confidence,
			missingFields: [],
			warnings: [],
			citation: null
		};
	}

	if (inferred.classification === 'other' && context.sourceType === 'Newspaper & Magazine Articles') {
		warnings.push(
			'Formatter forced to newsWebArticle because sourceType is Newspaper & Magazine Articles; skipped model fallback.'
		);
	}

	if (context.sourceType !== 'Newspaper & Magazine Articles') {
		warnings.push(
			`Provided sourceType (${context.sourceType}) differs from inferred news-style article classification.`
		);
	}

	const referenceCitation = formatReferenceByStyle({
		style,
		authors,
		title,
		publicationTitle,
		publicationDate,
		accessedDate,
		url
	});

	const inTextCitation = options.includeInText === false
		? context.sourceName
		: buildInTextCitation({
			style,
			authors,
			year: publicationDate.year,
			title,
			mode: options.inTextMode ?? 'paraphrase',
			quotePage: toTrimmedString(options.quotePage)
		});

	const confidence = Math.max(context.confidence, inferred.confidence);

	return {
		handled: true,
		classification: forcedNewsClassification,
		confidence,
		missingFields: uniqueStrings(missingFields),
		warnings: uniqueStrings([...warnings, ...inferred.warnings]),
		citation: {
			sourceText: context.sourceText,
			sourceName: title || context.sourceName,
			sourceType: 'Newspaper & Magazine Articles',
			confidence,
			missingFields: uniqueStrings(missingFields),
			warnings: uniqueStrings([...warnings, ...inferred.warnings]),
			plainExplanation: `Formatted as ${forcedNewsClassification} using ${style} news/magazine article rules.`,
			inTextCitation,
			referenceCitation
		}
	};
};

export const formatRmitNewsOrMagazineCitation = (
	context: CitationSourceContext,
	options?: {
		includeInText?: boolean;
		inTextMode?: CitationInTextMode;
		quotePage?: string;
	}
): NewsFormatterResult =>
	formatNewsOrMagazineCitation(context, {
		style: 'RMIT Harvard',
		includeInText: options?.includeInText,
		inTextMode: options?.inTextMode,
		quotePage: options?.quotePage
	});
