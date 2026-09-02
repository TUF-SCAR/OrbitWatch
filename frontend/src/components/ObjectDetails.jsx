import { AnimatePresence, motion } from "motion/react";
import {
  Box,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Orbit,
  Satellite,
  X,
} from "lucide-react";
import LiquidGlass from "./LiquidGlass.jsx";
import {
  currentPositionFromData,
  formatNumber,
  formatUtcDate,
} from "../utils/spaceFormatters.js";

const DETAIL_TABS = ["Overview", "Orbit", "Model"];

function DetailMetric({ label, value, suffix = "" }) {
  return (
    <div className="detail-metric">
      <span>{label}</span>
      <strong>
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </strong>
    </div>
  );
}

function OverviewTab({ spaceObject }) {
  return (
    <motion.div
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      className="detail-tab-content"
      exit={{ opacity: 0, x: -10, filter: "blur(5px)" }}
      initial={{ opacity: 0, x: 10, filter: "blur(5px)" }}
      key="overview"
    >
      <p className="object-description">{spaceObject.description}</p>

      <dl className="object-facts">
        <div>
          <dt>Object type</dt>
          <dd>{spaceObject.objectType}</dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd>{spaceObject.operator}</dd>
        </div>
        <div>
          <dt>Country / organization</dt>
          <dd>{spaceObject.country}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{spaceObject.status}</dd>
        </div>
      </dl>

      <div className="external-links">
        {spaceObject.wikiUrl ? (
          <a href={spaceObject.wikiUrl} rel="noreferrer" target="_blank">
            Wikipedia <ExternalLink size={15} />
          </a>
        ) : null}

        {spaceObject.officialUrl ? (
          <a href={spaceObject.officialUrl} rel="noreferrer" target="_blank">
            Official mission page <ExternalLink size={15} />
          </a>
        ) : null}
      </div>
    </motion.div>
  );
}

function OrbitTab({ spaceObjectData, currentPosition }) {
  return (
    <motion.div
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      className="detail-tab-content"
      exit={{ opacity: 0, x: -10, filter: "blur(5px)" }}
      initial={{ opacity: 0, x: 10, filter: "blur(5px)" }}
      key="orbit"
    >
      <div className="expanded-metric-grid">
        <DetailMetric
          label="Altitude"
          suffix=" km"
          value={formatNumber(currentPosition?.altitude_km, 1)}
        />
        <DetailMetric
          label="Velocity"
          suffix=" km/s"
          value={formatNumber(spaceObjectData?.velocity_km_s, 2)}
        />
        <DetailMetric
          label="Latitude"
          suffix="°"
          value={formatNumber(currentPosition?.latitude, 2)}
        />
        <DetailMetric
          label="Longitude"
          suffix="°"
          value={formatNumber(currentPosition?.longitude, 2)}
        />
        <DetailMetric
          label="Orbital period"
          suffix=" min"
          value={formatNumber(spaceObjectData?.orbital_period_minutes, 1)}
        />
        <DetailMetric
          label="Prediction points"
          value={spaceObjectData?.positions?.length ?? "—"}
        />
      </div>

      <dl className="object-facts">
        <div>
          <dt>TLE epoch</dt>
          <dd>{formatUtcDate(spaceObjectData?.tle_epoch)}</dd>
        </div>
        <div>
          <dt>Propagation</dt>
          <dd>CelesTrak GP / OMM with SGP4</dd>
        </div>
        <div>
          <dt>Short prediction interval</dt>
          <dd>{spaceObjectData?.step_seconds ?? 5} seconds</dd>
        </div>
      </dl>
    </motion.div>
  );
}

function ModelTab({ spaceObject }) {
  return (
    <motion.div
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      className="detail-tab-content model-tab"
      exit={{ opacity: 0, x: -10, filter: "blur(5px)" }}
      initial={{ opacity: 0, x: 10, filter: "blur(5px)" }}
      key="model"
    >
      <span className="model-preview-icon">
        <Box size={36} />
      </span>
      <strong>{spaceObject.modelFamily}</strong>
      <p>
        Unfocused objects remain lightweight dots. A detailed model will load
        only while this object is focused.
      </p>
      <dl className="object-facts">
        <div>
          <dt>Model readiness</dt>
          <dd>{spaceObject.modelReadiness}</dd>
        </div>
        <div>
          <dt>Model URL</dt>
          <dd>{spaceObject.modelUrl ? "Connected" : "Not added yet"}</dd>
        </div>
      </dl>
    </motion.div>
  );
}

