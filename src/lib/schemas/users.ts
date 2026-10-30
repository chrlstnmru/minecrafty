import * as v from 'valibot';
import { idSchema } from './common.js';

export const usernameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.regex(/^[\w.-]{3,32}$/, 'Use 3-32 letters, numbers, . _ -')
);
export const passwordSchema = v.pipe(v.string(), v.minLength(8, 'At least 8 characters'));

export const addUserSchema = v.object({
	username: usernameSchema,
	_password: passwordSchema
});

export const userPasswordSchema = v.object({ id: idSchema, password: passwordSchema });

/** the roles a user has on one instance, or panel-wide with instanceId null; empty takes them all away */
export const userAccessSchema = v.object({
	userId: idSchema,
	instanceId: v.nullable(idSchema),
	roleIds: v.array(idSchema)
});

export const userIdsSchema = v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(500));

export const grantRoleSchema = v.object({
	userIds: userIdsSchema,
	roleId: idSchema,
	instanceId: v.nullable(idSchema)
});
