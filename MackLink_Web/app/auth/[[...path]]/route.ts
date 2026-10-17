import { env } from 'cloudflare:workers';
import { handleGoogleAuth } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleGoogleAuth(req, env);
export const POST = (req: Request) => handleGoogleAuth(req, env);
