import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { LocationMap } from "./components/LocationMap";
import MapView from "./components/MapView";

const APP_TITLE = "RoadRescue";

/**
 * Generates a lightweight unique id for client-only request storage.
 * Not cryptographically secure; sufficient for MVP UI state.
 */
function generateId(prefix = "req") {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36).slice(-4)}`;
}

function formatLatLng(lat, lng) {
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function formatMoney(amount) {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * PUBLIC_INTERFACE
 * Geocode an address via the public OpenStreetMap Nominatim API.
 *
 * Note: Nominatim usage policy discourages heavy traffic. This MVP uses direct client-side fetch.
 * Params:
 * - address: string
 * Returns: { lat: number, lon: number, displayName: string }
 */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    headers: {
      // Nominatim requests a valid User-Agent; browsers restrict custom UA header in some environments.
      // Leaving this header here documents intent; it may be ignored by the browser runtime.
      "User-Agent": "RoadRescue-MVP/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status})`);
  }

  const data = await response.json();

  if (!data || data.length === 0) {
    throw new Error("Address not found");
  }

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}

/**
 * Attempts to parse a "lat,lng" string into numeric coordinates.
 * Accepts formats like:
 *  - "12.34, 56.78"
 *  - "12.34 56.78"
 * Returns null if not parseable.
 */
function parseLatLng(text) {
  if (!text) return null;
  const cleaned = String(text).trim();
  const parts = cleaned.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const la = Number(parts[0]);
  const lo = Number(parts[1]);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;

  return { lat: la, lng: lo };
}

/**
 * PUBLIC_INTERFACE
 * Returns true when the user has a logged-in session in the MVP UI.
 * In this MVP, the session is stored in localStorage and is not backed by an API.
 */
function isAuthenticated() {
  try {
    const raw = localStorage.getItem("rrqa_auth_user");
    return Boolean(raw);
  } catch {
    return false;
  }
}

/**
 * PUBLIC_INTERFACE
 * A small helper for MVP push-notification scaffolding.
 * - Requests browser Notification permission if needed.
 * - Displays a notification (or falls back to an in-app alert list).
 */
async function tryNotify({ title, body }) {
  if (typeof window === "undefined") return { ok: false, reason: "no_window" };

  if (!("Notification" in window)) {
    return { ok: false, reason: "notifications_unsupported" };
  }

  try {
    if (Notification.permission === "granted") {
      // eslint-disable-next-line no-new
      new Notification(title, { body });
      return { ok: true };
    }

    if (Notification.permission === "denied") {
      return { ok: false, reason: "permission_denied" };
    }

    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      // eslint-disable-next-line no-new
      new Notification(title, { body });
      return { ok: true };
    }
    return { ok: false, reason: "permission_not_granted" };
  } catch (e) {
    return { ok: false, reason: "error", error: String(e) };
  }
}

/**
 * PUBLIC_INTERFACE
 * Returns a normalized browser Notification permission state.
 */
function getNotificationPermissionState() {
  if (typeof window === "undefined") return "unavailable";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission || "default";
}

/**
 * Scaffolding helper: store which status notifications we've already emitted for a request.
 * This prevents repeated notifications when users refresh or when the list polling re-renders.
 */
