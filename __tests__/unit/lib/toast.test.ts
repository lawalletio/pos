import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

import { toast } from 'sonner'
import { showSuccess, showError, showWarning, showInfo } from '@/lib/toast'

describe('toast helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('showSuccess calls toast.success', () => {
    showSuccess('Done!')
    expect(toast.success).toHaveBeenCalledWith('Done!')
  })

  it('showError calls toast.error', () => {
    showError('Something broke')
    expect(toast.error).toHaveBeenCalledWith('Something broke')
  })

  it('showWarning calls toast.warning', () => {
    showWarning('Watch out')
    expect(toast.warning).toHaveBeenCalledWith('Watch out')
  })

  it('showInfo calls toast.info', () => {
    showInfo('FYI')
    expect(toast.info).toHaveBeenCalledWith('FYI')
  })
})
