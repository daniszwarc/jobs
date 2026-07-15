from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
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
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

SYSTEM_PROMPT_TEMPLATE = """You are a CV tailoring assistant for Daniel Szwarc. Given a job description, analyze it and produce tailored CV content + cover letter using ONLY the master CV material below.

LANGUAGE RULE: Detect the language of the job description. Write ALL output fields (summary, project bullets, cover letter paragraphs, labels, skill values) in that same language. If the JD is in Spanish, everything is in Spanish. If in French, everything in French. If in English, everything in English. JSON keys always stay in English -- only the values change language. Daniel's name, company names, and tech stack terms (FastAPI, LangChain, pgvector, etc.) stay as-is regardless of language.

{cv_text}

Output ONLY valid JSON with no markdown, no backticks, no preamble. Schema:
{{
  "company": "company name from JD",
  "role_title": "adapted title line for the CV header (e.g. 'AI Solutions Engineer | Full-Stack Developer')",
  "summary": "adapted professional summary, pick or blend the right variant",
  "projects": [
    {{
      "name": "Project Name",
      "label": "| short label / context",
      "bullets": ["bullet 1", "bullet 2"]
    }}
  ],
  "experience": [
    {{
      "title": "Job Title",
      "company": "Company Name",
      "location": "City, Province",
      "dates": "2014 - Present",
      "type": "primary | consulting_intro | consulting_subrole",
      "bullets": ["bullet or intro line"]
    }}
  ],
  "skills": [
    {{ "label": "AI / ML", "value": "LangChain, LangGraph..." }}
  ],
  "cover_letter": {{
    "salutation": "Hi,",
    "para1": "opening -- why this role/company caught attention, no filler",
    "para2": "fit -- one concrete proof point: what was built, what wasn't, result",
    "para3": "why this company specifically, reference something real from JD",
    "para4": "brief confident close, no cliches"
  }},
  "brief": "2-3 sentences on what was emphasized, what was left out, and why"
}}"""


app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/app.css")
async def serve_css():
    return FileResponse("app.css", media_type="text/css")

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js", media_type="application/javascript")


@app.post("/api/generate")
async def generate(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    cv_text = body.get("cv_text", "").strip()
    jd = body.get("jd", "").strip()

    if not cv_text:
        raise HTTPException(status_code=400, detail="Missing cv_text")
    if not jd:
        raise HTTPException(status_code=400, detail="Missing jd")

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(cv_text=cv_text)

    payload = {
        "model": "qwen3.6",
        "max_tokens": 32000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Job description:\n\n{jd}"},
        ],
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
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
