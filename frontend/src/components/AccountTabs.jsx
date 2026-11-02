export default function AccountTabs({id,label,tabs,value,onChange}) {
  return <nav className="account-tabs" role="tablist" aria-label={label} onKeyDown={event=>{
    const index=tabs.findIndex(tab=>tab.id===value);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next===null)return;event.preventDefault();onChange(tabs[next].id);event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  }}>{tabs.map(({id:key,label:caption,icon:Icon})=><button key={key} id={`${id}-${key}-tab`} type="button" role="tab" aria-selected={value===key} aria-controls={`${id}-${key}-panel`} tabIndex={value===key?0:-1} onClick={()=>onChange(key)}>{Icon&&<Icon size={15} aria-hidden="true"/>}<span>{caption}</span></button>)}</nav>;
}
