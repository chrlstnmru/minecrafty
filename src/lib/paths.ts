// Paths inside a folder, as the file managers and the server write them: forward slashes, none at
// either end, and '' for the folder itself. Safe in the browser and on the server.

/** Backslashes made forward, and no slash at either end. */
export const cleanPath = (path: string) => path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

/** Whether `path` is `folder` or inside it. */
export const under = (path: string, folder: string) =>
	path === folder || path.startsWith(`${folder}/`);

/** `path` as it reads once `from` has become `to`; a path outside `from` stays as it is. */
export const rebase = (path: string, from: string, to: string) =>
	under(path, from) ? `${to}${path.slice(from.length)}` : path;

/** The folder that holds `path`; '' at the top. */
export const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** The last part of `path`. */
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** `name` inside `folder` ('' is the top). */
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
