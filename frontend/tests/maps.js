import {createNasaImageryService, GIBS_CAPABILITIES, parseGibsCapabilities} from "../src/services/nasaImagery.js";
const button=document.querySelector('button'),output=document.querySelector('output'),result=document.querySelector('pre');
button.addEventListener('click',async()=>{
  button.disabled=true;const reports={};
  try {
    output.textContent='Reading current NASA metadata';
    const response=await fetch(GIBS_CAPABILITIES);
    reports.http=response.status;const xml=await response.text();reports.bytes=xml.length;
    const metadata=parseGibsCapabilities(xml);reports.metadata=metadata;result.textContent=JSON.stringify(reports,null,2);
    const service=createNasaImageryService({fetchMetadata:async()=>metadata});
    for(const date of ['2024-06-01','2025-08-09','2030-01-01']) {
      output.textContent=`Checking ${date}`;
      const {provider,details}=await service.create(new Date(date),new AbortController().signal);
      const image=await provider.requestImage(0,0,0);
      document.querySelector('canvas').getContext('2d').drawImage(image,0,0,256,256);
      reports[date]={...details,width:image.width,height:image.height};result.textContent=JSON.stringify(reports,null,2);
    }
    output.textContent='NASA current metadata, historical tile and fixed reference checks passed';
  } catch(error) {reports.error={name:error.name,message:error.message};result.textContent=JSON.stringify(reports,null,2);output.textContent=`FAILED: ${error.message}`;}
  finally {button.disabled=false;}
});
