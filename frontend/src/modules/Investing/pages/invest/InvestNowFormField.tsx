import type { ReactNode } from "react"

export function InvestNowFieldError({ message }: { message?: string }) {
  if (!message?.trim()) return null
  return (
    <p className="deals_create_field_error" role="alert">
      {message}
    </p>
  )
}

export interface InvestNowFormFieldProps {
  id?: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}

export function InvestNowFormField({
  id,
  label,
  required = false,
  hint,
  error,
  children,
  className = "",
}: InvestNowFormFieldProps) {
  const Tag = id ? "label" : "div"
  return (
    <Tag
      {...(id ? { htmlFor: id } : {})}
      className={["deals_create_label deals_create_label_full", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="deals_create_label_text">
        {label}
        {required ? (
          <span className="deals_create_req" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </span>
      {children}
      <InvestNowFieldError message={error} />
      {hint ? <p className="deals_create_hint invest_now_field_hint">{hint}</p> : null}
    </Tag>
  )
}

export function InvestNowReadonlyField({
  label,
  required = false,
  value,
  emphasis = false,
  error,
}: {
  label: string
  required?: boolean
  value: string
  emphasis?: boolean
  error?: string
}) {
  return (
    <div className="deals_create_label deals_create_label_full">
      <span className="deals_create_label_text">
        {label}
        {required ? (
          <span className="deals_create_req" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </span>
      <input
        type="text"
        readOnly
        tabIndex={-1}
        className={
          emphasis
            ? "deals_create_input invest_now_readonly_input invest_now_readonly_input_emphasis"
            : "deals_create_input invest_now_readonly_input"
        }
        value={value}
        aria-readonly="true"
        aria-invalid={Boolean(error) || undefined}
      />
      <InvestNowFieldError message={error} />
    </div>
  )
}
