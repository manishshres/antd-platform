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

// On page load, try to refresh via the HttpOnly cookie (no localStorage read).
if (typeof window !== "undefined") {
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

    const isAuthEndpoint =
      originalRequest?.url?.includes("/auth/login") ||
      originalRequest?.url?.includes("/auth/refresh") ||
      originalRequest?.url?.includes("/auth/register");

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint &&
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

