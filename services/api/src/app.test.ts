import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import request from "supertest";
import { createApplication } from "./app.js";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "bharatbite-test-"));
const system = createApplication({
  databasePath: path.join(temporaryDirectory, "bharatbite.sqlite"),
  jwtSecret: "test-secret-with-at-least-thirty-two-characters",
  deliveryInviteCode: "trusted-courier-invite",
  allowedOrigins: ["http://localhost:5173"],
});
const app = request(system.app);

after(async () => {
  await new Promise<void>((resolve) => system.io.close(() => resolve()));
  system.db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("seeds at least 100 Indian dishes and counts each browse category", async () => {
  const response = await app.get("/api/v1/catalog");
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 142);
  assert.equal(response.body.items.length, 142, "The home menu should return every seeded dish for price sorting");
  assert.equal(response.body.categories.length, 20);
  assert.ok(response.body.categorySummaries.every((category: { itemCount: number }) => category.itemCount > 0));
  assert.equal(
    response.body.categorySummaries.find((category: { name: string }) => category.name === "Biryani").itemCount,
    15,
  );
  const biryaniItems = await app.get("/api/v1/catalog?category=Biryani");
  assert.equal(new Set(biryaniItems.body.items.map((food: { imageUrl: string }) => food.imageUrl)).size, 2);
  assert.ok(biryaniItems.body.items.every((food: { imageUrl: string }) =>
    food.imageUrl.includes("images.unsplash.com/photo-")));
  const biryaniPhotos = Object.fromEntries(
    biryaniItems.body.items.map((food: { name: string; imageUrl: string }) => [food.name, food.imageUrl]),
  ) as Record<string, string>;
  assert.notEqual(biryaniPhotos["Hyderabadi Chicken Dum Biryani"], biryaniPhotos["Veg Dum Biryani"]);
  assert.equal(
    new Set(response.body.categorySummaries.map((category: { imageUrl: string }) => category.imageUrl)).size,
    response.body.categorySummaries.length,
    "Each category should have its own cover photo",
  );
  for (const category of ["Cake", "Desserts", "Dosa", "Idli", "Rolls", "Noodles", "Salad", "Shawarma", "Tea", "Starters", "Meals & Thalis", "Curries", "Street Food", "Breads & Rice", "Breakfast", "Drinks"]) {
    const categoryItems = await app.get(`/api/v1/catalog?category=${encodeURIComponent(category)}`);
    const urls = categoryItems.body.items.map((food: { imageUrl: string }) => food.imageUrl);
    assert.ok(new Set(urls).size > 1, `${category} should have varied food photos`);
  }
  assert.ok(response.body.items.every((food: { price: number }) => food.price >= 100 && food.price <= 2000));

  const filtered = await app.get("/api/v1/catalog?minPrice=1000&maxPrice=1200&category=Biryani");
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.items.length > 0);
  assert.ok(filtered.body.items.every((food: { category: string; price: number }) =>
    food.category === "Biryani" && food.price >= 1000 && food.price <= 1200));
});

test("delivery signup availability is public but the invitation code remains private", async () => {
  const options = await app.get("/api/v1/auth/options");
  assert.equal(options.status, 200);
  assert.equal(options.body.deliveryPartnerSignupAvailable, true);
  assert.equal(options.body.deliveryPartnerSignupRequiresInvite, true);
  assert.equal(JSON.stringify(options.body).includes("trusted-courier-invite"), false);
});

test("delivery signup stays unavailable when the server has no invite code", async () => {
  const inviteDisabledDirectory = mkdtempSync(path.join(tmpdir(), "viggy-invite-test-"));
  const inviteDisabled = createApplication({
    databasePath: path.join(inviteDisabledDirectory, "accounts.sqlite"),
    jwtSecret: "test-secret-with-at-least-thirty-two-characters",
    allowedOrigins: ["http://localhost:5173"],
  });
  try {
    const options = await request(inviteDisabled.app).get("/api/v1/auth/options");
    assert.equal(options.body.deliveryPartnerSignupAvailable, false);
    const signup = await request(inviteDisabled.app).post("/api/v1/auth/register").send({
      name: "Uninvited Courier",
      email: `uninvited-${randomUUID()}@example.test`,
      password: "correct-horse-battery",
      role: "delivery",
      inviteCode: "guess",
    });
    assert.equal(signup.status, 403);
  } finally {
    await new Promise<void>((resolve) => inviteDisabled.io.close(() => resolve()));
    inviteDisabled.db.close();
    rmSync(inviteDisabledDirectory, { recursive: true, force: true });
  }
});

