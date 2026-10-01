import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PLUGIN_ID,
  RUNTIME_FILES,
  defaultRuntimeTarget,
  deployRuntime,
} from './deploy-local.mjs';

const root = await mkdtemp(join(tmpdir(), 'colify-deploy-'));
const sourceRoot = join(root, 'source');
const targetRoot = join(root, PLUGIN_ID);

try {
  const previousConfiguredTarget = process.env.COLIFY_PLUGIN_DIR;
  delete process.env.COLIFY_PLUGIN_DIR;
  assert.throws(() => defaultRuntimeTarget(), /Provide --target/i);
  process.env.COLIFY_PLUGIN_DIR = targetRoot;
  assert.equal(defaultRuntimeTarget(), resolve(targetRoot));
  if (previousConfiguredTarget === undefined) delete process.env.COLIFY_PLUGIN_DIR;
  else process.env.COLIFY_PLUGIN_DIR = previousConfiguredTarget;

  await mkdir(sourceRoot, { recursive: true });
  await mkdir(join(targetRoot, 'data'), { recursive: true });

  for (const fileName of RUNTIME_FILES) {
    const content = fileName === 'manifest.json'
      ? JSON.stringify({ id: PLUGIN_ID, version: 'test' })
      : `runtime:${fileName}`;
    await writeFile(join(sourceRoot, fileName), content);
  }

  await writeFile(join(sourceRoot, 'src.ts'), 'must not deploy');
  await writeFile(join(targetRoot, 'manifest.json'), JSON.stringify({ id: PLUGIN_ID, version: 'old' }));
  await writeFile(join(targetRoot, 'data.json'), '{"preserved":true}');
  await writeFile(join(targetRoot, 'data', 'instance.json'), '{"device":"preserved"}');

  const result = await deployRuntime({ sourceRoot, targetRoot });
  assert.equal(result.deployed.length, RUNTIME_FILES.length);

  for (const fileName of RUNTIME_FILES) {
    assert.equal(
      await readFile(join(targetRoot, fileName), 'utf8'),
      await readFile(join(sourceRoot, fileName), 'utf8'),
    );
  }

  assert.equal(await readFile(join(targetRoot, 'data.json'), 'utf8'), '{"preserved":true}');
  assert.equal(await readFile(join(targetRoot, 'data', 'instance.json'), 'utf8'), '{"device":"preserved"}');
  await assert.rejects(readFile(join(targetRoot, 'src.ts'), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(
    deployRuntime({ sourceRoot, targetRoot: join(root, 'wrong-plugin') }),
    /folder must be named/i,
  );

  console.log('[deploy-test] allowlist, hash verification, and runtime-state preservation passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
