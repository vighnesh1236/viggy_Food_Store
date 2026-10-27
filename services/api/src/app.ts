import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { createAccountStore, type AccountStore } from "./account-store.js";
import { foodCategories } from "./catalog.js";
import { openDatabase, type AppDatabase } from "./database.js";
import { createOrderStore } from "./order-store.js";

type UserRole = "customer" | "delivery";
interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}
interface TokenPayload extends JwtPayload {
  sub: string;
  name: string;
  email: string;
  role: UserRole;
}
interface AuthedRequest extends Request {
  user?: AuthUser;
}
interface ApplicationOptions {
  databasePath?: string;
  databaseUrl?: string;
  jwtSecret?: string;
  deliveryInviteCode?: string;
  turnstileSecretKey?: string;
  turnstileSiteKey?: string;
  webDistPath?: string;
  allowedOrigins?: string[];
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  role: z.enum(["customer", "delivery"]).default("customer"),
  inviteCode: z.string().optional(),
  humanVerificationToken: z.string().max(2048).optional(),
});
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(72),
});
const cartItemSchema = z.object({
  quantity: z.number().int().min(0).max(20),
});
const checkoutSchema = z.object({
  address: z.string().trim().min(8).max(300),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const statuses = ["accepted", "picked_up", "on_the_way", "delivered"] as const;
type DeliveryStatus = (typeof statuses)[number];

function isValidBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  response: Response,
): body is z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid request",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return false;
  }
  return true;
}

function createToken(user: AuthUser, secret: string) {
  return jwt.sign(
    { name: user.name, email: user.email, role: user.role },
    secret,
    { subject: user.id, expiresIn: "7d", issuer: "bharatbite-api", audience: "bharatbite-app" },
  );
}

function sendOrderUpdate(io: Server, orderId: string, event: string, data: unknown) {
  io.to(`order:${orderId}`).emit(event, data);
}

