/** Why someone cannot change a role (sv-erp's `RoleLock`). */
export type RoleLock = 'read-only' | 'rank' | 'held' | 'owner-only';

export const LOCK_MESSAGES: Record<RoleLock, string> = {
	'read-only': 'You can view roles but not change them.',
	rank: 'This role ranks at or above your own, so you can only view it.',
	held: "You hold this role, so you can't change it.",
	'owner-only': 'Only the owner can change a role that has owner-only permissions.'
};
