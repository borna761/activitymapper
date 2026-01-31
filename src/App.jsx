// ActivityMapper.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { RateLimiter } from "limiter";
import {
  CONTAINER_STYLE as containerStyle,
  ICON_COLORS,
  ACTIVITY_LABELS,
  ICON_BASE_URL,
  HOME_ICON_URL,
  ACTIVITY_MARKER_RADIUS_DEG,
  MARKER_BATCH_SIZE,
  DEBOUNCE_MS,
} from "./constants";
import {
  getField,
  NEIGHBORHOOD_KEYS,
  POSTAL_KEYS,
  LOCALITY_KEYS,
  REGION_KEYS,
  NATIONAL_COMMUNITY_KEYS,
  FIRST_NAME_KEYS,
  LAST_NAME_KEYS,
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_NAME_KEYS,
  FACILITATORS_KEYS,
  findIndividualsHeaderRow,
  findActivitiesHeaderRow,
} from "./utils/parsing";
import { getPixelPosition } from "./utils/mapUtils";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_API_KEY;
const GOOGLE_MAP_LIBRARIES = ["places"];

// Helper to get activity name before the first comma, with error handling
const getShortActivityName = name => {
  if (!name || typeof name !== 'string') return '[No Activity Name]';
  const idx = name.indexOf(',');
  return idx === -1 ? name : name.slice(0, idx);
};

// Helper to sort by activity type, then activity name, then facilitator (uses shared column keys)
function sortActivities(a, b) {
  const typeA = (getField(a, ACTIVITY_TYPE_KEYS) || '').toLowerCase();
  const typeB = (getField(b, ACTIVITY_TYPE_KEYS) || '').toLowerCase();
  if (typeA < typeB) return -1;
  if (typeA > typeB) return 1;
  const nameA = getShortActivityName(getField(a, ACTIVITY_NAME_KEYS) || '').toLowerCase();
  const nameB = getShortActivityName(getField(b, ACTIVITY_NAME_KEYS) || '').toLowerCase();
  if (nameA < nameB) return -1;
  if (nameA > nameB) return 1;
  const facA = (getField(a, FACILITATORS_KEYS) || '').toLowerCase();
  const facB = (getField(b, FACILITATORS_KEYS) || '').toLowerCase();
  if (facA < facB) return -1;
  if (facA > facB) return 1;
  return 0;
}

// Debounced update for selectedNeighborhoods
const debounce = (fn, delay) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

