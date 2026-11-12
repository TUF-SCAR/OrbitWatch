import NotificationDelivery from './NotificationDelivery.jsx';
import {useState} from 'react';
import ViewingDetails from './ViewingDetails.jsx';
import {Activity,ArrowUpRight,Bell,CheckCheck,Clock3,Moon,RefreshCcw,Satellite,X} from 'lucide-react';

const TYPES={satellite:{label:'Satellite opportunity',icon:Satellite},celestial:{label:'Skywatch opportunity',icon:Moon},event:{label:'Natural-event update',icon:Activity}};
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Time unavailable';

export default function NotificationCentre({account,onOpen}) {
  const [detailId,setDetailId]=useState(null);
  const {state,owner}=account,loading=state.inboxPhase==='loading',busy=Boolean(state.inboxBusy);
  const selected=state.activeNotice||state.inbox.find(item=>item.id===detailId);
  if(selected?.viewing_details)return <div className="notification-centre"><button type="button" onClick={()=>{setDetailId(null);owner.closeNotice?.();}}>← Back to notifications</button><ViewingDetails details={selected.viewing_details} expired={selected.is_expired}/><button type="button" onClick={()=>onOpen?.(selected.destination)}>Open target on globe</button></div>;
  return <div className="notification-centre">
    <div className="account-feature-intro"><Bell size={22}/><div><strong>Notification centre</strong><p>Your personal observation updates, grounded in real sources.</p></div></div>
    <NotificationDelivery account={account}/>
    <div className="inbox-toolbar"><span>{state.unreadCount===null?'Inbox':`${state.unreadCount} unread`}</span><div><button type="button" aria-label="Refresh notifications" disabled={loading||busy} onClick={()=>owner.loadInbox(true)}><RefreshCcw size={14}/></button><button type="button" disabled={loading||busy||!state.unreadCount} onClick={()=>owner.markAllRead()}><CheckCheck size={14}/> Mark all read</button></div></div>
    {state.inboxError&&<p role="alert" className="account-inline-error">{state.inboxError}<button type="button" disabled={loading||busy} onClick={()=>owner.loadInbox(true)}>Retry inbox</button></p>}
    {state.navigationNotice&&<p role="status" className="account-inline-error">{state.navigationNotice}</p>}
    {loading&&<p role="status" className="account-muted">Loading your notifications…</p>}
    {!loading&&state.inboxPhase==='ready'&&!state.inbox.length&&<div className="inbox-empty"><span className="inbox-empty-orbit"><Bell size={30}/></span><h3>A clear sky ahead</h3><p>No notifications yet. Your watchlist is ready. Eligible updates appear when the notification worker runs.</p><small>Only genuine eligible updates will appear here. No activity is simulated.</small></div>}
    <ul className="inbox-list">{state.inbox.map(item=>{const spec=TYPES[item.kind]||TYPES.event,Icon=spec.icon;return <li key={item.id} className={`inbox-card is-${item.kind} ${item.read_at?'is-read':'is-unread'} ${item.is_expired?'is-expired':''}`}>
      <div className="inbox-card-meta"><span><Icon size={14}/>{spec.label}</span><span>{item.is_expired?<><Clock3 size={12}/> Expired</>:!item.read_at?'Unread':'Read'}</span></div>
      <h3>{item.title}</h3>{item.alert_stage&&item.kind!=='event'&&<small>{item.alert_stage==='visible_now'?'Visible Now · independently rechecked':'Advance warning'}</small>}<p>{item.message}</p>{item.location_name&&<small>For {item.location_name}{!item.location_id?' · location no longer saved':''}</small>}
      <time dateTime={item.created_at}>{time(item.created_at)}</time><details><summary>Source & timing</summary><small>Source / forecast timestamp: {time(item.source_at)}{item.expires_at&&<><br/>Opportunity / event expiry: {time(item.expires_at)}</>}</small>{item.source_url&&<a href={item.source_url} target="_blank" rel="noopener noreferrer">Official source report</a>}{item.delivery_state&&<small>Delivery: {item.delivery_state.replaceAll('_',' ')} · provider acceptance does not prove display</small>}</details>
      <div className="inbox-card-actions"><button type="button" disabled={busy||loading} onClick={async()=>{if(!item.read_at)await owner.markRead(item.id);if(item.viewing_details)setDetailId(item.id);else onOpen?.(item.destination);}}><ArrowUpRight size={13}/> {item.viewing_details?'Viewing details':'Open target'}</button>{!item.read_at&&<button type="button" disabled={busy||loading} onClick={()=>owner.markRead(item.id)}>Mark read</button>}<button type="button" disabled={busy||loading} aria-label={`Dismiss ${item.title}`} onClick={()=>owner.dismiss(item.id)}><X size={13}/> Dismiss</button></div>
    </li>;})}</ul>
    {state.inboxCursor&&<button className="inbox-more" type="button" disabled={loading||busy} onClick={()=>owner.loadInbox(false,true)}>Load older notifications</button>}
    <p className="account-muted">Messages are retained for 30 days, up to the newest 200 per account. Expired opportunities remain clearly marked.</p>
  </div>;
}
