import { getLocations } from '../db/catalogRepo';
import type { BusinessInfo } from './receiptFormatter';
import type { PosSettings } from '../types';

/**
 * Receipt header details for the register's current location.
 *
 * The catalog already carries the org name, address and phone for every synced location —
 * the print path just never read them, so receipts showed the branch name alone. Falls
 * back to the cached settings name when the catalog has not synced yet, so a receipt still
 * prints on a fresh register instead of failing.
 */
export function currentBusinessInfo(settings: PosSettings): BusinessInfo {
  const location = getLocations().find((l) => l.id === settings.locationId);

  if (!location) {
    return { locationName: settings.locationName };
  }

  return {
    organizationName: location.organizationName,
    locationName: location.name,
    address: location.address,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    phoneNumber: location.phoneNumber,
  };
}
