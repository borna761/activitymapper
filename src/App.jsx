// ActivityMapper.jsx
import React, { useState, useEffect, useRef } from "react";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { RateLimiter } from "limiter";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_API_KEY;
const GOOGLE_MAP_LIBRARIES = ["places"];

const containerStyle = { width: "100%", height: "500px" };

const ICON_COLORS = {
  CC: "#4CAF50",
  DM: "#F44336",
  JY: "#2196F3",
  SC: "#9C27B0",
};

const ACTIVITY_LABELS = {
  CC: "Children's Class",
  DM: "Devotional",
  JY: "Junior Youth",
  SC: "Study Circle",
};

const ICON_BASE_URL = "https://cdn.jsdelivr.net/gh/borna761/activitymapper-icons/icons";
const HOME_ICON_URL = `${ICON_BASE_URL}/home.png`;

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
    if (!file) return;
    setIsLatLonLoading(true);
    setActivityMarkers([]);

    const processActivities = (data) => {
      // Build a lookup for homeMarkers by normalized full name
      const homeLookup = {};
      homeMarkers.forEach(h => {
        const fullName = normalizeName(`${h.firstName || ''} ${h.lastName || ''}`);
        if (fullName) homeLookup[fullName] = h;
      });
      // Group activities by facilitator
      const facilitatorActivities = {};
      data.forEach(row => {
        const activityTypeRaw = row['Activity Type'] || row['activity type'] || row['Type'] || row['type'] || '';
        const activityType = ACTIVITY_TYPE_MAP[activityTypeRaw.trim().toLowerCase()];
        if (!activityType) return;
        const facilitatorsRaw = row['Facilitators'] || row['facilitators'] || '';
        if (!facilitatorsRaw.trim()) return;
        const activityName = row['Name'] || row['name'] || '';
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
          }
        });
      });
      // Spread activities in a circle for each facilitator
      const markers = [];
      const radius = 0.00025; // degrees
      Object.entries(facilitatorActivities).forEach(([normName, acts]) => {
        const base = homeLookup[normName];
        acts.forEach((act, i) => {
          const angle = (2 * Math.PI * i) / acts.length;
          const latOffset = Math.sin(angle) * radius;
          const lngOffset = Math.cos(angle) * radius;
          markers.push({
            lat: base.lat + latOffset,
            lng: base.lng + lngOffset,
            activity: act.activity,
            activityTypeRaw: act.activityTypeRaw,
            facilitator: act.facilitator,
            address: act.address,
            activityName: act.activityName,
            facilitators: act.facilitators,
          });
        });
      });
      setActivityMarkers(markers);
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
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        processActivities(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => processActivities(data),
      });
    }
  };

  const geocodeAddress = async (addr) => {
    const remainingMessages = await limiter.removeTokens(1);
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(addr)}&proximity=ip&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.features && data.features[0]) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return { lat, lng, address: addr };
    }
    return null;
  };

  const getNameField = (row, keys) => {
    for (const key of keys) {
      for (const k in row) {
        if (k.replace(/\s|_/g, '').toLowerCase() === key.replace(/\s|_/g, '').toLowerCase()) {
          return row[k];
        }
      }
    }
    return '';
  };

  const handleAddressUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsAddressLoading(true);
    setHomeMarkers([]);
    setActivityMarkers([]);

    const process = (results) => {
      const deduped = Array.from(new Map(results.map(p => [`${p.lat},${p.lng}`, p])).values());
      setHomeMarkers(deduped);
      if (deduped.length) { setCenter(deduped[0]); setZoom(10); }
      setIsAddressLoading(false);
    };

    let rows = [];
    if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        geocodeRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: ({ data }) => {
          rows = data;
          geocodeRows(rows);
        }
      });
    }
  }

