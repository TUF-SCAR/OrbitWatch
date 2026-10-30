import {createEarthMapFactories} from "../src/services/earthMapProviders.js";
const button=document.querySelector('button'),output=document.querySelector('output'),result=document.querySelector('pre');
button.addEventListener('click',async()=>{
  button.disabled=true;const reports={};
  try {
    const factories=createEarthMapFactories();
    for(const map of ['esri','local-reference']) {
      output.textContent=`Checking ${map} reference imagery`;
      const provider=await factories[map]();
      const image=await provider.requestImage(0,0,0);
      document.querySelector('canvas').getContext('2d').drawImage(image,0,0,256,256);
      reports[map]={credit:provider.credit.html,width:image.width,height:image.height};result.textContent=JSON.stringify(reports,null,2);
    }
    output.textContent='Esri and local static reference checks passed';
  } catch(error) {reports.error={name:error.name,message:error.message};result.textContent=JSON.stringify(reports,null,2);output.textContent=`FAILED: ${error.message}`;}
  finally {button.disabled=false;}
});
