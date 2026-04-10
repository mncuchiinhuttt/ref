<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { fade, scale } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import SiteHeader from '$lib/components/common/site-header.svelte';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { PageData } from './$types';

	type CitationRow = {
		id: number | string;
		rawText: string;
		sourceName: string;
		sourceType: string;
		inTextCitation: string;
		referenceCitation: string;
		style: string;
		note: string | null;
		createdAt: string;
		isGenerating?: boolean;
	};

	type CitationTextSegment = {
		text: string;
		italic: boolean;
	};

	type CitationQuotaState = PageData['citationQuota'];

	let { data }: { data: PageData } = $props();

	const getInitialStyleValue = (): string => data.project.citationStyle;
	const getInitialCitations = (): CitationRow[] =>
		data.citations.map((item) => ({
			...item,
			isGenerating: false
		}));
	const sourceTypeOptions = [
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

	let isRenameDialogOpen = $state(false);
	let isShareOpen = $state(false);
	let isCitationComposerOpen = $state(false);
	let isDeleteConfirmOpen = $state(false);
	let citationLinesInput = $state('');
	let styleValue = $state(getInitialStyleValue());
	let styleUpdateMode = $state<'style-only' | 'regenerate-all'>('style-only');
	let citations = $state<CitationRow[]>(getInitialCitations());
	let citationQuota: CitationQuotaState = $derived(data.citationQuota);
	let editingCitationId = $state<string | number | null>(null);
	let editSourceName = $state('');
	let editSourceType = $state('');
	let editInTextCitation = $state('');
	let editReferenceCitation = $state('');
	let editNote = $state('');

	const escapeHtml = (value: string): string =>
		value
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');

	const stripItalicMarkers = (value: string): string => value.replace(/\*([^*]+)\*/g, '$1');

	const toReferenceSegments = (value: string): CitationTextSegment[] => {
		const segments: CitationTextSegment[] = [];
		let startIndex = 0;

		for (const match of value.matchAll(/\*([^*]+)\*/g)) {
			const matchIndex = match.index ?? 0;
			const matchText = match[0] ?? '';
			const italicText = match[1] ?? '';

			if (matchIndex > startIndex) {
				segments.push({
					text: value.slice(startIndex, matchIndex),
					italic: false
				});
			}

			if (italicText) {
				segments.push({
					text: italicText,
					italic: true
				});
			}

			startIndex = matchIndex + matchText.length;
		}

		if (startIndex < value.length) {
			segments.push({
				text: value.slice(startIndex),
				italic: false
			});
		}

		return segments;
	};

	const formatReferenceCitationHtml = (value: string): string => {
		let html = '';
		let startIndex = 0;

		for (const match of value.matchAll(/\*([^*]+)\*/g)) {
			const matchIndex = match.index ?? 0;
			const matchText = match[0] ?? '';
			const italicText = match[1] ?? '';

			html += escapeHtml(value.slice(startIndex, matchIndex));
			html += `<em>${escapeHtml(italicText)}</em>`;
			startIndex = matchIndex + matchText.length;
		}

		html += escapeHtml(value.slice(startIndex));
		return html;
	};

	const referenceEntries = $derived(
		citations.filter((item) => !item.isGenerating).map((item) => item.referenceCitation)
	);

	const referenceListPlain = $derived(referenceEntries.map((item) => stripItalicMarkers(item)).join('\n'));

	const referenceListHtml = $derived(
		`<div>${referenceEntries
			.map((item) => `<p style="margin: 0;">${formatReferenceCitationHtml(item)}</p>`)
			.join('')}</div>`
	);

	const initials = (name: string): string =>
		name
			.split(' ')
			.map((part) => part.slice(0, 1).toUpperCase())
			.slice(0, 2)
			.join('');

	const asRecord = (value: unknown): Record<string, unknown> | null => {
		if (value && typeof value === 'object') {
			return value as Record<string, unknown>;
		}

		return null;
	};

	const getMessage = (data: unknown, fallback: string): string => {
		const record = asRecord(data);
		const message = record?.message;

		if (typeof message === 'string' && message.trim()) {
			return message;
		}

		return fallback;
	};

	const updateCitationQuotaFromAction = (data: unknown): void => {
		const payload = asRecord(data);
		const quota = payload?.citationQuota;

		if (!quota || typeof quota !== 'object') {
			return;
		}

		citationQuota = quota as CitationQuotaState;
	};

	const getNumber = (value: unknown): number => {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}

		if (typeof value === 'string' && value.trim()) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}

		return 0;
	};

	const mapCitationEntry = (entry: unknown): CitationRow | null => {
		const record = asRecord(entry);
		if (!record) {
			return null;
		}

		const id = record.id;
		const rawText = typeof record.rawText === 'string' ? record.rawText.trim() : '';
		const sourceName = typeof record.sourceName === 'string' ? record.sourceName.trim() : rawText;
		const sourceType =
			typeof record.sourceType === 'string' && record.sourceType.trim()
				? record.sourceType.trim()
				: 'Websites & Webpage';
		const inTextCitation =
			typeof record.inTextCitation === 'string' ? record.inTextCitation.trim() : '';
		const referenceCitation =
			typeof record.referenceCitation === 'string' ? record.referenceCitation.trim() : '';

		if (
			(typeof id !== 'number' && typeof id !== 'string') ||
			!rawText ||
			!inTextCitation ||
			!referenceCitation
		) {
			return null;
		}

		const style = typeof record.style === 'string' && record.style.trim() ? record.style : styleValue;
		const note = typeof record.note === 'string' ? record.note : null;
		const createdAt =
			typeof record.createdAt === 'string' && record.createdAt.trim()
				? record.createdAt
				: new Date().toISOString();

		return {
			id,
			rawText,
			sourceName: sourceName || rawText,
			sourceType,
			inTextCitation,
			referenceCitation,
			style,
			note,
			createdAt,
			isGenerating: false
		};
	};

	const mapGeneratedCitations = (data: unknown): CitationRow[] => {
		if (!Array.isArray(data)) {
			return [];
		}

		return data
			.map((entry) => mapCitationEntry(entry))
			.filter((item): item is CitationRow => item !== null);
	};

	const isEditingCitation = (id: number | string): boolean =>
		editingCitationId !== null && String(editingCitationId) === String(id);

	const openCitationEditor = (item: CitationRow): void => {
		editingCitationId = item.id;
		editSourceName = item.sourceName;
		editSourceType = item.sourceType || sourceTypeOptions[0];
		editInTextCitation = item.inTextCitation;
		editReferenceCitation = item.referenceCitation;
		editNote = item.note ?? '';
	};

	const closeCitationEditor = (): void => {
		editingCitationId = null;
		editSourceName = '';
		editSourceType = '';
		editInTextCitation = '';
		editReferenceCitation = '';
		editNote = '';
	};

	const copyText = async (text: string, label: string, html?: string): Promise<void> => {
		if (!text.trim()) {
			toast.warning(`No ${label.toLowerCase()} to copy.`);
			return;
		}

		try {
			if (html && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
				const item = new ClipboardItem({
					'text/plain': new Blob([text], { type: 'text/plain' }),
					'text/html': new Blob([html], { type: 'text/html' })
				});

				await navigator.clipboard.write([item]);
			} else {
				await navigator.clipboard.writeText(text);
			}

			toast.success(`${label} copied.`);
		} catch {
			toast.error(`Unable to copy ${label.toLowerCase()}.`);
		}
	};

	const closeShareDialog = (): void => {
		isShareOpen = false;
	};

	const closeRenameDialog = (): void => {
		isRenameDialogOpen = false;
	};

	const closeCitationDialog = (): void => {
		isCitationComposerOpen = false;
	};

	const closeDeleteConfirm = (): void => {
		isDeleteConfirmOpen = false;
	};

	const formatShortDate = (isoValue: string): string =>
		new Date(isoValue).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});

	const quotaUsedPercent = $derived(
		citationQuota?.isLimited && citationQuota.weeklyLimit
			? Math.min(100, Math.round((citationQuota.usedThisWeek / citationQuota.weeklyLimit) * 100))
			: 0
	);
