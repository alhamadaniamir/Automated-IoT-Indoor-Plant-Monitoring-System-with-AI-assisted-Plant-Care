import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {saveGeminiKey} from './key-setup.mjs';

// Run interactively on the user's laptop. No key is accepted in command arguments.
if (!process.stdin.isTTY) throw new Error('Run this command in your own terminal to enter the key privately.');
let mute=false;
const output=new Writable({write(chunk,encoding,callback){if(!mute)process.stdout.write(chunk);callback();}});
const prompt=createInterface({input:process.stdin,output,terminal:true});
process.stdout.write('Create a Gemini API key at https://aistudio.google.com/apikey\nPaste it below; typing is hidden.\nGemini API key: ');
mute=true;
prompt.question('',async(key)=>{
  mute=false;prompt.close();process.stdout.write('\n');
  try {
    const path=await saveGeminiKey(key,join(homedir(),'.config','sprout'));
    process.stdout.write('Saved privately to '+path+'. The model key was not printed or added to the project.\nThe running care service loads the key on its next request. Tap Review care with AI in Sprout.\n');
  } catch (error) {
    process.stderr.write(error.message.startsWith('Paste the complete API key')
      ? error.message+'\n'
      : 'Could not save the private configuration. Check folder access and try again.\n');
    process.exitCode=1;
  }
});
