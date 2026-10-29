import { describe, expect, it } from "vitest";

import {
  JoinRefusal,
  askNameAgainMessage,
  askNameMessage,
  canJoinTeam,
  captainMessage,
  findTeamCode,
  gatherDeadline,
  makeTeamCode,
  newGuestTopUpMessage,
  prizeBreakdown,
  prizePool,
  slotsLeft,
  teamNameFrom,
  teamState,
  topUpPrompt,
  tournamentInviteMessage,
  wantsTeam,
} from "./tournament.rules.js";

describe("код команды", () => {
  it("состоит из знаков, которые не перепутать при переписывании", () => {
    const code = makeTeamCode(() => 0);
    expect(code).toBe("TM-2222");
    expect(code).not.toMatch(/[01OIL]/);
  });

  it("находится внутри сообщения с подписью от себя", () => {
    // Капитан перешлёт код с текстом, напарник допишет своё.
    expect(findTeamCode("TM-4F3A")).toBe("TM-4F3A");
    expect(findTeamCode("я в деле, код tm 4f3a")).toBe("TM-4F3A");
    expect(findTeamCode("Код команды: TM-4F3A — залетай")).toBe("TM-4F3A");
  });

  it("не путается с кодом регистрации", () => {
    // Тот же конвейер входящих разбирает и CF-коды.
    expect(findTeamCode("CF-4F3A")).toBeNull();
  });

  it("не принимает обрывки", () => {
    expect(findTeamCode("TM-4F3")).toBeNull();
    expect(findTeamCode("TM-4F3AB")).toBeNull();
    expect(findTeamCode("")).toBeNull();
  });

  it("достаёт название команды рядом с кодом", () => {
    expect(teamNameFrom("TM-4F3A Лисята", "TM-4F3A")).toBe("Лисята");
    expect(teamNameFrom("TM-4F3A", "TM-4F3A")).toBeNull();
  });
});

describe("ответ «ищу команду»", () => {
  it("узнаётся в разных формах", () => {
    for (const text of ["3", "ищу команду", "Один", "без команды"]) {
      expect(wantsTeam(text)).toBe(true);
    }
  });

  it("не срабатывает на обычном согласии", () => {
    expect(wantsTeam("1")).toBe(false);
    expect(wantsTeam("приду")).toBe(false);
  });
});

describe("призовой фонд", () => {
  it("складывается из взносов и добавки клуба", () => {
    // 8 человек по 1000 ₸, клуб добавил 10 000 ₸, своей доли не берёт.
    expect(
      prizePool({ paidEntries: 8, entryFee: 100_000, clubFeePercent: 0, clubBonus: 1_000_000 }),
    ).toBe(1_800_000);
  });

  it("доля клуба вычитается из взносов, а не из добавки", () => {
    // 8 × 1000 ₸ = 8000 ₸, клуб берёт 20 % = 1600 ₸, добавляет 10 000 ₸.
    expect(
      prizePool({ paidEntries: 8, entryFee: 100_000, clubFeePercent: 20, clubBonus: 1_000_000 }),
    ).toBe(1_640_000);
  });

  it("на пустом турнире равен только добавке клуба", () => {
    expect(
      prizePool({ paidEntries: 0, entryFee: 100_000, clubFeePercent: 10, clubBonus: 500_000 }),
    ).toBe(500_000);
  });

  it("доля клуба округляется вниз — копейки остаются гостям", () => {
    // 3 × 333 тиын = 999, 33 % от них — 329,67, клубу достаётся 329.
    expect(prizePool({ paidEntries: 3, entryFee: 333, clubFeePercent: 33, clubBonus: 0 })).toBe(670);
  });
});

