<script lang="ts">
	import { PinInput as InputOTPPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		cell,
		class: className,
		...restProps
	}: InputOTPPrimitive.CellProps = $props();
</script>

<InputOTPPrimitive.Cell
	{cell}
	bind:ref
	data-slot="input-otp-slot"
	class={cn(
		'relative flex size-11 items-center justify-center rounded-md border border-input bg-background/70 text-base font-semibold shadow-xs transition-all data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-ring/50 data-[active=true]:ring-3 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:ring-3',
		className
	)}
	{...restProps}
>
	{cell.char}
	{#if cell.hasFakeCaret}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div class="bg-foreground h-4 w-px"></div>
		</div>
	{/if}
</InputOTPPrimitive.Cell>
