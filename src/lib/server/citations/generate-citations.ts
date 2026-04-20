import { env } from '$env/dynamic/private';
import {
	buildSourceContexts,
	getResearchGatePublicationInfo,
	type CitationSourceContext
} from './source-metadata';
import {
	isReportOrDatasetSourceType,
	normalizeSourceTypeLabel,
	SOURCE_TYPE_VALUES,
	type SourceType
} from './source-types';
import { buildCitationSystemPrompt } from './model-system-instructions';
import { formatNewsOrMagazineCitation } from './rmit-news-formatter';
import {
	resolveCitationsWithSemanticScholar,
	type SemanticScholarRetryEvent
} from './semantic-scholar';

export const CITATION_STYLES = ['APA', 'MLA', 'Chicago', 'IEEE', 'RMIT Harvard'] as const;

export type CitationStyle = (typeof CITATION_STYLES)[number];

export type CitationResolverMethod =
	| 'semantic-scholar'
	| 'news-formatter'
	| 'openai'
	| 'openai-fallback'
	| 'conversion-openai';

export type CitationAiAnnotation = {
	requiresOpenAi: boolean;
	method: CitationResolverMethod;
	reason: string;
};

export type GeneratedCitation = {
	sourceText: string;
	sourceName: string;
	sourceType: SourceType;
	confidence: number;
	missingFields: string[];
	warnings: string[];
	plainExplanation: string;
	inTextCitation: string;
	referenceCitation: string;
	aiAnnotation: CitationAiAnnotation;
};

const PRESERVE_DETECTED_SOURCE_TYPE_CONFIDENCE = 0.85;

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

const RESPONSE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['citations'],
	properties: {
		citations: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'sourceText',
					'sourceName',
					'sourceType',
					'confidence',
					'missingFields',
					'warnings',
					'inTextCitation',
					'referenceCitation',
					'plainExplanation'
				],
				properties: {
					sourceText: { type: 'string' },
					sourceName: { type: 'string' },
					sourceType: { type: 'string', enum: [...SOURCE_TYPE_VALUES] },
					confidence: { type: 'number' },
					missingFields: {
						type: 'array',
						items: { type: 'string' }
					},
					warnings: {
						type: 'array',
						items: { type: 'string' }
					},
					inTextCitation: { type: 'string' },
					referenceCitation: { type: 'string' },
					plainExplanation: { type: 'string' }
				}
			}
		}
	}
};

const toTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const stripTrailingPeriod = (value: string): string => value.replace(/[.\s]+$/g, '').trim();

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
	for (const value of values) {
		const normalized = toTrimmedString(value);
		if (normalized) {
			return normalized;
		}
	}

	return '';
};

const italicizeMarkdown = (value: string): string => {
	const normalized = stripTrailingPeriod(compactWhitespace(value));
	if (!normalized) {
		return '';
	}

	if (/^\*.*\*$/.test(normalized)) {
		return normalized;
	}

	return `*${normalized}*`;
};

const normalizeWhitespaceAroundPunctuation = (value: string): string =>
	compactWhitespace(value).replace(/\s+([,.;:])/g, '$1');

const toAccessDateLabel = (accessDate: string): string => {
	const normalized = toTrimmedString(accessDate);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return '';
	}

	const year = Number(normalized.slice(0, 4));
	const month = Number(normalized.slice(5, 7));
	const day = Number(normalized.slice(8, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) {
		return '';
	}

	return `${day} ${MONTH_NAMES[month]} ${year}`;
};

const isLikelyDatasetContext = (context: CitationSourceContext): boolean => {
	const combined = [
		context.metadata.title,
		context.metadata.containerTitle,
		context.metadata.description,
		context.metadata.url,
		context.metadata.canonicalUrl
	]
		.join(' ')
		.toLowerCase();

	const hasDatasetSignals =
		/\b(data\s*set|dataset|database|open\s*data|data\s*portal|data\s*catalog|indicator(?:s)?|csv|xlsx|json|kaggle|ourworldindata|worldbank|oecd)\b/.test(
			combined
		) || /\b(repository|catalog(?:ue)?)\b/.test(combined) && /\b(data|dataset|open)\b/.test(combined);
	const hasReportSignals =
		/\b(report|market\s*report|industry\s*report|forecast|outlook|analysis|white\s*paper|annual\s*report)\b/.test(
			combined
		);

	if (hasReportSignals && !hasDatasetSignals) {
		return false;
	}

	return hasDatasetSignals;
};

