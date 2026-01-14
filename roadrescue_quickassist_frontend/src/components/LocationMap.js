import React, { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon paths for Leaflet when bundled (CRA/Webpack).
// Without this, markers may not appear because Leaflet's defaults expect images at specific URLs.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function Recenter({ center }) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);

  return null;
}

/**
 * PUBLIC_INTERFACE
 * LocationMap renders a Leaflet map centered at the provided coordinates with a single marker.
 *
 * Params:
 * - lat: number | null | undefined
 * - lon: number | null | undefined (supports "lon" naming per Nominatim; can pass lng as lon)
 * - height: number (optional) map height in px (default 300)
 * - label: string (optional) popup label
 *
 * Returns:
 * - A react-leaflet MapContainer showing an OpenStreetMap base layer and marker.
 */
export function LocationMap({ lat, lon, height = 300, label = "Breakdown Location" }) {
  const hasCoords = typeof lat === "number" && Number.isFinite(lat) && typeof lon === "number" && Number.isFinite(lon);

  const center = useMemo(() => (hasCoords ? [lat, lon] : null), [hasCoords, lat, lon]);

  if (!hasCoords) {
    return (
      <div className="rr-card rr-mapCard" aria-label="Map">
        <div className="rr-mapPlaceholder">
          <div className="rr-muted">No location selected yet.</div>
          <div className="rr-mutedSmall">Enter an address and click “Find location”, or use “Use my location”.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rr-card rr-mapCard" aria-label="Map">
      <MapContainer center={center} zoom={15} style={{ height: `${height}px`, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
        <Recenter center={center} />
        <Marker position={center}>
          <Popup>{label}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
