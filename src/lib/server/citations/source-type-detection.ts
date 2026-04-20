const REPORTS_AND_DATASETS_TYPE = 'Reports & datasets';

type DetectionAuthor = {
	corporate: boolean;
};

type DetectSourceTypeArgs = {
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
	description: string;
	headingTitle: string;
	metadataSignalCount: number;
	authors: DetectionAuthor[];
	siteName: string;
};

export type SourceTypeDecision = {
	sourceType: string;
	reasoningShort: string;
	confidence: number;
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

const hasGoogleBooksBookSignal = (domain: string, lowerPath: string, lowerCombined: string): boolean => {
	if (!/(^|\.)books\.google\./.test(domain)) {
		return false;
	}

	if (/^\/books\/(about|edition)\//.test(lowerPath)) {
		return true;
	}

	return /\bgoogle books\b/.test(lowerCombined) && /\b(book|isbn|edition|preview)\b/.test(lowerCombined);
};

const hasMarketReportDomainSignal = (domain: string): boolean => {
	return /(kenresearch|mordorintelligence|marketsandmarkets|grandviewresearch|alliedmarketresearch|fortunebusinessinsights|researchandmarkets|ibisworld|euromonitor|preceedenceresearch|reportlinker|verifiedmarketresearch)/.test(
		domain
	);
};

const hasDatasetDomainSignal = (domain: string): boolean => {
	return /(^|\.)kaggle\.com$|(^|\.)ourworldindata\.org$|(^|\.)data\.gov$|(^|\.)worldbank\.org$|(^|\.)data\.worldbank\.org$|(^|\.)oecd\.org$|(^|\.)data\.un\.org$|(^|\.)opendata\./.test(
		domain
	);
};

const hasDatasetSignal = (lowerCombined: string, lowerPath: string): boolean => {
	return /\b(data\s*set|dataset|database|open data|statistics|statistical|indicator|csv|xlsx|json|data download)\b/.test(
		lowerCombined
	) || /\b(data|dataset|database|statistics|csv|xlsx|json)\b/.test(lowerPath);
};

const hasGovernmentOrDataPortalDomainSignal = (domain: string): boolean => {
	return /(^|\.)gov(\.|$)|(^|\.)data\.gov(\.|$)|(^|\.)opendata\.|(^|\.)stats\.|(^|\.)statistics\.|(^|\.)census\.|(^|\.)statbank\./.test(
		domain
	) || /statistics|statistical|census|opendata|data-portal|datahub|dataportal/.test(domain);
};

const hasPortalOrRepositoryPathSignal = (lowerPath: string): boolean => {
	return /\/(open[-_/]?data|data[-_/]?portal|dataset[s]?|catalog(?:ue)?|repository|report[s]?|publication[s]?|statistics?|indicators?|data-download|downloads?)\b/.test(
		lowerPath
	);
};

const hasReportDatasetKeywordSignal = (lowerCombined: string, lowerPath: string): boolean => {
	return /\b(report|market report|annual report|white\s*paper|whitepaper|dataset|data\s*set|statistics|statistical|data portal|open data|report repository|dataset catalog)\b/.test(
		lowerCombined
	) || /\b(report|dataset|statistics|data-portal|open-data|white-paper)\b/.test(lowerPath);
};

const hasCommercialReportLandingSignal = (lowerCombined: string): boolean => {
	return /\b(request sample|buy now|get (?:this )?report|report price|pricing|table of contents|\btoc\b|speak to analyst|purchase report|license (?:type|option|options)|download brochure|market size|market share|growth drivers|forecast period|base year)\b/.test(
		lowerCombined
	);
};

const hasMarketReportSignal = (lowerCombined: string, lowerPath: string): boolean => {
	return /\b(market|industry)\b[^.\n]{0,80}\b(report|forecast|outlook|analysis|size|share|growth|opportunit(?:y|ies)|trend)\b/.test(
		lowerCombined
	) || /\b(report|whitepaper|industry report|market report|forecast)\b/.test(lowerCombined) || /\b(market|industry)[-_/][^\s/]*\b/.test(lowerPath);
};

export const detectSourceType = (args: DetectSourceTypeArgs): SourceTypeDecision => {
	const types = args.jsonLdTypes;
	const lowerTitle = args.title.toLowerCase();
	const lowerDescription = args.description.toLowerCase();
	const lowerHeading = args.headingTitle.toLowerCase();
	const lowerPath = args.pathname;
	const lowerContainer = args.containerTitle.toLowerCase();
	const lowerCombined = `${lowerTitle} ${lowerDescription} ${lowerHeading} ${lowerContainer} ${args.siteName.toLowerCase()} ${lowerPath} ${Array.from(types).join(' ')}`;
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
	const hasReportDatasetTerms = hasReportDatasetKeywordSignal(lowerCombined, lowerPath);
	const hasPortalOrRepositorySignal =
		hasGovernmentOrDataPortalDomainSignal(args.domain) ||
		hasPortalOrRepositoryPathSignal(lowerPath) ||
		/\b(open data|data portal|dataset catalog|report repository|statistics office|national statistics|bureau of statistics|statistical office|reports repository|data catalog)\b/.test(
			lowerCombined
		);
	const hasCommercialLandingSignal = hasCommercialReportLandingSignal(lowerCombined);
	const hasLimitedMetadataSignals =
		args.metadataSignalCount <= 1 &&
		!args.publicationDate &&
		!args.doi &&
		!args.isbn &&
		!args.containerTitle &&
		args.authors.length === 0;

	const getBoostedReportDatasetConfidence = (base: number): number => {
		const boost =
			(hasReportDatasetTerms ? 0.03 : 0) +
			(isPdf ? 0.03 : 0) +
			(args.metadataSignalCount >= 2 ? 0.01 : 0);
		return Math.max(0.2, Math.min(0.99, Math.round((base + Math.min(boost, 0.07)) * 100) / 100));
	};

	if (hasType('dataset') || hasDatasetDomainSignal(args.domain) || hasDatasetSignal(lowerCombined, lowerPath)) {
		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort: 'Dataset metadata signal was detected.',
			confidence: getBoostedReportDatasetConfidence(0.91)
		};
	}

	if (
		hasPortalOrRepositorySignal &&
		(hasReportDatasetTerms ||
			hasMarketReportDomainSignal(args.domain) ||
			hasMarketReportSignal(lowerCombined, lowerPath) ||
			isPdf)
	) {
		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort: 'Portal/repository indicators with report-or-dataset cues were detected.',
			confidence: getBoostedReportDatasetConfidence(0.89)
		};
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

	if (hasGoogleBooksBookSignal(args.domain, lowerPath, lowerCombined)) {
		return {
			sourceType: 'Books',
			reasoningShort: 'Google Books bibliographic page indicators were detected.',
			confidence: 0.9
		};
	}

	if (hasMarketReportDomainSignal(args.domain) || hasMarketReportSignal(lowerCombined, lowerPath)) {
		if (hasGovDomain(args.domain)) {
			return {
				sourceType: REPORTS_AND_DATASETS_TYPE,
				reasoningShort: 'Market/report indicators on a government domain were detected.',
				confidence: getBoostedReportDatasetConfidence(0.9)
			};
		}

		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort: 'Market or industry report indicators were detected.',
			confidence: getBoostedReportDatasetConfidence(0.9)
		};
	}

	if (hasGovDomain(args.domain)) {
		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort: 'Government domain matched report/document source.',
			confidence: getBoostedReportDatasetConfidence(
				isPdf || /report|publication|document|brief/.test(lowerCombined) ? 0.9 : 0.84
			)
		};
	}

	if (
		(isPdf || /report|whitepaper|publication|brief|document/.test(lowerCombined)) &&
		(hasOrgDomain(args.domain) || hasEduDomain(args.domain) || args.authors.every((author) => author.corporate))
	) {
		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort: 'Institutional report-style indicators were detected.',
			confidence: getBoostedReportDatasetConfidence(0.84)
		};
	}

	if (hasCommercialLandingSignal && (hasLimitedMetadataSignals || hasReportDatasetTerms)) {
		return {
			sourceType: REPORTS_AND_DATASETS_TYPE,
			reasoningShort:
				'Commercial report landing indicators were detected and classified as report/dataset.',
			confidence: getBoostedReportDatasetConfidence(0.88)
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
