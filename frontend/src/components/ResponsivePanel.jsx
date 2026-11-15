import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import SpatialSurface from './SpatialSurface.jsx';
import WorkspaceDialog from './WorkspaceDialog.jsx';

const query = '(max-width: 820px), (max-height: 600px)';
const subscribe = callback => {
  const media = matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => matchMedia(query).matches;

export default function ResponsivePanel({ onDismiss, children, as, side, strength, ...props }) {
  const compact = useSyncExternalStore(subscribe, snapshot, () => false);
  const generatedId=useId(),id=props.id||generatedId;
  useLayoutEffect(()=>{
    if(compact)return;
    const opener=document.activeElement;
    document.getElementById(id)?.querySelector('button[aria-label^="Close"], input, button')?.focus({preventScroll:true});
    return()=>{if(opener instanceof HTMLElement&&opener.isConnected&&!opener.closest('[inert]'))opener.focus({preventScroll:true});};
  },[compact,id]);
  if (compact) return <WorkspaceDialog {...props} id={id} onClose={onDismiss}>{children}</WorkspaceDialog>;
  return <SpatialSurface {...props} id={id} as={as} side={side} strength={strength}>{children}</SpatialSurface>;
}
