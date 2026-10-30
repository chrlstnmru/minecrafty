export type UpdateOutcome = {
	ok: boolean;
	message: string;
	/** extra lines worth showing, such as the files an update left alone */
	details?: string[];
	at: number;
};

// how the last loader or modpack update of each instance ended; lost on restart, like install progress
const outcomes = new Map<number, UpdateOutcome>();

export const lastOutcome = (instanceId: number) => outcomes.get(instanceId) ?? null;
export const clearOutcome = (instanceId: number) => outcomes.delete(instanceId);
export const setOutcome = (instanceId: number, outcome: Omit<UpdateOutcome, 'at'>) =>
	outcomes.set(instanceId, { ...outcome, at: Date.now() });
