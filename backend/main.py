import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import PyPDF2
import json
import uuid
from datetime import datetime
from openai import OpenAI
from dotenv import load_dotenv
import base64
import io
from PIL import Image
import traceback

# Load environment variables
load_dotenv()

# Configurable token limits (can be set via environment variables)
# - OPENAI_MAX_TOKENS controls `max_tokens` for chat completions fallback and older chat calls
# - OPENAI_MAX_OUTPUT_TOKENS controls `max_output_tokens` for the Responses API
DEFAULT_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "2048"))
DEFAULT_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "2048"))

# Initialize FastAPI app
app = FastAPI(title="BookChat API", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Storage configuration
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
NOTES_DIR = UPLOAD_DIR / "notes"
NOTES_DIR.mkdir(exist_ok=True)

# Global storage for current PDF
current_pdf = {"path": None, "num_pages": 0, "filename": None}

# State file to persist PDF info across restarts
STATE_FILE = UPLOAD_DIR / ".current_pdf.txt"


def load_current_pdf_state():
    """Load the current PDF state from disk if it exists."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r') as f:
                filename = f.read().strip()
                if filename:
                    pdf_path = UPLOAD_DIR / filename
                    if pdf_path.exists():
                        with open(pdf_path, 'rb') as pdf_file:
                            pdf_reader = PyPDF2.PdfReader(pdf_file)
                            num_pages = len(pdf_reader.pages)
                        
                        current_pdf["path"] = str(pdf_path)
                        current_pdf["num_pages"] = num_pages
                        current_pdf["filename"] = filename
                        print(f"Restored PDF state: {filename} ({num_pages} pages)")
        except Exception as e:
            print(f"Error loading PDF state: {e}")


def save_current_pdf_state():
    """Save the current PDF filename to disk."""
    try:
        with open(STATE_FILE, 'w') as f:
            f.write(current_pdf["filename"] or "")
    except Exception as e:
        print(f"Error saving PDF state: {e}")


# Load PDF state on startup
load_current_pdf_state()


@app.delete("/api/docs")
async def delete_pdf(filename: str = Query(...)):
    """Delete a PDF file from uploads."""
    file_path = UPLOAD_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        file_path.unlink()
        # If deleted file is current, clear state
        if current_pdf["filename"] == filename:
            current_pdf["path"] = None
            current_pdf["num_pages"] = 0
            current_pdf["filename"] = None
            save_current_pdf_state()
        return {"message": "File deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")
@app.get("/api/docs")
async def list_uploaded_pdfs():
    """List all uploaded PDF files with metadata."""
    docs = []
    for file in UPLOAD_DIR.glob("*.pdf"):
        try:
            stat = file.stat()
            with open(file, 'rb') as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                num_pages = len(pdf_reader.pages)
            # compute chat metadata if present
            chat_file = NOTES_DIR / f"{file.name}.chat.json"
            chat_count = 0
            last_chat_at = None
            if chat_file.exists():
                try:
                    with open(chat_file, 'r') as cf:
                        chats = json.load(cf)
                    chat_count = len(chats)
                    # find latest timestamp among messages
                    try:
                        timestamps = [m.get('timestamp') for m in chats if m.get('timestamp')]
                        if timestamps:
                            last_chat_at = max(timestamps)
                    except Exception:
                        last_chat_at = None
                except Exception:
                    chat_count = 0

            docs.append({
                "filename": file.name,
                "num_pages": num_pages,
                "uploaded_at": stat.st_mtime,
                "chat_count": chat_count,
                "last_chat_at": last_chat_at,
            })
        except Exception:
            continue
    # Sort by upload time, newest first
    docs.sort(key=lambda d: d["uploaded_at"], reverse=True)
    return {"docs": docs}

class SummarizeRequest(BaseModel):
    page_number: int


class AnalyzeRequest(BaseModel):
    page_number: int
    question: str


class TextOperationRequest(BaseModel):
    operation: str  # 'summarize', 'rephrase', or 'explain'
    text: str


class MessageResponse(BaseModel):
    role: str
    content: str


def extract_text_from_page(pdf_path: str, page_number: int) -> str:
    """Extract text from a specific page of the PDF."""
    try:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            
            if page_number < 1 or page_number > len(pdf_reader.pages):
                raise ValueError(f"Page number {page_number} is out of range")
            
            page = pdf_reader.pages[page_number - 1]  # Convert to 0-indexed
            text = page.extract_text()
            
            return text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error extracting text: {str(e)}")


def notes_file_for(filename: str) -> Path:
    return NOTES_DIR / f"{filename}.notes.json"


def chats_file_for(filename: str) -> Path:
    """Return the path to the chat file for a given filename."""
    return NOTES_DIR / f"{filename}.chat.json"


@app.get("/api/notes")
async def get_notes(filename: str = Query(...)):
    """Return all notes for a given PDF filename as a mapping page -> note object."""
    file = notes_file_for(filename)
    if not file.exists():
        return JSONResponse(content={"notes": {}})
    try:
        import json
        with open(file, 'r') as f:
            data = json.load(f)
        return JSONResponse(content={"notes": data})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading notes: {str(e)}")


@app.get("/api/chats")
async def get_chats(filename: str = Query(...)):
    """Return the chat messages for a given PDF filename as an array of message objects."""
    file = chats_file_for(filename)
    if not file.exists():
        return JSONResponse(content={"messages": []})
    try:
        with open(file, 'r') as f:
            data = json.load(f)
        # ensure messages are sorted by timestamp
        try:
            data.sort(key=lambda m: m.get('timestamp', ''))
        except Exception:
            pass
        return JSONResponse(content={"messages": data})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading chats: {str(e)}")


@app.post("/api/notes")
async def save_note(
    filename: str = Form(...),
    page: int = Form(...),
    text: str = Form(''),
    x: float = Form(85.0),
    y: float = Form(10.0),
    widthPercent: Optional[float] = Form(None),
    heightPercent: Optional[float] = Form(None),
):
    """Save a single page note for filename. Overwrites the page entry.
    Accepts optional widthPercent/heightPercent to persist editor sizing.
    """
    file = notes_file_for(filename)
    try:
        import json
        notes = {}
        if file.exists():
            with open(file, 'r') as f:
                notes = json.load(f)
        # build note object and include optional sizing if provided
        note_obj = {"text": text, "x": float(x), "y": float(y)}
        if widthPercent is not None:
            try:
                note_obj["widthPercent"] = float(widthPercent)
            except Exception:
                pass
        if heightPercent is not None:
            try:
                note_obj["heightPercent"] = float(heightPercent)
            except Exception:
                pass

        notes[str(page)] = note_obj
        with open(file, 'w') as f:
            json.dump(notes, f)
        return JSONResponse(content={"ok": True, "note": notes[str(page)]})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving note: {str(e)}")


@app.post("/api/chats")
async def append_chat_message(
    filename: str = Form(...),
    role: str = Form(...),
    content: str = Form(...),
    highlightId: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
):
    """Append a single chat message to the chat history for `filename`.
    Messages are stored as a JSON array in `uploads/notes/{filename}.chat.json`.
    """
    file = chats_file_for(filename)
    try:
        messages = []
        if file.exists():
            with open(file, 'r') as f:
                messages = json.load(f)

        # build message with id and timestamp
        now_iso = datetime.utcnow().isoformat() + 'Z'
        msg = {
            "id": str(uuid.uuid4()),
            "role": role,
            "content": content,
            "timestamp": now_iso,
        }
        if highlightId is not None:
            msg["highlightId"] = highlightId
        if client_id is not None:
            # echo back client-provided id so clients can match optimistic messages
            msg["client_id"] = client_id

        messages.append(msg)
        with open(file, 'w') as f:
            json.dump(messages, f)

        return JSONResponse(content={"ok": True, "message": msg})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error appending chat message: {str(e)}")


@app.delete("/api/notes")
async def delete_note(filename: str = Query(...), page: int = Query(...)):
    """Delete a note for a given page and filename."""
    file = notes_file_for(filename)
    if not file.exists():
        return JSONResponse(content={"ok": True})
    try:
        import json
        with open(file, 'r') as f:
            notes = json.load(f)
        notes.pop(str(page), None)
        with open(file, 'w') as f:
            json.dump(notes, f)
        return JSONResponse(content={"ok": True})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting note: {str(e)}")


@app.delete("/api/chats")
async def delete_chats(filename: str = Query(...)):
    """Delete the chat history file for a specific filename (clears chat)."""
    file = chats_file_for(filename)
    if not file.exists():
        return JSONResponse(content={"ok": True})
    try:
        file.unlink()
        return JSONResponse(content={"ok": True})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting chats: {str(e)}")


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "BookChat API is running"}


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file and prepare it for chat."""
    try:
        print(f"[upload_pdf] incoming upload filename={file.filename} content_type={file.content_type}")
    except Exception:
        pass
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Read PDF to get page count
        with open(file_path, 'rb') as pdf_file:
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            num_pages = len(pdf_reader.pages)
        
        # Store current PDF info
        current_pdf["path"] = str(file_path)
        current_pdf["num_pages"] = num_pages
        current_pdf["filename"] = file.filename
        
        # Save state to disk for persistence across restarts
        save_current_pdf_state()
        
        return JSONResponse(content={
            "message": "PDF uploaded successfully",
            "filename": file.filename,
            "num_pages": num_pages
        })
    
    except Exception as e:
        # Log full traceback to help debugging inside containers
        try:
            tb = traceback.format_exc()
            print(f"[upload_pdf] Exception: {e}\n{tb}")
        except Exception:
            print(f"[upload_pdf] Exception: {e}")
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")


@app.post("/api/visual/analyze")
async def visual_analyze(
    file: UploadFile = File(...),
    selection_type: str = Form(...),
    question: Optional[str] = Form(None),
    filename: Optional[str] = Form(None),
):
    """Analyze an uploaded image selection using a multimodal LLM.

    Expects multipart/form-data with:
    - file: image/png or image/jpeg
    - selection_type: 'image' | 'table' | 'graph'
    - question: optional question text
    - filename: optional PDF filename to persist chat message against
    """
    allowed = {"image", "table", "graph"}
    if selection_type not in allowed:
        raise HTTPException(status_code=400, detail=f"selection_type must be one of {allowed}")

    # read file bytes
    try:
        data = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")

    # Optionally resize large images to prevent huge uploads to the LLM
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert('RGB')
        max_dim = 2048
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim))
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        img_bytes = buf.getvalue()
    except Exception:
        # fallback to raw bytes
        img_bytes = data

    b64 = base64.b64encode(img_bytes).decode('ascii')

    # Compose a prompt for the multimodal model
    q = question or f"Please describe the {selection_type} and provide key observations."
    prompt = (
        f"You are a helpful assistant. Analyze the provided {selection_type}.\n"
        f"Context: filename={filename or 'unknown'}.\n"
        f"Question: {q}\n"
        "Provide a concise answer for a human-readable chat message. If you can extract structured data (CSV for tables, axes for graphs), include it in a JSON block labelled `structured`."
    )

    model = os.getenv('OPENAI_MULTIMODAL_MODEL') or os.getenv('OPENAI_VISION_MODEL') or 'gpt-4o-mini-vision'

    try:
        # Debug: print model/payload sizes
        try:
            print(f"[visual_analyze] calling multimodal model={model} prompt_len={len(prompt)} image_b64_len={len(b64)}")
        except Exception:
            pass

        # Try to call the multimodal responses endpoint with an image payload
        try:
            # The Responses API expects images via an image_url field. Use a data URL with the base64 payload.
            image_data_url = f"data:image/png;base64,{b64}"
            resp = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": image_data_url}
                        ]
                    }
                ],
                # Allow configuring the maximum output tokens for the Responses API
                max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
            )
        except Exception as e_inner:
            # Print full traceback to logs for debugging
            tb = traceback.format_exc()
            print(f"[visual_analyze] multimodal call exception: {e_inner}\n{tb}")

            # If the OpenAI client doesn't support the newer 'responses' API, offer a fallback or a clear error.
            msg_text = str(e_inner)
            if isinstance(e_inner, AttributeError) or "has no attribute 'responses'" in msg_text:
                # Optionally allow a fallback to the older chat completions API if configured
                if os.getenv('OPENAI_USE_CHAT_COMPLETIONS', '').lower() in ('1', 'true', 'yes'):
                    try:
                        fallback_model = os.getenv('OPENAI_CHAT_MODEL') or 'gpt-4o-mini'
                        print(f"[visual_analyze] falling back to chat.completions with model={fallback_model}")
                        chat_resp = client.chat.completions.create(
                            model=fallback_model,
                            messages=[
                                {"role": "system", "content": "You are a helpful assistant that analyzes image descriptions. The actual image bytes are not available to this model; the caller has provided an accompanying textual description that should be used as context."},
                                {"role": "user", "content": prompt}
                            ],
                                        temperature=0.7,
                                        max_tokens=DEFAULT_MAX_TOKENS
                        )
                        # extract text from chat response
                        try:
                            assistant_text = chat_resp.choices[0].message.content
                        except Exception:
                            assistant_text = str(chat_resp)
                    except Exception as e_fb:
                        tb2 = traceback.format_exc()
                        print(f"[visual_analyze] fallback chat.completions failed: {e_fb}\n{tb2}")
                        raise HTTPException(status_code=500, detail=f"Multimodal 'responses' API not available and chat fallback failed: {str(e_fb)}")
                else:
                    # Advise the developer to upgrade the OpenAI SDK to one that supports the responses API.
                    hint = (
                        "Backend OpenAI client does not support the 'responses' API. "
                        "Upgrade the 'openai' Python package to a version that provides the Responses API (e.g. `pip install --upgrade openai`) "
                        "and restart the backend, or set environment variable OPENAI_USE_CHAT_COMPLETIONS=1 to use the older chat completions API as a fallback (note: chat completions cannot accept image bytes)."
                    )
                    print(f"[visual_analyze] {hint}")
                    raise HTTPException(status_code=501, detail=hint)
            else:
                # Generic error
                raise HTTPException(status_code=500, detail=f"Failed to call multimodal model: {str(e_inner)}")
    except Exception as e:
        # If calling the multimodal model fails, return an error to the client with details
        print(f"[visual_analyze] multimodal call failed (outer): {e}")
        tb = traceback.format_exc()
        print(tb)
        raise HTTPException(status_code=500, detail=f"Failed to call multimodal model: {str(e)}")

    # Try to extract assistant text from the response
    assistant_text = None
    try:
        # prefer the convenient attribute if present
        assistant_text = getattr(resp, 'output_text', None)
        if not assistant_text:
            # traverse the structured output
            out = getattr(resp, 'output', None) or resp
            # debug print of raw response (trimmed)
            try:
                print(f"[visual_analyze] raw response repr: {repr(out)[:1000]}")
            except Exception:
                pass
            if isinstance(out, list):
                for item in out:
                    contents = item.get('content') if isinstance(item, dict) else getattr(item, 'content', None)
                    if not contents:
                        continue
                    for c in contents:
                        if isinstance(c, dict) and c.get('type') == 'output_text' and c.get('text'):
                            assistant_text = c.get('text')
                            break
                    if assistant_text:
                        break
    except Exception:
        assistant_text = None

    if not assistant_text:
        # As a fallback, stringify the response
        try:
            assistant_text = str(resp)
        except Exception:
            assistant_text = 'Received empty response from model.'

    # Debug log
    try:
        print(f"[visual_analyze] selection_type={selection_type} filename={filename} assistant_text_preview={assistant_text[:200]}")
    except Exception:
        pass

    # Persist assistant message to chat file if filename provided
    persisted_msg = None
    if filename:
        try:
            # Build message object
            now_iso = datetime.utcnow().isoformat() + 'Z'
            msg = {
                "id": str(uuid.uuid4()),
                "role": 'assistant',
                "content": assistant_text,
                "timestamp": now_iso,
            }
            chat_file = chats_file_for(filename)
            messages = []
            if chat_file.exists():
                with open(chat_file, 'r') as f:
                    messages = json.load(f)
            messages.append(msg)
            with open(chat_file, 'w') as f:
                json.dump(messages, f)
            persisted_msg = msg
            print(f"[visual_analyze] persisted assistant message for {filename}, id={msg['id']}")
        except Exception as e:
            print(f"[visual_analyze] failed to persist assistant message: {e}")
            # don't fail the whole request if persisting chat fails
            persisted_msg = None

    # Return assistant text and optional persisted message
    return JSONResponse(content={
        "role": "assistant",
        "content": assistant_text,
        "message": persisted_msg,
        "metadata": {"model": model}
    })


