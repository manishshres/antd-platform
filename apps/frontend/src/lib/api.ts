import axios from "axios";
import { getAccessToken, setAccessToken, clearAccessToken } from "./token-store";
import { getTokenExp } from "./jwt";

let baseURL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

if (baseURL.startsWith("http") && !baseURL.includes("/api/v1")) {
  baseURL = baseURL.replace(/\/$/, "") + "/api/v1";
}

export const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 30000,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a JWT payload without verification (browser-side, just to read `exp`). */
function decodeTokenExp(token: string): number | null {
  return getTokenExp(token);
}

// Refresh the access token 5 minutes before it expires.
const REFRESH_BUFFER_SECS = 5 * 60;

function isTokenExpiringSoon(token: string): boolean {
  const exp = decodeTokenExp(token);
  if (!exp) return true;
  return Date.now() / 1000 > exp - REFRESH_BUFFER_SECS;
}

// ---------------------------------------------------------------------------
// Proactive background refresh timer
// ---------------------------------------------------------------------------

let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

/** Refresh the access token via the HttpOnly refresh cookie. */
async function doRefresh(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ access_token: string }>(
      `${baseURL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    setAccessToken(data.access_token);
    api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
    scheduleProactiveRefresh(data.access_token);
    return data.access_token;
  } catch {
    // Refresh failed (expired/revoked session). Drop the now-dead access token so
    // getAccessToken() reads null — otherwise the /login mount guard sees a stale
    // token and bounces the user away from the login form (they can't sign back in
    // without a manual full-page reload).
    clearAccessToken();
    delete api.defaults.headers.common.Authorization;
    return null;
  }
}

/**
 * Schedule a timer that fires ~5 minutes before the access token expires,
 * so the user never hits a 401 even when idle.
 */
function scheduleProactiveRefresh(token: string) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const exp = decodeTokenExp(token);
  if (!exp) return;
  const delayMs = Math.max((exp - REFRESH_BUFFER_SECS - Date.now() / 1000) * 1000, 10_000);
  proactiveTimer = setTimeout(() => {
    doRefresh();
  }, delayMs);
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Endpoints that establish a session rather than consume one. They must never wait on,
 * or be retried by, the refresh machinery — a login request that queues behind a doomed
 * refresh just pays for a round-trip that was always going to 401.
 */
const AUTH_ENDPOINTS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
  "/auth/forgot-password",
  "/auth/reset-password",
];

function isAuthEndpoint(url?: string): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

/**
 * Pages a signed-out visitor is expected to be on. The refresh cookie is HttpOnly so the
 * client cannot test for a session directly — but on these routes there is by definition
 * nothing to refresh, and attempting it costs a guaranteed 401 that also makes the server
 * clear the cookie. Anywhere else, the bootstrap refresh is what restores a returning
 * user's session from the cookie alone.
 */
const AUTH_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/invitations",
  "/verify-email",
];

function onAuthPage(): boolean {
  if (typeof window === "undefined") return false;
  return AUTH_PAGES.some((path) => window.location.pathname.startsWith(path));
}

// On page load, try to refresh via the HttpOnly cookie (no localStorage read).
// Restore a returning user's session from the HttpOnly refresh cookie on first load —
// but not on the auth pages, where there is no session yet and the call only produces a
// 401 that the login request then has to queue behind.
if (typeof window !== "undefined" && !onAuthPage()) {
  isRefreshing = true;
  refreshPromise = doRefresh().finally(() => {
    isRefreshing = false;
    refreshPromise = null;
  });
  refreshPromise.then((token) => {
    if (token) scheduleProactiveRefresh(token);
  });
}

// ---------------------------------------------------------------------------
// Request interceptor — inject JWT + proactive refresh if nearly expired
// ---------------------------------------------------------------------------

api.interceptors.request.use(async (config) => {
  // Sending credentials, not using them: go straight out, without waiting on a refresh
  // or attaching a (possibly stale) access token.
  if (isAuthEndpoint(config.url)) return config;

  if (typeof window !== "undefined") {
    let token = getAccessToken();

    if (isRefreshing && refreshPromise) {
      const newToken = await refreshPromise;
      if (newToken) token = newToken;
    } else if (token && isTokenExpiringSoon(token)) {
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = doRefresh().finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      // If the refresh failed, drop the expired token rather than sending it — it
      // would only 401. A null token lets public requests (e.g. login) proceed clean.
      token = newToken ?? null;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;

      const orgId = localStorage.getItem("selectedOrgId");
      if (orgId) {
        const hasOrgIdInUrl = config.url && config.url.includes("orgId=");
        const hasOrgIdInParams = config.params && config.params.orgId !== undefined;

        if (!hasOrgIdInUrl && !hasOrgIdInParams) {
          config.params = { ...config.params, orgId };
        }
      }
    }
  }
  return config;
});

// ---------------------------------------------------------------------------
// Response interceptor — safety-net 401 refresh
// ---------------------------------------------------------------------------

let failedQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => {
    if (error) {
      p.reject(error);
    } else {
      p.resolve(token!);
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint(originalRequest?.url) &&
      typeof window !== "undefined"
    ) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await doRefresh();
        if (!newToken) throw new Error("Refresh failed");

        originalRequest.headers.Authorization = `Bearer ${newToken}`;

        processQueue(null, newToken);

        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearAccessToken();
        try {
          await axios.post(`${baseURL}/auth/logout`, {}, { withCredentials: true });
        } catch {
          // Ignore
        }
        if (!window.location.pathname.includes("/login") && !window.location.pathname.includes("/register")) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
        refreshPromise = null;
      }
    }

    return Promise.reject(error);
  },
);

/** Call after a successful login to start the proactive refresh timer. */
export function onLoginSuccess(accessToken: string) {
  setAccessToken(accessToken);
  api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
  scheduleProactiveRefresh(accessToken);
}

