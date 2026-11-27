export type ToastVariant = "success" | "error" | "warning";

export type ToastPlacement = "top-right" | "top-center";

export type ToastRecord = {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
  placement: ToastPlacement;
};

let toasts: ToastRecord[] = [];
const listeners = new Set<() => void>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const l of listeners) l();
}

export function getToastSnapshot(): ToastRecord[] {
  return toasts;
}

export function subscribeToasts(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function dismissToast(id: string): void {
  const tid = timeouts.get(id);
  if (tid !== undefined) {
    clearTimeout(tid);
    timeouts.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function pushToast(
  partial: Omit<ToastRecord, "id" | "duration"> & {
    duration?: number;
    placement?: ToastPlacement;
  },
): string {
  const id = crypto.randomUUID();
  // Stay until the user closes the toast. A positive duration is an explicit
  // auto-dismiss override.
  const duration = partial.duration ?? 0;
  const placement = partial.placement ?? "top-center";
  const { duration: _d, placement: _p, ...rest } = partial;
  toasts = [...toasts, { ...rest, id, duration, placement }];
  emit();
  if (duration > 0) {
    const tid = window.setTimeout(() => dismissToast(id), duration);
    timeouts.set(id, tid);
  }
  return id;
}

export const toast = {
  success(
    title: string,
    description?: string,
    durationMs?: number,
  ): string {
    return pushToast({
      variant: "success",
      title,
      description,
      duration: durationMs,
      placement: "top-center",
    });
  },
  error(title: string, description?: string, durationMs?: number): string {
    return pushToast({
      variant: "error",
      title,
      description,
      duration: durationMs,
      placement: "top-center",
    });
  },
  warning(title: string, description?: string, durationMs?: number): string {
    return pushToast({
      variant: "warning",
      title,
      description,
      duration: durationMs,
      placement: "top-center",
    });
  },
  dismiss: dismissToast,
};
