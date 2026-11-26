import { useEffect, useRef } from 'react';
import { usePhoneUI } from '../utils/usePhoneUI.js';

// Native top-layer semantics provide inert background, keyboard containment and
// focus restoration without measuring the scene or mounting another viewer.
export default function WorkspaceDialog({ children, onClose, className = '', onKeyDown, ...props }) {
  const dialog = useRef(null);
  const phone = usePhoneUI();
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) opener.focus({preventScroll:true});
    };
  }, []);
  return <dialog ref={dialog} className={`workspace-dialog ${className}`} {...props}
    onCancel={event => {
      // React bubbles cancel events from nested dialogs, including portalled pickers.
      if (phone && event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}
    onKeyDown={event => { onKeyDown?.(event); event.stopPropagation(); }}>
    {children}
  </dialog>;
}
