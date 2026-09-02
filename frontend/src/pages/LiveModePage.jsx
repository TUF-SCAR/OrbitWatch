import { AnimatePresence, motion } from "motion/react";
import {
  CircleUserRound,
  Database,
  Layers3,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AccountMenu from "../components/AccountMenu.jsx";
import AmbientFlow from "../components/AmbientFlow.jsx";
import ExperienceIntro from "../components/ExperienceIntro.jsx";
import Globe from "../components/Globe.jsx";
import LiquidGlass from "../components/LiquidGlass.jsx";
import ModeMenu from "../components/ModeMenu.jsx";
import ObjectDetails from "../components/ObjectDetails.jsx";
import ObjectExplorer from "../components/ObjectExplorer.jsx";
import OrbitWatchBrand from "../components/OrbitWatchBrand.jsx";
import {
  DEFAULT_FOCUSED_NORAD_ID,
  SPACE_OBJECTS,
} from "../data/spaceObjects.js";
import { fetchSpaceObjectCatalog } from "../services/orbitwatchApi.js";
import "./LiveModePage.css";

const OVERLAY_NAMES = {
  MODE: "mode",
  ACCOUNT: "account",
  EXPLORER: "explorer",
  DETAILS: "details",
};

function LiveModePage({ navigateToPage }) {
  const [spaceObjects, setSpaceObjects] = useState(SPACE_OBJECTS);
  const [focusedNoradId, setFocusedNoradId] = useState(
    DEFAULT_FOCUSED_NORAD_ID,
  );
  const [liveData, setLiveData] = useState({});
  const [connectionState, setConnectionState] = useState("connecting");
  const [activeOverlay, setActiveOverlay] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState("Overview");
  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Featured");
  const [showOrbit, setShowOrbit] = useState(true);

  useEffect(() => {
    let pageClosed = false;

    async function loadBackendCatalog() {
      try {
        const catalogResponse = await fetchSpaceObjectCatalog();

        if (!pageClosed && catalogResponse.objects?.length === 100) {
          setSpaceObjects(catalogResponse.objects);
        }
      } catch {
        // The bundled catalogue remains available until the backend is ready.
      }
    }

    loadBackendCatalog();

    return () => {
      pageClosed = true;
    };
  }, []);

  useEffect(() => {
    function closeOverlayWithEscape(event) {
      if (event.key === "Escape") {
        setActiveOverlay(null);
      }
    }

    window.addEventListener("keydown", closeOverlayWithEscape);

    return () => {
      window.removeEventListener("keydown", closeOverlayWithEscape);
    };
  }, []);

  const handleSpaceObjectData = useCallback((noradId, spaceObjectData) => {
    setLiveData((currentLiveData) => ({
      ...currentLiveData,
      [noradId]: spaceObjectData,
    }));
  }, []);

  const handleSpaceObjectSelect = useCallback((noradId) => {
    setFocusedNoradId(noradId);
    setActiveOverlay(null);
  }, []);

  const categories = useMemo(
    () => [
      "Featured",
      "All",
      ...new Set(spaceObjects.map((spaceObject) => spaceObject.category)),
    ],
    [spaceObjects],
  );

  const filteredObjects = useMemo(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();

    return spaceObjects.filter((spaceObject) => {
      const nameMatches = spaceObject.name
        .toLowerCase()
        .includes(normalizedSearchText);
      const aliasMatches = spaceObject.aliases?.some((alias) =>
        alias.toLowerCase().includes(normalizedSearchText),
      );
      const noradIdMatches = String(spaceObject.noradId).includes(
        normalizedSearchText,
      );
      const searchMatches =
        !normalizedSearchText || nameMatches || aliasMatches || noradIdMatches;

      const categoryMatches =
        selectedCategory === "All" ||
        (selectedCategory === "Featured" && spaceObject.featured) ||
        spaceObject.category === selectedCategory;

      return searchMatches && categoryMatches;
    });
  }, [searchText, selectedCategory, spaceObjects]);

  const focusedObject =
    spaceObjects.find(
      (spaceObject) => spaceObject.noradId === focusedNoradId,
    ) ?? spaceObjects[0];

  const focusedObjectData = liveData[focusedObject?.noradId];
  const loadedObjectCount = Object.keys(liveData).length;
  const backendConnected = connectionState === "online";
  const overlayOpen = activeOverlay !== null;

  function toggleOverlay(overlayName) {
    setActiveOverlay((currentOverlay) => {
      return currentOverlay === overlayName ? null : overlayName;
    });
  }

  function closeOverlay() {
    setActiveOverlay(null);
  }

  return (
    <main className="live-mode-page">
      <Globe
        focusedNoradId={focusedNoradId}
        onConnectionStateChange={setConnectionState}
        onSpaceObjectData={handleSpaceObjectData}
        onSpaceObjectSelect={handleSpaceObjectSelect}
        showFocusedOrbit={showOrbit}
        spaceObjects={spaceObjects}
      />

      <AmbientFlow />
      <div className="live-mode-vignette" aria-hidden="true" />

      <div className="live-mode-interface">
        <AnimatePresence>
          {overlayOpen ? (
            <motion.button
              animate={{ opacity: 1, backdropFilter: "blur(5px)" }}
              aria-label="Close open panel"
              className="overlay-backdrop"
              exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
              initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
              onClick={closeOverlay}
              type="button"
            />
          ) : null}
        </AnimatePresence>

        <div className="top-left-controls">
          <AnimatePresence initial={false} mode="sync">
            {activeOverlay === OVERLAY_NAMES.MODE ? (
              <ModeMenu
                key="mode-menu"
                layoutId="mode-surface"
                onClose={closeOverlay}
              />
            ) : (
              <OrbitWatchBrand
                key="mode-trigger"
                layoutId="mode-surface"
                onClick={() => toggleOverlay(OVERLAY_NAMES.MODE)}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="top-right-controls">
          <LiquidGlass className="data-status-control" strength="medium">
            {backendConnected ? <Wifi size={17} /> : <WifiOff size={17} />}
            <span>
              <strong>
                {loadedObjectCount}/{spaceObjects.length}
              </strong>
              <small>{backendConnected ? "live objects" : "backend offline"}</small>
            </span>
          </LiquidGlass>

          <LiquidGlass
            aria-label="Layer controls will be added with weather and space weather"
            className="round-control"
            element="button"
            strength="medium"
            type="button"
            whileHover={{ scale: 1.06, y: -1 }}
            whileTap={{ scale: 0.94 }}
          >
            <Layers3 size={20} />
          </LiquidGlass>

          <AnimatePresence initial={false} mode="sync">
            {activeOverlay === OVERLAY_NAMES.ACCOUNT ? (
              <AccountMenu
                key="account-menu"
                layoutId="account-surface"
                navigateToPage={navigateToPage}
                onClose={closeOverlay}
              />
            ) : (
              <LiquidGlass
                className="account-control"
                element="button"
                key="account-trigger"
                layoutId="account-surface"
                onClick={() => toggleOverlay(OVERLAY_NAMES.ACCOUNT)}
                strength="medium"
                transition={{ type: "spring", stiffness: 280, damping: 28 }}
                type="button"
                whileHover={{ scale: 1.025, y: -1 }}
                whileTap={{ scale: 0.975 }}
              >
                <CircleUserRound size={20} />
                <span>
                  <strong>Guest</strong>
                  <small>Account</small>
                </span>
              </LiquidGlass>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false} mode="sync">
          {activeOverlay === OVERLAY_NAMES.EXPLORER ? (
            <ObjectExplorer
              categories={categories}
              filteredObjects={filteredObjects}
              focusedNoradId={focusedNoradId}
              key="explorer-panel"
              layoutId="explorer-surface"
              liveData={liveData}
              onClose={closeOverlay}
              onObjectSelect={handleSpaceObjectSelect}
              searchText={searchText}
              selectedCategory={selectedCategory}
              setSearchText={setSearchText}
              setSelectedCategory={setSelectedCategory}
            />
          ) : (
            <LiquidGlass
              className="explorer-control"
              element="button"
              key="explorer-trigger"
              layoutId="explorer-surface"
              onClick={() => toggleOverlay(OVERLAY_NAMES.EXPLORER)}
              strength="medium"
              transition={{ type: "spring", stiffness: 270, damping: 28 }}
              type="button"
              whileHover={{ x: 4, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
            >
              <Search size={20} />
              <span>
                <strong>Explore objects</strong>
                <small>{spaceObjects.length} curated model families</small>
              </span>
            </LiquidGlass>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="sync">
          <ObjectDetails
            activeTab={activeDetailTab}
            detailsOpen={activeOverlay === OVERLAY_NAMES.DETAILS}
            key={focusedObject?.noradId}
            layoutId="details-surface"
            onClose={closeOverlay}
            onOpen={() => setActiveOverlay(OVERLAY_NAMES.DETAILS)}
            setActiveTab={setActiveDetailTab}
            setShowOrbit={setShowOrbit}
            showOrbit={showOrbit}
            spaceObject={focusedObject}
            spaceObjectData={focusedObjectData}
          />
        </AnimatePresence>

        <LiquidGlass className="source-control" strength="soft">
          <Database size={16} />
          <span>
            <strong>GP prediction</strong>
            <small>CelesTrak · SGP4</small>
          </span>
        </LiquidGlass>
      </div>

      <ExperienceIntro />
    </main>
  );
}

export default LiveModePage;
