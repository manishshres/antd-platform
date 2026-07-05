"use client";

import { useEffect, useState } from "react";
import { Tour } from "antd";
import type { TourProps } from "antd";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/**
 * Route each step navigates the background page to as the user advances. `null` = stay put
 * (the welcome step). The tour itself stays mounted/open across these client navigations because
 * it lives in the persistent DashboardLayout, so the card remains centered while the page behind
 * it changes to the one being described.
 */
const STEP_ROUTES: (string | null)[] = [null, "/menus", "/calls", "/printers", "/orders"];

/**
 * First-run onboarding walkthrough (E8) built on Ant Design's Tour. Steps use centered cards
 * (target: null) so they don't depend on any particular element being mounted. Completion is
 * persisted server-side (users.onboardingCompletedAt) rather than in browser localStorage, so the
 * tour won't re-appear on another device/browser. Re-launchable anywhere via the
 * `start-onboarding` window event (wired to the profile menu's "Take a tour").
 */
export default function OnboardingTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);

  // Auto-start on first visit, decided by the DB-persisted flag (not localStorage).
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ onboardingCompletedAt?: string | null }>("/users/me")
      .then(({ data }) => {
        if (!cancelled && !data?.onboardingCompletedAt) {
          setCurrent(0);
          setOpen(true);
        }
      })
      .catch(() => {
        /* If we can't determine status, don't nag the user. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onStart = () => {
      setCurrent(0);
      setOpen(true);
    };
    window.addEventListener("start-onboarding", onStart);
    return () => window.removeEventListener("start-onboarding", onStart);
  }, []);

  const finish = () => {
    setOpen(false);
    // Idempotent server-side completion; ignore failures so a hiccup never blocks the UI.
    api.post("/users/me/onboarding").catch(() => {});
  };

  const handleChange = (next: number) => {
    setCurrent(next);
    const route = STEP_ROUTES[next];
    if (route) router.push(route);
  };

  const steps: TourProps["steps"] = [
    {
      title: "Welcome to your Call Center AI",
      description:
        "Let's get your restaurant taking AI-powered phone orders in four quick steps. You can revisit this tour anytime from your profile menu.",
      target: null,
    },
    {
      title: "1. Build your menu",
      description:
        "Add categories and items — or import an existing menu straight from your website. The AI uses this to take accurate orders.",
      target: null,
    },
    {
      title: "2. Forward your calls",
      description:
        "Point your restaurant's phone number to your provisioned AI line so incoming calls are answered automatically.",
      target: null,
    },
    {
      title: "3. Connect a printer",
      description:
        "Link a kitchen or receipt printer so confirmed orders print automatically the moment they come in.",
      target: null,
    },
    {
      title: "4. Place a test order",
      description:
        "Create a mock order to see the full flow end to end — from order capture to kitchen printout.",
      target: null,
    },
  ];

  return (
    <Tour
      open={open}
      current={current}
      onChange={handleChange}
      onClose={finish}
      onFinish={finish}
      steps={steps}
    />
  );
}
