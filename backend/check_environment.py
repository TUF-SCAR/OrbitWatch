import httpx
from os import getenv
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path, override=False)

NASA_API_KEY = getenv("NASA_API_KEY")
DONKI = "https://api.nasa.gov/DONKI/FLR"

if NASA_API_KEY is None or NASA_API_KEY == "":
    print("NASA API key is missing")
else:
    print("NASA API key loaded successfully")

    responce = httpx.get(
        url=DONKI,
        params={
            "api_key": NASA_API_KEY,
        },
    )

    print(responce.status_code)

    result = responce.json()
    print(type(result))
    print(len(result))
    print(result[0])