function loadNotifiedStatusMap() {
  try {
    const raw = localStorage.getItem("rrqa_notified_status");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveNotifiedStatusMap(map) {
  localStorage.setItem("rrqa_notified_status", JSON.stringify(map));
}

/**
 * Emits a notification for a status transition if we haven't already emitted one for that request+status.
 * Returns {notified: boolean, result?: tryNotify result}.
 */
async function notifyOnceForStatus({ requestId, nextStatus, title, body }) {
  const key = `${requestId}:${nextStatus}`;
  const map = loadNotifiedStatusMap();

  if (map[key]) return { notified: false, skipped: "already_notified" };

  const res = await tryNotify({ title, body });
  // Mark as notified regardless of whether browser notifications are allowed, so we don't spam.
  // In-app alerts still provide the UX feedback.
  map[key] = true;
  saveNotifiedStatusMap(map);

  return { notified: res.ok, result: res };
}

function loadRequests() {
  try {
    const raw = localStorage.getItem("rrqa_requests");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRequests(requests) {
  localStorage.setItem("rrqa_requests", JSON.stringify(requests));
}

function loadAuthUser() {
  try {
    const raw = localStorage.getItem("rrqa_auth_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuthUser(user) {
  localStorage.setItem("rrqa_auth_user", JSON.stringify(user));
}

function clearAuthUser() {
  localStorage.removeItem("rrqa_auth_user");
}

/** -----------------------------
 * Mechanic Portal (MVP localStorage)
 * ------------------------------*/

function loadMechanicSession() {
  try {
    const raw = localStorage.getItem("rrqa_mech_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveMechanicSession(session) {
  localStorage.setItem("rrqa_mech_session", JSON.stringify(session));
}

function clearMechanicSession() {
  localStorage.removeItem("rrqa_mech_session");
}

function loadMechanics() {
  try {
    const raw = localStorage.getItem("rrqa_mechanics");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMechanics(mechanics) {
  localStorage.setItem("rrqa_mechanics", JSON.stringify(mechanics));
}

/**
 * Ensures we have at least a demo "admin-approved" mechanic
 * so the portal is testable immediately without an admin UI.
 */
function ensureMechanicSeed() {
  const existing = loadMechanics();
  if (existing.length > 0) return;
  const demo = {
    id: "mech_demo",
    email: "mechanic.demo@example.com",
    name: "Demo Mechanic",
    phone: "",
    location: { baseCity: "Chennai", lat: 13.0827, lng: 80.2707 },
    approved: true,
    createdAt: new Date().toISOString(),
    financials: {
      prepaidBalance: 0,
      incomeTotal: 0,
      feesTotal: 0,
      ledger: [],
    },
  };
  saveMechanics([demo]);
}

/**
 * PUBLIC_INTERFACE
 * Returns whether a mechanic is logged in and approved.
 */
function isMechanicApprovedAuthed() {
  const s = loadMechanicSession();
  return Boolean(s?.mechanicId && s?.approved === true);
}

function getMechanicById(mechanicId) {
  return loadMechanics().find((m) => m.id === mechanicId) || null;
}

function upsertMechanic(nextMechanic) {
  const all = loadMechanics();
  const idx = all.findIndex((m) => m.id === nextMechanic.id);
  const now = new Date().toISOString();
  const normalized = { ...nextMechanic, updatedAt: now };
  if (idx === -1) return saveMechanics([normalized, ...all]);
  all[idx] = normalized;
  return saveMechanics(all);
}

function addMechanicLedgerEntry(mechanicId, entry) {
  const mech = getMechanicById(mechanicId);
  if (!mech) return;

  const ledger = Array.isArray(mech.financials?.ledger) ? mech.financials.ledger : [];
  const nextLedger = [{ id: generateId("tx"), createdAt: new Date().toISOString(), ...entry }, ...ledger];

  const prepaidBalance = Number(mech.financials?.prepaidBalance || 0);
  const incomeTotal = Number(mech.financials?.incomeTotal || 0);
  const feesTotal = Number(mech.financials?.feesTotal || 0);

  let nextFinancials = { ...(mech.financials || {}) };

  if (entry.type === "prepaid_add") nextFinancials.prepaidBalance = prepaidBalance + Number(entry.amount || 0);
  if (entry.type === "income") nextFinancials.incomeTotal = incomeTotal + Number(entry.amount || 0);
  if (entry.type === "fee") nextFinancials.feesTotal = feesTotal + Number(entry.amount || 0);

  nextFinancials.ledger = nextLedger;

  upsertMechanic({ ...mech, financials: nextFinancials });
}

function getStatusBadgeClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "OPEN") return "rr-badge-open";
  if (s === "ASSIGNED") return "rr-badge-assigned";
  if (s === "COMPLETED") return "rr-badge-completed";
  return "rr-badge-open";
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authUser, setAuthUser] = useState(() => loadAuthUser());
  const [mechanicSession, setMechanicSession] = useState(() => loadMechanicSession());
  const [alerts, setAlerts] = useState([]);

  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionState());

  const authed = Boolean(authUser);
  const mechAuthedApproved = Boolean(mechanicSession?.mechanicId && mechanicSession?.approved);
  const onMechanicPages = location.pathname.startsWith("/mechanic");

  useEffect(() => {
    ensureMechanicSeed();
  }, []);

  const addAlert = (type, message) => {
    setAlerts((prev) => [{ id: `${Date.now()}_${Math.random()}`, type, message }, ...prev].slice(0, 6));
  };

  const requestNotifPermission = async () => {
    const current = getNotificationPermissionState();
    setNotifPermission(current);

    if (current === "unsupported" || current === "unavailable") {
      addAlert("info", "Browser notifications are not supported in this environment.");
      return;
    }

    if (current === "granted") {
      addAlert("info", "Notifications are already enabled.");
      return;
    }

    if (current === "denied") {
      addAlert("error", "Notifications are blocked. Enable them in your browser settings to receive updates.");
      return;
    }

    const res = await tryNotify({
      title: "RoadRescue",
      body: "Notifications enabled. You’ll receive updates when your request status changes.",
    });

    // tryNotify requests permission when needed; reflect latest state after.
    setNotifPermission(getNotificationPermissionState());

    if (!res.ok) {
      addAlert("info", "Notification permission not granted. Updates will still appear in-app.");
    }
  };

  useEffect(() => {
    // Keep permission state fresh when the tab regains focus (user may change it in browser settings).
    const onFocus = () => setNotifPermission(getNotificationPermissionState());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const onLogout = () => {
    clearAuthUser();
    setAuthUser(null);
    addAlert("info", "Logged out.");
    navigate("/login");
  };

  const onMechanicLogout = () => {
    clearMechanicSession();
    setMechanicSession(null);
    addAlert("info", "Mechanic logged out.");
    navigate("/mechanic/login");
  };

  const navItems = useMemo(() => {
    // Keep existing user-side nav, add a visible "Mechanic Portal" entry for discoverability.
    if (authed) {
      return [
        { to: "/submit-request", label: "Submit Request" },
        { to: "/my-requests", label: "My Requests" },
        { to: "/mechanic", label: "Mechanic Portal" },
      ];
    }
    return [
      { to: "/about", label: "About" },
      { to: "/register", label: "Register" },
      { to: "/mechanic", label: "Mechanic Portal" },
    ];
  }, [authed]);

  const mechanicNavItems = useMemo(() => {
    return [
      { to: "/mechanic/dashboard", label: "Dashboard" },
      { to: "/mechanic/assignments", label: "My Assignments" },
      { to: "/mechanic/profile", label: "Profile" },
    ];
  }, []);

  const notifLabel = useMemo(() => {
    if (notifPermission === "granted") return "Notifications: On";
    if (notifPermission === "denied") return "Notifications: Blocked";
    if (notifPermission === "default") return "Enable notifications";
    if (notifPermission === "unsupported") return "Notifications: Unsupported";
    return "Notifications";
  }, [notifPermission]);

  const mechanicIdentityLabel = useMemo(() => {
    if (!mechanicSession?.mechanicId) return "";
    const mech = getMechanicById(mechanicSession.mechanicId);
    return mech?.email || mechanicSession.mechanicId;
  }, [mechanicSession?.mechanicId]);

  return (
    <div className="rr-app">
      <header className="rr-topbar">
        <div className="rr-topbarInner">
          <div className="rr-brand">
            <div className="rr-brandMark" aria-hidden="true">
              RR
            </div>
            <Link className="rr-brandName" to={authed ? "/submit-request" : "/login"}>
              {APP_TITLE}
            </Link>
          </div>

          <nav className="rr-nav" aria-label="Primary">
            {/* When inside mechanic portal, switch to mechanic-specific nav items for a clear portal feel */}
            {(onMechanicPages ? mechanicNavItems : navItems).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rr-navLink ${location.pathname === item.to ? "isActive" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="rr-topbarRight">
            <button
              className="rr-linkButton"
              type="button"
              onClick={requestNotifPermission}
              title="Enable browser notifications for request status updates"
              disabled={notifPermission === "unsupported" || notifPermission === "unavailable"}
            >
              {notifLabel}
            </button>

            {/* User-side session chip */}
            {!onMechanicPages && authed ? (
              <>
                <div className="rr-userChip" title={authUser?.email || "User"}>
                  <span className="rr-userDot" aria-hidden="true" />
                  <span className="rr-userText">{authUser?.email || "Logged in"}</span>
                </div>
                <button className="rr-linkButton" onClick={onLogout} type="button">
                  Logout
                </button>
              </>
            ) : null}

            {/* Mechanic-side session chip */}
            {onMechanicPages && mechanicSession?.mechanicId ? (
              <>
                <div className="rr-userChip" title={mechanicIdentityLabel || "Mechanic"}>
                  <span className="rr-userDot" aria-hidden="true" />
                  <span className="rr-userText">
                    {mechanicIdentityLabel}
                    {!mechAuthedApproved ? " (pending)" : ""}
                  </span>
                </div>
                <button className="rr-linkButton" onClick={onMechanicLogout} type="button">
                  Logout
                </button>
              </>
            ) : null}

            {/* If not authed on current portal, show the appropriate login link */}
            {!onMechanicPages && !authed ? (
              <Link className="rr-linkButton" to="/login">
                Login
              </Link>
            ) : null}

            {onMechanicPages && !mechanicSession?.mechanicId ? (
              <Link className="rr-linkButton" to="/mechanic/login">
                Mechanic Login
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <main className="rr-main">
        <div className="rr-container">
          {alerts.length > 0 && (
            <section className="rr-alertStack" aria-label="Notifications">
              {alerts.map((a) => (
                <div key={a.id} className={`rr-alert rr-alert-${a.type}`}>
                  {a.message}
                </div>
              ))}
            </section>
          )}

          <Routes>
            <Route path="/" element={<Navigate to={authed ? "/submit-request" : "/login"} replace />} />

            {/* User-side routes */}
            <Route
              path="/login"
              element={
                authed ? (
                  <Navigate to="/submit-request" replace />
                ) : (
                  <LoginPage
                    onLoggedIn={(user, opts) => {
                      setAuthUser(user);
                      addAlert("success", `Welcome${user?.email ? `, ${user.email}` : ""}.`);
                      if (opts?.usedGoogle) {
                        addAlert("info", "Google sign-in is stubbed for MVP UI; integrate Supabase later.");
                      }
                      navigate("/submit-request");
                    }}
                    addAlert={addAlert}
                  />
                )
              }
            />

            <Route
              path="/register"
              element={
                <RegisterPage
                  onRegistered={(user) => {
                    setAuthUser(user);
                    addAlert("success", "Account created and logged in.");
                    navigate("/submit-request");
                  }}
                  addAlert={addAlert}
                />
              }
            />

            <Route path="/about" element={<AboutPage />} />

            <Route
              path="/submit-request"
              element={
                authed ? (
                  <SubmitRequestPage
                    authUser={authUser}
                    addAlert={addAlert}
                    onRequestCreated={async (created) => {
                      addAlert("success", `Request created: ${created.id}`);
                      const res = await tryNotify({
                        title: "RoadRescue",
                        body: `Your request ${created.id} is OPEN.`,
                      });
                      if (!res.ok) {
                        // silent; in-app already confirmed
                      }
                      navigate("/my-requests");
                    }}
                  />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />

            <Route
              path="/my-requests"
              element={authed ? <MyRequestsPage authUser={authUser} addAlert={addAlert} /> : <Navigate to="/login" replace />}
            />

            <Route
              path="/requests/:id"
              element={
                authed ? (
                  <RequestDetailPage
                    authUser={authUser}
                    addAlert={addAlert}
                    onStatusSimulated={async (msg) => {
                      addAlert("info", msg);
                      await tryNotify({ title: "RoadRescue", body: msg });
                    }}
                  />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />

            {/* Mechanic portal routes */}
            <Route path="/mechanic" element={<Navigate to="/mechanic/login" replace />} />

            <Route path="/mechanic/about" element={<MechanicAboutPage />} />

            <Route
              path="/mechanic/login"
              element={
                isMechanicApprovedAuthed() ? (
                  <Navigate to="/mechanic/dashboard" replace />
                ) : (
                  <MechanicLoginPage
                    addAlert={addAlert}
                    onLoggedIn={(session, opts) => {
                      setMechanicSession(session);
                      if (session?.approved) {
                        addAlert("success", `Welcome${session?.email ? `, ${session.email}` : ""}.`);
                        if (opts?.usedGoogle) addAlert("info", "Google sign-in is stubbed for MVP UI; integrate Supabase later.");
                        navigate("/mechanic/dashboard");
                        return;
                      }
                      addAlert(
                        "info",
                        "Registration/login received, but this mechanic account is not approved yet. Please wait for admin approval."
                      );
                      navigate("/mechanic/pending");
                    }}
                  />
                )
              }
            />

            <Route
              path="/mechanic/register"
              element={
                <MechanicRegisterPage
                  addAlert={addAlert}
                  onRegistered={(result) => {
                    if (result?.pending) {
                      addAlert(
                        "info",
                        "Mechanic registered and sent for admin approval. You’ll be able to login once approved."
                      );
                      navigate("/mechanic/pending");
                      return;
                    }
                    addAlert("success", "Mechanic account created and approved.");
                    navigate("/mechanic/login");
                  }}
                />
              }
            />

            <Route
              path="/mechanic/pending"
              element={<MechanicPendingApprovalPage addAlert={addAlert} mechanicSession={mechanicSession} />}
            />

            <Route
              path="/mechanic/dashboard"
              element={
                isMechanicApprovedAuthed() ? (
                  <MechanicDashboardPage mechanicSession={mechanicSession} addAlert={addAlert} />
                ) : (
                  <Navigate to="/mechanic/login" replace />
                )
              }
            />

            <Route
              path="/mechanic/assignments"
              element={
                isMechanicApprovedAuthed() ? (
                  <MechanicAssignmentsPage mechanicSession={mechanicSession} addAlert={addAlert} />
                ) : (
                  <Navigate to="/mechanic/login" replace />
                )
              }
            />

            <Route
              path="/mechanic/profile"
              element={
                isMechanicApprovedAuthed() ? (
                  <MechanicProfilePage mechanicSession={mechanicSession} addAlert={addAlert} />
                ) : (
                  <Navigate to="/mechanic/login" replace />
                )
              }
            />

            <Route
              path="/mechanic/requests/:id"
              element={
                isMechanicApprovedAuthed() ? (
                  <MechanicRequestDetailPage mechanicSession={mechanicSession} addAlert={addAlert} />
                ) : (
                  <Navigate to="/mechanic/login" replace />
                )
              }
            />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </main>

      <footer className="rr-footer">
        <div className="rr-container rr-footerInner">
          <div className="rr-mutedSmall">© {new Date().getFullYear()} RoadRescue – QuickAssist (MVP UI)</div>
          <div className="rr-mutedSmall">No backend connected yet. Data stored locally in your browser.</div>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="rr-field">
      <div className="rr-fieldHeader">
        <label className="rr-label">{label}</label>
        {hint ? <div className="rr-hint">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function TwoCol({ left, right }) {
  return (
    <div className="rr-twoCol">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function LoginPage({ onLoggedIn, addAlert }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!email || !password) {
        addAlert("error", "Please enter email and password.");
        return;
      }
      const user = { id: `user_${email}`, email };
      saveAuthUser(user);
      onLoggedIn(user, { usedGoogle: false });
    } finally {
      setBusy(false);
    }
  };

  const google = () => {
    // MVP stub: no real OAuth yet (Supabase planned).
    const user = { id: `user_google_${Date.now()}`, email: "google.user@example.com", provider: "google" };
    saveAuthUser(user);
    onLoggedIn(user, { usedGoogle: true });
  };

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Login</h1>
        <div className="rr-subtitle">Sign in to submit and track your breakdown requests.</div>
      </div>

      <div className="rr-card rr-formCard">
        <form onSubmit={submit}>
          <Field label="Email">
            <input
              className="rr-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Password">
            <input
              className="rr-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          <div className="rr-actions">
            <button className="rr-btn rr-btnPrimary" type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Login"}
            </button>

            <button className="rr-btn rr-btnSecondary" type="button" onClick={google} disabled={busy}>
              Sign in with Google
            </button>

            <Link className="rr-textLink" to="/register">
              Need an account? Register
            </Link>
          </div>

          <div className="rr-divider" />
          <div className="rr-mutedSmall">
            Are you a mechanic?{" "}
            <Link className="rr-textLink" to="/mechanic/login">
              Go to Mechanic Portal
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}

function RegisterPage({ onRegistered, addAlert }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!email || !password) {
        addAlert("error", "Please enter email and password.");
        return;
      }
      // MVP: just store user in localStorage; no persistence.
      const user = { id: `user_${email}`, email };
      saveAuthUser(user);
      onRegistered(user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Register</h1>
        <div className="rr-subtitle">Create an account to submit and track requests.</div>
      </div>

      <div className="rr-card rr-formCard">
        <form onSubmit={submit}>
          <Field label="Email">
            <input
              className="rr-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Password" hint="MVP demo only — no password strength checks yet.">
            <input
              className="rr-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              autoComplete="new-password"
            />
          </Field>

          <div className="rr-actions">
            <button className="rr-btn rr-btnPrimary" type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </button>
            <Link className="rr-textLink" to="/login">
              Already have an account? Login
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}

function AboutPage() {
  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">About RoadRescue</h1>
        <div className="rr-subtitle">
          QuickAssist helps drivers submit breakdown requests and track service status in a clear, stress-free flow.
        </div>
      </div>

      <div className="rr-card rr-contentCard">
        <h2 className="rr-h2">MVP Notes</h2>
        <ul className="rr-list">
          <li>Data is stored locally in your browser (no backend yet).</li>
          <li>“Use my location” uses the browser GPS permission (if available).</li>
          <li>Status updates and notifications are scaffolded for future API integration.</li>
        </ul>

        <h2 className="rr-h2">Mechanic Portal</h2>
        <ul className="rr-list">
          <li>Mechanics can register and then wait for admin approval before accessing requests.</li>
          <li>Approved mechanics can accept OPEN requests (status becomes ASSIGNED), then complete them.</li>
          <li>Dashboard includes simple filters by make/model/location text and status.</li>
        </ul>
      </div>
    </section>
  );
}

function SubmitRequestPage({ authUser, onRequestCreated, addAlert }) {
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  const [issueDescription, setIssueDescription] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [addressText, setAddressText] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);

  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const locationInputRef = useRef(null);

  const handleFindLocation = async () => {
    const addr = String(addressText || "").trim();
    if (!addr) {
      addAlert("error", "Please enter an address to find.");
      return;
    }

    // If user pasted coordinates, accept them directly.
    const parsed = parseLatLng(addr);
    if (parsed) {
      setLat(parsed.lat);
      setLng(parsed.lng);
      setResolvedAddress("");
      addAlert("success", "Coordinates parsed from input.");
      return;
    }

    setGeocoding(true);
    try {
      const loc = await geocodeAddress(addr);
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
        throw new Error("Geocoder returned invalid coordinates");
      }
      setLat(loc.lat);
      setLng(loc.lon);
      setResolvedAddress(loc.displayName || "");
      addAlert("success", "Location found.");
    } catch (err) {
      addAlert("error", "Could not find location. Please enter a valid address.");
    } finally {
      setGeocoding(false);
      requestAnimationFrame(() => {
        locationInputRef.current?.focus?.();
      });
    }
  };

  const useMyLocation = async () => {
    if (!("geolocation" in navigator)) {
      addAlert("error", "Geolocation is not supported in this browser.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;

        setLat(la);
        setLng(lo);

        // Keep input populated with coordinates (MVP) while also showing a resolved label.
        setAddressText(formatLatLng(la, lo));
        setResolvedAddress("Current GPS location");

        requestAnimationFrame(() => {
          locationInputRef.current?.focus?.();
        });

        setLocating(false);
        addAlert("success", "Location updated.");
      },
      (err) => {
        setLocating(false);
        addAlert("error", err?.message || "Unable to fetch location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const submit = async (e) => {
    e.preventDefault();

    // Required per instructions (year optional):
    // - make, model, license plate, issue description, contact name, contact phone, location.
    if (!vehicleMake || !vehicleModel || !licensePlate) {
      addAlert("error", "Please fill required vehicle details (make, model, license plate).");
      return;
    }
    if (!issueDescription) {
      addAlert("error", "Please describe the issue.");
      return;
    }
    if (!contactName || !contactPhone) {
      addAlert("error", "Please fill contact name and phone number.");
      return;
    }
    if (!addressText || typeof lat !== "number" || typeof lng !== "number") {
      addAlert("error", "Please enter an address and click “Find location” (or use “Use my location”).");
      return;
    }

    const now = new Date().toISOString();
    const created = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      userId: authUser?.id || "unknown",
      status: "OPEN",
      vehicle: {
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear,
        licensePlate,
      },
      issueDescription,
      contact: {
        name: contactName,
        phone: contactPhone,
      },
      location: {
        addressText,
        resolvedAddress,
        lat,
        lng,
      },
      // Scaffolding fields for mechanic assignment
      assignment: {
        mechanicId: null,
        mechanicName: null,
        acceptedAt: null,
        completedAt: null,
      },
      notifications: [],
    };

    const all = loadRequests();
    const next = [created, ...all];
    saveRequests(next);

    onRequestCreated(created);
  };

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Submit a breakdown request</h1>
        <div className="rr-subtitle">Fill in vehicle, contact and breakdown location details to get help faster.</div>
      </div>

      <div className="rr-card rr-formCard">
        <form onSubmit={submit}>
          <div className="rr-sectionTitle">Vehicle details</div>
          <div className="rr-grid2">
            <Field label="Make *">
              <input
                className="rr-input"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                placeholder="e.g. Toyota"
                required
              />
            </Field>
            <Field label="Model *">
              <input
                className="rr-input"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="e.g. Corolla"
                required
              />
            </Field>
            <Field label="Year" hint="Optional">
              <input
                className="rr-input"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                placeholder="e.g. 2018"
                inputMode="numeric"
              />
            </Field>
            <Field label="License Plate *">
              <input
                className="rr-input"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                placeholder="e.g. ABC-1234"
                required
              />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Issue</div>
          <Field label="Issue description *">
            <textarea
              className="rr-textarea"
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="Describe the issue (e.g., flat tire, engine won’t start, battery dead...)"
              rows={4}
              required
            />
          </Field>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Contact</div>
          <div className="rr-grid2">
            <Field label="Contact name *">
              <input
                className="rr-input"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Your name"
                required
              />
            </Field>
            <Field label="Contact number *">
              <input
                className="rr-input"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+1 555 555 5555"
                required
              />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Location</div>
          <TwoCol
            left={
              <>
                <Field label="Breakdown address *" hint="Enter an address and click “Find location” to resolve coordinates.">
                  <div className="rr-row rr-rowTop rr-addressRow">
                    <div className="rr-grow">
                      <input
                        ref={locationInputRef}
                        className="rr-input"
                        value={addressText}
                        onChange={(e) => setAddressText(e.target.value)}
                        placeholder="e.g. 10 Downing St, London"
                        required
                      />
                      {resolvedAddress ? <div className="rr-mutedSmall rr-mt8">Resolved: {resolvedAddress}</div> : null}
                    </div>

                    <button
                      className="rr-btn rr-btnPrimary rr-btnCompact rr-btnFindLocation"
                      type="button"
                      onClick={handleFindLocation}
                      disabled={geocoding}
                      title="Geocode address via OpenStreetMap Nominatim"
                    >
                      {geocoding ? "Finding..." : "Find location"}
                    </button>
                  </div>
                </Field>

                <div className="rr-grid2">
                  <Field label="Latitude *">
                    <input
                      className="rr-input"
                      value={typeof lat === "number" ? String(lat) : ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        const num = next === "" ? null : Number(next);
                        setLat(Number.isFinite(num) ? num : null);
                      }}
                      placeholder="Latitude"
                      inputMode="decimal"
                      required
                    />
                  </Field>

                  <Field label="Longitude *">
                    <input
                      className="rr-input"
                      value={typeof lng === "number" ? String(lng) : ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        const num = next === "" ? null : Number(next);
                        setLng(Number.isFinite(num) ? num : null);
                      }}
                      placeholder="Longitude"
                      inputMode="decimal"
                      required
                    />
                  </Field>
                </div>

                <div className="rr-locationMeta rr-locationMetaCompact">
                  <div className="rr-actions rr-actionsBetween">
                    <button
                      className="rr-btn rr-btnSecondary rr-btnCompact"
                      type="button"
                      onClick={useMyLocation}
                      disabled={locating}
                      title="Use browser GPS to set your location"
                    >
                      {locating ? "Locating..." : "Use my location"}
                    </button>
                    <div className="rr-mutedSmall">
                      Tip: you can also paste coordinates into the address box (e.g. “37.7749, -122.4194”).
                    </div>
                  </div>
                </div>
              </>
            }
            right={<MapView lat={typeof lat === "number" ? lat : null} lng={typeof lng === "number" ? lng : null} />}
          />

          <div className="rr-actions rr-actionsBetween rr-actionsEnd">
            <button className="rr-btn rr-btnPrimary" type="submit">
              Submit request
            </button>

            <Link className="rr-btn rr-btnSecondary" to="/my-requests">
              View requests
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}

function MyRequestsPage({ authUser }) {
  const [requests, setRequests] = useState(() =>
    loadRequests().filter((r) => r.userId === (authUser?.id || "unknown"))
  );

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      setRequests(loadRequests().filter((r) => r.userId === (authUser?.id || "unknown")));
    };

    // Cross-tab updates (fires in other tabs/windows)
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);

    // Same-tab updates: localStorage writes do NOT trigger "storage" in the same tab.
    // For MVP simulation, a lightweight polling keeps the list accurate without additional infra.
    const interval = window.setInterval(refresh, 800);

    // Initial refresh on mount, so returning from detail reflects latest status instantly.
    refresh();

    return () => {
      mounted = false;
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, [authUser?.id]);

  return (
    <section className="rr-page">
      <div className="rr-pageHeader rr-pageHeaderRow">
        <div>
          <h1 className="rr-title">My requests</h1>
          <div className="rr-subtitle">View requests you’ve submitted. Tap a request ID to see full details.</div>
        </div>
        <Link className="rr-btn rr-btnPrimary" to="/submit-request">
          New request
        </Link>
      </div>

      {/* Per instructions: NO map visible on list view. */}

      <div className="rr-card rr-tableCard">
        <div className="rr-tableWrap" role="table" aria-label="Requests table">
          <div className="rr-tableHeader" role="row">
            <div role="columnheader">Request ID</div>
            <div role="columnheader">Vehicle</div>
            <div role="columnheader">Status</div>
            <div role="columnheader">Created</div>
            <div role="columnheader" className="rr-right">
              Actions
            </div>
          </div>

          {requests.length === 0 ? (
            <div className="rr-empty">
              <div className="rr-emptyTitle">No requests yet</div>
              <div className="rr-mutedSmall">Create a breakdown request to see it listed here.</div>
            </div>
          ) : (
            requests.map((r) => (
              <div className="rr-tableRow" role="row" key={r.id}>
                <div role="cell" className="rr-mono">
                  <Link className="rr-textLink" to={`/requests/${r.id}`}>
                    {r.id}
                  </Link>
                </div>

                <div role="cell">
                  <div>
                    {r.vehicle?.make} {r.vehicle?.model} {r.vehicle?.year ? `(${r.vehicle.year})` : ""}
                  </div>
                  <div className="rr-mutedSmall">{r.vehicle?.licensePlate ? `Plate: ${r.vehicle.licensePlate}` : ""}</div>
                </div>

                <div role="cell">
                  <span className={`rr-badge ${getStatusBadgeClass(r.status)}`}>{r.status}</span>
                </div>

                <div role="cell" className="rr-mutedSmall">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : "-"}
                </div>

                <div role="cell" className="rr-right">
                  <Link className="rr-btn rr-btnSmall rr-btnSecondary" to={`/requests/${r.id}`}>
                    View
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function RequestDetailPage({ authUser, addAlert, onStatusSimulated }) {
  const { id } = useParams();

  const [request, setRequest] = useState(() => {
    const r = loadRequests().find((x) => x.id === id);
    return r || null;
  });

  useEffect(() => {
    const r = loadRequests().find((x) => x.id === id);
    setRequest(r || null);
  }, [id]);

  const canView = request && request.userId === (authUser?.id || "unknown");

  const updateRequestStatus = async (nextStatus) => {
    const all = loadRequests();
    const idx = all.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const prevStatus = all[idx]?.status;

    const now = new Date().toISOString();
    const updated = {
      ...all[idx],
      status: nextStatus,
      updatedAt: now,
    };

    // Simple assignment timestamp scaffolding.
    if (nextStatus === "ASSIGNED" && !updated.assignment?.acceptedAt) {
      updated.assignment = {
        ...(updated.assignment || {}),
        acceptedAt: now,
        mechanicId: "mech_demo",
        mechanicName: "Demo Mechanic",
      };
    }
    if (nextStatus === "COMPLETED" && !updated.assignment?.completedAt) {
      updated.assignment = { ...(updated.assignment || {}), completedAt: now };
    }

    all[idx] = updated;
    saveRequests(all);
    setRequest(updated);

    // Status transition hook (MVP): fire a browser notification when the status changes to ASSIGNED/COMPLETED.
    // Deduped by requestId+status to avoid repeated popups across refreshes.
    if (prevStatus !== nextStatus) {
      if (nextStatus === "ASSIGNED") {
        await notifyOnceForStatus({
          requestId: id,
          nextStatus,
          title: "RoadRescue",
          body: `A mechanic accepted your request ${id}.`,
        });
      }
      if (nextStatus === "COMPLETED") {
        await notifyOnceForStatus({
          requestId: id,
          nextStatus,
          title: "RoadRescue",
          body: `Your service for request ${id} has been completed.`,
        });
      }
    }
  };

  const simulateMechanicAccept = async () => {
    await updateRequestStatus("ASSIGNED");
    addAlert("success", "Simulated: mechanic accepted request (ASSIGNED).");
    await onStatusSimulated?.(`A mechanic accepted your request ${id}.`);
  };

  const simulateComplete = async () => {
    await updateRequestStatus("COMPLETED");
    addAlert("success", "Simulated: service completed (COMPLETED).");
    await onStatusSimulated?.(`Your service for request ${id} has been completed.`);
  };

  if (!request) {
    return (
      <section className="rr-page">
        <div className="rr-pageHeader">
          <h1 className="rr-title">Request not found</h1>
          <div className="rr-subtitle">The request ID you opened does not exist in local storage.</div>
        </div>
        <Link className="rr-textLink" to="/my-requests">
          Back to My Requests
        </Link>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="rr-page">
        <div className="rr-pageHeader">
          <h1 className="rr-title">Access denied</h1>
          <div className="rr-subtitle">You can only view requests created by your account.</div>
        </div>
        <Link className="rr-textLink" to="/my-requests">
          Back to My Requests
        </Link>
      </section>
    );
  }

  const storedLat = request.location?.lat;
  const storedLng = request.location?.lng;

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Request {request.id}</h1>
        <div className="rr-subtitle">Status is updated as the mechanic accepts and completes the job (MVP simulated).</div>
      </div>

      <div className="rr-card rr-contentCard">
        <div className="rr-kvGrid">
          <div className="rr-kv">
            <div className="rr-k">Status</div>
            <div className="rr-v">
              <span className={`rr-badge ${getStatusBadgeClass(request.status)}`}>{request.status}</span>
            </div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Created</div>
            <div className="rr-v">{new Date(request.createdAt).toLocaleString()}</div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Updated</div>
            <div className="rr-v">{request.updatedAt ? new Date(request.updatedAt).toLocaleString() : "-"}</div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Vehicle</div>
            <div className="rr-v">
              {request.vehicle?.make} {request.vehicle?.model} {request.vehicle?.year ? `(${request.vehicle.year})` : ""}{" "}
              {request.vehicle?.licensePlate ? `• ${request.vehicle.licensePlate}` : ""}
            </div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Contact</div>
            <div className="rr-v">
              {request.contact?.name} {request.contact?.phone ? `• ${request.contact.phone}` : ""}
            </div>
          </div>
        </div>

        <div className="rr-divider" />

        <div className="rr-kv">
          <div className="rr-k">Issue description</div>
          <div className="rr-v rr-pre">{request.issueDescription}</div>
        </div>

        <div className="rr-divider" />

        <div className="rr-kv">
          <div className="rr-k">Breakdown location</div>
          <div className="rr-v">
            {request.location?.resolvedAddress || request.location?.addressText || "-"}{" "}
            {typeof storedLat === "number" && typeof storedLng === "number" ? `(${formatLatLng(storedLat, storedLng)})` : ""}
          </div>
        </div>

        <div className="rr-mutedSmall rr-mt8">Map below shows the breakdown location submitted with this request.</div>
        <div className="rr-mt12">
          <LocationMap lat={storedLat} lon={storedLng} />
        </div>

        <div className="rr-divider" />

        <div className="rr-actions rr-actionsBetween">
          <Link className="rr-btn rr-btnSecondary" to="/my-requests">
            Back
          </Link>

          <div className="rr-actions">
            <button
              type="button"
              className="rr-btn rr-btnSecondary"
              onClick={simulateMechanicAccept}
              disabled={request.status !== "OPEN"}
              title="MVP only: simulates mechanic portal accepting the job"
            >
              Simulate mechanic accept
            </button>

            <button
              type="button"
              className="rr-btn rr-btnPrimary"
              onClick={simulateComplete}
              disabled={request.status !== "ASSIGNED"}
              title="MVP only: simulates mechanic completing the job"
            >
              Mark completed
            </button>
          </div>
        </div>

        <div className="rr-mutedSmall rr-mt12">
          Status flow (scaffold): OPEN → ASSIGNED → COMPLETED. In the full product, mechanic actions will update this
          automatically via API + push notifications.
        </div>
      </div>
    </section>
  );
}

/** -----------------------------
 * Mechanic Portal Pages
 * ------------------------------*/

function MechanicAboutPage() {
  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">About Mechanic Portal</h1>
        <div className="rr-subtitle">
          A dedicated workspace for approved mechanics to accept breakdown jobs, manage assignments, and track earnings.
        </div>
      </div>

      <div className="rr-card rr-contentCard">
        <h2 className="rr-h2">How it works (MVP)</h2>
        <ul className="rr-list">
          <li>Register as a mechanic → your profile becomes “Pending approval”.</li>
          <li>After admin approves your account, you can access the Dashboard and accept jobs.</li>
          <li>Accepting a job updates the request to ASSIGNED and attaches your mechanic ID.</li>
          <li>Completing updates it to COMPLETED and moves it into your history.</li>
        </ul>

        <h2 className="rr-h2">Notes</h2>
        <ul className="rr-list">
          <li>No backend yet — admin approval is mocked in localStorage.</li>
          <li>Dashboard filters are client-side and based on request fields.</li>
          <li>Map uses the existing MapView component to show breakdown location.</li>
        </ul>

        <div className="rr-divider" />
        <div className="rr-actions">
          <Link className="rr-btn rr-btnPrimary" to="/mechanic/login">
            Mechanic Login
          </Link>
          <Link className="rr-btn rr-btnSecondary" to="/mechanic/register">
            Register as mechanic
          </Link>
        </div>
      </div>
    </section>
  );
}

function MechanicLoginPage({ addAlert, onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);

  const attemptLogin = (emailInput, opts) => {
    const mechanics = loadMechanics();
    const mech = mechanics.find((m) => String(m.email || "").toLowerCase() === String(emailInput || "").toLowerCase());

    if (!mech) {
      addAlert("error", "No mechanic account found for this email. Please register first.");
      return;
    }

    if (!mech.approved) {
      // Store a session but do NOT grant portal access.
      const session = { mechanicId: mech.id, email: mech.email, approved: false };
      saveMechanicSession(session);
      onLoggedIn(session, opts);
      return;
    }

    const session = { mechanicId: mech.id, email: mech.email, approved: true };
    saveMechanicSession(session);
    onLoggedIn(session, opts);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!email || !password) {
        addAlert("error", "Please enter email and password.");
        return;
      }
      attemptLogin(email, { usedGoogle: false });
    } finally {
      setBusy(false);
    }
  };

  const google = () => {
    // MVP stub: no real OAuth yet.
    const googleEmail = "mechanic.google@example.com";
    attemptLogin(googleEmail, { usedGoogle: true });
  };

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Mechanic Login</h1>
        <div className="rr-subtitle">Only admin-approved mechanics can access the dashboard and accept requests.</div>
      </div>

      <div className="rr-card rr-formCard">
        <form onSubmit={submit}>
          <Field label="Email">
            <input
              className="rr-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mechanic@example.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Password" hint="MVP demo only — not validated.">
            <input
              className="rr-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          <div className="rr-actions">
            <button className="rr-btn rr-btnPrimary" type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Login"}
            </button>

            <button className="rr-btn rr-btnSecondary" type="button" onClick={google} disabled={busy}>
              Sign in with Google
            </button>

            <Link className="rr-textLink" to="/mechanic/register">
              New mechanic? Register
            </Link>
          </div>

          <div className="rr-divider" />
          <div className="rr-actions">
            <Link className="rr-textLink" to="/mechanic/about">
              About Mechanic Portal
            </Link>
            <Link className="rr-textLink" to="/login">
              Back to User Login
            </Link>
          </div>

          <div className="rr-mutedSmall rr-mt12">
            Demo approved mechanic: <span className="rr-mono">mechanic.demo@example.com</span>
          </div>
        </form>
      </div>
    </section>
  );
}

function MechanicRegisterPage({ addAlert, onRegistered }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [baseCity, setBaseCity] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!email || !password) {
        addAlert("error", "Please enter email and password.");
        return;
      }
      if (!name) {
        addAlert("error", "Please enter your name.");
        return;
      }

      const existing = loadMechanics().find((m) => String(m.email || "").toLowerCase() === email.toLowerCase());
      if (existing) {
        addAlert("error", "A mechanic account already exists for this email. Please login.");
        return;
      }

      const parsedLat = lat === "" ? null : Number(lat);
      const parsedLng = lng === "" ? null : Number(lng);

      const newMechanic = {
        id: generateId("mech"),
        email,
        name,
        phone,
        approved: false, // admin gating: default is pending
        createdAt: new Date().toISOString(),
        location: {
          baseCity: baseCity || "",
          lat: Number.isFinite(parsedLat) ? parsedLat : null,
          lng: Number.isFinite(parsedLng) ? parsedLng : null,
        },
        financials: {
          prepaidBalance: 0,
          incomeTotal: 0,
          feesTotal: 0,
          ledger: [],
        },
      };

      saveMechanics([newMechanic, ...loadMechanics()]);
      onRegistered({ pending: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Mechanic Register</h1>
        <div className="rr-subtitle">Register to be reviewed by admin. You can login only after approval.</div>
      </div>

      <div className="rr-card rr-formCard">
        <form onSubmit={submit}>
          <div className="rr-sectionTitle">Account</div>
          <div className="rr-grid2">
            <Field label="Email *">
              <input
                className="rr-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="mechanic@example.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field label="Password *" hint="MVP demo only — stored nowhere.">
              <input
                className="rr-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
                required
              />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Profile</div>
          <div className="rr-grid2">
            <Field label="Full name *">
              <input
                className="rr-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </Field>

            <Field label="Phone" hint="Optional">
              <input className="rr-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1..." />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Location (for filtering)</div>
          <div className="rr-grid2">
            <Field label="Base city" hint="Optional">
              <input
                className="rr-input"
                value={baseCity}
                onChange={(e) => setBaseCity(e.target.value)}
                placeholder="e.g. Chennai"
              />
            </Field>

            <Field label="Coordinates" hint="Optional (lat/lng).">
              <div className="rr-row">
                <input
                  className="rr-input rr-grow"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="lat"
                  inputMode="decimal"
                />
                <input
                  className="rr-input rr-grow"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="lng"
                  inputMode="decimal"
                />
              </div>
            </Field>
          </div>

          <div className="rr-actions rr-actionsBetween rr-actionsEnd">
            <button className="rr-btn rr-btnPrimary" type="submit" disabled={busy}>
              {busy ? "Submitting..." : "Register (send for approval)"}
            </button>

            <Link className="rr-btn rr-btnSecondary" to="/mechanic/login">
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}

function MechanicPendingApprovalPage({ mechanicSession }) {
  const mechanics = useMemo(() => loadMechanics(), []);
  const myMechanic = useMemo(() => {
    if (!mechanicSession?.mechanicId) return null;
    return mechanics.find((m) => m.id === mechanicSession.mechanicId) || null;
  }, [mechanicSession?.mechanicId, mechanics]);

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Pending admin approval</h1>
        <div className="rr-subtitle">
          Your mechanic account must be approved by admin before you can access requests.
        </div>
      </div>

      <div className="rr-card rr-contentCard">
        <div className="rr-kvGrid">
          <div className="rr-kv">
            <div className="rr-k">Status</div>
            <div className="rr-v">
              <span className="rr-badge rr-badge-open">PENDING</span>
            </div>
          </div>
          <div className="rr-kv">
            <div className="rr-k">Account</div>
            <div className="rr-v">{myMechanic?.email || "Not logged in (register first)"}</div>
          </div>
        </div>

        <div className="rr-divider" />

        <div className="rr-mutedSmall">
          For this MVP, admin approval is mocked. Once approved, you will be able to log in and access the mechanic
          dashboard.
        </div>

        <div className="rr-actions rr-actionsEnd">
          <Link className="rr-btn rr-btnPrimary" to="/mechanic/login">
            Back to mechanic login
          </Link>
          <Link className="rr-btn rr-btnSecondary" to="/mechanic/about">
            About
          </Link>
        </div>
      </div>
    </section>
  );
}

function MechanicDashboardPage({ mechanicSession, addAlert }) {
  const [filters, setFilters] = useState({
    status: "OPEN",
    make: "",
    model: "",
    location: "",
  });

  const [requests, setRequests] = useState(() => loadRequests());

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      setRequests(loadRequests());
    };

    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(refresh, 800);
    refresh();

    return () => {
      mounted = false;
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  const mechanicId = mechanicSession?.mechanicId;
  const mech = useMemo(() => (mechanicId ? getMechanicById(mechanicId) : null), [mechanicId]);

  const filtered = useMemo(() => {
    const makeF = String(filters.make || "").trim().toLowerCase();
    const modelF = String(filters.model || "").trim().toLowerCase();
    const locF = String(filters.location || "").trim().toLowerCase();
    const statusF = String(filters.status || "").toUpperCase();

    return requests
      .filter((r) => {
        if (statusF && String(r.status || "").toUpperCase() !== statusF) return false;
        if (makeF && !String(r.vehicle?.make || "").toLowerCase().includes(makeF)) return false;
        if (modelF && !String(r.vehicle?.model || "").toLowerCase().includes(modelF)) return false;

        if (locF) {
          const addr = String(r.location?.resolvedAddress || r.location?.addressText || "").toLowerCase();
          if (addr.includes(locF)) return true;
          const baseCity = String(mech?.location?.baseCity || "").toLowerCase();
          // If mechanic typed their baseCity as the filter, accept it.
          if (baseCity && baseCity.includes(locF)) return true;
          return false;
        }

        return true;
      })
      .slice(0, 50);
  }, [filters.location, filters.make, filters.model, filters.status, mech?.location?.baseCity, requests]);

  const acceptRequest = async (requestId) => {
    if (!mechanicId) return;

    const all = loadRequests();
    const idx = all.findIndex((x) => x.id === requestId);
    if (idx === -1) return;

    const r = all[idx];
    if (String(r.status).toUpperCase() !== "OPEN") {
      addAlert("error", "This request is not OPEN anymore.");
      return;
    }

    const now = new Date().toISOString();
    const updated = {
      ...r,
      status: "ASSIGNED",
      updatedAt: now,
      assignment: {
        ...(r.assignment || {}),
        mechanicId,
        mechanicName: mech?.name || mech?.email || "Mechanic",
        acceptedAt: now,
      },
    };

    all[idx] = updated;
    saveRequests(all);

    addAlert("success", `Accepted ${requestId}. Status changed to ASSIGNED.`);
    await notifyOnceForStatus({
      requestId,
      nextStatus: "ASSIGNED",
      title: "RoadRescue",
      body: `A mechanic accepted your request ${requestId}.`,
    });
  };

  const statusOptions = [
    { value: "OPEN", label: "OPEN" },
    { value: "ASSIGNED", label: "ASSIGNED" },
    { value: "COMPLETED", label: "COMPLETED" },
  ];

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <div className="rr-pageHeaderRow">
          <div>
            <h1 className="rr-title">Mechanic Dashboard</h1>
            <div className="rr-subtitle">Browse requests and accept jobs. Filters help you focus on relevant work.</div>
          </div>
          <Link className="rr-btn rr-btnSecondary" to="/mechanic/about">
            About
          </Link>
        </div>
      </div>

      <div className="rr-card rr-formCard">
        <div className="rr-sectionTitle">Filters</div>
        <div className="rr-grid2">
          <Field label="Status">
            <select
              className="rr-input"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Make" hint="Filter by vehicle make">
            <input
              className="rr-input"
              value={filters.make}
              onChange={(e) => setFilters((prev) => ({ ...prev, make: e.target.value }))}
              placeholder="e.g. Toyota"
            />
          </Field>

          <Field label="Model" hint="Filter by vehicle model">
            <input
              className="rr-input"
              value={filters.model}
              onChange={(e) => setFilters((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="e.g. Corolla"
            />
          </Field>

          <Field label="Location" hint="Search address/resolved location text">
            <input
              className="rr-input"
              value={filters.location}
              onChange={(e) => setFilters((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="e.g. London / Chennai / Main St"
            />
          </Field>
        </div>
      </div>

      <div className="rr-card rr-tableCard">
        <div className="rr-tableWrap" role="table" aria-label="Mechanic requests table">
          <div className="rr-tableHeader" role="row">
            <div role="columnheader">Request ID</div>
            <div role="columnheader">Vehicle</div>
            <div role="columnheader">Status</div>
            <div role="columnheader">Location</div>
            <div role="columnheader" className="rr-right">
              Actions
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rr-empty">
              <div className="rr-emptyTitle">No requests match</div>
              <div className="rr-mutedSmall">Adjust filters to see more results.</div>
            </div>
          ) : (
            filtered.map((r) => {
              const status = String(r.status || "").toUpperCase();
              const canAccept = status === "OPEN";
              const assignedToMe = status === "ASSIGNED" && r.assignment?.mechanicId === mechanicId;
              const locationLabel = r.location?.resolvedAddress || r.location?.addressText || "-";

              return (
                <div className="rr-tableRow" role="row" key={r.id}>
                  <div role="cell" className="rr-mono">
                    <Link className="rr-textLink" to={`/mechanic/requests/${r.id}`}>
                      {r.id}
                    </Link>
                  </div>

                  <div role="cell">
                    <div>
                      {r.vehicle?.make} {r.vehicle?.model} {r.vehicle?.year ? `(${r.vehicle.year})` : ""}
                    </div>
                    <div className="rr-mutedSmall">{r.vehicle?.licensePlate ? `Plate: ${r.vehicle.licensePlate}` : ""}</div>
                  </div>

                  <div role="cell">
                    <span className={`rr-badge ${getStatusBadgeClass(status)}`}>{status}</span>
                    {assignedToMe ? <div className="rr-mutedSmall rr-mt8">Assigned to you</div> : null}
                  </div>

                  <div role="cell">
                    <div className="rr-mutedSmall">{locationLabel}</div>
                  </div>

                  <div role="cell" className="rr-right">
                    <div className="rr-actions rr-actionsEnd">
                      <Link className="rr-btn rr-btnSmall rr-btnSecondary" to={`/mechanic/requests/${r.id}`}>
                        View
                      </Link>
                      <button
                        type="button"
                        className="rr-btn rr-btnSmall rr-btnPrimary"
                        onClick={() => acceptRequest(r.id)}
                        disabled={!canAccept}
                        title={canAccept ? "Accept this request" : "Only OPEN requests can be accepted"}
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function MechanicAssignmentsPage({ mechanicSession }) {
  const mechanicId = mechanicSession?.mechanicId;
  const [requests, setRequests] = useState(() => loadRequests());

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      setRequests(loadRequests());
    };

    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(refresh, 800);
    refresh();

    return () => {
      mounted = false;
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  const my = useMemo(() => {
    return requests
      .filter((r) => r.assignment?.mechanicId === mechanicId)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  }, [mechanicId, requests]);

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">My Assignments</h1>
        <div className="rr-subtitle">Your accepted jobs, including completed history.</div>
      </div>

      <div className="rr-card rr-tableCard">
        <div className="rr-tableWrap" role="table" aria-label="Assignments table">
          <div className="rr-tableHeader" role="row">
            <div role="columnheader">Request ID</div>
            <div role="columnheader">Vehicle</div>
            <div role="columnheader">Status</div>
            <div role="columnheader">Updated</div>
            <div role="columnheader" className="rr-right">
              Actions
            </div>
          </div>

          {my.length === 0 ? (
            <div className="rr-empty">
              <div className="rr-emptyTitle">No assignments yet</div>
              <div className="rr-mutedSmall">Accept a request from the Dashboard to see it here.</div>
            </div>
          ) : (
            my.map((r) => (
              <div className="rr-tableRow" role="row" key={r.id}>
                <div role="cell" className="rr-mono">
                  <Link className="rr-textLink" to={`/mechanic/requests/${r.id}`}>
                    {r.id}
                  </Link>
                </div>

                <div role="cell">
                  <div>
                    {r.vehicle?.make} {r.vehicle?.model} {r.vehicle?.year ? `(${r.vehicle.year})` : ""}
                  </div>
                  <div className="rr-mutedSmall">{r.vehicle?.licensePlate ? `Plate: ${r.vehicle.licensePlate}` : ""}</div>
                </div>

                <div role="cell">
                  <span className={`rr-badge ${getStatusBadgeClass(r.status)}`}>{r.status}</span>
                </div>

                <div role="cell" className="rr-mutedSmall">
                  {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-"}
                </div>

                <div role="cell" className="rr-right">
                  <Link className="rr-btn rr-btnSmall rr-btnSecondary" to={`/mechanic/requests/${r.id}`}>
                    View
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function MechanicRequestDetailPage({ mechanicSession, addAlert }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const mechanicId = mechanicSession?.mechanicId;
  const mech = useMemo(() => (mechanicId ? getMechanicById(mechanicId) : null), [mechanicId]);

  const [request, setRequest] = useState(() => loadRequests().find((x) => x.id === id) || null);

  useEffect(() => {
    const r = loadRequests().find((x) => x.id === id);
    setRequest(r || null);
  }, [id]);

  if (!request) {
    return (
      <section className="rr-page">
        <div className="rr-pageHeader">
          <h1 className="rr-title">Request not found</h1>
          <div className="rr-subtitle">The request ID you opened does not exist in local storage.</div>
        </div>
        <Link className="rr-textLink" to="/mechanic/dashboard">
          Back to dashboard
        </Link>
      </section>
    );
  }

  const status = String(request.status || "").toUpperCase();
  const assignedToMe = request.assignment?.mechanicId === mechanicId;
  const canAccept = status === "OPEN";
  const canComplete = status === "ASSIGNED" && assignedToMe;

  const accept = async () => {
    if (!mechanicId) return;
    if (!canAccept) {
      addAlert("error", "Only OPEN requests can be accepted.");
      return;
    }

    const all = loadRequests();
    const idx = all.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const now = new Date().toISOString();
    const updated = {
      ...all[idx],
      status: "ASSIGNED",
      updatedAt: now,
      assignment: {
        ...(all[idx].assignment || {}),
        mechanicId,
        mechanicName: mech?.name || mech?.email || "Mechanic",
        acceptedAt: now,
      },
    };

    all[idx] = updated;
    saveRequests(all);
    setRequest(updated);

    addAlert("success", "Request accepted. Status changed to ASSIGNED.");

    await notifyOnceForStatus({
      requestId: id,
      nextStatus: "ASSIGNED",
      title: "RoadRescue",
      body: `A mechanic accepted your request ${id}.`,
    });
  };

  const complete = async () => {
    if (!canComplete) {
      addAlert("error", "You can only complete requests assigned to you.");
      return;
    }

    const all = loadRequests();
    const idx = all.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const now = new Date().toISOString();
    const updated = {
      ...all[idx],
      status: "COMPLETED",
      updatedAt: now,
      assignment: {
        ...(all[idx].assignment || {}),
        completedAt: now,
      },
    };

    all[idx] = updated;
    saveRequests(all);
    setRequest(updated);

    addAlert("success", "Job marked COMPLETED.");

    await notifyOnceForStatus({
      requestId: id,
      nextStatus: "COMPLETED",
      title: "RoadRescue",
      body: `Your service for request ${id} has been completed.`,
    });

    // Optional: keep mechanic on the detail page, but offer quick back.
  };

  const storedLat = request.location?.lat;
  const storedLng = request.location?.lng;

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Request {request.id}</h1>
        <div className="rr-subtitle">Review issue details and location. Accept or complete based on assignment.</div>
      </div>

      <div className="rr-card rr-contentCard">
        <div className="rr-kvGrid">
          <div className="rr-kv">
            <div className="rr-k">Status</div>
            <div className="rr-v">
              <span className={`rr-badge ${getStatusBadgeClass(status)}`}>{status}</span>
            </div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Assigned</div>
            <div className="rr-v">
              {request.assignment?.mechanicName
                ? `${request.assignment.mechanicName}${assignedToMe ? " (you)" : ""}`
                : "Not assigned"}
            </div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Created</div>
            <div className="rr-v">{request.createdAt ? new Date(request.createdAt).toLocaleString() : "-"}</div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Vehicle</div>
            <div className="rr-v">
              {request.vehicle?.make} {request.vehicle?.model} {request.vehicle?.year ? `(${request.vehicle.year})` : ""}{" "}
              {request.vehicle?.licensePlate ? `• ${request.vehicle.licensePlate}` : ""}
            </div>
          </div>

          <div className="rr-kv">
            <div className="rr-k">Contact</div>
            <div className="rr-v">
              {request.contact?.name} {request.contact?.phone ? `• ${request.contact.phone}` : ""}
            </div>
          </div>
        </div>

        <div className="rr-divider" />

        <div className="rr-kv">
          <div className="rr-k">Issue description</div>
          <div className="rr-v rr-pre">{request.issueDescription}</div>
        </div>

        <div className="rr-divider" />

        <div className="rr-kv">
          <div className="rr-k">Breakdown location</div>
          <div className="rr-v">
            {request.location?.resolvedAddress || request.location?.addressText || "-"}{" "}
            {typeof storedLat === "number" && typeof storedLng === "number" ? `(${formatLatLng(storedLat, storedLng)})` : ""}
          </div>
        </div>

        <div className="rr-mutedSmall rr-mt8">Map below shows the breakdown location for this request.</div>
        <div className="rr-mt12">
          {/* Mechanic portal specifically requested MapView integration */}
          <MapView lat={typeof storedLat === "number" ? storedLat : null} lng={typeof storedLng === "number" ? storedLng : null} />
        </div>

        <div className="rr-divider" />

        <div className="rr-actions rr-actionsBetween">
          <button className="rr-btn rr-btnSecondary" type="button" onClick={() => navigate(-1)}>
            Back
          </button>

          <div className="rr-actions">
            <button className="rr-btn rr-btnSecondary" type="button" onClick={accept} disabled={!canAccept}>
              Accept
            </button>
            <button className="rr-btn rr-btnPrimary" type="button" onClick={complete} disabled={!canComplete}>
              Mark completed
            </button>
          </div>
        </div>

        {!assignedToMe && status === "ASSIGNED" ? (
          <div className="rr-mutedSmall rr-mt12">
            This request is already assigned to another mechanic. You can still view details, but cannot complete it.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MechanicProfilePage({ mechanicSession, addAlert }) {
  const mechanicId = mechanicSession?.mechanicId;
  const [mech, setMech] = useState(() => (mechanicId ? getMechanicById(mechanicId) : null));

  const [name, setName] = useState(mech?.name || "");
  const [phone, setPhone] = useState(mech?.phone || "");
  const [baseCity, setBaseCity] = useState(mech?.location?.baseCity || "");

  const [prepaidAdd, setPrepaidAdd] = useState("");
  const [incomeAdd, setIncomeAdd] = useState("");
  const [feeAdd, setFeeAdd] = useState("");

  const [ledgerFilter, setLedgerFilter] = useState("all"); // all | prepaid_add | income | fee

  useEffect(() => {
    const latest = mechanicId ? getMechanicById(mechanicId) : null;
    setMech(latest);
    setName(latest?.name || "");
    setPhone(latest?.phone || "");
    setBaseCity(latest?.location?.baseCity || "");
  }, [mechanicId]);

  const saveProfile = () => {
    if (!mech) return;
    upsertMechanic({
      ...mech,
      name: String(name || "").trim(),
      phone: String(phone || "").trim(),
      location: { ...(mech.location || {}), baseCity: String(baseCity || "").trim() },
    });
    setMech(getMechanicById(mechanicId));
    addAlert("success", "Profile updated.");
  };

  const addMoney = (type) => {
    if (!mechanicId) return;

    const raw =
      type === "prepaid_add" ? prepaidAdd : type === "income" ? incomeAdd : type === "fee" ? feeAdd : "";
    const amt = Number(raw);

    if (!Number.isFinite(amt) || amt <= 0) {
      addAlert("error", "Enter a valid amount greater than 0.");
      return;
    }

    addMechanicLedgerEntry(mechanicId, { type, amount: amt, note: "" });

    if (type === "prepaid_add") setPrepaidAdd("");
    if (type === "income") setIncomeAdd("");
    if (type === "fee") setFeeAdd("");

    setMech(getMechanicById(mechanicId));
    addAlert("success", "Entry added.");
  };

  const financials = mech?.financials || { prepaidBalance: 0, incomeTotal: 0, feesTotal: 0, ledger: [] };
  const ledger = Array.isArray(financials.ledger) ? financials.ledger : [];

  const filteredLedger = useMemo(() => {
    if (ledgerFilter === "all") return ledger;
    return ledger.filter((x) => x.type === ledgerFilter);
  }, [ledger, ledgerFilter]);

  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Mechanic Profile</h1>
        <div className="rr-subtitle">Manage your personal details and track prepaid, income, and fees.</div>
      </div>

      <div className="rr-card rr-formCard">
        <div className="rr-sectionTitle">Personal details</div>
        <div className="rr-grid2">
          <Field label="Full name">
            <input className="rr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
          <Field label="Phone">
            <input className="rr-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1..." />
          </Field>
          <Field label="Base city" hint="Used for your own reference and filtering">
            <input
              className="rr-input"
              value={baseCity}
              onChange={(e) => setBaseCity(e.target.value)}
              placeholder="e.g. Chennai"
            />
          </Field>
          <Field label="Email">
            <input className="rr-input" value={mech?.email || ""} readOnly />
          </Field>
        </div>

        <div className="rr-actions rr-actionsEnd">
          <button className="rr-btn rr-btnPrimary" type="button" onClick={saveProfile}>
            Save profile
          </button>
        </div>

        <div className="rr-divider" />

        <div className="rr-sectionTitle">Finance overview</div>
        <div className="rr-kvGrid">
          <div className="rr-kv">
            <div className="rr-k">Prepaid balance</div>
            <div className="rr-v">{formatMoney(financials.prepaidBalance)}</div>
          </div>
          <div className="rr-kv">
            <div className="rr-k">Income total</div>
            <div className="rr-v">{formatMoney(financials.incomeTotal)}</div>
          </div>
          <div className="rr-kv">
            <div className="rr-k">Fees total</div>
            <div className="rr-v">{formatMoney(financials.feesTotal)}</div>
          </div>
        </div>

        <div className="rr-divider" />

        <div className="rr-sectionTitle">Add entries</div>
        <div className="rr-grid2">
          <Field label="Add prepaid" hint="Adds to prepaid balance">
            <div className="rr-row">
              <input
                className="rr-input rr-grow"
                value={prepaidAdd}
                onChange={(e) => setPrepaidAdd(e.target.value)}
                placeholder="Amount"
                inputMode="decimal"
              />
              <button className="rr-btn rr-btnSecondary rr-btnCompact" type="button" onClick={() => addMoney("prepaid_add")}>
                Add
              </button>
            </div>
          </Field>

          <Field label="Add income" hint="Adds to total income">
            <div className="rr-row">
              <input
                className="rr-input rr-grow"
                value={incomeAdd}
                onChange={(e) => setIncomeAdd(e.target.value)}
                placeholder="Amount"
                inputMode="decimal"
              />
              <button className="rr-btn rr-btnSecondary rr-btnCompact" type="button" onClick={() => addMoney("income")}>
                Add
              </button>
            </div>
          </Field>

          <Field label="Add fee" hint="Adds to total fees paid">
            <div className="rr-row">
              <input
                className="rr-input rr-grow"
                value={feeAdd}
                onChange={(e) => setFeeAdd(e.target.value)}
                placeholder="Amount"
                inputMode="decimal"
              />
              <button className="rr-btn rr-btnSecondary rr-btnCompact" type="button" onClick={() => addMoney("fee")}>
                Add
              </button>
            </div>
          </Field>

          <Field label="Filter ledger">
            <select className="rr-input" value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="prepaid_add">Prepaid</option>
              <option value="income">Income</option>
              <option value="fee">Fees</option>
            </select>
          </Field>
        </div>

        <div className="rr-divider" />

        <div className="rr-sectionTitle">Ledger</div>
        {filteredLedger.length === 0 ? (
          <div className="rr-empty">
            <div className="rr-emptyTitle">No entries</div>
            <div className="rr-mutedSmall">Add prepaid, income, or fees to build your history.</div>
          </div>
        ) : (
          <div className="rr-card rr-tableCard" style={{ boxShadow: "none" }}>
            <div className="rr-tableWrap" role="table" aria-label="Ledger table">
              <div className="rr-tableHeader" role="row">
                <div role="columnheader">Type</div>
                <div role="columnheader">Amount</div>
                <div role="columnheader">Created</div>
                <div role="columnheader">Note</div>
                <div role="columnheader" className="rr-right">
                  ID
                </div>
              </div>

              {filteredLedger.slice(0, 50).map((x) => (
                <div className="rr-tableRow" role="row" key={x.id}>
                  <div role="cell" style={{ fontWeight: 800 }}>
                    {x.type}
                  </div>
                  <div role="cell">{formatMoney(Number(x.amount || 0))}</div>
                  <div role="cell" className="rr-mutedSmall">
                    {x.createdAt ? new Date(x.createdAt).toLocaleString() : "-"}
                  </div>
                  <div role="cell" className="rr-mutedSmall">
                    {x.note || "-"}
                  </div>
                  <div role="cell" className="rr-right rr-mutedSmall rr-mono">
                    {x.id}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rr-mutedSmall rr-mt12">
          Note: These finance numbers are MVP-only and stored locally in your browser.
        </div>
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section className="rr-page">
      <div className="rr-pageHeader">
        <h1 className="rr-title">Page not found</h1>
        <div className="rr-subtitle">The page you requested does not exist.</div>
      </div>
      <Link className="rr-textLink" to="/">
        Go home
      </Link>
    </section>
  );
}

// PUBLIC_INTERFACE
function App() {
  /**
   * Root entry point. Wraps the app with React Router for navigation.
   * Returns: The RoadRescue user-side + mechanic portal MVP interface.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Basic startup hook (future: hydrate from Supabase session).
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="rr-app">
        <div className="rr-splash">
          <div className="rr-splashCard">
            <div className="rr-brand rr-brandCenter">
              <div className="rr-brandMark" aria-hidden="true">
                RR
              </div>
              <div className="rr-brandName">{APP_TITLE}</div>
            </div>
            <div className="rr-muted">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
