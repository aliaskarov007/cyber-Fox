import { type FormEvent, useState } from "react";

import { type Club, type Product, type ProductInput, api, formatMoney, toTiyn } from "./api.js";

/**
 * Товары бара: завести, поменять цену, поправить остаток.
 *
 * Раньше бар умел только продавать заведённое сидом, то есть работал по чужому
 * прайсу. Удаления нет намеренно: товар стоит в закрытых чеках, и убрать его
 * значило бы переписать выручку прошлых смен.
 */
export function ProductsSection({
  club,
  products,
  onChanged,
}: {
  club: Club;
  products: Product[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Товары</h2>
        <button
          className="primary"
          type="button"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Добавить товар
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {open && (
        <ProductForm
          key={editing?.id ?? "new"}
          club={club}
          editing={editing}
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setOpen(false);
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Категория</th>
              <th>Цена</th>
              <th>Себестоимость</th>
              <th>Остаток</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className={product.isActive ? "" : "muted"}>
                <td>{product.name}</td>
                <td>{product.category ?? "—"}</td>
                <td className="num">{formatMoney(product.price)}</td>
                <td className="num">{formatMoney(product.cost)}</td>
                <td className="num">{product.stock === null ? "без учёта" : product.stock}</td>
                <td className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(product);
                      setOpen(true);
                    }}
                  >
                    Править
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api.updateProduct(club.id, product.id, { isActive: !product.isActive }),
                      )
                    }
                  >
                    {product.isActive ? "Убрать из продажи" : "Вернуть"}
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6}>Товаров нет. Пока их нет, бар в смене продавать нечего.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductForm({
  club,
  editing,
  onClose,
  onSaved,
}: {
  club: Club;
  editing: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [price, setPrice] = useState(editing ? String(editing.price / 100) : "");
  const [cost, setCost] = useState(editing ? String(editing.cost / 100) : "");
  const [stock, setStock] = useState(editing?.stock === null ? "" : String(editing?.stock ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: ProductInput = {
        name: name.trim(),
        price: toTiyn(price),
        ...(category.trim() === "" ? {} : { category: category.trim() }),
        ...(cost.trim() === "" ? {} : { cost: toTiyn(cost) }),
        ...(stock.trim() === "" ? {} : { stock: Number(stock) }),
      };
      if (editing) await api.updateProduct(club.id, editing.id, body);
      else await api.createProduct(club.id, body);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Кола 0,5" />
      </label>

      <label>
        Категория
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Напитки" />
      </label>

      <label>
        Цена, ₸
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>

      <label>
        Себестоимость, ₸ (для маржи в отчёте)
        <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>

      <label>
        Остаток (пусто — без учёта)
        <input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
      </label>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
