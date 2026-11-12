// Synthetic QA only. Real components, no auth, provider, DB or push requests.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import NotificationCentre from '../src/components/NotificationCentre.jsx';
import ViewingDetails from '../src/components/ViewingDetails.jsx';
import MySkywatch from '../src/components/MySkywatch.jsx';
import AccountNotificationSettings from '../src/components/AccountNotificationSettings.jsx';
import './notificationsReview.css';
import '../src/components/AccountWorkspace.css';
import '../src/components/AccountNotificationSettings.css';
const response=await fetch('/@fs/C:/Code/OrbitWatch/.setup-cache/notification-visual-fixture.json');const details=await response.json();
const location={id:'00000000-0000-0000-0000-000000000001',name:details.location_name,...details.observer,version:1,is_default:true};
const initialPreferences={notifications_enabled:true,satellite_alerts:true,celestial_alerts:true,natural_event_alerts:true,advance_warning_minutes:30,event_radius_km:200,max_event_radius_km:2000,quiet_hours_enabled:false,quiet_timezone_mode:'default_location'};
export default function Review(){
  const [page,setPage]=useState('inbox'),[tab,setTab]=useState('celestial'),[preferences,setPreferences]=useState(initialPreferences),[subscriptions,setSubscriptions]=useState([{id:'qa-follow',kind:'celestial',target_id:'moon',target_name:'Moon'}]);
  const [inbox,setInbox]=useState(['advance','visible_now'].map((stage,i)=>({id:`qa-${i}`,kind:'celestial',target_id:'moon',title:stage==='advance'?'Moon may be visible in 30 minutes':'Moon may be visible now',message:'SYNTHETIC QA notification; no account or message is created.',alert_stage:stage,created_at:new Date().toISOString(),source_at:details.calculated_at,expires_at:details.end_utc,is_expired:false,location_name:location.name,location_id:location.id,viewing_details:{...details,stage},destination:{kind:'celestial',target_id:'moon'}})));
  const state={phase:'ready',locations:[location],preferences,preferenceDraft:preferences,busy:false,subscriptionPhase:'ready',subscriptions,alertBusy:null,inboxPhase:'ready',inbox,unreadCount:inbox.filter(item=>!item.read_at).length,inboxBusy:null,delivery:{scheduler_state:'not_operational',push_configured:false,devices:[],device_limit:5}};
  const owner={loadDelivery(){},loadInbox(){},markRead:async id=>setInbox(rows=>rows.map(item=>item.id===id?{...item,read_at:new Date().toISOString()}:item)),markAllRead:()=>setInbox(rows=>rows.map(item=>({...item,read_at:new Date().toISOString()}))),dismiss:id=>setInbox(rows=>rows.filter(item=>item.id!==id)),toggleTarget:(kind,target_id)=>setSubscriptions(rows=>rows.some(row=>row.kind===kind&&row.target_id===target_id)?rows.filter(row=>row.kind!==kind||row.target_id!==target_id):[...rows,{id:'qa-'+target_id,kind,target_id,target_name:target_id}]),changePreference:patch=>setPreferences(value=>({...value,...patch})),savePreferences(){},navigationNotice(){}};
  return <main><header><strong>ISOLATED QA · SYNTHETIC TIMING, GEOMETRY & FORECAST</strong><p>Real OrbitWatch components and scoring formula. No production account, provider or push calls.</p><nav>{['inbox','guide','targets','preferences'].map(id=><button type="button" key={id} onClick={()=>setPage(id)} aria-pressed={page===id}>{id}</button>)}</nav></header><div className="account-workspace">{page==='inbox'?<NotificationCentre account={{state,owner}}/>:page==='guide'?<ViewingDetails details={details}/>:page==='targets'?<MySkywatch account={{state,owner}} tab={tab} onTab={setTab}/>:<AccountNotificationSettings account={{state,owner}} section="preferences"/>}</div></main>;
}
createRoot(document.querySelector('#root')).render(<Review/>);
