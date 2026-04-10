import { env } from '$env/dynamic/private';
import {
	buildSourceContexts,
	getResearchGatePublicationInfo,
	normalizeSourceTypeLabel,
	SOURCE_TYPE_VALUES,
	type CitationSourceContext,
	type SourceType
} from './source-metadata';
import { buildCitationSystemPrompt } from './model-system-instructions';
import { formatNewsOrMagazineCitation } from './rmit-news-formatter';
import {
	resolveCitationsWithSemanticScholar,
	type SemanticScholarRetryEvent
} from './semantic-scholar';

export const CITATION_STYLES = ['APA', 'MLA', 'Chicago', 'IEEE', 'RMIT Harvard'] as const;

export type CitationStyle = (typeof CITATION_STYLES)[number];

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
};

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
	sourceContexts: CitationSourceContext[]
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
			const sourceType = normalizeSourceTypeLabel(
				toTrimmedString(item.sourceType) || toTrimmedString(fallback?.sourceType)
			);
			const inTextCitation = toTrimmedString(item.inTextCitation);
			const referenceCitation = toTrimmedString(item.referenceCitation);
			const confidence = toConfidenceNumber(item.confidence, fallback?.confidence ?? 0.5);
			const missingFields =
				toStringArray(item.missingFields).length > 0
					? toStringArray(item.missingFields)
					: (fallback?.missingFields ?? []);
			const warnings = [...(fallback?.warnings ?? []), ...toStringArray(item.warnings)];
			const plainExplanation = toTrimmedString(item.plainExplanation);

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
				referenceCitation
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
			resolvedCitations[index] = semanticCitation;
		}
	}

	const pendingIndexes: number[] = [];

	for (const [index, context] of sourceContexts.entries()) {
		if (resolvedCitations[index]) {
			continue;
		}

		const decision = formatNewsOrMagazineCitation(context, { style });
		if (decision.handled && decision.citation) {
			resolvedCitations[index] = decision.citation;
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

		openAiCitations = parseCitationsFromModel(outputText, unresolvedContexts);
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
				referenceCitation: context.sourceName
			};
	}

	const merged = resolvedCitations.filter((item): item is GeneratedCitation => item !== null);

	if (merged.length === 0) {
		throw new Error('No citations could be generated from Semantic Scholar or OpenAI.');
	}

	return merged;
};
