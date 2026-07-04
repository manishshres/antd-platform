"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spin } from "antd";

const ROLE_WEIGHTS: Record<string, number> = {
  platform_admin: 100,
  sysadmin: 50,
  owner: 50,
  admin: 50,
  manager: 30,
  user: 10,
};

export function withRoleGuard(WrappedComponent: React.ComponentType<any>, requiredRole: string) {
  return function RoleGuardedComponent(props: any) {
    const [authorized, setAuthorized] = useState<boolean | null>(null);
    const router = useRouter();

    useEffect(() => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        const payload = token.split(".")[1];
        const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        const userRole = decoded.role || "user";
        
        // Admin@manish.dev is a hardcoded platform_admin superuser in the system
        const isSuperuser = decoded.role === 'platform_admin';
        
        const userWeight = isSuperuser ? 100 : (ROLE_WEIGHTS[userRole.toLowerCase()] || 0);
        const requiredWeight = ROLE_WEIGHTS[requiredRole.toLowerCase()] || 0;

        if (userWeight >= requiredWeight) {
          setAuthorized(true);
        } else {
          router.replace("/dashboard");
        }
      } catch (err) {
        router.replace("/login");
      }
    }, [router]);

    if (authorized === null) {
      return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
          <Spin size="large" />
        </div>
      );
    }

    if (authorized === false) {
      return null; // Will redirect
    }

    return <WrappedComponent {...props} />;
  };
}
