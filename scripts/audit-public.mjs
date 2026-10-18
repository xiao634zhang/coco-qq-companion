// Inspect the Git index, not untracked runtime files. Never print matched values.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
const git=process.env.COCO_GIT||'git';
const run=args=>execFileSync(git,args,{maxBuffer:16*1024*1024});
const paths=run(['ls-files','-z']).toString().split('\0').filter(Boolean);
const forbidden=/(^|\/)(?:data|backups|workspace|\.runtime|\.codex-runtime|node_modules|SnowLuma)(\/|$)|(^|\/)(?:config\.json|role\.md|AGENTS\.md|\.env[^/]*|auth\.json)$|\.(?:log|db|sqlite|pem|key|apk|zip|png|jpe?g|wav|mp3|mp4)$/i;
const patterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['provider-key',new RegExp('\\b(?:sk'+'-[A-Za-z0-9_-]{24,}|gh[pousr]'+'_[A-Za-z0-9]{30,}|github'+'_pat_[A-Za-z0-9_]{30,})\\b')],
 ['jwt',/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/],
 ['credential-url',/https?:\/\/[^\s/@"'<>]+:[^\s/@"'<>]+@/],
 ['credential-assignment',/(?:access_token|refresh_token|api_key|password|cookie)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_+/.=-]{24,}["']/i],
 ['personal-home',/[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<)[^\\/\s'";]+/i],
];
const privateValues=[];
if(existsSync('config.json')){
 const c=JSON.parse(readFileSync('config.json','utf8').replace(/^\uFEFF/,''));
 for(const v of [c.ownerQQ,c.botQQ,c.snow?.accessToken,c.snow?.httpAccessToken])if(typeof v==='string'&&v.length>=6)privateValues.push(v);
}
if(existsSync('data/console-token'))privateValues.push(readFileSync('data/console-token','utf8').trim());
let failures=0;
for(const path of paths){
 if(forbidden.test(path)){console.error(`Forbidden public path: ${path}`);failures++;continue;}
 let bytes;try{bytes=run(['show',`:${path}`]);}catch{console.error(`Cannot read staged blob: ${path}`);failures++;continue;}
 if(bytes.length>2*1024*1024||bytes.includes(0)){console.error(`Unexpected binary/large file: ${path}`);failures++;continue;}
 const content=bytes.toString('utf8');
 // These two literal fixtures verify that credential-bearing URLs are rejected.
 const scanned=path.startsWith('test/')?content.replaceAll('http://'+'u:p@localhost','http://localhost').replaceAll('https://'+'u:p@example.com','https://example.com'):content;
 for(const [name,pattern]of patterns)if(pattern.test(scanned)){console.error(`Review required (${name}): ${path}`);failures++;}
 if(privateValues.some(v=>v&&content.includes(v))){console.error(`Private local value detected: ${path}`);failures++;}
}
if(!paths.length){console.error('No staged/tracked files to audit. Stage the public source first.');process.exit(1);}
if(failures){console.error(`Public audit failed: ${failures} findings. Matched values are intentionally hidden.`);process.exit(1);}
console.log(`Public audit passed: ${paths.length} staged/tracked files; no forbidden paths or configured credential patterns found.`);
