import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { Membership } from './membership';
import type { OrgRequest } from './org.guard';

/** Die vom OrgGuard geprüfte Mitgliedschaft des Aufrufers in der Organisation des Pfads. */
export const CurrentMembership = createParamDecorator(
  (_daten: unknown, context: ExecutionContext): Membership =>
    context.switchToHttp().getRequest<OrgRequest>().membership as Membership
);

/** Die Konto-ID aus dem verifizierten Token (vom JwtAuthGuard gesetzt). */
export const CurrentUserId = createParamDecorator(
  (_daten: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<OrgRequest>().userId as string
);
