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

const APP_TITLE = "RoadRescue";

/**
 * Generates a lightweight unique id for client-only request storage.
 * Not cryptographically secure; sufficient for MVP UI state.
 */
function generateId() {
  return `req_${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36).slice(-4)}`;
}

function formatLatLng(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

/**
 * Minimal MVP "map" card:
 * - Shows an embedded OpenStreetMap if lat/lng exist.
 * - Otherwise shows a placeholder panel.
 */
function MapEmbed({ lat, lng }) {
  const hasCoords = typeof lat === "number" && typeof lng === "number";
  const src = useMemo(() => {
    if (!hasCoords) return "";
    // Use OpenStreetMap embed. This is not a precise pin but provides contextual map.
    const delta = 0.02;
    const left = lng - delta;
    const right = lng + delta;
    const top = lat + delta;
    const bottom = lat - delta;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [hasCoords, lat, lng]);

  return (
    <div className="rr-card rr-mapCard" aria-label="Map">
      {hasCoords ? (
        <iframe
          title="Breakdown location map"
          className="rr-mapFrame"
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="rr-mapPlaceholder">
          <div className="rr-muted">No location selected yet.</div>
          <div className="rr-mutedSmall">Use “Use my location” to pin your breakdown location.</div>
        </div>
      )}
    </div>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authUser, setAuthUser] = useState(() => loadAuthUser());
  const [alerts, setAlerts] = useState([]);

  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionState());

  const authed = Boolean(authUser);

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

  const navItems = useMemo(() => {
    // Matches screenshots: Submit Request + My Requests visible.
    // For unauth users, keep About/Register/Login.
    if (authed) {
      return [
        { to: "/submit-request", label: "Submit Request" },
        { to: "/my-requests", label: "My Requests" },
      ];
    }
    return [
      { to: "/about", label: "About" },
      { to: "/register", label: "Register" },
    ];
  }, [authed]);

  const notifLabel = useMemo(() => {
    if (notifPermission === "granted") return "Notifications: On";
    if (notifPermission === "denied") return "Notifications: Blocked";
    if (notifPermission === "default") return "Enable notifications";
    if (notifPermission === "unsupported") return "Notifications: Unsupported";
    return "Notifications";
  }, [notifPermission]);

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
            {navItems.map((item) => (
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

            {authed ? (
              <>
                <div className="rr-userChip" title={authUser?.email || "User"}>
                  <span className="rr-userDot" aria-hidden="true" />
                  <span className="rr-userText">{authUser?.email || "Logged in"}</span>
                </div>
                <button className="rr-linkButton" onClick={onLogout} type="button">
                  Logout
                </button>
              </>
            ) : (
              <Link className="rr-linkButton" to="/login">
                Login
              </Link>
            )}
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
                      // Scaffolding: attempt a browser notification; if not possible, in-app alert already added.
                      const res = await tryNotify({
                        title: "RoadRescue",
                        body: `Your request ${created.id} is OPEN.`,
                      });
                      if (!res.ok) {
                        // keep silent; UI already shows an in-app confirmation
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

        <h2 className="rr-h2">Coming Soon</h2>
        <ul className="rr-list">
          <li>Mechanic portal: accept/assign jobs and set status to “Assigned / On the way / Completed”.</li>
          <li>Real Google OAuth via Supabase.</li>
          <li>Server-driven push notifications and request history.</li>
        </ul>
      </div>
    </section>
  );
}

function SubmitRequestPage({ authUser, onRequestCreated, addAlert }) {
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleBody, setVehicleBody] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  const [issueDescription, setIssueDescription] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Address text is shown to the user; for MVP it can be either a real address (future)
  // or a raw "lat,lng" string. We keep pinned breakdown coordinates separately.
  const [addressText, setAddressText] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);

  const [locating, setLocating] = useState(false);

  const locationInputRef = useRef(null);

  const onAddressChange = (next) => {
    setAddressText(next);

    // If the user types coordinates, keep the pinned breakdown location in sync
    // so the map "under it" updates immediately (per screenshot/instructions).
    const parsed = parseLatLng(next);
    if (parsed) {
      setLat(parsed.lat);
      setLng(parsed.lng);
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

        // This pins the breakdown location and updates the map.
        setLat(la);
        setLng(lo);

        // Keep the address bar populated with coordinates for the MVP.
        setAddressText(formatLatLng(la, lo));

        // Keep focus in the address field (matches screenshot UX expectation)
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

    if (!vehicleMake || !vehicleModel || !vehicleYear || !licensePlate || !issueDescription) {
      addAlert("error", "Please fill vehicle details and issue description.");
      return;
    }
    if (!contactName || !contactPhone) {
      addAlert("error", "Please fill contact details.");
      return;
    }
    if (typeof lat !== "number" || typeof lng !== "number") {
      addAlert("error", "Please set your location using the Address field or 'Use my location'.");
      return;
    }

    const now = new Date().toISOString();
    const created = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      userId: authUser?.id || "unknown",
      status: "OPEN", // initial status (matches requirement)
      vehicle: {
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear,
        body: vehicleBody,
        licensePlate,
      },
      issueDescription,
      contact: {
        name: contactName,
        phone: contactPhone,
      },
      location: {
        addressText,
        lat,
        lng,
      },
      // Scaffolding fields for future mechanic assignment & notifications
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
            <Field label="Make">
              <input
                className="rr-input"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                placeholder="e.g. Toyota"
              />
            </Field>
            <Field label="Model">
              <input
                className="rr-input"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="e.g. Corolla"
              />
            </Field>
            <Field label="Year">
              <input
                className="rr-input"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                placeholder="e.g. 2018"
                inputMode="numeric"
              />
            </Field>
            <Field label="Body">
              <input
                className="rr-input"
                value={vehicleBody}
                onChange={(e) => setVehicleBody(e.target.value)}
                placeholder="e.g. Sedan"
              />
            </Field>
            <Field label="License Plate">
              <input
                className="rr-input"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                placeholder="e.g. ABC-1234"
              />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Issue</div>
          <Field label="Issue description">
            <textarea
              className="rr-textarea"
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="Describe the issue (e.g., flat tire, engine won’t start, battery dead...)"
              rows={4}
            />
          </Field>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Contact</div>
          <div className="rr-grid2">
            <Field label="Contact name">
              <input
                className="rr-input"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Your name"
              />
            </Field>
            <Field label="Contact phone number">
              <input
                className="rr-input"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+1 555 555 5555"
              />
            </Field>
          </div>

          <div className="rr-divider" />

          <div className="rr-sectionTitle">Location</div>
          <TwoCol
            left={
              <>
                <Field label="Address" hint="For MVP, paste coordinates like: 12.3456, 78.9012 — or use the button below.">
                  <input
                    ref={locationInputRef}
                    className="rr-input"
                    value={addressText}
                    onChange={(e) => onAddressChange(e.target.value)}
                    placeholder="Latitude, Longitude"
                  />
                </Field>

                <div className="rr-locationMeta" aria-label="Pinned breakdown coordinates">
                  <div className="rr-metaRow">
                    <span className="rr-metaLabel">Latitude</span>
                    <span className="rr-metaValue">{typeof lat === "number" ? lat.toFixed(6) : "-"}</span>
                  </div>
                  <div className="rr-metaRow">
                    <span className="rr-metaLabel">Longitude</span>
                    <span className="rr-metaValue">{typeof lng === "number" ? lng.toFixed(6) : "-"}</span>
                  </div>
                </div>

                <button className="rr-btn rr-btnPrimary rr-btnWide" type="button" onClick={useMyLocation} disabled={locating}>
                  {locating ? "Locating..." : "Use my location"}
                </button>

                <div className="rr-mutedSmall rr-mt8">
                  Tip: This will pin the map to your current breakdown location (browser permission required).
                </div>
              </>
            }
            right={<MapEmbed lat={lat} lng={lng} />}
          />

          <div className="rr-actions rr-actionsEnd">
            <button className="rr-btn rr-btnPrimary" type="submit">
              Submit request
            </button>
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
                  <div className="rr-mutedSmall">{new Date(r.createdAt).toLocaleString()}</div>
                </div>

                <div role="cell">
                  <div>
                    {r.vehicle?.make} {r.vehicle?.model} {r.vehicle?.year ? `(${r.vehicle.year})` : ""}
                  </div>
                  <div className="rr-mutedSmall">{r.vehicle?.licensePlate ? `Plate: ${r.vehicle.licensePlate}` : ""}</div>
                </div>

                <div role="cell">
                  <span className={`rr-badge rr-badge-${String(r.status || "").toLowerCase()}`}>{r.status}</span>
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

  // Detail view requirement: show map of the user's CURRENT location (not the original pinned breakdown location).
  const [currentLat, setCurrentLat] = useState(null);
  const [currentLng, setCurrentLng] = useState(null);
  const [locError, setLocError] = useState(null);

  useEffect(() => {
    const r = loadRequests().find((x) => x.id === id);
    setRequest(r || null);
  }, [id]);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocError("Geolocation is not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentLat(pos.coords.latitude);
        setCurrentLng(pos.coords.longitude);
        setLocError(null);
      },
      (err) => {
        setLocError(err?.message || "Unable to fetch your current location.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, []);

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
              <span className={`rr-badge rr-badge-${String(request.status || "").toLowerCase()}`}>{request.status}</span>
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
          <div className="rr-k">Submitted breakdown location (from request)</div>
          <div className="rr-v">
            {request.location?.addressText || "-"}{" "}
            {typeof request.location?.lat === "number" && typeof request.location?.lng === "number"
              ? `(${formatLatLng(request.location.lat, request.location.lng)})`
              : ""}
          </div>
        </div>

        <div className="rr-divider" />

        <div className="rr-kv">
          <div className="rr-k">Your current location (live)</div>
          <div className="rr-v">{locError ? <span className="rr-muted">{locError}</span> : formatLatLng(currentLat, currentLng) || "-"}</div>
        </div>

        <div className="rr-mutedSmall rr-mt8">
          Map below shows your current location right now (not the original pinned breakdown point).
        </div>
        <div className="rr-mt12">
          <MapEmbed lat={currentLat} lng={currentLng} />
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
   * Returns: The RoadRescue user-side MVP interface.
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
