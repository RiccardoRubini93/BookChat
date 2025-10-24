import React, { useState, useRef } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import PDFViewer from './components/PDFViewer';
import ChatPanel from './components/ChatPanel';
import DocumentSidebar from './components/DocumentSidebar';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const chatPanelRef = useRef(null);

  const handleFileUpload = (pdfUrl, info) => {
    setPdfFile(pdfUrl);
    setPdfInfo(info);
    setCurrentPage(1);
    setSelectedDoc(info.filename);
  };

  const handleTextOperation = (operation, text) => {
    if (chatPanelRef.current) {
      chatPanelRef.current.handleTextOperation(operation, text);
    }
  };

  const handleSelectDoc = async (filename) => {
    try {
      const fileRes = await axios.get(`${API_URL}/api/pdf/file`, {
        params: { filename },
        responseType: 'blob',
        headers: { 'Accept': 'application/pdf' },
      });
      const infoRes = await axios.get(`${API_URL}/api/pdf/info`, {
        params: { filename },
      });
      setPdfFile(URL.createObjectURL(fileRes.data));
      setPdfInfo(infoRes.data);
      setCurrentPage(1);
      setSelectedDoc(filename);
    } catch (err) {
      // handle error
    }
  };

  return (
    <div className="app">
      <div className="sidebar-container">
        <DocumentSidebar selectedDoc={selectedDoc} onSelect={handleSelectDoc} />
      </div>
      <div className="main-container">
        {!pdfFile ? (
          <FileUpload onUpload={handleFileUpload} />
        ) : (
          <>
            <div className="pdf-section">
              <PDFViewer
                file={pdfFile}
                filename={pdfInfo?.filename}
                currentPage={currentPage}
                totalPages={pdfInfo?.num_pages || 1}
                onPageChange={setCurrentPage}
                onTextOperation={handleTextOperation}
              />
            </div>
            <div className="chat-section">
              <ChatPanel 
                ref={chatPanelRef}
                currentPage={currentPage} 
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
