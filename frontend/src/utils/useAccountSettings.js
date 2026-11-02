import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createAccountSettings} from '../services/accountSettings.js';

export function useAccountSettings(userId,open,tab='profile') {
  const owner=useMemo(()=>createAccountSettings({userId}),[userId]);
  const state=useSyncExternalStore(owner.subscribe,owner.snapshot,owner.snapshot);
  useEffect(()=>()=>owner.destroy(),[owner]);
  useEffect(()=>{if(userId&&open)owner.load();},[owner,userId,open]);
  useEffect(()=>{if(userId)owner.loadUnread();},[owner,userId]);
  useEffect(()=>{if(userId&&open){if(tab==='skywatch')owner.loadSubscriptions();if(tab==='notifications')owner.loadInbox(true);}},[owner,userId,open,tab]);
  useEffect(()=>{if(userId&&open&&(tab==='notifications'||tab==='preferences'))owner.loadDelivery();},[owner,userId,open,tab]);
  useEffect(()=>{
    if(!userId)return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='hidden')return;
      if(open&&tab==='notifications')owner.loadInbox(true);else owner.loadUnread();
      if(open&&(tab==='notifications'||tab==='preferences'))owner.loadDelivery();
    },60000);
    return()=>window.clearInterval(timer);
  },[owner,userId,open,tab]);
  return {state,owner,userId};
}
