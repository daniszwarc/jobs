from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

NAN_API_KEY = os.getenv("NAN_API_KEY")
NAN_API_URL = "https://api.nan.builders/v1/chat/completions"

if not NAN_API_KEY:
    raise RuntimeError("NAN_API_KEY not set in .env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your domain in prod if desired
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


@app.get("/")
async def serve_index():
    return FileResponse("index.html")


@app.post("/api/generate")
async def generate(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages")
    if not messages:
        raise HTTPException(status_code=400, detail="Missing 'messages' field")

    payload = {
        "model": "qwen3.6",
        "max_tokens": 32000,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            resp = await client.post(
                NAN_API_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {NAN_API_KEY}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=e.response.text,
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=str(e))

    return JSONResponse(content=resp.json())
