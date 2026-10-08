interface LipitMessageSender {
  tab?: { id?: number };
  frameId?: number;
}

interface LipitRuntimeError {
  message?: string;
}

interface LipitChromeRuntime {
  lastError?: LipitRuntimeError;
  sendMessage<TResponse>(message: unknown, callback: (response: TResponse) => void): void;
  sendNativeMessage<TResponse>(
    application: string,
    message: unknown,
    callback: (response: TResponse) => void,
  ): void;
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: LipitMessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | void,
    ): void;
  };
}

interface LipitHttpHeader {
  name: string;
  value?: string;
}

interface LipitWebRequestDetails {
  requestId: string;
  tabId: number;
  url: string;
  type: string;
  documentUrl?: string;
  initiator?: string;
  responseHeaders?: LipitHttpHeader[];
}

interface LipitWebRequestEvent {
  addListener(
    listener: (details: LipitWebRequestDetails) => void,
    filter: { urls: string[] },
    extraInfoSpec?: string[],
  ): void;
}

interface LipitStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  get(
    defaults: Record<string, unknown>,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>): Promise<void>;
}

interface LipitStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

declare const chrome: {
  runtime: LipitChromeRuntime;
  storage: {
    session: LipitStorageArea;
    local: LipitStorageArea;
    onChanged: {
      addListener(
        listener: (
          changes: Record<string, LipitStorageChange>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
  tabs: {
    onRemoved: {
      addListener(listener: (tabId: number) => void): void;
    };
  };
  webRequest: {
    onBeforeRequest: LipitWebRequestEvent;
    onHeadersReceived: LipitWebRequestEvent;
  };
};
