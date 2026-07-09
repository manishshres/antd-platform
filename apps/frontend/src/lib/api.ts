import axios from "axios";

let baseURL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

if (baseURL.startsWith("http") && !baseURL.includes("/api/v1")) {
  baseURL = baseURL.replace(/\/$/, "") + "/api/v1";
}

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a JWT payload without verification (browser-side, just to read `exp`). */
function decodeTokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

// Refresh the access token 5 minutes before it expires.
const REFRESH_BUFFER_SECS = 5 * 60;

function isTokenExpiringSoon(token: string): boolean {
  const exp = decodeTokenExp(token);
  if (!exp) return true; // Can't read exp → treat as expired
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
    localStorage.setItem("access_token", data.access_token);
    api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
    scheduleProactiveRefresh(data.access_token);
    return data.access_token;
  } catch {
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
  // Fire REFRESH_BUFFER_SECS before expiry (minimum 10 s so we don't spin).
  const delayMs = Math.max((exp - REFRESH_BUFFER_SECS - Date.now() / 1000) * 1000, 10_000);
  proactiveTimer = setTimeout(() => {
    doRefresh(); // fire-and-forget; the response interceptor is the safety net
  }, delayMs);
}

// Kick off the proactive timer if an access token already exists (page reload).
if (typeof window !== "undefined") {
  const existing = localStorage.getItem("access_token");
  if (existing) scheduleProactiveRefresh(existing);
}

// ---------------------------------------------------------------------------
// Request interceptor — inject JWT + proactive refresh if nearly expired
// ---------------------------------------------------------------------------

// Token refresh state — prevents multiple simultaneous refresh calls
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

api.interceptors.request.use(async (config) => {
  if (typeof window !== "undefined") {
    let token = localStorage.getItem("access_token");

    // Proactive refresh: if the token is about to expire, refresh before sending.
    if (token && isTokenExpiringSoon(token)) {
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = doRefresh().finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      if (newToken) token = newToken;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;

      const orgId = localStorage.getItem("selectedOrgId");
      if (orgId && orgId !== "undefined" && orgId !== "null") {
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
// Response interceptor — safety-net 401 refresh (in case proactive missed it)
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

    // Skip refresh logic for auth endpoints themselves, or if already retried
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
        // Another refresh is already in flight — queue this request
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
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        // The refresh_token cookie is HttpOnly — JS can't remove it. Ask the backend to
        // clear it (best-effort) so the middleware doesn't keep treating this dead
        // session as authenticated and bounce /login back to /dashboard forever.
        try {
          await axios.post(`${baseURL}/auth/logout`, {}, { withCredentials: true });
        } catch {
          // Ignore — worst case the stale cookie expires on its own.
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
  scheduleProactiveRefresh(accessToken);
}

