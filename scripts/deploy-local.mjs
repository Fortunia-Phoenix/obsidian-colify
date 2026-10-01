import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);

export const PLUGIN_ID = 'colify';
export const RUNTIME_FOLDER = 'colify';
export const SOURCE_ROOT = resolve(dirname(currentFile), '..');
export const RUNTIME_FILES = Object.freeze([
  'manifest.json',
  'main.js',
  'styles.css',
]);

export function defaultRuntimeTarget() {
  const configuredTarget = process.env.COLIFY_PLUGIN_DIR;
  if (!configuredTarget) {
    throw new Error('Provide --target <path-to-.obsidian/plugins/colify> or set COLIFY_PLUGIN_DIR.');
  }
  return resolve(configuredTarget);
}

export async function deployRuntime({
  sourceRoot = SOURCE_ROOT,
  targetRoot = defaultRuntimeTarget(),
  pluginId = PLUGIN_ID,
  runtimeFiles = RUNTIME_FILES,
} = {}) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedTarget = resolve(targetRoot);
  assertSafeTarget(resolvedSource, resolvedTarget, pluginId);
  assertRuntimeFiles(runtimeFiles);

  const sourceManifest = await readJson(resolve(resolvedSource, 'manifest.json'));
  if (sourceManifest.id !== pluginId) {
    throw new Error(`Source manifest id "${sourceManifest.id ?? ''}" does not match "${pluginId}".`);
  }

  const targetManifest = await readJsonIfPresent(resolve(resolvedTarget, 'manifest.json'));
  if (targetManifest && targetManifest.id !== pluginId) {
    throw new Error(`Target manifest id "${targetManifest.id ?? ''}" does not match "${pluginId}".`);
  }

  await mkdir(resolvedTarget, { recursive: true });

  const deployed = [];
  for (const fileName of runtimeFiles) {
    const sourcePath = resolve(resolvedSource, fileName);
    const targetPath = resolve(resolvedTarget, fileName);
    const sourceHash = await sha256(sourcePath);
    await copyFile(sourcePath, targetPath);
    const targetHash = await sha256(targetPath);
    if (sourceHash !== targetHash) {
      throw new Error(`Hash mismatch after deploying ${fileName}.`);
    }
    deployed.push({ fileName, sha256: sourceHash });
  }

  return { sourceRoot: resolvedSource, targetRoot: resolvedTarget, deployed };
}

function assertSafeTarget(sourceRoot, targetRoot, pluginId) {
  const targetFromSource = relative(sourceRoot, targetRoot);
  const targetIsInsideSource = targetFromSource === ''
    || (!targetFromSource.startsWith(`..${sep}`) && targetFromSource !== '..');
  if (targetIsInsideSource) {
    throw new Error('Runtime target must be outside the source repository.');
  }

  if (basename(targetRoot).toLocaleLowerCase() !== pluginId.toLocaleLowerCase()) {
    throw new Error(`Runtime target folder must be named "${pluginId}".`);
  }
}

function assertRuntimeFiles(runtimeFiles) {
  if (!Array.isArray(runtimeFiles) || runtimeFiles.length === 0) {
    throw new Error('Runtime file allowlist must not be empty.');
  }

  for (const fileName of runtimeFiles) {
    if (typeof fileName !== 'string' || basename(fileName) !== fileName) {
      throw new Error(`Invalid runtime file name: ${String(fileName)}`);
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonIfPresent(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function parseTargetArgument(args) {
  let target;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--target') {
      target = args[index + 1];
      index += 1;
      if (!target) throw new Error('--target requires a directory path.');
      continue;
    }
    if (argument.startsWith('--target=')) {
      target = argument.slice('--target='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return target ? resolve(target) : defaultRuntimeTarget();
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const targetRoot = parseTargetArgument(process.argv.slice(2));
    const result = await deployRuntime({ targetRoot });
    for (const item of result.deployed) {
      console.log(`[deploy] ${item.fileName} ${item.sha256}`);
    }
    console.log(`[deploy] target ${result.targetRoot}`);
  } catch (error) {
    console.error('[deploy] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
