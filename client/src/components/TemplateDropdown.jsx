import { forwardRef } from 'react'

import Button from './ui/Button'

const TemplateDropdown = forwardRef(function TemplateDropdown(
  { templates, isOpen, onToggle, onLoad, onDelete },
  ref
) {
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant='secondary' size='sm' onClick={onToggle}>
        Load Template{templates.length > 0 ? ` (${templates.length})` : ''}
      </Button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
          zIndex: 500,
          minWidth: '240px',
          maxHeight: '320px',
          overflowY: 'auto',
        }}>
          {templates.length === 0 ? (
            <div style={{ padding: '1rem', fontSize: '0.85rem', color: '#6b7280' }}>
              No templates saved yet.
            </div>
          ) : templates.map((template) => (
            <div key={template.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.6rem 0.75rem',
              borderBottom: '1px solid #f3f4f6',
            }}>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  flex: 1,
                  fontSize: '0.85rem',
                  color: '#1e293b',
                  fontWeight: 500,
                }}
                onClick={() => onLoad(template)}
              >
                {template.name}
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>
                  {template.rows.length} row{template.rows.length !== 1 ? 's' : ''}
                </span>
              </button>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#dc2626',
                  fontSize: '1.1rem',
                  padding: '0.2rem 0.4rem',
                  lineHeight: 1,
                }}
                onClick={() => onDelete(template.id)}
                title='Delete template'
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default TemplateDropdown
