export const COUNTRY_TO_STARTUP_REGION = {"AE":"asia","AF":"asia","AG":"north-america","AI":"north-america","AL":"europe","AM":"asia","AO":"africa","AQ":"antarctica","AR":"south-america","AS":"oceania","AT":"europe","AU":"oceania","AW":"north-america","AZ":"asia","BA":"europe","BB":"north-america","BD":"asia","BE":"europe","BF":"africa","BG":"europe","BH":"asia","BI":"africa","BJ":"africa","BM":"north-america","BN":"asia","BO":"south-america","BR":"south-america","BS":"north-america","BT":"asia","BV":"antarctica","BW":"africa","BY":"europe","BZ":"north-america","CA":"north-america","CC":"oceania","CD":"africa","CF":"africa","CG":"africa","CH":"europe","CI":"africa","CK":"oceania","CL":"south-america","CM":"africa","CN":"asia","CO":"south-america","CR":"north-america","CU":"north-america","CV":"africa","CX":"oceania","CY":"europe","CZ":"europe","DE":"europe","DJ":"africa","DK":"europe","DM":"north-america","DO":"north-america","DZ":"africa","EC":"south-america","EE":"europe","EG":"africa","EH":"africa","ER":"africa","ES":"europe","ET":"africa","FI":"europe","FJ":"oceania","FK":"south-america","FM":"oceania","FO":"europe","FR":"europe","GA":"africa","GB":"europe","GD":"north-america","GE":"asia","GF":"south-america","GG":"europe","GH":"africa","GI":"europe","GL":"north-america","GM":"africa","GN":"africa","GP":"north-america","GQ":"africa","GR":"europe","GS":"antarctica","GT":"north-america","GU":"oceania","GW":"africa","GY":"south-america","HK":"asia","HM":"antarctica","HN":"north-america","HR":"europe","HT":"north-america","HU":"europe","ID":"asia","IE":"europe","IL":"asia","IM":"europe","IN":"india","IO":"africa","IQ":"asia","IR":"asia","IS":"europe","IT":"europe","JE":"europe","JM":"north-america","JO":"asia","JP":"asia","KE":"africa","KG":"asia","KH":"asia","KI":"oceania","KM":"africa","KN":"north-america","KP":"asia","KR":"asia","KW":"asia","KY":"north-america","KZ":"asia","LA":"asia","LB":"asia","LC":"north-america","LI":"europe","LK":"asia","LR":"africa","LS":"africa","LT":"europe","LU":"europe","LV":"europe","LY":"africa","MA":"africa","MC":"europe","MD":"europe","MG":"africa","MH":"oceania","MK":"europe","ML":"africa","MN":"asia","MO":"asia","MP":"oceania","MQ":"north-america","MR":"africa","MS":"north-america","MT":"europe","MU":"africa","MV":"asia","MW":"africa","MX":"north-america","MY":"asia","MZ":"africa","NA":"africa","NC":"oceania","NE":"africa","NF":"oceania","NG":"africa","NI":"north-america","NL":"europe","NO":"europe","NP":"asia","NR":"oceania","NU":"oceania","NZ":"oceania","OM":"asia","PA":"north-america","PE":"south-america","PF":"oceania","PG":"oceania","PH":"asia","PK":"asia","PL":"europe","PM":"north-america","PN":"oceania","PR":"north-america","PT":"europe","PW":"oceania","PY":"south-america","QA":"asia","RE":"africa","RO":"europe","RS":"europe","RU":"europe","RW":"africa","SA":"asia","SB":"oceania","SC":"africa","SD":"africa","SE":"europe","SG":"asia","SH":"africa","SI":"europe","SJ":"europe","SK":"europe","SL":"africa","SM":"europe","SN":"africa","SO":"africa","SR":"south-america","SS":"africa","ST":"africa","SV":"north-america","SY":"asia","SZ":"africa","TD":"africa","TF":"antarctica","TG":"africa","TH":"asia","TJ":"asia","TK":"oceania","TL":"asia","TM":"asia","TN":"africa","TO":"oceania","TR":"asia","TT":"north-america","TV":"oceania","TW":"asia","TZ":"africa","UA":"europe","UG":"africa","US":"north-america","UY":"south-america","UZ":"asia","VC":"north-america","VE":"south-america","VN":"asia","VU":"oceania","WF":"oceania","WS":"oceania","YE":"asia","YT":"africa","ZA":"africa","ZM":"africa","ZW":"africa"};

export const STARTUP_REGIONS = {
  india: {
    id: "india",
    label: "India",
    west: 67.5,
    south: 5.5,
    east: 98.5,
    north: 37.8,
  },
  asia: {
    id: "asia",
    label: "Asia",
    west: 25,
    south: -10,
    east: 180,
    north: 80,
  },
  africa: {
    id: "africa",
    label: "Africa",
    west: -20,
    south: -38,
    east: 55,
    north: 38,
  },
  "north-america": {
    id: "north-america",
    label: "North America",
    west: -170,
    south: 5,
    east: -50,
    north: 84,
  },
  "south-america": {
    id: "south-america",
    label: "South America",
    west: -90,
    south: -58,
    east: -30,
    north: 15,
  },
  antarctica: {
    id: "antarctica",
    label: "Antarctica",
    west: -180,
    south: -90,
    east: 180,
    north: -60,
  },
  europe: {
    id: "europe",
    label: "Europe",
    west: -25,
    south: 34,
    east: 45,
    north: 72,
  },
  oceania: {
    id: "oceania",
    label: "Australia / Oceania",
    west: 108,
    south: -50,
    east: 180,
    north: 12,
  },
};

export const DEFAULT_STARTUP_REGION = STARTUP_REGIONS.india;

export function startupRegionFromCountryCode(code) {
  const normalized = String(code || "").trim().toUpperCase();

  if (normalized === "IN") {
    return STARTUP_REGIONS.india;
  }

  const regionId = COUNTRY_TO_STARTUP_REGION[normalized];
  return STARTUP_REGIONS[regionId] || DEFAULT_STARTUP_REGION;
}
