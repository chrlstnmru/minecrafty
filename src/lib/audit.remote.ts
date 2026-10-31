import { query } from '$app/server';

import { idSchema } from '#lib/schemas/common.js';
import { listAudit } from '#lib/server/audit.js';
import { requirePanel, requirePermission } from '#lib/server/auth.js';

/** The newest entries for one server, for anyone allowed to see its audit log. */
export const instanceAudit = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'audit');
	return listAudit({ instanceId });
});

/** The newest entries across the whole panel. */
export const panelAudit = query(async () => {
	requirePanel('audit.read');
	return listAudit();
});
