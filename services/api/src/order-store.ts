import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Pool as PgPool } from "pg";
import type { AppDatabase } from "./database.js";
import { foodCatalog } from "./catalog.js";

type UserRole = "customer" | "delivery";
interface OrderUser {
  id: string;
  role: UserRole;
}
interface OrderInput {
  customerId: string;
  idempotencyKey: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}
interface OrderResult {
  order: Record<string, unknown> | null;
  created: boolean;
  empty?: boolean;
}
interface CartItem {
  id: string;
  name: string;
  category: string;
  price: number;
  imageUrl: string;
  quantity: number;
}
interface OrderStore {
  readonly kind: "postgresql" | "local";
  readonly ready: Promise<void>;
  getCart(userId: string): Promise<CartItem[]>;
  setCartItem(userId: string, foodId: string, quantity: number): Promise<boolean>;
  placeOrder(input: OrderInput): Promise<OrderResult>;
  listOrders(customerId: string): Promise<Record<string, unknown>[]>;
  getOrder(orderId: string): Promise<Record<string, unknown> | null>;
  canAccessOrder(user: OrderUser, orderId: string): Promise<boolean>;
  cancelOrder(customerId: string, orderId: string): Promise<Record<string, unknown> | null>;
  getDeliveryOrders(): Promise<Record<string, unknown>[]>;
  claimOrder(deliveryUserId: string, orderId: string): Promise<Record<string, unknown> | null>;
  updateOrderStatus(
    deliveryUserId: string,
    orderId: string,
    status: "accepted" | "picked_up" | "on_the_way" | "delivered",
  ): Promise<Record<string, unknown> | null>;
  addDeliveryLocation(
    deliveryUserId: string,
    orderId: string,
    latitude: number,
    longitude: number,
  ): Promise<Record<string, unknown> | null>;
  close(): Promise<void>;
}

