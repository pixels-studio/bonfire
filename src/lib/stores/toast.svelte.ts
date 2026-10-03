export type ToastVariant = 'info' | 'error';
/** A button on the toast; using it dismisses the toast. */
export type ToastAction = { label: string; run: () => void };
export type Toast = {
  id: string;
  text: string;
  variant: ToastVariant;
  action?: ToastAction;
};

export const toasts = $state<Toast[]>([]);

export function dismissToast(id: string) {
  const index = toasts.findIndex((item) => item.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

export function toast(
  text: string,
  {
    variant = 'info',
    duration = 5000,
    action,
  }: { variant?: ToastVariant; duration?: number; action?: ToastAction } = {},
) {
  const id = crypto.randomUUID();
  toasts.push({ id, text, variant, action });
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
