import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extractBookClues,
	extractGoogleBooksId,
	normalizeUrl,
	resolveBookFromUrl,
	searchOpenLibraryFallback
} from './bookResolver.ts';

type FetchHandler = (url: URL) => Promise<Response> | Response;

const createFetchMock = (handler: FetchHandler): typeof fetch => {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		void init;
		const raw =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		return handler(new URL(raw));
	}) as typeof fetch;
};

const htmlResponse = (html: string, status = 200): Response =>
	new Response(html, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

const jsonResponse = (payload: unknown, status = 200): Response =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

test('extract clues from URL with ISBN in metadata', () => {
	const urlInfo = normalizeUrl(' https://example.com/books/the-c-programming-language?utm_source=ad ');
	const html = `
		<html>
			<head>
				<title>The C Programming Language</title>
				<meta name="citation_isbn" content="978-0131103627" />
				<meta name="author" content="Brian W. Kernighan" />
			</head>
		</html>
	`;

	const clues = extractBookClues(urlInfo, html);
	assert.equal(clues.isbn13, '9780131103627');
	assert.ok((clues.confidence ?? 0) >= 0.2);
	assert.ok((clues.clues ?? []).some((entry) => entry.toLowerCase().includes('isbn')));
});

test('publisher page with schema.org Book strongly increases confidence', () => {
	const urlInfo = normalizeUrl('https://publisher.example.com/books/clean-code');
	const html = `
		<html>
			<head>
				<script type="application/ld+json">
					{
						"@context": "https://schema.org",
						"@type": "Book",
						"name": "Clean Code",
						"author": [{ "name": "Robert C. Martin" }],
						"publisher": { "name": "Prentice Hall" },
						"datePublished": "2008-08-01",
						"isbn": "9780132350884"
					}
				</script>
			</head>
		</html>
	`;

	const clues = extractBookClues(urlInfo, html);
	assert.equal(clues.title, 'Clean Code');
	assert.equal(clues.isbn13, '9780132350884');
	assert.ok(clues.confidence >= 0.6);
	assert.ok(clues.clues.some((entry) => entry.toLowerCase().includes('schema.org book')));
});

test('google books URL exposes volume id clue', () => {
	const googleId = extractGoogleBooksId('https://books.google.com/books?id=8X8mAQAAQBAJ&pg=PA1');
	assert.equal(googleId, '8X8mAQAAQBAJ');
});

test('store page with title and author resolves via Google Books title-author', async () => {
	const pageHtml = `
		<html>
			<head>
				<title>The Pragmatic Programmer</title>
				<meta property="og:title" content="The Pragmatic Programmer" />
				<meta name="author" content="Andy Hunt, Dave Thomas" />
			</head>
		</html>
	`;

	const fetchMock = createFetchMock((url) => {
		if (url.hostname === 'store.example.com') {
			return htmlResponse(pageHtml);
		}

		if (url.hostname === 'www.googleapis.com' && url.pathname === '/books/v1/volumes') {
			return jsonResponse({
				items: [
					{
						id: 'GB-PRAGMATIC-1',
						selfLink: 'https://www.googleapis.com/books/v1/volumes/GB-PRAGMATIC-1',
						volumeInfo: {
							title: 'The Pragmatic Programmer',
							authors: ['Andrew Hunt', 'David Thomas'],
							publisher: 'Addison-Wesley',
							publishedDate: '1999-10-30',
							industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780201616224' }],
							printType: 'BOOK',
							canonicalVolumeLink: 'https://books.google.com/books?id=GB-PRAGMATIC-1'
						}
					}
				]
			});
		}

		if (url.hostname === 'openlibrary.org') {
			return jsonResponse({ docs: [] });
		}

		return jsonResponse({}, 404);
	});

	const result = await resolveBookFromUrl('https://store.example.com/pragmatic-programmer', {
		fetchImpl: fetchMock,
		fallbackToOpenLibrary: true
	});

	assert.equal(result.found, true);
	assert.equal(result.provider, 'googleBooks');
	assert.equal(result.sourceType, 'book');
	assert.ok(result.method === 'title-author' || result.method === 'title-only');
	assert.equal(result.metadata.title, 'The Pragmatic Programmer');
});

test('bad URL with no book signals returns found=false', async () => {
	const fetchMock = createFetchMock((url) => {
		if (url.hostname === 'example.com') {
			return htmlResponse('<html><head><title>Company Careers</title></head><body>Jobs</body></html>');
		}
		return jsonResponse({ items: [] });
	});

	const result = await resolveBookFromUrl('https://example.com/careers', {
		fetchImpl: fetchMock,
		fallbackToOpenLibrary: true
	});

	assert.equal(result.found, false);
	assert.equal(result.provider, 'none');
	assert.equal(result.sourceType, 'unknown');
});

test('google succeeds while open library fallback has no match', async () => {
	const pageHtml = `
		<html>
			<head>
				<meta name="citation_isbn" content="9780132350884" />
				<title>Clean Code</title>
			</head>
		</html>
	`;

	const fetchMock = createFetchMock((url) => {
		if (url.hostname === 'bookshop.example.com') {
			return htmlResponse(pageHtml);
		}

		if (url.hostname === 'www.googleapis.com' && url.pathname === '/books/v1/volumes') {
			return jsonResponse({
				items: [
					{
						id: 'GB-CLEANCODE-1',
						volumeInfo: {
							title: 'Clean Code',
							authors: ['Robert C. Martin'],
							publisher: 'Prentice Hall',
							publishedDate: '2008-08-01',
							industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780132350884' }],
							printType: 'BOOK'
						}
					}
				]
			});
		}

		if (url.hostname === 'openlibrary.org') {
			return jsonResponse({}, 404);
		}

		return jsonResponse({}, 404);
	});

	const result = await resolveBookFromUrl('https://bookshop.example.com/clean-code', {
		fetchImpl: fetchMock,
		fallbackToOpenLibrary: true
	});

	assert.equal(result.found, true);
	assert.equal(result.provider, 'googleBooks');

	const fallback = await searchOpenLibraryFallback(
		{
			isbn13: '9780132350884',
			title: 'Clean Code',
			authors: ['Robert C. Martin'],
			confidence: 0.7,
			clues: [],
			warnings: []
		},
		{ fetchImpl: fetchMock }
	);
	assert.equal(fallback.bestMatch, null);
});

test('google fails and open library fallback succeeds', async () => {
	const pageHtml = `
		<html>
			<head>
				<meta name="citation_isbn" content="9781491950296" />
				<title>Designing Data-Intensive Applications</title>
			</head>
		</html>
	`;

	const fetchMock = createFetchMock((url) => {
		if (url.hostname === 'publisher.example.com') {
			return htmlResponse(pageHtml);
		}

		if (url.hostname === 'www.googleapis.com' && url.pathname === '/books/v1/volumes') {
			return jsonResponse({ items: [] });
		}

		if (url.hostname === 'openlibrary.org' && url.pathname === '/api/books') {
			return jsonResponse({
				'ISBN:9781491950296': {
					title: 'Designing Data-Intensive Applications',
					authors: [{ name: 'Martin Kleppmann' }],
					publishers: [{ name: "O'Reilly Media" }],
					publish_date: '2017',
					identifiers: {
						isbn_13: ['9781491950296']
					},
					url: '/books/OL12345M/Designing_Data-Intensive_Applications'
				}
			});
		}

		return jsonResponse({}, 404);
	});

	const result = await resolveBookFromUrl('https://publisher.example.com/ddia', {
		fetchImpl: fetchMock,
		fallbackToOpenLibrary: true
	});

	assert.equal(result.found, true);
	assert.equal(result.provider, 'openLibrary');
	assert.equal(result.method, 'fallback');
	assert.equal(result.metadata.title, 'Designing Data-Intensive Applications');
});
