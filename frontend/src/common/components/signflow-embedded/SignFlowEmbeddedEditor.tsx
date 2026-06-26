import { CheckCircle2, FileText, Loader2, Save, Sparkles, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { createPortal } from "react-dom"
import "@/modules/Syndication/usermanagement/user_management.css"
import "./signflow-embedded.css"

export type SignFlowEmbeddedEditorProps = {
  editUrl: string
  documentId: string
  templateTitle?: string
  /** True while waiting for the server to return an embed URL (first-time setup). */
  sessionLoading?: boolean
  onTemplateSaved: (data: { templateId: string }) => void
  onCancel?: () => void
  onError?: (message: string) => void
}

/**
 * SignFlow template field editor — premium full-screen popup with embedded builder.
 */
export function SignFlowEmbeddedEditor({
  editUrl,
  documentId,
  templateTitle,
  sessionLoading = false,
  onTemplateSaved,
  onCancel,
  onError,
}: SignFlowEmbeddedEditorProps) {
  const savedRef = useRef(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [builderReady, setBuilderReady] = useState(false)
  const [saving, setSaving] = useState(false)

  const url = editUrl?.trim()
  const docId = documentId?.trim()
  const displayTitle = templateTitle?.trim() || "eSign template"

  useEffect(() => {
    savedRef.current = false
    setIframeLoaded(false)
    setBuilderReady(false)
    setSaving(false)
  }, [url, docId])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; event?: string; message?: string } | undefined
      if (!data || data.source !== 'signflow-embed') return
      if (data.event === 'builder-ready' || data.event === 'builder-document-loaded') {
        setBuilderReady(true)
      }
      if (data.event === 'builder-error') {
        onError?.(data.message ?? 'Could not load the SignFlow template editor')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onError])

  useEffect(() => {
    if (!url || sessionLoading) return
    const timer = window.setTimeout(() => {
      setBuilderReady(true)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [url, sessionLoading])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel?.()
    }
    window.addEventListener("keydown", onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onCancel, saving])

  const handleSave = useCallback(() => {
    if (!docId || savedRef.current || saving) return
    savedRef.current = true
    setSaving(true)
    onTemplateSaved({ templateId: docId })
  }, [docId, onTemplateSaved, saving])

  const handleBackdropMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (saving) return
      if (event.target === event.currentTarget) onCancel?.()
    },
    [onCancel, saving],
  )

  if (!sessionLoading && (!url || !docId)) return null

  const showWorkspaceLoading = sessionLoading || !url

  const modal = (
    <div
      className="signflow_editor_overlay"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="signflow_editor_dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signflow-template-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="signflow_editor_header">
          <div className="signflow_editor_header_main">
            <div className="signflow_editor_icon" aria-hidden>
              <FileText size={22} strokeWidth={1.75} />
            </div>
            <div className="signflow_editor_titles">
              <p className="signflow_editor_eyebrow">
                <Sparkles size={12} strokeWidth={2} aria-hidden />
                SignFlow template setup
              </p>
              <h2 id="signflow-template-editor-title" className="signflow_editor_title">
                {displayTitle}
              </h2>
              <p className="signflow_editor_subtitle">
                Place signature fields on each page, then save when ready for investors.
              </p>
            </div>
          </div>
          <div className="signflow_editor_header_actions">
            <span className="signflow_editor_badge">Draft</span>
            <button
              type="button"
              className="um_modal_close"
              onClick={() => onCancel?.()}
              aria-label="Close template editor"
              disabled={saving}
            >
              <X size={20} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </header>

        <div className="signflow_editor_workspace">
          {showWorkspaceLoading || !iframeLoaded ? (
            <div className="signflow_editor_loading" role="status" aria-live="polite">
              <div className="signflow_editor_loading_card">
                <Loader2
                  className="signflow_editor_spin"
                  size={28}
                  strokeWidth={2}
                  aria-hidden
                />
                <p className="signflow_editor_loading_title">Opening document editor</p>
                <p className="signflow_editor_loading_text">
                  {showWorkspaceLoading
                    ? "Preparing your template…"
                    : "Loading your PDF…"}
                </p>
              </div>
            </div>
          ) : null}

          {url ? (
            <iframe
              key={url}
              src={url}
              title={`SignFlow template editor — ${displayTitle}`}
              className="signflow_editor_iframe"
              onLoad={() => setIframeLoaded(true)}
              onError={() => {
                onError?.("Could not load the SignFlow template editor")
              }}
            />
          ) : null}
        </div>

        <footer className="signflow_editor_footer">
          <div className="signflow_editor_footer_hint">
            <CheckCircle2 size={16} strokeWidth={2} aria-hidden />
            <span>
              Click the PDF to add fields · use page navigation for multi-page documents
            </span>
          </div>
          <div className="signflow_editor_footer_actions">
            <button
              type="button"
              className="signflow_editor_btn signflow_editor_btn--secondary"
              onClick={() => onCancel?.()}
              disabled={saving}
            >
              <X size={16} strokeWidth={2} aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              className="signflow_editor_btn signflow_editor_btn--primary"
              onClick={handleSave}
              disabled={saving || sessionLoading || !url || !docId || !iframeLoaded || !builderReady}
            >
              {saving ? (
                <Loader2
                  className="signflow_editor_spin"
                  size={17}
                  strokeWidth={2}
                  aria-hidden
                />
              ) : (
                <Save size={17} strokeWidth={2} aria-hidden />
              )}
              Save template
            </button>
          </div>
        </footer>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