@app.get("/api/pdf/info")

@app.get("/api/pdf/info")
async def get_pdf_info(filename: Optional[str] = Query(None)):
    """Get information about a specific PDF, or the currently loaded one if not specified."""
    pdf_path = None
    pdf_filename = None
    num_pages = 0
    if filename:
        file_path = UPLOAD_DIR / filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="PDF not found")
        pdf_path = str(file_path)
        pdf_filename = filename
        with open(file_path, 'rb') as pdf_file:
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            num_pages = len(pdf_reader.pages)
    else:
        if not current_pdf["path"]:
            raise HTTPException(status_code=404, detail="No PDF loaded")
        pdf_path = current_pdf["path"]
        pdf_filename = current_pdf["filename"]
        num_pages = current_pdf["num_pages"]
    return JSONResponse(content={
        "filename": pdf_filename,
        "num_pages": num_pages
    })


@app.get("/api/pdf/file")
@app.get("/api/pdf/file")
async def get_pdf_file(filename: Optional[str] = Query(None)):
    """Serve a specific PDF file, or the currently loaded one if not specified."""
    from fastapi.responses import FileResponse
    if filename:
        file_path = UPLOAD_DIR / filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="PDF not found")
        return FileResponse(
            str(file_path),
            media_type="application/pdf",
            filename=filename
        )
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    return FileResponse(
        current_pdf["path"],
        media_type="application/pdf",
        filename=current_pdf["filename"]
    )


