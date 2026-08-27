"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import type { Layer, Map as LeafletMap } from "leaflet";
// Small enough to ship with the component. The library itself still arrives
// through the dynamic import below, because it touches `window` on evaluation
// and this page is server rendered.
import "leaflet/dist/leaflet.css";
import { formatCrowKm, formatDuration, formatRoutedKm, rankByDistance, type Point } from "@ariane/core/location";
import { locationIsUsable, officeLine, type OfficeRef } from "@ariane/core/types";

/**
 * Where to go, how far it is, and the number to ring first.
 *
 * Two rules shape all of it.
 *
 * The address is the government's. The coordinate is ours, derived from that
 * address by OpenStreetMap, and it is not evidence. So an office whose
 * coordinate did not clear the gate still appears here in full, with its
 * address and its source link, and simply has no pin and no distance. It is
 * never demoted, never sorted last and never quietly dropped: "we could not
 * place it on a map" is a statement about us, not about the office.
 *
 * And the citizen's position is theirs. It is asked for on a click, held in a
 * useState for as long as the tab is open, and sent to exactly one place: the
 * routing server, and only once someone has asked for a route. It is not
 * stored, not logged, and not attached to anything we keep.
 */

/**
 * OpenStreetMap's own tiles, no key, no account, no per-view billing.
 *
 * Plain PNGs, deliberately. The previous map drew vector tiles through WebGL
 * and rendered nothing at all on a machine without a working GL context: the
 * pins are DOM elements so they still appeared, floating over an empty box,
 * which is the single worst way for a map to fail. These are `<img>` tags. A
 * browser that cannot draw them cannot draw the page either.
 */
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Public demo server. Fine for one route on demand, not for a batch. */
const OSRM = "https://router.project-osrm.org/route/v1/driving";

interface Route {
  km: number;
  seconds: number;
  geometry: LineString;
}

