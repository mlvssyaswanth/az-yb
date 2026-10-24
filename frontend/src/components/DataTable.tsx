import { DownloadIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { SheetData } from 'write-excel-file/browser'

import { Button } from '@/components/ui/button'
import { Table } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type ExportCell = string | number | null | undefined

export interface ExportData {
  /** File name without the .xlsx extension. */
  fileName: string
  headers: string[]
  rows: ExportCell[][]
}

async function downloadXlsx({ fileName, headers, rows }: ExportData) {
  // Loaded on demand so the spreadsheet writer stays out of the main bundle.
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const toCell = (value: ExportCell) =>
    value == null ? null : typeof value === 'number' ? { value, type: Number } : { value, type: String }
  const data: SheetData = [
    headers.map((header) => ({ value: header, fontWeight: 'bold' as const })),
    ...rows.map((row) => row.map(toCell)),
  ]
  await writeExcelFile(data).toFile(`${fileName}.xlsx`)
}

/** "Download Excel" button; place it in a Panel's `actions` next to the title and legend. */
export function ExcelDownloadButton({ exportData }: { exportData: ExportData }) {
  const [exporting, setExporting] = useState(false)

  async function exportXlsx() {
    setExporting(true)
    try {
      await downloadXlsx(exportData)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={exportXlsx}
      disabled={exporting || exportData.rows.length === 0}
      aria-label="Download Excel"
      title="Download Excel"
    >
      <DownloadIcon aria-hidden />
    </Button>
  )
}

/** Standard table for the dashboard: a fixed-height scroll area with a pinned header row. */
export function DataTable({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Table
      className={cn('tabular-nums [&_thead]:bg-card [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:shadow-[0_1px_0_var(--border)] [&_thead_tr]:border-b-0', className)}
      containerClassName="h-96 overflow-y-auto"
    >
      {children}
    </Table>
  )
}
