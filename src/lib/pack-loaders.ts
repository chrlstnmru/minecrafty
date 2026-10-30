/** The loaders a builder pack can use: the ones the .mrpack format has a dependency key for. */
export const PACK_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const;
export type PackLoader = (typeof PACK_LOADERS)[number];
