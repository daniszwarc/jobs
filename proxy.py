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

SYSTEM_PROMPT_TEMPLATE = """You are a CV tailoring assistant. Given a master CV and a job description, produce a tailored CV and cover letter using ONLY the content from the master CV provided below. Do not invent experience, skills, or projects that are not in the CV.

CRITICAL LANGUAGE RULE: Detect the language of the job description. Write ALL generated text (summary, bullets, cover letter, headers, skill values) in that same language. Ignore the language of the master CV -- it is source material only. JSON keys always stay in English. Company names and tech terms (FastAPI, Docker, RAG, etc.) stay as-is.

MASTER CV:
{cv_text}

COVER LETTER TONE: {tone}

If tone is "formal":
- 4 structured paragraphs
- Para 1: why this role/company caught attention, no filler
- Para 2: one concrete proof point from the CV (specific project or result)
- Para 3: why this company specifically, reference something real from the JD
- Para 4: brief confident close, no cliches
- No em dashes, no flattery, no "I am passionate about"
- Total: 200-280 words

If tone is "conversational":
- Write like a real person introducing themselves, not a formal application letter
- Start with a personal greeting and brief self-introduction (name, background, current situation)
- Explain naturally why they are reaching out and what they are looking for (internship, job, collaboration)
- Mention any relevant constraint or context (duration, availability, location flexibility)
- Close warmly and briefly, offering to send more info if needed
- Total: 100-180 words, short paragraphs, direct and human

Output ONLY valid JSON with no markdown, no backticks, no preamble. Schema:
{{
  "candidate": {{
    "name": "Full name extracted from CV",
    "contact": "City | Phone | Email | LinkedIn | GitHub (only fields present in the CV, separated by pipe)"
  }},
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
    "salutation": "opening greeting appropriate for the tone and language",
    "para1": "see cover letter tone instructions below",
    "para2": "see cover letter tone instructions below",
    "para3": "see cover letter tone instructions below",
    "para4": "see cover letter tone instructions below"
  }},
  "headers": {{
    "summary": "Professional Summary",
    "projects": "Current AI Projects",
    "experience": "Professional Experience",
    "skills": "Technical Skills",
    "education": "Education",
    "certifications": "Certifications & Professional Development"
  }},
  "education": [
    {{
      "degree": "Degree name",
      "institution": "Institution name",
      "location": "City, Country",
      "dates": "2024 - Present",
      "note": "Optional dissertation or extra line (omit if not present)"
    }}
  ],
  "certifications": ["Certification name  |  Issuer"],
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
    tone = body.get("tone", "formal")

    if not cv_text:
        raise HTTPException(status_code=400, detail="Missing cv_text")
    if not jd:
        raise HTTPException(status_code=400, detail="Missing jd")

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(cv_text=cv_text, tone=tone)

    payload = {
        "model": "qwen3.6",
        "max_tokens": 32000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Job description (write all output in the language of this text):\n\n{jd}"},
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
