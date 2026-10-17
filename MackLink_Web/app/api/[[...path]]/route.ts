import { env } from 'cloudflare:workers';
import { handleApi } from '@/lib/server';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleApi(req, env);
export const POST = (req: Request) => handleApi(req, env);
export const DELETE = (req: Request) => handleApi(req, env);
