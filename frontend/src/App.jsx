import React, { useState, useRef } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import PDFViewer from './components/PDFViewer';
import ChatPanel from './components/ChatPanel';

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const chatPanelRef = useRef(null);

  const handleFileUpload = (pdfUrl, info) => {
    setPdfFile(pdfUrl);
    setPdfInfo(info);
    setCurrentPage(1);
  };

  const handleTextOperation = (operation, text) => {
    // Pass the operation to the ChatPanel component
    if (chatPanelRef.current) {
      chatPanelRef.current.handleTextOperation(operation, text);
    }
  };

  return (
    <div className="app">
      {!pdfFile ? (
        <FileUpload onUpload={handleFileUpload} />
      ) : (
        <div className="main-container">
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
        </div>
      )}
    </div>
  );
}

export default App;
