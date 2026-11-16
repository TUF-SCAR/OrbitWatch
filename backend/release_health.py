"""Read-only release diagnostics; ingestion remains owned by the API scheduler."""
import argparse,json,time
from dotenv import load_dotenv
load_dotenv()
from services.infrared import infrared
from services.orbital_data_service import get_orbital_data_status
from services.weather_cache import WeatherDeferred
from io import BytesIO
from PIL import Image

def inspect(wait):
    deadline=time.monotonic()+wait
    while True:
        try:
            frames=[]
            for width in (1024,2048):
                start=time.perf_counter();meta=infrared.current(width);metadata_ms=(time.perf_counter()-start)*1000
                start=time.perf_counter();data,_=infrared.frame(meta['observation_time'],width);read_ms=(time.perf_counter()-start)*1000
                start=time.perf_counter()
                with Image.open(BytesIO(data)) as image:
                    image.load()
                    if image.size!=(width,width//2) or image.mode!='RGBA':raise ValueError('Invalid ready image')
                frames.append({'width':width,'height':width//2,'bytes':len(data),'version':meta['version'],'observation_time':meta['observation_time'],'stale':meta['stale'],'metadata_ms':round(metadata_ms,2),'read_ms':round(read_ms,2),'decode_ms':round((time.perf_counter()-start)*1000,2)})
            if frames[0]['observation_time']!=frames[1]['observation_time']:raise WeatherDeferred()
            print(json.dumps({'clouds':frames,'orbits':get_orbital_data_status()},indent=2));return
        except (WeatherDeferred,ValueError,OSError):
            if time.monotonic()>=deadline:raise RuntimeError('No valid prepared cloud pair before release deadline') from None
            time.sleep(5)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--wait',type=int,default=0);args=parser.parse_args();inspect(max(0,min(args.wait,600)))
