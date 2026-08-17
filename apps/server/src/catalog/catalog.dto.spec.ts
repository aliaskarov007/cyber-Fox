import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreateTariffDto, UpdateTariffDto } from "./catalog.dto.js";

/**
 * Проверки самих правил разбора запроса.
 *
 * Повод конкретный: правка тарифа наследовала обязательные поля от создания, и
 * касса, выключая тариф одним полем, получала отказ с требованием прислать
 * название, зону и вид. Разница между «создать» и «поправить» видна только
 * здесь, поэтому и проверяется отдельно.
 */

function errorsFor(dto: object, body: Record<string, unknown>): string[] {
  const instance = plainToInstance(dto as never, body);
  return validateSync(instance as object).flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe("правка тарифа", () => {
  it("принимает одно поле: касса выключает тариф, не пересылая остального", () => {
    expect(errorsFor(UpdateTariffDto, { isActive: false })).toEqual([]);
  });

  it("обнуление полей другого вида проходит: null стирает цену пакета", () => {
    expect(
      errorsFor(UpdateTariffDto, {
        kind: "PER_MINUTE",
        pricePerMinute: 500,
        packageMinutes: null,
        packagePrice: null,
        validityDays: null,
      }),
    ).toEqual([]);
  });

  it("бережёт проверки полей, которые всё же прислали", () => {
    expect(errorsFor(UpdateTariffDto, { pricePerMinute: 0 })).toContain("min");
    expect(errorsFor(UpdateTariffDto, { activeFromMinute: 1440 })).toContain("max");
  });
});

describe("создание тарифа", () => {
  it("требует название, зону и вид: тариф без них не привязать к машинам", () => {
    const errors = errorsFor(CreateTariffDto, { pricePerMinute: 500 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("принимает полный поминутный тариф", () => {
    expect(
      errorsFor(CreateTariffDto, {
        name: "Стандарт",
        zoneId: "zone-1",
        kind: "PER_MINUTE",
        pricePerMinute: 500,
      }),
    ).toEqual([]);
  });
});
