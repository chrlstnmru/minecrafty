Icons shown beside an instance's name when it did not come from a modpack.

They are generic symbols from [Tabler Icons](https://tabler.io/icons) (MIT, © Paweł Kuna), tinted
per loader and rendered to 128 px PNG. They are deliberately not the loaders' own logos, whose
licenses and brand rules differ per project. To use an official logo, check that project's terms
first and credit it here.

The files are served by `@sveltejs/enhanced-img` (see `src/lib/components/instance-icon.svelte`),
which resizes them and writes AVIF, WebP and PNG copies at build time. Add a PNG named after the
loader here when a loader is added to `src/lib/loader-list.ts`; a test fails when one is missing.
