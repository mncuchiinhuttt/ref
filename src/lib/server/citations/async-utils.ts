export const mapWithConcurrency = async <T, TResult>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> => {
	if (items.length === 0) {
		return [];
	}

	const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TResult>(items.length);
	let cursor = 0;

	await Promise.all(
		Array.from({ length: safeConcurrency }, async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await mapper(items[index], index);
			}
		})
	);

	return results;
};
