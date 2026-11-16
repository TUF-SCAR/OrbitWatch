import {useEffect,useRef,useState} from 'react';
import {Search,SlidersHorizontal,X} from 'lucide-react';
import WorkspaceDialog from './WorkspaceDialog.jsx';

export default function MobileCatalog({open,onClose,label,title,count,query,onQuery,filters,filterCount,onApply,onClear,children,footer,bulk,dialog,searchCycle=0}){
 const [searching,setSearching]=useState(false),[filtering,setFiltering]=useState(false);
 const search=useRef(null),list=useRef(null),scroll=useRef(0);
 const previousSearch=useRef(searchCycle);
 useEffect(()=>{if(searchCycle!==previousSearch.current){previousSearch.current=searchCycle;const timer=setTimeout(()=>setSearching(true),0);return()=>clearTimeout(timer);}},[searchCycle]);
 useEffect(()=>{if(open&&list.current)list.current.scrollTop=scroll.current;},[open]);
 useEffect(()=>{if(open&&searching)search.current?.focus();},[searching,open]);
 useEffect(()=>{if(!open){const timer=setTimeout(()=>setSearching(false),0);return()=>clearTimeout(timer);}},[open]);
 if(!open)return null;
 return <WorkspaceDialog onClose={onClose} className="hud-panel mobile-catalog" aria-label={label}>
  <header><div><small>{count} OBJECTS</small><h2>{title}</h2></div><button type="button" aria-label={`Close ${label}`} onClick={onClose}><X size={20}/></button></header>
  <div className="mobile-catalog__tools"><button type="button" aria-label="Search objects" aria-expanded={searching} onClick={()=>setSearching(v=>!v)}><Search size={18}/> Search</button><button type="button" aria-expanded={filtering} onClick={()=>setFiltering(v=>!v)}><SlidersHorizontal size={18}/> Filters{filterCount?` · ${filterCount}`:''}</button>{query&&<button type="button" onClick={()=>onQuery('')}>Clear query</button>}</div>
  {searching&&<label className="mobile-catalog__search"><span className="sr-only">Search objects</span><input ref={search} type="search" value={query} placeholder="Name or NORAD…" onChange={e=>onQuery(e.target.value)}/><button type="button" aria-label="Done searching" onClick={()=>{search.current?.blur();setSearching(false);}}>Done</button></label>}
  {filtering&&<section className="mobile-catalog__filters" aria-label="Catalog filters">{filters}<div><button type="button" onClick={()=>{onClear();setFiltering(false);}}>Clear filters</button><button type="button" onClick={()=>{onApply();setFiltering(false);}}>Apply filters</button></div></section>}
  {bulk}
  <div className="mobile-catalog__results" ref={list} onScroll={e=>{scroll.current=e.currentTarget.scrollTop;}}>{children}</div>
  <footer>{footer}</footer>{dialog}
 </WorkspaceDialog>;
}
