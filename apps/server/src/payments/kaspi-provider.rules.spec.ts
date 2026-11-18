import { describe, expect, it } from "vitest";

import {
  KASPI_ACCOUNT_REGEX,
  KaspiResult,
  accountToPhone,
  buildReply,
  formatSum,
  isAllowedIp,
  maskGuestName,
  parseAllowedIps,
  parseBin,
  parsePayLink,
  parseSum,
  parseTxnDate,
  parseTxnId,
  payLinkFor,
  withBin,
} from "./kaspi-provider.rules.js";

describe("протокол провайдера Kaspi", () => {
  it("номер гостя принимается в любом из привычных видов", () => {
    expect(accountToPhone("7071234567")).toBe("77071234567");
    expect(accountToPhone("87071234567")).toBe("77071234567");
    expect(accountToPhone("+77071234567")).toBe("77071234567");
    expect(accountToPhone("77071234567")).toBe("77071234567");
    expect(accountToPhone("12345")).toBeNull();
    expect(accountToPhone("79161234567")).toBeNull();
  });

  it("регулярное выражение для Kaspi совпадает с разбором номера", () => {
    const re = new RegExp(KASPI_ACCOUNT_REGEX);
    for (const ok of ["7071234567", "87071234567", "+77071234567", "77071234567"]) {
      expect(re.test(ok)).toBe(true);
      expect(accountToPhone(ok)).not.toBeNull();
    }
    expect(re.test("9161234567")).toBe(false);
  });

  it("сумма — тиын без потерь на дробях", () => {
    expect(parseSum("500.00")).toBe(50_000);
    expect(parseSum("0.10")).toBe(10);
    expect(parseSum("199.9")).toBe(19_990);
    expect(parseSum("200")).toBe(20_000);
    expect(parseSum("0.00")).toBeNull();
    expect(parseSum("-5.00")).toBeNull();
    expect(parseSum("1,5")).toBeNull();
    expect(formatSum(50_000)).toBe("500.00");
    expect(formatSum(19_905)).toBe("199.05");
  });

  it("txn_id до 18 цифр хранится строкой без округления", () => {
    expect(parseTxnId("123456789012345678")).toBe("123456789012345678");
    expect(parseTxnId("1234567890123456789")).toBeNull();
    expect(parseTxnId("12a")).toBeNull();
  });

  it("txn_date — время Казахстана", () => {
    expect(parseTxnDate("20110101120005")?.toISOString()).toBe("2011-01-01T07:00:05.000Z");
    expect(parseTxnDate("2011-01-01")).toBeNull();
  });

  it("пускаем только адреса Kaspi", () => {
    const allowed = parseAllowedIps(undefined);
    expect(isAllowedIp("194.187.247.152", allowed)).toBe(true);
    expect(isAllowedIp("::ffff:194.187.245.108", allowed)).toBe(true);
    expect(isAllowedIp("1.2.3.4", allowed)).toBe(false);
    expect(parseAllowedIps("10.0.0.1, 10.0.0.2")).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("фамилия гостя скрыта", () => {
    expect(maskGuestName("Нурбол Әлиасқаров")).toBe("Нурбол Ә.");
    expect(maskGuestName("Fox")).toBe("Fox");
  });

  it("ответ собран по формату протокола", () => {
    expect(
      buildReply({ txnId: "1234567", result: KaspiResult.OK, prvTxnId: 2016n, sum: 50_000, comment: "OK" }),
    ).toEqual({ txn_id: "1234567", prv_txn_id: "2016", result: 0, sum: "500.00", comment: "OK" });

    expect(buildReply({ txnId: "1", result: KaspiResult.OK, fields: [["Гость", "Нурбол Ә."]] }).fields).toEqual({
      field1: { "@name": "Гость", "#text": "Нурбол Ә." },
    });
  });

  it("БИН — 12 цифр, пустой убирает", () => {
    expect(parseBin("123456789012")).toBe("123456789012");
    expect(parseBin(" 1234 5678 9012 ")).toBe("123456789012");
    expect(parseBin("")).toBeNull();
    expect(parseBin("12345")).toBeUndefined();
    expect(parseBin("12345678901a")).toBeUndefined();
  });

  it("bin идёт в ответе сразу после txn_id, а без БИН ответ не меняется", () => {
    const reply = buildReply({ txnId: "1234567", result: KaspiResult.OK, comment: "" });
    expect(withBin(reply, null)).toEqual(reply);
    const withIt = withBin(reply, "123456789012");
    expect(withIt).toEqual({ txn_id: "1234567", bin: "123456789012", result: 0, comment: "" });
    expect(Object.keys(withIt).slice(0, 2)).toEqual(["txn_id", "bin"]);
  });

  it("ссылка Kaspi хранится без значения поля", () => {
    const sent =
      "https://kaspi.kz/pay/CYBERFOX?21895=%D0%9D%D0%BE%D0%BC%D0%B5%D1%80%20%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD%D0%B0";
    expect(parsePayLink(sent)).toBe("https://kaspi.kz/pay/CYBERFOX?21895=");
    expect(parsePayLink(" https://kaspi.kz/pay/CYBERFOX?21895=7786279492 ")).toBe("https://kaspi.kz/pay/CYBERFOX?21895=");
    expect(parsePayLink("")).toBeNull();
    expect(parsePayLink("https://kaspi.kz/pay/CYBERFOX")).toBeUndefined();
    expect(parsePayLink("https://evil.kz/pay/CYBERFOX?21895=")).toBeUndefined();
    expect(parsePayLink("http://kaspi.kz/pay/CYBERFOX?21895=")).toBeUndefined();
    expect(parsePayLink("не ссылка")).toBeUndefined();
  });

  it("в ссылку подставляются 10 цифр номера гостя", () => {
    const link = "https://kaspi.kz/pay/CYBERFOX?21895=";
    expect(payLinkFor(link, "+77786279492")).toBe(`${link}7786279492`);
    expect(payLinkFor(link, "87786279492")).toBe(`${link}7786279492`);
    expect(payLinkFor(link, "+1 555 0100")).toBeNull();
  });
});
