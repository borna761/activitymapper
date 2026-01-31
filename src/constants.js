// Map and UI
export const CONTAINER_STYLE = { width: "1400px", height: "850px" };

export const ICON_COLORS = {
  CC: "#4CAF50",
  DM: "#F44336",
  JY: "#2196F3",
  SC: "#9C27B0",
};

export const ACTIVITY_LABELS = {
  CC: "Children's Class",
  DM: "Devotional",
  JY: "Junior Youth",
  SC: "Study Circle",
};

export const ICON_BASE_URL = "https://cdn.jsdelivr.net/gh/borna761/activitymapper-icons/icons";
export const HOME_ICON_URL = `${ICON_BASE_URL}/home.png`;

// Magic numbers (named for clarity and single place to tune)
export const ACTIVITY_MARKER_RADIUS_DEG = 0.0005;
export const MARKER_BATCH_SIZE = 200;
export const DEBOUNCE_MS = 200;
export const HEADER_MIN_MATCHES = 2;
