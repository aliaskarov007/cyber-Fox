import { useCallback, useEffect, useState } from "react";

import { AgentDownload } from "./AgentDownload.js";

import {
  type Checkout,
  type Club,
  type Computer,
  type ImportResult,
  type Invoice,
  type SubscriptionInfo,
  api,
  formatMoney,
} from "./api.js";

const PLAN_STATUS: Record<string, string> = {
  TRIALING: "пробный период",
  ACTIVE: "оплачен",
  PAST_DUE: "льготный период",
  SUSPENDED: "приостановлен",
  CANCELED: "отменён",
};

/**
 * Подключение и переезд: то, чем чужой владелец занимается в первый день.
 *
 * Коды привязки, установка агентов, загрузка данных из прежней системы
 * и выбор тарифа собраны на одном экране — это последовательность одного дня,
 * а не четыре разных задачи.
 */
export function OnboardingScreen({ club, isOwner }: { club: Club; isOwner: boolean }) {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSubscription, nextInvoices, nextComputers] = await Promise.all([
      api.subscription(),
      api.platformInvoices().catch(() => []),
      api.computers(club.id),
    ]);
    setSubscription(nextSubscription);
    setInvoices(nextInvoices);
    setComputers(nextComputers);
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const paired = computers.filter((c) => c.lastSeenAt !== null).length;

  return (
    <main>
      {error && <div className="error">{error}</div>}

      {subscription && (
        <SubscriptionBlock
          info={subscription}
          invoices={invoices}
          isOwner={isOwner}
          onChanged={() => void load()}
          onError={setError}
        />
      )}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Подключение машин</h2>
          <span className="count">
            {paired}/{computers.length} на связи
          </span>
        </div>

        <div className="notice">
          На каждой игровой машине установите агента и укажите её код привязки. Код одноразово
          связывает программу с конкретным ПК — вводить его повторно не нужно.
        </div>

        {/* Сначала где взять программу, потом чем её настроить. */}
      <AgentDownload />
      {isOwner && <DisklessKey club={club} />}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ПК</th>
                <th>Код привязки</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {computers.map((computer) => (
                <tr key={computer.id}>
                  <td>{computer.name}</td>
                  <td className="num">{computer.pairingToken ?? "—"}</td>
                  <td>
                    {computer.lastSeenAt ? (
                      <span className="chip in-use">на связи</span>
                    ) : (
                      <span className="chip idle">агент не установлен</span>
                    )}
                  </td>
                </tr>
              ))}
              {computers.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>
                    Машин пока нет — заведите их вручную или загрузите списком ниже
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ImportBlock club={club} onDone={() => void load()} />
    </main>
  );
}

