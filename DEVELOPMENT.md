# Development Guide

## 🛠️ Setting Up Development Environment

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)
- Git

## 📁 Repository Structure Explained

### Backend (`/backend`)

```python
# main.py - Core API application
# Key components:
# - FastAPI app with CORS middleware
# - PDF text extraction using PyPDF2
# - OpenAI integration for chat
# - File upload handling
# - Session management for current PDF
```

**API Endpoints:**
- `POST /api/upload` - Upload PDF file
- `GET /api/pdf/info` - Get current PDF metadata
- `GET /api/page/{page_number}/text` - Extract text from page
- `POST /api/summarize` - Generate page summary
- `POST /api/analyze` - Answer questions about page

### Frontend (`/frontend/src`)

**Main Components:**

1. **App.jsx** - Root component, manages state
   - PDF file state
   - Current page state
   - Routing between upload and main view

2. **FileUpload.jsx** - PDF upload interface
   - File selection
   - Upload to backend
   - Error handling

3. **PDFViewer.jsx** - PDF display
   - react-pdf integration
   - Page navigation
   - Responsive rendering

4. **ChatPanel.jsx** - Chat interface
   - Message display
   - Summarize button
   - Question input
   - API communication

## 🔄 Development Workflow

### Local Development (Recommended)

**Terminal 1 - Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=your_key
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
# Access at http://localhost:3000
```

### Docker Development

```bash
# Build and run
docker-compose up --build

# Rebuild specific service
docker-compose build backend
docker-compose up backend

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 🧪 Testing API Endpoints

### Using curl

```bash
# Health check
curl http://localhost:8000/

# Upload PDF
curl -X POST http://localhost:8000/api/upload \
  -F "file=@/path/to/your/book.pdf"

# Get PDF info
curl http://localhost:8000/api/pdf/info

# Get page text
curl http://localhost:8000/api/page/1/text

# Summarize page
curl -X POST http://localhost:8000/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"page_number": 1}'

# Analyze page
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"page_number": 1, "question": "What is this page about?"}'
```

### Using Postman or Insomnia

Import these endpoints and test manually:
- Base URL: `http://localhost:8000`
- Add your requests as shown above

## 🎨 Customizing the UI

### Color Scheme

Edit CSS files to change colors:

```css
/* Primary color (buttons, accents) */
background: #007bff; /* Change to your brand color */

/* Success color (summarize button) */
background: #28a745;

/* Background colors */
background: #f5f5f5; /* Light gray */
background: #fafafa; /* Very light gray */
```

### Layout

Adjust component sizes in `App.css`:

```css
.chat-section {
  width: 400px; /* Change chat panel width */
}
```

## 🚀 Adding New Features

### Example: Add Chat History Persistence

1. **Backend** - Add database:
```python
# Add to requirements.txt
sqlalchemy==2.0.23
sqlite3

# Create models/chat.py
from sqlalchemy import create_engine, Column, Integer, String, Text
# ... implement chat history model
```

2. **Frontend** - Store messages:
```javascript
// Add localStorage in ChatPanel.jsx
useEffect(() => {
  const savedMessages = localStorage.getItem('chatHistory');
  if (savedMessages) {
    setMessages(JSON.parse(savedMessages));
  }
}, []);

useEffect(() => {
  localStorage.setItem('chatHistory', JSON.stringify(messages));
}, [messages]);
```

### Example: Support Multiple PDFs

1. **Backend** - Use session/user IDs:
```python
# Store PDFs per session
sessions = {}

@app.post("/api/session/create")
async def create_session():
    session_id = str(uuid.uuid4())
    sessions[session_id] = {"pdf": None}
    return {"session_id": session_id}
```

2. **Frontend** - Manage sessions:
```javascript
const [sessionId, setSessionId] = useState(null);

useEffect(() => {
  // Create session on mount
  axios.post(`${API_URL}/api/session/create`)
    .then(res => setSessionId(res.data.session_id));
}, []);
```

## 🔧 Environment Variables

### Backend (.env in root)
```env
OPENAI_API_KEY=sk-...          # Required
BACKEND_PORT=8000              # Optional, default 8000
BACKEND_HOST=0.0.0.0          # Optional, default 0.0.0.0
ENVIRONMENT=development        # development/production
```

### Frontend (.env in frontend/)
```env
VITE_API_URL=http://localhost:8000  # Backend URL
```

## 📊 Performance Optimization

### Backend
1. **Cache PDF text**: Store extracted text in memory
2. **Async processing**: Use FastAPI's async features
3. **Connection pooling**: For database if added

### Frontend
1. **Lazy load pages**: Only render visible page
2. **Memoize components**: Use React.memo
3. **Debounce input**: For search/filter features

## 🐛 Debugging

### Backend Debugging

Add to `main.py`:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

@app.post("/api/analyze")
async def analyze_page(request: AnalyzeRequest):
    logger.debug(f"Analyzing page {request.page_number}")
    # ... rest of code
```

### Frontend Debugging

Use React DevTools and browser console:
```javascript
console.log('Current page:', currentPage);
console.log('Messages:', messages);
```

## 🔒 Security Considerations

### Production Deployment

1. **API Key Security**:
   - Never commit `.env` file
   - Use secrets management in production
   - Rotate keys regularly

2. **CORS**:
```python
# In production, limit CORS origins
allow_origins=["https://yourdomain.com"]
```

3. **File Upload**:
```python
# Add file size limits
from fastapi import File, UploadFile

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(..., max_length=50*1024*1024)):
    # 50MB limit
```

4. **Rate Limiting**:
```python
# Add rate limiting middleware
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@app.post("/api/summarize")
@limiter.limit("10/minute")
async def summarize_page(...):
```

## 📦 Deployment

### Docker Production

1. **Update Dockerfile** for production:
```dockerfile
# backend/Dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

2. **Frontend production build**:
```dockerfile
# frontend/Dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

### Cloud Deployment

**AWS:**
- ECS for containers
- S3 for uploaded files
- RDS for database (if added)

**Heroku:**
- Use Heroku Postgres
- Store files in AWS S3
- Use Heroku container registry

**DigitalOcean:**
- App Platform for easy deployment
- Spaces for file storage
- Managed database for persistence

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write tests (TODO: add testing)
5. Submit a pull request

## 📚 Additional Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Docker Documentation](https://docs.docker.com/)
- [react-pdf Documentation](https://github.com/wojtekmaj/react-pdf)

---

Happy coding! 🚀
