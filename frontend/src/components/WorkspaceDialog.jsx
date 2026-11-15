import { useEffect, useRef } from 'react';

// Native top-layer semantics provide inert background, keyboard containment and
// focus restoration without measuring the scene or mounting another viewer.
export default function WorkspaceDialog({ children, onClose, className = '', onKeyDown, ...props }) {
  const dialog = useRef(null);
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
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { onKeyDown?.(event); event.stopPropagation(); }}>
    {children}
  </dialog>;
}
