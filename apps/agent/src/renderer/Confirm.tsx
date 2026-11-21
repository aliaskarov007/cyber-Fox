import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Подтверждение действия «Да / Нет».
 *
 * Денежные действия на игровом ПК (покупка пакета, пополнение) необратимы на
 * глазах у гостя, поэтому перед списанием спрашиваем ещё раз. Диалог свой, а не
 * системный: киоск заблокирован, нативное окно браузера тут неуместно.
 */
type ConfirmOptions = {
  /** Текст на кнопке согласия. По умолчанию «Да». */
  yes?: string;
  /** Текст на кнопке отказа. По умолчанию «Нет». */
  no?: string;
  /** Красная кнопка — для списаний и отмен. */
  danger?: boolean;
};

type Ask = (text: string, opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Спросить подтверждение. Возвращает промис: true — «Да», false — «Нет». */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm вызван вне <ConfirmProvider>");
  return ask;
}

type DialogState = {
  text: string;
  yes: string;
  no: string;
  danger: boolean;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const ask = useCallback<Ask>(
    (text, opts) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({
          text,
          yes: opts?.yes ?? "Да",
          no: opts?.no ?? "Нет",
          danger: opts?.danger ?? false,
        });
      }),
    [],
  );

  function close(value: boolean): void {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    resolve?.(value);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => close(false)}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-text">{state.text}</div>
            <div className="confirm-actions">
              <button className="ghost" type="button" onClick={() => close(false)}>
                {state.no}
              </button>
              <button
                className={state.danger ? "danger" : "primary"}
                type="button"
                autoFocus
                onClick={() => close(true)}
              >
                {state.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
