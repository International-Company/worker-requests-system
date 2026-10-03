import { Role } from '@prisma/client';

/** Identity attached to every authenticated HTTP request. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  sessionId: string;
  deviceRowId: string;
}
