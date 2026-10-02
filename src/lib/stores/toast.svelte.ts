export type ToastVariant = 'info' | 'error';
export type Toast = { id: string; text: string; variant: ToastVariant };

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
  }: { variant?: ToastVariant; duration?: number } = {},
) {
  const id = crypto.randomUUID();
  toasts.push({ id, text, variant });
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
