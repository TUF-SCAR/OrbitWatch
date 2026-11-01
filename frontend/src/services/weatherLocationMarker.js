import {Cartesian3,Color} from 'cesium';

export function createWeatherLocationMarker(viewer) {
  let marker=null;
  return {
    update(selection) {
      if(!selection){if(marker)viewer.entities.remove(marker);marker=null;viewer.scene.requestRender();return;}
      const position=Cartesian3.fromDegrees(selection.longitude,selection.latitude,Math.max(-500,selection.height||0)+40);
      if(marker)marker.position=position;
      else marker=viewer.entities.add({id:'weather-location',position,properties:{weatherLocation:true},point:{pixelSize:9,color:Color.fromCssColorString('#89e6ef'),outlineColor:Color.fromCssColorString('#08232b'),outlineWidth:2,disableDepthTestDistance:0}});
      viewer.scene.requestRender();
    },
    destroy(){if(marker)viewer.entities.remove(marker);marker=null;},
  };
}
