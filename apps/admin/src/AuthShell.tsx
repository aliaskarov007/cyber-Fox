import type { ReactNode } from "react";

const SUPPORT_PHONE = "+7 708 777 77 69";
const SUPPORT_PHONE_RAW = "77087777769";
const SUPPORT_EMAIL = "aliaskarovnye@gmail.com";

/**
 * Общая рамка экранов входа и регистрации: контур CYBERFOX на фоне,
 * форма по центру, техподдержка в правом нижнем углу.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="fx-login">
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
