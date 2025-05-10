// ActivityMapper.jsx
import React, { useState, useEffect, useRef } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import Papa from "papaparse";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;
const GOOGLE_MAP_LIBRARIES = ["places", "marker"];

const containerStyle = { width: "100%", height: "500px" };

const ICON_PATHS = {
  CC: "M12 3C10.9 3 10 3.9 10 5C10 5.73 10.41 6.38 11 6.72V7H8.5C7.95 7 7.5 7.45 7.5 8V9.25L6.5 10.25L5 9.5V7C5 5.9 4.11 5 3 5C1.9 5 1 5.9 1 7C1 8.1 1.9 9 3 9H4V10.93C4 11.62 4.29 12.28 4.8 12.75L6.6 14.4C6.21 14.9 6 15.5 6 16.12V21H18V16.12C18 15.5 17.79 14.9 17.4 14.4L19.2 12.75C19.71 12.28 20 11.62 20 10.93V9H21C22.1 9 23 8.1 23 7C23 5.9 22.1 5 21 5C19.9 5 19 5.9 19 7V9.5L17.5 10.25L16.5 9.25V8C16.5 7.45 16.05 7 15.5 7H13V6.72C13.59 6.38 14 5.73 14 5C14 3.9 13.11 3 12 3Z",
  DM: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  JY: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  SC: "M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z",
};

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

const HOME_ICON_URL = "https://cdn.jsdelivr.net/gh/borna761/activitymapper/home.png";

export default function MapUploaderApp() {
  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: GOOGLE_MAPS_KEY,
    libraries: GOOGLE_MAP_LIBRARIES,
    version: "weekly",
    mapIds: [MAP_ID],
  });

  const [activityMarkers, setActivityMarkers] = useState([]);
  const [homeMarkers, setHomeMarkers] = useState([]);
  const [center, setCenter] = useState({ lat: 0, lng: 0 });
  const [zoom, setZoom] = useState(2);
  const mapRef = useRef(null);
  const markerRef = useRef([]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setZoom(10);
        },
        () => {
          console.warn("User denied geolocation");
        },
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    }
  }, []);

  const handleLatLonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const coords = data.map(row => {
          const lat = parseFloat(row.latitude || row.lat || row.Latitude);
          const lng = parseFloat(row.longitude || row.lon || row.lng || row.Longitude);
          const activity = (row.activity || row.type || row.Type || "").trim().toUpperCase();
          return !isNaN(lat) && !isNaN(lng) ? { lat, lng, activity } : null;
        }).filter(Boolean);
        setActivityMarkers(coords);
        if (coords.length) {
          setCenter(coords[0]);
          setZoom(10);
        }
      },
    });
  };

  const handleAddressUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const geocoder = new window.google.maps.Geocoder();
        const results = [];
        for (const row of data) {
          const address = row.address || row.Address || row.addr || row.Addr;
          if (!address) continue;
          const pt = await new Promise((resolve) => {
            geocoder.geocode({ address }, (out, status) => {
              if (status === "OK" && out[0]) resolve(out[0].geometry.location.toJSON());
              else resolve(null);
            });
          });
          if (pt) results.push(pt);
        }
        setHomeMarkers(results);
        if (results.length) {
          setCenter(results[0]);
          setZoom(10);
        }
      },
    });
  };

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps?.marker?.AdvancedMarkerElement) return;
    markerRef.current.forEach(m => m.map = null);
    markerRef.current = [];
    if (!window.google?.maps?.marker?.AdvancedMarkerElement) {
      console.error("AdvancedMarkerElement is not available");
      return;
    }
    const AdvancedMarkerElement = window.google.maps.marker.AdvancedMarkerElement;
    const newMarkers = [];
    activityMarkers.forEach((m) => {
      const path = ICON_PATHS[m.activity];
      if (!path) {
        console.warn("Unknown activity type:", m.activity);
        return;
      }
      const icon = document.createElement("div");
      icon.innerHTML = `<svg width='32' height='32' viewBox='0 0 24 24' fill='${ICON_COLORS[m.activity] || 'gray'}' stroke='white' stroke-width='1'><path d='${path}'/></svg>`;
      const marker = new AdvancedMarkerElement({ position: { lat: m.lat, lng: m.lng }, map: mapRef.current, content: icon });
      newMarkers.push(marker);
    });
    homeMarkers.forEach((pos) => {
      const icon = document.createElement("img");
      icon.src = HOME_ICON_URL;
      icon.style.width = "24px";
      const marker = new AdvancedMarkerElement({ position: pos, map: mapRef.current, content: icon });
      newMarkers.push(marker);
    });
    markerRef.current = newMarkers;
  }, [activityMarkers, homeMarkers]);

  const handleExport = async () => {
    const base = "https://maps.googleapis.com/maps/api/staticmap";
    const size = "1000x640";
    const scale = 1;
    const style = [
      "feature:poi|visibility:off",
      "feature:road|element:labels|visibility:off",
      "feature:transit|visibility:off",
      "feature:administrative|visibility:off",
      "saturation:-50",
      "lightness:20",
    ].map(s => `style=${encodeURIComponent(s)}`).join("&");

    const validActivity = activityMarkers.filter(m => ICON_PATHS[m.activity]);
    const markerStrings = validActivity.map(m =>
      `markers=icon:https://cdn.jsdelivr.net/gh/borna761/activitymapper/${m.activity.toLowerCase()}.png|${m.lat},${m.lng}`
    );

    const homeGroup = homeMarkers.map(p =>
      `markers=icon:${HOME_ICON_URL}|${p.lat},${p.lng}`
    );

    const url = `${base}?key=${GOOGLE_MAPS_KEY}&size=${size}&scale=${scale}&${style}&${[...markerStrings, ...homeGroup].join("&")}`;

    const res = await fetch(url);
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const date = new Date().toISOString().split("T")[0];
    link.download = `activity-map-${date}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isLoaded) return <div>Loading map...</div>;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">ActivityMapper</h1>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="block">Address CSV
          <input type="file" accept=".csv" onChange={handleAddressUpload} className="mt-1 file:mr-4 file:px-4 file:py-2 file:border-0 file:rounded-xl file:bg-slate-200 hover:file:bg-slate-300 cursor-pointer" />
        </label>
        <label className="block">Lat/Lon CSV
          <input type="file" accept=".csv" onChange={handleLatLonUpload} className="mt-1 file:mr-4 file:px-4 file:py-2 file:border-0 file:rounded-xl file:bg-slate-200 hover:file:bg-slate-300 cursor-pointer" />
        </label>
      </div>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        options={{ disableDefaultUI: true, zoomControl: true, mapId: MAP_ID }}
        onLoad={(map) => {
          mapRef.current = map;
        }}
      >
      </GoogleMap>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 pt-4 text-sm">
        {Object.entries(ICON_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center space-x-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill={color} stroke="white" strokeWidth="1">
              <path d={ICON_PATHS[key]} />
            </svg>
            <span>{ACTIVITY_LABELS[key]}</span>
          </div>
        ))}
        <div className="flex items-center space-x-2">
          <img src={HOME_ICON_URL} alt="home" className="w-4 h-4" />
          <span>Address</span>
        </div>
      </div>
      <button onClick={handleExport} className="mt-4 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">
        Export map PNG
      </button>
    </div>
  );
}
