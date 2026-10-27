import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";

type Role = "customer" | "delivery";
interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
interface Food {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  rating: number;
  imageUrl: string;
  preparationMinutes: number;
}
interface CategorySummary {
  name: string;
  itemCount: number;
  imageUrl: string;
}
interface CartFood extends Food {
  quantity: number;
}
interface Order {
  id: string;
  status: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  total: number;
  createdAt: string;
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number }>;
  history: Array<{ status: string; createdAt: string }>;
  latestLocation?: { latitude: number; longitude: number; createdAt: string } | null;
}
type Theme = "light" | "dark";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme: Theme;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:4000" : "");
const categoryEmojis: Record<string, string> = {
  "Biryani": "🍛",
  "North Indian": "🥘",
  "South Indian": "🍚",
  "Cake": "🍰",
  "Dosa": "🥞",
  "Idli": "🍘",
  "Rolls": "🌯",
  "Noodles": "🍜",
  "Salad": "🥗",
  "Shawarma": "🥙",
  "Tea": "🫖",
  "Starters": "🥘",
  "Meals & Thalis": "🍱",
  "Curries": "🍲",
  "Street Food": "🥙",
  "Breads & Rice": "🫓",
  "Desserts": "🍮",
  "Breakfast": "🥞",
  "Drinks": "🥤",
  "Combos": "🍽️",
};
const categoryPageNames = [
  "Biryani", "North Indian", "South Indian", "Cake", "Desserts", "Dosa", "Idli", "Rolls",
  "Noodles", "Salad", "Shawarma", "Tea", "Starters", "Meals & Thalis", "Curries",
  "Street Food", "Breads & Rice", "Breakfast", "Drinks", "Combos",
];
const orderSteps = [
  ["placed", "Order placed"],
  ["accepted", "Delivery partner assigned"],
  ["picked_up", "Picked up"],
  ["on_the_way", "On the way"],
  ["delivered", "Delivered"],
];

function getCategoryFromPath() {
  const slug = window.location.pathname.match(/^\/category\/([^/]+)\/?$/)?.[1];
  return slug ? categoryPageNames.find((category) => categorySlug(category) === slug) ?? null : null;
}

function categorySlug(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function savedSession() {
  try {
    const token = localStorage.getItem("bharatbite-token");
    const user = localStorage.getItem("bharatbite-user");
    return token && user ? { token, user: JSON.parse(user) as User } : { token: "", user: null };
  } catch {
    localStorage.removeItem("bharatbite-token");
    localStorage.removeItem("bharatbite-user");
    return { token: "", user: null };
  }
}

function savedTheme(): Theme {
  return localStorage.getItem("viggy-mart-theme") === "dark" ? "dark" : "light";
}

function HumanVerification({
  siteKey,
  theme,
  resetSignal,
  onToken,
}: {
  siteKey: string;
  theme: Theme;
  resetSignal: number;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    let widgetId: string | null = null;
    let script = document.querySelector<HTMLScriptElement>("script[data-cloudflare-turnstile]");

    const renderWidget = () => {
      if (!active || !window.turnstile || !container.current || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => {
          onToken("");
          setLoadError("Verification failed to load. Refresh the page and try again.");
        },
      });
    };
    const handleScriptError = () => {
      if (active) setLoadError("Verification failed to load. Check your connection and try again.");
    };
    const handleScriptLoad = () => {
      if (script) script.dataset.loaded = "true";
      renderWidget();
    };

    setLoadError("");
    if (window.turnstile) {
      renderWidget();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.cloudflareTurnstile = "true";
        document.head.appendChild(script);
      }
      if (script.dataset.loaded === "true") {
        handleScriptError();
      } else {
        script.addEventListener("load", handleScriptLoad);
        script.addEventListener("error", handleScriptError);
      }
    }

    return () => {
      active = false;
      script?.removeEventListener("load", handleScriptLoad);
      script?.removeEventListener("error", handleScriptError);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, resetSignal, siteKey, theme]);

  return (
    <div className="human-verification" role="group" aria-label="Human verification">
      <p>Verify you’re human</p>
      <div ref={container} />
      {loadError && <small role="alert">{loadError}</small>}
    </div>
  );
}

