import { NextResponse, type NextRequest } from 'next/server';

// UX-level gate only: presence of the session cookie decides which pages
// render, so unauthenticated visitors never see a flash of the app shell.
// Real enforcement lives in the API — it verifies the token on every request,
// so a forged cookie gets a 401 and the client-side guard bounces to /login.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('token');
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  if (!hasSession && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  // deliberately NO redirect away from /login for cookie-holders: presence
  // of a cookie doesn't prove validity, and a stale cookie would otherwise
  // loop login -> orders -> 401 -> login forever
  return NextResponse.next();
}

export const config = {
  // /api must stay unguarded: the login request itself has no cookie yet
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
