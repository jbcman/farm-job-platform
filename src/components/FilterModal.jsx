import React from 'react'

const FILTER_CATEGORIES = [
  '밭갈이', '로터리', '두둑', '방제', '수확', '수확 일손', '예초', '기타'
]

export default function FilterModal({ selectedCategories, setSelectedCategories, onClose }) {
  const toggleCategory = (cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const clearAll = () => setSelectedCategories([])

  return (
    <div
      className="filter-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="filter-modal-sheet">
        <div className="filter-modal-header">
          <span style={{ fontSize: 15, fontWeight: 800, color: '#1f2937' }}>작업 종류 선택</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedCategories.length > 0 && (
              <button
                onClick={clearAll}
                style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                전체 해제
              </button>
            )}
            <button
              onClick={onClose}
              style={{ fontSize: 18, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
            >✕</button>
          </div>
        </div>

        <div className="filter-modal-grid">
          {FILTER_CATEGORIES.map(cat => {
            const active = selectedCategories.includes(cat)
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: active ? 800 : 500,
                  background: active ? '#2d8a4e' : '#f3f4f6',
                  color: active ? '#fff' : '#374151',
                  border: active ? '2px solid #2d8a4e' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'center',
                }}
              >
                {active ? '✓ ' : ''}{cat}
              </button>
            )
          })}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 16,
            padding: '14px',
            borderRadius: 14,
            background: '#2d8a4e',
            color: '#fff',
            fontSize: 15,
            fontWeight: 800,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {selectedCategories.length > 0
            ? `${selectedCategories.length}개 선택 · 적용`
            : '적용'}
        </button>
      </div>
    </div>
  )
}
