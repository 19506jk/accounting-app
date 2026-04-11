import { useEffect, useState } from 'react'

import Button from './ui/Button'
import Input from './ui/Input'
import Modal from './ui/Modal'

export default function SaveTemplateModal({
  isOpen,
  onClose,
  onSave,
  title = 'Save Expense Template',
  placeholder = 'e.g., Weekly Office Supplies',
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setName('')
      setError('')
    }
  }, [isOpen])

  function handleSave() {
    const nextError = onSave(name)

    if (nextError) {
      setError(nextError)
      return
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width='520px'>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <Input
          label='Template Name'
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
          placeholder={placeholder}
          error={error || undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSave()
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button variant='secondary' onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Template</Button>
        </div>
      </div>
    </Modal>
  )
}