function SubscriptionBlock({
  info,
  invoices,
  isOwner,
  onChanged,
  onError,
}: {
  info: SubscriptionInfo;
  invoices: Invoice[];
  isOwner: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (cause) {
      onError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Подписка</h2>
        <span className={`chip ${info.access.level === "FULL" ? "in-use" : info.access.level === "WARNING" ? "credit" : "maintenance"}`}>
          {PLAN_STATUS[info.subscription.status] ?? info.subscription.status}
        </span>
      </div>

      {/* Предупреждение показываем заранее: платёж не должен догонять смену. */}
      {info.access.message && (
        <div className={info.access.level === "READ_ONLY" ? "error" : "notice warn"}>
          {info.access.message}
        </div>
      )}

      <div className="summary">
        {info.plans.map((plan) => {
          const current = plan.plan === info.subscription.plan;
          return (
            <div className={`stat ${current ? "alert" : ""}`} key={plan.plan}>
              <div className="value">
                {plan.pricePerComputer === 0 ? "0 ₸" : formatMoney(plan.pricePerComputer)}
              </div>
              <div className="label">
                {plan.title} · до {plan.maxComputers} машин
                {plan.pricePerComputer > 0 ? " · за машину в месяц" : ""}
              </div>
              {isOwner && !current && plan.plan !== "TRIAL" && (
                <button
                  style={{ marginTop: 8 }}
                  disabled={busy}
                  onClick={() => void run(() => api.changePlan(plan.plan))}
                >
                  Перейти
                </button>
              )}
            </div>
          );
        })}
      </div>

      {checkout && (
        <div className="notice">
          {checkout.url ? (
            <>
              Счёт на {formatMoney(checkout.amount)}: откройте ссылку и оплатите картой. Подписка
              продлится сама, как только банк подтвердит платёж — отмечать вручную не нужно.
              <div className="checkout-link">{checkout.url}</div>
            </>
          ) : (
            <>Оплата картой пока не подключена — напишите нам, выставим счёт на компанию.</>
          )}
          <div className="actions" style={{ marginTop: 8 }}>
            <button onClick={() => setCheckout(null)}>Скрыть</button>
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Период</th>
                <th>Машин</th>
                <th>Сумма</th>
                <th>Состояние</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="num">
                    {new Date(invoice.periodStart).toLocaleDateString("ru-KZ")} —{" "}
                    {new Date(invoice.periodEnd).toLocaleDateString("ru-KZ")}
                  </td>
                  <td className="num">{invoice.computers}</td>
                  <td className="num">{formatMoney(invoice.amount)}</td>
                  <td>
                    {invoice.status === "PAID"
                      ? "оплачен"
                      : invoice.status === "OVERDUE"
                        ? "просрочен"
                        : "выставлен"}
                  </td>
                  {isOwner && (
                    <td>
                      {invoice.status !== "PAID" && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void run(async () => setCheckout(await api.payInvoice(invoice.id)))}
                        >
                          Оплатить
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Ключ клуба для бездисковых залов.
 *
 * Там все ПК грузятся с одного образа, и код привязки в него не положишь: он
 * у каждой машины свой, а настройки в профиле стираются при перезагрузке.
 * Поэтому в образ кладётся один ключ на клуб, а машины различаются по MAC
 * сетевой карты — без уникального MAC загрузка по сети невозможна.
 */
function DisklessKey({ club }: { club: Club }) {
  const [shown, setShown] = useState(false);

  const file = `{
  "serverUrl": "${window.location.origin}",
  "enrollmentKey": "${club.enrollmentKey}"
}`;

  return (
    <div className="notice">
      <b>Зал на бездисковой загрузке (CCBoot и подобные)</b>
      <div className="note" style={{ marginTop: 6 }}>
        Коды привязки здесь не нужны: положите файл <code>cyberfox.json</code> рядом с агентом в
        общий образ, и машины подключатся сами, различаясь по MAC сетевой карты. Новая машина
        появится в зале при первой загрузке.
      </div>

      {shown ? (
        <>
          <div className="checkout-link" style={{ marginTop: 8, whiteSpace: "pre" }}>{file}</div>
          <div className="note" style={{ marginTop: 6 }}>
            Ключ пускает машину в этот клуб — держите образ там, куда нет доступа у гостей.
          </div>
        </>
      ) : (
        <div className="actions" style={{ marginTop: 8 }}>
          <button onClick={() => setShown(true)}>Показать ключ клуба</button>
        </div>
      )}
    </div>
  );
}

const IMPORT_KINDS = [
  {
    kind: "guests" as const,
    title: "Гости",
    hint: "Колонки: имя, телефон, баланс, бонусы. Точка с запятой и запятая в копейках понимаются.",
  },
  {
    kind: "computers" as const,
    title: "Машины",
    hint: "Колонки: название, зона. Зоны создаются автоматически.",
  },
  {
    kind: "tariffs" as const,
    title: "Тарифы",
    hint: "Колонки: название, зона, цена за минуту — либо минут и цена для пакета.",
  },
];

function ImportBlock({ club, onDone }: { club: Club; onDone: () => void }) {
  const [kind, setKind] = useState<(typeof IMPORT_KINDS)[number]["kind"]>("guests");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = IMPORT_KINDS.find((item) => item.kind === kind)!;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Перенос из прежней системы</h2>
      </div>

      <div className="notice">
        Выгрузите данные из Senet, SmartShell или Excel и вставьте содержимое файла сюда. Загружать
        можно повторно: строки сопоставляются по телефону и названию, дубли не появятся.
      </div>

      {error && <div className="error">{error}</div>}

      <div className="link-tabs" style={{ marginBottom: 10 }}>
        {IMPORT_KINDS.map((item) => (
          <button
            key={item.kind}
            aria-current={kind === item.kind}
            onClick={() => {
              setKind(item.kind);
              setResult(null);
            }}
          >
            {item.title}
          </button>
        ))}
      </div>

      <div className="note" style={{ marginBottom: 8 }}>
        {active.hint}
      </div>

      <textarea
        className="csv-input"
        rows={8}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"Имя;Телефон;Баланс\nАйдос;+77010000001;1500"}
      />

      <div className="actions">
        <button
          className="primary"
          disabled={busy || csv.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await api.importCsv(club.id, kind, csv));
              onDone();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Загрузить
        </button>
      </div>

      {result && (
        <>
          <div className="notice">
            Создано {result.created}, обновлено {result.updated}, пропущено {result.skipped}.
          </div>
          {/* Пропущенные строки показываем поимённо: иначе владелец не узнает,
              кого из гостей потерял при переезде. */}
          {result.problems.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Что не так</th>
                  </tr>
                </thead>
                <tbody>
                  {result.problems.map((problem) => (
                    <tr key={problem.line}>
                      <td className="num">{problem.line}</td>
                      <td>{problem.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
