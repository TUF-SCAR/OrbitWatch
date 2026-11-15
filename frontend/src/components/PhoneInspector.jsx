import {useEffect,useState} from 'react';
import {ChevronDown,ChevronUp,Minus,X} from 'lucide-react';
import {announcePhoneSurface} from '../utils/usePhoneUI.js';

// A regular aside: never traps focus, makes the canvas inert or captures gestures outside itself.
export default function PhoneInspector({side='left',title,label,onClose,summary,actions,children,onBack,inactive=false,onActivate}){
 const [minimized,setMinimized]=useState(false),[details,setDetails]=useState(false);
 useEffect(()=>{const collapse=e=>{if(e.detail!==label)setMinimized(true);};window.addEventListener('orbitwatch:phone-surface',collapse);return()=>window.removeEventListener('orbitwatch:phone-surface',collapse);},[label]);
 useEffect(()=>{if(!inactive)announcePhoneSurface(label);},[inactive,label]);
 if(minimized||inactive)return <aside className={`phone-inspector-tab is-${side}`} aria-label={label}>
  <button type="button" onClick={()=>{announcePhoneSurface(label);setMinimized(false);onActivate?.();}} aria-label={`Reopen ${label}`}>{title}</button>
  <button type="button" aria-label={`Close ${label}`} onClick={onClose}><X size={16}/></button>
 </aside>;
 return <aside className={`phone-inspector is-${side} ${details?'has-details':''}`} aria-label={label}>
  <header><strong>{title}</strong><button type="button" aria-label={`Minimize ${label}`} onClick={()=>setMinimized(true)}><Minus size={17}/></button><button type="button" aria-label={`Close ${label}`} onClick={onClose}><X size={17}/></button></header>
  <div className="phone-inspector__summary" role="status">{summary}</div>
  {actions&&<div className="phone-inspector__actions">{actions}</div>}
  <div className="phone-inspector__toolbar">{onBack&&<button type="button" onClick={onBack}>Back to results</button>}<button type="button" aria-expanded={details} onClick={()=>setDetails(v=>!v)}>Details {details?<ChevronDown size={15}/>:<ChevronUp size={15}/>}</button></div>
  {details&&<div className="phone-inspector__details">{children}</div>}
 </aside>;
}
