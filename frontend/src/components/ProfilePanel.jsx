import { AnimatePresence } from "motion/react";
import { CalendarDays, Clock3, LogOut, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function ProfilePanel({ open, user, onClose, onLogout, settings, onSettingsChange }) {
  if (!user) return null;
  return <AnimatePresence>{open && <SpatialSurface as="aside" side="right" strength={3} className="profile-panel hud-panel hud-panel--right" aria-label="Profile and settings">
    <header className="profile-panel__header hud-panel__header" data-depth="4">
      <div><small className="eyebrow">ORBITWATCH IDENTITY</small><h2>Profile & settings</h2></div>
      <button className="icon-button" type="button" aria-label="Close profile" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="hud-panel__body profile-panel__body">
      <section className="profile-panel__identity" aria-label="User identity" data-depth="6">
        <span className="profile-panel__avatar" aria-hidden="true"><UserRound size={28} /></span>
        <div><small>AUTHENTICATED USER</small><strong>{user.username}</strong><span>User #{user.id}</span></div>
      </section>
      <section className="profile-panel__section" aria-labelledby="profile-account-title" data-depth="5">
        <h3 id="profile-account-title"><ShieldCheck size={16} /> Account & session</h3>
        <dl className="profile-panel__details">
          <div><dt><Mail size={14} /> Email</dt><dd>{user.email}</dd></div>
          <div><dt><CalendarDays size={14} /> Joined</dt><dd>{dateText(user.created_at)}</dd></div>
          <div><dt><Clock3 size={14} /> Session</dt><dd className="profile-panel__online">Active</dd></div>
        </dl>
      </section>
      <section className="profile-panel__section profile-settings" aria-labelledby="profile-settings-title" data-depth="4">
        <h3 id="profile-settings-title">Display settings</h3>
        <div className="profile-setting">
          <label htmlFor="profile-quality">Render quality</label>
          <p id="profile-quality-help">Choose the detail level for the globe and celestial scene.</p>
          <select id="profile-quality" aria-describedby="profile-quality-help" value={settings.quality} onChange={(event) => onSettingsChange({ ...settings, quality: event.target.value })}>
            {["auto", "performance", "balanced", "quality"].map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select>
        </div>
        <div className="profile-setting">
          <label className="profile-preview-toggle" htmlFor="profile-preview"><span>Interactive 3D Preview</span><input id="profile-preview" type="checkbox" aria-describedby="profile-preview-help" checked={settings.preview3d} onChange={(event) => onSettingsChange({ ...settings, preview3d: event.target.checked })} /></label>
          <p id="profile-preview-help">Show verified spacecraft models in the Inspector. Previews use additional memory and GPU resources.</p>
        </div>
      </section>
    </div>
    <footer className="profile-panel__footer hud-panel__footer" data-depth="5"><span>Authenticated session</span><button type="button" onClick={onLogout}><LogOut size={16} /> Logout</button></footer>
  </SpatialSurface>}</AnimatePresence>;
}
