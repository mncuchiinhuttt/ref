<script lang="ts">
	import { Mail } from '@lucide/svelte';

	const copyrightYear = new Date().getFullYear();
	const githubProfileUrl = 'https://github.com/mncuchiinhuttt';
	const linkedInUrl = 'https://www.linkedin.com/in/mncuchiinhuttt/';
	const emailUrl = 'mailto:vominhlong@mncuchiinhuttt.dev';
	const projectRepositoryUrl = 'https://github.com/mncuchiinhuttt/ref';
</script>

<footer class="border-t border-border/60 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--color-background)_96%,var(--color-amber-100)_4%)_0%,var(--color-background)_100%)]">
	<div class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
		<div class="flex flex-wrap items-center gap-3">
			<p class="text-sm text-muted-foreground">Copyright © {copyrightYear} by mncuchiinhuttt.</p>
			<div class="flex items-center gap-1">
				<a
					href={githubProfileUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="GitHub"
				>
					<svg viewBox="0 0 24 24" class="size-4" aria-hidden="true" fill="currentColor">
						<path d="M12 0.296C5.373 0.296 0 5.67 0 12.296c0 5.302 3.438 9.8 8.206 11.387 0.6 0.111 0.82-0.261 0.82-0.579 0-0.286-0.01-1.044-0.016-2.05-3.338 0.726-4.042-1.609-4.042-1.609-0.546-1.387-1.333-1.756-1.333-1.756-1.09-0.745 0.082-0.729 0.082-0.729 1.206 0.085 1.84 1.239 1.84 1.239 1.072 1.836 2.81 1.306 3.495 0.999 0.108-0.776 0.419-1.306 0.761-1.606-2.665-0.303-5.466-1.333-5.466-5.93 0-1.31 0.468-2.382 1.236-3.222-0.124-0.303-0.536-1.524 0.117-3.176 0 0 1.008-0.323 3.301 1.23a11.51 11.51 0 0 1 6.01 0c2.292-1.553 3.298-1.23 3.298-1.23 0.655 1.652 0.243 2.873 0.119 3.176 0.77 0.84 1.235 1.912 1.235 3.222 0 4.609-2.805 5.623-5.478 5.92 0.43 0.371 0.814 1.103 0.814 2.222 0 1.604-0.015 2.896-0.015 3.289 0 0.321 0.216 0.694 0.825 0.576C20.565 22.091 24 17.595 24 12.296 24 5.67 18.627 0.296 12 0.296z" />
					</svg>
				</a>
				<a
					href={linkedInUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="LinkedIn"
				>
					<svg viewBox="0 0 24 24" class="size-4" aria-hidden="true" fill="currentColor">
						<path d="M20.447 20.452h-3.554v-5.569c0-1.328-0.028-3.037-1.851-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.352V9h3.414v1.561h0.049c0.476-0.9 1.637-1.849 3.369-1.849 3.601 0 4.266 2.37 4.266 5.455v6.285zM5.337 7.433c-1.144 0-2.063-0.926-2.063-2.065 0-1.14 0.919-2.064 2.063-2.064 1.14 0 2.064 0.924 2.064 2.064 0 1.139-0.924 2.065-2.064 2.065zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C0.792 0 0 0.774 0 1.729v20.542C0 23.227 0.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 0.774 23.2 0 22.222 0h0.003z" />
					</svg>
				</a>
				<a
					href={emailUrl}
					class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Email"
				>
					<Mail class="size-4" />
				</a>
			</div>
		</div>

		<a
			href={projectRepositoryUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="group inline-flex items-center justify-center gap-2 self-start rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted lg:self-auto"
			aria-label="Open project repository"
		>
			<svg
				viewBox="0 0 24 24"
				class="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
				aria-hidden="true"
				fill="currentColor"
			>
				<path d="M12 0.296C5.373 0.296 0 5.67 0 12.296c0 5.302 3.438 9.8 8.206 11.387 0.6 0.111 0.82-0.261 0.82-0.579 0-0.286-0.01-1.044-0.016-2.05-3.338 0.726-4.042-1.609-4.042-1.609-0.546-1.387-1.333-1.756-1.333-1.756-1.09-0.745 0.082-0.729 0.082-0.729 1.206 0.085 1.84 1.239 1.84 1.239 1.072 1.836 2.81 1.306 3.495 0.999 0.108-0.776 0.419-1.306 0.761-1.606-2.665-0.303-5.466-1.333-5.466-5.93 0-1.31 0.468-2.382 1.236-3.222-0.124-0.303-0.536-1.524 0.117-3.176 0 0 1.008-0.323 3.301 1.23a11.51 11.51 0 0 1 6.01 0c2.292-1.553 3.298-1.23 3.298-1.23 0.655 1.652 0.243 2.873 0.119 3.176 0.77 0.84 1.235 1.912 1.235 3.222 0 4.609-2.805 5.623-5.478 5.92 0.43 0.371 0.814 1.103 0.814 2.222 0 1.604-0.015 2.896-0.015 3.289 0 0.321 0.216 0.694 0.825 0.576C20.565 22.091 24 17.595 24 12.296 24 5.67 18.627 0.296 12 0.296z" />
			</svg>
			<span class="font-heading tracking-tight">mncuchiinhuttt/ref</span>
		</a>
	</div>
</footer>
