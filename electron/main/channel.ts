/** An async iterable fed by `push` until `close`, for input that arrives over time. */
export class Channel<Item> implements AsyncIterable<Item> {
  private readonly items: Item[] = [];
  private wake?: () => void;
  private closed = false;

  get isClosed() {
    return this.closed;
  }

  push(item: Item) {
    if (this.closed) throw Error('The channel is closed');
    this.items.push(item);
    this.wake?.();
  }

  /** Ends the iteration once the items already pushed have been read. */
  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}
