import { Injectable } from "@nestjs/common";

/**
 * Что происходило с WhatsApp в последний раз — для экрана подключения в кассе.
 *
 * Подключение у Meta настраивают руками, и ошибиться легко: не тот App Secret,
 * приложение в режиме разработки, вебхук не подписан на messages. Снаружи всё это
 * выглядит одинаково — «гость отправил код, а экран ждёт». Здесь видно, на каком
 * шаге застряло: Meta проверила адрес, сообщения доходят, подпись сходится.
 *
 * Хранится в памяти: после перезапуска сервера проверку достаточно повторить
 * одним сообщением «проверка».
 */
@Injectable()
export class WhatsappMonitor {
  lastVerifiedAt: Date | null = null;
  lastMessageAt: Date | null = null;
  lastMessageFrom: string | null = null;
  lastSignatureFailureAt: Date | null = null;

  verified(): void {
    this.lastVerifiedAt = new Date();
  }

  message(from: string): void {
    this.lastMessageAt = new Date();
    this.lastMessageFrom = maskPhone(from);
  }

  signatureFailed(): void {
    this.lastSignatureFailureAt = new Date();
  }
}

/** «+7 701 ••• •• 67» — в кассе виден номер, но не целиком. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ••• •• ${digits.slice(-2)}`;
}
