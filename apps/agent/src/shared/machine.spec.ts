import { describe, expect, it } from "vitest";

import { type NetworkAdapter, pickMac } from "./machine.js";

const adapter = (over: Partial<NetworkAdapter>): NetworkAdapter => ({
  name: "Ethernet",
  mac: "a4:bb:6d:1f:0e:22",
  internal: false,
  family: "IPv4",
  ...over,
});

describe("выбор сетевой карты", () => {
  it("берёт обычный проводной адаптер", () => {
    expect(pickMac([adapter({})])).toBe("a4:bb:6d:1f:0e:22");
  });

  it("не берёт петлевой интерфейс", () => {
    expect(pickMac([adapter({ internal: true, mac: "00:00:00:00:00:00" })])).toBeNull();
  });

  it("пропускает виртуальные адаптеры", () => {
    // MAC Hyper-V одинаков на всех машинах образа: приняв его, мы свели бы
    // весь зал в одну машину.
    const result = pickMac([
      adapter({ name: "vEthernet (Default Switch)", mac: "00:15:5d:01:02:03" }),
      adapter({ name: "Ethernet", mac: "a4:bb:6d:1f:0e:22" }),
    ]);
    expect(result).toBe("a4:bb:6d:1f:0e:22");
  });

  it("выбирает одинаково при любом порядке адаптеров", () => {
    // Система отдаёт список как придётся, а машина обязана называть себя
    // одинаково при каждой загрузке.
    const a = adapter({ name: "Ethernet 2", mac: "b0:11:11:11:11:11" });
    const b = adapter({ name: "Ethernet", mac: "a0:22:22:22:22:22" });
    expect(pickMac([a, b])).toBe(pickMac([b, a]));
  });

  it("без подходящих адаптеров возвращает пусто", () => {
    expect(pickMac([])).toBeNull();
    expect(pickMac([adapter({ family: "IPv6" })])).toBeNull();
  });
});
