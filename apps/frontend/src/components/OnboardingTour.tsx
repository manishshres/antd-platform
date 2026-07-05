"use client";

import { useEffect, useState } from "react";
import { Tour } from "antd";
import type { TourProps } from "antd";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "onboarding_done";

/**
 * First-run onboarding walkthrough (E8) built on Ant Design's Tour. Steps use centered cards
 * (target: null) so they don't depend on any particular element being mounted, and each step's
 * primary action routes to the relevant page. Runs automatically once per browser (guarded by a
 * localStorage flag) and can be re-launched anywhere via the `start-onboarding` window event.
 */
export default function OnboardingTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Auto-start on the first authenticated visit only.
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const onStart = () => setOpen(true);
    window.addEventListener("start-onboarding", onStart);
    return () => window.removeEventListener("start-onboarding", onStart);
  }, []);

  const finish = () => {
    setOpen(false);
    localStorage.setItem(STORAGE_KEY, "1");
  };

  const go = (href: string) => {
    finish();
    router.push(href);
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
      nextButtonProps: { children: "Open menu", onClick: () => go("/menus") },
    },
    {
      title: "2. Forward your calls",
      description:
        "Point your restaurant's phone number to your provisioned AI line so incoming calls are answered automatically.",
      target: null,
      nextButtonProps: { children: "Set up calls", onClick: () => go("/calls") },
    },
    {
      title: "3. Connect a printer",
      description:
        "Link a kitchen or receipt printer so confirmed orders print automatically the moment they come in.",
      target: null,
      nextButtonProps: {
        children: "Manage printers",
        onClick: () => go("/printers"),
      },
    },
    {
      title: "4. Place a test order",
      description:
        "Create a mock order to see the full flow end to end — from order capture to kitchen printout.",
      target: null,
      nextButtonProps: { children: "Go to orders", onClick: () => go("/orders") },
    },
  ];

  return (
    <Tour open={open} onClose={finish} onFinish={finish} steps={steps} />
  );
}
