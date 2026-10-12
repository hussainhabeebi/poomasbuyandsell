import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setting } from "@/lib/server";
import { verifyAccessJwt } from "@/lib/access-jwt";
// Authentication through Cloudflare Access (Zero Trust).
// Access signs every authenticated request with a JWT, sent in the
// `Cf-Access-Jwt-Assertion` header on protected paths and in the
// `CF_Authorization` cookie on the rest of the application domain.
// The token is verified here against the team's public keys, so a forged
// header or cookie never authenticates a request.
export type AuthUser = {
    userId: string;
    displayName: string;
    email: string;
    fullName: string | null;
};
const JWT_HEADER = "cf-access-jwt-assertion";
const JWT_COOKIE = "CF_Authorization";
// Local-only identity headers set by the dev server sign-in mock and by the
// smoke test. They are ignored unless running the Vite dev server, or
// AUTH_TRUST_LOCAL_HEADERS=true is set and the request host is loopback.
const DEV_USER_ID_HEADER = "x-poomas-dev-user-id";
const DEV_USER_EMAIL_HEADER = "x-poomas-dev-user-email";
const DEV_USER_NAME_HEADER = "x-poomas-dev-user-name";
export const SIGN_IN_PATH = "/signin";
export const SIGN_OUT_PATH = "/signout";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function accessTeamDomain(): string {
    return setting("CF_ACCESS_TEAM_DOMAIN").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
export function accessAudience(): string {
    return setting("CF_ACCESS_AUD").trim();
}
export async function getUser(): Promise<AuthUser | null> {
    const requestHeaders = await headers();
    const devUser = localDevUser(requestHeaders);
    if (devUser)
        return devUser;
    const token = requestHeaders.get(JWT_HEADER) || readCookie(requestHeaders.get("cookie"), JWT_COOKIE);
    if (!token)
        return null;
    const domain = accessTeamDomain(), audience = accessAudience();
    if (!domain || !audience)
        return null;
    const claims = await verifyAccessJwt(token, domain, audience);
    if (!claims)
        return null;
    const email = typeof claims.email === "string" ? claims.email : "";
    const userId = typeof claims.sub === "string" ? claims.sub : "";
    // Service tokens carry no email or subject and never act as a user.
    if (!email || !userId)
        return null;
    const fullName = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null;
    return { userId, displayName: fullName ?? email, email, fullName };
}
export async function requireUser(returnTo: string): Promise<AuthUser> {
    const user = await getUser();
    if (user)
        return user;
    redirect(signInPath(returnTo));
}
export function signInPath(returnTo: string): string {
    return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}
export function signOutPath(): string {
    return SIGN_OUT_PATH;
}
export function safeRelativeReturnPath(value: string | null | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//"))
        return "/";
    let url: URL;
    try {
        url = new URL(value, "https://app.local");
    }
    catch {
        return "/";
    }
    if (url.origin !== "https://app.local")
        return "/";
    if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_OUT_PATH || url.pathname.startsWith("/cdn-cgi/"))
        return "/";
    return `${url.pathname}${url.search}${url.hash}`;
}
function localDevUser(requestHeaders: Headers): AuthUser | null {
    const userId = requestHeaders.get(DEV_USER_ID_HEADER);
    const email = requestHeaders.get(DEV_USER_EMAIL_HEADER);
    if (!userId || !email)
        return null;
    const trusted = import.meta.env.DEV ||
        (setting("AUTH_TRUST_LOCAL_HEADERS") === "true" && LOCAL_HOSTS.has((requestHeaders.get("host") ?? "").replace(/:\d+$/, "").toLowerCase()));
    if (!trusted)
        return null;
    const fullName = requestHeaders.get(DEV_USER_NAME_HEADER);
    return { userId, displayName: fullName ?? email, email, fullName };
}
function readCookie(cookieHeader: string | null, name: string): string | null {
    for (const part of (cookieHeader ?? "").split(";")) {
        const index = part.indexOf("=");
        if (index > 0 && part.slice(0, index).trim() === name)
            return part.slice(index + 1).trim() || null;
    }
    return null;
}
