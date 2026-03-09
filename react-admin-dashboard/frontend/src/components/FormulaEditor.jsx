import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

/**
 * Validate formula syntax. Returns null if valid, or an error message string.
 */
export function validateFormula(expr) {
  if (!expr || !expr.trim()) return null;
  try {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let num = '';
        while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
        if (isNaN(parseFloat(num))) return `Invalid number: ${num}`;
        tokens.push({ type: 'NUM' });
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) i++;
        tokens.push({ type: 'ID' });
        continue;
      }
      if ('+-*/%'.includes(ch)) { tokens.push({ type: 'OP' }); i++; continue; }
      if (ch === '(') { tokens.push({ type: 'LP' }); i++; continue; }
      if (ch === ')') { tokens.push({ type: 'RP' }); i++; continue; }
      return `Unexpected character: "${ch}"`;
    }
    // Check balanced parentheses
    let depth = 0;
    for (const t of tokens) {
      if (t.type === 'LP') depth++;
      if (t.type === 'RP') depth--;
      if (depth < 0) return 'Unexpected closing parenthesis';
    }
    if (depth > 0) return `Missing ${depth} closing parenthesis${depth > 1 ? 'es' : ''}`;
    // Check for empty expression (only operators)
    if (!tokens.some((t) => t.type === 'NUM' || t.type === 'ID')) {
      return 'Formula must reference at least one field or number';
    }
    return null;
  } catch {
    return 'Invalid formula syntax';
  }
}

const TYPE_COLORS = {
  string: 'text-blue-600',
  number: 'text-green-600',
  integer: 'text-green-600',
  boolean: 'text-amber-600',
  object: 'text-purple-600',
  array: 'text-pink-600',
};

/**
 * Extract the current word being typed at the cursor position.
 * Walks backwards from cursor until hitting a delimiter.
 * Returns { word, start } where start is the index in the string.
 */
function getWordAtCursor(text, cursorPos) {
  let start = cursorPos;
  while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
    start--;
  }
  return { word: text.slice(start, cursorPos), start };
}

/**
 * Build flat list of completions from field metadata.
 * Includes top-level fields and lookup subfields (e.g., product.price).
 */
function buildCompletions(fields) {
  const completions = [];
  for (const field of fields) {
    completions.push({ label: field.name, type: field.type, kind: 'field' });
    if (field.lookup?.subfields) {
      for (const sub of field.lookup.subfields) {
        completions.push({
          label: `${field.name}.${sub.name}`,
          type: sub.type,
          kind: 'subfield',
          via: field.lookup.collection,
        });
      }
    }
  }
  return completions;
}

export default function FormulaEditor({ value, onChange, fields = [], placeholder }) {
  const [showPopup, setShowPopup] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorWord, setCursorWord] = useState({ word: '', start: 0 });
  const textareaRef = useRef(null);
  const popupRef = useRef(null);

  const syntaxError = useMemo(() => validateFormula(value), [value]);

  const allCompletions = useRef([]);
  useEffect(() => {
    allCompletions.current = buildCompletions(fields);
  }, [fields]);

  const updateSuggestions = useCallback((text, cursorPos) => {
    const { word, start } = getWordAtCursor(text, cursorPos);
    setCursorWord({ word, start });

    if (!word) {
      // Show all fields when cursor is at a blank position
      const all = allCompletions.current;
      if (all.length > 0) {
        setSuggestions(all);
        setSelectedIndex(0);
        setShowPopup(true);
      } else {
        setShowPopup(false);
      }
      return;
    }

    const lower = word.toLowerCase();
    const filtered = allCompletions.current.filter((c) =>
      c.label.toLowerCase().startsWith(lower)
    );

    if (filtered.length > 0) {
      setSuggestions(filtered);
      setSelectedIndex(0);
      setShowPopup(true);
    } else {
      setShowPopup(false);
    }
  }, []);

  const insertCompletion = useCallback((completion) => {
    const text = value || '';
    const before = text.slice(0, cursorWord.start);
    const after = text.slice(cursorWord.start + cursorWord.word.length);
    const newText = before + completion.label + after;
    onChange(newText);
    setShowPopup(false);

    // Restore cursor position after the inserted text
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = cursorWord.start + completion.label.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }, [value, cursorWord, onChange]);

  const handleKeyDown = (e) => {
    if (!showPopup) {
      // Ctrl+Space to trigger suggestions
      if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const el = textareaRef.current;
        if (el) updateSuggestions(value || '', el.selectionStart);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[selectedIndex]) {
        e.preventDefault();
        insertCompletion(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowPopup(false);
    }
  };

  const handleChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    updateSuggestions(newValue, e.target.selectionStart);
  };

  const handleClick = () => {
    const el = textareaRef.current;
    if (el) updateSuggestions(value || '', el.selectionStart);
  };

  // Scroll selected item into view
  useEffect(() => {
    if (showPopup && popupRef.current) {
      const item = popupRef.current.children[selectedIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showPopup]);

  // Close popup on outside click
  useEffect(() => {
    if (!showPopup) return;
    const handleOutside = (e) => {
      if (
        textareaRef.current && !textareaRef.current.contains(e.target) &&
        popupRef.current && !popupRef.current.contains(e.target)
      ) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showPopup]);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value || ''}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        placeholder={placeholder}
        className={`font-mono text-sm resize-none ${syntaxError ? 'border-destructive' : ''}`}
        rows={3}
      />
      {syntaxError && (
        <p className="text-xs text-destructive mt-1">{syntaxError}</p>
      )}
      {showPopup && suggestions.length > 0 && (
        <div
          ref={popupRef}
          className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === selectedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                insertCompletion(s);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <code className="font-mono text-xs flex-1">{s.label}</code>
              <Badge variant="outline" className={`text-[10px] font-normal ${TYPE_COLORS[s.type] || ''}`}>
                {s.type}
              </Badge>
              {s.kind === 'subfield' && (
                <span className="text-[10px] text-muted-foreground">{s.via}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