describe("разбивка по местам", () => {
  it("делит фонд по заданным долям", () => {
    expect(prizeBreakdown(1_000_000, [50, 30, 20])).toEqual([500_000, 300_000, 200_000]);
  });

  it("отдаёт остаток от деления первому месту", () => {
    // Иначе сумма призов не сошлась бы с фондом, и отчёт разошёлся бы на копейки.
    const shares = prizeBreakdown(1_000_001, [50, 30, 20]);
    expect(shares.reduce((sum, s) => sum + s, 0)).toBe(1_000_001);
    expect(shares[0]).toBe(500_001);
  });

  it("работает с нестандартными долями", () => {
    const shares = prizeBreakdown(900_000, [70, 30]);
    expect(shares).toEqual([630_000, 270_000]);
  });

  it("доли, не дающие сотни, всё равно раздают весь фонд", () => {
    // Владелец задал 60/30 — десять процентов «потерялись» бы без остатка.
    const shares = prizeBreakdown(1_000_000, [60, 30]);
    expect(shares.reduce((sum, s) => sum + s, 0)).toBe(1_000_000);
  });

  it("пустой фонд не раздаётся", () => {
    expect(prizeBreakdown(0, [50, 30, 20])).toEqual([]);
  });
});

describe("состояние команды", () => {
  it("укомплектована, когда все оплатили", () => {
    expect(teamState({ teamSize: 2, paidMembers: 2 })).toBe("READY");
    expect(teamState({ teamSize: 5, paidMembers: 4 })).toBe("GATHERING");
  });

  it("турнир одиночек укомплектован сразу после оплаты", () => {
    expect(teamState({ teamSize: 1, paidMembers: 1 })).toBe("READY");
  });

  it("срок сбора отсчитывается от оплаты капитана", () => {
    const paid = new Date("2026-10-25T12:00:00Z");
    expect(gatherDeadline(paid, 360).toISOString()).toBe("2026-10-25T18:00:00.000Z");
  });
});

describe("вход в команду", () => {
  const base = {
    tournamentStatus: "REGISTRATION" as const,
    teamStatus: "GATHERING" as const,
    teamSize: 5,
    membersInTeam: 3,
    alreadyEntered: false,
  };

  it("обычный напарник входит", () => {
    expect(canJoinTeam(base)).toEqual({ ok: true, reason: null });
  });

  it("второй раз на тот же турнир — нельзя", () => {
    // Иначе один человек занял бы места в двух командах.
    expect(canJoinTeam({ ...base, alreadyEntered: true }).reason).toBe(
      JoinRefusal.ALREADY_IN_TOURNAMENT,
    );
  });

  it("в полную команду — нельзя", () => {
    expect(canJoinTeam({ ...base, membersInTeam: 5 }).reason).toBe(JoinRefusal.TEAM_FULL);
  });

  it("в расформированную — нельзя", () => {
    expect(canJoinTeam({ ...base, teamStatus: "DISBANDED" }).reason).toBe(
      JoinRefusal.TEAM_DISBANDED,
    );
  });

  it("после закрытия записи — нельзя", () => {
    expect(canJoinTeam({ ...base, tournamentStatus: "CLOSED" }).reason).toBe(
      JoinRefusal.REGISTRATION_CLOSED,
    );
  });

  it("проверка «уже записан» идёт раньше остальных", () => {
    // Человеку важнее узнать, что он уже в составе, чем что турнир закрыт.
    expect(
      canJoinTeam({ ...base, alreadyEntered: true, tournamentStatus: "CLOSED" }).reason,
    ).toBe(JoinRefusal.ALREADY_IN_TOURNAMENT);
  });
});

describe("свободные места", () => {
  it("собирающаяся команда держит место наравне с собранной", () => {
    // Иначе турнир продался бы дважды: место ушло бы и капитану, и следующему.
    expect(slotsLeft({ slots: 8, activeTeams: 5 })).toBe(3);
  });

  it("ниже нуля не уходит", () => {
    expect(slotsLeft({ slots: 8, activeTeams: 9 })).toBe(0);
  });
});

