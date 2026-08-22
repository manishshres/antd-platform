export interface ProvisioningSummary {
  totalOrganizations: number;
  active: number;
  provisioning: number;
  failed: number;
  suspended: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  webhookApiKey: string | null;
  status: string; // 'draft' | 'provisioning' | 'active' | 'suspended' | 'archived'
  featureFlags?: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisioningStep {
  id: string;
  organizationId: string;
  stepName: string;
  stepOrder: number;
  status: string; // 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProvisioningStatusResponse {
  organization: Organization;
  steps: ProvisioningStep[];
  isComplete: boolean;
  hasFailures: boolean;
}

export interface CreateOrgProvisionDto {
  orgName: string;
  adminEmail: string;
  locationName: string;
  country: string;
  state?: string;
  city?: string;
  phoneNumber?: string;
  baseAgentId?: string;
  dynamicVariables?: Record<string, string>;
  menuUrl?: string;
  /** Reuse the base agent's number instead of buying one. Default false. */
  useAgentPhoneNumber?: boolean;
}

export interface AgentPhoneNumber {
  phoneNumber: string;
  telnyxPhoneNumberId: string;
  claimedByLocationId: string | null;
  claimedByLocationName: string | null;
}
