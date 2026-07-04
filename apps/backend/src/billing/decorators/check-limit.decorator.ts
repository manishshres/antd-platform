import { SetMetadata } from '@nestjs/common';

export const PLAN_LIMIT_KEY = 'plan_limit_resource';
export type PlanLimitResource =
  'voiceAgents' | 'phoneNumbers' | 'websiteImports';

export const CheckLimit = (resource: PlanLimitResource) =>
  SetMetadata(PLAN_LIMIT_KEY, resource);
