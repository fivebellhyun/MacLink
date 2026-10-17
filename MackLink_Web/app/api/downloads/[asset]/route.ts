import {env} from 'cloudflare:workers';
import {connectorInstaller} from '@/lib/connector-installer';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>connectorInstaller(request,env.ASSETS);
export const HEAD=GET;
