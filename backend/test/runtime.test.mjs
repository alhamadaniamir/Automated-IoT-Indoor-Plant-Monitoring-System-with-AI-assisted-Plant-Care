import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudRuntime,serverAddress} from '../runtime.mjs';
test('Render binds its assigned port publicly while local development stays on loopback',()=>{
 assert.deepEqual(serverAddress({}),{host:'127.0.0.1',port:8765});
 assert.deepEqual(serverAddress({PORT:'10000'}),{host:'0.0.0.0',port:10000});
 assert.equal(cloudRuntime({SPROUT_DEPLOYMENT:'cloud'}),true);
 assert.deepEqual(serverAddress({SPROUT_HOST:'127.0.0.1',SPROUT_PORT:'9000'}),{host:'127.0.0.1',port:9000});
 for(const port of ['0','65536','not-a-port',''])assert.throws(()=>serverAddress({PORT:port}));
});
