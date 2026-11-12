"""Explainable suitability screening, never a probability or brightness model."""
import math

def compass(azimuth):
    if azimuth is None or not math.isfinite(azimuth): return None
    return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][int((azimuth%360+11.25)/22.5)%16]

def equipment(kind,target):
    if kind=='satellite': return 'ISS can be bright to the naked eye; visibility still depends on conditions.' if target=='25544' else 'Brightness unverified. Optical aid may be required; geometry alone does not establish visibility.'
    if target in ('uranus','neptune'): return 'Telescope generally required; Uranus may be found with binoculars under excellent skies.'
    if target=='mercury': return 'Low twilight target; clear horizon needed. Never aim optical equipment at the Sun.'
    return 'Often observable without optical aid under suitable skies; binoculars or a telescope reveal more detail.'

def assessment(kind,target,geometry,weather):
    """Weights: elevation25, darkness20, illumination10, target5, weather40.

    Unknown satellite photometry leaves the target component unscored. Missing
    essential geometry or forecast produces a partial assessment, no fake total.
    Hard horizon/daylight/eclipse/poor-weather failures always prohibit delivery.
    """
    altitude=geometry.get('altitude_degrees');sun=geometry.get('sun_altitude_degrees')
    sunlit=geometry.get('sunlit')
    essential=all(isinstance(v,(int,float)) and math.isfinite(v) for v in (altitude,sun)) and (kind!='satellite' or isinstance(sunlit,bool))
    hard=bool(essential and altitude>=10 and sun<=(0 if target=='moon' else -6) and (kind!='satellite' or sunlit))
    available=weather.get('state')=='available'
    poor=available and (weather['cloud_cover_percent']>=80 or weather['precipitation_probability_percent']>=70 or weather['precipitation_mm']>=.2)
    parts=[{'label':'Elevation','points':round(25*max(0,min(1,(altitude-10)/50)),1) if essential else None,'maximum':25,'detail':f'{altitude:.1f}° above the geometric horizon' if essential else 'Unavailable'},
           {'label':'Sky darkness','points':round(20*max(0,min(1,((0 if target=='moon' else -6)-sun+3)/12)),1) if essential else None,'maximum':20,'detail':f'Sun altitude {sun:.1f}°' if essential else 'Unavailable'},
           {'label':'Illumination','points':10 if essential and (kind!='satellite' or sunlit) else 0 if essential else None,'maximum':10,'detail':('Satellite sunlit' if sunlit else 'Satellite eclipsed') if kind=='satellite' and essential else 'Apparent topocentric astronomical calculation' if essential else 'Unavailable'},
           {'label':'Target','points':None if kind=='satellite' and target!='25544' else 5,'maximum':5,'detail':equipment(kind,target)},
           {'label':'Forecast','points':round(40*max(0,1-weather['cloud_cover_percent']/100)*max(0,1-weather['precipitation_probability_percent']/100)*max(0,1-weather['precipitation_mm']/.2),1) if available else None,'maximum':40,'detail':f"Cloud {weather['cloud_cover_percent']}%; precipitation chance {weather['precipitation_probability_percent']}%; hourly precipitation {weather['precipitation_mm']} mm" if available else 'Unavailable or stale; never assumed clear'}]
    complete=essential and available and all(part['points'] is not None for part in parts)
    score=round(sum(part['points'] for part in parts)) if complete else None
    if complete and (not hard or poor): score=0
    return {'score':score,'state':'complete' if complete else 'partial','eligible_geometry':hard,'poor_weather':bool(poor),'components':parts,
            'meaning':'Suitability screening, not a percentage probability of seeing the object. No terrain, refraction, light-pollution or measured satellite brightness model.',
            'equipment':equipment(kind,target),'direction':compass(geometry.get('azimuth_degrees'))}
