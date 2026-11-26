import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import SpatialSurface from './SpatialSurface.jsx';
import {usePhoneUI} from '../utils/usePhoneUI.js';

const query = '(max-width: 820px), (max-height: 600px)';
const subscribe = callback => {
  const media = matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => matchMedia(query).matches;

export default function ResponsivePanel({ onDismiss, children, as = 'aside', side = 'right', strength, className = '', onKeyDown, id: suppliedId, ...props }) {
  const phone = usePhoneUI();
  const compact = useSyncExternalStore(subscribe, snapshot, () => false) || phone;
  const generatedId = useId(), id = suppliedId || generatedId;
  useLayoutEffect(()=>{
    const opener=document.activeElement;
    document.getElementById(id)?.querySelector('button[aria-label^="Close"], input, button')?.focus({preventScroll:true});
    return()=>{if(opener instanceof HTMLElement&&opener.isConnected&&!opener.closest('[inert]'))opener.focus({preventScroll:true});};
  },[id]);
  return <SpatialSurface {...props} id={id} as={as} side={side} strength={strength}
    className={`${className} observation-panel observation-panel--${side}${compact ? ' workspace-dialog' : ''}`}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onDismiss?.(); }
    }}>{children}</SpatialSurface>;
}
