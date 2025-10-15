import { SidebarApp } from "./app";
import { DataStore } from "./data";
import { SidebarWindowHandle } from "./types";

declare global {
  interface Window {
    openFrontStrategicSidebar?: SidebarWindowHandle;
    tailwind?: {
      config?: unknown;
    };
  }
}

async function ensureTailwind(): Promise<void> {
  if (document.querySelector("script[data-openfront-tailwind]")) {
    return;
  }
  await new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.tailwindcss.com?plugins=forms,typography";
    script.dataset.openfrontTailwind = "true";
    script.async = true;
    const tailwindGlobal: NonNullable<Window["tailwind"]> =
      window.tailwind ?? {};
    tailwindGlobal.config = {
      corePlugins: {
        preflight: false,
      },
      theme: {
        extend: {},
      },
    };
    window.tailwind = tailwindGlobal;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function initializeSidebar(): Promise<void> {
  if (window.openFrontStrategicSidebar) {
    return;
  }
  await ensureTailwind();
  const store = new DataStore();
  new SidebarApp(store);
  window.openFrontStrategicSidebar = {
    updateData: (snapshot) => store.update(snapshot),
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initializeSidebar());
} else {
  void initializeSidebar();
}

export {};
