import { describe, expect, it } from "vitest";

import { inviteMessage, parseInviteReply, phoneFromChatId, readIncoming, toChatId } from "./whatsapp.rules.js";

describe("номер для Green-API", () => {
  it("любая запись номера даёт один чат", () => {
    expect(toChatId("8 701 123 45 67")).toBe("77011234567@c.us");
    expect(toChatId("+7 (701) 123-45-67")).toBe("77011234567@c.us");
  });

  it("обрывок номера не превращается в чужой чат", () => {
    expect(toChatId("123-45")).toBeNull();
  });

  it("групповые чаты не считаются гостем", () => {
    expect(phoneFromChatId("77011234567@c.us")).toBe("77011234567");
    expect(phoneFromChatId("120363025555@g.us")).toBeNull();
  });
});

describe("уведомление Green-API", () => {
  const incoming = {
    typeWebhook: "incomingMessageReceived",
    instanceData: { idInstance: 1101000001 },
    senderData: { chatId: "77011234567@c.us" },
    messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Cyber-Fox 4821" } },
  };

  it("достаёт инстанс, номер и текст", () => {
    expect(readIncoming(incoming)).toEqual({
      instanceId: "1101000001",
      from: "77011234567",
      text: "Cyber-Fox 4821",
    });
  });

  it("понимает расширенное текстовое сообщение", () => {
    const extended = { ...incoming, messageData: { extendedTextMessageData: { text: "да" } } };
    expect(readIncoming(extended)?.text).toBe("да");
  });

  it("статусы доставки и группы пропускает", () => {
    expect(readIncoming({ ...incoming, typeWebhook: "outgoingMessageStatus" })).toBeNull();
    expect(readIncoming({ ...incoming, senderData: { chatId: "1203@g.us" } })).toBeNull();
    expect(readIncoming(null)).toBeNull();
  });
});

describe("ответ на приглашение", () => {
  it("короткие согласия и отказы", () => {
    for (const text of ["1", "Да!", "иду", "+"]) expect(parseInviteReply(text)).toBe("going");
    for (const text of ["2", "нет", "Не приду", "-"]) expect(parseInviteReply(text)).toBe("declined");
  });

  it("обычную переписку не трогает", () => {
    expect(parseInviteReply("а во сколько начало?")).toBeNull();
    expect(parseInviteReply("да, но опоздаю минут на двадцать")).toBeNull();
  });
});

describe("текст приглашения", () => {
  const base = {
    title: "Турнир CS2",
    subtitle: "Команды 5 на 5",
    // 15:00 UTC — 20:00 в Алматы.
    startsAt: new Date("2026-10-10T15:00:00Z"),
    place: "Cyber-Fox Центр",
    prize: "50 000 ₸",
    fee: null,
    howToJoin: null,
    timezone: "Asia/Almaty",
    guestName: "Айдар Касымов",
  };

  it("время по часам зала, пустые строки афиши не попадают", () => {
    const text = inviteMessage(base);
    expect(text).toContain("Айдар, приглашаем");
    expect(text).toContain("20:00");
    expect(text).toContain("🏆 50 000 ₸");
    expect(text).not.toContain("💳");
    expect(text).toContain("СТОП");
  });

  it("к гостю без имени не обращается «Гость 4567»", () => {
    expect(inviteMessage({ ...base, guestName: "Гость 4567" }).startsWith("Приглашаем")).toBe(true);
  });
});
