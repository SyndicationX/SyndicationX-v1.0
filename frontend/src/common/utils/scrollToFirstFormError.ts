export interface ScrollToFirstFormErrorOptions {
  /** Scope search to this element (e.g. a `<form>`). Defaults to `document`. */
  container?: ParentNode | null
  /** Try this selector first (e.g. mapped from a validation message). */
  preferSelector?: string | null
}

const INVALID_CONTROL_SELECTOR = [
  '[aria-invalid="true"]',
  "input[aria-invalid='true']",
  "select[aria-invalid='true']",
  "textarea[aria-invalid='true']",
  "button.portal_dropdown_select_trigger[aria-invalid='true']",
  "button.portal_dropdown_select_trigger_invalid",
  "button[aria-haspopup='listbox'][aria-invalid='true']",
  "fieldset.invest_now_questionnaire_fieldset_invalid",
].join(", ")

function focusAndScroll(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLButtonElement
  ) {
    el.focus({ preventScroll: true })
  }
}

function findControlForError(errorEl: HTMLElement): HTMLElement | null {
  const label = errorEl.closest("label")
  if (label) {
    const inLabel = label.querySelector<HTMLElement>(
      "input, select, textarea, button.portal_dropdown_select_trigger, button[aria-haspopup='listbox']",
    )
    if (inLabel) return inLabel
  }

  const block = errorEl.closest(
    "fieldset, .deals_create_label, .deals_create_label_full, .deal_step_owning_block, [role='row']",
  )
  if (block) {
    const inBlock = block.querySelector<HTMLElement>(
      "input:not([type='hidden']), select, textarea, button.portal_dropdown_select_trigger, button[aria-haspopup='listbox']",
    )
    if (inBlock) return inBlock
  }

  const prev = errorEl.previousElementSibling
  if (prev instanceof HTMLElement) {
    if (
      prev.matches(
        "input, select, textarea, button.portal_dropdown_select_trigger, button[aria-haspopup='listbox']",
      )
    ) {
      return prev
    }
    const nested = prev.querySelector<HTMLElement>(
      "input, select, textarea, button.portal_dropdown_select_trigger, button[aria-haspopup='listbox']",
    )
    if (nested) return nested
  }

  return null
}

function resolveRoot(container?: ParentNode | null): ParentNode {
  return container ?? document
}

/**
 * Scroll to the first invalid control or field error inside `container`.
 * Returns true when a target was found.
 */
export function scrollToFirstFormError(
  options?: ScrollToFirstFormErrorOptions | ParentNode | null,
): boolean {
  const opts: ScrollToFirstFormErrorOptions =
    options != null &&
    typeof options === "object" &&
    ("container" in options || "preferSelector" in options)
      ? (options as ScrollToFirstFormErrorOptions)
      : { container: options as ParentNode | null | undefined }

  const root = resolveRoot(opts.container)

  if (opts.preferSelector?.trim()) {
    const preferred =
      root instanceof Document
        ? root.querySelector<HTMLElement>(opts.preferSelector)
        : (root as ParentNode).querySelector<HTMLElement>(opts.preferSelector)
    if (preferred) {
      focusAndScroll(preferred)
      return true
    }
  }

  const invalid =
    root instanceof Document
      ? root.querySelector<HTMLElement>(INVALID_CONTROL_SELECTOR)
      : (root as ParentNode).querySelector<HTMLElement>(INVALID_CONTROL_SELECTOR)
  if (invalid) {
    focusAndScroll(invalid)
    return true
  }

  const errorEl =
    root instanceof Document
      ? root.querySelector<HTMLElement>(".deals_create_field_error")
      : (root as ParentNode).querySelector<HTMLElement>(".deals_create_field_error")
  if (errorEl) {
    const control = findControlForError(errorEl)
    if (control) {
      focusAndScroll(control)
      return true
    }
    errorEl.scrollIntoView({ behavior: "smooth", block: "center" })
    return true
  }

  return false
}

/** Scroll the first validation banner into view inside `container`. */
export function scrollValidationAlertIntoView(
  container?: ParentNode | null,
): void {
  const root = resolveRoot(container)
  const alert = root.querySelector<HTMLElement>(
    ".um_msg_error, .um_modal_form_error",
  )
  alert?.scrollIntoView({ behavior: "smooth", block: "start" })
}

/** Run after React applies validation state from `setState`. */
export function focusFirstFormErrorAfterUpdate(
  options?: ScrollToFirstFormErrorOptions | ParentNode | null,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToFirstFormError(options)
    })
  })
}
