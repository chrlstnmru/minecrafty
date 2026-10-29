import { resolve } from 'node:path';

export const dataDir = resolve(process.env.MINECRAFTY_DATA ?? './data');
