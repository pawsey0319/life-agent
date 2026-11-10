import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { DemoModels } from './providers.js';
import {createConfiguredModels} from './model-config.js';
import { SupabaseStore } from './storage.js';
import {httpBoundary} from './http-boundary.js';
function need(name:string){const v=process.env[name];if(!v)throw new Error(`Missing required configuration: ${name}`);return v;}
export function configuration(){const mode=need('RUNTIME_MODE');if(mode!=='demo'&&mode!=='configured')throw new Error('RUNTIME_MODE must be demo or configured');if(mode==='demo')return {mode,models:new DemoModels()} as const;return {mode,store:new SupabaseStore(need('SUPABASE_URL'),need('SUPABASE_SERVICE_ROLE_KEY'),need('DATA_MASTER_KEY')),models:createConfiguredModels()} as const;}
const options=configuration();const createAppInstance=createApp(options);const port=Number(process.env.PORT??8787);serve({fetch:httpBoundary(request=>createAppInstance.fetch(request),{limit:options.mode==='demo'?600:60}),hostname:options.mode==='demo'?'127.0.0.1':process.env.HOST??'127.0.0.1',port});console.log(`Life Agent runtime: ${options.mode}; http://127.0.0.1:${port}; system push disabled`);
