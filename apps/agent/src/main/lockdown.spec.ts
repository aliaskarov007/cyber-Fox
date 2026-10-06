import { describe, expect, it } from "vitest";

import { policies } from "./lockdown.js";

const names = (scope: "guard" | "session") =>
  new Set(policies().filter((p) => p.scope === scope).map((p) => p.name));

describe("запреты агента", () => {
  it("диспетчер задач закрыт постоянно, а не только на время игры", () => {
    // Иначе на экране блокировки Ctrl+Shift+Esc снимает агента без входа.
    expect(names("guard")).toContain("DisableTaskMgr");
    expect(names("session")).not.toContain("DisableTaskMgr");
  });

  it("выход, смена пользователя и regedit тоже постоянные", () => {
    for (const name of ["NoLogoff", "HideFastUserSwitching", "DisableRegistryTools"]) {
      expect(names("guard")).toContain(name);
    }
  });

  it("проводник и диски закрываются только на время игры", () => {
    for (const name of ["NoDrives", "NoViewOnDrive", "NoRun", "DisableCMD"]) {
      expect(names("session")).toContain(name);
      expect(names("guard")).not.toContain(name);
    }
  });

  it("каждая политика пишется в обе ветки реестра", () => {
    const count = new Map<string, number>();
    for (const p of policies()) count.set(p.name, (count.get(p.name) ?? 0) + 1);
    for (const [, n] of count) expect(n).toBe(2);
  });
});
