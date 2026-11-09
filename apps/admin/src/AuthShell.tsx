import { type ReactNode, useEffect, useState } from "react";

const SUPPORT_PHONE = "+7 708 777 77 69";
const SUPPORT_PHONE_RAW = "77087777769";
const SUPPORT_EMAIL = "aliaskarovnye@gmail.com";

/**
 * Общая рамка экранов входа и регистрации: контур CYBERFOX на фоне,
 * форма по центру, техподдержка в правом нижнем углу.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!aboutOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [aboutOpen]);

  return (
    <div className="fx-login">
      <button
        type="button"
        className="fx-about-open"
        onClick={() => setAboutOpen(true)}
      >
        О нас
      </button>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {/* Крупные надписи на фоне — только украшение, читалкам экрана не нужны. */}
      <div className="fx-login-bg" aria-hidden="true">
        <span className="w1">CYBERFOX</span>
        <span className="w2">CYBERFOX</span>
        <span className="w3">CYBERFOX</span>
      </div>

      <main className="fx-login-main">{children}</main>

      <footer className="fx-login-footer">
        <section className="fx-support" aria-labelledby="fx-support-title">
          <h2 id="fx-support-title" className="fx-support-title">
            Техподдержка 24/7
          </h2>
          <ul className="fx-support-list">
            <li>
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 21l1.7-4.6A8.5 8.5 0 1 1 8 19.6z" />
              </svg>
              <div>
                <span>WhatsApp</span>
                <a
                  href={`https://wa.me/${SUPPORT_PHONE_RAW}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {SUPPORT_PHONE}
                </a>
              </div>
            </li>
            <li>
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
              <div>
                <span>Почта</span>
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </div>
            </li>
          </ul>
        </section>
      </footer>

      {/* Документы для гостей и банка-эквайера: оферта, оплата и возврат, политика, реквизиты. */}
      <nav className="fx-legal" aria-label="Документы">
        <a href="/oferta.html">Публичная оферта</a>
        <a href="/oplata.html">Оплата и возврат</a>
        <a href="/privacy.html">Политика конфиденциальности</a>
        <a href="/rekvizity.html">Реквизиты</a>
      </nav>
    </div>
  );
}

export function AuthLogo() {
  return (
    <div className="fx-login-logo">
      CYBER<span>FOX</span>
    </div>
  );
}

/** Рассказ о CyberFox: открывается кнопкой «О нас» поверх экрана входа. */
function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fx-about-backdrop" onClick={onClose}>
      <section
        className="fx-about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fx-about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="fx-about-close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <p className="fx-about-kicker">О нас</p>
        <h2 id="fx-about-title" className="fx-intro-title">
          Управление компьютерным клубом — <span>стабильно</span>
        </h2>
        <p className="fx-intro-lead">
          CyberFox — программа для компьютерных клубов: касса, компьютеры, гости
          и бар в одном окне. Мы сами владеем компьютерным клубом и сделали
          программу, которой нам не хватало. Подходит и для одного клуба, и для
          целой сети.
        </p>
        <ul className="fx-intro-list">
          <li>
            <b>Привлекайте гостей и растите выручку</b>
            Регистрация через WhatsApp, бонусы, промокоды и турниры возвращают
            гостей снова.
          </li>
          <li>
            <b>Контролируйте все процессы</b>
            Каждый ПК на карте клуба: кто играет, сколько осталось, где
            закончилось время.
          </li>
          <li>
            <b>Принимайте оплату без администратора</b>
            Kaspi QR пополняет баланс гостя за секунды, деньги сразу видны в
            кассе.
          </li>
          <li>
            <b>Разгрузите администратора</b>
            Смены, пакеты, заказы из бара с игрового места, отчёт по каждой
            смене.
          </li>
        </ul>
      </section>
    </div>
  );
}

/** Поле пароля с глазом: показать или скрыть введённое. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  const label = show ? "Скрыть пароль" : "Показать пароль";
  return (
    <div className="fx-password">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required
      />
      <button
        type="button"
        className="fx-eye"
        onClick={() => setShow((v) => !v)}
        aria-label={label}
        title={label}
      >
        {show ? (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
