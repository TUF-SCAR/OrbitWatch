import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createAccountSettings} from '../services/accountSettings.js';

export function useAccountSettings(userId,open,tab='profile') {
  const owner=useMemo(()=>createAccountSettings({userId}),[userId]);
  const state=useSyncExternalStore(owner.subscribe,owner.snapshot,owner.snapshot);
  useEffect(()=>()=>owner.destroy(),[owner]);
  useEffect(()=>{if(userId&&open)owner.load();},[owner,userId,open]);
  useEffect(()=>{if(userId)owner.loadUnread();},[owner,userId]);
  useEffect(()=>{if(userId&&open){if(tab==='skywatch')owner.loadSubscriptions();if(tab==='notifications')owner.loadInbox(true);}},[owner,userId,open,tab]);
  return {state,owner};
}
