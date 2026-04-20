export const SOURCE_TYPE_VALUES = [
	'Websites & Webpage',
	'Newspaper & Magazine Articles',
	'Reports & datasets',
	'Journal Articles',
	'Conference Papers',
	'Blog/Blog Post',
	'Social Media Post',
	'Books',
	'Theses & Dissertations',
	'Standards & Patents',
	'Film, Movie, or TV',
	'Podcast',
	'YouTube'
] as const;

export const REPORTS_AND_DATASETS_TYPE = 'Reports & datasets' as const;

export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeSourceTypeKey = (value: string): string =>
	compactWhitespace(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');

export const isReportOrDatasetSourceType = (sourceType: string): boolean => {
	const normalized = normalizeSourceTypeKey(sourceType);
	return (
		normalized === 'reportsdatasets' ||
		normalized === 'report' ||
		normalized === 'dataset' ||
		normalized === 'governmentreport' ||
		normalized === 'organizationreport' ||
		normalized === 'organisationreport'
	);
};

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
		return REPORTS_AND_DATASETS_TYPE;
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
		return REPORTS_AND_DATASETS_TYPE;
	}

	if (
		normalized.includes('organization') ||
		normalized.includes('organisation') ||
		normalized.includes('ngo') ||
		normalized.includes('institutional')
	) {
		return REPORTS_AND_DATASETS_TYPE;
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
