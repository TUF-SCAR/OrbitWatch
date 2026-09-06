import { CalendarDays, Clock3, LogOut, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
function dateText(value){ if(!value) return "—"; const d=new Date(value); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"}); }
export default function ProfilePanel({open,user,onClose,onLogout}){
  if(!open||!user) return null;
  return <SpatialSurface side="right" strength={3} className="profile-panel">
    <header className="profile-panel__header" data-depth="4"><div><small>ORBITWATCH IDENTITY</small><strong>PROFILE</strong></div><button type="button" aria-label="Close profile" onClick={onClose}><X size={17}/></button></header>
    <div className="profile-panel__identity" data-depth="6"><span className="profile-panel__avatar"><UserRound size={25}/></span><span><small>AUTHENTICATED USER</small><strong>{user.username}</strong><em>USER #{user.id}</em></span></div>
    <div className="profile-panel__section" data-depth="5"><div className="profile-panel__section-title"><span>ACCOUNT DETAILS</span><ShieldCheck size={14}/></div><dl className="profile-panel__details"><div><dt><Mail size={14}/> EMAIL</dt><dd>{user.email}</dd></div><div><dt><CalendarDays size={14}/> JOINED</dt><dd>{dateText(user.created_at)}</dd></div><div><dt><Clock3 size={14}/> SESSION</dt><dd className="profile-panel__online">ACTIVE</dd></div></dl></div>
    <div className="profile-panel__section" data-depth="4"><div className="profile-panel__section-title"><span>MISSION PROFILE</span><span className="profile-panel__planned">PLANNED</span></div><div className="profile-panel__future-grid"><span><small>WATCHLIST</small><strong>—</strong></span><span><small>ALERTS</small><strong>—</strong></span><span><small>OBSERVATIONS</small><strong>—</strong></span></div></div>
    <footer className="profile-panel__footer" data-depth="5"><span>JWT SESSION / VERIFIED</span><button type="button" onClick={onLogout}><LogOut size={15}/> LOGOUT</button></footer>
  </SpatialSurface>;
}
