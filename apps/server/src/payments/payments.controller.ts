import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { IsInt, Min } from "class-validator";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Public } from "../auth/guards.js";
import { HmacPaymentProvider } from "./payment.provider.js";
import { PaymentsService } from "./payments.service.js";

class TopUpDto {
  /** Сумма в тиын. */
  @IsInt()
  @Min(1)
  amount!: number;
}

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly provider: HmacPaymentProvider,
  ) {}

  @Post("clubs/:clubId/guests/:guestId/online-topup")
  createTopUp(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: TopUpDto,
  ) {
    return this.payments.createTopUp(staff, clubId, guestId, dto.amount);
  }

  @Get("clubs/:clubId/payments")
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.payments.list(staff, clubId);
  }

  @Post("payments/:intentId/confirm")
  confirmManually(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("intentId") intentId: string,
  ) {
    return this.payments.confirmManually(staff, intentId);
  }

  @Post("subscription/invoices/:invoiceId/pay")
  payInvoice(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("invoiceId") invoiceId: string,
  ) {
    return this.payments.createInvoicePayment(staff, invoiceId);
  }

  /**
   * Подтверждение от провайдера.
   *
   * Единственная точка системы, открытая наружу без токена, поэтому защита
   * держится на подписи тела запроса. Подпись считается по сырому телу: любая
   * пересборка JSON изменила бы байты и сломала проверку.
   */
  @Public()
  @Post("payments/webhook")
  async webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const rawBody = request.rawBody?.toString("utf8") ?? "";
    const read = this.provider.readWebhook(rawBody, headers);

    if (!read.ok || !read.providerRef) {
      throw new BadRequestException(read.reason ?? "Подтверждение отклонено");
    }

    const result = await this.payments.confirm(read.providerRef, {
      paid: read.paid ?? false,
      amount: read.amount ?? 0,
    });

    // Отвечаем успехом и на дубль: иначе провайдер будет слать вебхук по кругу.
    return { ok: true, applied: result.applied };
  }
}
