"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { getAccessToken, onTokenChange } from "@/lib/token-store";
import { decodeRoleFromToken } from "@/lib/jwt";

export interface Location {
  id: string;
  name: string;
  slug: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
  phoneNumber?: string;
  status: string;
  aiSettings?: {
    dynamicVariables?: Record<string, string>;
    menuBucket?: string;
  };
  taxRateBps?: number;
  /**
   * Printing event matrix per document type ({ kitchen, receipt } each with
   * onSave/onUpdate/onPaid/copies). Older rows may still carry the legacy
   * kitchenEnabled/holdUnpaidKitchen keys — consumers normalize.
   */
  printSettings?: Record<string, unknown>;
  telnyxAssistantId?: string | null;
  menuLastSyncedAt?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface LocationContextType {
  locations: Location[];
  selectedLocation: Location | null;
  selectedLocationId: string | null;
  setSelectedLocationId: (id: string) => void;
  organizations: Organization[];
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string) => void;
  loading: boolean;
  refreshLocations: () => Promise<void>;
  userRole: string;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

/** Read the role from the stored JWT synchronously (SSR-safe). */
function getRoleFromToken(): string {
  if (typeof window === "undefined") return "user";
  return decodeRoleFromToken(getAccessToken() ?? "");
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedLocationId");
    }
    return null;
  });
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Initialise the role synchronously from the token so the first render already knows whether
  // this is a platform admin. Otherwise the initial (false) value makes the load effect run the
  // non-admin path first — GET /locations with no org — which returns nothing for a platform
  // admin and leaves no location selected until a racy second fetch.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(
    () => getRoleFromToken() === "platform_admin",
  );
  const [userRole, setUserRole] = useState(getRoleFromToken);

  useEffect(() => {
    const updateAuth = () => {
      const token = getAccessToken();
      const r = token ? decodeRoleFromToken(token) : "user";
      setUserRole(r);
      setIsPlatformAdmin(r === "platform_admin");
    };

    updateAuth();
    window.addEventListener("storage", updateAuth);
    window.addEventListener("auth-change", updateAuth);
    const unsub = onTokenChange(() => updateAuth());
    return () => {
      window.removeEventListener("storage", updateAuth);
      window.removeEventListener("auth-change", updateAuth);
      unsub();
    };
  }, []);

  const fetchLocations = useCallback(async (orgId?: string | null) => {
    try {
      const { data } = await api.get<Location[]>("/locations", {
        params: orgId ? { orgId } : undefined,
      });
      setLocations(data);
      
      if (data.length > 0) {
        const savedId = localStorage.getItem("selectedLocationId");
        if (userRole === "manager") {
          // Manager is locked to their single location (assuming they only get 1 from API)
          setSelectedLocationIdState(data[0].id);
          localStorage.setItem("selectedLocationId", data[0].id);
        } else if (savedId && data.find((loc) => loc.id === savedId)) {
          setSelectedLocationIdState(savedId);
        } else {
          setSelectedLocationIdState(data[0].id);
          localStorage.setItem("selectedLocationId", data[0].id);
        }
      } else {
        setSelectedLocationIdState(null);
      }
    } catch (err: any) {
      if (err?.message !== "Refresh failed") {
        console.error("Failed to fetch locations", err);
      }
    }
  }, [userRole]);

  const fetchOrganizations = useCallback(async (): Promise<string | undefined> => {
    try {
      const { data } = await api.get<Organization[]>("/admin/organizations");
      setOrganizations(data);
      if (data.length > 0) {
        const savedOrgId = localStorage.getItem("selectedOrgId");
        if (savedOrgId && data.find((org) => org.id === savedOrgId)) {
          setSelectedOrgIdState(savedOrgId);
          return savedOrgId;
        } else {
          setSelectedOrgIdState(data[0].id);
          localStorage.setItem("selectedOrgId", data[0].id);
          return data[0].id;
        }
      }
    } catch (err: any) {
      if (err?.message !== "Refresh failed") {
        console.error("Failed to fetch organizations", err);
      }
    }
    return undefined;
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      setLoading(true);
      const load = async () => {
        let currentOrgId: string | undefined;
        if (isPlatformAdmin) {
          currentOrgId = await fetchOrganizations();
          if (!currentOrgId) {
            setLocations([]);
            setLoading(false);
            return;
          }
        }
        await fetchLocations(currentOrgId);
        setLoading(false);
      };
      load();
    } else {
      setLoading(false);
    }
  }, [fetchLocations, fetchOrganizations, isPlatformAdmin]);

  const setSelectedLocationId = (id: string) => {
    if (userRole === "manager") return;
    if (!id || id === "undefined" || id === "null") return;
    if (locations.find((loc) => loc.id === id)) {
      setSelectedLocationIdState(id);
      localStorage.setItem("selectedLocationId", id);
    }
  };

  const setSelectedOrgId = (id: string) => {
    if (!id || id === "undefined" || id === "null") return;
    if (organizations.find((org) => org.id === id)) {
      setSelectedOrgIdState(id);
      localStorage.setItem("selectedOrgId", id);
      fetchLocations(id);
    }
  };

  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) || null;

  return (
    <LocationContext.Provider
      value={{
        locations,
        selectedLocation,
        selectedLocationId,
        setSelectedLocationId,
        organizations,
        selectedOrgId,
        setSelectedOrgId,
        loading,
        refreshLocations: async () => {
          await fetchLocations(selectedOrgId);
        },
        userRole,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context;
}