describe("тексты гостю", () => {
  const base = {
    title: "Турнир CS2",
    description: null,
    when: "сб, 19:00",
    place: "Cyber-Fox Центральный",
    guestName: "Айдос Серикулы",
    entryFee: 100_000,
    slotsLeft: 3,
    prizePool: 1_800_000,
  };

  it("командный турнир предлагает третий ответ — поиск команды", () => {
    const text = tournamentInviteMessage({ ...base, teamSize: 2 });
    expect(text).toContain("3 — ищу команду");
    expect(text).toContain("2×2");
  });

  it("турнир одиночек третьего ответа не предлагает", () => {
    // Искать команду там не в чем: предложить это значило бы сбить человека.
    const text = tournamentInviteMessage({ ...base, teamSize: 1 });
    expect(text).not.toContain("3 —");
    expect(text).toContain("1 — участвую");
  });

  it("показывает взнос, фонд и остаток мест в тенге", () => {
    // Разделитель разрядов в русской локали — неразрывный пробел, поэтому
    // сравниваем по шаблону, а не по строке с невидимым символом внутри.
    const text = tournamentInviteMessage({ ...base, teamSize: 2 });
    expect(text).toMatch(/Взнос 1\s000 ₸/u);
    expect(text).toMatch(/фонд 18\s000 ₸/u);
    expect(text).toContain("Свободных мест: 3");
  });

  it("обращается по имени, а не по полному имени", () => {
    expect(tournamentInviteMessage({ ...base, teamSize: 1 })).toContain("Айдос, зовём");
  });

  it("подсказка о пополнении называет недостающую сумму", () => {
    expect(topUpPrompt(30_000)).toContain("300 ₸");
  });

  it("капитану уходит код для напарников", () => {
    const text = captainMessage({ code: "TM-4F3A", teamSize: 5, filled: 1 });
    expect(text).toContain("TM-4F3A");
    expect(text).toContain("1 из 5");
  });
});

describe("незнакомый номер", () => {
  it("вопрос об имени называет турнир, команду и взнос", () => {
    const text = askNameMessage({ title: "Турнир CS2", teamName: "Лисята", entryFee: 100_000 });
    expect(text).toContain("«Лисята»");
    expect(text).toContain("«Турнир CS2»");
    expect(text).toMatch(/Взнос 1\s000 ₸/u);
    expect(text).toContain("Как вас записать?");
  });

  it("без названия команды спрашивает так же, не показывая пустых кавычек", () => {
    const text = askNameMessage({ title: "Кубок осени", teamName: null, entryFee: 100_000 });
    expect(text).toContain("в команду на турнир «Кубок осени»");
    expect(text).not.toContain("«»");
  });

  it("не заикается, когда ивент и так назван турниром", () => {
    // Клубы называют ивенты «Турнир CS2» — «на турнир «Турнир CS2»» читается
    // как опечатка и попадается на глаза каждому новому участнику.
    const text = askNameMessage({ title: "Турнир CS2", teamName: null, entryFee: 100_000 });
    expect(text).toContain("на «Турнир CS2»");
    expect(text).not.toContain("турнир «Турнир");
  });

  it("цену называет до имени, а не после", () => {
    // Узнать взнос после того, как оставил имя, — повод почувствовать себя
    // обманутым; в одном сообщении порядок строк это и обеспечивает.
    const text = askNameMessage({ title: "Турнир CS2", teamName: null, entryFee: 100_000 });
    expect(text.indexOf("Взнос")).toBeLessThan(text.indexOf("Как вас записать?"));
  });

  it("при нехватке денег называет сумму и сам код команды", () => {
    const text = newGuestTopUpMessage("Айдос", 100_000, "TM-4F3A");
    expect(text).toContain("Айдос");
    expect(text).toMatch(/не хватает 1\s000 ₸/u);
    expect(text).toContain("TM-4F3A");
    expect(text).toContain("номер подтверждён");
  });

  it("непонятный ответ переспрашивает, не отказывая", () => {
    expect(askNameAgainMessage()).toContain("Пришлите");
    expect(askNameAgainMessage()).not.toMatch(/отказ|нельзя|ошибка/i);
  });
});

describe("название команды", () => {
  it("берётся до первого знака препинания", () => {
    // «TM-4F3A Лисята, мы в деле» — название «Лисята», а не вся фраза.
    expect(teamNameFrom("TM-4F3A Лисята, мы в деле", "TM-4F3A")).toBe("Лисята");
  });

  it("длинную приписку названием не считает", () => {
    expect(teamNameFrom("TM-4F3A я уже в деле погнали", "TM-4F3A")).toBeNull();
  });

  it("принимает название из двух-трёх слов", () => {
    expect(teamNameFrom("TM-4F3A Лисята из Алматы", "TM-4F3A")).toBe("Лисята из Алматы");
  });

  it("без приписки названия нет", () => {
    expect(teamNameFrom("TM-4F3A", "TM-4F3A")).toBeNull();
  });
});
