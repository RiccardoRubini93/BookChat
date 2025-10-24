import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import PyPDF2
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "BookChat API is running"}


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file and prepare it for chat."""
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
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")


@app.get("/api/pdf/info")
async def get_pdf_info():
    """Get information about the currently loaded PDF."""
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    
    return JSONResponse(content={
        "filename": current_pdf["filename"],
        "num_pages": current_pdf["num_pages"]
    })


@app.get("/api/pdf/file")
async def get_pdf_file():
    """Serve the currently loaded PDF file."""
    if not current_pdf["path"]:
        raise HTTPException(status_code=404, detail="No PDF loaded")
    
    from fastapi.responses import FileResponse
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
            max_tokens=500
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
            max_tokens=800
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
            max_tokens=500
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
