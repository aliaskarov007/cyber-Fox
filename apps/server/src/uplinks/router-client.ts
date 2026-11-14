import { request as httpsRequest } from "node:https";

/** Настройки доступа к роутеру (из модели InternetRouter). */
export interface RouterAccess {
  host: string;
  apiPort: number;
  username: string;
  password: string;
  driver: string;
}

/**
 * Управление маршрутизацией ПК по интернет-каналам на роутере.
 *
 * Канал на роутере — это address-list: если локальный IP машины в списке
 * канала, её трафик уходит через этот канал (политика маршрутизации на
 * MikroTik настроена заранее). Канал по умолчанию — отсутствие во всех
 * списках: машина идёт обычным маршрутом.
 *
 * Пока поддержан RouterOS 7 (REST API). Для RouterOS 6 драйвер добавим
 * отдельно — там бинарный API, не REST.
 */
export class RouterUnsupportedError extends Error {}

/** Есть ли у машины (по IP) запись в списке канала; и правка этой записи. */
export async function setMembership(
  router: RouterAccess,
  ip: string,
  list: string,
  present: boolean,
): Promise<void> {
  requireRos7(router);
  const existing = await ros7<Array<{ ".id": string }>>(
    router,
    "GET",
    `/ip/firewall/address-list?list=${encodeURIComponent(
      list,
    )}&address=${encodeURIComponent(ip)}`,
  );
  const rows = Array.isArray(existing) ? existing : [];
  if (present && rows.length === 0) {
    await ros7(router, "PUT", "/ip/firewall/address-list", {
      list,
      address: ip,
      comment: "cyberfox",
    });
  } else if (!present && rows.length > 0) {
    for (const row of rows) {
      await ros7(
        router,
        "DELETE",
        `/ip/firewall/address-list/${encodeURIComponent(row[".id"])}`,
      );
    }
  }
}

/** Проверка доступности роутера — для кнопки «проверить» и статуса. */
export async function health(router: RouterAccess): Promise<void> {
  requireRos7(router);
  await ros7(router, "GET", "/system/resource");
}

function requireRos7(router: RouterAccess): void {
  if (router.driver !== "ROS7")
    throw new RouterUnsupportedError(
      "Пока поддержан только RouterOS 7 (REST). Для RouterOS 6 драйвер добавим отдельно.",
    );
}

/** Один вызов REST API RouterOS 7. Сертификат роутера самоподписанный. */
function ros7<T = unknown>(
  router: RouterAccess,
  method: "GET" | "PUT" | "DELETE" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpsRequest(
      {
        host: router.host,
        port: router.apiPort || 443,
        method,
        path: `/rest${path}`,
        // Роутер отдаёт самоподписанный сертификат — проверку отключаем только
        // для этого соединения внутри локальной сети клуба.
        rejectUnauthorized: false,
        timeout: 6000,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${router.username}:${router.password}`).toString(
              "base64",
            ),
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) {
            try {
              resolve((data ? JSON.parse(data) : null) as T);
            } catch {
              reject(new Error("Роутер вернул неожиданный ответ"));
            }
          } else {
            reject(new Error(`Роутер ответил ${code}: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () =>
      req.destroy(new Error("Роутер не ответил вовремя")),
    );
    if (payload) req.write(payload);
    req.end();
  });
}
