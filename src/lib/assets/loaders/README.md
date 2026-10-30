Loader icons shown beside an instance's name when it did not come from a modpack.

Source: the loader icons Modrinth publishes at `https://api.modrinth.com/v2/tag/loader` (SVG, one
colour), recoloured and rendered to 128 px PNG. The logos belong to their projects. The files are
served by `@sveltejs/enhanced-img` (see `src/lib/components/instance-icon.svelte`), which resizes
them and writes AVIF, WebP and PNG copies at build time. Add a PNG named after the loader here when
a loader is added to `src/lib/loader-list.ts`; a test fails when one is missing.
