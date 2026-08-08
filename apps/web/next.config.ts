import type { NextConfig } from 'next';

// same-origin proxy: the browser only talks to this app; /api/* is forwarded
// server-side. The auth cookie stays first-party (sameSite=lax just works)
// and CORS never enters the picture in any environment.
// tolerate junk values (empty, no scheme, trailing slash) instead of failing
// the build with "Invalid rewrite found" — fall back to local dev target
const raw = process.env.API_PROXY_TARGET ?? '';
const API_PROXY_TARGET = /^https?:\/\//.test(raw) ? raw.replace(/\/+$/, '') : 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@orders/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_PROXY_TARGET}/:path*` }];
  },
};

export default nextConfig;
