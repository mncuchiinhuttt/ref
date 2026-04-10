<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
	import { toast } from 'svelte-sonner';
	import { fade, scale } from 'svelte/transition';

	type DashboardProject = {
		id: number;
		name: string;
		citationStyle: string;
		citationCount: number;
		isOwner: boolean;
		owner: {
			id: string;
			name: string;
			displayUsername: string | null;
			username: string | null;
		};
		updatedAt: string;
	};

	type DashboardInvitation = {
		id: number;
		projectId: number;
		projectName: string;
		inviter: {
			id: string;
			name: string;
			displayUsername: string | null;
			username: string | null;
			image: string | null;
		};
		createdAt: string;
	};

	type DashboardData = {
		rmitBonusApplied: boolean;
		user: {
			id: string;
			email: string;
			name: string;
			image?: string | null;
			username?: string | null;
			displayUsername?: string | null;
			role?: 'user' | 'admin';
			isFromRmit?: boolean;
		};
		citationQuota: {
			isLimited: boolean;
			weeklyLimit: number | null;
			usedThisWeek: number;
			remainingThisWeek: number | null;
			weekStartIso: string;
			weekEndIso: string;
			pendingRequestCount: number;
		};
		projects: DashboardProject[];
		invitations: DashboardInvitation[];
	};

	type DashboardFormState = {
		formName?: string;
		message?: string;
		accountSuccess?: boolean;
		accountMessage?: string;
		accountName?: string;
		accountDisplayUsername?: string;
		accountUsername?: string;
		expansionSuccess?: boolean;
		expansionMessage?: string;
	};

	let { data, form }: { data: DashboardData; form?: DashboardFormState } = $props();
	let isRmitBonusDialogOpen = $state(false);
	let isSettingsDialogOpen = $state(false);
	let isEditingAccount = $state(false);

	$effect(() => {
		if (data.rmitBonusApplied) {
			isRmitBonusDialogOpen = true;
		}
	});

	const isAccountFormState = $derived(form?.formName === 'updateAccount');
	const accountNameInput = $derived(
		isAccountFormState ? (form?.accountName ?? data.user.name) : data.user.name
	);
	const accountDisplayUsernameInput = $derived(
		isAccountFormState
			? (form?.accountDisplayUsername ?? (data.user.displayUsername ?? ''))
			: (data.user.displayUsername ?? '')
	);
	const accountUsernameInput = $derived(
		isAccountFormState ? (form?.accountUsername ?? (data.user.username ?? '')) : (data.user.username ?? '')
	);

	const asRecord = (value: unknown): Record<string, unknown> | null => {
		if (value && typeof value === 'object') {
			return value as Record<string, unknown>;
		}

		return null;
	};

	const getMessage = (value: unknown, fallback: string): string => {
		const record = asRecord(value);
		const message = record?.message;

		if (typeof message === 'string' && message.trim()) {
			return message;
		}

		const accountMessage = record?.accountMessage;
		if (typeof accountMessage === 'string' && accountMessage.trim()) {
			return accountMessage;
		}

		const expansionMessage = record?.expansionMessage;
		if (typeof expansionMessage === 'string' && expansionMessage.trim()) {
			return expansionMessage;
		}

		return fallback;
	};

	const openSettingsDialog = (): void => {
		isSettingsDialogOpen = true;
		isEditingAccount = false;
	};

	const closeRmitBonusDialog = (): void => {
		isRmitBonusDialogOpen = false;
	};

	const closeSettingsDialog = (): void => {
		isSettingsDialogOpen = false;
		isEditingAccount = false;
	};

	const toDisplayValue = (value: string | null | undefined): string => {
		const normalized = value?.trim();
		return normalized && normalized.length > 0 ? normalized : 'Not set';
	};

	const inviterInitials = (name: string): string =>
		name
			.split(' ')
			.map((part) => part.slice(0, 1).toUpperCase())
			.slice(0, 2)
			.join('');

	const formatShortDate = (isoValue: string): string =>
		new Date(isoValue).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});

	const quotaUsedPercent = $derived(
		data.citationQuota.isLimited && data.citationQuota.weeklyLimit
			? Math.min(100, Math.round((data.citationQuota.usedThisWeek / data.citationQuota.weeklyLimit) * 100))
			: 0
	);
</script>