function localReadOrder(db: AppDatabase, orderId: string) {
  const order = db.prepare(`
    SELECT o.id, o.customer_id AS customerId, o.delivery_user_id AS deliveryUserId,
           o.status, o.address, o.latitude, o.longitude, o.total, o.created_at AS createdAt
    FROM orders o WHERE o.id = ?
  `).get(orderId) as Record<string, unknown> | undefined;
  if (!order) return null;
  const items = db.prepare(`
    SELECT id, food_id AS foodId, food_name AS name, unit_price AS unitPrice, quantity
    FROM order_items WHERE order_id = ?
  `).all(orderId);
  const history = db.prepare(`
    SELECT status, created_at AS createdAt FROM order_status_history
    WHERE order_id = ? ORDER BY created_at ASC
  `).all(orderId);
  const latestLocation = db.prepare(`
    SELECT latitude, longitude, created_at AS createdAt FROM delivery_locations
    WHERE order_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(orderId) ?? null;
  return { ...order, items, history, latestLocation };
}

function createLocalOrderStore(db: AppDatabase): OrderStore {
  const ready = Promise.resolve();
  return {
    kind: "local",
    ready,
    async getCart(userId) {
      return db.prepare(`
        SELECT f.id, f.name, f.category, f.price, f.image_url AS imageUrl, c.quantity
        FROM cart_items c JOIN foods f ON f.id = c.food_id
        WHERE c.user_id = ? ORDER BY f.name
      `).all(userId) as CartItem[];
    },
    async setCartItem(userId, foodId, quantity) {
      const food = db.prepare("SELECT id FROM foods WHERE id = ?").get(foodId);
      if (!food) return false;
      if (quantity === 0) {
        db.prepare("DELETE FROM cart_items WHERE user_id = ? AND food_id = ?").run(userId, foodId);
      } else {
        db.prepare(`
          INSERT INTO cart_items (user_id, food_id, quantity) VALUES (?, ?, ?)
          ON CONFLICT(user_id, food_id) DO UPDATE SET quantity = excluded.quantity
        `).run(userId, foodId, quantity);
      }
      return true;
    },
    async placeOrder(input) {
      const existing = db.prepare(`
        SELECT id FROM orders WHERE customer_id = ? AND idempotency_key = ?
      `).get(input.customerId, input.idempotencyKey) as { id: string } | undefined;
      if (existing) return { order: localReadOrder(db, existing.id), created: false };
      const cart = db.prepare(`
        SELECT f.id AS foodId, f.name, f.price, c.quantity
        FROM cart_items c JOIN foods f ON f.id = c.food_id WHERE c.user_id = ?
      `).all(input.customerId) as Array<{
        foodId: string; name: string; price: number; quantity: number;
      }>;
      if (cart.length === 0) return { order: null, created: false, empty: true };
      const orderId = randomUUID();
      const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const checkout = db.transaction(() => {
        db.prepare(`
          INSERT INTO orders (id, customer_id, idempotency_key, status, address, latitude, longitude, total)
          VALUES (?, ?, ?, 'placed', ?, ?, ?, ?)
        `).run(
          orderId, input.customerId, input.idempotencyKey, input.address,
          input.latitude, input.longitude, total,
        );
        const addItem = db.prepare(`
          INSERT INTO order_items (id, order_id, food_id, food_name, unit_price, quantity)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of cart) {
          addItem.run(randomUUID(), orderId, item.foodId, item.name, item.price, item.quantity);
        }
        db.prepare(`
          INSERT INTO order_status_history (id, order_id, status, actor_id)
          VALUES (?, ?, 'placed', ?)
        `).run(randomUUID(), orderId, input.customerId);
        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(input.customerId);
      });
      try {
        checkout();
      } catch (error) {
        const racedOrder = db.prepare(`
          SELECT id FROM orders WHERE customer_id = ? AND idempotency_key = ?
        `).get(input.customerId, input.idempotencyKey) as { id: string } | undefined;
        if (racedOrder) return { order: localReadOrder(db, racedOrder.id), created: false };
        throw error;
      }
      return { order: localReadOrder(db, orderId), created: true };
    },
    async listOrders(customerId) {
      const ids = db.prepare(`
        SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(customerId) as Array<{ id: string }>;
      return ids.map(({ id }) => localReadOrder(db, id)).filter((order) => order !== null);
    },
    async getOrder(orderId) {
      return localReadOrder(db, orderId);
    },
    async canAccessOrder(user, orderId) {
      const column = user.role === "customer" ? "customer_id" : "delivery_user_id";
      return Boolean(db.prepare(`SELECT 1 FROM orders WHERE id = ? AND ${column} = ?`).get(orderId, user.id));
    },
    async cancelOrder(customerId, orderId) {
      const cancel = db.transaction(() => {
        const update = db.prepare(`
          UPDATE orders SET status = 'cancelled'
          WHERE id = ? AND customer_id = ? AND status = 'placed' AND delivery_user_id IS NULL
        `).run(orderId, customerId);
        if (update.changes === 0) return null;
        db.prepare(`
          INSERT INTO order_status_history (id, order_id, status, actor_id)
          VALUES (?, ?, 'cancelled', ?)
        `).run(randomUUID(), orderId, customerId);
        return localReadOrder(db, orderId);
      });
      return cancel();
    },
    async getDeliveryOrders() {
      return db.prepare(`
        SELECT o.id, o.status, o.address, o.total, o.created_at AS createdAt,
               (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS itemCount
        FROM orders o WHERE o.status = 'placed' AND o.delivery_user_id IS NULL
        ORDER BY o.created_at ASC LIMIT 50
      `).all() as Record<string, unknown>[];
    },
    async claimOrder(deliveryUserId, orderId) {
      const claim = db.transaction(() => {
        const update = db.prepare(`
          UPDATE orders SET delivery_user_id = ?, status = 'accepted'
          WHERE id = ? AND status = 'placed' AND delivery_user_id IS NULL
        `).run(deliveryUserId, orderId);
        if (update.changes === 0) return null;
        db.prepare(`
          INSERT INTO order_status_history (id, order_id, status, actor_id)
          VALUES (?, ?, 'accepted', ?)
        `).run(randomUUID(), orderId, deliveryUserId);
        return localReadOrder(db, orderId);
      });
      return claim();
    },
    async updateOrderStatus(deliveryUserId, orderId, status) {
      const transitions: Record<string, string | undefined> = {
        accepted: "picked_up",
        picked_up: "on_the_way",
        on_the_way: "delivered",
      };
      const update = db.transaction(() => {
        const current = db.prepare(`
          SELECT status FROM orders WHERE id = ? AND delivery_user_id = ?
        `).get(orderId, deliveryUserId) as { status: string } | undefined;
        if (!current || transitions[current.status] !== status) return null;
        db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, orderId);
        db.prepare(`
          INSERT INTO order_status_history (id, order_id, status, actor_id) VALUES (?, ?, ?, ?)
        `).run(randomUUID(), orderId, status, deliveryUserId);
        return localReadOrder(db, orderId);
      });
      return update();
    },
    async addDeliveryLocation(deliveryUserId, orderId, latitude, longitude) {
      const insert = db.transaction(() => {
        const assigned = db.prepare(`
          SELECT status FROM orders WHERE id = ? AND delivery_user_id = ?
        `).get(orderId, deliveryUserId) as { status: string } | undefined;
        if (!assigned || !["accepted", "picked_up", "on_the_way"].includes(assigned.status)) return null;
        db.prepare(`
          INSERT INTO delivery_locations (id, order_id, delivery_user_id, latitude, longitude)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), orderId, deliveryUserId, latitude, longitude);
        return { latitude, longitude, createdAt: new Date().toISOString() };
      });
      return insert();
    },
    async close() {},
  };
}