const getReportOrDatasetLabel = (context: CitationSourceContext): 'Report' | 'Data set' =>
	isLikelyDatasetContext(context) ? 'Data set' : 'Report';

const getPrimaryAuthorKey = (context: CitationSourceContext): string => {
	const firstAuthor = context.metadata.authors[0];
	if (firstAuthor) {
		if (firstAuthor.corporate) {
			return firstNonEmpty(firstAuthor.full, context.sourceName);
		}

		return firstNonEmpty(firstAuthor.family, firstAuthor.full, firstAuthor.given, context.sourceName);
	}

	return firstNonEmpty(
		context.metadata.organization,
		context.metadata.publisher,
		context.metadata.siteName,
		context.sourceName,
		context.metadata.title,
		'Unknown source'
	);
};

const getReferenceAuthorLead = (context: CitationSourceContext): string => {
	const authorNames = context.metadata.authors
		.map((author) => {
			if (author.corporate) {
				return firstNonEmpty(author.full);
			}

			return firstNonEmpty(author.full, `${author.given} ${author.family}`);
		})
		.map((name) => compactWhitespace(name))
		.filter(Boolean);

	if (authorNames.length === 1) {
		return authorNames[0];
	}

	if (authorNames.length === 2) {
		return `${authorNames[0]} & ${authorNames[1]}`;
	}

	if (authorNames.length > 2) {
		return `${authorNames[0]} et al.`;
	}

	return firstNonEmpty(
		context.metadata.organization,
		context.metadata.publisher,
		context.metadata.siteName,
		context.sourceName,
		'Unknown source'
	);
};

const getSourceYear = (context: CitationSourceContext): string => {
	const publicationYear = context.metadata.publicationDate.slice(0, 4);
	const updatedYear = context.metadata.updatedDate.slice(0, 4);

	return firstNonEmpty(context.metadata.year, publicationYear, updatedYear, 'n.d.');
};

const getPublisherOrRepository = (context: CitationSourceContext, authorLead: string): string => {
	const publisher = firstNonEmpty(
		context.metadata.publisher,
		context.metadata.organization,
		context.metadata.siteName
	);
	if (!publisher) {
		return '';
	}

	if (publisher.toLowerCase() === authorLead.toLowerCase()) {
		return '';
	}

	return publisher;
};

const getReportRepositoryLabel = (context: CitationSourceContext, authorLead: string): string => {
	const baseLabel = stripTrailingPeriod(
		firstNonEmpty(
			context.metadata.publisher,
			context.metadata.organization,
			context.metadata.siteName,
			authorLead,
			context.sourceName
		)
	);

	if (!baseLabel) {
		return '';
	}

	if (/\b(website|repository|portal|database|catalog(?:ue)?)\b/i.test(baseLabel)) {
		return baseLabel;
	}

	return `${baseLabel} website`;
};

