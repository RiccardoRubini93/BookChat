# 📚 BookChat - Chat with Your PDF Books

BookChat is a modern web application that allows you to upload PDF documents and have intelligent conversations about their content using AI. View your book page by page while getting summaries and asking questions about the content.

![BookChat Demo](https://via.placeholder.com/800x400?text=BookChat+Demo)

## ✨ Features

- 📄 **PDF Viewer**: View your PDF books page by page with smooth navigation
- 💬 **Intelligent Chat**: Ask questions about any page using OpenAI's GPT models
- 📝 **Page Summaries**: Get instant summaries of any page
- 🐳 **Docker Support**: Easy deployment with Docker and Docker Compose
- 🎨 **Minimalistic UI**: Clean, distraction-free interface
- 🔄 **Real-time Processing**: Fast PDF text extraction and AI responses

## 🏗️ Architecture

### Frontend
- **React 18** with Vite for fast development
- **react-pdf** for PDF rendering
- **Axios** for API communication
- Responsive design with CSS modules

### Backend
- **FastAPI** for high-performance API
- **PyPDF2** for PDF text extraction
- **OpenAI API** for AI-powered chat
- Async/await for efficient processing

### Deployment
- **Docker** containers for both frontend and backend
- **Docker Compose** for orchestration
- **Volume mounting** for persistent storage

## 🚀 Getting Started

### Prerequisites

- Docker and Docker Compose installed on your system
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

### Installation

1. **Clone the repository** (or navigate to your project directory)

```bash
cd BookChat
```

2. **Set up environment variables**

Edit the `.env` file in the root directory and add your OpenAI API key:

```env
OPENAI_API_KEY=your_actual_openai_api_key_here
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
FRONTEND_PORT=3000
ENVIRONMENT=development
```

3. **Build and start the application**

```bash
docker-compose up --build
```

This will:
- Build the backend and frontend Docker images
- Start both services
- Make the application available at `http://localhost:3000`

4. **Access the application**

Open your browser and navigate to:
```
http://localhost:3000
```

## 📖 Usage

### Uploading a PDF

1. Click the "Choose PDF File" button on the home screen
2. Select a PDF file from your computer
3. Wait for the upload to complete

### Viewing Your Book

- Use the **Previous** and **Next** buttons to navigate between pages
- The current page number is displayed in the chat panel
- PDF pages are rendered with full text and annotations

### Chatting with Your Book

**Summarize a Page:**
1. Navigate to the page you want to summarize
2. Click the "📝 Summarize Page" button
3. Get an AI-generated summary instantly

**Ask Questions:**
1. Type your question in the text area
2. Click "Send" or press Enter
3. Receive detailed answers based on the page content

## 🛠️ Development

### Running Without Docker

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Project Structure

```
BookChat/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile          # Backend container config
│   └── uploads/            # Uploaded PDF storage
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── FileUpload.jsx
│   │   │   ├── PDFViewer.jsx
│   │   │   └── ChatPanel.jsx
│   │   ├── App.jsx         # Main application
│   │   └── main.jsx        # Entry point
│   ├── package.json        # Node dependencies
│   ├── vite.config.js      # Vite configuration
│   ├── Dockerfile          # Frontend container config
│   └── .env                # Frontend environment variables
├── docker-compose.yml      # Docker orchestration
├── .env                    # Root environment variables
├── .env.example           # Environment template
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## 🔧 Configuration

### Environment Variables

#### Root `.env`
```env
OPENAI_API_KEY=your_openai_api_key
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
FRONTEND_PORT=3000
ENVIRONMENT=development
```

#### Frontend `.env`
```env
VITE_API_URL=http://localhost:8000
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/api/upload` | Upload PDF file |
| GET | `/api/pdf/info` | Get current PDF info |
| GET | `/api/page/{page_number}/text` | Get page text |
| POST | `/api/summarize` | Summarize a page |
| POST | `/api/analyze` | Ask a question about a page |

## 🐳 Docker Commands

```bash
# Build and start services
docker-compose up --build

# Start services in background
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild specific service
docker-compose build backend
docker-compose build frontend

# Remove volumes (clears uploaded PDFs)
docker-compose down -v
```

## 🎨 Customization

### Changing AI Model

Edit `backend/main.py` and modify the `model` parameter in the OpenAI API calls:

```python
response = client.chat.completions.create(
    model="gpt-4o-mini",  # Change to gpt-4, gpt-3.5-turbo, etc.
    # ...
)
```

### Adjusting Response Length

Modify the `max_tokens` parameter:

```python
max_tokens=500  # Increase for longer responses
```

### Styling

- Frontend styles are in component-specific CSS files in `frontend/src/components/`
- Global styles are in `frontend/src/index.css`
- Colors and themes can be customized in CSS variables

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- OpenAI for the GPT API
- FastAPI team for the excellent framework
- React-PDF for PDF rendering capabilities
- The open-source community

## 🆘 Troubleshooting

### PDF Not Loading
- Ensure the PDF is not corrupted
- Check browser console for errors
- Verify the backend is running on port 8000

### OpenAI API Errors
- Verify your API key is correct in `.env`
- Check you have sufficient API credits
- Ensure internet connectivity

### Docker Issues
- Make sure Docker daemon is running
- Try `docker-compose down -v` and rebuild
- Check port conflicts (3000, 8000)

### Text Extraction Issues
- Some PDFs (scanned images) may not have extractable text
- Consider using OCR preprocessing for image-based PDFs

## 📧 Support

For issues and questions, please open an issue on the GitHub repository.

---

Made with ❤️ by the BookChat team
