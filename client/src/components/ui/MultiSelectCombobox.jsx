import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function MultiSelectCombobox({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = 'Search…',
  required,
  error,
  disabled,
  style = {},
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })
  const [highlight, setHighlight] = useState(0)

  const inputRef = useRef(null)
  const listRef = useRef(null)
  const triggerRef = useRef(null)

  const selectedValues = new Set(value)
  const filtered = search.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const selectionLabel = value.length > 0
    ? `${value.length} account${value.length > 1 ? 's' : ''}`
    : placeholder

  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }

    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + window.scrollY + 2,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }
  }, [open])

  useEffect(() => {
    const handler = (event) => {
      const insideTrigger = triggerRef.current?.contains(event.target)
      const insideList = listRef.current?.contains(event.target)
      if (!insideTrigger && !insideList) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function toggleValue(optionValue) {
    if (selectedValues.has(optionValue)) {
      onChange(value.filter((item) => item !== optionValue))
      return
    }
    onChange([...value, optionValue])
  }

  function handleKeyDown(event) {
    if (!open) {
      if (event.key === 'Enter' || event.key === 'ArrowDown') setOpen(true)
      return
    }
    if (event.key === 'ArrowDown') setHighlight((index) => Math.min(index + 1, filtered.length - 1))
    if (event.key === 'ArrowUp') setHighlight((index) => Math.max(index - 1, 0))
    if (event.key === 'Enter' && filtered[highlight]) toggleValue(filtered[highlight].value)
    if (event.key === 'Escape') setOpen(false)
  }

  return (
    <div data-multi-combobox style={{ position: 'relative', ...style }}>
      {label && (
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.3rem' }}>
          {label}
          {required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div
        ref={triggerRef}
        onClick={() => {
          if (disabled) return
          setOpen((current) => !current)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        style={{
          padding: '0.45rem 0.75rem',
          border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: '6px',
          fontSize: '0.875rem',
          background: disabled ? '#f9fafb' : 'white',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '36px',
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{ border: 'none', outline: 'none', width: '100%', fontSize: '0.875rem', background: 'transparent' }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span style={{ color: value.length > 0 ? '#111827' : '#9ca3af' }}>{selectionLabel}</span>
        )}
        <span style={{ color: '#9ca3af', fontSize: '0.75rem', marginLeft: '0.5rem' }}>▾</span>
      </div>

      {open && createPortal(
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: '#9ca3af', fontSize: '0.875rem' }}>No results found</div>
          ) : filtered.map((option, index) => {
            const isSelected = selectedValues.has(option.value)
            return (
              <div
                key={option.value}
                onMouseDown={() => toggleValue(option.value)}
                onMouseEnter={() => setHighlight(index)}
                style={{
                  padding: '0.55rem 1rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: index === highlight ? '#eff6ff' : isSelected ? '#f0fdf4' : 'white',
                  color: isSelected ? '#15803d' : '#111827',
                }}
              >
                <span style={{ width: '1rem', color: isSelected ? '#15803d' : '#d1d5db' }}>{isSelected ? '✓' : ''}</span>
                <span>{option.label}</span>
              </div>
            )
          })}
        </div>,
        document.body
      )}

      {error && <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>{error}</span>}
    </div>
  )
}