const buildDeterministicReportDatasetCitation = (args: {
	style: CitationStyle;
	context: CitationSourceContext;
}): { inTextCitation: string; referenceCitation: string; warning: string } => {
	const title = stripTrailingPeriod(
		firstNonEmpty(args.context.metadata.title, args.context.sourceName, args.context.sourceText)
	);
	const year = getSourceYear(args.context);
	const authorKey = stripTrailingPeriod(getPrimaryAuthorKey(args.context));
	const authorLead = stripTrailingPeriod(getReferenceAuthorLead(args.context));
	const sourceUrl = firstNonEmpty(args.context.metadata.canonicalUrl, args.context.metadata.url);
	const label = getReportOrDatasetLabel(args.context);
	const mediumBracket = label === 'Data set' ? '[Data set]' : '[Report]';
	const publisherOrRepository = stripTrailingPeriod(getPublisherOrRepository(args.context, authorLead));
	const accessedDateLabel =
		toAccessDateLabel(firstNonEmpty(args.context.metadata.accessDate, new Date().toISOString().slice(0, 10))) ||
		'';
	const warning =
		'Report/dataset source type was preserved from metadata; citation format was normalized deterministically.';

	if (args.style === 'APA') {
		const inTextCitation = authorKey ? `(${authorKey}, ${year})` : `(${year})`;
		const referenceCitation = normalizeWhitespaceAroundPunctuation(
			`${authorLead} (${year}). ${italicizeMarkdown(title)} ${mediumBracket}. ${
				publisherOrRepository ? `${publisherOrRepository}.` : ''
			}${sourceUrl ? ` ${sourceUrl}` : ''}`
		);

		return {
			inTextCitation,
			referenceCitation,
			warning
		};
	}

	if (args.style === 'MLA') {
		const inTextCitation = authorKey ? `(${authorKey})` : '("No author")';
		const referenceCitation = normalizeWhitespaceAroundPunctuation(
			`${authorLead}. ${italicizeMarkdown(title)}. ${label}, ${
				publisherOrRepository ? `${publisherOrRepository}, ` : ''
			}${year}${sourceUrl ? `, ${sourceUrl}` : ''}.`
		);

		return {
			inTextCitation,
			referenceCitation,
			warning
		};
	}

	if (args.style === 'Chicago') {
		const inTextCitation = authorKey ? `(${authorKey} ${year})` : `(${year})`;
		const referenceCitation = normalizeWhitespaceAroundPunctuation(
			`${authorLead}. ${italicizeMarkdown(title)}. ${label}. ${
				publisherOrRepository ? `${publisherOrRepository}, ` : ''
			}${year}.${sourceUrl ? ` ${sourceUrl}.` : ''}`
		);

		return {
			inTextCitation,
			referenceCitation,
			warning
		};
	}

	if (args.style === 'IEEE') {
		const referenceCitation = normalizeWhitespaceAroundPunctuation(
			`[1] ${authorLead}, ${italicizeMarkdown(title)}, ${label}, ${
				publisherOrRepository ? `${publisherOrRepository}, ` : ''
			}${year}${sourceUrl ? `, [Online]. Available: ${sourceUrl}` : ''}.`
		);

		return {
			inTextCitation: '[1]',
			referenceCitation,
			warning
		};
	}

	const inTextCitation = authorKey ? `(${authorKey} ${year})` : `(${year})`;
	const repositoryLabel = getReportRepositoryLabel(args.context, authorLead);
	const mediumSuffix = label === 'Data set' ? ', data set' : '';
	const accessedSuffix = accessedDateLabel ? `, accessed ${accessedDateLabel}` : '';
	const referenceCitation = normalizeWhitespaceAroundPunctuation(
		`${authorLead} (${year}) ${title}${mediumSuffix}${repositoryLabel ? `, ${repositoryLabel}` : ''}${accessedSuffix}.${
			sourceUrl ? ` ${sourceUrl}` : ''
		}`
	);

	return {
		inTextCitation,
		referenceCitation,
		warning
	};
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.map((item) => toTrimmedString(item)).filter(Boolean);
};

const toConfidenceNumber = (value: unknown, fallback = 0.5): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	const bounded = Math.max(0, Math.min(1, value));
	return Math.round(bounded * 100) / 100;
};

const removeCodeFence = (value: string): string =>
	value
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();

const getOutputText = (payload: unknown): string | null => {
	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const outputText = (payload as { output_text?: unknown }).output_text;
	if (typeof outputText === 'string' && outputText.trim()) {
		return outputText.trim();
	}

	const output = (payload as { output?: unknown }).output;
	if (!Array.isArray(output)) {
		return null;
	}

	const parts: string[] = [];
	for (const item of output) {
		if (!item || typeof item !== 'object') {
			continue;
		}

		const content = (item as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}

		for (const piece of content) {
			if (!piece || typeof piece !== 'object') {
				continue;
			}

			const text = (piece as { text?: unknown }).text;
			if (typeof text === 'string' && text.trim()) {
				parts.push(text.trim());
			}
		}
	}

	if (parts.length === 0) {
		return null;
	}

	return parts.join('\n');
};

