import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

function PDFViewer({ file, filename, currentPage, totalPages, onPageChange }) {
  const [numPages, setNumPages] = useState(null);
  const [pageWidth, setPageWidth] = useState(600);

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages);
  }

  const goToPrevPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  return (
    <div className="pdf-viewer">
      <div className="pdf-header">
        <h2>📖 {filename || 'PDF Document'}</h2>
      </div>
      
      <div className="pdf-content">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="loading">Loading PDF...</div>}
          error={<div className="error">Failed to load PDF</div>}
        >
          <Page 
            pageNumber={currentPage} 
            width={Math.min(pageWidth, 800)}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>

      <div className="pdf-controls">
        <button 
          onClick={goToPrevPage} 
          disabled={currentPage <= 1}
          className="nav-button"
        >
          ← Previous
        </button>
        
        <span className="page-info">
          Page {currentPage} of {totalPages}
        </span>
        
        <button 
          onClick={goToNextPage} 
          disabled={currentPage >= totalPages}
          className="nav-button"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default PDFViewer;