<div class="min-h-dvh bg-linear-to-b from-background via-background to-muted/20">
	<SiteHeader
		showAuthCta={false}
		showDashboardCta={false}
		showSignOutCta={true}
		signOutAction="?/signOut"
		subtitle="Projects"
	/>

	<main class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
		<section class="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/85 p-5 shadow-sm">
			<div>
				<p class="font-heading text-2xl font-semibold tracking-tight">Projects</p>
				<p class="text-sm text-muted-foreground">Open a project to manage citations and collaborators.</p>
			</div>
			<div class="flex items-center gap-2">
				{#if data.user.role === 'admin'}
					<Button href="/admin" variant="outline" size="sm">Admin panel</Button>
				{/if}
				<form
					method="post"
					action="?/createProject"
					use:enhance={() => {
						return async ({ result }) => {
							if (result.type === 'failure') {
								toast.error(getMessage(result.data, 'Unable to create project.'));
							}

							await applyAction(result);
						};
					}}
				>
					<Button type="submit" size="sm">+ New</Button>
				</form>
			</div>
		</section>

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">Weekly Citation Quota</CardTitle>
				<CardDescription>
					Coverage window: {formatShortDate(data.citationQuota.weekStartIso)} - {formatShortDate(data.citationQuota.weekEndIso)}
				</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-4">
				{#if data.citationQuota.isLimited}
					<div class="grid gap-2">
						<div class="flex items-center justify-between text-sm">
							<p class="font-medium">
								{data.citationQuota.usedThisWeek} / {data.citationQuota.weeklyLimit} citations used
								{#if data.user.isFromRmit && data.citationQuota.weeklyLimit === 200}
									<span class="font-normal text-muted-foreground">
										(includes 100 bonus citations for RMIT students 🎉)
									</span>
								{/if}
							</p>
							<p class="text-muted-foreground">{data.citationQuota.remainingThisWeek} remaining</p>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full bg-primary transition-all"
								style={`width: ${quotaUsedPercent}%;`}
							></div>
						</div>
						{#if data.citationQuota.pendingRequestCount > 0}
							<p class="text-xs text-muted-foreground">
								Pending expansion requests: {data.citationQuota.pendingRequestCount}
							</p>
						{/if}
					</div>

					{#if data.user.role === 'user'}
						<form
							class="grid gap-2 rounded-xl border border-border/60 bg-background/50 p-3"
							method="post"
							action="?/requestCitationExpansion"
							use:enhance={() => {
								return async ({ result, update }) => {
									if (result.type === 'success') {
										toast.success(
											getMessage(
												result.data,
												'Citation expansion request submitted for admin review.'
											)
										);
									} else if (result.type === 'failure') {
										toast.error(getMessage(result.data, 'Unable to submit expansion request.'));
									}

									await update();
								};
							}}
						>
							<p class="text-sm font-medium">Request weekly expansion</p>
							<div class="grid gap-2 sm:grid-cols-2">
								<div class="grid gap-1">
									<Label for="quota-request-weeks">Weeks</Label>
									<Input id="quota-request-weeks" name="requestedWeeks" type="number" min="1" max="12" value="1" />
								</div>
								<div class="grid gap-1">
									<Label for="quota-request-extra">Extra per week</Label>
									<Input id="quota-request-extra" name="additionalPerWeek" type="number" min="1" max="1000" value="100" />
								</div>
							</div>
							<div class="grid gap-1">
								<Label for="quota-request-reason">Reason (optional)</Label>
								<textarea
									id="quota-request-reason"
									name="reason"
									rows="2"
									class="border-input data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3"
								></textarea>
							</div>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm">Request expansion</Button>
							</div>
						</form>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">Unlimited citation generation for admin role.</p>
				{/if}
			</CardContent>
		</Card>

		{#if data.invitations.length > 0}
			<Card class="border-border/60 bg-card/80">
				<CardHeader>
					<CardTitle class="font-heading text-xl">Invitations</CardTitle>
					<CardDescription>Projects shared with you are waiting for a response.</CardDescription>
				</CardHeader>
				<CardContent class="grid gap-3">
					{#each data.invitations as invitation (invitation.id)}
						<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="flex items-center gap-3">
								<Avatar size="sm">
									<AvatarImage
										src={invitation.inviter.image ?? undefined}
										alt={`${invitation.inviter.name} avatar`}
									/>
									<AvatarFallback>{inviterInitials(invitation.inviter.name)}</AvatarFallback>
								</Avatar>
								<div class="grid gap-0.5">
									<p class="font-medium">{invitation.projectName}</p>
									<p class="text-xs text-muted-foreground">
										Invited by {invitation.inviter.displayUsername || invitation.inviter.name}
										{#if invitation.inviter.username}
											(@{invitation.inviter.username})
										{/if}
									</p>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<form
									method="post"
									action="?/acceptInvitation"
									use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'failure') {
												toast.error(getMessage(result.data, 'Unable to accept invitation.'));
											}

											await applyAction(result);
										};
									}}
								>
									<input type="hidden" name="invitationId" value={invitation.id} />
									<Button type="submit" size="sm">Accept</Button>
								</form>
								<form
									method="post"
									action="?/rejectInvitation"
									use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'failure') {
												toast.error(getMessage(result.data, 'Unable to reject invitation.'));
											}

											await applyAction(result);
										};
									}}
								>
									<input type="hidden" name="invitationId" value={invitation.id} />
									<Button type="submit" variant="outline" size="sm">Reject</Button>
								</form>
							</div>
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}

		<Card class="border-border/60 bg-card/80">
			<CardHeader>
				<CardTitle class="font-heading text-xl">Your Project List</CardTitle>
				<CardDescription>Choose a project to open its workspace.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3">
				{#if data.projects.length === 0}
					<div class="rounded-xl border border-dashed border-border/70 bg-background/50 p-6 text-sm text-muted-foreground">
						No projects yet. Use the + New button to create your first one.
					</div>
				{:else}
					{#each data.projects as project (project.id)}
						<a
							href={resolve(`/dashboard/projects/${project.id}`)}
							class="rounded-xl border border-border/60 bg-background/50 p-4 transition-colors hover:bg-background"
						>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div class="grid gap-1">
									<p class="font-medium">{project.name}</p>
									<p class="text-xs text-muted-foreground">
										Owned by {project.owner.displayUsername || project.owner.name}
										{#if project.owner.username}
											(@{project.owner.username})
										{/if}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant="outline">{project.citationStyle}</Badge>
									<Badge variant="secondary">{project.citationCount} citations</Badge>
									{#if !project.isOwner}
										<Badge variant="ghost">Collaborator</Badge>
									{/if}
								</div>
							</div>
						</a>
					{/each}
				{/if}
			</CardContent>
		</Card>

		<Card class="border-border/60 bg-card/80">
			<CardHeader class="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle class="font-heading text-xl">Account</CardTitle>
					<CardDescription>View your account details and update profile information.</CardDescription>
				</div>
				<Button type="button" variant="outline" size="sm" onclick={openSettingsDialog}>Settings</Button>
			</CardHeader>
			<CardContent>
				<dl class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1">
						<dt class="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
						<dd class="font-medium">{toDisplayValue(data.user.name)}</dd>
					</div>
					<div class="grid gap-1">
						<dt class="text-xs uppercase tracking-wide text-muted-foreground">Display name</dt>
						<dd class="font-medium">{toDisplayValue(data.user.displayUsername)}</dd>
					</div>
					<div class="grid gap-1">
						<dt class="text-xs uppercase tracking-wide text-muted-foreground">Username</dt>
						<dd class="font-medium">{toDisplayValue(data.user.username)}</dd>
					</div>
					<div class="grid gap-1">
						<dt class="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
						<dd class="font-medium">{data.user.email}</dd>
					</div>
				</dl>
			</CardContent>
		</Card>
	</main>

	{#if isRmitBonusDialogOpen}
		<div
			class="fixed inset-0 z-60 bg-background/65 backdrop-blur-sm"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="RMIT student special program"
			onclick={(event) => {
				if (event.target === event.currentTarget) {
					closeRmitBonusDialog();
				}
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape') {
					closeRmitBonusDialog();
				}
			}}
			in:fade={{ duration: 140 }}
			out:fade={{ duration: 120 }}
		>
			<div class="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center p-4 sm:p-6 lg:p-8">
				<section
					class="w-full max-w-lg rounded-2xl border border-border/60 bg-card p-5 shadow-2xl sm:p-6"
					in:scale={{ duration: 160, start: 0.96 }}
					out:scale={{ duration: 120, start: 0.96 }}
				>
					<div class="mb-3 inline-flex items-center rounded-full border border-amber-300/60 bg-amber-100/70 px-3 py-1 text-xs font-medium text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-200">
						RMIT Student Special Program
					</div>
					<h2 class="font-heading text-2xl font-semibold tracking-tight">Congratulations!</h2>
					<p class="mt-2 text-sm text-muted-foreground sm:text-base">
						You signed up with an RMIT email, so we upgraded your weekly default citation limit from
						<span class="font-semibold text-foreground">100</span> to
						<span class="font-semibold text-foreground">200</span>.
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						Enjoy the extra capacity and keep building your references with your team.
					</p>

					<div class="mt-5 flex items-center justify-end gap-2">
						<Button type="button" size="sm" onclick={closeRmitBonusDialog}>Awesome, thanks</Button>
					</div>
				</section>
			</div>
		</div>
	{/if}

	{#if isSettingsDialogOpen}
		<div
			class="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="Account settings"
			onclick={(event) => {
				if (event.target === event.currentTarget) {
					closeSettingsDialog();
				}
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape') {
					closeSettingsDialog();
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
							<p class="font-heading text-lg font-semibold tracking-tight">Account settings</p>
							<p class="text-sm text-muted-foreground">Manage your profile details.</p>
						</div>
						<Button type="button" variant="ghost" size="sm" onclick={closeSettingsDialog}>Close</Button>
					</div>

					{#if !isEditingAccount}
						<div class="grid gap-4">
							<dl class="grid gap-3 rounded-xl border border-border/60 bg-background/50 p-4">
								<div class="grid gap-1">
									<dt class="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
									<dd class="font-medium">{toDisplayValue(data.user.name)}</dd>
								</div>
								<div class="grid gap-1">
									<dt class="text-xs uppercase tracking-wide text-muted-foreground">Display name</dt>
									<dd class="font-medium">{toDisplayValue(data.user.displayUsername)}</dd>
								</div>
								<div class="grid gap-1">
									<dt class="text-xs uppercase tracking-wide text-muted-foreground">Username</dt>
									<dd class="font-medium">{toDisplayValue(data.user.username)}</dd>
								</div>
								<div class="grid gap-1">
									<dt class="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
									<dd class="font-medium">{data.user.email}</dd>
								</div>
							</dl>
							<div class="flex items-center gap-2">
								<Button type="button" size="sm" onclick={() => (isEditingAccount = true)}>Edit</Button>
								<Button type="button" variant="outline" size="sm" onclick={closeSettingsDialog}>Close</Button>
							</div>
						</div>
					{:else}
						<form
							class="grid gap-3"
							method="post"
							action="?/updateAccount"
							use:enhance={() => {
								return async ({ result, update }) => {
									if (result.type === 'success') {
										toast.success(getMessage(result.data, 'Account updated successfully.'));
										isEditingAccount = false;
									} else if (result.type === 'failure') {
										toast.error(getMessage(result.data, 'Unable to update account.'));
									}

									await update();
								};
							}}
						>
							<div class="grid gap-1.5">
								<Label for="account-name-dialog">Name</Label>
								<Input id="account-name-dialog" name="name" required minlength={2} value={accountNameInput} />
							</div>
							<div class="grid gap-1.5">
								<Label for="account-display-name-dialog">Display name</Label>
								<Input
									id="account-display-name-dialog"
									name="displayUsername"
									required
									minlength={2}
									value={accountDisplayUsernameInput}
								/>
							</div>
							<div class="grid gap-1.5">
								<Label for="account-username-dialog">Username</Label>
								<Input
									id="account-username-dialog"
									name="username"
									required
									pattern={'[a-z0-9_]{3,30}'}
									value={accountUsernameInput}
								/>
								<p class="text-xs text-muted-foreground">3-30 chars: lowercase letters, numbers, underscore.</p>
							</div>
							<div class="grid gap-1.5">
								<Label for="account-email-dialog">Email</Label>
								<Input id="account-email-dialog" value={data.user.email} readonly disabled />
								<p class="text-xs text-muted-foreground">Email cannot be changed here.</p>
							</div>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm">Save</Button>
								<Button type="button" variant="outline" size="sm" onclick={() => (isEditingAccount = false)}>
									Cancel
								</Button>
							</div>
						</form>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</div>
