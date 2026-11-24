import { Excalidraw, restore, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useMemo, useSyncExternalStore } from 'react';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = '/whiteboard-assets/';

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const readTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export type SceneReader = () => string;

export default function WhiteboardCanvas({
  text,
  editing,
  onReader,
}: {
  text: string;
  editing: boolean;
  onReader: (read: SceneReader | null) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const initialData = useMemo(() => {
    const scene = restore(JSON.parse(text), null, null);
    return {
      elements: scene.elements,
      appState: { ...scene.appState, viewBackgroundColor: 'transparent' },
      files: scene.files,
      scrollToContent: true,
    };
  }, [text]);
  return (
    <div data-testid="artifact-whiteboard-canvas" className="relative min-h-0 flex-1">
      <Excalidraw
        initialData={initialData}
        viewModeEnabled={!editing}
        theme={theme}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
            toggleTheme: false,
            changeViewBackgroundColor: false,
          },
        }}
        excalidrawAPI={(api: ExcalidrawImperativeAPI) =>
          onReader(() =>
            serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local'),
          )
        }
      />
    </div>
  );
}