const toCitationStyle = (value: string): CitationStyle => {
	if ((CITATION_STYLES as readonly string[]).includes(value)) {
		return value as CitationStyle;
	}

	return 'APA';
};

const mergeUniqueStrings = (items: string[]): string[] => {
	const seen = new Set<string>();
	const merged: string[] = [];

	for (const item of items) {
		const normalized = toTrimmedString(item);
		if (!normalized) {
			continue;
		}

		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		merged.push(normalized);
	}

	return merged;
};

const buildPromptSourcePayload = (sourceContexts: CitationSourceContext[]) => {
	return sourceContexts.map((source) => {
		const researchGateInfo = getResearchGatePublicationInfo(
			source.metadata.canonicalUrl || source.metadata.url
		);

		if (researchGateInfo.isPublication) {
			const candidateTitle =
				toTrimmedString(researchGateInfo.candidateTitle) ||
				toTrimmedString(source.metadata.title) ||
				toTrimmedString(source.sourceName);
			const candidateUrl =
				toTrimmedString(source.metadata.canonicalUrl) ||
				toTrimmedString(source.metadata.url) ||
				researchGateInfo.normalizedUrl;
			const detectionNotes = mergeUniqueStrings([
				source.reasoningShort,
				...source.warnings.filter((warning) =>
					/researchgate|scholarlycandidate|semantic scholar/i.test(warning)
				)
			]).join(' ');

			return {
				sourceText: source.sourceText,
				sourceName: candidateTitle || source.sourceName,
				sourceType: source.sourceType,
				confidence: source.confidence,
				reasoningShort: source.reasoningShort,
				missingFields: source.missingFields,
				warnings: source.warnings,
				metadata: {
					title: candidateTitle,
					url: candidateUrl,
					canonicalUrl: candidateUrl,
					description: detectionNotes
				}
			};
		}

		return {
			sourceText: source.sourceText,
			sourceName: source.sourceName,
			sourceType: source.sourceType,
			confidence: source.confidence,
			reasoningShort: source.reasoningShort,
			missingFields: source.missingFields,
			warnings: source.warnings,
			metadata: {
				title: source.metadata.title,
				authors: source.metadata.authors,
				containerTitle: source.metadata.containerTitle,
				siteName: source.metadata.siteName,
				publisher: source.metadata.publisher,
				organization: source.metadata.organization,
				publicationDate: source.metadata.publicationDate,
				updatedDate: source.metadata.updatedDate,
				doi: source.metadata.doi,
				isbn: source.metadata.isbn,
				issn: source.metadata.issn,
				volume: source.metadata.volume,
				issue: source.metadata.issue,
				pages: source.metadata.pages,
				url: source.metadata.url,
				canonicalUrl: source.metadata.canonicalUrl,
				description: source.metadata.description
			}
		};
	});
};

