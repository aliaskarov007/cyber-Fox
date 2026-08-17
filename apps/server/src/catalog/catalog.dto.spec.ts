import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreateTariffDto, UpdateComputerDto, UpdateTariffDto, UpdateZoneDto } from "./catalog.dto.js";

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

/*
 * Правки зоны и машины касса тоже шлёт одним полем: выбор тарифа в строке зоны
 * и перенос машины в другую зону. Ошибка, найденная на тарифах, ловится здесь
 * до того, как повторится.
 */
describe("правка одним полем", () => {
  it("зона: только тариф на исчерпание пакета", () => {
    expect(errorsFor(UpdateZoneDto, { defaultPerMinuteTariffId: "tariff-1" })).toEqual([]);
  });

  it("машина: только новая зона", () => {
    expect(errorsFor(UpdateComputerDto, { zoneId: "zone-2" })).toEqual([]);
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
