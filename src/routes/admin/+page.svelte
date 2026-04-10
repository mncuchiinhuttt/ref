<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import SiteHeader from '$lib/components/common/site-header.svelte';
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
	import { ChartContainer, ChartTooltip, type ChartConfig } from '$lib/components/ui/chart';
	import { AreaChart } from 'layerchart';

	let { data, form } = $props();

	const toPercent = (value: number, max: number): number => {
		if (max <= 0) {
			return 0;
		}

		return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
	};

	const seriesMax = (series: Array<{ value: number }>): number => {
		if (series.length === 0) {
			return 0;
		}

		return Math.max(...series.map((entry) => entry.value));
	};

	type DailySeriesEntry = { label: string; value: number };
	type GenerationChartDatum = { date: string; citations: number };

	const formatShortDateLabel = (isoDate: string): string => {
		const parsed = new Date(`${isoDate}T00:00:00Z`);
		if (Number.isNaN(parsed.getTime())) {
			return isoDate;
		}

		return parsed.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	};

	const generationChartConfig = {
		citations: {
			label: 'Citations',
			color: 'hsl(var(--primary))'
		}
	} satisfies ChartConfig;

	const generationChartData = $derived(
		data.weeklyGenerationSeries.map((entry): GenerationChartDatum => ({
			date: entry.label,
			citations: entry.value
		}))
	);

	const generationChartSeries = [
		{
			key: 'citations',
			label: 'Citations',
			value: (entry: GenerationChartDatum): number => entry.citations,
			color: 'var(--color-citations)'
		}
	];

	const generationChartPeak = $derived(
		generationChartData.reduce((peak, entry) => Math.max(peak, entry.citations), 0)
	);
	const generationChartTotal = $derived(
		generationChartData.reduce((total, entry) => total + entry.citations, 0)
	);
	const generationChartStartLabel = $derived(generationChartData[0]?.date ?? '');
	const generationChartEndLabel = $derived(
		generationChartData.at(-1)?.date ?? generationChartStartLabel
	);
	const generationChartYMax = $derived(Math.max(1, generationChartPeak));

	const formatTooltipDateLabel = (value: unknown): string => {
		if (typeof value !== 'string') {
			return String(value ?? '');
		}

		return formatShortDateLabel(value);
	};

	const shortDateTime = (isoValue: string | null): string => {
		if (!isoValue) {
			return '-';
		}

		return new Date(isoValue).toLocaleString();
	};

	const getMessage = (fallback: string): string => {
		if (form && 'message' in form && typeof form.message === 'string' && form.message.trim()) {
			return form.message;
		}
		return fallback;
	};
</script>

