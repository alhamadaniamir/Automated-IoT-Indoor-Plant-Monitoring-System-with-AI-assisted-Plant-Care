import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';

const directory=join(homedir(),'.config','sprout');
await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
const path=join(directory,'backend.env');
let existing='';try{existing=await readFile(path,'utf8');}catch{}
const values=parseEnv(existing);
if(!values.SPROUT_PROVIDER)existing+='\nSPROUT_PROVIDER=gemini\n';
if(!values.SPROUT_MODEL)existing+='SPROUT_MODEL=gemini-3.5-flash-lite\n';
if(!values.SPROUT_APP_TOKEN)existing+='SPROUT_APP_TOKEN='+randomBytes(32).toString('hex')+'\n';
await writeFile(path,existing,{mode:0o600});await chmod(path,0o600);
console.log('Private Sprout service configuration prepared. No provider API key was created or printed.');