@app.get("/api/page/{page_number}/text")
async def get_page_text(page_number: int):
    """Get the text content of a specific page."""
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    
    try:
        text = extract_text_from_page(current_pdf["path"], page_number)
        return JSONResponse(content={
            "page_number": page_number,
            "text": text
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving page: {str(e)}")


@app.post("/api/summarize")
async def summarize_page(request: SummarizeRequest):
    """Summarize the content of a specific page using OpenAI."""
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    
    try:
        # Extract text from the page
        page_text = extract_text_from_page(current_pdf["path"], request.page_number)
        
        if not page_text.strip():
            return JSONResponse(content={
                "role": "assistant",
                "content": "This page appears to be empty or contains no extractable text."
            })
        
        # Call OpenAI API to summarize
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that provides clear and concise summaries of text content. Focus on the main ideas and key points. Format your response using markdown for better readability. Use bullet points, headings, bold text, and italic text where appropriate. If there are mathematical formulas, use LaTeX notation enclosed in $ for inline math or $$ for display math."
                },
                {
                    "role": "user",
                    "content": f"Please summarize the following text from page {request.page_number}:\n\n{page_text}"
                }
            ],
            temperature=0.7,
            max_tokens=DEFAULT_MAX_TOKENS
        )
        
        summary = response.choices[0].message.content
        
        return JSONResponse(content={
            "role": "assistant",
            "content": summary
        })
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")


