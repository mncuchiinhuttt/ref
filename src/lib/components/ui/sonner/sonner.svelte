<script lang="ts">
	import { Toaster as Sonner } from 'svelte-sonner';
	import type { ToasterProps } from 'svelte-sonner';

	let { ...props }: ToasterProps = $props();
</script>

<Sonner {...props} />