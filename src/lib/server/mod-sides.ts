import * as modrinth from './modrinth';

export type Sides = { clientSide: string; serverSide: string };

/** Where each project says it runs, by project id. Projects Modrinth no longer lists are absent. */
export async function projectSides(projectIds: string[]) {
	const sides = new Map<string, Sides>();
	for (const project of await modrinth.getProjects(projectIds))
		sides.set(project.id, { clientSide: project.client_side, serverSide: project.server_side });
	return sides;
}
