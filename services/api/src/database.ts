import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { foodCatalog } from "./catalog.js";

export function openDatabase(filename: string) {
  if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'delivery')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS foods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price BETWEEN 100 AND 2000),
      rating REAL NOT NULL,
      image_url TEXT NOT NULL,
      preparation_minutes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS foods_category_idx ON foods(category);
    CREATE INDEX IF NOT EXISTS foods_price_idx ON foods(price);
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      food_id TEXT NOT NULL REFERENCES foods(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      PRIMARY KEY (user_id, food_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES users(id),
      delivery_user_id TEXT REFERENCES users(id),
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('placed', 'accepted', 'picked_up', 'on_the_way', 'delivered', 'cancelled')),
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      total INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(customer_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS orders_delivery_idx ON orders(delivery_user_id, status);
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      food_id TEXT NOT NULL REFERENCES foods(id),
      food_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_status_history (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS delivery_locations (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      delivery_user_id TEXT NOT NULL REFERENCES users(id),
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS locations_order_idx ON delivery_locations(order_id, created_at);
  `);

  const count = db.prepare("SELECT COUNT(*) AS count FROM foods").get() as { count: number };
  if (count.count === 0) {
    const insertFood = db.prepare(`
      INSERT INTO foods (id, name, category, description, price, rating, image_url, preparation_minutes)
      VALUES (@id, @name, @category, @description, @price, @rating, @imageUrl, @preparationMinutes)
    `);
    const seed = db.transaction(() => {
      for (const food of foodCatalog) insertFood.run(food);
    });
    seed();
  }

  const refreshFoodPhotos = db.transaction(() => {
    const updatePhoto = db.prepare("UPDATE foods SET image_url = @imageUrl WHERE id = @id");
    for (const food of foodCatalog) updatePhoto.run({ id: food.id, imageUrl: food.imageUrl });
  });
  refreshFoodPhotos();

  db.function("new_uuid", randomUUID);
  return db;
}

export type AppDatabase = ReturnType<typeof openDatabase>;
