import * as v from 'valibot';
import { PERMISSIONS } from '#lib/permissions.js';
import { idSchema } from './common.js';

export const newRoleSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a name for the role.'), v.maxLength(40))
});

const roleEdit = v.object({
	roleId: idSchema,
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)),
	description: v.pipe(v.string(), v.maxLength(200)),
	permissions: v.array(v.picklist(PERMISSIONS))
});

export const saveRolesSchema = v.object({
	/** Every live role id, highest first. Omit to leave ranks as they are. */
	order: v.optional(v.array(idSchema)),
	/** Roles whose name, description or permissions changed, with their new values. */
	roles: v.array(roleEdit)
});
