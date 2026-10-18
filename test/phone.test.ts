import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Phone} from '../src/phone.ts';
for(const fail of [false,true])test(`中文输入使用 base64 且${fail?'广播失败时仍':'成功后'}恢复输入法`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'qq-phone-')),p=new Phone(root),calls:string[][]=[];
 p.run=async(args:string[])=>{calls.push(args);const s=args.join(' ');if(s.includes('ime list'))return 'com.android.adbkeyboard/.AdbIME';if(s.endsWith('default_input_method'))return 'original/.IME';if(s.endsWith('enabled_input_methods'))return 'original/.IME';if(s.includes('am broadcast')){if(fail)throw new Error('broadcast failed');return 'Broadcast completed: result=0';}return '';};
 try{if(fail)await assert.rejects(()=>p.chineseText('你好'),/broadcast failed/);else await p.chineseText('你好');assert(calls.some(a=>a.includes(Buffer.from('你好').toString('base64'))));assert.deepEqual(calls.at(-2),['shell','settings','put','secure','default_input_method','original/.IME']);assert.deepEqual(calls.at(-1),['shell','settings','put','secure','enabled_input_methods',"'original/.IME'"]);}finally{rmSync(root,{recursive:true,force:true});}
});
