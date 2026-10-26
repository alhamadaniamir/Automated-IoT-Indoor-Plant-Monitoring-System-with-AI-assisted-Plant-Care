import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {saveRenderToken} from './render-auth.mjs';
if(!process.stdin.isTTY)throw new Error('Run this command in your own terminal to enter the Render key privately.');
let hidden=true;
const output=new Writable({write(chunk,encoding,callback){if(!hidden)process.stdout.write(chunk);callback();}});
const prompt=createInterface({input:process.stdin,output,terminal:true});
process.stdout.write('Create a Render API key in Account Settings: https://dashboard.render.com/u/settings#api-keys\nThis is the Render management key, separate from Gemini.\nRender API key (hidden): ');
prompt.question('',async(key)=>{
  hidden=false;prompt.close();process.stdout.write('\n');
  try{const path=await saveRenderToken(key,join(homedir(),'.config','sprout'));process.stdout.write('Render key saved privately to '+path+'. It was not printed or added to the project.\n');}
  catch{process.stderr.write('Could not save the Render key. Paste only the complete key and check folder access.\n');process.exitCode=1;}
});
