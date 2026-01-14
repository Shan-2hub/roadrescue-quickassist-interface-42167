import React, { useEffect, useId, useMemo, useRef } from "react";

const CHENNAI_CENTER = { lat: 13.0827, lng: 80.2707 };
const DEFAULT_ZOOM = 13;

/**
 * Safely access Leaflet from the CDN script tag.
 * Returns null if Leaflet isn't available yet.
 */
function getLeaflet() {
  if (typeof window === "undefined") return null;
  return window.L || null;
}

/**
 * PUBLIC_INTERFACE
 * MapView renders an OpenStreetMap map using Leaflet loaded from CDN.
 *
 * Behavior:
 * - Defaults to Chennai when coords are missing/invalid.
 * - Shows a marker for the provided breakdown location.
 * - Updates the marker dynamically when `lat/lng` props change.
 *
 * Props:
 * - lat?: number | null
 * - lng?: number | null
 * - height?: number (px). Default 320.
 * - zoom?: number. Default 13.
 * - label?: string. Default "Breakdown location".
 *
 * Returns: JSX element containing the map or a graceful fallback.
 */
export default function MapView({
  lat,
  lng,
  height = 320,
  zoom = DEFAULT_ZOOM,
  label = "Breakdown location",
}) {
  const reactId = useId();
  const mapDivId = `rr-map-${reactId.replace(/[:]/g, "")}`;

  const mapRef = useRef(null);
  const markerRef = useRef(null);

  const hasCoords = useMemo(() => {
    return (
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }, [lat, lng]);

  const center = useMemo(() => {
    return hasCoords ? { lat, lng } : CHENNAI_CENTER;
  }, [hasCoords, lat, lng]);

  // Initialize map once.
  useEffect(() => {
    const L = getLeaflet();
    if (!L) return;

    // Prevent double-init if React StrictMode runs effects twice in dev.
    if (mapRef.current) return;

    const map = L.map(mapDivId, {
      zoomControl: true,
      scrollWheelZoom: false,
      // Allow pinch-zoom on touch devices.
      touchZoom: true,
      // Keep drag enabled; Leaflet internally handles multi-touch vs drag.
      dragging: true,
    }).setView([center.lat, center.lng], zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([center.lat, center.lng]).addTo(map);
    marker.bindPopup(label);

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      // Cleanup on unmount.
      try {
        map.remove();
      } finally {
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapDivId]);

  // Update marker + center when props change.
  useEffect(() => {
    const L = getLeaflet();
    if (!L) return;
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const nextLatLng = [center.lat, center.lng];

    marker.setLatLng(nextLatLng);
    marker.bindPopup(label);
    map.setView(nextLatLng, zoom, { animate: true });
  }, [center.lat, center.lng, zoom, label]);

  const leafletAvailable = Boolean(getLeaflet());

  if (!leafletAvailable) {
    return (
      <div className="rr-card rr-mapCard" aria-label="Map">
        <div className="rr-mapPlaceholder">
          <div className="rr-muted">Map is loading…</div>
          <div className="rr-mutedSmall">
            Leaflet is being loaded from CDN. If this persists, check network access to unpkg.com.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rr-card rr-mapCard" aria-label="Map">
      <div
        id={mapDivId}
        className="rr-leafletHost"
        style={{ height: `${height}px` }}
        role="application"
        aria-label="OpenStreetMap"
      />
      {!hasCoords ? (
        <div className="rr-mapHintBar" aria-label="Map hint">
          Showing Chennai by default. Enter coordinates or use “Find location” / “Use my location” to place the marker.
        </div>
      ) : null}
    </div>
  );
}
