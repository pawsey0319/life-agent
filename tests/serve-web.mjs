// Local-only static server for Expo export verification. Not a production server.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root = resolve('apps/mobile/dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
const server = createServer(async(req,res)=>{
  try {
    const path = decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);
    let target = resolve(root, '.'+path);
    if(target!==root && !target.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    try {if((await stat(target)).isDirectory()) target=resolve(target,'index.html');}
    catch {target=resolve(root,'index.html');}
    const bytes = await readFile(target);
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store'});
    res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(8081,'127.0.0.1',()=>console.log('Expo verification export: http://127.0.0.1:8081'));
