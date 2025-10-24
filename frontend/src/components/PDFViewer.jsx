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
  // Per-page notes: { [pageNumber]: { text: string, x: number (0-100), y: number (0-100) } }
  const [notes, setNotes] = useState({});
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [editingPage, setEditingPage] = useState(null);
  const pageWrapperRef = useRef(null);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Load notes for this PDF from server when filename changes
  useEffect(() => {
    if (!filename) return;
    const load = async () => {
      try {
        const res = await fetch(`/api/notes?filename=${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error('Failed to fetch notes');
        const json = await res.json();
        // server returns { notes: { page: {text,x,y} } }
        const mapped = {};
        Object.entries(json.notes || {}).forEach(([k,v]) => { mapped[Number(k)] = v; });
        setNotes(mapped);
      } catch (err) {
        console.warn('Failed to load notes from server', err);
        setNotes({});
      }
    };
    load();
  }, [filename]);

  // Save a single note to server
  const saveNoteToServer = async (page, note) => {
    if (!filename) {
      console.warn('No filename provided for server-side notes');
      return;
    }
    try {
      const form = new FormData();
      form.append('filename', filename);
      form.append('page', String(page));
      form.append('text', note.text || '');
      form.append('x', String(note.x ?? 85));
      form.append('y', String(note.y ?? 10));
      const res = await fetch('/api/notes', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Failed to save note');
      return true;
    } catch (err) {
      console.warn('Failed to save note to server', err);
      return false;
    }
  };

  const deleteNoteFromServer = async (page) => {
    if (!filename) return;
    try {
      const res = await fetch(`/api/notes?filename=${encodeURIComponent(filename)}&page=${page}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete note');
      return true;
    } catch (err) {
      console.warn('Failed to delete note on server', err);
      return false;
    }
  };

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

  // Note handlers
  const openEditorForPage = (page) => {
    const note = notes[page] || { text: '', x: 85, y: 10 };
    setEditingPage(page);
    setEditingText(note.text || '');
    setEditing(true);
  };

  const saveNote = (page, text, position) => {
    const newNotes = { ...notes };
    newNotes[page] = {
      text: text || '',
      x: position?.x ?? (newNotes[page]?.x ?? 85),
      y: position?.y ?? (newNotes[page]?.y ?? 10),
    };
    setNotes(newNotes);
    // persist to server
    saveNoteToServer(page, newNotes[page]);
    setEditing(false);
    setEditingPage(null);
  };

  const deleteNote = (page) => {
    const newNotes = { ...notes };
    delete newNotes[page];
    setNotes(newNotes);
    deleteNoteFromServer(page);
    setEditing(false);
    setEditingPage(null);
  };

  // Dragging the bubble to reposition it on the page
  const draggingRef = useRef(null);
  const onBubbleMouseDown = (e, page) => {
    e.stopPropagation();
    const wrapper = pageWrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    draggingRef.current = { page, rect, startX: e.clientX, startY: e.clientY };
    window.addEventListener('mousemove', onBubbleMouseMove);
    window.addEventListener('mouseup', onBubbleMouseUp);
  };

  const onBubbleMouseMove = (e) => {
    if (!draggingRef.current) return;
    const { page, rect, startX, startY } = draggingRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // compute new center in percent
    const prev = notes[page] || { x: 85, y: 10 };
    // convert prev percent to px
    const prevPxX = rect.left + (prev.x / 100) * rect.width;
    const prevPxY = rect.top + (prev.y / 100) * rect.height;
    const newPxX = prevPxX + dx;
    const newPxY = prevPxY + dy;
    const newX = Math.max(2, Math.min(98, ((newPxX - rect.left) / rect.width) * 100));
    const newY = Math.max(2, Math.min(98, ((newPxY - rect.top) / rect.height) * 100));
    // update live (not yet saved) so UI moves
    setNotes(prevNotes => ({ ...prevNotes, [page]: { ...(prevNotes[page] || {}), x: newX, y: newY } }));
    // update start for continuous movement
    draggingRef.current.startX = e.clientX;
    draggingRef.current.startY = e.clientY;
  };

  const onBubbleMouseUp = (e) => {
    if (!draggingRef.current) return;
    const { page } = draggingRef.current;
    // persist position
    // save single page position to server if present
    const note = notes[page];
    if (note) saveNoteToServer(page, note);
    draggingRef.current = null;
    window.removeEventListener('mousemove', onBubbleMouseMove);
    window.removeEventListener('mouseup', onBubbleMouseUp);
  };

  // current note for displayed page (used by render)
  const currentNote = notes[currentPage] || { x: 85, y: 10 };
  const [pageDims, setPageDims] = useState(null); // {width, height}
  const [fitMode, setFitMode] = useState('none'); // 'none' | 'fit-width' | 'fit-page'

  // Called when the Page loads to obtain original dimensions
  const onPageLoadSuccess = (pdfPage) => {
    try {
      const viewport = pdfPage.getViewport({ scale: 1 });
      setPageDims({ width: viewport.width, height: viewport.height });
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    if (!fitMode || fitMode === 'none' || !pageWrapperRef.current) return;
    const wrapper = pageWrapperRef.current;

    const recalc = () => {
      // Prefer the outer .pdf-content container for sizing (this is the scrollable viewport area)
      const container = wrapper.closest && wrapper.closest('.pdf-content') || wrapper.parentElement || wrapper;
      const parentRect = container.getBoundingClientRect();
      // leave some horizontal padding so the page doesn't touch the edges
      const maxWidth = Math.max(100, Math.floor(parentRect.width - 40));

      if (fitMode === 'fit-width') {
        setPageWidth(maxWidth);
      } else if (fitMode === 'fit-page' && pageDims) {
        // Fit the whole page into the visible container height
        const availableHeight = Math.max(100, container.clientHeight - 20);
        const scale = availableHeight / pageDims.height;
        const targetWidth = Math.max(100, Math.floor(pageDims.width * scale));
        // ensure we don't exceed the container width
        setPageWidth(Math.min(targetWidth, maxWidth));
      }
    };

    // Recalc now
    recalc();

    // Recalc on window resize while in fit mode
    const onResize = () => recalc();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitMode, pageDims, currentPage]);

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
            <div className="page-wrapper" ref={pageWrapperRef} style={{ display: 'inline-block', position: 'relative' }}>
              <Page 
                pageNumber={currentPage} 
                width={pageWidth}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                onLoadSuccess={onPageLoadSuccess}
              />

              {/* Note bubble (positioned in percent relative to page-wrapper) */}
              <div
                className="note-bubble"
                style={{ position: 'absolute', left: `${currentNote.x}%`, top: `${currentNote.y}%`, transform: 'translate(-50%, -50%)' }}
                onMouseDown={(e) => onBubbleMouseDown(e, currentPage)}
                onClick={(e) => { e.stopPropagation(); openEditorForPage(currentPage); }}
                title={notes[currentPage]?.text ? 'Open note' : 'Add note'}
              >
                📝
              </div>
              {/* Note editor popup */}
              {editing && editingPage === currentPage && (
                <div className="note-editor" onClick={(e) => e.stopPropagation()} style={{ left: `${currentNote.x}%`, top: `${currentNote.y + 8}%`, transform: 'translate(-50%, 0)' }}>
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    placeholder={`Notes for page ${currentPage}`}
                  />
                  <div className="note-editor-actions">
                    <button onClick={() => saveNote(currentPage, editingText, notes[currentPage])}>Save</button>
                    <button onClick={() => { setEditing(false); setEditingPage(null); }}>Close</button>
                    <button onClick={() => deleteNote(currentPage)} style={{ color: 'red' }}>Delete</button>
                  </div>
                </div>
              )}

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

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="nav-button" onClick={() => { setFitMode('fit-width'); }} title="Fit width">Fit width</button>
          <button className="nav-button" onClick={() => { setFitMode('fit-page'); }} title="Fit page">Fit page</button>
          <button className="nav-button" onClick={() => { setFitMode('none'); setPageWidth(600); }} title="Reset">Reset</button>
        </div>

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
