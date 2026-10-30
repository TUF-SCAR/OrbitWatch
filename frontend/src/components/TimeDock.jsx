import { History, RotateCcw } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { formatDateTimeLocal } from "../utils/spaceFormatters.js";

export default function TimeDock({ selectedTime, onTimeChange, onReturnLive, trackedCount, maxTracked, imageryStatus, preparationIssue, onRetryImagery, historicalData, onRetryHistory }) {
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
      <p className="time-coverage" role="status">{historicalData?.state==='loading' ? 'Loading stored historical orbital elements…' : historicalData?.state==='ready' ? `${historicalData.objects.length}/${trackedCount} historical positions available · Archived SGP4 reconstruction, not observed telemetry.${historicalData.errors?.length ? ' Other selected objects have no valid archive coverage for this timestamp.' : ''}` : 'Historical archive unavailable for this timestamp. No current satellite positions are substituted.'}</p>
      {(historicalData?.state==='unavailable' || historicalData?.errors?.length>0) && <button onClick={onRetryHistory}>Retry historical data</button>}
      {imageryStatus && <p className="time-coverage" role="status">{imageryStatus.activeMap === 'local-reference' ? 'NASA/JPL/USGS · Static reference texture' : imageryStatus.activeMap === 'esri' ? 'Esri World Imagery · Reference basemap' : 'Reference basemap pending'} · Not imagery from the selected time.</p>}
      {imageryStatus?.message && imageryStatus.state !== 'available' && <p className="time-coverage" role="status">{imageryStatus.message}</p>}
      {preparationIssue && <p className="time-coverage" role="status">{preparationIssue}</p>}
      {(preparationIssue || ['unavailable','unconfigured'].includes(imageryStatus?.state)) && <button onClick={onRetryImagery}>Retry reference basemap</button>}
      <button className="return-live" onClick={onReturnLive} aria-label="Return to Live Mode" data-depth="4"><RotateCcw size={17} /> Now</button>
    </SpatialSurface>
  );
}
