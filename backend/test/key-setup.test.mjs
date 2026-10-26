import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, stat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {saveGeminiKey} from '../key-setup.mjs';

test('saves dotted authorization keys privately without breaking phone pairing', async () => {
  const directory=await mkdtemp(join(tmpdir(),'sprout-key-test-'));
  try {
    const path=join(directory,'backend.env');
    const token='test-pairing-token-preserved-12345678';
    await writeFile(path,`SPROUT_APP_TOKEN=${token}\n`);
    for (const fake of ['AQ.'+'fake_test_only_'.repeat(4), 'AIza'+'test_only_'.repeat(4)]) {
      assert.equal(await saveGeminiKey('  '+fake+'  ',directory),path);
      const saved=parseEnv(await readFile(path,'utf8'));
      assert.equal(saved.GEMINI_API_KEY,fake);
      assert.equal(saved.SPROUT_APP_TOKEN,token);
      assert.equal((await stat(path)).mode & 0o777,0o600);
      assert.equal((await stat(directory)).mode & 0o777,0o700);
    }
    assert.equal(parseEnv(await readFile(path,'utf8')).SPROUT_MODEL,'gemini-3.5-flash-lite');
    await writeFile(path,'SPROUT_PROVIDER=gemini\nSPROUT_MODEL=custom-gemini-model\nSPROUT_APP_TOKEN='+token+'\n');
    await saveGeminiKey('AQ.'+'test_only_'.repeat(4),directory);
    assert.equal(parseEnv(await readFile(path,'utf8')).SPROUT_MODEL,'custom-gemini-model');
    const before=await readFile(path,'utf8');
    for (const invalid of ['', 'too-short', 'x'.repeat(30)+'\nINJECTED=true', 'x'.repeat(30)+' #comment', 'x'.repeat(2049)]) {
      await assert.rejects(saveGeminiKey(invalid,directory),/Nothing was saved/);
      assert.equal(await readFile(path,'utf8'),before);
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});