const parseCitationsFromModel = (
	outputText: string,
	sourceContexts: CitationSourceContext[],
	style: CitationStyle
): GeneratedCitation[] => {
	const normalized = removeCodeFence(outputText);
	const parsed = JSON.parse(normalized) as {
		citations?: Array<{
			sourceText?: unknown;
			sourceName?: unknown;
			sourceType?: unknown;
			confidence?: unknown;
			missingFields?: unknown;
			warnings?: unknown;
			plainExplanation?: unknown;
			inTextCitation?: unknown;
			referenceCitation?: unknown;
		}>;
	};

	if (!Array.isArray(parsed.citations)) {
		throw new Error('Model response does not contain a citations array.');
	}

	const citations = parsed.citations
		.map((item, index) => {
			const fallback = sourceContexts[index];
			const sourceText =
				toTrimmedString(item.sourceText) ||
				toTrimmedString(fallback?.sourceText);
			const sourceName =
				toTrimmedString(item.sourceName) ||
				toTrimmedString(fallback?.sourceName) ||
				sourceText;
			const fallbackSourceType = normalizeSourceTypeLabel(toTrimmedString(fallback?.sourceType));
			const modelSourceType = normalizeSourceTypeLabel(
				toTrimmedString(item.sourceType) || toTrimmedString(fallback?.sourceType)
			);
			const preserveFallbackSourceType =
				fallback &&
				(
					fallback.confidence >= PRESERVE_DETECTED_SOURCE_TYPE_CONFIDENCE ||
					(isReportOrDatasetSourceType(fallbackSourceType) &&
						modelSourceType === 'Newspaper & Magazine Articles')
				);
			const sourceType = preserveFallbackSourceType ? fallbackSourceType : modelSourceType;
			let inTextCitation = toTrimmedString(item.inTextCitation);
			let referenceCitation = toTrimmedString(item.referenceCitation);
			const confidence = toConfidenceNumber(item.confidence, fallback?.confidence ?? 0.5);
			const missingFields =
				toStringArray(item.missingFields).length > 0
					? toStringArray(item.missingFields)
					: (fallback?.missingFields ?? []);
			const modelWarnings = toStringArray(item.warnings);
			let plainExplanation = toTrimmedString(item.plainExplanation);

			const shouldNormalizeReportCitation =
				fallback && isReportOrDatasetSourceType(sourceType);
			const openAiReason = shouldNormalizeReportCitation
				? 'Citation required OpenAI generation and deterministic report/dataset normalization.'
				: 'Citation required OpenAI generation.';

			if (shouldNormalizeReportCitation) {
				const normalizedReportCitation = buildDeterministicReportDatasetCitation({
					style,
					context: fallback
				});

				inTextCitation = normalizedReportCitation.inTextCitation;
				referenceCitation = normalizedReportCitation.referenceCitation;
				modelWarnings.push(normalizedReportCitation.warning);

				if (plainExplanation) {
					plainExplanation = `${plainExplanation} ${normalizedReportCitation.warning}`;
				} else {
					plainExplanation = normalizedReportCitation.warning;
				}
			}

			const warnings = [...(fallback?.warnings ?? []), ...modelWarnings];

			if (!sourceText || !sourceName || !sourceType || !inTextCitation || !referenceCitation) {
				return null;
			}

			return {
				sourceText,
				sourceName,
				sourceType,
				confidence,
				missingFields,
				warnings,
				plainExplanation,
				inTextCitation,
				referenceCitation,
				aiAnnotation: {
					requiresOpenAi: true,
					method: 'openai',
					reason: openAiReason
				}
			};
		})
		.filter((item): item is GeneratedCitation => item !== null);

	if (citations.length === 0) {
		throw new Error('Model response did not include valid citations.');
	}

	return citations;
};

