async function main() {
  await startCliServer();

  await initChannelAdapters(() => ({}));
  console.log('NanoClaw running');
}

declare function startCliServer(): Promise<void>;
declare function initChannelAdapters(factory: unknown): Promise<void>;

void main();
