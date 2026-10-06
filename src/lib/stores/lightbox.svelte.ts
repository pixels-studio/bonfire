/** A rect's edges and size, as `getBoundingClientRect` gives it. */
export type Rect = { top: number; left: number; width: number; height: number };

export type LightboxImage = {
  src: string;
  alt?: string;
  /** The clicked thumbnail's rect, so the image can morph open from there. */
  origin?: Rect;
};

/** The image shown fullscreen, if any; opened from a thumbnail anywhere in the app. */
class LightboxStore {
  open = $state<LightboxImage>();

  show(image: LightboxImage) {
    this.open = image;
  }

  close() {
    this.open = undefined;
  }
}

export const lightbox = new LightboxStore();

/** The rect to morph a lightbox open from, e.g. `rectOf(event.currentTarget)`. */
export function rectOf(element: Element): Rect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}
