import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';

/**
 * SearchableSelect — combobox style.
 * The input field itself is typeable; typing filters the dropdown in real time.
 *
 * Props:
 *   value       — current selected value (string)
 *   onChange    — (value: string) => void
 *   options     — [{ value, label }]
 *   placeholder — shown when nothing selected
 *   className   — extra classes on the wrapper (e.g. "w-44")
 *   disabled    — disables the control
 */
export default function SearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  className = '',
  disabled = false,
}) {
  const selectedOption = options.find(o => String(o.value) === String(value));

  const [open,       setOpen]       = useState(false);
  const [inputValue, setInputValue] = useState(selectedOption?.label ?? '');
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  // Keep input text in sync when value changes externally (not on every options identity change)
  useEffect(() => {
    const opt = options.find(o => String(o.value) === String(value));
    setInputValue(opt?.label ?? '');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- options compared by selected label only

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        // Revert input to selected label on blur-away
        const opt = options.find(o => String(o.value) === String(value));
        setInputValue(opt?.label ?? '');
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, value, options]);

  // Filter options by what the user is typing
  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    // If the input exactly matches the selected label, show all (no filter active)
    if (!q || q === (selectedOption?.label ?? '').toLowerCase()) return options;
    return options.filter(o => String(o.label).toLowerCase().includes(q));
  }, [inputValue, options, selectedOption]);

  const handleFocus = () => {
    if (disabled) return;
    // Clear input so user can type fresh; show all options
    setInputValue('');
    setOpen(true);
  };

  const handleInput = (e) => {
    setInputValue(e.target.value);
    setOpen(true);
  };

  const handleSelect = (opt) => {
    onChange(opt.value);
    setInputValue(opt.label);
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setInputValue('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      const opt = options.find(o => String(o.value) === String(value));
      setInputValue(opt?.label ?? '');
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Combobox input */}
      <div className={`input flex items-center gap-1 p-0 overflow-hidden
        ${open ? 'border-primary-400 ring-2 ring-primary-100' : ''}
        ${disabled ? 'opacity-50' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={handleFocus}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400
            px-3 py-0 h-full outline-none border-none focus:ring-0"
        />
        {/* Clear button — only when something is selected */}
        {value && !disabled && (
          <button type="button" onClick={handleClear}
            className="p-1 text-gray-300 hover:text-gray-500 flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Chevron */}
        <button type="button" onClick={() => { if (!disabled) { setOpen(v => !v); if (!open) { setInputValue(''); inputRef.current?.focus(); } } }}
          className="pr-2 text-gray-400 flex-shrink-0">
          <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-[200] top-full mt-1 left-0 w-full min-w-[160px] bg-white
          border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ maxWidth: '340px' }}>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400 italic">No results</li>
            ) : (
              filtered.map((o, idx) => {
                const isSelected = String(o.value) === String(value);
                return (
                  <li
                    key={`${o.value}-${idx}`}
                    onMouseDown={e => { e.preventDefault(); handleSelect(o); }}
                    className={`px-3 py-2 text-sm cursor-pointer select-none
                      ${isSelected
                        ? 'bg-primary-50 text-primary-700 font-semibold'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'}`}
                  >
                    {o.label}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
