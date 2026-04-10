export const ACADEMIC_ROLE_OPTIONS = [
	{ value: 'teacher', label: 'Teacher', emoji: '🧑‍🏫' },
	{ value: 'undergraduate-student', label: 'Undergraduate Student', emoji: '🎓' },
	{ value: 'postgraduate-student', label: 'Postgraduate Student', emoji: '📚' },
	{ value: 'post-doctoral-researcher', label: 'Post-doctoral Researcher', emoji: '🔬' },
	{ value: 'lecturer', label: 'Lecturer', emoji: '📝' },
	{ value: 'research-assistant', label: 'Research Assistant', emoji: '🧪' },
	{ value: 'librarian', label: 'Librarian', emoji: '📖' },
	{ value: 'industry-professional', label: 'Industry Professional', emoji: '💼' },
	{ value: 'other', label: 'Other', emoji: '✨' }
] as const;

export const RMIT_AFFILIATION_OPTIONS = [
	{ value: 'yes', label: 'Yes, I am from RMIT University', emoji: '🏛️' },
	{ value: 'no', label: 'No, I am not from RMIT University', emoji: '🌏' }
] as const;

export const DISCOVERY_SOURCE_OPTIONS = [
	{ value: 'friend-classmate', label: 'Friend or classmate', emoji: '🧑‍🤝‍🧑' },
	{ value: 'teacher-lecturer', label: 'Teacher or lecturer', emoji: '👩‍🏫' },
	{ value: 'rmit-portal', label: 'Social media platforms', emoji: '📲' },
	{ value: 'social-media', label: 'Social media', emoji: '📱' },
	{ value: 'search-engine', label: 'Search engine', emoji: '🔎' },
	{ value: 'research-paper', label: 'Linkedin', emoji: '💼' },
	{ value: 'workshop-event', label: 'Workshop or event', emoji: '🎤' },
	{ value: 'other', label: 'Other', emoji: '💡' }
] as const;

export type AcademicRoleValue = (typeof ACADEMIC_ROLE_OPTIONS)[number]['value'];
export type RmitAffiliationValue = (typeof RMIT_AFFILIATION_OPTIONS)[number]['value'];
export type DiscoverySourceValue = (typeof DISCOVERY_SOURCE_OPTIONS)[number]['value'];

export const ACADEMIC_ROLE_VALUES = new Set<string>(
	ACADEMIC_ROLE_OPTIONS.map((option) => option.value)
);

export const RMIT_AFFILIATION_VALUES = new Set<string>(
	RMIT_AFFILIATION_OPTIONS.map((option) => option.value)
);

export const DISCOVERY_SOURCE_VALUES = new Set<string>(
	DISCOVERY_SOURCE_OPTIONS.map((option) => option.value)
);