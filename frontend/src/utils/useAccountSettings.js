import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createAccountSettings} from '../services/accountSettings.js';

export function useAccountSettings(userId,open) {
  const owner=useMemo(()=>createAccountSettings({userId}),[userId]);
  const state=useSyncExternalStore(owner.subscribe,owner.snapshot,owner.snapshot);
  useEffect(()=>()=>owner.destroy(),[owner]);
  useEffect(()=>{if(userId&&open)owner.load();},[owner,userId,open]);
  return {state,owner};
}
