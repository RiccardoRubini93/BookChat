import React, { useState } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import PDFViewer from './components/PDFViewer';
import ChatPanel from './components/ChatPanel';

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const handleFileUpload = (pdfUrl, info) => {
    setPdfFile(pdfUrl);
    setPdfInfo(info);
    setCurrentPage(1);
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
            />
          </div>
          <div className="chat-section">
            <ChatPanel currentPage={currentPage} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
