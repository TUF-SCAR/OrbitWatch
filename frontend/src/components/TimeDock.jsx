import { History, RotateCcw } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { formatDateTimeLocal } from "../utils/spaceFormatters.js";

export default function TimeDock({ selectedTime, onTimeChange, onReturnLive, trackedCount, maxTracked, imageryStatus, referenceView, onReferenceChange, preparationIssue, onRetryImagery }) {
  return (
    <SpatialSurface side="bottom" strength={3.0} className="time-dock">
      <div className="time-dock__label" data-depth="3"><History size={18} /><span>TIME EXPLORER</span><b>{trackedCount}/{maxTracked}</b></div>
      <input type="datetime-local" aria-label="Scene date and time (local)" value={formatDateTimeLocal(selectedTime)} onChange={(event) => { const nextTime = new Date(event.target.value); if (!Number.isNaN(nextTime.getTime())) onTimeChange(nextTime); }} data-depth="5" />
      <div className="time-dock__scrub" data-depth="6">
        <button onClick={() => onTimeChange(new Date(selectedTime.getTime() - 3600000))}>−1h</button>
        <button onClick={() => onTimeChange(new Date(selectedTime.getTime() - 600000))}>−10m</button>
        <button onClick={() => onTimeChange(new Date(selectedTime.getTime() + 600000))}>+10m</button>
        <button onClick={() => onTimeChange(new Date(selectedTime.getTime() + 3600000))}>+1h</button>
      </div>
      <p className="time-coverage" role="status">Satellite historical/prediction data unavailable · {trackedCount} objects retained for future data integration. No current positions or telemetry are shown.</p>
      {imageryStatus?.message && <p className="time-coverage" role="status">{imageryStatus.message}</p>}
      <button onClick={onReferenceChange} aria-pressed={referenceView}>{referenceView ? "View daily observations" : "View reference map"}</button>
      {preparationIssue && <p className="time-coverage" role="status">{preparationIssue}</p>}
      {(preparationIssue || imageryStatus?.state === "unavailable" || /unavailable|could not/.test(imageryStatus?.message || "")) && <button onClick={onRetryImagery}>Retry imagery</button>}
      <button className="return-live" onClick={onReturnLive} data-depth="4"><RotateCcw size={17} /> Now</button>
    </SpatialSurface>
  );
}
