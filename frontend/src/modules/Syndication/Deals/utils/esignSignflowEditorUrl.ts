/** Client-side SignFlow embed builder URL (matches backend buildSignFlowEditorUrl). */
export function buildSignFlowEditorUrlClient(
  appBaseUrl: string,
  documentId: string,
  embedApiKey?: string | null,
): string {
  const base = appBaseUrl.trim().replace(/\/$/, "")
  const id = encodeURIComponent(documentId.trim())
  const path = `${base}/embed/documents/${id}/builder`
  const key = embedApiKey?.trim()
  if (!key) return path
  return `${path}?${new URLSearchParams({ apiKey: key }).toString()}`
}

export function canOpenSignFlowEditorInstantly(
  file: {
    signflowDocumentId?: string
    signflowStatus?: string
    esignProvider?: string
  },
  provider: "signflow" | "dropbox" | null,
): boolean {
  if (provider === "dropbox" || file.esignProvider === "dropbox") return false
  const docId = file.signflowDocumentId?.trim()
  if (!docId) return false
  const status = file.signflowStatus
  return status === "draft" || status === "ready"
}