@app.post("/api/analyze")
async def analyze_page(request: AnalyzeRequest):
    """Analyze the content of a specific page based on user's question using OpenAI."""
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    
    try:
        # Extract text from the page
        page_text = extract_text_from_page(current_pdf["path"], request.page_number)
        
        if not page_text.strip():
            return JSONResponse(content={
                "role": "assistant",
                "content": "This page appears to be empty or contains no extractable text."
            })
        
        # Call OpenAI API to analyze
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that provides insightful analysis and reflections on text content. Provide thoughtful, detailed responses to user questions about the text. Format your response using markdown for better readability. Use headings, bullet points, bold/italic text, and code blocks where appropriate. If there are mathematical formulas, use LaTeX notation enclosed in $ for inline math or $$ for display math."
                },
                {
                    "role": "user",
                    "content": f"Context from page {request.page_number}:\n\n{page_text}\n\nUser question: {request.question}"
                }
            ],
            temperature=0.7,
            max_tokens=DEFAULT_MAX_TOKENS
        )
        
        analysis = response.choices[0].message.content
        
        return JSONResponse(content={
            "role": "assistant",
            "content": analysis
        })
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating analysis: {str(e)}")


@app.post("/api/text-operation")
async def text_operation(request: TextOperationRequest):
    """Perform an operation (summarize, rephrase, explain) on selected text using OpenAI."""
    try:
        if not request.text.strip():
            return JSONResponse(content={
                "role": "assistant",
                "content": "No text provided."
            })
        
        # Define system prompts for each operation
        system_prompts = {
            "summarize": "You are a helpful assistant that provides clear and concise summaries. Focus on the main points and key ideas. Format your response using markdown with bullet points, bold text, and headings where appropriate. Use LaTeX notation ($ for inline, $$ for display) for any mathematical formulas.",
            "rephrase": "You are a helpful assistant that rephrases text in a clearer, more accessible way while maintaining the original meaning. Make it easier to understand. Format your response using markdown for better readability. Use LaTeX notation ($ for inline, $$ for display) for any mathematical formulas.",
            "explain": "You are a helpful assistant that explains complex concepts in simple terms. Break down difficult ideas and provide context and examples when helpful. Format your response using markdown with bullet points, numbered lists, and emphasis where appropriate. Use LaTeX notation ($ for inline, $$ for display) for any mathematical formulas."
        }
        
        user_prompts = {
            "summarize": f"Please provide a concise summary of the following text:\n\n{request.text}",
            "rephrase": f"Please rephrase the following text in a clearer, more accessible way:\n\n{request.text}",
            "explain": f"Please explain the following text in simple terms:\n\n{request.text}"
        }
        
        operation = request.operation.lower()
        if operation not in system_prompts:
            raise HTTPException(status_code=400, detail=f"Invalid operation: {operation}")
        
        # Call OpenAI API
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_prompts[operation]
                },
                {
                    "role": "user",
                    "content": user_prompts[operation]
                }
            ],
            temperature=0.7,
            max_tokens=DEFAULT_MAX_TOKENS
        )
        
        result = response.choices[0].message.content
        
        return JSONResponse(content={
            "role": "assistant",
            "content": result,
            "operation": operation
        })
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error performing text operation: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