</script>

<div class="min-h-dvh bg-linear-to-b from-background via-background to-muted/20">
	<SiteHeader
		showAuthCta={false}
		showDashboardCta={true}
		showSignOutCta={true}
		signOutAction="?/signOut"
		subtitle="Project workspace"
	/>

	<main class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
		<Card class="border-border/60 bg-card/85 shadow-sm overflow-visible">
			<CardHeader class="gap-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						<CardTitle class="font-heading text-2xl">{data.project.name}</CardTitle>
						{#if data.project.isOwner}
							<Button type="button" variant="ghost" size="sm" onclick={() => (isRenameDialogOpen = true)}>
								Edit name
							</Button>
						{/if}
					</div>
					{#if data.project.isOwner}
						<div class="grid gap-2">
							<div class="flex items-center gap-2">
								<Button href="/dashboard" variant="outline" size="sm">Back to dashboard</Button>
								<div class="relative">
									<Button
										type="button"
										size="sm"
										variant="destructive"
										onclick={() => {
											isDeleteConfirmOpen = !isDeleteConfirmOpen;
										}}
									>
										Delete project
									</Button>
									{#if isDeleteConfirmOpen}
										<div
											class="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-border/70 bg-card p-3 shadow-2xl"
											role="dialog"
											tabindex="-1"
											aria-label="Confirm delete project"
											onkeydown={(event) => {
												if (event.key === 'Escape') {
													closeDeleteConfirm();
												}
											}}
											in:fade={{ duration: 120 }}
											out:fade={{ duration: 100 }}
										>
											<p class="text-sm font-medium">Delete this project?</p>
											<p class="mt-1 text-xs text-muted-foreground">
												All citations and collaboration data in this project will be removed.
											</p>
											<div class="mt-3 flex items-center justify-end gap-2">
												<Button type="button" size="sm" variant="outline" onclick={closeDeleteConfirm}>
													Cancel
												</Button>
												<form method="post" action="?/deleteProject">
													<Button type="submit" size="sm" variant="destructive">Confirm delete</Button>
												</form>
											</div>
										</div>
									{/if}
								</div>
							</div>
							<form
								class="flex flex-wrap items-center gap-2"
								method="post"
								action="?/updateCitationStyle"
								use:enhance={({ formData }) => {
									const selectedMode = String(formData.get('styleUpdateMode') ?? 'style-only');
									const announceId = toast.loading(
										selectedMode === 'regenerate-all'
											? 'Updating style and re-generating citations (Semantic Scholar cooldown: 1s/request)...'
											: 'Updating citation style...'
									);

									return async ({ result, update }) => {
										if (result.type === 'failure') {
											updateCitationQuotaFromAction(result.data);
											toast.error(getMessage(result.data, 'Unable to update citation style.'), {
												id: announceId
											});
											return;
										}

										if (result.type === 'success') {
											updateCitationQuotaFromAction(result.data);
											const payload = asRecord(result.data);
											const retryCount = getNumber(payload?.semanticScholarRetryCount);

											if (selectedMode === 'regenerate-all') {
												const regeneratedCitations = mapGeneratedCitations(payload?.generatedCitations);
												if (regeneratedCitations.length > 0) {
													citations = regeneratedCitations;
												}
											}

											const citationStyle = payload?.citationStyle;
											if (typeof citationStyle === 'string' && citationStyle.trim()) {
												styleValue = citationStyle;
											}

											styleUpdateMode = 'style-only';
											toast.success(getMessage(result.data, 'Citation style updated.'), { id: announceId });

											if (retryCount > 0) {
												toast.warning(
													`Semantic Scholar request failed ${retryCount} time${retryCount === 1 ? '' : 's'} and was auto-retried (max 3 attempts).`
												);
											}

											await update();
											return;
										}

										toast.error('Unable to update citation style.', { id: announceId });
										await applyAction(result);
										return;
									};
								}}
							>
								<Select.Root type="single" bind:value={styleValue}>
									<Select.Trigger class="min-w-36">
										{styleValue}
									</Select.Trigger>
									<Select.Content>
										{#each data.citationStyles as style (style)}
											<Select.Item value={style} label={style} />
										{/each}
									</Select.Content>
								</Select.Root>
								<Select.Root type="single" bind:value={styleUpdateMode}>
									<Select.Trigger class="min-w-56">
										{styleUpdateMode === 'regenerate-all'
											? 'Re-generate all citations'
											: 'Keep existing citations'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="style-only" label="Keep existing citations" />
										<Select.Item value="regenerate-all" label="Re-generate all citations" />
									</Select.Content>
								</Select.Root>
								<input type="hidden" name="citationStyle" value={styleValue} />
								<input type="hidden" name="styleUpdateMode" value={styleUpdateMode} />
								<Button type="submit" size="sm" variant="outline">Set style</Button>
							</form>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<Button href="/dashboard" variant="outline" size="sm">Back to dashboard</Button>
							<Badge variant="outline">{data.project.citationStyle}</Badge>
						</div>
					{/if}
				</div>
				<CardDescription>
					Project-level citation style controls generation behavior for all newly added citations.
				</CardDescription>
			</CardHeader>

			<CardContent class="grid gap-4">
				<div class="grid gap-2">
					<p class="text-sm font-medium">Collaboration</p>
					<div class="flex flex-wrap items-center gap-2">
						{#each data.collaborators as collaborator (collaborator.id)}
							<div class="group relative">
								<Avatar size="sm" class="ring-background ring-2">
									<AvatarImage src={collaborator.image ?? undefined} alt={`${collaborator.name} avatar`} />
									<AvatarFallback>{initials(collaborator.name)}</AvatarFallback>
								</Avatar>
								<div class="pointer-events-none invisible absolute left-0 top-full z-30 w-72 max-w-[calc(100vw-2rem)] pt-2 group-hover:visible group-focus-within:visible sm:left-1/2 sm:-translate-x-1/2">
									<div class="rounded-lg border border-border/70 bg-card p-3 shadow-lg">
										<div class="flex items-start gap-3">
											<Avatar size="sm">
												<AvatarImage src={collaborator.image ?? undefined} alt={`${collaborator.name} avatar`} />
												<AvatarFallback>{initials(collaborator.name)}</AvatarFallback>
											</Avatar>
											<div class="grid gap-0.5">
												<p class="text-sm font-medium">{collaborator.displayUsername || collaborator.name}</p>
												<p class="text-xs text-muted-foreground">
													{#if collaborator.username}
														@{collaborator.username}
													{:else}
														{collaborator.email}
													{/if}
												</p>
												<p class="text-xs text-muted-foreground">Role: {collaborator.role}</p>
											</div>
										</div>
									</div>
								</div>
							</div>
						{/each}
						{#if data.collaborators.length === 0}
							<p class="text-sm text-muted-foreground">No collaborators yet.</p>
						{/if}
					</div>
				</div>

				<div class="grid gap-2">
					<div class="flex items-center gap-2">
						<Button type="button" size="sm" variant="outline" onclick={() => (isShareOpen = true)}>
							Share
						</Button>
						{#if !data.project.isOwner}
							<p class="text-xs text-muted-foreground">Only owner can invite collaborators.</p>
						{/if}
					</div>
				</div>
			</CardContent>
		</Card>

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">Weekly Citation Quota</CardTitle>
				<CardDescription>
					Coverage window: {formatShortDate(citationQuota.weekStartIso)} - {formatShortDate(citationQuota.weekEndIso)}
				</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3">
				{#if citationQuota.isLimited}
					<div class="grid gap-2">
						<div class="flex items-center justify-between text-sm">
							<p class="font-medium">{citationQuota.usedThisWeek} / {citationQuota.weeklyLimit} used</p>
							<p class="text-muted-foreground">{citationQuota.remainingThisWeek} remaining</p>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class="h-full rounded-full bg-primary" style={`width: ${quotaUsedPercent}%;`}></div>
						</div>
						{#if citationQuota.pendingRequestCount > 0}
							<p class="text-xs text-muted-foreground">
								Pending expansion requests: {citationQuota.pendingRequestCount}
							</p>
						{/if}
					</div>

					{#if data.user.role === 'user'}
						<div class="rounded-xl border border-border/60 bg-background/50 p-3">
							<p class="text-sm text-muted-foreground">
								Need more weekly citations? Use Request expansion on the dashboard.
							</p>
							<div class="mt-2">
								<Button href="/dashboard" size="sm" variant="outline">Open dashboard</Button>
							</div>
						</div>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">Unlimited citation generation for admin role.</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<CardTitle class="font-heading text-xl">Citations</CardTitle>
						<CardDescription>
							Click in-text or reference citation to copy. Generate more with + Citation.
						</CardDescription>
					</div>
					<div class="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={() => copyText(referenceListPlain, 'Reference list', referenceListHtml)}
						>
							Copy references
						</Button>
						<Button type="button" size="sm" onclick={() => (isCitationComposerOpen = true)}>
							+ Citation
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent class="grid gap-3">
				{#if citations.length === 0}
					<p class="rounded-xl border border-dashed border-border/70 bg-background/50 p-5 text-sm text-muted-foreground">
						No citations yet. Use + Citation to generate rows for this project.
					</p>
				{:else}
					<div class="overflow-x-auto rounded-xl border border-border/60">
						<table class="min-w-full text-sm">
							<thead class="bg-muted/50">
								<tr>
									<th class="px-3 py-2 text-left font-medium">Name</th>
									<th class="px-3 py-2 text-left font-medium">Source type</th>
									<th class="px-3 py-2 text-left font-medium">Source</th>
									<th class="px-3 py-2 text-left font-medium">In-text</th>
									<th class="px-3 py-2 text-left font-medium">Reference</th>
									<th class="px-3 py-2 text-left font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each citations as item (item.id)}
									<tr class="border-t border-border/60 align-top">
										<td class="px-3 py-2">
											<p class="font-medium">{item.sourceName}</p>
											{#if item.isGenerating}
												<p class="mt-1 text-xs text-muted-foreground">Generating...</p>
											{:else}
												<p class="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if item.isGenerating}
												<Skeleton class="h-6 w-24" />
											{:else}
												<Badge variant="outline">{item.sourceType}</Badge>
											{/if}
										</td>
										<td class="px-3 py-2">
											<p class="max-w-md whitespace-pre-wrap wrap-break-word text-sm">{item.rawText}</p>
										</td>
										<td class="px-3 py-2">
											{#if item.isGenerating}
												<div class="space-y-2">
													<Skeleton class="h-4 w-28" />
													<Skeleton class="h-4 w-20" />
												</div>
											{:else}
												<button
													type="button"
													class="rounded-md px-2 py-1 text-left transition-colors hover:bg-secondary"
													onclick={() => copyText(item.inTextCitation, 'In-text citation')}
												>
													{item.inTextCitation}
												</button>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if item.isGenerating}
												<div class="space-y-2">
													<Skeleton class="h-4 w-36" />
													<Skeleton class="h-4 w-24" />
												</div>
											{:else}
												<button
													type="button"
													class="rounded-md px-2 py-1 text-left transition-colors hover:bg-secondary"
													onclick={() =>
														copyText(
															stripItalicMarkers(item.referenceCitation),
															'Reference citation',
															formatReferenceCitationHtml(item.referenceCitation)
														)
													}
												>
														<span class="whitespace-pre-wrap wrap-break-word">
															{#each toReferenceSegments(item.referenceCitation) as segment, index (`${item.id}-${index}`)}
																{#if segment.italic}
																	<em>{segment.text}</em>
																{:else}
																	{segment.text}
																{/if}
															{/each}
														</span>
												</button>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if item.isGenerating}
												<Badge variant="outline">Generating</Badge>
											{:else}
												<div class="flex flex-wrap items-center gap-2">
													<form
														method="post"
														action="?/regenerateCitation"
														use:enhance={() => {
															const announceId = toast.loading('Re-generating citation...');
															const citationId = String(item.id);

															citations = citations.map((entry) =>
																String(entry.id) === citationId ? { ...entry, isGenerating: true } : entry
															);

															return async ({ result }) => {
																if (result.type === 'success') {
																	updateCitationQuotaFromAction(result.data);
																	const payload = asRecord(result.data);
																	const retryCount = getNumber(payload?.semanticScholarRetryCount);
																	const updatedCitation = mapCitationEntry(payload?.updatedCitation);

																	citations = citations.map((entry) => {
																		if (String(entry.id) !== citationId) {
																			return entry;
																		}

																		if (updatedCitation) {
																			return updatedCitation;
																		}

																		return { ...entry, isGenerating: false };
																	});

																	if (retryCount > 0) {
																		toast.warning(
																			`Semantic Scholar request failed ${retryCount} time${retryCount === 1 ? '' : 's'} and was auto-retried (max 3 attempts).`
																		);
																	}

																	toast.success(getMessage(result.data, 'Citation re-generated.'), {
																		id: announceId
																	});
																	return;
																}

																citations = citations.map((entry) =>
																	String(entry.id) === citationId ? { ...entry, isGenerating: false } : entry
																);

																if (result.type === 'failure') {
																	updateCitationQuotaFromAction(result.data);
																	toast.error(getMessage(result.data, 'Unable to re-generate citation.'), {
																		id: announceId
																	});
																	return;
																}

																toast.error('Unable to re-generate citation.', { id: announceId });
																await applyAction(result);
															};
														}}
													>
														<input type="hidden" name="citationId" value={item.id} />
														<Button type="submit" size="sm" variant="outline">Regenerate</Button>
													</form>
													<Button type="button" size="sm" variant="outline" onclick={() => openCitationEditor(item)}>
														Edit
													</Button>
													<form
														method="post"
														action="?/deleteCitation"
														use:enhance={() => {
															const announceId = toast.loading('Deleting citation...');

															return async ({ result }) => {
																if (result.type === 'success') {
																	citations = citations.filter(
																		(entry) => String(entry.id) !== String(item.id)
																	);
																	if (isEditingCitation(item.id)) {
																		closeCitationEditor();
																	}
																	toast.success(getMessage(result.data, 'Citation deleted.'), {
																		id: announceId
																	});
																	return;
																}

																if (result.type === 'failure') {
																	toast.error(getMessage(result.data, 'Unable to delete citation.'), {
																		id: announceId
																	});
																	return;
																}

																toast.error('Unable to delete citation.', { id: announceId });
																await applyAction(result);
															};
														}}
													>
														<input type="hidden" name="citationId" value={item.id} />
														<Button type="submit" variant="destructive" size="sm">Delete</Button>
													</form>
												</div>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</CardContent>
		</Card>

		{#if isRenameDialogOpen && data.project.isOwner}
			<div
				class="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm"
				role="dialog"
				tabindex="-1"
				aria-modal="true"
				aria-label="Edit project name"
				onclick={(event) => {
					if (event.target === event.currentTarget) {
						closeRenameDialog();
					}
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape') {
						closeRenameDialog();
					}
				}}
				in:fade={{ duration: 140 }}
				out:fade={{ duration: 120 }}
			>
				<div class="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center p-4 sm:p-6 lg:p-8">
					<section
						class="w-full max-w-xl rounded-2xl border border-border/60 bg-card p-4 shadow-2xl sm:p-5"
						in:scale={{ duration: 160, start: 0.96 }}
						out:scale={{ duration: 120, start: 0.96 }}
					>
						<div class="mb-4 flex items-center justify-between gap-3">
							<div>
								<p class="font-heading text-lg font-semibold tracking-tight">Edit project name</p>
								<p class="text-sm text-muted-foreground">Update the project title.</p>
							</div>
							<Button type="button" variant="ghost" size="sm" onclick={closeRenameDialog}>Close</Button>
						</div>

						<form
							class="grid gap-3"
							method="post"
							action="?/renameProject"
							use:enhance={() => {
								return async ({ result, update }) => {
									if (result.type === 'failure') {
										toast.error(getMessage(result.data, 'Unable to rename project.'));
										return;
									}

									toast.success('Project name updated.');
									isRenameDialogOpen = false;
									await update();
								};
							}}
						>
							<div class="grid gap-1.5">
								<Label for="project-name-dialog">Project name</Label>
								<Input
									id="project-name-dialog"
									name="projectName"
									required
									value={data.project.name}
								/>
							</div>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm">Save</Button>
								<Button type="button" variant="outline" size="sm" onclick={closeRenameDialog}>
									Cancel
								</Button>
							</div>
						</form>
					</section>
				</div>
			</div>
		{/if}

		{#if isShareOpen}
			<div
				class="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm"
				role="dialog"
				tabindex="-1"
				aria-modal="true"
				aria-label="Share project"
				onclick={(event) => {
					if (event.target === event.currentTarget) {
						closeShareDialog();
					}
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape') {
						closeShareDialog();
					}
				}}
				in:fade={{ duration: 140 }}
				out:fade={{ duration: 120 }}
			>
				<div class="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center p-4 sm:p-6 lg:p-8">
					<section
						class="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-4 shadow-2xl sm:p-5"
						in:scale={{ duration: 160, start: 0.96 }}
						out:scale={{ duration: 120, start: 0.96 }}
					>
						<div class="mb-4 flex items-center justify-between gap-3">
							<div>
								<p class="font-heading text-lg font-semibold tracking-tight">Share project</p>
								<p class="text-sm text-muted-foreground">Invite collaborators to this project.</p>
							</div>
							<Button type="button" variant="ghost" size="sm" onclick={closeShareDialog}>Close</Button>
						</div>

						{#if data.project.isOwner}
							<div class="grid gap-3">
								<form class="flex flex-wrap items-end gap-2" method="get">
									<div class="grid gap-1">
										<Label for="invite-search">Search user</Label>
										<Input
											id="invite-search"
											name="invite"
											placeholder="Display name, username, or email"
											value={data.inviteQuery}
										/>
									</div>
									<Button type="submit" size="sm">Search</Button>
								</form>

								{#if data.inviteQuery.length >= 2}
									{#if data.inviteSearchResults.length === 0}
										<p class="text-sm text-muted-foreground">No users found for "{data.inviteQuery}".</p>
									{:else}
										<div class="grid max-h-72 gap-2 overflow-y-auto pr-1">
											{#each data.inviteSearchResults as candidate (candidate.id)}
												<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/70 p-2">
													<div class="flex items-center gap-2">
														<Avatar size="sm">
															<AvatarImage src={candidate.image ?? undefined} alt={`${candidate.name} avatar`} />
															<AvatarFallback>{initials(candidate.name)}</AvatarFallback>
														</Avatar>
														<div class="grid gap-0.5">
															<p class="text-sm font-medium">{candidate.displayUsername || candidate.name}</p>
															<p class="text-xs text-muted-foreground">
																{candidate.username ? `@${candidate.username}` : candidate.email}
															</p>
														</div>
													</div>
													<form
														method="post"
														action="?/inviteMember"
														use:enhance={() => {
															const announceId = toast.loading('Sending invitation...');

															return async ({ result, update }) => {
																if (result.type === 'failure') {
																	toast.error(getMessage(result.data, 'Unable to send invitation.'), {
																		id: announceId
																	});
																	return;
																}

																toast.success('Invitation sent.', { id: announceId });
																await update();
															};
														}}
													>
														<input type="hidden" name="inviteUserId" value={candidate.id} />
														<Button type="submit" size="sm">Invite</Button>
													</form>
												</div>
											{/each}
										</div>
									{/if}
								{/if}

								{#if data.pendingInvitations.length > 0}
									<Separator />
									<div class="grid gap-2">
										<p class="text-sm font-medium">Pending invites</p>
										{#each data.pendingInvitations as invite (invite.id)}
											<p class="text-sm text-muted-foreground">
												{invite.invitee.displayUsername || invite.invitee.name}
												{#if invite.invitee.username}
													(@{invite.invitee.username})
												{/if}
											</p>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">You can view collaborators but cannot send invites.</p>
						{/if}
					</section>
				</div>
			</div>
		{/if}

		{#if editingCitationId !== null}
			<div
				class="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm"
				role="dialog"
				tabindex="-1"
				aria-modal="true"
				aria-label="Edit citation"
				onclick={(event) => {
					if (event.target === event.currentTarget) {
						closeCitationEditor();
					}
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape') {
						closeCitationEditor();
					}
				}}
				in:fade={{ duration: 140 }}
				out:fade={{ duration: 120 }}
			>
				<div class="mx-auto flex min-h-full w-full max-w-4xl items-center justify-center p-4 sm:p-6 lg:p-8">
					<section
						class="w-full max-w-3xl rounded-2xl border border-border/60 bg-card p-4 shadow-2xl sm:p-5"
						in:scale={{ duration: 160, start: 0.96 }}
						out:scale={{ duration: 120, start: 0.96 }}
					>
						<div class="mb-4 flex items-center justify-between gap-3">
							<div>
								<p class="font-heading text-lg font-semibold tracking-tight">Edit citation</p>
								<p class="text-sm text-muted-foreground">Adjust citation details and save changes.</p>
							</div>
							<Button type="button" variant="ghost" size="sm" onclick={closeCitationEditor}>Close</Button>
						</div>

						<form
							class="grid gap-3"
							method="post"
							action="?/editCitation"
							use:enhance={() => {
								const announceId = toast.loading('Saving citation edits...');

								return async ({ result }) => {
									if (result.type === 'success') {
										const payload = asRecord(result.data);
										const updated = mapCitationEntry(payload?.updatedCitation);
										if (updated) {
											citations = citations.map((entry) =>
												String(entry.id) === String(updated.id) ? updated : entry
											);
										}
										closeCitationEditor();
										toast.success(getMessage(result.data, 'Citation updated.'), {
											id: announceId
										});
										return;
									}

									if (result.type === 'failure') {
										toast.error(getMessage(result.data, 'Unable to update citation.'), {
											id: announceId
										});
										return;
									}

									toast.error('Unable to update citation.', { id: announceId });
									await applyAction(result);
								};
							}}
						>
							<input type="hidden" name="citationId" value={editingCitationId} />

							<div class="grid gap-1.5">
								<Label for="edit-citation-name">Citation name</Label>
								<Input id="edit-citation-name" name="sourceName" required bind:value={editSourceName} />
							</div>

							<div class="grid gap-1.5">
								<Label for="edit-citation-source-type">Source type</Label>
								<Select.Root type="single" bind:value={editSourceType}>
									<Select.Trigger id="edit-citation-source-type" class="w-full">
										{editSourceType || 'Select source type'}
									</Select.Trigger>
									<Select.Content>
										{#each sourceTypeOptions as sourceTypeOption (sourceTypeOption)}
											<Select.Item value={sourceTypeOption} label={sourceTypeOption} />
										{/each}
									</Select.Content>
								</Select.Root>
								<input type="hidden" name="sourceType" value={editSourceType} />
							</div>

							<div class="grid gap-1.5">
								<Label for="edit-citation-in-text">In-text citation</Label>
								<textarea
									id="edit-citation-in-text"
									name="inTextCitation"
									required
									rows="3"
									class="border-input data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3"
									bind:value={editInTextCitation}
								></textarea>
							</div>

							<div class="grid gap-1.5">
								<Label for="edit-citation-reference">Reference citation</Label>
								<textarea
									id="edit-citation-reference"
									name="referenceCitation"
									required
									rows="4"
									class="border-input data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3"
									bind:value={editReferenceCitation}
								></textarea>
							</div>

							<div class="grid gap-1.5">
								<Label for="edit-citation-note">Note (optional)</Label>
								<textarea
									id="edit-citation-note"
									name="note"
									rows="2"
									class="border-input data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3"
									bind:value={editNote}
								></textarea>
							</div>

							<div class="flex items-center gap-2">
								<Button type="submit" size="sm">Save</Button>
								<Button type="button" size="sm" variant="outline" onclick={closeCitationEditor}>
									Cancel
								</Button>
							</div>
						</form>
					</section>
				</div>
			</div>
		{/if}

		{#if isCitationComposerOpen}
			<div
				class="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm"
				role="dialog"
				tabindex="-1"
				aria-modal="true"
				aria-label="Add citations"
				onclick={(event) => {
					if (event.target === event.currentTarget) {
						closeCitationDialog();
					}
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape') {
						closeCitationDialog();
					}
				}}
				in:fade={{ duration: 140 }}
				out:fade={{ duration: 120 }}
			>
				<div class="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center p-4 sm:p-6 lg:p-8">
					<section
						class="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-4 shadow-2xl sm:p-5"
						in:scale={{ duration: 160, start: 0.96 }}
						out:scale={{ duration: 120, start: 0.96 }}
					>
						<div class="mb-4 flex items-center justify-between gap-3">
							<div>
								<p class="font-heading text-lg font-semibold tracking-tight">Add citations</p>
								<p class="text-sm text-muted-foreground">Paste one source per line and generate.</p>
							</div>
							<Button type="button" variant="ghost" size="sm" onclick={closeCitationDialog}>Close</Button>
						</div>

						<form
							class="grid gap-2"
							method="post"
							action="?/addCitations"
							use:enhance={({ formData, cancel }) => {
								const citationLinesRaw = String(formData.get('citationLines') ?? '');
								const sourceLines = citationLinesRaw
									.split(/\r?\n/)
									.map((item) => item.trim())
									.filter(Boolean);

								if (sourceLines.length === 0) {
									cancel();
									toast.error('Paste at least one citation source line.');
									return;
								}

								const createdAt = new Date().toISOString();
								const pendingRows: CitationRow[] = sourceLines.map((line, index): CitationRow => ({
									id: `pending-${Date.now()}-${index}`,
									rawText: line,
									sourceName: line,
									sourceType: 'processing',
									inTextCitation: '',
									referenceCitation: '',
									style: styleValue,
									note: null,
									createdAt,
									isGenerating: true
								}));
								const pendingIds = new Set(pendingRows.map((row) => String(row.id)));

								citations = [...pendingRows, ...citations];
								const announceId = toast.loading(
									`Generating ${sourceLines.length} citation${sourceLines.length === 1 ? '' : 's'}...`
								);

								return async ({ result }) => {
									const clearPendingRows = () => {
										citations = citations.filter((row) => !pendingIds.has(String(row.id)));
									};

									if (result.type === 'success') {
										updateCitationQuotaFromAction(result.data);
										const payload = asRecord(result.data);
										const generated = mapGeneratedCitations(payload?.generatedCitations);
										const retryCount = getNumber(payload?.semanticScholarRetryCount);
										clearPendingRows();
										citations = [...generated, ...citations];
										citationLinesInput = '';
										isCitationComposerOpen = false;

										if (retryCount > 0) {
											toast.warning(
												`Semantic Scholar request failed ${retryCount} time${retryCount === 1 ? '' : 's'} and was auto-retried (max 3 attempts).`
											);
										}

										toast.success(
											getMessage(
												result.data,
												`Generated ${generated.length} citation${generated.length === 1 ? '' : 's'}.`
											),
											{ id: announceId }
										);
										return;
									}

									clearPendingRows();

									if (result.type === 'failure') {
										updateCitationQuotaFromAction(result.data);
										toast.error(getMessage(result.data, 'Citation generation failed.'), {
											id: announceId
										});
										return;
									}

									toast.error('Citation generation failed unexpectedly.', { id: announceId });
									await applyAction(result);
								};
							}}
						>
							<Label for="citation-lines">Paste citation source lines</Label>
							<textarea
								id="citation-lines"
								name="citationLines"
								rows="8"
								placeholder="One source per line"
								class="border-input data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3"
								bind:value={citationLinesInput}
							></textarea>
							<div class="flex items-center gap-2">
								<Button type="submit">Save</Button>
								<Button type="button" variant="outline" onclick={closeCitationDialog}>Cancel</Button>
							</div>
						</form>
					</section>
				</div>
			</div>
		{/if}
	</main>
</div>
