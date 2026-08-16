import { type ExecutionContext, createParamDecorator } from "@nestjs/common";

import type { AuthenticatedStaff } from "./auth.types.js";

export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedStaff =>
    context.switchToHttp().getRequest<{ user: AuthenticatedStaff }>().user,
);
