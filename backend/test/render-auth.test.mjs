import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveRenderToken,readRenderToken} from '../render-auth.mjs';
test('Render credentials stay private and invalid input cannot overwrite them',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sprout-render-auth-'));
 try{
  const fake='rnd_test_only_not_a_real_key_123456';
  const path=await saveRenderToken(' '+fake+' ',directory);
  assert.equal(await readRenderToken(directory),fake);
  assert.equal((await stat(path)).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);
  const before=await readFile(path,'utf8');
  await assert.rejects(saveRenderToken(fake+'\nANOTHER=value',directory));
  assert.equal(await readFile(path,'utf8'),before);
 }finally{await rm(directory,{recursive:true,force:true});}
});
