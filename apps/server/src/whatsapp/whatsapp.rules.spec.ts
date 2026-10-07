import { describe, expect, it } from "vitest";

import {
  CODE_MAX_ATTEMPTS,
  checkCode,
  inviteMessage,
  normalizePhone,
  parseInviteReply,
  phoneFromChatId,
  readIncoming,
  samePhone,
  toChatId,
} from "./whatsapp.rules.js";

describe("номер телефона", () => {
  it("одинаково понимает все привычные записи казахстанского номера", () => {
    for (const raw of ["+7 701 123-45-67", "87011234567", "7011234567", "7 (701) 123 45 67"]) {
      expect(normalizePhone(raw)).toBe("77011234567");
    }
  });

  it("российский мобильный без кода страны получает семёрку", () => {
    expect(normalizePhone("916 123 45 67")).toBe("79161234567");
  });

  it("иностранный номер с кодом страны оставляет как есть", () => {
    expect(normalizePhone("+998 90 123 45 67")).toBe("998901234567");
  });

  it("обрывок номера не превращает в чей-то чужой", () => {
    expect(normalizePhone("123-45-67")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("строит идентификатор чата и разбирает его обратно", () => {
    expect(toChatId("8 701 123 45 67")).toBe("77011234567@c.us");
    expect(phoneFromChatId("77011234567@c.us")).toBe("77011234567");
  });

  it("групповые чаты не считает гостем", () => {
    expect(phoneFromChatId("120363025555@g.us")).toBeNull();
  });

  it("сравнивает номера, записанные по-разному", () => {
    expect(samePhone("+7 701 123 45 67", "87011234567")).toBe(true);
    expect(samePhone("87011234567", "87011234568")).toBe(false);
  });
});

describe("ответ на приглашение", () => {
  it("понимает короткие согласия", () => {
    for (const text of ["1", "Да!", "иду", " +", "Ок", "👍"]) {
      expect(parseInviteReply(text)).toBe("going");
    }
  });

  it("понимает отказы", () => {
    for (const text of ["2", "нет", "Не приду", "-"]) {
      expect(parseInviteReply(text)).toBe("declined");
    }
  });

  it("отписка и возврат", () => {
    expect(parseInviteReply("СТОП")).toBe("stop");
    expect(parseInviteReply("Старт")).toBe("start");
  });

  it("обычную переписку не трогает", () => {
    expect(parseInviteReply("а во сколько начало?")).toBeNull();
    expect(parseInviteReply("да, но опоздаю минут на двадцать")).toBeNull();
    expect(parseInviteReply("")).toBeNull();
  });
});

describe("уведомление Green-API", () => {
  const incoming = {
    typeWebhook: "incomingMessageReceived",
    instanceData: { idInstance: 1101000001 },
    senderData: { chatId: "77011234567@c.us" },
    messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "1" } },
  };

  it("достаёт инстанс, номер и текст", () => {
    expect(readIncoming(incoming)).toEqual({
      instanceId: "1101000001",
      phone: "77011234567",
      text: "1",
    });
  });

  it("понимает расширенное текстовое сообщение", () => {
    const extended = {
      ...incoming,
      messageData: { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: "да" } },
    };
    expect(readIncoming(extended)?.text).toBe("да");
  });

  it("статусы доставки и группы пропускает", () => {
    expect(readIncoming({ ...incoming, typeWebhook: "outgoingMessageStatus" })).toBeNull();
    expect(readIncoming({ ...incoming, senderData: { chatId: "1203@g.us" } })).toBeNull();
    expect(readIncoming(null)).toBeNull();
  });
});

describe("код подтверждения", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const fresh = { expiresAt: new Date("2026-10-08T12:05:00Z"), attempts: 0, consumedAt: null };

  it("верный свежий код принимается", () => {
    expect(checkCode(fresh, true, now)).toBe("ok");
  });

  it("неверный — просто неверный", () => {
    expect(checkCode(fresh, false, now)).toBe("wrong");
  });

  it("просроченный не принимается, даже если совпал", () => {
    expect(checkCode({ ...fresh, expiresAt: now }, true, now)).toBe("expired");
  });

  it("после лимита ошибок код закрыт и для верного ввода", () => {
    expect(checkCode({ ...fresh, attempts: CODE_MAX_ATTEMPTS }, true, now)).toBe("locked");
  });

  it("использованный повторно не годится", () => {
    expect(checkCode({ ...fresh, consumedAt: now }, true, now)).toBe("used");
  });
});

describe("текст приглашения", () => {
  it("время ивента пишется по часам зала", () => {
    const text = inviteMessage({
      title: "Турнир по CS2",
      description: null,
      // 15:00 UTC — 20:00 в Алматы.
      startsAt: new Date("2026-10-10T15:00:00Z"),
      clubName: "Cyber-Fox Центр",
      clubCity: "Алматы",
      timezone: "Asia/Almaty",
      guestName: "Айдар Касымов",
    });

    expect(text).toContain("Айдар, приглашаем");
    expect(text).toContain("20:00");
    expect(text).toContain("Cyber-Fox Центр, Алматы");
    expect(text).toContain("СТОП");
  });
});
