import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  // Сырое тело нужно вебхуку платежей: подпись считается по байтам запроса,
  // и пересобранный JSON её ломает.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix("api");

  /*
   * В бою кассовый экран и API живут на одном домене, поэтому список
   * разрешённых источников задаётся явно. Пустой список — режим разработки:
   * там админка на 5173, агент на 5174, и перечислять их в настройках
   * бессмысленно.
   */
  const origins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  app.enableCors({ origin: origins.length > 0 ? origins : true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