export default function ActivityMapper() {
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const [isLatLonLoading, setIsLatLonLoading] = useState(false);
  const [activityMarkers, setActivityMarkers] = useState([]);
  const [homeMarkers, setHomeMarkers] = useState([]);
  const [selectedHome, setSelectedHome] = useState(null);
  const [center, setCenter] = useState({ lat: 0, lng: 0 });
  const [zoom, setZoom] = useState(2);
  const mapRef = useRef(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [activitiesNoFacilitators, setActivitiesNoFacilitators] = useState([]);
  const [activitiesFacilitatorNotFound, setActivitiesFacilitatorNotFound] = useState([]);
  const [activityTypeCounts, setActivityTypeCounts] = useState({ CC: 0, DM: 0, JY: 0, SC: 0 });
  const [neighborhoods, setNeighborhoods] = useState([]);
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState([]);
  const [facilitatorNeighborhoodLookup, setFacilitatorNeighborhoodLookup] = useState({});
  const [isBatchingMarkers, setIsBatchingMarkers] = useState(false);
  const [batchedActivityMarkers, setBatchedActivityMarkers] = useState([]);
  const [batchedHomeMarkers, setBatchedHomeMarkers] = useState([]);
  const [geocodeError, setGeocodeError] = useState(null);
  const homeMarkersRef = useRef([]);

  const limiter = new RateLimiter({ tokensPerInterval: 1000, interval: "minute" });

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: GOOGLE_MAPS_KEY,
    libraries: GOOGLE_MAP_LIBRARIES,
    mapIds: [MAP_ID],
  });

  // auto-fit to markers
  useEffect(() => {
    const pts = [
      ...activityMarkers.map(m => ({ lat: m.lat, lng: m.lng })),
      ...homeMarkers.map(h => ({ lat: h.lat, lng: h.lng })),
    ];
    if (mapRef.current && pts.length) {
      const bounds = new window.google.maps.LatLngBounds();
      pts.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    }
  }, [activityMarkers, homeMarkers]);

  useEffect(() => {
    homeMarkersRef.current = homeMarkers;
  }, [homeMarkers]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setZoom(10);
        },
        () => console.warn('User denied geolocation'),
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    }
  }, []);

  // Helper to normalize names for matching
  const normalizeName = name => name.trim().replace(/\s+/g, ' ').toLowerCase();

  // Map activity type to code
  const ACTIVITY_TYPE_MAP = {
    "children's class": 'CC',
    'junior youth group': 'JY',
    'study circle': 'SC',
    'devotional': 'DM',
  };

  const handleLatLonUpload = (e) => {
    const file = e.target.files[0];
    const input = e.target;
    if (!file) return;
    setIsLatLonLoading(true);
    setActivityMarkers([]);
    const noFacilitators = [];
    const facilitatorNotFound = [];
    const typeCounts = { CC: 0, DM: 0, JY: 0, SC: 0 };
    const processActivities = (data) => {
      const currentHomes = homeMarkersRef.current;
      const homeLookup = {};
      currentHomes.forEach(h => {
        const fullName = normalizeName(`${h.firstName || ''} ${h.lastName || ''}`);
        if (fullName) homeLookup[fullName] = h;
      });
      // Group activities by facilitator
      const facilitatorActivities = {};
      // Track unique activities by type (not per facilitator)
      const uniqueActivityRows = new Set();
      data.forEach(row => {
        const activityTypeRaw = getField(row, ACTIVITY_TYPE_KEYS) || '';
        const activityType = ACTIVITY_TYPE_MAP[activityTypeRaw.trim().toLowerCase()];
        if (!activityType) return;
        const facilitatorsRaw = getField(row, FACILITATORS_KEYS) || '';
        if (!facilitatorsRaw.trim()) {
          noFacilitators.push(row);
          return;
        }
        const activityName = getField(row, ACTIVITY_NAME_KEYS) || '';
        const uniqueKey = `${activityName}|${activityType}`;
        if (!uniqueActivityRows.has(uniqueKey)) {
          typeCounts[activityType] = (typeCounts[activityType] || 0) + 1;
          uniqueActivityRows.add(uniqueKey);
        }
        let foundAny = false;
        facilitatorsRaw.split(';').forEach(name => {
          const normName = normalizeName(name);
          if (homeLookup[normName]) {
            if (!facilitatorActivities[normName]) facilitatorActivities[normName] = [];
            facilitatorActivities[normName].push({
              activity: activityType,
              activityTypeRaw: activityTypeRaw,
              facilitator: name.trim(),
              address: homeLookup[normName].address || '',
              activityName,
              facilitators: facilitatorsRaw,
            });
            foundAny = true;
          }
        });
        if (!foundAny) {
          facilitatorNotFound.push(row);
        }
      });
      const markers = [];
      const uniqueMappedActivities = {};
      Object.entries(facilitatorActivities).forEach(([normName, acts]) => {
        const base = homeLookup[normName];
        acts.forEach((act, i) => {
          const angle = (2 * Math.PI * i) / acts.length;
          const latOffset = Math.sin(angle) * ACTIVITY_MARKER_RADIUS_DEG;
          const lngOffset = Math.cos(angle) * ACTIVITY_MARKER_RADIUS_DEG;
          markers.push({
            id: `act-${normName}-${act.facilitator}-${act.activityName || ''}-${i}`,
            lat: base.lat + latOffset,
            lng: base.lng + lngOffset,
            activity: act.activity,
            activityTypeRaw: act.activityTypeRaw,
            facilitator: act.facilitator,
            address: act.address,
            activityName: act.activityName,
            facilitators: act.facilitators,
          });
          // Count unique activity rows by name+type+facilitators
          const uniqueKey = `${act.activityName || ''}|${act.activity}|${act.facilitators}`;
          if (!uniqueMappedActivities[act.activity]) uniqueMappedActivities[act.activity] = new Set();
          uniqueMappedActivities[act.activity].add(uniqueKey);
        });
      });
      // Build counts from uniqueMappedActivities
      const mappedTypeCounts = { CC: 0, DM: 0, JY: 0, SC: 0 };
      Object.entries(uniqueMappedActivities).forEach(([type, set]) => {
        mappedTypeCounts[type] = set.size;
      });
      setActivityMarkers(markers);
      setActivitiesNoFacilitators(noFacilitators);
      setActivitiesFacilitatorNotFound(facilitatorNotFound);
      setActivityTypeCounts(mappedTypeCounts);
      if (markers.length) {
        setCenter(markers[0]);
        setZoom(10);
      }
      setIsLatLonLoading(false);
    };

    if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headerRowIndex = findActivitiesHeaderRow(rawRows);
        const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex });
        processActivities(rows);
        input.value = '';
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result || '';
        Papa.parse(text, {
          header: false,
          skipEmptyLines: true,
          complete: ({ data: rawRows }) => {
            const headerRowIndex = findActivitiesHeaderRow(rawRows);
            const headers = rawRows[headerRowIndex] || [];
            const rows = rawRows.slice(headerRowIndex + 1).map((row) => {
              const obj = {};
              headers.forEach((h, i) => {
                obj[String(h ?? '').trim() || `Column${i}`] = row[i] ?? '';
              });
              return obj;
            }).filter((obj) => Object.keys(obj).some((k) => obj[k] !== '' && obj[k] != null));
            processActivities(rows);
            input.value = '';
          },
        });
      };
      reader.readAsText(file);
    }
  };

  const GEOCODE_MAX_RETRIES = 3;
  const geocodeAddress = async (addr, retryCount = 0) => {
    try {
      await limiter.removeTokens(1);
    } catch {
      if (retryCount >= GEOCODE_MAX_RETRIES) return null;
      await new Promise(r => setTimeout(r, 1000));
      return geocodeAddress(addr, retryCount + 1);
    }
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(addr)}&proximity=ip&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features[0]) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return { lat, lng, address: addr };
    }
    return null;
  };

  const handleAddressUpload = async (e) => {
    const file = e.target.files[0];
    const input = e.target;
    if (!file) return;
    setIsAddressLoading(true);
    setGeocodeError(null);
    setHomeMarkers([]);
    setActivityMarkers([]);
    setActivitiesNoFacilitators([]);
    setActivitiesFacilitatorNotFound([]);

    if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headerRowIndex = findIndividualsHeaderRow(rawRows);
        const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex });
        geocodeRows(rows).then(() => { input.value = ''; });
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result || '';
        Papa.parse(text, {
          header: false,
          skipEmptyLines: true,
          complete: ({ data: rawRows }) => {
            const headerRowIndex = findIndividualsHeaderRow(rawRows);
            const headers = rawRows[headerRowIndex] || [];
            const rows = rawRows.slice(headerRowIndex + 1).map((row) => {
              const obj = {};
              headers.forEach((h, i) => {
                obj[String(h ?? '').trim() || `Column${i}`] = row[i] ?? '';
              });
              return obj;
            }).filter((obj) => Object.keys(obj).some((k) => obj[k] !== '' && obj[k] != null));
            geocodeRows(rows).then(() => { input.value = ''; });
          }
        });
      };
      reader.readAsText(file);
    }
  };

  const processResults = useCallback(results => {
    setHomeMarkers(results);
    const allNeighborhoodsRaw = results.map(r => {
      const n = getField(r, NEIGHBORHOOD_KEYS);
      const trimmed = (n || '').trim();
      return trimmed ? trimmed : 'Other';
    });
    let uniqueNeighborhoods = Array.from(new Set(allNeighborhoodsRaw));
    uniqueNeighborhoods = uniqueNeighborhoods.filter(n => n !== 'Other').sort((a, b) => a.localeCompare(b));
    if (allNeighborhoodsRaw.includes('Other')) uniqueNeighborhoods.push('Other');
    setNeighborhoods(uniqueNeighborhoods);
    setSelectedNeighborhoods(uniqueNeighborhoods);
    if (results.length) { setCenter(results[0]); setZoom(10); }
    setIsAddressLoading(false);
    const lookup = {};
    results.forEach(h => {
      const fullName = normalizeName(`${h.firstName || ''} ${h.lastName || ''}`);
      lookup[fullName] = (getField(h, NEIGHBORHOOD_KEYS) || '').trim() || 'Other';
    });
    setFacilitatorNeighborhoodLookup(lookup);
  }, []);

  const geocodeRows = useCallback(async (rows) => {
    const getStreetPart = (r) => {
      const addr = getField(r, ['Address']);
      if (addr) return addr;
      const line1 = getField(r, ['Address Line 1', 'Address line 1']);
      const line2 = getField(r, ['Address Line 2', 'Address line 2']);
      return [line1, line2].filter(Boolean).join(', ');
    };
    const getNeighborhood = (r) => (getField(r, NEIGHBORHOOD_KEYS) || '').trim();
    const getPostal = (r) => (getField(r, POSTAL_KEYS) || '').trim();
    const getLocality = (r) => (getField(r, LOCALITY_KEYS) || '').trim();
    const getRegion = (r) => (getField(r, REGION_KEYS) || '').trim();
    const getNationalCommunity = (r) => (getField(r, NATIONAL_COMMUNITY_KEYS) || '').trim();
    const addressKey = (r) => [
      getStreetPart(r),
      getNeighborhood(r),
      getPostal(r),
      getLocality(r),
      getRegion(r),
      getNationalCommunity(r),
    ].join('|');
    const uniqueRows = Array.from(
      new Map(rows.map(r => [addressKey(r), r])).values()
    );
    const geocodedMap = {};
    let failedCount = 0;
    for (const row of uniqueRows) {
      const query = [
        getStreetPart(row),
        getNeighborhood(row),
        getPostal(row),
        getLocality(row),
        getRegion(row),
        getNationalCommunity(row),
      ].filter(Boolean).join(', ');
      const result = await geocodeAddress(query);
      if (result) {
        geocodedMap[addressKey(row)] = result;
      } else {
        failedCount++;
      }
    }
    if (failedCount > 0) {
      setGeocodeError(`${failedCount} address(es) could not be geocoded.`);
    } else {
      setGeocodeError(null);
    }
    const allIndividuals = rows.map((r, idx) => {
      const geo = geocodedMap[addressKey(r)];
      const firstName = getField(r, FIRST_NAME_KEYS) || '';
      const lastName = getField(r, LAST_NAME_KEYS) || '';
      return geo
        ? {
            ...r,
            id: `home-${geo.lat}-${geo.lng}-${firstName}-${lastName}-${idx}`,
            lat: geo.lat,
            lng: geo.lng,
            address: geo.address,
            firstName,
            lastName,
          }
        : null;
    }).filter(Boolean);
    processResults(allIndividuals);
  }, [processResults]);

  // Debounced update for selectedNeighborhoods
  const setSelectedNeighborhoodsDebounced = useCallback(
    debounce((val) => setSelectedNeighborhoods(val), DEBOUNCE_MS),
    []
  );

  // Batching function for markers
  const batchUpdateMarkers = useCallback((filteredActivities, filteredHomes, batchSize = MARKER_BATCH_SIZE) => {
    setIsBatchingMarkers(true);
    let aIdx = 0, hIdx = 0;
    function batch() {
      setBatchedActivityMarkers(filteredActivities.slice(0, aIdx + batchSize));
      setBatchedHomeMarkers(filteredHomes.slice(0, hIdx + batchSize));
      aIdx += batchSize;
      hIdx += batchSize;
      if (aIdx < filteredActivities.length || hIdx < filteredHomes.length) {
        setTimeout(batch, 0);
      } else {
        setIsBatchingMarkers(false);
      }
    }
    setBatchedActivityMarkers([]);
    setBatchedHomeMarkers([]);
    batch();
  }, []);

  // Memoized filtered markers for performance
  const filteredActivityMarkers = useMemo(() =>
    activityMarkers.filter(m => {
      const facilitator = normalizeName(m.facilitator || '');
      const n = facilitatorNeighborhoodLookup[facilitator] || 'Other';
      return selectedNeighborhoods.includes(n);
    }),
    [activityMarkers, selectedNeighborhoods, facilitatorNeighborhoodLookup]
  );
  const filteredHomeMarkers = useMemo(() =>
    homeMarkers.filter(p => {
      let n = (getField(p, NEIGHBORHOOD_KEYS) || '').trim();
      if (!n) n = 'Other';
      return selectedNeighborhoods.includes(n);
    }),
    [homeMarkers, selectedNeighborhoods]
  );

  // Batch update markers when filter changes
  useEffect(() => {
    batchUpdateMarkers(filteredActivityMarkers, filteredHomeMarkers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredActivityMarkers, filteredHomeMarkers]);

  if (!isLoaded) return <div>Loading map...</div>;

  return (
    <div className="p-6">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {isAddressLoading && "Loading individuals file…"}
        {isLatLonLoading && "Loading activities…"}
        {geocodeError ?? ""}
      </div>
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-5xl font-bold text-center pb-14 text-indigo-600">Activity Mapper</h1>
        {geocodeError && (
          <p className="mb-4 p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded" role="alert">
            {geocodeError}
          </p>
        )}
        <div className="flex flex-col gap-5 sm:flex-row pb-5 w-full justify-start items-start gap-10">
          <label className="block text-md font-medium">
            <span className="flex justify-between">
              Individuals CSV/XLSX
              {isAddressLoading && (
                <span
                  className="animate-spin inline-block size-6 border-4 border-current border-t-transparent text-indigo-600 rounded-full"
                  role="status"
                  aria-label="loading"
                ></span>
              )}
            </span>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleAddressUpload}
              className="block w-full mt-2 border border-gray-300 rounded-lg text-md cursor-pointer bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 file:bg-gray-200 file:border-0 file:me-4 file:py-3 file:px-4 dark:file:bg-gray-800 dark:file:text-gray-400" />
          </label>
          <label className="block text-md font-medium">
            <span className="flex justify-between">
              Activities CSV/XLSX
              {isLatLonLoading && (
                <span
                  className="animate-spin inline-block size-6 border-4 border-current border-t-transparent text-indigo-600 rounded-full"
                  role="status"
                  aria-label="loading"
                ></span>
              )}
            </span>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleLatLonUpload}
              disabled={homeMarkers.length === 0}
              className={`block w-full mt-2 border border-gray-300 rounded-lg text-md cursor-pointer bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 file:bg-gray-200 file:border-0 file:me-4 file:py-3 file:px-4 dark:file:bg-gray-800 dark:file:text-gray-400 ${homeMarkers.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`} />
          </label>
        </div>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={zoom}
          onLoad={map => (mapRef.current = map)}
          options={{ disableDefaultUI: true, zoomControl: true, mapId: MAP_ID }}
        >
          {isBatchingMarkers && (
            <div className="absolute left-1/2 top-10 z-50 -translate-x-1/2 bg-black bg-opacity-70 text-white px-6 py-3 rounded shadow-lg">
              Updating markers...
            </div>
          )}
          {batchedActivityMarkers.map((m) => (
            <Marker
              key={m.id}
              position={{ lat: m.lat, lng: m.lng }}
              icon={{
                url: `${ICON_BASE_URL}/${m.activity.toLowerCase()}.png`,
                size: new window.google.maps.Size(24, 24),
                scaledSize: new window.google.maps.Size(24, 24),
                anchor: new window.google.maps.Point(12, 12),
              }}
              onClick={() => { setSelectedActivity(m); setSelectedHome(null); }}
            />
          ))}
          {batchedHomeMarkers.map((p) => (
            <Marker
              key={p.id ?? `home-${p.lat}-${p.lng}-${p.firstName}-${p.lastName}`}
              position={{ lat: p.lat, lng: p.lng }}
              icon={{
                url: HOME_ICON_URL,
                size: new window.google.maps.Size(10, 10),
                scaledSize: new window.google.maps.Size(10, 10),
                anchor: new window.google.maps.Point(5, 5),
              }}
              onClick={() => { setSelectedHome(p); setSelectedActivity(null); }}
            />
          ))}
          {selectedActivity && mapRef.current && (() => {
            const { left, top } = getPixelPosition(mapRef.current, selectedActivity.lat, selectedActivity.lng);
            return (
              <div
                style={{ position: 'absolute', left, top, zIndex: 1000, transform: 'translate(-50%, -100%)' }}
              >
                <div className="pt-0 px-4 pb-3 min-w-[200px] bg-white text-black dark:bg-black dark:text-white border border-gray-300 dark:border-gray-800 rounded-lg shadow-lg">
                  <div className="flex justify-end">
                    <button onClick={() => setSelectedActivity(null)} className="text-xl font-bold">×</button>
                  </div>
                  <p className="mb-3 text-sm font-normal break-words">
                    <span className="font-bold">{selectedActivity.activityTypeRaw || '[No Activity Type]'}</span>
                    <br />
                    <span>{getShortActivityName(selectedActivity.activityName) || '[No Activity Name]'}</span>
                    <br />
                    <span>{selectedActivity.facilitators || '[No Facilitators]'}</span>
                  </p>
                </div>
              </div>
            );
          })()}
          {selectedHome && mapRef.current && (() => {
            const { left, top } = getPixelPosition(mapRef.current, selectedHome.lat, selectedHome.lng);
            return (
              <div
                style={{ position: 'absolute', left, top, zIndex: 1000, transform: 'translate(-50%, -100%)' }}
              >
                <div className="pt-0 px-4 pb-3 min-w-[200px] bg-white text-black dark:bg-black dark:text-white border border-gray-300 dark:border-gray-800 rounded-lg shadow-lg">
                  <div className="flex justify-end">
                    <button onClick={() => setSelectedHome(null)} className="text-xl font-bold">×</button>
                  </div>
                  <p className="mb-3 text-sm font-normal break-words">
                    {selectedHome.address}
                  </p>
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => {
                        setHomeMarkers(prev => prev.filter(h => (
                          (h.id != null && selectedHome.id != null) ? h.id !== selectedHome.id : h !== selectedHome
                        )));
                        setSelectedHome(null);
                      }}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded shadow"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </GoogleMap>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 pt-4 text-sm">
          {Object.entries(ICON_COLORS).map(([key]) => (
            <div key={key} className="flex items-center space-x-2">
              <img
                src={`${ICON_BASE_URL}/${key.toLowerCase()}.png`}
                alt={key}
                className="w-4 h-4"
              />
              <span>{ACTIVITY_LABELS[key]} <span className="text-xs text-gray-500">({activityTypeCounts[key] || 0})</span></span>
            </div>
          ))}
          <div className="flex items-center space-x-2">
            <img
              src={HOME_ICON_URL}
              alt="Address"
              className="w-4 h-4" />
            <span>Address</span>
          </div>
        </div>
        {/* Neighborhood filter */}
        {neighborhoods.length > 0 && (
          <div className="mt-8 mb-4">
            <h2 className="text-lg font-bold mb-2">Neighborhood</h2>
            <div className="flex gap-4 mb-2">
              <button
                className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
                onClick={() => setSelectedNeighborhoodsDebounced([...neighborhoods])}
              >
                Select All
              </button>
              <button
                className="px-2 py-1 bg-gray-300 text-gray-800 text-xs rounded hover:bg-gray-400"
                onClick={() => setSelectedNeighborhoodsDebounced([])}
              >
                Select None
              </button>
            </div>
            <div className="flex flex-wrap gap-4">
              {neighborhoods.map(n => (
                <label key={n} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedNeighborhoods.includes(n)}
                    onChange={e => {
                      setSelectedNeighborhoodsDebounced(
                        e.target.checked
                          ? [...selectedNeighborhoods, n].sort((a, b) => a.localeCompare(b))
                          : selectedNeighborhoods.filter(x => x !== n)
                      );
                    }}
                  />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {/* Activities with no facilitators */}
        {activitiesNoFacilitators.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-bold mb-2">Activities with No Facilitators</h2>
            <ul className="list-disc pl-6">
              {activitiesNoFacilitators.slice().sort(sortActivities).map((row, idx) => (
                <li key={idx} className="mb-1">
                  {getField(row, ACTIVITY_TYPE_KEYS) ? `${getField(row, ACTIVITY_TYPE_KEYS)}: ` : ''}
                  {getShortActivityName(getField(row, ACTIVITY_NAME_KEYS) || '[No Name]')}
                  {getField(row, FACILITATORS_KEYS) ? ` - Facilitators: ${getField(row, FACILITATORS_KEYS)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Activities with facilitators not found */}
        {activitiesFacilitatorNotFound.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-2">Activities Where Facilitator Address Not Found</h2>
            <ul className="list-disc pl-6">
              {activitiesFacilitatorNotFound.slice().sort(sortActivities).map((row, idx) => (
                <li key={idx} className="mb-1">
                  {getField(row, ACTIVITY_TYPE_KEYS) ? `${getField(row, ACTIVITY_TYPE_KEYS)}: ` : ''}
                  {getShortActivityName(getField(row, ACTIVITY_NAME_KEYS) || '[No Name]')}
                  {getField(row, FACILITATORS_KEYS) ? ` - Facilitators: ${getField(row, FACILITATORS_KEYS)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
