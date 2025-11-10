"use client";

import { createRoot, type Root } from "react-dom/client";
import { RealtimeMessage } from "@/components/realtime-message";
import type { Message } from "@/components/message";

type StreamStatus = "error" | "submitted" | "streaming" | "ready";

type MessageNode = {
  id: string;
  element: HTMLDivElement;
  root: Root;
  message: Message;
};

export class LiveStreamController {
  private readonly container: HTMLElement;
  private readonly nodes: MessageNode[] = [];
  private status: StreamStatus = "ready";
  private isLoading = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  appendMessage(message: Message) {
    const element = document.createElement("div");
    element.dataset.messageId = message.id;
    this.container.appendChild(element);

    const root = createRoot(element);
    const node: MessageNode = { id: message.id, element, root, message };
    this.nodes.push(node);
    this.render();
  }

  updateMessage(id: string, message: Message) {
    const node = this.nodes.find((entry) => entry.id === id);
    if (!node) return;

    node.message = message;
    this.render();
  }

  setStatus(status: StreamStatus, isLoading: boolean) {
    this.status = status;
    this.isLoading = isLoading;
    this.render();
  }

  clear() {
    while (this.nodes.length) {
      const node = this.nodes.pop();
      if (!node) continue;
      node.root.unmount();
      if (node.element.parentElement === this.container) {
        this.container.removeChild(node.element);
      }
    }
  }

  destroy() {
    this.clear();
  }

  private render() {
    const lastIndex = this.nodes.length - 1;
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      node.root.render(
        <RealtimeMessage
          message={node.message}
          status={this.status}
          isLatestMessage={index === lastIndex}
          isLoading={this.isLoading}
        />,
      );
    }
  }
}
