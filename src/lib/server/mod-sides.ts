import * as modrinth from './modrinth';

export type Sides = { clientSide: string; serverSide: string };

const BATCH = 100;

/** Where each project says it runs, by project id. Projects Modrinth no longer lists are absent. */
export async function projectSides(projectIds: string[]) {
	const sides = new Map<string, Sides>();
	const ids = [...new Set(projectIds)];
	for (let i = 0; i < ids.length; i += BATCH)
		for (const project of await modrinth.getProjects(ids.slice(i, i + BATCH)))
			sides.set(project.id, { clientSide: project.client_side, serverSide: project.server_side });
	return sides;
}