export const generateCitationsWithAI = async (args: {
	style: string;
	sourceLines: string[];
	onSemanticScholarRetry?: (event: SemanticScholarRetryEvent) => void;
}): Promise<GeneratedCitation[]> => {
	const sourceLines = args.sourceLines.map((line) => line.trim()).filter(Boolean);
	if (sourceLines.length === 0) {
		return [];
	}

	const style = toCitationStyle(args.style);
	const sourceContexts = await buildSourceContexts(sourceLines);
	if (sourceContexts.length === 0) {
		return [];
	}

	const resolvedCitations: Array<GeneratedCitation | null> = Array.from(
		{ length: sourceContexts.length },
		() => null
	);

	// Priority pass: verify scholarly matches with Semantic Scholar before type-specific formatters.
	const semanticPriorityCitations = await resolveCitationsWithSemanticScholar({
		style,
		sourceContexts,
		onRetry: args.onSemanticScholarRetry,
		attemptAll: true
	});

	for (const [index, semanticCitation] of semanticPriorityCitations.entries()) {
		if (semanticCitation) {
			resolvedCitations[index] = {
				...semanticCitation,
				aiAnnotation: {
					requiresOpenAi: false,
					method: 'semantic-scholar',
					reason: 'Resolved with Semantic Scholar and deterministic citation formatting.'
				}
			};
		}
	}

	const pendingIndexes: number[] = [];

	for (const [index, context] of sourceContexts.entries()) {
		if (resolvedCitations[index]) {
			continue;
		}

		if (isReportOrDatasetSourceType(context.sourceType)) {
			pendingIndexes.push(index);
			continue;
		}

		const decision = formatNewsOrMagazineCitation(context, { style });
		if (decision.handled && decision.citation) {
			resolvedCitations[index] = {
				...decision.citation,
				aiAnnotation: {
					requiresOpenAi: false,
					method: 'news-formatter',
					reason: 'Resolved with deterministic news/magazine formatter.'
				}
			};
			continue;
		}

		if (decision.warnings.length > 0) {
			context.warnings = mergeUniqueStrings([...context.warnings, ...decision.warnings]);
		}

		if (decision.missingFields.length > 0) {
			context.missingFields = mergeUniqueStrings([
				...context.missingFields,
				...decision.missingFields
			]);
		}

		pendingIndexes.push(index);
	}

	const unresolvedIndexes = pendingIndexes.filter((index) => resolvedCitations[index] === null);
	const unresolvedContexts = unresolvedIndexes.map((index) => sourceContexts[index]);

	let openAiCitations: GeneratedCitation[] = [];
	if (unresolvedContexts.length > 0) {
		const apiKey = env.OPENAI_API_KEY?.trim();
		if (!apiKey) {
			throw new Error(
				'OPENAI_API_KEY is not set, and Semantic Scholar could not resolve every source.'
			);
		}

		const systemPrompt = buildCitationSystemPrompt(style, SOURCE_TYPE_VALUES);
		const promptSourcePayload = buildPromptSourcePayload(unresolvedContexts);
		const userPrompt = [
			`Citation style: ${style}`,
			'Source preprocessing has already run with these steps for each source:',
			'1) fetch URL',
			'2) parse HTML/JSON-LD/meta tags',
			'3) detect source type',
			'4) normalize metadata',
			'Use the normalized source objects below as the primary evidence.',
			'If fields are missing, keep citations partial and list missing fields honestly.',
			'Sources JSON:',
			JSON.stringify(promptSourcePayload, null, 2)
		].join('\n');

		const response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: 'gpt-5-nano',
				input: [
					{ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
					{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
				],
				text: {
					format: {
						type: 'json_schema',
						name: 'citations_result',
						schema: RESPONSE_SCHEMA,
						strict: true
					}
				}
			})
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
		}

		const payload = (await response.json()) as unknown;
		const outputText = getOutputText(payload);
		if (!outputText) {
			throw new Error('OpenAI response did not include text output.');
		}

		openAiCitations = parseCitationsFromModel(outputText, unresolvedContexts, style);
	}

	let openAiCursor = 0;
	for (const index of unresolvedIndexes) {
		if (resolvedCitations[index]) {
			continue;
		}

		const context = sourceContexts[index];
		const fallback = openAiCitations[openAiCursor];
		openAiCursor += 1;

		resolvedCitations[index] =
			fallback ??
			{
				sourceText: context.sourceText,
				sourceName: context.sourceName,
				sourceType: context.sourceType,
				confidence: context.confidence,
				missingFields: context.missingFields,
				warnings: [...context.warnings, 'Fallback citation generation failed for this source.'],
				plainExplanation:
					'Could not resolve this source via Semantic Scholar and OpenAI output was incomplete.',
				inTextCitation: context.sourceName,
				referenceCitation: context.sourceName,
				aiAnnotation: {
					requiresOpenAi: true,
					method: 'openai-fallback',
					reason: 'OpenAI was requested but returned incomplete output; fallback citation was used.'
				}
			};
	}

	const merged = resolvedCitations.filter((item): item is GeneratedCitation => item !== null);

	if (merged.length === 0) {
		throw new Error('No citations could be generated from Semantic Scholar or OpenAI.');
	}

	return merged;
};
