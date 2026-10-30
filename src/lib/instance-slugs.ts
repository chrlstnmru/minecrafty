// Plain data only: src/params.ts imports this, and Kit loads that file outside the Svelte
// pipeline (and in the browser), so it must not pull in components.

/** Instance modules that appear in the tab bar before they are built (see docs/SPEC.md). */
export const plannedSlugs = ['schedules'] as const;
