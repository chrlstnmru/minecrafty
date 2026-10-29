import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Every test file gets its own data folder (database, instances, temp uploads), created before
// the server modules are imported, so tests never see real data or each other's.
const dir = mkdtempSync(join(tmpdir(), 'minecrafty-test-'));
process.env.MINECRAFTY_DATA = dir;

afterAll(() => rmSync(dir, { recursive: true, force: true }));
