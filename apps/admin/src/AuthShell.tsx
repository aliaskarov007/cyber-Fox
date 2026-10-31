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
        <section className="fx-support" aria-label="Техподдержка">
          <p className="fx-support-head">Техподдержка 24/7</p>
          <p>
            <a href={`tel:+${SUPPORT_PHONE_RAW}`}>{SUPPORT_PHONE}</a>
            <span className="fx-sep" aria-hidden="true">
              ·
            </span>
            <a
              href={`https://wa.me/${SUPPORT_PHONE_RAW}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </p>
          <p>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
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