function createPostgresPool(connectionString: string): Pool {
  return new PgPool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: "viggy-mart-api",
  });
}

async function readPostgresOrder(
  queryable: Pick<Pool, "query"> | PoolClient,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await queryable.query<Record<string, unknown>>(`
    SELECT id, customer_id AS "customerId", delivery_user_id AS "deliveryUserId",
           status, address, latitude, longitude, total, created_at AS "createdAt"
    FROM viggy_mart_orders WHERE id = $1
  `, [orderId]);
  const order = rows[0];
  if (!order) return null;
  const [items, history, location] = await Promise.all([
    queryable.query<Record<string, unknown>>(`
      SELECT id, food_id AS "foodId", food_name AS name, unit_price AS "unitPrice", quantity
      FROM viggy_mart_order_items WHERE order_id = $1
    `, [orderId]),
    queryable.query<Record<string, unknown>>(`
      SELECT status, created_at AS "createdAt" FROM viggy_mart_order_status_history
      WHERE order_id = $1 ORDER BY created_at ASC
    `, [orderId]),
    queryable.query<Record<string, unknown>>(`
      SELECT latitude, longitude, created_at AS "createdAt"
      FROM viggy_mart_delivery_locations
      WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1
    `, [orderId]),
  ]);
  return {
    ...order,
    items: items.rows,
    history: history.rows,
    latestLocation: location.rows[0] ?? null,
  };
}

