import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const backend=dirname(fileURLToPath(import.meta.url));
const directory=join(homedir(),'.config','systemd','user');
const path=join(directory,'sprout-care.service');
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const unit=`# Managed by Sprout backend/install-service.mjs
[Unit]
Description=Sprout local AI plant care service
After=network-online.target

[Service]
Type=simple
ExecStart=${quote(process.execPath)} ${quote(join(backend,'server.mjs'))}
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`;
await mkdir(directory,{recursive:true});
let existing='';try {existing=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(existing && !existing.startsWith('# Managed by Sprout backend/install-service.mjs'))throw Error('An existing sprout-care service has custom settings. Review it before replacing.');
await writeFile(path,unit,{mode:0o600});
for(const args of [['--user','daemon-reload'],['--user','enable','--now','sprout-care.service']]) {
  const result=spawnSync('systemctl',args,{stdio:'inherit'});
  if(result.status!==0)throw Error('User service setup failed. You can run node backend/server.mjs directly.');
}
console.log('Sprout care service is enabled for this user. Provider credentials remain in the private config file.');
