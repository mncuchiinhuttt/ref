import { env } from '$env/dynamic/private';
import { buildCitationSystemPrompt } from './model-system-instructions';
import {
	normalizeSourceTypeLabel,
	SOURCE_TYPE_VALUES,
	type SourceType
} from './source-types';
import { CITATION_STYLES, type CitationStyle, type GeneratedCitation } from './generate-citations';

type ConvertedCitationPayload = {
	sourceText?: unknown;
	sourceName?: unknown;
	sourceType?: unknown;
	confidence?: unknown;
	missingFields?: unknown;
	warnings?: unknown;
	plainExplanation?: unknown;
	inTextCitation?: unknown;
	referenceCitation?: unknown;
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

	return value
		.map((item) => toTrimmedString(item))
		.filter(Boolean);
};

const toConfidenceNumber = (value: unknown, fallback = 0.6): number => {
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

const parseConvertedCitations = (args: {
	outputText: string;
	citationLines: string[];
	sourceStyle: CitationStyle;
	targetStyle: CitationStyle;
}): GeneratedCitation[] => {
	const normalized = removeCodeFence(args.outputText);
	const parsed = JSON.parse(normalized) as {
		citations?: ConvertedCitationPayload[];
	};

	const payloadItems = Array.isArray(parsed.citations) ? parsed.citations : [];
	const converted: GeneratedCitation[] = [];

	for (const [index, citationLine] of args.citationLines.entries()) {
		const payload = payloadItems[index] ?? null;
		const sourceText = toTrimmedString(payload?.sourceText) || citationLine;
		const sourceName =
			toTrimmedString(payload?.sourceName) ||
			sourceText.slice(0, 160) ||
			`Converted citation ${index + 1}`;
		const sourceType = normalizeSourceTypeLabel(
			toTrimmedString(payload?.sourceType) || 'Websites & Webpage'
		);
		const inTextCitation = toTrimmedString(payload?.inTextCitation);
		const referenceCitation = toTrimmedString(payload?.referenceCitation);
		const confidence = toConfidenceNumber(payload?.confidence, 0.6);
		const missingFields = toStringArray(payload?.missingFields);
		const warnings = toStringArray(payload?.warnings);
		const explanation = toTrimmedString(payload?.plainExplanation);

		if (!inTextCitation || !referenceCitation) {
			converted.push({
				sourceText,
				sourceName,
				sourceType,
				confidence,
				missingFields: [...missingFields, 'conversion'],
				warnings: [
					...warnings,
					`Could not fully convert this entry from ${args.sourceStyle} to ${args.targetStyle}; kept original citation text as fallback.`
				],
				plainExplanation:
					explanation ||
					`Converted from ${args.sourceStyle} to ${args.targetStyle} with fallback due to missing model fields.`,
				inTextCitation: sourceText,
				referenceCitation: sourceText,
				aiAnnotation: {
					requiresOpenAi: true,
					method: 'conversion-openai',
					reason: `Citation conversion from ${args.sourceStyle} to ${args.targetStyle} used OpenAI output and fallback handling.`
				}
			});
			continue;
		}

		converted.push({
			sourceText,
			sourceName,
			sourceType,
			confidence,
			missingFields,
			warnings,
			plainExplanation:
				explanation || `Converted citation from ${args.sourceStyle} to ${args.targetStyle}.`,
			inTextCitation,
			referenceCitation,
			aiAnnotation: {
				requiresOpenAi: true,
				method: 'conversion-openai',
				reason: `Citation conversion from ${args.sourceStyle} to ${args.targetStyle} used OpenAI.`
			}
		});
	}

	return converted;
};

const buildConversionUserPrompt = (args: {
	sourceStyle: CitationStyle;
	targetStyle: CitationStyle;
	citationLines: string[];
}): string => {
	return [
		`Source style: ${args.sourceStyle}`,
		`Target style: ${args.targetStyle}`,
		'Convert each input citation entry into the target style while preserving bibliographic facts.',
		'Return one output citation object per input citation in the same order.',
		'Keep sourceText as the original citation line.',
		'sourceName should be a concise title-like label for the citation.',
		'Choose sourceType from the allowed sourceType list only.',
		'Do not invent missing metadata; if uncertain, keep partial citation and include warnings/missingFields.',
		'Input citations JSON:',
		JSON.stringify(args.citationLines, null, 2)
	].join('\n');
};

export const convertCitationsToTargetStyle = async (args: {
	sourceStyle: string;
	targetStyle: string;
	citationLines: string[];
}): Promise<GeneratedCitation[]> => {
	const citationLines = args.citationLines
		.map((line) => line.trim())
		.filter(Boolean);
	if (citationLines.length === 0) {
		return [];
	}

	const sourceStyle = toCitationStyle(args.sourceStyle);
	const targetStyle = toCitationStyle(args.targetStyle);
	const apiKey = env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY is not set for citation style conversion.');
	}

	const stylePrompt = buildCitationSystemPrompt(targetStyle, SOURCE_TYPE_VALUES);
	const systemPrompt = [
		'You are an expert citation converter.',
		stylePrompt,
		`Convert citations from ${sourceStyle} to ${targetStyle}.`,
		'Preserve bibliographic facts and do not invent missing metadata.',
		'Return JSON only matching the provided schema.'
	].join(' ');

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
				{
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: buildConversionUserPrompt({ sourceStyle, targetStyle, citationLines })
						}
					]
				}
			],
			text: {
				format: {
					type: 'json_schema',
					name: 'converted_citations_result',
					schema: RESPONSE_SCHEMA,
					strict: true
				}
			}
		})
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`OpenAI conversion request failed (${response.status}): ${errorBody}`);
	}

	const payload = (await response.json()) as unknown;
	const outputText = getOutputText(payload);
	if (!outputText) {
		throw new Error('OpenAI conversion response did not include text output.');
	}

	return parseConvertedCitations({
		outputText,
		citationLines,
		sourceStyle,
		targetStyle
	});
};
