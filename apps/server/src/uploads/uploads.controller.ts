import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { coverFileName, isAllowedCover } from "./cover-name.js";

/** Куда складываются обложки. Отдельный том, чтобы переживать пересборку образа. */
export const COVERS_DIR = process.env.CYBERFOX_COVERS_DIR ?? "/data/covers";

/** Два мегабайта: обложка — картинка на плитку, а не постер для печати. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Обложка, загруженная файлом.
 *
 * Ссылку на картинку в интернете находят не всегда: у игр из сборок её нет
 * вовсе, а искать похожую по названию администратору некогда. Поэтому картинку
 * можно просто загрузить — она ляжет рядом с сервером и будет раздаваться по
 * своему адресу.
 */
@Controller("clubs/:clubId/uploads")
export class UploadsController {
  constructor(private readonly access: ClubAccessService) {}

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("cover")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  async cover(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    await this.access.requireClub(staff, clubId);

    if (!file) throw new BadRequestException("Файл не пришёл");
    if (!isAllowedCover(file.mimetype)) {
      throw new BadRequestException("Обложка должна быть картинкой: JPG, PNG или WebP");
    }

    const name = coverFileName(randomUUID(), file.mimetype, file.originalname);
    await mkdir(COVERS_DIR, { recursive: true });
    await writeFile(join(COVERS_DIR, name), file.buffer);

    // Адрес, а не файл: в каталоге игр обложка хранится ссылкой, и загруженная
    // картинка ничем не отличается от взятой со Steam.
    return { url: `/api/covers/${name}` };
  }
}
