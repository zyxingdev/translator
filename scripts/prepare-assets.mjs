import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const pdfRoot=dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir(join(root,'public/pdfjs'),{recursive:true});
for(const dir of ['cmaps','standard_fonts','wasm'])await cp(join(pdfRoot,dir),join(root,'public/pdfjs',dir),{recursive:true});
await cp(join(pdfRoot,'LICENSE'),join(root,'public/pdfjs/LICENSE.pdfjs'));
const fontPath=join(root,'public/fonts/NotoSansSC.ttf');
const checksum='a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da';
const fontUrl='https://raw.githubusercontent.com/google/fonts/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let cached=false;try{cached=digest(await readFile(fontPath))===checksum;}catch{}
if(!cached){
 console.log('Preparing licensed Chinese font from pinned Google Fonts source…');
 const response=await fetch(fontUrl,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`Font download failed: HTTP ${response.status}`);
 if(Number(response.headers.get('content-length'))>25*1024*1024)throw Error('Unexpected font size');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length>25*1024*1024||digest(bytes)!==checksum)throw Error('Font integrity check failed; no replacement was installed');
 await mkdir(dirname(fontPath),{recursive:true});const temporary=fontPath+'.tmp';
 try{await writeFile(temporary,bytes);await rename(temporary,fontPath);}finally{await rm(temporary,{force:true});}
}
console.log('Same-origin PDF resources and verified Chinese font are ready.');
