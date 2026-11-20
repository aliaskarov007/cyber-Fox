import { type FormEvent, useState } from "react";

import {
  type Club,
  type Product,
  type ProductInput,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

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
  const [receiving, setReceiving] = useState<Product | null>(null);
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

      {receiving && (
        <ReceiveForm
          key={receiving.id}
          club={club}
          product={receiving}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
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
              <th>Маржа</th>
              <th>Остаток</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className={product.isActive ? "" : "muted"}>
                <td>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt=""
                        style={{
                          width: 28,
                          height: 28,
                          objectFit: "cover",
                          borderRadius: 5,
                        }}
                      />
                    )}
                    {product.name}
                  </span>
                </td>
                <td>{product.category ?? "—"}</td>
                <td className="num">{formatMoney(product.price)}</td>
                <td className="num">{formatMoney(product.cost)}</td>
                <td className="num">
                  {formatMoney(product.price - product.cost)}
                  <i className="dash-qty">
                    {" "}
                    ·{" "}
                    {product.price > 0
                      ? Math.round((1 - product.cost / product.price) * 100)
                      : 0}
                    %
                  </i>
                </td>
                <td className="num">
                  {product.stock === null ? "без учёта" : product.stock}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReceiving(product)}
                  >
                    Оприходовать
                  </button>
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
                        api.updateProduct(club.id, product.id, {
                          isActive: !product.isActive,
                        }),
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
                <td colSpan={7}>
                  Товаров нет. Пока их нет, бар в смене продавать нечего.
                </td>
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
  const [price, setPrice] = useState(
    editing ? String(editing.price / 100) : "",
  );
  const [stock, setStock] = useState(
    editing?.stock === null ? "" : String(editing?.stock ?? ""),
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    editing?.imageUrl ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickImage(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadCover(club.id, file);
      setImageUrl(url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: ProductInput = {
        name: name.trim(),
        price: toTiyn(price),
        ...(category.trim() === "" ? {} : { category: category.trim() }),
        ...(stock.trim() === "" ? {} : { stock: Number(stock) }),
        imageUrl,
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
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Кола 0,5"
        />
      </label>

      <label>
        Категория
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Напитки"
        />
      </label>

      <label>
        Цена, ₸
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>

      <label>
        Остаток (пусто — без учёта)
        <input
          inputMode="numeric"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
        <span className="note">
          Себестоимость не вводится здесь — она берётся из оприходования.
        </span>
      </label>

      <label>
        Картинка товара
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            style={{
              width: 72,
              height: 72,
              objectFit: "cover",
              borderRadius: 8,
              display: "block",
              margin: "4px 0 8px",
            }}
          />
        )}
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickImage(file);
          }}
        />
        {uploading && <span className="note">Загружаем…</span>}
        {imageUrl && !uploading && (
          <button type="button" onClick={() => setImageUrl(null)}>
            Убрать картинку
          </button>
        )}
      </label>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy || uploading}>
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/**
 * Оприходование товара: количество и себестоимость партии. Себестоимость товара
 * пересчитывается в средневзвешенную — здесь же показан предпросмотр.
 */
function ReceiveForm({
  club,
  product,
  onClose,
  onSaved,
}: {
  club: Club;
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Number(quantity) || 0;
  const cost = unitCost.trim() === "" ? 0 : toTiyn(unitCost);
  // Предпросмотр средневзвешенной себестоимости и нового остатка.
  const preview =
    product.stock === null
      ? { stock: null as number | null, cost }
      : (() => {
          const newQty = product.stock + qty;
          return {
            stock: newQty,
            cost:
              newQty > 0
                ? Math.round(
                    (product.stock * product.cost + qty * cost) / newQty,
                  )
                : cost,
          };
        })();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (qty <= 0) {
      setError("Укажите количество");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.receiveStock(club.id, product.id, {
        quantity: qty,
        unitCost: cost,
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      <h3 style={{ gridColumn: "1 / -1", margin: 0 }}>
        Оприходование: {product.name}
      </h3>
      {error && <div className="error">{error}</div>}

      <label>
        Количество, шт
        <input
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="24"
        />
      </label>

      <label>
        Себестоимость за единицу, ₸
        <input
          inputMode="decimal"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          placeholder="180"
        />
      </label>

      <div className="note" style={{ gridColumn: "1 / -1" }}>
        Сейчас: остаток {product.stock === null ? "без учёта" : product.stock} ·
        себестоимость {formatMoney(product.cost)}. После приёмки: остаток{" "}
        {preview.stock === null ? "без учёта" : preview.stock} · себестоимость{" "}
        {formatMoney(preview.cost)}.
      </div>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          Оприходовать
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
