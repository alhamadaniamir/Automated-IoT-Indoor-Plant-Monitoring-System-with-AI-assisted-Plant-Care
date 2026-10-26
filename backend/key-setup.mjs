import {mkdir, writeFile, readFile, chmod, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';

export async function saveGeminiKey(input, directory) {
  const key = input.trim();
  // Gemini authorization keys can contain periods. Validate for a single safe
  // environment-file value, not a legacy provider-specific key prefix.
  if (!/^[A-Za-z0-9._-]{20,2048}$/.test(key)) {
    throw new Error('Paste the complete API key only, without spaces or quotation marks. Nothing was saved.');
  }
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const path = join(directory, 'backend.env');
  let existing = {};
  try { existing = parseEnv(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = existing.SPROUT_APP_TOKEN || randomBytes(32).toString('hex');
  const model = existing.SPROUT_PROVIDER === 'gemini' && existing.SPROUT_MODEL
    ? existing.SPROUT_MODEL : 'gemini-3.5-flash-lite';
  const value = 'SPROUT_PROVIDER=gemini\nSPROUT_MODEL=' + model + '\nGEMINI_API_KEY=' + key + '\nSPROUT_APP_TOKEN=' + token + '\n';
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    await writeFile(temporary, value, {mode: 0o600, flag: 'wx'});
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
  return path;
}
