import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

function PDFViewer({ file, filename, currentPage, totalPages, onPageChange, onTextOperation }) {
  const [numPages, setNumPages] = useState(null);
  const [pageWidth, setPageWidth] = useState(600);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState('');

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

  const handleTextSelection = (e) => {
    // Small delay to ensure selection is complete
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      if (text.length > 0) {
        setSelectedText(text);
        
        // Get the bounding rect of the selection
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Position the menu near the selection
        setContextMenu({
          x: rect.left + (rect.width / 2),
          y: rect.bottom + window.scrollY + 5, // Position below the selection
        });
      } else {
        setContextMenu(null);
      }
    }, 10);
  };

  const handleTextOperation = (operation) => {
    if (selectedText && onTextOperation) {
      onTextOperation(operation, selectedText);
    }
    setContextMenu(null);
    window.getSelection().removeAllRanges();
  };

  const handleClickOutside = () => {
    setContextMenu(null);
  };

  return (
    <div className="pdf-viewer" onClick={handleClickOutside}>
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
          <div onMouseUp={handleTextSelection}>
            <Page 
              pageNumber={currentPage} 
              width={Math.min(pageWidth, 800)}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </div>
        </Document>
      </div>

      {contextMenu && (
        <div 
          className="text-context-menu"
          style={{ 
            top: `${contextMenu.y}px`, 
            left: `${contextMenu.x}px` 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleTextOperation('summarize')}>
            📝 Summarize
          </button>
          <button onClick={() => handleTextOperation('rephrase')}>
            ✍️ Rephrase
          </button>
          <button onClick={() => handleTextOperation('explain')}>
            💡 Explain
          </button>
        </div>
      )}

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