<div class="min-h-dvh bg-linear-to-b from-background via-background to-muted/20">
	<SiteHeader
		showAuthCta={false}
		showDashboardCta={true}
		showSignOutCta={true}
		signOutAction="?/signOut"
		subtitle="Admin control panel"
	/>

	<main class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
		<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<Card class="border-border/60 bg-card/85">
				<CardHeader>
					<CardTitle>Total users</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-3xl font-semibold">{data.metrics.totalUsers}</p>
					<p class="text-xs text-muted-foreground">Admins: {data.metrics.totalAdmins}</p>
				</CardContent>
			</Card>
			<Card class="border-border/60 bg-card/85">
				<CardHeader>
					<CardTitle>Projects & citations</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-3xl font-semibold">{data.metrics.totalProjects}</p>
					<p class="text-xs text-muted-foreground">Citations: {data.metrics.totalCitations}</p>
				</CardContent>
			</Card>
			<Card class="border-border/60 bg-card/85">
				<CardHeader>
					<CardTitle>Queue status</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-3xl font-semibold">{data.metrics.pendingRequestCount}</p>
					<p class="text-xs text-muted-foreground">
						Onboarding completed: {data.metrics.onboardingCompletedCount}
					</p>
				</CardContent>
			</Card>
		</section>

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">Citation Generation by Date</CardTitle>
				<CardDescription>Last 30 days of generated citation volume by date.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.weeklyGenerationSeries.length === 0}
					<p class="text-sm text-muted-foreground">No generation events yet.</p>
				{:else}
						<div class="grid gap-3">
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span>{formatShortDateLabel(generationChartStartLabel)}</span>
								<span>Peak/day: {generationChartPeak}</span>
								<span>{formatShortDateLabel(generationChartEndLabel)}</span>
							</div>
							<div class="rounded-xl border border-border/60 bg-background/40 p-3">
								<ChartContainer config={generationChartConfig} class="w-full" aria-label="Citation generation trend for the last 30 days">
									<AreaChart
										data={generationChartData}
										x="date"
										series={generationChartSeries}
										yDomain={[0, generationChartYMax]}
										axis="y"
										legend={false}
										points={false}
									>
										{#snippet tooltip()}
											<ChartTooltip indicator="line" labelFormatter={formatTooltipDateLabel} />
										{/snippet}
									</AreaChart>
								</ChartContainer>
							</div>
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span>Total (30 days): {generationChartTotal}</span>
								<span>Daily generation trend</span>
							</div>
						</div>
				{/if}
			</CardContent>
		</Card>

		<section class="grid gap-4 lg:grid-cols-4">
			<Card class="border-border/60 bg-card/80 lg:col-span-1">
				<CardHeader>
					<CardTitle>Onboarding</CardTitle>
				</CardHeader>
				<CardContent class="grid gap-2">
					{@const maxOnboarding = seriesMax(data.onboardingSummary)}
					{#each data.onboardingSummary as item (item.label)}
						<div class="grid gap-1">
							<div class="flex items-center justify-between text-xs">
								<span>{item.label}</span>
								<span>{item.value}</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full rounded-full bg-emerald-500" style={`width: ${toPercent(item.value, maxOnboarding)}%;`}></div>
							</div>
						</div>
					{/each}
				</CardContent>
			</Card>

			<Card class="border-border/60 bg-card/80 lg:col-span-1">
				<CardHeader>
					<CardTitle>Academic Roles</CardTitle>
				</CardHeader>
				<CardContent class="grid gap-2">
					{@const maxRoles = seriesMax(data.academicRoleSummary)}
					{#each data.academicRoleSummary as item (item.label)}
						<div class="grid gap-1">
							<div class="flex items-center justify-between text-xs">
								<span>{item.label}</span>
								<span>{item.value}</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full rounded-full bg-blue-500" style={`width: ${toPercent(item.value, maxRoles)}%;`}></div>
							</div>
						</div>
					{/each}
				</CardContent>
			</Card>

			<Card class="border-border/60 bg-card/80 lg:col-span-1">
				<CardHeader>
					<CardTitle>Discovery Sources</CardTitle>
				</CardHeader>
				<CardContent class="grid gap-2">
					{@const maxDiscovery = seriesMax(data.discoverySummary)}
					{#each data.discoverySummary as item (item.label)}
						<div class="grid gap-1">
							<div class="flex items-center justify-between text-xs">
								<span>{item.label}</span>
								<span>{item.value}</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full rounded-full bg-violet-500" style={`width: ${toPercent(item.value, maxDiscovery)}%;`}></div>
							</div>
						</div>
					{/each}
				</CardContent>
			</Card>

			<Card class="border-border/60 bg-card/80 lg:col-span-1">
				<CardHeader>
					<CardTitle>RMIT Distribution</CardTitle>
				</CardHeader>
				<CardContent class="grid gap-2">
					{@const maxRmit = seriesMax(data.rmitSummary)}
					{#each data.rmitSummary as item (item.label)}
						<div class="grid gap-1">
							<div class="flex items-center justify-between text-xs">
								<span>{item.label}</span>
								<span>{item.value}</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full rounded-full bg-amber-500" style={`width: ${toPercent(item.value, maxRmit)}%;`}></div>
							</div>
						</div>
					{/each}
				</CardContent>
			</Card>
		</section>

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">Citation Expansion Requests</CardTitle>
				<CardDescription>Review and process weekly quota expansion requests.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3">
				{#if data.expansionRequests.length === 0}
					<p class="text-sm text-muted-foreground">No expansion requests found.</p>
				{:else}
					<div class="overflow-x-auto rounded-xl border border-border/60">
						<table class="min-w-full text-sm">
							<thead class="bg-muted/50">
								<tr>
									<th class="px-3 py-2 text-left font-medium">User</th>
									<th class="px-3 py-2 text-left font-medium">Request</th>
									<th class="px-3 py-2 text-left font-medium">Status</th>
									<th class="px-3 py-2 text-left font-medium">Reason</th>
									<th class="px-3 py-2 text-left font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each data.expansionRequests as request (request.id)}
									<tr class="border-t border-border/60 align-top">
										<td class="px-3 py-2">
											<p class="font-medium">{request.userName}</p>
											<p class="text-xs text-muted-foreground">{request.userEmail}</p>
										</td>
										<td class="px-3 py-2 text-xs text-muted-foreground">
											<p>{request.requestedWeeks} week(s)</p>
											<p>+{request.additionalPerWeek}/week</p>
											<p>Requested: {shortDateTime(request.requestedAt)}</p>
										</td>
										<td class="px-3 py-2">
											<Badge variant={request.status === 'pending' ? 'secondary' : request.status === 'approved' ? 'default' : 'outline'}>
												{request.status}
											</Badge>
											{#if request.reviewedAt}
												<p class="mt-1 text-xs text-muted-foreground">Reviewed: {shortDateTime(request.reviewedAt)}</p>
											{/if}
										</td>
										<td class="px-3 py-2 text-xs text-muted-foreground">
											{request.reason || '-'}
										</td>
										<td class="px-3 py-2">
											{#if request.status === 'pending'}
												<form
													class="grid gap-2"
													method="post"
													action="?/approveExpansionRequest"
													use:enhance={({ action }) => {
														const isReject = String(action).includes('rejectExpansionRequest');

														return async ({ result, update }) => {
															if (result.type === 'success') {
																toast.success(getMessage(isReject ? 'Request rejected.' : 'Request approved.'));
																await update();
																return;
															}
															if (result.type === 'failure') {
																toast.error(getMessage(isReject ? 'Unable to reject request.' : 'Unable to approve request.'));
																return;
															}
														};
													}}
												>
													<input type="hidden" name="requestId" value={request.id} />
													<Input name="adminNote" placeholder="Admin note (optional)" />
													<div class="flex items-center gap-2">
														<Button type="submit" size="sm">Approve</Button>
														<Button type="submit" size="sm" variant="outline" formaction="?/rejectExpansionRequest">
															Reject
														</Button>
													</div>
												</form>
											{:else}
												<p class="text-xs text-muted-foreground">{request.adminNote || '-'}</p>
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

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">User Management</CardTitle>
				<CardDescription>Change user role and inspect onboarding attributes.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="overflow-x-auto rounded-xl border border-border/60">
					<table class="min-w-full text-sm">
						<thead class="bg-muted/50">
							<tr>
								<th class="px-3 py-2 text-left font-medium">User</th>
								<th class="px-3 py-2 text-left font-medium">Usage</th>
								<th class="px-3 py-2 text-left font-medium">Onboarding</th>
								<th class="px-3 py-2 text-left font-medium">Role</th>
							</tr>
						</thead>
						<tbody>
							{#each data.users as user (user.id)}
								<tr class="border-t border-border/60 align-top">
									<td class="px-3 py-2">
										<p class="font-medium">{user.name}</p>
										<p class="text-xs text-muted-foreground">{user.email}</p>
										<p class="text-xs text-muted-foreground">Joined: {shortDateTime(user.createdAt)}</p>
									</td>
									<td class="px-3 py-2 text-xs text-muted-foreground">
										<p>Projects: {user.projectCount}</p>
										<p>Citations: {user.citationCount}</p>
									</td>
									<td class="px-3 py-2 text-xs text-muted-foreground">
										<p>{user.onboardingCompleted ? 'Completed' : 'Not completed'}</p>
										<p>Role: {user.academicRole || 'Unspecified'}</p>
										<p>{user.isFromRmit ? 'RMIT' : 'Non-RMIT'}</p>
										<p>Discovery: {user.discoverySource || 'Unspecified'}</p>
									</td>
									<td class="px-3 py-2">
										<form
											class="flex items-center gap-2"
											method="post"
											action="?/updateUserRole"
											use:enhance={() => {
												return async ({ result, update }) => {
													if (result.type === 'success') {
														toast.success(getMessage('Role updated.'));
														await update();
														return;
													}
													if (result.type === 'failure') {
														toast.error(getMessage('Unable to update role.'));
														return;
													}
												};
											}}
										>
											<input type="hidden" name="userId" value={user.id} />
											<select
												name="role"
												class="border-input rounded-md border bg-transparent px-2 py-1 text-sm"
											>
												<option value="user" selected={user.role === 'user'}>user</option>
												<option value="admin" selected={user.role === 'admin'}>admin</option>
											</select>
											<Button type="submit" size="sm" variant="outline">Save</Button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	</main>
</div>
