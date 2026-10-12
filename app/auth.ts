import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setting } from "@/lib/server";
import { verifySession } from "@/lib/session";
// Sign in with Google. /signin sends the visitor to Google, and
// /auth/google/callback stores the verified Google account in a session
// cookie signed with SESSION_SECRET, so a forged cookie never authenticates.
export type AuthUser = {
    userId: string;
    displayName: string;
    email: string;
    fullName: string | null;
};
export const SESSION_COOKIE = "poomas_session";
export const OAUTH_STATE_COOKIE = "poomas_oauth";
// Local-only identity headers set by the dev server sign-in mock and by the
// smoke test. They are ignored unless running the Vite dev server, or
// AUTH_TRUST_LOCAL_HEADERS=true is set and the request host is loopback.
const DEV_USER_ID_HEADER = "x-poomas-dev-user-id";
const DEV_USER_EMAIL_HEADER = "x-poomas-dev-user-email";
const DEV_USER_NAME_HEADER = "x-poomas-dev-user-name";
export const SIGN_IN_PATH = "/signin";
export const SIGN_OUT_PATH = "/signout";
export const CALLBACK_PATH = "/auth/google/callback";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export async function getUser(): Promise<AuthUser | null> {
    const requestHeaders = await headers();
    const devUser = localDevUser(requestHeaders);
    if (devUser)
        return devUser;
    const token = readCookie(requestHeaders.get("cookie"), SESSION_COOKIE);
    if (!token)
        return null;
    const session = await verifySession(token, setting("SESSION_SECRET"));
    if (!session)
        return null;
    return { userId: session.sub, displayName: session.name ?? session.email, email: session.email, fullName: session.name };
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
    if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_OUT_PATH || url.pathname.startsWith("/auth/"))
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
export function readCookie(cookieHeader: string | null, name: string): string | null {
    for (const part of (cookieHeader ?? "").split(";")) {
        const index = part.indexOf("=");
        if (index > 0 && part.slice(0, index).trim() === name)
            return part.slice(index + 1).trim() || null;
    }
    return null;
}