test("requires server-verified Turnstile tokens before account creation", async () => {
  const verificationDirectory = mkdtempSync(path.join(tmpdir(), "viggy-turnstile-test-"));
  const verificationSystem = createApplication({
    databasePath: path.join(verificationDirectory, "accounts.sqlite"),
    jwtSecret: "test-secret-with-at-least-thirty-two-characters",
    turnstileSiteKey: "public-test-site-key",
    turnstileSecretKey: "private-test-secret-key",
    allowedOrigins: ["http://localhost:5173"],
  });
  const verificationApp = request(verificationSystem.app);
  const originalFetch = globalThis.fetch;
  let verificationCalls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.ok(init?.body instanceof URLSearchParams);
    verificationCalls += 1;
    assert.equal(init.body.get("secret"), "private-test-secret-key");
    return new Response(JSON.stringify({ success: init.body.get("response") === "valid-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const options = await verificationApp.get("/api/v1/auth/options");
    assert.equal(options.body.humanVerificationEnabled, true);
    assert.equal(options.body.humanVerificationSiteKey, "public-test-site-key");
    assert.equal(JSON.stringify(options.body).includes("private-test-secret-key"), false);

    const missingToken = await verificationApp.post("/api/v1/auth/register").send({
      name: "Missing Token",
      email: `missing-${randomUUID()}@example.test`,
      password: "correct-horse-battery",
    });
    assert.equal(missingToken.status, 403);
    assert.equal(verificationCalls, 0);

    const invalidToken = await verificationApp.post("/api/v1/auth/register").send({
      name: "Invalid Token",
      email: `invalid-${randomUUID()}@example.test`,
      password: "correct-horse-battery",
      humanVerificationToken: "invalid-token",
    });
    assert.equal(invalidToken.status, 403);

    const validToken = await verificationApp.post("/api/v1/auth/register").send({
      name: "Verified Customer",
      email: `verified-${randomUUID()}@example.test`,
      password: "correct-horse-battery",
      humanVerificationToken: "valid-token",
    });
    assert.equal(validToken.status, 201);
    assert.equal(verificationCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => verificationSystem.io.close(() => resolve()));
    await verificationSystem.accountStore.close();
    verificationSystem.db.close();
    rmSync(verificationDirectory, { recursive: true, force: true });
  }
});

test("registers customers and persists carts, idempotent orders, and history", async () => {
  const email = `customer-${randomUUID()}@example.test`;
  const registration = await app.post("/api/v1/auth/register").send({
    name: "Test Customer",
    email,
    password: "correct-horse-battery",
  });
  assert.equal(registration.status, 201);
  const token = registration.body.token as string;
  assert.ok(token);

  const unauthorizedCart = await app.get("/api/v1/cart");
  assert.equal(unauthorizedCart.status, 401);

  const added = await app.put("/api/v1/cart/items/bb-001")
    .set("Authorization", `Bearer ${token}`)
    .send({ quantity: 2 });
  assert.equal(added.status, 200);
  const cart = await app.get("/api/v1/cart").set("Authorization", `Bearer ${token}`);
  assert.equal(cart.body.items[0].quantity, 2);

  const key = randomUUID();
  const orderResponse = await app.post("/api/v1/orders")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send({ address: "12 Test Street, Bengaluru, Karnataka" });
  assert.equal(orderResponse.status, 201);
  const order = orderResponse.body.order as { id: string; total: number; status: string };
  assert.equal(order.status, "placed");
  assert.equal(order.total, cart.body.items[0].price * 2);

  const retry = await app.post("/api/v1/orders")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send({ address: "12 Test Street, Bengaluru, Karnataka" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.order.id, order.id);
  const history = await app.get("/api/v1/orders").set("Authorization", `Bearer ${token}`);
  assert.equal(history.body.orders.length, 1);
  const emptyCart = await app.get("/api/v1/cart").set("Authorization", `Bearer ${token}`);
  assert.equal(emptyCart.body.items.length, 0);
});

test("limits delivery access to claimed orders and protects live location updates", async () => {
  const customer = await app.post("/api/v1/auth/register").send({
    name: "Delivery Test Customer",
    email: `delivery-customer-${randomUUID()}@example.test`,
    password: "correct-horse-battery",
  });
  const customerToken = customer.body.token as string;
  await app.put("/api/v1/cart/items/bb-002")
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ quantity: 1 });
  const placed = await app.post("/api/v1/orders")
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ address: "50 Delivery Road, Bengaluru, Karnataka" });
  const orderId = placed.body.order.id as string;

  const delivery = await app.post("/api/v1/auth/register").send({
    name: "Trusted Courier",
    email: `courier-${randomUUID()}@example.test`,
    password: "correct-horse-battery",
    role: "delivery",
    inviteCode: "trusted-courier-invite",
  });
  assert.equal(delivery.status, 201);
  const deliveryToken = delivery.body.token as string;
  assert.equal(
    (await app.get("/api/v1/orders").set("Authorization", `Bearer ${deliveryToken}`)).status,
    403,
  );
  assert.equal(
    (await app.post(`/api/v1/orders/${orderId}/claim`).set("Authorization", `Bearer ${customerToken}`)).status,
    403,
  );
  assert.equal(
    (await app.post(`/api/v1/orders/${orderId}/claim`).set("Authorization", `Bearer ${deliveryToken}`)).status,
    200,
  );
  assert.equal(
    (await app.post(`/api/v1/orders/${orderId}/claim`).set("Authorization", `Bearer ${deliveryToken}`)).status,
    409,
  );

  const location = await app.post(`/api/v1/orders/${orderId}/location`)
    .set("Authorization", `Bearer ${deliveryToken}`)
    .send({ latitude: 12.9716, longitude: 77.5946 });
  assert.equal(location.status, 201);
  const updated = await app.get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${customerToken}`);
  assert.equal(updated.body.order.latestLocation.latitude, 12.9716);

  const stranger = await app.post("/api/v1/auth/register").send({
    name: "Different Customer",
    email: `stranger-${randomUUID()}@example.test`,
    password: "correct-horse-battery",
  });
  const unauthorizedLocation = await app.post(`/api/v1/orders/${orderId}/location`)
    .set("Authorization", `Bearer ${stranger.body.token}`)
    .send({ latitude: 12, longitude: 77 });
  assert.equal(unauthorizedLocation.status, 403);
});
