import {useEffect,useState,useSyncExternalStore} from 'react';

// Height alone must never opt a desktop window into the phone layout.
export const PHONE_QUERY='(max-width: 600px), (max-width: 1000px) and (max-height: 600px) and (pointer: coarse)';
const subscribe=callback=>{const media=matchMedia(PHONE_QUERY);media.addEventListener('change',callback);return()=>media.removeEventListener('change',callback);};
export function usePhoneUI(){return useSyncExternalStore(subscribe,()=>matchMedia(PHONE_QUERY).matches,()=>false);}
export function announcePhoneSurface(id){window.dispatchEvent(new CustomEvent('orbitwatch:phone-surface',{detail:id}));}
export function usePhoneDisclosure(id){
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{const collapse=e=>{if(e.detail!==id)setExpanded(false);};window.addEventListener('orbitwatch:phone-surface',collapse);return()=>window.removeEventListener('orbitwatch:phone-surface',collapse);},[id]);
 return [expanded,value=>{const next=typeof value==='function'?value(expanded):value;if(next)announcePhoneSurface(id);setExpanded(next);}];
}
export function usePhoneViewport(){
 const phone=usePhoneUI();
 useEffect(()=>{
  if(!phone)return;
  const viewport=window.visualViewport,root=document.documentElement;
  const update=()=>{root.style.setProperty('--phone-height',`${viewport?.height??innerHeight}px`);root.style.setProperty('--phone-top',`${viewport?.offsetTop??0}px`);};
  update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);window.addEventListener('resize',update);
  return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);root.style.removeProperty('--phone-height');root.style.removeProperty('--phone-top');};
 },[phone]);
 return phone;
}
