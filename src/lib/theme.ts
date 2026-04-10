import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'citation-theme';

export const getSystemTheme = (): Theme => {
	if (!browser) {
		return 'light';
	}

	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getStoredTheme = (): Theme | null => {
	if (!browser) {
		return null;
	}

	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	return stored === 'dark' || stored === 'light' ? stored : null;
};

export const getInitialTheme = (): Theme => {
	return getStoredTheme() ?? getSystemTheme();
};

export const applyTheme = (theme: Theme): void => {
	if (!browser) {
		return;
	}

	document.documentElement.classList.toggle('dark', theme === 'dark');
	document.documentElement.style.colorScheme = theme;
	window.localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export const toggleTheme = (current: Theme): Theme => {
	const next = current === 'dark' ? 'light' : 'dark';
	applyTheme(next);
	return next;
};