export function Offices({ offices }: { offices: OfficeRef[] }) {
  const [position, setPosition] = useState<Point>();
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState<string>();
  const [routeTo, setRouteTo] = useState<string>();
  const [route, setRoute] = useState<Route>();

  const placed = offices.filter((o) => locationIsUsable(o.location));
  const nearest = position ? rankByDistance(placed, position, placed.length) : [];
  const order = nearest.length ? nearest.map((r) => r.office) : placed;
  const unplaced = offices.filter((o) => !locationIsUsable(o.location));
  const distances = new Map(nearest.map((r) => [r.office.nodeId, r.crowKm]));

  const locate = useCallback(() => {
    setLocating(true);
    setDenied(undefined);
    navigator.geolocation.getCurrentPosition(
      // Kept in this component's state and nowhere else. Nothing writes it to
      // storage, and no analytics call can see it from here.
      (p) => {
        setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setLocating(false);
      },
      (error) => {
        setDenied(
          error.code === error.PERMISSION_DENIED
            ? "No location, so these are ordered as the government lists them."
            : "Could not get a position just now.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  // The only moment a position leaves the browser, and only for the one office
  // whose route was asked for.
  useEffect(() => {
    if (!position || !routeTo) return;
    const office = offices.find((o) => o.nodeId === routeTo);
    if (!office?.location) return;
    let live = true;
    const from = `${position.longitude},${position.latitude}`;
    const to = `${office.location.longitude},${office.location.latitude}`;
    fetch(`${OSRM}/${from};${to}?overview=full&geometries=geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        const leg = json.routes?.[0];
        if (live && leg) setRoute({ km: leg.distance / 1000, seconds: leg.duration, geometry: leg.geometry });
      })
      .catch(() => live && setRoute(undefined));
    return () => {
      live = false;
    };
  }, [position, routeTo, offices]);

  if (!offices.length) return null;

  return (
    <div className="offices">
      <div className="offices-head">
        <h4>{offices.length === 1 ? "Where to go" : `Where to go (${offices.length})`}</h4>
        {placed.length && !position ? (
          <button className="tiny" onClick={locate} disabled={locating}>
            {locating ? "Finding you…" : "Nearest to me"}
          </button>
        ) : null}
      </div>

      {denied ? <p className="small faint" style={{ margin: 0 }}>{denied}</p> : null}

      {placed.length ? (
        <OfficeMap offices={order} position={position} route={route} highlight={routeTo} />
      ) : null}

      <ul className="office-list">
        {[...order, ...unplaced].map((office) => (
          <Office
            key={office.nodeId}
            office={office}
            crowKm={distances.get(office.nodeId)}
            route={routeTo === office.nodeId ? route : undefined}
            canRoute={Boolean(position && locationIsUsable(office.location))}
            onRoute={() => {
              setRoute(undefined);
              setRouteTo(office.nodeId);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function Office({
  office,
  crowKm,
  route,
  canRoute,
  onRoute,
}: {
  office: OfficeRef;
  crowKm?: number;
  route?: Route;
  canRoute: boolean;
  onRoute: () => void;
}) {
  const source = office.sources[0];
  const conflicting = office.sources.some((s) => s.verificationStatus === "CONFLICTING") || Boolean(office.conflictingAddresses?.length);

  return (
    <li className="office">
      <div className="office-line">
        <span className="office-name">{officeLine(office)}</span>
        {/* A routed distance was measured on a road network and gets a decimal.
            A straight line one is an estimate and gets a tilde. They are
            different promises and only one of them was measured. */}
        {route ? (
          <span className="office-far routed">{formatRoutedKm(route.km)} · {formatDuration(route.seconds)} by road</span>
        ) : crowKm !== undefined ? (
          <span className="office-far">{formatCrowKm(crowKm)} away</span>
        ) : null}
      </div>

      {office.workingHours ? <p className="small muted office-hours">{office.workingHours}</p> : null}

      <div className="office-actions">
        {/* The number the page published, dialled rather than read out. A phone
            call settles in a minute what a wasted trip settles in a morning. */}
        {office.phoneNumbers?.[0] ? (
          <a className="tiny action" href={`tel:${office.phoneNumbers[0].replace(/[^\d+]/gu, "")}`}>
            Call {office.phoneNumbers[0]}
          </a>
        ) : null}
        {canRoute && !route ? (
          <button className="tiny action" onClick={onRoute}>
            Directions
          </button>
        ) : null}
        {locationIsUsable(office.location) ? (
          // Handing off to the map app the phone already has, rather than
          // pretending to be one.
          <a className="tiny action" href={`https://www.openstreetmap.org/?mlat=${office.location.latitude}&mlon=${office.location.longitude}#map=17/${office.location.latitude}/${office.location.longitude}`} target="_blank" rel="noreferrer">
            Open in maps
          </a>
        ) : null}
        {source ? (
          <a className="tiny muted" href={source.source.url} target="_blank" rel="noreferrer">
            {conflicting ? "sources disagree" : "source"}
          </a>
        ) : (
          <span className="faint tiny">Not verified yet.</span>
        )}
      </div>

      {/* Said once, plainly, on the office it applies to. The alternative is a
          pin the citizen has no reason to distrust. */}
      {!locationIsUsable(office.location) && office.address ? (
        <p className="small faint office-nopin">Not on the map: we could not place this address precisely enough to point at it.</p>
      ) : null}
      {office.location?.status === "DERIVED_MEDIUM" ? (
        <p className="small faint office-nopin">The pin is the area this address names, not the door.</p>
      ) : null}
    </li>
  );
}

/**
 * Leaflet, loaded only when there is something to draw.
 *
 * The map lives in state rather than a ref on purpose. It is created after an
 * await, so every effect that draws onto it has to run again once it exists —
 * with a ref they ran once, found `null`, and returned, and the map came up
 * with no pins on it at all.
 */
function OfficeMap({
  offices,
  position,
  route,
  highlight,
}: {
  offices: OfficeRef[];
  position?: Point;
  route?: Route;
  highlight?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let instance: LeafletMap | undefined;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !container.current) return;

      // Ahmedabad, until the pins say otherwise. Wheel zoom stays off: this map
      // sits mid page and a citizen scrolling past it wants the page to move.
      instance = L.map(container.current, { scrollWheelZoom: false }).setView([23.0225, 72.5714], 10);
      L.tileLayer(TILES, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(instance);
      setMap(instance);
    })().catch(() => setFailed(true));

    return () => {
      cancelled = true;
      instance?.remove();
      setMap(undefined);
    };
  }, []);

  // Pins, the citizen, and the frame that holds all of them.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const drawn: Layer[] = [];

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;

      const points: [number, number][] = [];

      for (const office of offices) {
        if (!locationIsUsable(office.location)) continue;
        const at: [number, number] = [office.location.latitude, office.location.longitude];
        const icon = L.divIcon({
          className: `map-pin${office.nodeId === highlight ? " map-pin-on" : ""}${office.location.status === "DERIVED_MEDIUM" ? " map-pin-soft" : ""}`,
          iconSize: [15, 15],
          iconAnchor: [7, 7],
        });
        drawn.push(L.marker(at, { icon, title: officeLine(office) }).bindPopup(officeLine(office)).addTo(map));
        points.push(at);
      }

      if (position) {
        const icon = L.divIcon({ className: "map-me", iconSize: [13, 13], iconAnchor: [6, 6] });
        drawn.push(L.marker([position.latitude, position.longitude], { icon }).addTo(map));
        points.push([position.latitude, position.longitude]);
      }

      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    })();

    return () => {
      cancelled = true;
      for (const layer of drawn) layer.remove();
    };
  }, [map, offices, position, highlight]);

  // The route, drawn as its own layer so it survives pans and clears itself.
  useEffect(() => {
    if (!map || !route) return;
    let cancelled = false;
    let line: Layer | undefined;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      const data: Feature = { type: "Feature", properties: {}, geometry: route.geometry };
      const drawn = L.geoJSON(data, { style: { color: "#ef5a3c", weight: 4, opacity: 0.85 } }).addTo(map);
      line = drawn;
      // The whole way, both ends visible. A route half off the edge is a
      // direction, not directions.
      map.fitBounds(drawn.getBounds(), { padding: [40, 40] });
    })();

    return () => {
      cancelled = true;
      line?.remove();
    };
  }, [map, route]);

  if (failed) {
    // The addresses below are the product. A map that will not load is a
    // missing decoration, not a broken page.
    return null;
  }

  return (
    <div className="office-map">
      <div ref={container} className="office-map-canvas" />
      <p className="tiny faint office-map-note">
        Pins are derived from the published address by{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        , not published by the government.
      </p>
    </div>
  );
}
