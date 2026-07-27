import uvicorn
from fastapi import FastAPI
from routes.satellites import router as satellite_router

app = FastAPI()
app.include_router(satellite_router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
