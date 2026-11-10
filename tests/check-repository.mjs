// Scan tracked files only; never reads local secret environment files.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbiddenPaths=/(^|\/)(node_modules|\.expo|\.data|dist|coverage)(\/|$)|(^|\/)\.env(?:\..*)?$|\.(docx|db|sqlite)$/;
const suspicious=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bsk-[A-Za-z0-9]{32,}\b/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/];
let failed=false;
for(const file of files){
  if(forbiddenPaths.test(file) && !file.endsWith('.example')) {console.error(`Forbidden tracked path: ${file}`);failed=true;}
  const content=readFileSync(file,'utf8');
  if(suspicious.some(pattern=>pattern.test(content))){console.error(`Potential credential in: ${file}`);failed=true;}
}
if(failed)process.exitCode=1;
else console.log(`Tracked-file hygiene passed (${files.length} files; heuristic scan, not a security guarantee)`);