function getRouteParam(request: Request, name: string) {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isDuplicateAccountError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  return code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

export function createApplication(options: ApplicationOptions = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET ?? (
    isProduction ? "" : "local-development-secret-change-before-deploy"
  );
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? "./data/bharatbite.sqlite";
  const db = openDatabase(databasePath);
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (isProduction && !databaseUrl?.trim()) {
    db.close();
    throw new Error("DATABASE_URL is required in production so accounts and orders use PostgreSQL.");
  }
  const turnstileSecretKey = options.turnstileSecretKey ?? process.env.TURNSTILE_SECRET_KEY?.trim();
  const turnstileSiteKey = options.turnstileSiteKey ?? process.env.TURNSTILE_SITE_KEY?.trim();
  if (Boolean(turnstileSecretKey) !== Boolean(turnstileSiteKey)) {
    db.close();
    throw new Error("TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY must be configured together.");
  }
  const humanVerificationEnabled = Boolean(turnstileSecretKey && turnstileSiteKey);
  const accountStore: AccountStore = createAccountStore(db, databaseUrl);
  const orderStore = createOrderStore(db, databaseUrl, accountStore.ready);
  const app = express();
  const server = createServer(app);
  const allowedOrigins = options.allowedOrigins ?? (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  if (process.env.RENDER_EXTERNAL_URL && !allowedOrigins.includes(process.env.RENDER_EXTERNAL_URL)) {
    allowedOrigins.push(process.env.RENDER_EXTERNAL_URL);
  }
  const io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  });

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => cors({
    origin(origin, callback) {
      const requestOrigin = `${request.protocol}://${request.get("host")}`;
      if (!origin || allowedOrigins.includes(origin) || origin === requestOrigin) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  })(request, response, next));
  app.use(express.json({ limit: "1mb" }));

  const authenticate = (request: Request, response: Response, next: NextFunction) => {
    const header = request.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      response.status(401).json({ error: "Sign in to continue." });
      return;
    }
    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: "bharatbite-api",
        audience: "bharatbite-app",
      }) as TokenPayload;
      (request as AuthedRequest).user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: payload.role,
      };
      next();
    } catch {
      response.status(401).json({ error: "Your session expired. Sign in again." });
    }
  };
  const requireRole = (role: UserRole) => (request: Request, response: Response, next: NextFunction) => {
    if ((request as AuthedRequest).user?.role !== role) {
      response.status(403).json({ error: "You do not have permission to do that." });
      return;
    }
    next();
  };

  app.get("/api/v1/health", async (_request, response, next) => {
    try {
      await Promise.all([accountStore.ready, orderStore.ready]);
    } catch (error) {
      next(error);
      return;
    }
    const count = (db.prepare("SELECT COUNT(*) AS count FROM foods").get() as { count: number }).count;
    response.json({
      status: "ok",
      catalogItems: count,
      accountStorage: accountStore.kind,
      orderStorage: orderStore.kind,
    });
  });

  app.get("/api/v1/catalog", (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
    const category = typeof request.query.category === "string" ? request.query.category : "";
    const minPrice = Math.max(100, Number(request.query.minPrice) || 100);
    const maxPrice = Math.min(2000, Number(request.query.maxPrice) || 2000);
    const page = Math.max(1, Math.min(50, Number(request.query.page) || 1));
    const pageSize = 200;
    const conditions = ["price >= @minPrice", "price <= @maxPrice"];
    const params: Record<string, string | number> = { minPrice, maxPrice };
    if (category && foodCategories.includes(category as (typeof foodCategories)[number])) {
      conditions.push("category = @category");
      params.category = category;
    }
    if (query) {
      conditions.push("(name LIKE @query OR description LIKE @query)");
      params.query = `%${query.replace(/[%_]/g, "")}%`;
    }
    const where = conditions.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM foods WHERE ${where}`).get(params) as { count: number }).count;
    const items = db.prepare(`
      SELECT id, name, category, description, price, rating, image_url AS imageUrl,
             preparation_minutes AS preparationMinutes
      FROM foods WHERE ${where} ORDER BY rating DESC, name ASC LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
    const categorySummary = db.prepare(`
      SELECT COUNT(*) AS itemCount,
        (SELECT image_url FROM foods WHERE category = ? ORDER BY id LIMIT 1) AS imageUrl
      FROM foods WHERE category = ?
    `);
    const categorySummaries = foodCategories.map((name) => ({
      name,
      ...(categorySummary.get(name, name) as { itemCount: number; imageUrl: string }),
    }));
    response.json({ items, categories: foodCategories, categorySummaries, total, page, pageSize });
  });

  app.post("/api/v1/auth/register", async (request, response, next) => {
    if (!isValidBody(registerSchema, request.body, response)) return;
    const { name, email, password, inviteCode, humanVerificationToken } = request.body;
    if (humanVerificationEnabled) {
      if (!turnstileSecretKey) {
        response.status(503).json({ error: "Human verification is temporarily unavailable. Please try again." });
        return;
      }
      if (!humanVerificationToken) {
        response.status(403).json({ error: "Please verify that you are human before creating an account." });
        return;
      }
      try {
        const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret: turnstileSecretKey,
            response: humanVerificationToken,
            ...(request.ip ? { remoteip: request.ip } : {}),
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!verification.ok) {
          console.error(`Cloudflare Turnstile verification returned HTTP ${verification.status}.`);
          response.status(503).json({ error: "Human verification is temporarily unavailable. Please try again." });
          return;
        }
        const result = await verification.json() as { success?: unknown };
        if (result.success !== true) {
          response.status(403).json({ error: "Please complete human verification and try again." });
          return;
        }
      } catch (error) {
        console.error("Cloudflare Turnstile verification failed.", error);
        response.status(503).json({ error: "Human verification is temporarily unavailable. Please try again." });
        return;
      }
    }
    const role = request.body.role ?? "customer";
    const deliveryInviteCode = options.deliveryInviteCode ?? process.env.DELIVERY_INVITE_CODE;
    if (role === "delivery" && (!deliveryInviteCode || inviteCode !== deliveryInviteCode)) {
      response.status(403).json({ error: "Delivery partner registration requires an invitation code." });
      return;
    }
    try {
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      const emailAddress = email.toLowerCase();
      await accountStore.create({
        id,
        name,
        email: emailAddress,
        passwordHash,
        role,
      });
      const user: AuthUser = { id, name, email: emailAddress, role };
      response.status(201).json({ user, token: createToken(user, jwtSecret) });
    } catch (error) {
      if (isDuplicateAccountError(error)) {
        response.status(409).json({ error: "An account with that email already exists." });
        return;
      }
      next(error);
    }
  });

  app.post("/api/v1/auth/login", async (request, response, next) => {
    if (!isValidBody(loginSchema, request.body, response)) return;
    try {
      const record = await accountStore.findByEmail(request.body.email.toLowerCase());
      if (!record || !(await bcrypt.compare(request.body.password, record.passwordHash))) {
        response.status(401).json({ error: "Email or password is incorrect." });
        return;
      }
      const user: AuthUser = { id: record.id, name: record.name, email: record.email, role: record.role };
      response.json({ user, token: createToken(user, jwtSecret) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/auth/me", authenticate, (request, response) => {
    response.json({ user: (request as AuthedRequest).user });
  });

  app.get("/api/v1/auth/options", (_request, response) => {
    response.json({
      deliveryPartnerSignupAvailable: Boolean(options.deliveryInviteCode ?? process.env.DELIVERY_INVITE_CODE),
      deliveryPartnerSignupRequiresInvite: true,
      humanVerificationEnabled,
      humanVerificationSiteKey: humanVerificationEnabled ? turnstileSiteKey : null,
    });
  });

  app.get("/api/v1/cart", authenticate, requireRole("customer"), async (request, response) => {
    const user = (request as AuthedRequest).user!;
    response.json({ items: await orderStore.getCart(user.id) });
  });

  app.put("/api/v1/cart/items/:foodId", authenticate, requireRole("customer"), async (request, response) => {
    if (!isValidBody(cartItemSchema, request.body, response)) return;
    const user = (request as AuthedRequest).user!;
    const foodId = getRouteParam(request, "foodId");
    if (!(await orderStore.setCartItem(user.id, foodId, request.body.quantity))) {
      response.status(404).json({ error: "Food item not found." });
      return;
    }
    response.json({ ok: true });
  });

  app.post("/api/v1/orders", authenticate, requireRole("customer"), async (request, response) => {
    if (!isValidBody(checkoutSchema, request.body, response)) return;
    const user = (request as AuthedRequest).user!;
    const idempotencyKey = request.header("Idempotency-Key")?.slice(0, 100) || randomUUID();
    const result = await orderStore.placeOrder({
      customerId: user.id,
      idempotencyKey,
      address: request.body.address,
      latitude: request.body.latitude ?? null,
      longitude: request.body.longitude ?? null,
    });
    if (result.empty) {
      response.status(400).json({ error: "Your cart is empty." });
      return;
    }
    const orderId = String(result.order?.id);
    if (result.created) sendOrderUpdate(io, orderId, "order:updated", result.order);
    response.status(result.created ? 201 : 200).json({ order: result.order });
  });

  app.get("/api/v1/orders", authenticate, async (request, response) => {
    const user = (request as AuthedRequest).user!;
    if (user.role !== "customer") {
      response.status(403).json({ error: "Customer order history is only available to customers." });
      return;
    }
    response.json({ orders: await orderStore.listOrders(user.id) });
  });

  app.get("/api/v1/orders/:orderId", authenticate, async (request, response) => {
    const user = (request as AuthedRequest).user!;
    const orderId = getRouteParam(request, "orderId");
    if (!(await orderStore.canAccessOrder(user, orderId))) {
      response.status(404).json({ error: "Order not found." });
      return;
    }
    response.json({ order: await orderStore.getOrder(orderId) });
  });

  app.post("/api/v1/orders/:orderId/cancel", authenticate, requireRole("customer"), async (request, response) => {
    const user = (request as AuthedRequest).user!;
    const orderId = getRouteParam(request, "orderId");
    const order = await orderStore.cancelOrder(user.id, orderId);
    if (!order) {
      response.status(409).json({ error: "This order can no longer be cancelled." });
      return;
    }
    sendOrderUpdate(io, orderId, "order:updated", order);
    response.json({ order });
  });

  app.get("/api/v1/delivery/orders", authenticate, requireRole("delivery"), async (_request, response) => {
    response.json({ orders: await orderStore.getDeliveryOrders() });
  });

  app.post("/api/v1/orders/:orderId/claim", authenticate, requireRole("delivery"), async (request, response) => {
    const user = (request as AuthedRequest).user!;
    const orderId = getRouteParam(request, "orderId");
    const order = await orderStore.claimOrder(user.id, orderId);
    if (!order) {
      response.status(409).json({ error: "This order was already claimed or is no longer available." });
      return;
    }
    sendOrderUpdate(io, orderId, "order:updated", order);
    response.json({ order });
  });

  app.patch("/api/v1/orders/:orderId/status", authenticate, requireRole("delivery"), async (request, response) => {
    const user = (request as AuthedRequest).user!;
    const orderId = getRouteParam(request, "orderId");
    const requestedStatus = request.body?.status as DeliveryStatus;
    if (!statuses.includes(requestedStatus)) {
      response.status(400).json({ error: "Invalid delivery status." });
      return;
    }
    const order = await orderStore.updateOrderStatus(user.id, orderId, requestedStatus);
    if (!order) {
      response.status(409).json({ error: "That order status transition is not allowed." });
      return;
    }
    sendOrderUpdate(io, orderId, "order:updated", order);
    response.json({ order });
  });

  app.post("/api/v1/orders/:orderId/location", authenticate, requireRole("delivery"), async (request, response) => {
    if (!isValidBody(locationSchema, request.body, response)) return;
    const user = (request as AuthedRequest).user!;
    const orderId = getRouteParam(request, "orderId");
    const { latitude, longitude } = request.body;
    const location = await orderStore.addDeliveryLocation(user.id, orderId, latitude, longitude);
    if (!location) {
      response.status(404).json({ error: "No active delivery assignment found." });
      return;
    }
    sendOrderUpdate(io, orderId, "delivery:location", location);
    response.status(201).json({ location });
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      next(new Error("Authentication required"));
      return;
    }
    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: "bharatbite-api",
        audience: "bharatbite-app",
      }) as TokenPayload;
      socket.data.user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: payload.role,
      } satisfies AuthUser;
      next();
    } catch {
      next(new Error("Invalid or expired session"));
    }
  });
  io.on("connection", (socket) => {
    socket.on("order:join", (orderId: unknown, callback?: (result: { ok: boolean }) => void) => {
      if (typeof orderId !== "string" || orderId.length > 100) {
        callback?.({ ok: false });
        return;
      }
      void (async () => {
        try {
          if (!(await orderStore.canAccessOrder(socket.data.user as AuthUser, orderId))) {
            callback?.({ ok: false });
            return;
          }
          socket.join(`order:${orderId}`);
          callback?.({ ok: true });
          socket.emit("order:updated", await orderStore.getOrder(orderId));
        } catch (error) {
          console.error("Could not join order updates.", error);
          callback?.({ ok: false });
        }
      })();
    });
  });

  const webDistPath = options.webDistPath ?? path.resolve(process.cwd(), "../../apps/public-web/dist");
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath, { index: false, maxAge: isProduction ? "1h" : 0 }));
    app.get(/^(?!\/api\/).*/, (_request, response, next) => {
      response.sendFile(path.join(webDistPath, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "An unexpected server error occurred." });
  });

  return { app, server, io, db, accountStore, orderStore };
}
