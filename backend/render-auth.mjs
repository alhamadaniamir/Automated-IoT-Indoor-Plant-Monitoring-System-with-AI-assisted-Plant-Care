import {mkdir,writeFile,chmod,rename,unlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

export async function saveRenderToken(input,directory) {
  const token=input.trim();
  if(token.length<20||token.length>4096||/\s|[\x00-\x1f\x7f]/.test(token))throw new Error('Paste the complete Render API key only. Nothing was saved.');
  await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  const path=join(directory,'render-auth.json'),temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp';
  try{await writeFile(temporary,JSON.stringify({api_key:token})+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}
  finally{await unlink(temporary).catch(()=>{});}
  return path;
}
export async function readRenderToken(directory) {
  const value=JSON.parse(await readFile(join(directory,'render-auth.json'),'utf8'));
  if(typeof value.api_key!=='string'||value.api_key.length<20)throw new Error('Run node backend/render-login.mjs first.');
  return value.api_key;
}
