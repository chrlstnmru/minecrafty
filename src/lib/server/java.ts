import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config';

// Temurin LTS releases; Mojang also asks for 16 (1.17), which 17 runs fine
export const JAVA_MAJORS = [8, 17, 21, 25] as const;
export type JavaMajor = (typeof JAVA_MAJORS)[number];

const javaDir = join(dataDir, 'java');
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest';

/** Smallest installable Java that is at least `major`. */
function normalize(major: number): JavaMajor {
	return JAVA_MAJORS.find((m) => m >= major) ?? JAVA_MAJORS[JAVA_MAJORS.length - 1];
}

// used only when Mojang's metadata is unreachable or has no javaVersion (old releases)
function guessFromVersion(mc: string): JavaMajor {
	const [a, b = 0, c = 0] = mc.split('.').map(Number);
	if (a > 1) return 25;
	if (b < 17) return 8;
	if (b < 20 || (b === 20 && c < 5)) return 17;
	return 21;
}

const requiredCache = new Map<string, JavaMajor>();

/** The Java major version Mojang says this Minecraft version needs. */
export async function requiredJavaMajor(mc: string): Promise<JavaMajor> {
	const hit = requiredCache.get(mc);
	if (hit) return hit;
	let major: JavaMajor;
	try {
		const signal = AbortSignal.timeout(15_000);
		const manifest = (await (await fetch(MOJANG_MANIFEST, { signal })).json()) as {
			versions: { id: string; url: string }[];
		};
		const entry = manifest.versions.find((v) => v.id === mc);
		if (!entry) throw new Error('unknown version');
		const meta = (await (await fetch(entry.url, { signal })).json()) as {
			javaVersion?: { majorVersion: number };
		};
		major = meta.javaVersion ? normalize(meta.javaVersion.majorVersion) : guessFromVersion(mc);
	} catch {
		major = guessFromVersion(mc);
	}
	requiredCache.set(mc, major);
	return major;
}

function platform() {
	const os = ({ linux: 'linux', darwin: 'mac', win32: 'windows' } as Record<string, string>)[
		process.platform
	];
	const arch = ({ x64: 'x64', arm64: 'aarch64' } as Record<string, string>)[process.arch];
	if (!os || !arch) throw new Error(`No Java build for ${process.platform}/${process.arch}`);
	return { os, arch };
}

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

/** Finds bin/java inside an extracted JRE (macOS nests it under Contents/Home). */
function findJava(dir: string, depth = 0): string | null {
	if (!existsSync(dir) || depth > 4) return null;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isFile() && entry.name === exe && dir.endsWith('bin')) return full;
		if (entry.isDirectory()) {
			const found = findJava(full, depth + 1);
			if (found) return found;
		}
	}
	return null;
}

const installing = new Map<number, Promise<string>>();

/** Path to a Temurin JRE of this major version, downloading it on first use. */
export function ensureJava(major: JavaMajor): Promise<string> {
	const existing = findJava(join(javaDir, `temurin-${major}`));
	if (existing) return Promise.resolve(existing);
	// concurrent starts share one download
	let job = installing.get(major);
	if (!job) {
		job = install(major).finally(() => installing.delete(major));
		installing.set(major, job);
	}
	return job;
}

async function install(major: JavaMajor): Promise<string> {
	const { os, arch } = platform();
	const query = `${ADOPTIUM}/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}`;
	const assets = (await (await fetch(query, { signal: AbortSignal.timeout(15_000) })).json()) as {
		binary: { package: { name: string; link: string; checksum: string } };
	}[];
	const pkg = assets[0]?.binary.package;
	if (!pkg) throw new Error(`No Temurin ${major} build for ${os}/${arch}`);

	mkdirSync(javaDir, { recursive: true });
	const archive = join(javaDir, `.download-${major}-${pkg.name}`);
	const staging = join(javaDir, `.staging-${major}`);
	const target = join(javaDir, `temurin-${major}`);
	rmSync(staging, { recursive: true, force: true });
	try {
		const res = await fetch(pkg.link, { signal: AbortSignal.timeout(10 * 60_000) });
		if (!res.ok) throw new Error(`Java download failed (${res.status})`);
		await Bun.write(archive, res);

		const actual = new Bun.CryptoHasher('sha256')
			.update(await Bun.file(archive).arrayBuffer())
			.digest('hex');
		if (actual !== pkg.checksum) throw new Error('Java download failed checksum verification');

		mkdirSync(staging, { recursive: true });
		// bsdtar (Windows 10+) and GNU tar both read .zip and .tar.gz
		const tar = Bun.spawn(['tar', '-xf', archive, '-C', staging], { stderr: 'pipe' });
		if ((await tar.exited) !== 0)
			throw new Error(`Could not extract Java: ${await new Response(tar.stderr).text()}`);

		rmSync(target, { recursive: true, force: true });
		renameSync(staging, target);
	} finally {
		rmSync(archive, { force: true });
		rmSync(staging, { recursive: true, force: true });
	}
	const java = findJava(target);
	if (!java) throw new Error('Extracted Java is missing its executable');
	return java;
}
