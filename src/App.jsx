// MapUploaderApp.jsx — Simplified to use standard Marker
import React, { useState, useEffect, useRef } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;
const GOOGLE_MAP_LIBRARIES = ["places"];

const containerStyle = { width: "95vw", height: "700px" };

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

const HOME_ICON_URL = "/icons/home.png";

export default function MapUploaderApp() {
  const [loading, setLoading] = useState(false);
  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: GOOGLE_MAPS_KEY,
    libraries: GOOGLE_MAP_LIBRARIES,
    mapIds: [MAP_ID],
  });

  const [activityMarkers, setActivityMarkers] = useState([]);
  const [homeMarkers, setHomeMarkers] = useState([]);
  const [center, setCenter] = useState({ lat: 0, lng: 0 });
  const [zoom, setZoom] = useState(2);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setZoom(10);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    }
  }, []);

  const handleLatLonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const coords = data
          .map((row) => {
            const lat = parseFloat(row.latitude || row.lat || row.Latitude);
            const lng = parseFloat(row.longitude || row.lon || row.lng || row.Longitude);
            const activity = (row.activity || row.type || row.Type || "").trim().toUpperCase();
            return !isNaN(lat) && !isNaN(lng)
              ? { lat, lng, activity }
              : null;
          })
          .filter(Boolean);
        setActivityMarkers(coords);
        if (coords.length) {
          setCenter(coords[0]);
          setZoom(10);
        }
        setLoading(false);
      },
    });
  };

  const handleAddressUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);

    if (file.name.endsWith(".xlsx")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = XLSX.utils.sheet_to_json(sheet);
        const geocoder = new window.google.maps.Geocoder();
        const results = [];
        for (let row of parsed) {
          const address = row.address || row.Address || row.addr;
          if (!address) continue;
          const pt = await new Promise((resolve) => {
            geocoder.geocode({ address }, (out, status) => {
              resolve(status === "OK" && out[0] ? out[0].geometry.location.toJSON() : null);
            });
          });
          if (pt) results.push(pt);
        }
        const deduped = Array.from(
          new Map(results.map((p) => [`${p.lat},${p.lng}`, p])).values()
        );
        setHomeMarkers(deduped);
        if (deduped.length) {
          setCenter(deduped[0]);
          setZoom(10);
        }
        setLoading(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async ({ data }) => {
          const geocoder = new window.google.maps.Geocoder();
          const results = [];
          for (let row of data) {
            const address = row.address || row.Address || row.addr;
            if (!address) continue;
            const pt = await new Promise((resolve) => {
              geocoder.geocode({ address }, (out, status) => {
                resolve(status === "OK" && out[0] ? out[0].geometry.location.toJSON() : null);
              });
            });
            if (pt) results.push(pt);
          }
          const deduped = Array.from(
            new Map(results.map((p) => [`${p.lat},${p.lng}`, p])).values()
          );
          setHomeMarkers(deduped);
          if (deduped.length) {
            setCenter(deduped[0]);
            setZoom(10);
          }
          setLoading(false);
        },
      });
    }
  };

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
      `markers=icon:/icons/${m.activity.toLowerCase()}.png|${m.lat},${m.lng}`
    );
    const homeGroup = homeMarkers.map(
      (p) => `markers=icon:${HOME_ICON_URL}|${p.lat},${p.lng}`
    );
    const url = `${base}?key=${GOOGLE_MAPS_KEY}&size=${size}&scale=${scale}&${style}&${[
      ...markerStrings,
      ...homeGroup,
    ].join("&")}`;
    const res = await fetch(url);
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `activity-map-${new Date().toISOString().split("T")[0]}.png`;
    link.click();
  };

  if (!isLoaded) return <div>Loading map...</div>;
  if (loading)
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
        <div className="bg-white px-6 py-4 rounded shadow-lg text-center">
          <p className="text-lg text-gray-700 font-medium">Geocoding...</p>
        </div>
      </div>
    );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-5xl font-bold text-center pb-14 text-indigo-600">Activity Mapper</h1>
      <div className="flex flex-col gap-5 sm:flex-row pb-5">
        <label className="block text-md font-medium sm:w-1/2">
          <span className="flex justify-between">
            Address CSV
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
            Lat/Long CSV
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
            className="block w-full mt-2 border border-gray-300 rounded-lg text-md  cursor-pointer bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 file:bg-gray-200 file:border-0 file:me-4 file:py-3 file:px-4 dark:file:bg-gray-800 dark:file:text-gray-400" />
        </label>
      </div>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        options={{ disableDefaultUI: true, zoomControl: true, mapId: MAP_ID }}
      >
        {activityMarkers.map((m, idx) => (
          <Marker
            key={`act-${idx}`}
            position={{ lat: m.lat, lng: m.lng }}
            icon={{
              url: `https://cdn.jsdelivr.net/gh/borna761/activitymapper-icons/icons/${m.activity.toLowerCase()}.png`,
              size: new window.google.maps.Size(16, 16),
              scaledSize: new window.google.maps.Size(16, 16),
              anchor: new window.google.maps.Point(8, 8),
            }}
          />
        ))}
        {homeMarkers.map((p, idx) => (
          <Marker
            key={`home-${idx}`}
            position={p}
            icon={{ url: HOME_ICON_URL, scaledSize: new window.google.maps.Size(12, 12) }}
            onClick={() => setHomeMarkers((prev) => prev.filter((_, i) => i !== idx))}
          />
        ))}
      </GoogleMap>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 pt-4 text-sm">
        {Object.entries(ICON_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center space-x-2">
            <img
              src={`https://cdn.jsdelivr.net/gh/borna761/activitymapper-icons/icons/${key.toLowerCase()}.png`}
              alt={key}
              className="w-4 h-4"
            />
            <span>{key}</span>
          </div>
        ))}
        <div className="flex items-center space-x-2">
          <img src={HOME_ICON_URL} alt="home" className="w-4 h-4" />
          <span>Address</span>
        </div>
      </div>
      <button
        onClick={handleExport}
        className="mt-4 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
      >
        Export map PNG
      </button>
    </div>
  );
}
