import axios from "axios";

let baseURL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

if (baseURL.startsWith("http") && !baseURL.includes("/api/v1")) {
  baseURL = baseURL.replace(/\/$/, "") + "/api/v1";
}

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Add a request interceptor to inject the JWT access token and orgId
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;

      const orgId = localStorage.getItem("selectedOrgId");
      if (orgId && orgId !== "undefined" && orgId !== "null") {
        config.params = { ...config.params, orgId };
      }
    }
  }
  return config;
});

// Token refresh state — prevents multiple simultaneous refresh calls
let isRefreshing = false;
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

// Add a response interceptor that attempts token refresh on 401
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
      const refreshToken = localStorage.getItem("refresh_token");

      if (!refreshToken) {
        // No refresh token — force logout
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        if (!window.location.pathname.includes("/login") && !window.location.pathname.includes("/register")) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }

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
        const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
          `${baseURL}/auth/refresh`,
          { refresh_token: refreshToken },
        );

        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token);

        api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;

        processQueue(null, data.access_token);

        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        if (!window.location.pathname.includes("/login") && !window.location.pathname.includes("/register")) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);