const geocodeRows = async (rows) => {
  // Step 1: Deduplicate by address key for geocoding
  const addressKey = r => [
    r['Address'] || '',
    r['Focus Neighbourhood'] || '',
    r['Locality'] || '',
    r['Region'] || '',
    r['National Community'] || ''
  ].join('|');
  const uniqueRows = Array.from(
    new Map(
      rows.map(r => [addressKey(r), r])
    ).values()
  );
  // Step 2: Geocode unique addresses
  const geocodedMap = {};
  for (const row of uniqueRows) {
    const query = [
      row['Address'] || '',
      row['Focus Neighbourhood'] || '',
      row['Locality'] || '',
      row['Region'] || '',
      row['National Community'] || ''
    ].filter(Boolean).join(', ');
    const result = await geocodeAddress(query);
    if (result) {
      geocodedMap[addressKey(row)] = result;
    }
  }
  // Step 3: Assign geocoded lat/lng to all individuals
  const allIndividuals = rows.map(r => {
    const geo = geocodedMap[addressKey(r)];
    const firstName = getNameField(r, ['First Name', 'FirstName', 'Firstname', 'first_name', 'firstname', 'First Name(s)']);
    const lastName = getNameField(r, ['Last Name', 'LastName', 'Lastname', 'last_name', 'lastname', 'Family Name']);
    return geo ? {
      ...r,
      lat: geo.lat,
      lng: geo.lng,
      address: geo.address,
      firstName,
      lastName
    } : null;
  }).filter(Boolean);
  processResults(allIndividuals);
};

  const processResults = results => {
    const deduped = Array.from(new Map(results.map(p => [`${p.lat},${p.lng}`, p])).values());
    setHomeMarkers(deduped);
    if (deduped.length) { setCenter(deduped[0]); setZoom(10); }
    setIsAddressLoading(false);
  };


  const handleExport = async () => {
    const base = 'https://maps.googleapis.com/maps/api/staticmap';
    const size = '4000x1200';
    const style = [
      'feature:poi|visibility:off',
      'feature:road|element:labels|visibility:off',
      'feature:transit|visibility:off',
      'feature:administrative|visibility:off',
      'saturation:-50',
      'lightness:20',
    ]
      .map(s => `style=${encodeURIComponent(s)}`)
      .join('&');
    const actParams = activityMarkers.map(m =>
      `markers=icon:${ICON_BASE_URL}/${m.activity.toLowerCase()}.png|${m.lat},${m.lng}`
    );
    const homeParams = homeMarkers.map(p =>
      `markers=icon:${HOME_ICON_URL}|${p.lat},${p.lng}`
    );
    const url = `${base}?key=${GOOGLE_MAPS_KEY}&size=${size}&scale=2&${style}&${[
      ...actParams,
      ...homeParams,
    ].join('&')}`;
    const res = await fetch(url);
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `activity-map-${new Date().toISOString().split('T')[0]}.png`;
    link.click();
  };

  if (!isLoaded) return <div>Loading map...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-5xl font-bold text-center pb-14 text-indigo-600">Activity Mapper</h1>
      <div className="flex flex-col gap-5 sm:flex-row pb-5">
        <label className="block text-md font-medium sm:w-1/2">
          <span className="flex justify-between">
            Individiuals CSV/XLSX
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
            className="block w-full mt-2 border border-gray-300 rounded-lg text-md  cursor-pointer bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 file:bg-gray-200 file:border-0 file:me-4 file:py-3 file:px-4 dark:file:bg-gray-800 dark:file:text-gray-400" />
        </label>
        <label className="block text-md font-medium sm:w-1/2">
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
        {activityMarkers.map((m, i) => (
          <Marker
            key={i}
            position={{ lat: m.lat, lng: m.lng }}
            icon={{
              url: `${ICON_BASE_URL}/${m.activity.toLowerCase()}.png`,
              size: new window.google.maps.Size(16, 16),
              scaledSize: new window.google.maps.Size(16, 16),
              anchor: new window.google.maps.Point(8, 8),
            }}
            onClick={() => { setSelectedActivity(m); setSelectedHome(null); }}
          />
        ))}
        {homeMarkers.map((p, i) => (
          <Marker
            key={i}
            position={{ lat: p.lat, lng: p.lng }}
            icon={{
              url: HOME_ICON_URL,
              size: new window.google.maps.Size(12, 12),
              scaledSize: new window.google.maps.Size(12, 12),
              anchor: new window.google.maps.Point(6, 6),
            }}
            onClick={() => { setSelectedHome(p); setSelectedActivity(null); }}
          />
        ))}
        {selectedActivity && (
          <InfoWindow
            position={{ lat: selectedActivity.lat, lng: selectedActivity.lng }}
            onCloseClick={() => setSelectedActivity(null)}
          >
            <div className="pt-0 px-2 pb-2 min-w-[200px]">
              <p className="mb-2 text-sm">
                <span className="font-bold">{selectedActivity.activityTypeRaw || '[No Activity Type]'}</span>
                <br />
                <span>{selectedActivity.activityName || '[No Activity Name]'}</span>
                <br />
                <span>{selectedActivity.facilitators || '[No Facilitators]'}</span>
              </p>
            </div>
          </InfoWindow>
        )}
        {selectedHome && (
          <InfoWindow
            position={{ lat: selectedHome.lat, lng: selectedHome.lng }}
            onCloseClick={() => setSelectedHome(null)}
          >
            <div className="pt-0 px-2 pb-2 min-w-[200px]">
              <p className="mb-2 text-sm">
                {selectedHome.address}
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setHomeMarkers(prev => prev.filter(h => h !== selectedHome));
                    setSelectedHome(null);
                  }}
                  className="px-2 py-1 bg-red-600 text-white text-xs rounded"
                >
                  Remove
                </button>
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 pt-4 text-sm">
        {Object.entries(ICON_COLORS).map(([key]) => (
          <div key={key} className="flex items-center space-x-2">
            <img
              src={`${ICON_BASE_URL}/${key.toLowerCase()}.png`}
              alt={key}
              className="w-4 h-4"
            />
            <span>{ACTIVITY_LABELS[key]}</span>
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
      <button onClick={handleExport} className="mt-4 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">
        Export map PNG
      </button>
    </div>
  );
}