function ObjectDetails({
  spaceObject,
  spaceObjectData,
  detailsOpen,
  onOpen,
  onClose,
  activeTab,
  setActiveTab,
  showOrbit,
  setShowOrbit,
  layoutId = "details-surface",
}) {
  const currentPosition = currentPositionFromData(spaceObjectData);

  if (!spaceObject) {
    return null;
  }

  if (!detailsOpen) {
    return (
      <LiquidGlass
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="focused-object-card"
        exit={{ opacity: 0, y: 14, scale: 0.985 }}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        layoutId={layoutId}
        strength="strong"
        transition={{ type: "spring", stiffness: 250, damping: 28 }}
      >
        <div className="focused-object-card__identity">
          <span className="focused-object-card__icon">
            <Satellite size={23} />
          </span>
          <span>
            <small>Focused space object</small>
            <strong>{spaceObject.name}</strong>
            <p>
              {spaceObject.objectType} · NORAD {spaceObject.noradId}
            </p>
          </span>
        </div>

        <div className="focused-object-card__altitude">
          <small>Altitude</small>
          <strong>
            {formatNumber(currentPosition?.altitude_km, 1)}
            <span> km</span>
          </strong>
        </div>

        <motion.button
          onClick={onOpen}
          type="button"
          whileHover={{ scale: 1.01, y: -1 }}
          whileTap={{ scale: 0.985 }}
        >
          Open object dossier <ChevronRight size={17} />
        </motion.button>
      </LiquidGlass>
    );
  }

  return (
    <LiquidGlass
      animate={{ opacity: 1, x: 0, scale: 1 }}
      className="object-details-panel overlay-surface"
      exit={{ opacity: 0, x: 18, scale: 0.99 }}
      initial={{ opacity: 0, x: 18, scale: 0.99 }}
      layoutId={layoutId}
      strength="strong"
      transition={{ type: "spring", stiffness: 250, damping: 29 }}
    >
      <header className="overlay-heading object-details-panel__header">
        <span>
          <small>Object dossier</small>
          <strong>{spaceObject.name}</strong>
          <p>NORAD {spaceObject.noradId}</p>
        </span>
        <button aria-label="Close object details" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </header>

      <div className="detail-tab-list">
        {DETAIL_TABS.map((tabName) => (
          <button
            className={activeTab === tabName ? "active" : ""}
            key={tabName}
            onClick={() => setActiveTab(tabName)}
            type="button"
          >
            {activeTab === tabName ? (
              <motion.span
                className="detail-tab-indicator"
                layoutId="detail-tab-indicator"
              />
            ) : null}
            <span>{tabName}</span>
          </button>
        ))}
      </div>

      <div className="object-details-panel__body">
        <AnimatePresence mode="wait">
          {activeTab === "Overview" ? (
            <OverviewTab spaceObject={spaceObject} />
          ) : null}
          {activeTab === "Orbit" ? (
            <OrbitTab
              currentPosition={currentPosition}
              spaceObjectData={spaceObjectData}
            />
          ) : null}
          {activeTab === "Model" ? (
            <ModelTab spaceObject={spaceObject} />
          ) : null}
        </AnimatePresence>
      </div>

      <footer className="object-details-panel__footer">
        <button onClick={() => setShowOrbit((current) => !current)} type="button">
          {showOrbit ? <EyeOff size={17} /> : <Eye size={17} />}
          {showOrbit ? "Hide full orbit" : "Show full orbit"}
        </button>
        <button disabled type="button">
          <Orbit size={17} /> Pass predictions
          <small>Backend phase</small>
        </button>
      </footer>
    </LiquidGlass>
  );
}

export default ObjectDetails;