async function readError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error || `Request failed (${response.status}).`;
}

export default function App() {
  const [session, setSession] = useState(savedSession);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [deliverySignupAvailable, setDeliverySignupAvailable] = useState(false);
  const [humanVerificationEnabled, setHumanVerificationEnabled] = useState(false);
  const [humanVerificationSiteKey, setHumanVerificationSiteKey] = useState("");
  const [humanVerificationToken, setHumanVerificationToken] = useState("");
  const [humanVerificationReset, setHumanVerificationReset] = useState(0);
  const [foods, setFoods] = useState<Food[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categorySummaries, setCategorySummaries] = useState<CategorySummary[]>([]);
  const [cart, setCart] = useState<CartFood[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [availableOrders, setAvailableOrders] = useState<Array<{
    id: string; status: string; address: string; total: number; itemCount: number;
  }>>([]);
  const [query, setQuery] = useState("");
  const [pageCategory, setPageCategory] = useState<string | null>(getCategoryFromPath);
  const [priceSort, setPriceSort] = useState<"asc" | "desc">("asc");
  const [authOpen, setAuthOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [authRole, setAuthRole] = useState<Role>("customer");
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingFoods, setLoadingFoods] = useState(true);
  const [error, setError] = useState("");
  const [searchAddress, setSearchAddress] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [trackingLocation, setTrackingLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [pendingFoodId, setPendingFoodId] = useState("");
  const locationWatchId = useRef<number | null>(null);
  const lastLocationSentAt = useRef(0);
  const sendingLocation = useRef(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(await readError(response));
    if (response.status === 204) return null;
    return response.json();
  }, [session.token]);

  const loadCatalog = useCallback(async () => {
    setLoadingFoods(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (pageCategory) params.set("category", pageCategory);
      const result = await request(`/api/v1/catalog?${params}`) as {
        items: Food[]; categories: string[]; categorySummaries: CategorySummary[];
      };
      setFoods(result.items);
      setCategories(result.categories);
      setCategorySummaries(result.categorySummaries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the menu.");
    } finally {
      setLoadingFoods(false);
    }
  }, [pageCategory, query, request]);

  const loadCart = useCallback(async () => {
    if (!session.token || session.user?.role !== "customer") {
      setCart([]);
      return;
    }
    try {
      const result = await request("/api/v1/cart") as { items: CartFood[] };
      setCart(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your cart.");
    }
  }, [request, session.token, session.user?.role]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("viggy-mart-theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    request("/api/v1/auth/options")
      .then((result) => {
        if (active) {
          const options = result as {
            deliveryPartnerSignupAvailable: boolean;
            humanVerificationEnabled: boolean;
            humanVerificationSiteKey: string | null;
          };
          setDeliverySignupAvailable(options.deliveryPartnerSignupAvailable);
          setHumanVerificationEnabled(options.humanVerificationEnabled);
          setHumanVerificationSiteKey(options.humanVerificationSiteKey ?? "");
        }
      })
      .catch(() => {
        if (active) setDeliverySignupAvailable(false);
      });
    return () => { active = false; };
  }, [request]);

  const loadOrders = useCallback(async () => {
    if (!session.token || session.user?.role !== "customer") return;
    try {
      const result = await request("/api/v1/orders") as { orders: Order[] };
      setOrders(result.orders);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load orders.");
    }
  }, [request, session.token, session.user?.role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog, query]);

  useEffect(() => {
    function syncCategoryPath() {
      const pathCategory = getCategoryFromPath();
      const matching = categories.find((category) => categorySlug(category) === pathCategory);
      setPageCategory(matching ?? null);
    }
    window.addEventListener("popstate", syncCategoryPath);
    return () => window.removeEventListener("popstate", syncCategoryPath);
  }, [categories]);

  useEffect(() => {
    void loadCart();
    void loadOrders();
  }, [loadCart, loadOrders]);

  useEffect(() => {
    if (!session.token || session.user?.role !== "delivery" || !deliveryOpen) return;
    let active = true;
    request("/api/v1/delivery/orders")
      .then((result) => {
        if (active) setAvailableOrders((result as { orders: typeof availableOrders }).orders);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load deliveries."));
    return () => { active = false; };
  }, [deliveryOpen, request, session.token, session.user?.role]);

  useEffect(() => {
    if (!selectedOrder || !session.token) return;
    const socket = io(API_BASE_URL || window.location.origin, {
      auth: { token: session.token },
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => socket.emit("order:join", selectedOrder.id));
    socket.on("order:updated", (order: Order) => {
      if (order.id === selectedOrder.id) {
        setSelectedOrder(order);
        setTrackingLocation(order.latestLocation ?? null);
        setOrders((previous) => previous.map((entry) => entry.id === order.id ? order : entry));
      }
    });
    socket.on("delivery:location", setTrackingLocation);
    socket.on("connect_error", () => setError("Live tracking disconnected. Refresh the order to reconnect."));
    return () => { socket.disconnect(); };
  }, [selectedOrder?.id, session.token]);

  useEffect(() => () => {
    if (locationWatchId.current !== null) navigator.geolocation.clearWatch(locationWatchId.current);
  }, []);

  useEffect(() => {
    if (
      selectedOrder?.status === "delivered" ||
      selectedOrder?.status === "cancelled" ||
      session.user?.role !== "delivery"
    ) {
      if (locationWatchId.current !== null) {
        navigator.geolocation.clearWatch(locationWatchId.current);
        locationWatchId.current = null;
      }
      setSharingLocation(false);
    }
  }, [selectedOrder?.status, session.user?.role]);

  const foodShelves = useMemo(
    () => {
      const sortedFoods = [...foods].sort((a, b) =>
        priceSort === "asc"
          ? a.price - b.price || a.name.localeCompare(b.name)
          : b.price - a.price || a.name.localeCompare(b.name));
      if (pageCategory) return [{ category: pageCategory, items: sortedFoods }];
      return categories.map((category) => ({
        category,
        items: sortedFoods.filter((food) => food.category === category),
      })).filter((shelf) => shelf.items.length > 0);
    },
    [categories, foods, pageCategory, priceSort],
  );
  const cartTotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const publicOrigin = import.meta.env.VITE_PUBLIC_APP_URL?.trim() || window.location.origin;
  const shareUrl = `${publicOrigin}/`;
  const mapUrl = selectedOrder && trackingLocation
    ? `https://maps.google.com/maps?saddr=${encodeURIComponent(`${trackingLocation.latitude},${trackingLocation.longitude}`)}&daddr=${encodeURIComponent(selectedOrder.address)}&output=embed`
    : `https://maps.google.com/maps?q=${encodeURIComponent(selectedOrder?.address || searchAddress || "Banjara Hills, Hyderabad, Telangana")}&output=embed`;

  async function addItem(foodId: string, currentQuantity: number) {
    if (!session.token) {
      setPendingFoodId(foodId);
      setIsRegister(true);
      setAuthRole("customer");
      setAuthOpen(true);
      return;
    }
    if (session.user?.role !== "customer") {
      setError("Sign in with a customer account to add food to your cart.");
      return;
    }
    try {
      await request(`/api/v1/cart/items/${foodId}`, {
        method: "PUT",
        body: JSON.stringify({ quantity: currentQuantity + 1 }),
      });
      await loadCart();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your cart.");
    }
  }

  async function setQuantity(item: CartFood, quantity: number) {
    try {
      await request(`/api/v1/cart/items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ quantity }),
      });
      await loadCart();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your cart.");
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requiresHumanVerification = isRegister && humanVerificationEnabled;
    if (requiresHumanVerification && !humanVerificationToken) {
      setError("Please verify that you are human before creating an account.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    if (isRegister) {
      body.name = String(form.get("name") ?? "");
      body.role = authRole;
      if (authRole === "delivery") body.inviteCode = inviteCode;
      if (humanVerificationToken) body.humanVerificationToken = humanVerificationToken;
    }
    try {
      const result = await request(`/api/v1/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(body),
      }) as { token: string; user: User };
      localStorage.setItem("bharatbite-token", result.token);
      localStorage.setItem("bharatbite-user", JSON.stringify(result.user));
      setSession(result);
      setAuthOpen(false);
      setInviteCode("");
      setError("");
      if (result.user.role === "customer") {
        const cartResult = await fetch(`${API_BASE_URL}/api/v1/cart`, {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        if (cartResult.ok) setCart((await cartResult.json() as { items: CartFood[] }).items);
        if (pendingFoodId) {
          await fetch(`${API_BASE_URL}/api/v1/cart/items/${pendingFoodId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${result.token}` },
            body: JSON.stringify({ quantity: 1 }),
          });
          setPendingFoodId("");
          await loadCart();
        }
      } else {
        setDeliveryOpen(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
      if (requiresHumanVerification) {
        setHumanVerificationToken("");
        setHumanVerificationReset((value) => value + 1);
      }
    }
  }

  const receiveHumanVerificationToken = useCallback((token: string) => {
    setHumanVerificationToken(token);
  }, []);

  function signOut() {
    localStorage.removeItem("bharatbite-token");
    localStorage.removeItem("bharatbite-user");
    setSession({ token: "", user: null });
    setSelectedOrder(null);
    setCart([]);
    setOrders([]);
    setDeliveryOpen(false);
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await request("/api/v1/orders", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          address: String(form.get("address") ?? ""),
          ...(coordinates ?? {}),
        }),
      }) as { order: Order };
      setSelectedOrder(result.order);
      setCartOpen(false);
      await loadCart();
      await loadOrders();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not place your order.");
    } finally {
      setBusy(false);
    }
  }

  function getCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location is not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = { latitude: coords.latitude, longitude: coords.longitude };
        setCoordinates(location);
        setDeliveryAddress(`GPS ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      },
      (reason) => setError(reason.code === reason.PERMISSION_DENIED
        ? "Location permission was denied. Enter your delivery address instead."
        : "Could not get your location. Check your device location settings."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function claimOrder(orderId: string) {
    try {
      const result = await request(`/api/v1/orders/${orderId}/claim`, { method: "POST" }) as { order: Order };
      setSelectedOrder(result.order);
      setAvailableOrders((current) => current.filter((order) => order.id !== orderId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept this delivery.");
    }
  }

  async function updateDeliveryStatus(order: Order) {
    const next = orderSteps[orderSteps.findIndex(([status]) => status === order.status) + 1]?.[0];
    if (!next) return;
    try {
      const result = await request(`/api/v1/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      }) as { order: Order };
      setSelectedOrder(result.order);
      if (result.order.status === "delivered" && locationWatchId.current !== null) {
        navigator.geolocation.clearWatch(locationWatchId.current);
        locationWatchId.current = null;
        setSharingLocation(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update order status.");
    }
  }

  function toggleLocationSharing() {
    if (!navigator.geolocation) {
      setError("Location sharing is not supported by this browser.");
      return;
    }
    if (!selectedOrder || !session.token) return;
    if (locationWatchId.current !== null) {
      navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
      setSharingLocation(false);
      return;
    }
    setSharingLocation(true);
    locationWatchId.current = navigator.geolocation.watchPosition(async ({ coords }) => {
      if (Date.now() - lastLocationSentAt.current < 10000 || sendingLocation.current) return;
      sendingLocation.current = true;
      lastLocationSentAt.current = Date.now();
      const location = { latitude: coords.latitude, longitude: coords.longitude };
      setTrackingLocation(location);
      try {
        await request(`/api/v1/orders/${selectedOrder.id}/location`, {
          method: "POST",
          body: JSON.stringify(location),
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not share delivery location.");
        if (locationWatchId.current !== null) navigator.geolocation.clearWatch(locationWatchId.current);
        locationWatchId.current = null;
        setSharingLocation(false);
      } finally {
        sendingLocation.current = false;
      }
    }, (reason) => {
      if (locationWatchId.current !== null) navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
      setSharingLocation(false);
      setError(reason.code === reason.PERMISSION_DENIED
        ? "Location permission was denied. Enable it to share delivery progress."
        : "Could not get delivery location.");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }

  const activeStatusIndex = selectedOrder
    ? orderSteps.findIndex(([status]) => status === selectedOrder.status)
    : -1;

  function navigateToCategory(category: string) {
    window.history.pushState(null, "", `/category/${categorySlug(category)}`);
    setPageCategory(category);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigateHome() {
    window.history.pushState(null, "", "/");
    setPageCategory(null);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="market-header">
        <a className="brand" href="/" aria-label="viggy_mart home" onClick={(event) => { event.preventDefault(); navigateHome(); }}>
          <span className="brand-mark">V</span><span>viggy_mart</span>
        </a>
        <div className="delivery-location">
          <span className="location-pin">⌖</span>
          <div><small>Delivering to</small><strong>{coordinates ? "Your location" : "Hyderabad"}</strong></div>
          <span className="chevron">⌄</span>
        </div>
        <nav className="header-actions">
          {session.user?.role === "delivery" && <button className="nav-action" onClick={() => setDeliveryOpen(true)}>Delivery hub</button>}
          {session.user?.role === "customer" && <button className="nav-action" onClick={() => { void loadOrders(); setOrdersOpen(true); }}>Orders</button>}
          {session.user
            ? <button className="nav-action user-greeting" onClick={signOut}>Hi, {session.user.name.split(" ")[0]} · Sign out</button>
            : <><button className="nav-action" onClick={() => { setIsRegister(false); setAuthOpen(true); }}>Log in</button>
              <button className="nav-signup" onClick={() => { setIsRegister(true); setAuthRole("customer"); setAuthOpen(true); }}>Sign up</button></>}
          <button className="theme-toggle" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            {theme === "light" ? "☾" : "☀"}
          </button>
          <button className="cart-button" onClick={() => session.user ? setCartOpen(true) : setAuthOpen(true)} aria-label={`Open cart, ${cartCount} items`}>
            <span>▣</span><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}
          </button>
        </nav>
      </header>

      <main className="market-main">
        {!pageCategory && <section className="market-hero">
          <div className="hero-overline"><span>✦</span> YOUR FAVOURITE FOOD, DELIVERED</div>
          <h1>Cravings don’t wait.<br /><span>Neither should you.</span></h1>
          <p>Discover India’s much-loved flavours, made fresh and delivered to your door.</p>
          <div className="hero-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search dishes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search biryani, dosa, sweets..." />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}
          </div>
          <div className="hero-stat"><span>100+</span> Indian favourites <i /> <span>₹100–₹2,000</span> for every appetite</div>
          <div className="hero-decoration hero-spice">✳</div>
          <div className="hero-food">🍛</div>
        </section>}

        {!pageCategory && <section className="browse-section">
          <div className="category-heading">
            <div><span className="section-kicker">MADE FOR YOUR MOOD</span><h2>What sounds good?</h2></div>
            <div className="category-scroll-hint">Scroll to explore <span>→</span></div>
          </div>
          <div className="category-strip">
            {categorySummaries.map((category) => (
              <button key={category.name} className="category-card" onClick={() => navigateToCategory(category.name)} aria-label={`Open ${category.name}, ${category.itemCount} items`}>
                <span className="category-card-image"><img src={category.imageUrl} alt="" loading="lazy" /><span>{categoryEmojis[category.name] || "🍴"}</span></span>
                <strong>{category.name}</strong>
                <small>{category.itemCount} items</small>
              </button>
            ))}
          </div>
        </section>}

        {pageCategory && <section className="category-detail-heading">
          <button className="back-to-categories" onClick={navigateHome}>← All categories</button>
          <div className="category-detail-title">
            <span className="category-detail-emoji">{categoryEmojis[pageCategory] || "🍴"}</span>
            <div><span className="section-kicker">EXPLORE THE MENU</span><h1>{pageCategory}</h1>
              <p>{categorySummaries.find((category) => category.name === pageCategory)?.itemCount ?? foods.length} items to discover, freshly made for you.</p>
            </div>
          </div>
        </section>}

        <section className="filter-bar">
          <button
            className="price-sort-button"
            onClick={() => setPriceSort((current) => current === "asc" ? "desc" : "asc")}
            aria-label={`Sort by price, currently ${priceSort === "asc" ? "lowest first" : "highest first"}`}
            aria-pressed={priceSort === "desc"}
          >
            ₹ Sort by price: {priceSort === "asc" ? "Low to high ↑" : "High to low ↓"}
          </button>
        </section>

        {error && <div className="global-error" role="status"><span>ⓘ {error}</span><button onClick={() => setError("")}>Dismiss</button></div>}

        {loadingFoods ? <div className="catalog-loading"><span className="spinner" /> Loading today’s menu…</div> : foodShelves.length === 0 ?
          <div className="empty-menu"><span>🍽️</span><h3>No dishes found</h3><p>Try a different search or price range.</p></div> :
          foodShelves.map((shelf) => (
            <section className="food-shelf" key={shelf.category}>
              <div className="shelf-heading">
                <div><span className="shelf-icon">{categoryEmojis[shelf.category] || "🍴"}</span><div><h2>{shelf.category}</h2><p>{shelf.items.length} delicious picks, made to order</p></div></div>
                <span className="shelf-scroll">Swipe to see more <b>→</b></span>
              </div>
              <div className="food-row">
                {shelf.items.map((food) => {
                  const quantity = cart.find((entry) => entry.id === food.id)?.quantity ?? 0;
                  return (
                    <article className="food-card" key={food.id}>
                      <div className="food-image-wrap">
                        <img src={food.imageUrl} alt={food.name} loading="lazy" />
                        <span className="food-category-tag">{categoryEmojis[food.category]} {food.category}</span>
                        <span className="food-time">{food.preparationMinutes} min</span>
                      </div>
                      <div className="food-card-body">
                        <div className="food-name-row"><h3>{food.name}</h3><span className="food-rating">★ {food.rating.toFixed(1)}</span></div>
                        <p>{food.description}</p>
                        <div className="food-bottom"><strong>₹{food.price}</strong>
                          {quantity > 0
                            ? <div className="quantity-control"><button aria-label={`Remove one ${food.name}`} onClick={() => void setQuantity(cart.find((entry) => entry.id === food.id)!, quantity - 1)}>−</button><b>{quantity}</b><button aria-label={`Add one ${food.name}`} onClick={() => void addItem(food.id, quantity)}>+</button></div>
                            : <button className="add-food" onClick={() => void addItem(food.id, 0)}>ADD <span>＋</span></button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        }

        <section className="share-map-section">
          <div className="share-panel">
            <span className="section-kicker">SHARE THE GOODNESS</span><h2>Our menu, one scan away.</h2>
            <p>Scan the QR code to share viggy_mart with friends on any mobile network or Wi-Fi.</p>
            <QRCodeSVG value={shareUrl} size={136} level="M" includeMargin />
            <small>{shareUrl}</small>
          </div>
          <div className="map-panel">
            <div className="map-panel-heading"><span className="section-kicker">DELIVERY, YOUR WAY</span><h2>Find your way to us.</h2><p>Share your location for delivery or get directions to the kitchen.</p></div>
            <div className="map-controls">
              <input aria-label="Address or landmark" placeholder="Search in Hyderabad" value={searchAddress} onChange={(event) => setSearchAddress(event.target.value)} />
              <button className="map-locate" onClick={getCurrentLocation}>Use my location</button>
            </div>
            <iframe title="viggy_mart map" src={mapUrl} loading="lazy" />
            <a className="map-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(searchAddress || "Banjara Hills, Hyderabad, Telangana")}`} target="_blank" rel="noreferrer">Open Google Maps directions ↗</a>
          </div>
        </section>
      </main>
      <footer className="market-footer"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigateHome(); }}><span className="brand-mark">V</span><span>viggy_mart</span></a><span>Made for good food, great company, and easier discovery.</span><span>Freshly cooked · Locally loved</span></footer>

      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <section className="auth-modal" aria-labelledby="auth-title" role="dialog" aria-modal="true">
          <button className="modal-close" aria-label="Close" onClick={() => setAuthOpen(false)}>×</button>
          <div className="auth-brand"><span className="brand-mark">V</span></div>
          <span className="section-kicker">{isRegister ? "LET’S GET YOU STARTED" : "WELCOME BACK"}</span>
          <h2 id="auth-title">{isRegister ? "Good food is calling." : "Your next bite awaits."}</h2>
          <p>{isRegister ? "Create an account to order your favourites." : "Sign in to pick up where you left off."}</p>
          {isRegister && <div className="role-toggle">
            <button type="button" className={authRole === "customer" ? "active" : ""} onClick={() => setAuthRole("customer")}>Customer</button>
            {deliverySignupAvailable && <button type="button" className={authRole === "delivery" ? "active" : ""} onClick={() => setAuthRole("delivery")}>Delivery partner</button>}
          </div>}
          {isRegister && !deliverySignupAvailable && <p className="invite-help">Delivery partner sign-up is currently invitation-only and has not been enabled. Ask the administrator to configure the server-side invite code.</p>}
          {isRegister && authRole === "delivery" && <p className="invite-help">Delivery partner sign-up is invitation-only. Ask the viggy_mart administrator for your code; codes stay private on the server.</p>}
          <form onSubmit={handleAuth}>
            {isRegister && <label>Your name<input name="name" autoComplete="name" required minLength={2} placeholder="e.g. Ananya Rao" /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
            <label>Password<input name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} required minLength={isRegister ? 8 : 1} placeholder={isRegister ? "At least 8 characters" : "Your password"} /></label>
            {isRegister && authRole === "delivery" && <label>Delivery invite code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required placeholder="Ask your viggy_mart administrator" /></label>}
            {isRegister && humanVerificationEnabled && <HumanVerification
              siteKey={humanVerificationSiteKey}
              theme={theme}
              resetSignal={humanVerificationReset}
              onToken={receiveHumanVerificationToken}
            />}
            <button className="auth-submit" disabled={busy || (isRegister && humanVerificationEnabled && !humanVerificationToken)}>
              {busy ? "Please wait…" : isRegister ? "Create my account" : "Log in"}
            </button>
          </form>
          <p className="auth-switch">{isRegister ? "Already have an account?" : "New to viggy_mart?"} <button onClick={() => { setIsRegister(!isRegister); setError(""); setHumanVerificationToken(""); setHumanVerificationReset((value) => value + 1); }}> {isRegister ? "Log in" : "Create account"}</button></p>
        </section>
      </div>}

      {cartOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <section className="side-panel cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">
          <div className="panel-title"><div><span className="section-kicker">YOUR TASTY PICKS</span><h2 id="cart-title">Your cart <small>({cartCount})</small></h2></div><button className="modal-close" onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
          {cart.length === 0 ? <div className="empty-menu"><span>🛒</span><h3>Your cart is hungry</h3><p>Add a dish you love and it’ll show up here.</p><button className="auth-submit" onClick={() => setCartOpen(false)}>Explore the menu</button></div> :
            <><div className="cart-items">{cart.map((item) => <div className="cart-item" key={item.id}><img src={item.imageUrl} alt="" /><div className="cart-item-copy"><strong>{item.name}</strong><span>₹{item.price} each</span></div><div className="quantity-control"><button onClick={() => void setQuantity(item, item.quantity - 1)}>−</button><b>{item.quantity}</b><button onClick={() => void setQuantity(item, item.quantity + 1)}>+</button></div></div>)}</div>
            <form className="checkout-form" onSubmit={checkout}><label>Delivery address<textarea name="address" required minLength={8} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Flat, street, area, city and PIN code" /></label><button type="button" className="map-locate" onClick={getCurrentLocation}>⌖ Use my current location</button><div className="checkout-total"><span>Subtotal</span><strong>₹{cartTotal}</strong></div><div className="checkout-total"><span>Delivery & platform fees</span><span>Calculated at checkout</span></div><button className="auth-submit" disabled={busy}>{busy ? "Placing order…" : `Place order · ₹${cartTotal}`}</button><small>Cash on delivery · Payments coming soon</small></form></>}
        </section>
      </div>}

      {ordersOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrdersOpen(false); }}>
        <section className="side-panel orders-panel" role="dialog" aria-modal="true" aria-labelledby="orders-title">
          <div className="panel-title"><div><span className="section-kicker">ALL YOUR GOOD EATS</span><h2 id="orders-title">Your orders</h2></div><button className="modal-close" onClick={() => setOrdersOpen(false)} aria-label="Close orders">×</button></div>
          {orders.length === 0 ? <div className="empty-menu"><span>🥡</span><h3>No orders just yet</h3><p>Your food adventures will appear here.</p></div> :
            <div className="order-list">{orders.map((order) => <button className="order-list-card" key={order.id} onClick={() => { setSelectedOrder(order); setOrdersOpen(false); }}><span className="order-status-badge">{order.status.replaceAll("_", " ")}</span><strong>{order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</strong><span>{new Date(order.createdAt).toLocaleString()} · ₹{order.total}</span><small>Track order →</small></button>)}</div>}
        </section>
      </div>}

      {selectedOrder && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrder(null); }}>
        <section className="tracking-modal" role="dialog" aria-modal="true" aria-labelledby="tracking-title">
          <div className="panel-title"><div><span className="section-kicker">{session.user?.role === "delivery" ? "DELIVERY PARTNER HUB" : "FRESH FOOD IS ON ITS WAY"}</span><h2 id="tracking-title">{session.user?.role === "delivery" ? "Your delivery" : "Track your order"}</h2></div><button className="modal-close" onClick={() => setSelectedOrder(null)} aria-label="Close tracking">×</button></div>
          <p className="tracking-order-id">Order #{selectedOrder.id.slice(0, 8).toUpperCase()} · ₹{selectedOrder.total}</p>
          <div className="order-timeline">{orderSteps.map(([status, title], index) => <div className={`timeline-step ${index <= activeStatusIndex ? "done" : ""} ${status === selectedOrder.status ? "current" : ""}`} key={status}><span className="timeline-dot">{index < activeStatusIndex ? "✓" : index + 1}</span><div><strong>{title}</strong>{selectedOrder.history.find((entry) => entry.status === status) && <small>{new Date(selectedOrder.history.find((entry) => entry.status === status)!.createdAt).toLocaleTimeString()}</small>}</div></div>)}</div>
          <div className="tracking-map"><iframe title="Live delivery map" src={mapUrl} loading="lazy" /><div className="tracking-location">{trackingLocation ? `Driver location: ${trackingLocation.latitude.toFixed(5)}, ${trackingLocation.longitude.toFixed(5)}` : `Deliver to: ${selectedOrder.address}`}</div></div>
          {session.user?.role === "delivery" && selectedOrder.status !== "delivered" && selectedOrder.status !== "cancelled" && <div className="delivery-controls"><button className="map-locate" onClick={toggleLocationSharing}>{sharingLocation ? "Stop sharing location" : "Share live location"}</button><button className="auth-submit" onClick={() => void updateDeliveryStatus(selectedOrder)}>{selectedOrder.status === "accepted" ? "Mark picked up" : selectedOrder.status === "picked_up" ? "Start delivery" : "Mark delivered"}</button></div>}
          <p className="tracking-address"><strong>Delivery address</strong><br />{selectedOrder.address}</p>
        </section>
      </div>}

      {deliveryOpen && session.user?.role === "delivery" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeliveryOpen(false); }}>
        <section className="side-panel delivery-panel" role="dialog" aria-modal="true" aria-labelledby="delivery-title">
          <div className="panel-title"><div><span className="section-kicker">viggy_mart DELIVERY</span><h2 id="delivery-title">Available deliveries</h2></div><button className="modal-close" onClick={() => setDeliveryOpen(false)} aria-label="Close delivery hub">×</button></div>
          <button className="map-locate reload-deliveries" onClick={() => { setDeliveryOpen(false); window.setTimeout(() => setDeliveryOpen(true), 0); }}>Refresh available orders</button>
          {availableOrders.length === 0 ? <div className="empty-menu"><span>🛵</span><h3>All caught up</h3><p>There are no unassigned deliveries right now.</p></div> : <div className="order-list">{availableOrders.map((order) => <article className="available-order" key={order.id}><span className="order-status-badge">READY TO CLAIM</span><strong>{order.itemCount} items · ₹{order.total}</strong><p>{order.address}</p><button className="auth-submit" onClick={() => void claimOrder(order.id)}>Accept delivery</button></article>)}</div>}
        </section>
      </div>}

      <div className="sr-only" aria-live="polite">{error}</div>
    </div>
  );
}
