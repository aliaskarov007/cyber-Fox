import { useCallback, useEffect, useState } from "react";

import { type Club, type ShiftReport, api, formatMoney } from "./api.js";

/**
 * «Смена» — дашборд по деньгам открытой смены.
 *
 * Модель как договаривались: Выручка = Клуб (пополнения и пакеты) + Бар, и та
 * же выручка в разбивке по способу оплаты (наличные / карта / онлайн). Наличные
 * прибавляются к размену на начало смены — это и есть касса на руках.
 *
 * Выручка за время показана отдельно и в Итог НЕ входит: время оплачивается с
 * баланса, а баланс уже посчитан в пополнениях — иначе деньги считались бы
 * дважды.
 */
export function DashboardScreen({ club }: { club: Club }) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [hasShift, setHasShift] = useState(true);

  const refresh = useCallback(async () => {
    const shift = await api.currentShift(club.id);
    if (!shift) {
      setHasShift(false);
      setReport(null);
      return;
    }
    setHasShift(true);
    setReport(await api.shiftReport(club.id, shift.id));
  }, [club.id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!hasShift) {
    return (
      <main>
        <div className="notice">
          Смена не открыта. Откройте смену наверху — и здесь появятся деньги
          дня.
        </div>
      </main>
    );
  }
  if (!report) {
    return (
      <main>
        <div className="notice">Загрузка…</div>
      </main>
    );
  }

  const share = (part: number): number =>
    report.grandTotal > 0 ? Math.round((part / report.grandTotal) * 100) : 0;

  return (
    <main>
      <div className="dash-grid">
        <section className="dash-card dash-wide">
          <div className="dash-title">Выручка за смену</div>
          <div className="dash-big">{formatMoney(report.grandTotal)}</div>
          <div className="dash-split">
            <div className="dash-pay">
              <span className="dash-dot cash" />
              <span className="dash-pay-name">Наличные</span>
              <b>{formatMoney(report.cashTotal)}</b>
              <i>{share(report.cashTotal)}%</i>
            </div>
            <div className="dash-pay">
              <span className="dash-dot card" />
              <span className="dash-pay-name">Карта</span>
              <b>{formatMoney(report.cardTotal)}</b>
              <i>{share(report.cardTotal)}%</i>
            </div>
            <div className="dash-pay">
              <span className="dash-dot online" />
              <span className="dash-pay-name">Онлайн</span>
              <b>{formatMoney(report.onlineTotal)}</b>
              <i>{share(report.onlineTotal)}%</i>
            </div>
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-title">Касса</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Наличных в кассе</span>
              <b>{formatMoney(report.cashExpected)}</b>
            </div>
            <div className="row">
              <span className="k">На начало смены</span>
              <span>{formatMoney(report.openingFloat)}</span>
            </div>
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-title">Из чего выручка</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Клуб · пополнения</span>
              <b>{formatMoney(report.clubTopUps)}</b>
            </div>
            <div className="row">
              <span className="k">Бар</span>
              <b>{formatMoney(report.barSales)}</b>
            </div>
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-title">Время и бар</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Выручка за время</span>
              <span>{formatMoney(report.sessionsRevenue)}</span>
            </div>
            <div className="row">
              <span className="k">Маржа бара</span>
              <span>{formatMoney(report.barSales - report.productsCost)}</span>
            </div>
            <div className="row">
              <span className="k">Сессий за смену</span>
              <span>{report.sessionsCount}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