async function initializePostgres(pool: Pool, db: AppDatabase, accountsReady: Promise<void>) {
  await accountsReady;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viggy_mart_foods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price BETWEEN 100 AND 2000),
      rating DOUBLE PRECISION NOT NULL,
      image_url TEXT NOT NULL,
      preparation_minutes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS viggy_mart_cart_items (
      user_id UUID NOT NULL REFERENCES viggy_mart_accounts(id) ON DELETE CASCADE,
      food_id TEXT NOT NULL REFERENCES viggy_mart_foods(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      PRIMARY KEY (user_id, food_id)
    );
    CREATE TABLE IF NOT EXISTS viggy_mart_orders (
      id UUID PRIMARY KEY,
      customer_id UUID NOT NULL REFERENCES viggy_mart_accounts(id),
      delivery_user_id UUID REFERENCES viggy_mart_accounts(id),
      idempotency_key VARCHAR(100) NOT NULL,
      status VARCHAR(16) NOT NULL CHECK (status IN ('placed', 'accepted', 'picked_up', 'on_the_way', 'delivered', 'cancelled')),
      address TEXT NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      total INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS viggy_mart_orders_customer_idx
      ON viggy_mart_orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS viggy_mart_orders_delivery_idx
      ON viggy_mart_orders(delivery_user_id, status);
    CREATE TABLE IF NOT EXISTS viggy_mart_order_items (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES viggy_mart_orders(id) ON DELETE CASCADE,
      food_id TEXT NOT NULL REFERENCES viggy_mart_foods(id),
      food_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS viggy_mart_order_status_history (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES viggy_mart_orders(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL,
      actor_id UUID NOT NULL REFERENCES viggy_mart_accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS viggy_mart_delivery_locations (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES viggy_mart_orders(id) ON DELETE CASCADE,
      delivery_user_id UUID NOT NULL REFERENCES viggy_mart_accounts(id),
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS viggy_mart_locations_order_idx
      ON viggy_mart_delivery_locations(order_id, created_at);
  `);

  const insertFood = `
    INSERT INTO viggy_mart_foods (id, name, category, description, price, rating, image_url, preparation_minutes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
      description = EXCLUDED.description, price = EXCLUDED.price, rating = EXCLUDED.rating,
      image_url = EXCLUDED.image_url, preparation_minutes = EXCLUDED.preparation_minutes
  `;
  for (const food of foodCatalog) {
    await pool.query(insertFood, [
      food.id, food.name, food.category, food.description, food.price,
      food.rating, food.imageUrl, food.preparationMinutes,
    ]);
  }

  const validAccounts = new Set((await pool.query<{ id: string }>(
    "SELECT id FROM viggy_mart_accounts",
  )).rows.map(({ id }) => id));
  const knownOrders = new Set<string>();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const carts = db.prepare("SELECT user_id, food_id, quantity FROM cart_items").all() as Array<{
      user_id: string; food_id: string; quantity: number;
    }>;
    for (const item of carts) {
      if (!validAccounts.has(item.user_id)) continue;
      await client.query(`
        INSERT INTO viggy_mart_cart_items (user_id, food_id, quantity) VALUES ($1, $2, $3)
        ON CONFLICT (user_id, food_id) DO NOTHING
      `, [item.user_id, item.food_id, item.quantity]);
    }

    const orders = db.prepare(`
      SELECT id, customer_id, delivery_user_id, idempotency_key, status, address,
             latitude, longitude, total, created_at FROM orders
    `).all() as Array<{
      id: string; customer_id: string; delivery_user_id: string | null;
      idempotency_key: string; status: string; address: string; latitude: number | null;
      longitude: number | null; total: number; created_at: string;
    }>;
    for (const order of orders) {
      if (!validAccounts.has(order.customer_id)) continue;
      if (order.delivery_user_id && !validAccounts.has(order.delivery_user_id)) continue;
      await client.query(`
        INSERT INTO viggy_mart_orders
          (id, customer_id, delivery_user_id, idempotency_key, status, address, latitude, longitude, total, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT DO NOTHING
      `, [
        order.id, order.customer_id, order.delivery_user_id, order.idempotency_key,
        order.status, order.address, order.latitude, order.longitude, order.total, order.created_at,
      ]);
      const migrated = await client.query(
        "SELECT 1 FROM viggy_mart_orders WHERE id = $1",
        [order.id],
      );
      if (migrated.rowCount !== 0) knownOrders.add(order.id);
    }

    const orderItems = db.prepare(`
      SELECT id, order_id, food_id, food_name, unit_price, quantity FROM order_items
    `).all() as Array<{
      id: string; order_id: string; food_id: string; food_name: string;
      unit_price: number; quantity: number;
    }>;
    for (const item of orderItems) {
      if (!knownOrders.has(item.order_id)) continue;
      await client.query(`
        INSERT INTO viggy_mart_order_items (id, order_id, food_id, food_name, unit_price, quantity)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING
      `, [item.id, item.order_id, item.food_id, item.food_name, item.unit_price, item.quantity]);
    }

    const history = db.prepare(`
      SELECT id, order_id, status, actor_id, created_at FROM order_status_history
    `).all() as Array<{
      id: string; order_id: string; status: string; actor_id: string; created_at: string;
    }>;
    for (const entry of history) {
      if (!knownOrders.has(entry.order_id) || !validAccounts.has(entry.actor_id)) continue;
      await client.query(`
        INSERT INTO viggy_mart_order_status_history (id, order_id, status, actor_id, created_at)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING
      `, [entry.id, entry.order_id, entry.status, entry.actor_id, entry.created_at]);
    }

    const locations = db.prepare(`
      SELECT id, order_id, delivery_user_id, latitude, longitude, created_at FROM delivery_locations
    `).all() as Array<{
      id: string; order_id: string; delivery_user_id: string;
      latitude: number; longitude: number; created_at: string;
    }>;
    for (const location of locations) {
      if (!knownOrders.has(location.order_id) || !validAccounts.has(location.delivery_user_id)) continue;
      await client.query(`
        INSERT INTO viggy_mart_delivery_locations
          (id, order_id, delivery_user_id, latitude, longitude, created_at)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING
      `, [
        location.id, location.order_id, location.delivery_user_id,
        location.latitude, location.longitude, location.created_at,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createPostgresOrderStore(
  db: AppDatabase,
  connectionString: string,
  accountsReady: Promise<void>,
): OrderStore {
  const pool = createPostgresPool(connectionString);
  const ready = initializePostgres(pool, db, accountsReady);
  const transaction = async <T>(run: (client: PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    kind: "postgresql",
    ready,
    async getCart(userId) {
      await ready;
      const { rows } = await pool.query<CartItem>(`
        SELECT f.id, f.name, f.category, f.price, f.image_url AS "imageUrl", c.quantity
        FROM viggy_mart_cart_items c JOIN viggy_mart_foods f ON f.id = c.food_id
        WHERE c.user_id = $1 ORDER BY f.name
      `, [userId]);
      return rows;
    },
    async setCartItem(userId, foodId, quantity) {
      await ready;
      const exists = await pool.query("SELECT 1 FROM viggy_mart_foods WHERE id = $1", [foodId]);
      if (exists.rowCount === 0) return false;
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [userId]);
        if (quantity === 0) {
          await client.query(
            "DELETE FROM viggy_mart_cart_items WHERE user_id = $1 AND food_id = $2",
            [userId, foodId],
          );
        } else {
          await client.query(`
            INSERT INTO viggy_mart_cart_items (user_id, food_id, quantity) VALUES ($1, $2, $3)
            ON CONFLICT (user_id, food_id) DO UPDATE SET quantity = EXCLUDED.quantity
          `, [userId, foodId, quantity]);
        }
      });
      return true;
    },
    async placeOrder(input) {
      await ready;
      try {
        const result = await transaction(async (client) => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.customerId],
          );
          const existing = await client.query<{ id: string }>(`
            SELECT id FROM viggy_mart_orders WHERE customer_id = $1 AND idempotency_key = $2
          `, [input.customerId, input.idempotencyKey]);
          if (existing.rows[0]) {
            return { order: await readPostgresOrder(client, existing.rows[0].id), created: false };
          }
          const cart = await client.query<{
            foodId: string; name: string; price: number; quantity: number;
          }>(`
            SELECT f.id AS "foodId", f.name, f.price, c.quantity
            FROM viggy_mart_cart_items c JOIN viggy_mart_foods f ON f.id = c.food_id
            WHERE c.user_id = $1 FOR UPDATE OF c
          `, [input.customerId]);
          if (cart.rows.length === 0) return { order: null, created: false, empty: true };
          const orderId = randomUUID();
          const total = cart.rows.reduce((sum, item) => sum + item.price * item.quantity, 0);
          await client.query(`
            INSERT INTO viggy_mart_orders
              (id, customer_id, idempotency_key, status, address, latitude, longitude, total)
            VALUES ($1, $2, $3, 'placed', $4, $5, $6, $7)
          `, [
            orderId, input.customerId, input.idempotencyKey, input.address,
            input.latitude, input.longitude, total,
          ]);
          for (const item of cart.rows) {
            await client.query(`
              INSERT INTO viggy_mart_order_items (id, order_id, food_id, food_name, unit_price, quantity)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [randomUUID(), orderId, item.foodId, item.name, item.price, item.quantity]);
          }
          await client.query(`
            INSERT INTO viggy_mart_order_status_history (id, order_id, status, actor_id)
            VALUES ($1, $2, 'placed', $3)
          `, [randomUUID(), orderId, input.customerId]);
          await client.query("DELETE FROM viggy_mart_cart_items WHERE user_id = $1", [input.customerId]);
          return { order: await readPostgresOrder(client, orderId), created: true };
        });
        return result;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") {
          const existing = await pool.query<{ id: string }>(`
            SELECT id FROM viggy_mart_orders WHERE customer_id = $1 AND idempotency_key = $2
          `, [input.customerId, input.idempotencyKey]);
          if (existing.rows[0]) {
            return { order: await readPostgresOrder(pool, existing.rows[0].id), created: false };
          }
        }
        throw error;
      }
    },
    async listOrders(customerId) {
      await ready;
      const { rows } = await pool.query<{ id: string }>(`
        SELECT id FROM viggy_mart_orders WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 50
      `, [customerId]);
      const orders = await Promise.all(rows.map(({ id }) => readPostgresOrder(pool, id)));
      return orders.filter((order): order is Record<string, unknown> => order !== null);
    },
    async getOrder(orderId) {
      await ready;
      return readPostgresOrder(pool, orderId);
    },
    async canAccessOrder(user, orderId) {
      await ready;
      const column = user.role === "customer" ? "customer_id" : "delivery_user_id";
      const result = await pool.query(
        `SELECT 1 FROM viggy_mart_orders WHERE id = $1 AND ${column} = $2`,
        [orderId, user.id],
      );
      return result.rowCount !== 0;
    },
    async cancelOrder(customerId, orderId) {
      await ready;
      return transaction(async (client) => {
        const update = await client.query<{ id: string }>(`
          UPDATE viggy_mart_orders SET status = 'cancelled'
          WHERE id = $1 AND customer_id = $2 AND status = 'placed' AND delivery_user_id IS NULL
          RETURNING id
        `, [orderId, customerId]);
        if (update.rowCount === 0) return null;
        await client.query(`
          INSERT INTO viggy_mart_order_status_history (id, order_id, status, actor_id)
          VALUES ($1, $2, 'cancelled', $3)
        `, [randomUUID(), orderId, customerId]);
        return readPostgresOrder(client, orderId);
      });
    },
    async getDeliveryOrders() {
      await ready;
      const { rows } = await pool.query<Record<string, unknown>>(`
        SELECT o.id, o.status, o.address, o.total, o.created_at AS "createdAt",
               (SELECT COUNT(*)::INTEGER FROM viggy_mart_order_items i WHERE i.order_id = o.id) AS "itemCount"
        FROM viggy_mart_orders o WHERE o.status = 'placed' AND o.delivery_user_id IS NULL
        ORDER BY o.created_at ASC LIMIT 50
      `);
      return rows;
    },
    async claimOrder(deliveryUserId, orderId) {
      await ready;
      return transaction(async (client) => {
        const claim = await client.query<{ id: string }>(`
          UPDATE viggy_mart_orders SET delivery_user_id = $1, status = 'accepted'
          WHERE id = $2 AND status = 'placed' AND delivery_user_id IS NULL RETURNING id
        `, [deliveryUserId, orderId]);
        if (claim.rowCount === 0) return null;
        await client.query(`
          INSERT INTO viggy_mart_order_status_history (id, order_id, status, actor_id)
          VALUES ($1, $2, 'accepted', $3)
        `, [randomUUID(), orderId, deliveryUserId]);
        return readPostgresOrder(client, orderId);
      });
    },
    async updateOrderStatus(deliveryUserId, orderId, status) {
      await ready;
      const transitions: Record<string, string | undefined> = {
        accepted: "picked_up",
        picked_up: "on_the_way",
        on_the_way: "delivered",
      };
      return transaction(async (client) => {
        const current = await client.query<{ status: string }>(`
          SELECT status FROM viggy_mart_orders WHERE id = $1 AND delivery_user_id = $2 FOR UPDATE
        `, [orderId, deliveryUserId]);
        if (!current.rows[0] || transitions[current.rows[0].status] !== status) return null;
        await client.query(
          "UPDATE viggy_mart_orders SET status = $1 WHERE id = $2",
          [status, orderId],
        );
        await client.query(`
          INSERT INTO viggy_mart_order_status_history (id, order_id, status, actor_id)
          VALUES ($1, $2, $3, $4)
        `, [randomUUID(), orderId, status, deliveryUserId]);
        return readPostgresOrder(client, orderId);
      });
    },
    async addDeliveryLocation(deliveryUserId, orderId, latitude, longitude) {
      await ready;
      return transaction(async (client) => {
        const assigned = await client.query<{ status: string }>(`
          SELECT status FROM viggy_mart_orders
          WHERE id = $1 AND delivery_user_id = $2 FOR UPDATE
        `, [orderId, deliveryUserId]);
        if (!assigned.rows[0] || !["accepted", "picked_up", "on_the_way"].includes(assigned.rows[0].status)) {
          return null;
        }
        const { rows } = await client.query<Record<string, unknown>>(`
          INSERT INTO viggy_mart_delivery_locations
            (id, order_id, delivery_user_id, latitude, longitude)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING latitude, longitude, created_at AS "createdAt"
        `, [randomUUID(), orderId, deliveryUserId, latitude, longitude]);
        return rows[0];
      });
    },
    async close() {
      await pool.end();
    },
  };
}

export function createOrderStore(
  db: AppDatabase,
  connectionString: string | undefined,
  accountsReady: Promise<void>,
): OrderStore {
  return connectionString?.trim()
    ? createPostgresOrderStore(db, connectionString, accountsReady)
    : createLocalOrderStore(db);
}
