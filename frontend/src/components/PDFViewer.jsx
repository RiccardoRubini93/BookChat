import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './PDFViewer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

function PDFViewer({ file, filename, currentPage, totalPages, onPageChange, onTextOperation, onHighlightClick, onHighlightCreated }, ref) {
  const [numPages, setNumPages] = useState(null);
  const [pageWidth, setPageWidth] = useState(600);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState('');
  const [highlightColor, setHighlightColor] = useState('#ffff00'); // default yellow
  const [highlights, setHighlights] = useState([]); // {id, text, color, page, position}
  const highlightsRef = useRef(highlights);
  const [lastHighlightId, setLastHighlightId] = useState(null);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Apply an inline highlight to the current selection inside the PDF text layer
  const applyHighlightToSelection = (id, color) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    // Ensure there is text
    const text = selection.toString().trim();
    if (!text) return false;

    // Find the text layer container for this selection (specific to the page)
    let container = selection.anchorNode && selection.anchorNode.parentElement;
    while (container && !container.classList?.contains('react-pdf__Page__textContent')) {
      container = container.parentElement;
    }
    if (!container) return false;

    // Iterate over the spans in the text layer and mark those that intersect the range
    const spans = Array.from(container.querySelectorAll('span'));
    let any = false;
    spans.forEach(span => {
      try {
        if (range.intersectsNode(span)) {
          span.classList.add('pdf-highlight-inline');
          span.dataset.highlightId = id;
          span.style.background = color;
          any = true;
          // attach click handler once
          if (!span.__highlightHandlerAdded) {
            span.addEventListener('click', (e) => {
              e.stopPropagation();
              const h = highlightsRef.current.find(hh => hh.id === id);
              if (onHighlightClick && h) onHighlightClick(h);
            });
            span.__highlightHandlerAdded = true;
          }
        }
      } catch (err) {
        // ignore spans that can't be tested
      }
    });

    return any;
  };

  // Expose a method to scroll to a highlight by id
  useImperativeHandle(ref, () => ({
    scrollToHighlight: (highlightId) => {
      const el = document.querySelector(`[data-highlight-id="${highlightId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // brief flash
        const orig = el.style.transition;
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 3px rgba(255,165,0,0.9)';
        setTimeout(() => { el.style.boxShadow = ''; el.style.transition = orig; }, 800);
      }
    }
  }));

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
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length > 0) {
        setSelectedText(text);
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setContextMenu({
          x: rect.left + (rect.width / 2),
          y: rect.bottom + window.scrollY + 5,
        });
      } else {
        setContextMenu(null);
      }
    }, 10);
  };

  const handleAddHighlight = () => {
    if (!selectedText) return;
    // Generate a unique ID for the highlight
    const id = `${currentPage}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    // Try to apply highlight inline to the text layer. If successful, store metadata.
    const applied = applyHighlightToSelection(id, highlightColor);
    const newHighlight = { id, text: selectedText, color: highlightColor, page: currentPage };
    setHighlights(prev => [ ...prev, newHighlight ]);
    setLastHighlightId(id);
    if (onHighlightCreated) onHighlightCreated(newHighlight);
    setSelectedText('');
    setContextMenu(null);
    window.getSelection().removeAllRanges();
  };

  const handleTextOperation = (operation) => {
    if (selectedText && onTextOperation) {
      // detect if selection is within an existing highlight
      let highlightId = null;
      const sel = window.getSelection();
      if (sel && sel.anchorNode) {
        const parent = sel.anchorNode.parentElement;
        const hit = parent?.closest && parent.closest('[data-highlight-id]');
        if (hit) highlightId = hit.dataset.highlightId;
      }
      // if none, use last created highlight id
      if (!highlightId) highlightId = lastHighlightId;
      onTextOperation(operation, selectedText, highlightId);
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
            {/* Render highlights for current page */}
            <div className="pdf-highlights">
              {highlights.filter(h => h.page === currentPage).map(h => (
                <span
                  key={h.id}
                  className="pdf-highlight"
                  style={{ background: h.color, cursor: 'pointer', margin: '2px', padding: '2px', borderRadius: '3px' }}
                  onClick={() => onHighlightClick && onHighlightClick(h)}
                  title={h.text}
                >
                  {h.text.length > 30 ? h.text.substring(0, 30) + '...' : h.text}
                </span>
              ))}
            </div>
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
          <div style={{ marginBottom: '8px' }}>
            <label htmlFor="highlight-color">Highlight color: </label>
            <input
              id="highlight-color"
              type="color"
              value={highlightColor}
              onChange={e => setHighlightColor(e.target.value)}
              style={{ verticalAlign: 'middle' }}
            />
            <button onClick={handleAddHighlight} style={{ marginLeft: '8px' }}>
              Highlight
            </button>
          </div>
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

export default forwardRef(PDFViewer);
