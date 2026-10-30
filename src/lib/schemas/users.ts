import * as v from 'valibot';
import { PERMISSIONS } from '#lib/permissions.js';
import { idSchema } from './common.js';

export const usernameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.regex(/^[\w.-]{3,32}$/, 'Use 3-32 letters, numbers, . _ -')
);
export const passwordSchema = v.pipe(v.string(), v.minLength(8, 'At least 8 characters'));
export const roleSchema = v.picklist(['admin', 'user']);

export const addUserSchema = v.object({
	username: usernameSchema,
	_password: passwordSchema,
	role: roleSchema
});

export const userRoleSchema = v.object({ id: idSchema, role: roleSchema });
export const userPasswordSchema = v.object({ id: idSchema, password: passwordSchema });

export const userAccessSchema = v.object({
	userId: idSchema,
	instanceId: idSchema,
	permissions: v.array(v.picklist(PERMISSIONS))
});
